#!/usr/bin/env node
/**
 * The per-file coverage floor.
 *
 * `vitest.config.ts` holds its thresholds *per directory*: a glob key is checked
 * against the combined coverage of the files it matches, so `src/lib/**` is held
 * high while `src/components/**` is held low. That is the right shape for a
 * gate — it says "this area is better covered than that one" — but it has a hole
 * a bookkeeper would recognise: a directory aggregate can hide one badly
 * covered file behind its well-covered neighbours. A new 200-line module dropped
 * into `src/lib/` costs the directory a point or two and may not trip anything.
 *
 * Vitest cannot close the hole itself. Its `coverage.thresholds.perFile` flag is
 * global — when it is on, it applies per-file checking to *every* threshold set,
 * so the `src/lib/**` aggregate would become "every src/lib file ≥ 88%", which
 * is not what that number means and would fail on files the aggregate is happy
 * to average. There is no per-glob `perFile`.
 *
 * So the floor lives here instead, as the second half of `npm run test:coverage`
 * (`vitest run --coverage && npm run coverage:floor`): after the run has written
 * `.coverage/coverage-summary.json`, every measured file is checked on its own.
 * The two gates are complementary — an aggregate that a directory must sustain,
 * and a floor no single file may fall below.
 *
 * It is deliberately a plain script rather than a test. A test would have to
 * read the report the coverage run just wrote, which only exists in that run, so
 * it would be absent (and therefore silently skipped) under a plain `npm test`.
 * Here the check runs exactly when the data it needs exists, and a missing
 * report is a loud failure rather than a skip.
 *
 * ## What is checked
 *
 * Every file is held to `lines` and `statements` — the two measure the same
 * execution in nearly every file, so a file that clears one and not the other is
 * a file whose coverage is carried by a construct the other does not count,
 * which is worth seeing. On top of that, the **pure-logic directories**
 * (`src/lib/**`, `src/utils/**`) are held on `branches` and `functions` too:
 * those files are pure units where a branch is a case a test should have made
 * and a function is a unit a test should have called, so weak branch or function
 * coverage there is a real gap. `src/components/**` and `src/app/**` are
 * deliberately excluded from the extra metrics — a component's branch count is
 * dominated by render conditionals and its value depends on how many states the
 * test chose to mount, so a per-file number there would say more about testing
 * style than about tests.
 *
 * Each number sits just under the lowest file in its directory, so the floor is
 * as tight as the tree allows. The numbers themselves live in
 * `.freebuff/coverage-floor-rules.mjs`, so `src/test/coverage-gates.test.ts` can
 * pin them and this script can apply them without either owning the other; the
 * exemptions there are files whose metric is structurally zero rather than a
 * gap, and they are still held to the base floor.
 *
 * Usage:
 *   node .freebuff/coverage-floor.mjs                  # the floor, from .coverage/
 *   node .freebuff/coverage-floor.mjs --threshold 99   # a stricter base line
 *   node .freebuff/coverage-floor.mjs --summary path   # against another report
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { BASE_FLOOR, DIRECTORY_FLOORS, EXEMPTIONS } from "./coverage-floor-rules.mjs";

/** The report `vitest run --coverage` writes, relative to the project root. */
const DEFAULT_SUMMARY = ".coverage/coverage-summary.json";

const METRIC_ORDER = ["lines", "statements", "branches", "functions"];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const thresholdArg = argValue("--threshold");
if (thresholdArg !== undefined && !Number.isFinite(Number(thresholdArg))) {
  console.error(`coverage-floor: --threshold must be a number, got ${thresholdArg}`);
  process.exit(1);
}
// The flag moves only the base line; the directory extras stay where they are.
const floor =
  thresholdArg === undefined
    ? BASE_FLOOR
    : { ...BASE_FLOOR, lines: Number(thresholdArg), statements: Number(thresholdArg) };

const summaryPath = resolve(argValue("--summary") ?? DEFAULT_SUMMARY);

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch (error) {
  console.error(
    `coverage-floor: could not read ${summaryPath}\n` +
      "Run `npm run test:coverage`, which writes this report and then checks it.\n" +
      String(error instanceof Error ? error.message : error),
  );
  process.exit(1);
}

/** The project-relative, forward-slashed path a `prefix` is matched against. */
function relativePath(file) {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}

/** The floors that apply to one file: the base, plus its directory's extras. */
function floorsFor(rel) {
  // An exemption drops only the extra metrics, never the base floor.
  if (EXEMPTIONS.has(rel)) return floor;
  const metrics = { ...floor };
  for (const { prefix, floors } of DIRECTORY_FLOORS) {
    if (!rel.startsWith(prefix)) continue;
    for (const [metric, value] of Object.entries(floors)) metrics[metric] = value;
  }
  return metrics;
}

const failures = [];
let files = 0;
for (const [file, metrics] of Object.entries(summary)) {
  // The report carries a `total` row alongside the per-file ones.
  if (file === "total") continue;
  files += 1;
  const rel = relativePath(file);
  const applicable = floorsFor(rel);
  for (const metric of METRIC_ORDER) {
    const threshold = applicable[metric];
    if (threshold === undefined) continue;
    const pct = metrics?.[metric]?.pct;
    if (typeof pct !== "number") continue;
    if (pct < threshold) {
      failures.push({
        pct,
        metric,
        threshold,
        rel,
        extra: !EXEMPTIONS.has(rel) && threshold !== floor[metric],
      });
    }
  }
}

if (failures.length > 0) {
  const width = String(Math.max(...failures.map((failure) => failure.pct.toFixed(2).length))).length;
  console.error(
    `coverage-floor: ${failures.length} file metric(s) below their floor\n` +
      failures
        .sort((a, b) => a.pct - b.pct)
        .map(
          (failure) =>
            `  ${failure.pct.toFixed(2).padStart(width)}%  below ${String(failure.threshold).padStart(3)}%  ` +
            `${failure.metric.padEnd(10)}  ${failure.rel}${failure.extra ? "  (directory floor)" : ""}`,
        )
        .join("\n") +
      "\nCover the file, or add a reasoned exemption if the metric is structural.",
  );
  process.exit(1);
}

const extras = DIRECTORY_FLOORS.map(({ prefix, floors }) => {
  const held = Object.entries(floors)
    .map(([metric, value]) => `${metric} ${value}%`)
    .join(" / ");
  return `${prefix}** on ${held}`;
});
console.log(
  `coverage-floor: ${files} file(s) at or above ${floor.lines}% lines and statements` +
    `; ${extras.join("; ")} (${EXEMPTIONS.size} exemption(s)).`,
);
