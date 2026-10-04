#!/usr/bin/env node
/**
 * Fails when a repeated collect session confirmed a loose gate.
 *
 *   npm run collect:stale
 *
 * The gate half of `npm run collect:propose`: that session runs the suite several
 * times and leaves a run report, and a baseline is only called stale here when
 * *every* run of the session agreed it is loose. One run is one noisy sample of a
 * wall-clock quantity, so a single reading is left as a `WARN` annotation by the
 * reporter and never fails a build on its own — this is what fails, and only on
 * evidence that repeats.
 *
 * It reads the report rather than measuring again: the session's runs are the
 * measurement, and the reporter is the only process that can reach Vitest's
 * `importDurations`. It fails closed in every case where the report cannot speak
 * — no report at all, a session that came up short of its runs, or a session of
 * fewer than `MIN_CONFIRMING_RUNS` — because a gate that passes when it did not
 * run is worse than one that says so.
 *
 * The fix is the same approve-and-apply flow an ordinary proposal uses: the
 * collect-budget proposal comment on the pull request carries the tightening in
 * its hidden payload, and a reviewer reply applies it.
 *
 * Named into the `*-collect-baselines` family on purpose: the gate manifest
 * (`.freebuff/gate-hashes.mjs`) watches that pattern, and a gate that could be
 * loosened without a pinned hash changing is exactly the silent rot the manifest
 * exists to catch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_CONFIRMING_RUNS,
  RUN_REPORT_FILE,
  parseRunReport,
  staleGateDetails,
} from "./collect-run.mjs";

// Resolved from the run's directory rather than this file's, exactly as the
// reporter resolves the path it writes: the two are the same file only if both
// sides agree on the directory, and the suite runs from the project root.
const reportPath = join(process.cwd(), ".freebuff", RUN_REPORT_FILE);

let report = null;
try {
  report = parseRunReport(readFileSync(reportPath, "utf8"));
} catch {
  // Missing or unreadable is the same answer as malformed: no report.
}

if (!report) {
  console.error(
    `collect:stale: no run report at ${reportPath} — the session did not judge ` +
      "the baselines, so this gate has nothing to stand on",
  );
  process.exit(1);
}

if (report.runs < MIN_CONFIRMING_RUNS) {
  console.error(
    `collect:stale: the report judged ${report.runs} run — a loose gate is only called when ` +
      `at least ${MIN_CONFIRMING_RUNS} runs agree, so a lone run confirms nothing`,
  );
  process.exit(1);
}

if (report.samples < report.runs) {
  console.error(
    `collect:stale: only ${report.samples} of ${report.runs} runs left a sample — ` +
      "not calling a baseline stale that the others did not confirm",
  );
  process.exit(1);
}

if (report.stale.length === 0) {
  console.log(
    `collect:stale: every recorded gate held against all ${report.samples} run(s) — ` +
      "no gate is looser than the tree needs",
  );
  process.exit(0);
}

console.error(
  `collect:stale: ${report.stale.length} recorded gate(s) are loose against every one ` +
    `of ${report.samples} run(s):`,
);
for (const detail of staleGateDetails(report.stale)) {
  console.error(`  ${detail.name}  ${detail.detail}`);
}
console.error(
  "Run `npm run collect:record` locally and commit the result, or reply with the apply " +
    "command on the collect-budget proposal comment.",
);
process.exit(1);
