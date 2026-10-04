import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clearLock, writeLock } from "../../.freebuff/mutation-lock.mjs";
// The save a weakening is allowed to take. It is checked *before* the lock goes down and not
// inside the `try` below, because that `finally` reads the file back and treats an untouched
// file as somebody else's edit; a refusal there would be reported as an interruption.
import { assertWholeScript } from "../../.freebuff/whole-write.mjs";
// The table this check applies, kept in its own module so `mutation-coverage.test.ts` can hold
// its identity from the default suite: a strike deleted from a table shrinks what is swept
// without anything going red, which is the failure that file's ratchet exists for.
import { MUTATIONS } from "./coverage-mutations";

/**
 * The coverage gates' own load-bearingness, checked by mutation.
 *
 * Every gate below was built to be *pinned* by a coverage test — the floor's
 * boundary, the headroom's one-point line, the scope matcher's anchoring, the
 * report's ⚠, the proposer's `earned`. But a pin is only a pin if the test that
 * holds it actually fails when the thing it pins moves. A test file can pass for
 * the wrong reason — asserting nothing, asserting something a sibling branch also
 * satisfies, or reaching always — and nothing in the suite would notice, because
 * a green test looks the same whether it is load-bearing or decorative.
 *
 * So this file is the mutation check turned on the coverage suite itself. For each
 * of the five coverage scripts it applies one deliberate weakening — the exact
 * change a reader would most fear slipping through — runs *that script's own test
 * file* against the weakened source, and requires the run to fail. The mutations
 * are the thin edges the tests were written around: the `<` that makes a file on
 * the floor pass, the `<` that makes exactly-a-point-of-headroom pass, the `^…$`
 * that keeps a glob from matching a partial path, the `<` behind the report's ⚠,
 * and the strict `>` that keeps pre-existing slack from counting as earned.
 *
 * The causal half of the claim is already established: these same test files run,
 * green, as part of this very suite. If one of them passes here — under a
 * weakening, in a fresh process reading the rewritten script — then the mutation
 * survived and the coverage gate it is meant to hold is not actually held. That
 * is the failure this file exists to raise.
 *
 * The scripts are edited in place, one at a time, and each is put back in a
 * `finally` before the next check — the same shape `.freebuff/mutation-guards.mjs`
 * uses, for the same reason: this checkout is shared, and a gate script left
 * weakened is worse than the check it was mutating. The restore is guarded by a
 * hash, so if another session edits the script in the (millisecond) window it is
 * mutated, this refuses to clobber that edit and says so loudly rather than
 * overwriting someone else's work.
 *
 * A `finally` only runs if the process gets to run it. A SIGKILL, a closed terminal
 * or a power cut runs no handler at all, and a weakened gate left on disk is the one
 * outcome worse than the check it was mutating: `<=` refuses a file sitting exactly
 * on the floor, and an unanchored glob hands a threshold files it was never meant to
 * hold. So each case writes a **lock** before it overwrites the script and clears it
 * once the script is back — `.freebuff/.mutation-lock.json`, written through the
 * `writeLock` of `.freebuff/mutation-lock.mjs`, the module that owns that file and its
 * shape and that `.freebuff/mutation-coverage.mjs` recovers from on its next start.
 * The guard sweep holds the same lock, so only one tree-editing check runs at a time —
 * and `src/test/mutation-coverage.test.ts` drives that recovery against a lock written
 * by hand. The one case that is worse than an edit arriving mid-check is an edit that
 * *absorbs* the mutation rather than replacing it: the script then carries the weakened
 * comparison into whoever reads it next. That cannot be seen from here — only the lock's
 * own record of the splice can tell the two apart — so the case below says the mutation
 * may have been absorbed rather than replaced, and the launcher's recovery is what
 * refuses that state (exit 2) rather than warning about it.
 *
 * Because it *does* edit the real scripts, this file runs alone — `npm run
 * mutation:coverage`, which loads `vitest.mutation.config.ts` — rather than inside
 * the default parallel suite. Vitest runs test files concurrently, so a sibling
 * `coverage-*.test.ts` reading a script this one has weakened for its duration
 * would fail on the weakened source, a false alarm arriving exactly as this check
 * was proving the opposite. Isolated, it is the only writer of those scripts while
 * it runs, the way `mutation:guards` is run on its own; the default suite excludes
 * it (see `vitest.config.ts`).
 *
 * The child Vitest run strips `VITEST_*` from its environment and writes its
 * report to a scratch file, so it is an ordinary `vitest run <file>` rather than a
 * process that believes it is nested inside this worker. `--reporter=json` makes
 * the outcome readable per file: the check needs to know the mapped test file
 * *ran real assertions and failed*, not merely that the process exited non-zero
 * (a collection error would exit non-zero too, and would prove nothing about the
 * test's load-bearingness).
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const vitestEntry = path.join(projectRoot, "node_modules", "vitest", "vitest.mjs");

// The mutations themselves live in `src/test/coverage-mutations.ts` — one entry per coverage
// script, each an inequality or a matcher the corresponding test file exists to pin. The
// anchors are the actual source: a drifted anchor fails the case below rather than being
// silently skipped, so renaming a script out from under the table is loud. `MUTATIONS` is
// imported from there, and `src/test/mutation-coverage.test.ts` holds a declared copy of it
// both ways, because a strike deleted from a table is a smaller sweep that still reads green.

/**
 * How long one case may take, and it has to be generous: a case boots a whole Vitest
 * process to run the weakened gate's own test file, which is seconds of work. Vitest's
 * default budget for a case is 5s and a nested boot costs almost all of it — measured at
 * `4856ms` on an idle desktop — so on a machine with anything else on it the case fails
 * as a **timeout** rather than as a verdict, and the report says `STACK_TRACE_ERROR`,
 * which is Vitest's placeholder for exactly that. The number matches the cap the spawn
 * itself carries below, so a child that truly hangs is still cut off rather than waited
 * on, and a slow machine costs seconds instead of a false "the check could not answer".
 */
