#!/usr/bin/env node
/**
 * Red drill, re-runnable on demand: re-proves that the git-apply suite case earns its keep
 * after any future renderer edit, without leaving the live tree touched.
 *
 * What it does (all scratch, all restored or removed in `finally`):
 *   0. control — runs the suite's scaffold describe against a byte-identical COPY of the
 *      pinned scaffold and expects the git-apply case green (1 passed | 64 skipped of 65);
 *   1. corrupts a COPY of the pinned scaffold the exact way the red drill did — the hunk
 *      header's old-side count declared one higher than the rows the hunk carries — the
 *      renderer bug class every rule verify is blind to;
 *   2. copies gate-drift.test.ts to src/test/zz-red-drill-gate-drift.test.ts with the
 *      copy's SCAFFOLD const pointed at the corrupt copy (a copy of the suite, not the
 *      suite itself — the live file is never edited), plus -t filters so only the
 *      apply-check case runs;
 *   3. expects vitest RED on exactly the corrupt-patch signature
 *      (`error: corrupt patch at scaffold-tests-probe.patch:`);
 *   4. restore in `finally`: suite copy deleted, corrupt copy deleted, pin hashes re-read
 *      and compared byte-exact against the values captured at start.
 *
 * Exit 0 = keep re-proven. Exit 1 = the drill's own assertions failed (the case no longer
 * reds on the corruption, or the control no longer greens — that is a real regression).
 *
 * Run: `node .freebuff/red-drill.mjs`
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ch = (file) => createHash("sha256").update(readFileSync(path.join(projectRoot, file))).digest("hex").slice(0, 8);

const SCAFFOLD = path.join(".freebuff", "scaffold-sweep.mjs");
const SUITE = path.join("src", "test", "gate-drift.test.ts");
const DRILL_SUITE = "src/test/zz-red-drill-gate-drift.test.ts";

/** The corruption: the hunk header's old-side count, declared one higher than the rows carried. */
const NEEDLE = "`@@ -${from + 1},${oldCount} +${from + 1 + deltaSoFar},${newCount} @@`";
const CORRUPTED = "`@@ -${from + 1},${oldCount + 1} +${from + 1 + deltaSoFar},${newCount} @@`";

const pins = () => ({ scaffold: ch(SCAFFOLD), suite: ch(SUITE) });
const pinsBefore = pins();

/** The scaffold describe's line, parameterized so the drill can point SCAFFOLD wherever it needs. */
const SUITE_LINE = '  const SCAFFOLD = path.join(projectRoot, ".freebuff", "scaffold-sweep.mjs");';

/** Only the apply-check case runs — its title is the drill's subject, and the filter matches just it. */
const APPLY_TITLE = "drafts a patch that passes git apply --check in a throwaway repo";
const FILTER = APPLY_TITLE;

const runVitest = (filter, phase) => {
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", DRILL_SUITE, "-t", filter],
    { cwd: projectRoot, encoding: "utf8", env: { ...process.env, DRILL_PHASE: phase } },
  );
  // Vitest colors its summary even down a pipe; strip the codes so the pass/fail
  // regexes below match the words, not a terminal's paint between them.
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  return { code: result.status, out };
};

