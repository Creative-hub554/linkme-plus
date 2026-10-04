#!/usr/bin/env node
/**
 * Fails a job when a comment step that ran did not post its comment.
 *
 *   node .freebuff/comment-gate.mjs \
 *     "Collect-budget summary comment=${{ steps.comment-summary.outcome }}" \
 *     "Coverage-proposal comment=${{ steps.comment-coverage.outcome }}"
 *
 * Every comment step is `continue-on-error: true`, and that is deliberate: a comment that
 * could not be posted must not stop the drift check, the coverage-mutation check or the
 * artifact uploads that follow it. The price of the choice is that a failed comment step
 * left the job green, and the run page's `❌ nothing to post` note was then the only sign
 * anything was wrong — a note on a page a green check sends nobody to read. So the poster's
 * exit code became the one answer this gate needs (`0` when the comment is on the pull
 * request, non-zero when it is not) and this reads it back per step from
 * `steps.<id>.outcome`, which is what the step *did* rather than what `continue-on-error`
 * let the job make of it.
 *
 * Two outcomes pass, and the difference between them is why this takes a list rather than a
 * count: `success` is a posted comment, and `skipped` is a step that was never owed one — a
 * fork's pull request, whose token cannot comment; a push with no pull request; a proposal
 * the proposer did not earn. `failure` and `cancelled` are comments this run owed and did not
 * post, and each is named on the run page and in an `::error` annotation, so the page a
 * reviewer reads and the verdict that failed the job say the same thing.
 *
 * The label each entry carries must be the `--label` that step passed to the poster: the two
 * notes on the run page then sit under the same name, and `src/test/collect-budget.test.ts`
 * holds them together, because a gate that named a step differently from its own comment
 * would send a reader looking for a comment nobody posted.
 *
 * Exit codes: 0 when every step is accounted for, 1 when one of them owed a comment that did
 * not arrive, and 2 on an invocation it will not act on — no entries at all, an entry that is
 * not `<label>=<outcome>`, or an outcome word Actions cannot produce. That last one is the
 * refusal that matters: an outcome this does not recognize would otherwise read as a pass,
 * which is the one failure mode a gate must not have.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const USAGE = 'usage: comment-gate.mjs "<label>=<outcome>" [<label>=<outcome> ...]';

/** The four words a step's `outcome` can hold, split by what each means for this gate. */
const PASSING = ["success", "skipped"];
const FAILING = ["failure", "cancelled"];

/** The run page is told about a failed job here, in the same place the poster's notes go. */
const ENV = { summary: "GITHUB_STEP_SUMMARY" };

/** An invocation this will not act on: refused out loud rather than read as a pass. */
export class UsageError extends Error {}

/**
 * The entries, as `{ label, outcome }`, or a `UsageError` naming the first thing wrong.
 *
 * The label is everything before the **last** `=`: a label may carry any punctuation its
 * step's `--label` does, and the outcome is always the last word, so splitting from the
 * right is what keeps a label containing `=` from quietly becoming part of the value.
 *
 * @param {string[]} argv
 * @returns {{ label: string, outcome: string }[]}
 */
export function parseEntries(argv) {
  if (argv.length === 0) {
    throw new UsageError("at least one <label>=<outcome> is required");
  }
  return argv.map((token) => {
    const equals = token.lastIndexOf("=");
    const label = equals === -1 ? "" : token.slice(0, equals);
    const outcome = equals === -1 ? "" : token.slice(equals + 1);
    if (label === "") {
      throw new UsageError(`'${token}' needs a label — write '<label>=<outcome>'`);
    }
    if (!PASSING.includes(outcome) && !FAILING.includes(outcome)) {
      throw new UsageError(
        `'${token}' names an outcome Actions does not produce — expected one of ` +
          `${[...PASSING, ...FAILING].join(", ")}`,
      );
    }
    return { label, outcome };
  });
}

/**
 * The entries that mean this run owed a comment and did not post it.
 *
 * A `skipped` step is not one of them, and that is the whole of the judgment this gate makes:
 * whether the step ran is a fact about the run, and whether it owed a comment is the workflow
 * author's decision, expressed in that step's `if:`.
 *
 * @param {{ label: string, outcome: string }[]} entries
 */
export function unposted(entries) {
  return entries.filter((entry) => FAILING.includes(entry.outcome));
}

/** Why this entry failed, in the words the run page reads. */
function explain(outcome) {
  return outcome === "cancelled"
    ? "the step was cancelled before it could post"
    : "the step ran and no comment was posted — its own note above, or its log, says why";
}

/**
 * What the run page says when the job fails for one of these.
 *
 * The poster wrote the *diagnosis* (`❌ nothing to post`, `❌ the comment was not posted`);
 * what it could not write is the consequence, because no one step knows it — a comment step
 * is allowed to fail on its own. So this says the consequence and points back at those notes
 * rather than repeating them, which is also why the labels have to match.
 *
 * @param {{ label: string, outcome: string }[]} lost
 */
export function gateAnnouncement(lost) {
  return [
    "",
    "## Comments — ❌ a comment this run owed was not posted",
    "",
    ...lost.map((entry) => `- **${entry.label}** — ${explain(entry.outcome)}.`),
    "",
    "The comment steps are `continue-on-error` so that one failing cannot stop the gates",
    "that follow it; this is the step that turns that into a red job.",
    "",
  ].join("\n");
}

/**
 * `0` when every step is accounted for, `1` when one owed a comment that did not arrive.
 *
 * @param {string[]} argv
 */
function main(argv) {
  const entries = parseEntries(argv);
  const lost = unposted(entries);
  if (lost.length === 0) {
    const skipped = entries.filter((entry) => entry.outcome === "skipped").length;
    console.log(
      `comment-gate: every step that owed a comment posted one ` +
        `(${entries.length - skipped} of ${entries.length}; ${skipped} not owed).`,
    );
    return 0;
  }
  for (const entry of lost) {
    // The annotation is what a reviewer sees in the checks list, where the step's own red
    // mark sits beside a job that is otherwise green; the line under it is for the log.
    console.error(
      `::error title=${entry.label}::no comment was posted and this run owed one ` +
        `(the step's outcome is ${entry.outcome})`,
    );
    console.error(`comment-gate: ${entry.label} — ${explain(entry.outcome)}`);
  }
  const summary = process.env[ENV.summary];
  if (summary) appendFileSync(summary, gateAnnouncement(lost));
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`comment-gate: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 2;
  }
}
