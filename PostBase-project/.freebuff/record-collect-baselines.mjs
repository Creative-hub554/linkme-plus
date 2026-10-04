#!/usr/bin/env node
/**
 * Records the tracked-import baselines, by running the suite once with the
 * collect-budget reporter in record mode.
 *
 *   npm run collect:record
 *
 * The reporter holds the recorded baselines — each tracked scanner's low-water
 * import cost, and the soft threshold the collect-time warning uses — in
 * `.freebuff/collect-budget-baselines.mjs`, and only it can read the import
 * timings: `importDurations` exists on a module's `diagnostic()`, which is out of
 * reach from a test or a standalone script. So the work happens inside a real
 * run, and this is the thin, portable way to ask for it: it sets
 * `COLLECT_BASELINE_RECORD` and starts Vitest, rather than an npm script having
 * to spell a `NAME=value` prefix the way only a POSIX shell understands.
 *
 * The reporter lowers each recorded value to what the run measured and never
 * raises one, so running this after the shared index or the tree's collects get
 * cheaper tightens the gates; it cannot be used to record a regression away.
 *
 * ## The recorded numbers and the hash that describes them, in one command
 *
 * `.freebuff/collect-budget-baselines.mjs` is a *pinned* gate file: `npm run
 * gates:drift` compares its content to the hash recorded in
 * `.freebuff/gate-hashes.mjs`. So a recording run that lowered a number and left
 * the old hash behind would hand whoever commits it a tree that is red on drift
 * for a change they did not make — and the fix would be a second, easy-to-forget
 * command. This one re-pins what it wrote, through the alarm's targeted `repin`:
 * that one file, and never the rest of the tree — a re-pin for what this run wrote
 * does not absorb drift it did not cause. Drift it finds elsewhere is *printed*,
 * naming the files and the command, because a recording run that reported only its
 * own file would read as a tree that is now pinned.
 *
 * The reporter cannot be the one to do it. It *writes* the file, but a reporter
 * error is swallowed by Vitest into a warning that does not fail the run, and this
 * has to be loud; the command that started the run owns the exit code. So the
 * reporter keeps its one job (measure, and lower the numbers in record mode) and
 * this launcher closes the loop. A refusal — the manifest does not pin the
 * baselines, or the baselines are gone from disk — is printed with the command to
 * answer it and exits non-zero; the recorded numbers stay on disk either way,
 * because losing a measurement to fix a hash would be the wrong trade.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rel, repin } from "./gate-drift.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The file the recording run rewrites, as the gate manifest keys it.
const baselineKey = rel(join(root, ".freebuff", "collect-budget-baselines.mjs"));
// Resolve the installed Vitest CLI rather than shelling out to `npx`, so this
// works from any directory and on any platform.
const require = createRequire(import.meta.url);
const vitest = require.resolve("vitest/vitest.mjs");

const run = spawnSync(process.execPath, [vitest, "run"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, COLLECT_BASELINE_RECORD: "1" },
});

if (run.error) {
  console.error(`collect:record: could not start vitest — ${run.error.message}`);
  process.exit(1);
}

// The suite's own verdict, which this command still reports: a recording run that
// failed a test is a failed run, whatever it recorded on the way out.
const status = run.status ?? 1;

// Called whether or not the numbers moved: a re-pin of a file that already matches
// is a no-op, so this does not have to know what the reporter decided to write.
try {
  const { moved, left } = await repin([baselineKey]);
  console.log(
    moved.length === 0
      ? "collect:record: the gate manifest already records the baselines this run wrote."
      : `collect:record: re-pinned ${moved
          .map((row) => `${row.path} (was ${row.from.slice(0, 8)}, now ${row.to.slice(0, 8)})`)
          .join(", ")}.`,
  );
  // Not a failure, and deliberately not an exit code: the drift is somebody else's edit, the
  // recording's own file and hash are consistent, and a nightly run that went red for a
  // half-finished change in another checkout would make this command's verdict depend on it.
  // The check is the thing that fails the tree, and it still reports every one of these.
  if (left.length > 0) {
    console.warn(
      `collect:record: ${left.length} other pinned file(s) do not match the tree ` +
        `(${left.map((row) => row.path).join(", ")}) — left alone, and still reported by ` +
        "`npm run gates:drift`; run `npm run gates:pin` once those changes are yours.",
    );
  }
} catch (error) {
  console.error(
    `collect:record: the gate manifest could not record the baselines — ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  console.error(
    "collect:record: the recorded numbers are on disk; run `npm run gates:pin` and look at why " +
      "before committing them.",
  );
  // Non-zero on purpose: the tree is inconsistent until that is answered, and a
  // command that leaves a red gate behind has not finished its job.
  process.exit(status === 0 ? 1 : status);
}

process.exit(status);