const fail = (message, out) => {
  console.error(`red-drill: ${message}`);
  if (out) console.error(out.trim().split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
};

const corrupted = path.join(projectRoot, ".freebuff", "scaffold-sweep-red-drill.mjs");
const drillSuitePath = path.join(projectRoot, DRILL_SUITE);
let suiteText = null;

try {
  // 0. Control: the same case, the real scaffold, expected green (the one filtered case passes).
  suiteText = readFileSync(path.join(projectRoot, SUITE), "utf8");
  if (!suiteText.includes(SUITE_LINE)) {
    fail(`the SCAFFOLD const line moved — update SUITE_LINE in this script:\n  ${SUITE_LINE}`);
    process.exit();
  }
  writeFileSync(
    path.join(projectRoot, DRILL_SUITE),
    suiteText
      // The copy's path is already absolute; wrapping it in path.join(projectRoot, …)
      // would concatenate projectRoot onto it and the spawn would fail MODULE_NOT_FOUND
      // with a doubled path — exit 1, empty report, the crash invisible in the case.
      .replace(SUITE_LINE, `  const SCAFFOLD = ${JSON.stringify(corrupted)};`)
      // On failure vitest's console plumbing hides the test's own output; the injected
      // line writes the scaffold's report to a file the drill reads back instead.
      .replace(
        'const { status } = scaffold(root, [`--name=${freshName}`, "--tests", "--json"]);',
        'const { status, report: drillDebugReport, stderr: drillDebugStderr } = scaffold(root, [`--name=${freshName}`, "--tests", "--json"]); writeFileSync(path.join(projectRoot, ".freebuff", `red-drill-debug-${process.env.DRILL_PHASE ?? "unknown"}.json`), JSON.stringify({ status, report: drillDebugReport, stderrTail: (drillDebugStderr ?? "").slice(-1200) }));',
      ),
    "utf8",
  );

  // The control holds the copy mechanism constant: the case first runs against a
  // byte-identical copy of the real scaffold at the drill's own path, so the only delta
  // between the control run and the red run below is the corruption token itself.
  const scaffoldText = readFileSync(path.join(projectRoot, SCAFFOLD), "utf8");
  writeFileSync(corrupted, scaffoldText, "utf8");

  const control = runVitest(FILTER, "control");
  const controlOk =
    control.code === 0 && /Tests\s+1 passed/.test(control.out) && !/corrupt patch/.test(control.out);
  const controlDebug = path.join(projectRoot, ".freebuff", "red-drill-debug-control.json");
  if (!controlOk) {
    console.error(`red-drill: control components — code=${control.code} passed=${/Tests\s+1 passed/.test(control.out)} corruptFree=${!/corrupt patch/.test(control.out)}`);
    if (existsSync(controlDebug)) {
      const captured = JSON.parse(readFileSync(controlDebug, "utf8"));
      console.error(`red-drill: control scaffold report — status ${captured.status}, error: ${captured.report?.error ?? "(none)"}, stderr tail: ${captured.stderrTail ?? "(none)"}`);
    }
    fail(`control run against the REAL scaffold did not read green (1 passed, exit 0)`, control.out);
    process.exit();
  }
  console.log(`red-drill: control green — the apply-check case passes against the real scaffold (1 passed, exit 0)`);

  // 1. Corrupt the copy in place, byte-level, one token.
  const hits = scaffoldText.split(NEEDLE).length - 1;
  if (hits !== 1) {
    fail(`corruption needle matches ${hits} time(s), expected exactly 1 — the renderer moved; re-derive the needle`);
    process.exit();
  }
  writeFileSync(corrupted, scaffoldText.replace(NEEDLE, CORRUPTED), "utf8");
  console.log(`red-drill: corrupt copy written (${path.basename(corrupted)}), hunk oldCount declared +1`);

  // 2/3. The same case against the corrupt copy, expected RED on the corrupt-patch signature.
  const red = runVitest(FILTER, "red");
  const redOnSignature =
    red.code !== 0 &&
    /corrupt patch at scaffold-tests-probe\.patch:/.test(red.out) &&
    /Tests\s+1 failed/.test(red.out);
  if (!redOnSignature) {
    fail(`the drill case did NOT red on the corrupt-patch signature — the keep no longer holds`, red.out);
    process.exit();
  }
  const [, line] = red.out.match(/corrupt patch at scaffold-tests-probe\.patch:(\d+)/) ?? [];
  console.log(`red-drill: keep re-proven — the case reds at the corrupt-patch refusal (patch line ${line ?? "?"}), not at any rule verify`);
} finally {
  // 4. Restore: drill artifacts removed, pins proven byte-exact.
  for (const artifact of [corrupted, drillSuitePath]) rmSync(artifact, { force: true });
  rmSync(path.join(projectRoot, ".freebuff", "red-drill-debug-control.json"), { force: true });
  rmSync(path.join(projectRoot, ".freebuff", "red-drill-debug-red.json"), { force: true });
  const pinsAfter = pins();
  const drift = Object.entries(pinsBefore).filter(([file, hash]) => pinsAfter[file] !== hash);
  if (drift.length > 0) {
    fail(`drill tree did not restore byte-exact: ${drift.map(([file]) => file).join(", ")}`);
  } else {
    console.log(`red-drill: tree restored — ${SCAFFOLD} and ${SUITE} byte-exact vs. drill start`);
  }
}
