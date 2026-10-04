#!/usr/bin/env node
/**
 * Proposes the collect-budget drops a change would earn, without applying them.
 *
 *   npm run collect:propose
 *   COLLECT_PROPOSE_RUNS=1 npm run collect:propose   # a single quick look
 *
 * The pull-request half of the ratchet, and the same shape as
 * `.freebuff/coverage-propose.mjs`: it runs the suite with the collect-time
 * reporter in *propose* mode, which measures exactly as the recorder does but
 * writes a Markdown proposal instead of the checked-in
 * `.freebuff/collect-budget-baselines.mjs`. Nothing under version control is
 * touched — a lower number only tightens a gate, so a person makes that edit
 * deliberately.
 *
 * The suite runs **several times**, and a drop is only posted when it holds across
 * every one of them. Collect time is a wall-clock measurement on a shared machine
 * — a single run is one sample, and its quietest moment would otherwise be enough
 * to propose a tightening that no other run reproduces. The reporter aggregates
 * the runs by worst case (see `aggregateSamples` in `src/test/collect-budget.ts`),
 * so what is posted is the drop every run confirmed; this launcher's job is only
 * to drive the repeats, own the sample directory they meet in, and refuse to
 * publish a session that came up short.
 *
 * This launcher owns the publishing, the way the reporter cannot from inside
 * Vitest: it prints the proposal, appends it to `$GITHUB_STEP_SUMMARY`, and writes
 * `earned=true` to `$GITHUB_OUTPUT` when there is something to propose — the flag
 * the workflow reads before it comments. It exits `0` whether or not there is a
 * proposal: it is advice, not a gate. The suite's own result does not change that;
 * the `test` job is where the suite gates.
 *
 * The model is measured here, in real runs, because only the reporter can reach
 * `importDurations` — nothing a standalone script can read. That is the cost of
 * measuring collect time honestly, and it is why the job is separate from the one
 * that already runs the suite.
 *
 * The same runs are the gate for a *loose* baseline. The reporter judges the
 * recorded baselines against the session's worst-case measurement and leaves its
 * report behind; `npm run collect:stale` reads it and fails when the session was
 * complete and every run agreed one is stale. So the job answers both questions a
 * repeated measurement can settle: what could tighten, and whether a number has
 * already drifted too high to be honest.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_REPORT_FILE } from "./collect-run.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const freebuff = join(root, ".freebuff");
const proposalPath = join(freebuff, "collect-budget-proposal.md");
const statePath = join(freebuff, ".collect-budget-proposal.json");
const samplesDir = join(freebuff, ".collect-budget-samples");
const reportPath = join(freebuff, RUN_REPORT_FILE);

// Resolve the installed Vitest CLI rather than shelling out to `npx`, so this
// works from any directory and on any platform.
const require = createRequire(import.meta.url);
const vitest = require.resolve("vitest/vitest.mjs");

// Captured before the runs and blanked for them: one of the suite's own tests
// spawns the coverage proposer, which inherits `$GITHUB_STEP_SUMMARY` and appends
// to it. Only this job's own proposal belongs in the summary, so the suite runs
// without a summary to write to.
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

/**
 * How many runs a proposal has to hold across. Three is enough that one idle
 * sample cannot carry a drop on its own, and cheap enough to keep the job's cost
 * in minutes rather than hours; `COLLECT_PROPOSE_RUNS=1` is the escape hatch for
 * a look at one run, and is deliberately not what the job uses.
 */
const runs = Math.max(1, Number.parseInt(process.env.COLLECT_PROPOSE_RUNS ?? "3", 10) || 3);

// Cleared, not reused: the reporter folds every sample it finds into its worst
// case, so a leftover from an earlier run would hold back a drop this session
// actually earned.
rmSync(samplesDir, { recursive: true, force: true });
mkdirSync(samplesDir, { recursive: true });
// Likewise the run report: a run may finish before `onTestRunEnd` writes one, and
// `npm run collect:stale` reads the report rather than the suite's output — so a
// leftover from an earlier session must never be read as this one's. Its absence
// is what tells that step the session did not judge anything.
rmSync(reportPath, { force: true });

for (let index = 0; index < runs; index++) {
  // Each run rewrites both, so clearing them first keeps a run that fails before
  // its proposal from leaving the previous one's to be read as if it were last.
  rmSync(proposalPath, { force: true });
  rmSync(statePath, { force: true });
  const run = spawnSync(process.execPath, [vitest, "run"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      COLLECT_BASELINE_PROPOSE: "1",
      COLLECT_PROPOSAL_SAMPLE: String(index),
      // The target the reporter records in its report, so a session that came up
      // short is visible to `npm run collect:stale` rather than reading as a
      // complete one.
      COLLECT_PROPOSAL_RUNS: String(runs),
      GITHUB_STEP_SUMMARY: "",
    },
  });
  if (run.error) {
    console.error(
      `collect:propose: run ${index + 1}/${runs} could not start vitest — ${run.error.message}`,
    );
    process.exit(1);
  }
}

// The session's samples are the reporter's business; this leaves the checkout as
// it found it whether or not a proposal was written. The run report is the one
// thing deliberately left behind: the reporter writes it on the last run, and
// `npm run collect:stale` reads it afterwards to fail when every run agreed a
// recorded baseline is loose.
rmSync(samplesDir, { recursive: true, force: true });

let proposal = "";
try {
  proposal = readFileSync(proposalPath, "utf8");
} catch {
  // A run that failed before `onTestRunEnd` writes nothing; report that below.
}

let changed = false;
let samples = 0;
try {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  changed = Boolean(state.changed);
  samples = Number(state.samples ?? 0);
} catch {
  // Missing or unreadable state is "nothing to propose", never a crash.
}

// A session that measured fewer runs than it asked for proposes *nothing*: an
// aggregate over fewer samples is a weaker claim, and posting a thinner one would
// be the flake this whole step exists to remove. Fail closed.
if (changed && samples < runs) {
  console.error(
    `collect:propose: only ${samples} of ${runs} runs left a sample — ` +
      "not proposing a drop the others did not confirm",
  );
}
const earned = changed && samples >= runs;

if (proposal.trim()) {
  if (summaryPath) appendFileSync(summaryPath, `\n${proposal}\n`);
  console.log(proposal);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `earned=${earned ? "true" : "false"}\n`);
}

console.log(
  `\ncollect:propose: ${
    earned ? `changes available, confirmed by ${samples} of ${runs} runs` : "nothing to record"
  } — ${proposal.trim() ? `wrote ${proposalPath}` : "the run wrote no proposal"}`,
);
// Advisory: never the reason a job fails.
process.exit(0);