const CASE_TIMEOUT_MS = 120_000;

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Run one test file in a fresh Vitest process and report what it did.
 *
 * `VITEST_*` is stripped so the child does not inherit this worker's identity, and
 * the JSON report is read back rather than inferred from the exit code — the
 * difference between "the tests failed" and "the file failed to load" is the whole
 * point of the check.
 */
function runTestFile(
  rel: string,
  reportPath: string,
): { status: number; failed: number; total: number } {
  if (existsSync(reportPath)) unlinkSync(reportPath);

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST")) delete env[key];
  }

  const run = spawnSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      rel,
      "--config",
      "vitest.config.ts",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    { cwd: projectRoot, encoding: "utf8", env, timeout: 120_000 },
  );
  if (run.error) throw run.error;

  let failed = 0;
  let total = 0;
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      failed = report.numFailedTests ?? 0;
      total = report.numTotalTests ?? 0;
    } catch {
      // A report that will not parse is treated as a run that said nothing; the
      // assertions below turn that into a clear failure rather than a crash.
    }
  }
  return { status: run.status ?? -1, failed, total };
}

describe("the coverage gates are load-bearing", () => {
  // Sequential within this file (Vitest runs a file's cases in order), so only one
  // script is ever weakened at a time — the guard the shared checkout needs.
  for (const mutation of MUTATIONS) {
    it(`fails ${mutation.test} when ${mutation.script} is weakened`, () => {
      const scriptPath = path.join(projectRoot, mutation.script);
      const original = readFileSync(scriptPath, "utf8");

      const occurrences = original.split(mutation.find).length - 1;
      expect(
        occurrences,
        `The mutation anchor ${JSON.stringify(mutation.find)} occurs ${occurrences} time(s) in ` +
          `${mutation.script}, expected exactly once. The script changed shape — update this ` +
          "mutation so the check still weakens a real comparison.",
      ).toBe(1);

      const mutated = original.replace(mutation.find, mutation.replace);
      expect(
        mutated,
        `The mutation for ${mutation.script} did not change the source; the anchor and its ` +
          "replacement are identical.",
      ).not.toBe(original);

      const dir = mkdtempSync(path.join(tmpdir(), "coverage-mutation-"));
      const reportPath = path.join(dir, "report.json");
      const mutatedHash = hash(mutated);
      // Refused before anything is touched: a weakened gate that does not balance would fail
      // its own test because it cannot be loaded, which reads as the weakening being caught
      // when in fact it was never applied.
      assertWholeScript(mutated, `${mutation.script}  ${mutation.test}`);
      let outcome: { status: number; failed: number; total: number };

      try {
        // The lock goes down before the weakening and comes up once it is back, so a
        // process killed in this window leaves the record the launcher restores from.
        writeLock({
          check: "coverage mutation check",
          path: scriptPath,
          kind: "gate",
          where: mutation.test,
          original,
          mutated,
        });
        writeFileSync(scriptPath, mutated);
        outcome = runTestFile(mutation.test, reportPath);
      } finally {
        const current = readFileSync(scriptPath, "utf8");
        if (hash(current) === mutatedHash) {
          writeFileSync(scriptPath, original);
          if (hash(readFileSync(scriptPath, "utf8")) !== hash(original)) {
            throw new Error(`Could not restore ${mutation.script} after the mutation check.`);
          }
          clearLock();
        } else {
          // Another writer edited the gate while it was weakened. Leaving their
          // edit alone is the lesser evil; failing loudly means the window is not
          // silent, and the lock stays as the record of what this script used to be
          // — the launcher will say so and refuse to clobber it on its next start,
          // and refuse outright if their edit absorbed the mutation instead of
          // replacing it.
          throw new Error(
            `${mutation.script} changed underneath the mutation check, so it was left as the ` +
              "other writer made it, and the lock is left in .freebuff/.mutation-lock.json " +
              "for inspection. The mutation may have been absorbed into the new content " +
              "rather than replaced — inspect it by hand. Re-run to check the gate against " +
              "the current source.",
          );
        }
        rmSync(dir, { recursive: true, force: true });
      }

      // The mutant must fail *because its assertions fail*, not because the file
      // failed to load: a collection error exits non-zero too and would prove
      // nothing about whether the test is load-bearing.
      expect(
        outcome.total,
        `Running ${mutation.test} against the weakened ${mutation.script} collected no tests — ` +
          `the file failed to load rather than failing an assertion. It weakens: ${mutation.why}`,
      ).toBeGreaterThan(0);
      expect(
        outcome.status,
        `Running ${mutation.test} against the weakened ${mutation.script} still passed, so the ` +
          `mutation survived. It weakens: ${mutation.why}`,
      ).not.toBe(0);
      expect(
        outcome.failed,
        `Running ${mutation.test} against the weakened ${mutation.script} reported no failing ` +
          `test, so the mutation survived. It weakens: ${mutation.why}`,
      ).toBeGreaterThan(0);
    }, CASE_TIMEOUT_MS);
  }
});
