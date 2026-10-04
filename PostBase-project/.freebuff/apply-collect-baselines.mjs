#!/usr/bin/env node
/**
 * Applies an approved collect-budget proposal to the checked-in baselines file.
 *
 *   npm run collect:apply -- --body-file proposal.md
 *
 * The second half of the ratchet's pull-request story. `collect:propose` leaves a
 * Markdown proposal — and a hidden payload of the exact values the run earned —
 * on the pull request; a reviewer replies with the apply command; the
 * `collect-apply` workflow hands this script that comment and turns a change into
 * a follow-up pull request.
 *
 * It applies the *payload* rather than re-measuring. A second run on another
 * machine would produce different numbers, and the reviewer approved the ones
 * they were shown; re-measuring would quietly substitute a different tightening
 * for the approved one. The payload also makes the step cheap: it touches no test,
 * so this job needs no dependencies at all.
 *
 * ## The write is two files, not one
 *
 * `.freebuff/collect-budget-baselines.mjs` is a *pinned* gate file — the drift alarm
 * compares its content to the hash recorded in `.freebuff/gate-hashes.mjs` — so a commit
 * that rewrites it without the matching hash lands a tree whose pin no longer describes it,
 * and every branch carrying that commit is red on drift until somebody re-pins by hand.
 * The pin is right to demand that; this script is what has to meet it. So the baselines are
 * written and then re-pinned through the alarm's own targeted `repin`, which refreshes the
 * hash of *that file only* and refuses if the manifest cannot record it (it does not pin the
 * file, or it is gone from disk). Any *other* pinned file that does not match the tree is
 * reported rather than refused, and absorbing it is not on the table: a targeted re-pin
 * leaves those entries holding the hash the manifest already had, so the job's own
 * whole-tree check — the `verify` step, which gates the commit — still reports them. That is
 * why the drift is *named* in the summary below instead of being allowed to change this
 * script's answer: `applied` is a statement about two files, and the step that asks about
 * the whole tree is the one that decides whether a pull request opens.
 *
 * A refusal of the baselines themselves still puts them back, so the two files move together
 * or neither does, and the workflow commits both.
 *
 * Everything that can be wrong is left in the comment or on disk rather than in
 * an exit code, because the workflow has to reply to the reviewer either way:
 *
 *   - `applied`    — the file was rewritten and a pull request should follow;
 *   - `unchanged`  — the payload is already what the file holds (a second
 *                    approval of the same proposal, or one already merged);
 *   - `no-payload` — the comment carried no proposal to apply;
 *   - `refused`    — the payload would have *raised* a value, which is never
 *                    applied; the reason is printed for the reply;
 *   - `drift`      — the values were applicable, but the pin could not record *the
 *                    baselines*, so nothing was written: a person has to run
 *                    `npm run gates:pin` and look at why. Drift in other files is
 *                    not this case — this script does not own it, does not absorb
 *                    it, and names it instead.
 *
 * Exits 0 for all five. The decision to commit and open a pull request belongs to
 * the workflow, which reads `changed` out of `$GITHUB_OUTPUT`.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyProposal, parseProposalState, renderBaselines } from "./collect-apply.mjs";
import { importBaselines, importMarginMs, softThreshold } from "./collect-budget-baselines.mjs";
import { rel, repin } from "./gate-drift.mjs";
// The save a baselines change is allowed to take: this applier is the only writer of a file a
// gate exports its numbers from, so a truncated write here is a gate with half a threshold.
import { saveWholeScript } from "./whole-write.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const baselineFile = join(here, "collect-budget-baselines.mjs");
const pullRequestBodyFile = join(here, "collect-apply-pr.md");
/** The baselines as the gate manifest keys them. */
const baselineKey = rel(baselineFile);

/** The committed baselines, as the file holds them. */
const committed = { importMarginMs, softThreshold, importBaselines };

/**
 * The proposal comment's body: `--body-file <path>` (the workflow's way, since a
 * comment can hold newlines and quotes that an argument list mangles), `--body
 * <text>` for a quick one, or `$COLLECT_PROPOSAL_BODY`.
 */
function readBody() {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--body-file");
  if (flag !== -1) {
    const path = args[flag + 1];
    if (!path) throw new Error("--body-file needs a path");
    return readFileSync(path, "utf8");
  }
  const inline = args.indexOf("--body");
  if (inline !== -1) return args[inline + 1] ?? "";
  return process.env.COLLECT_PROPOSAL_BODY ?? "";
}

/** The lowering table the follow-up pull request describes. */
function dropLines(before, after) {
  const lines = [];
  if (after.softThreshold !== before.softThreshold) {
    lines.push(`| \`softThreshold\` | ${before.softThreshold} | ${after.softThreshold} |`);
  }
  for (const tracked of Object.keys(after.importBaselines).sort()) {
    const was = before.importBaselines[tracked];
    const now = after.importBaselines[tracked];
    if (was !== now) lines.push(`| \`${tracked}\` | ${was ?? "—"} | ${now} |`);
  }
  return lines;
}

/** The follow-up pull request's body, or the reply when there is nothing to open. */
function renderPullRequestBody(status, before, after) {
  if (status !== "applied") return "";
  const rows = dropLines(before, after).join("\n");
  return (
    "Opened by the `collect-apply` workflow from an approved collect-budget " +
    "proposal comment.\n\n" +
    "It applies **exactly** the values that run measured — the payload the proposal " +
    "carried — and only ever lowers them, so merging it can tighten the gate but " +
    "never loosen it. Nothing here was re-measured, so the numbers are the ones " +
    "that were reviewed.\n\n" +
    "It also re-pins `.freebuff/collect-budget-baselines.mjs` in `.freebuff/gate-hashes.mjs`, " +
    "because the baselines are a pinned gate file: the drift alarm compares their content to " +
    "a recorded hash, and a commit that rewrote them without it would leave every branch " +
    "carrying this one red until somebody re-pinned by hand. Two files, one commit, and the " +
    "hash covers exactly what the commit wrote and nothing else.\n\n" +
    "| value | committed | applied |\n| --- | --: | --: |\n" +
    `${rows}\n\n` +
    "Merge after the pull request that earned these numbers; the baseline describes " +
    "that tree, not `main`'s current one.\n"
  );
}

const body = readBody();
const proposed = parseProposalState(body);

let status;
let changed = false;
let baselines = committed;
let detail = "";

if (!proposed) {
  status = "no-payload";
  detail = "This comment carries no collect-budget proposal payload to apply.";
} else {
  try {
    const result = applyProposal(committed, proposed);
    changed = result.changed;
    baselines = result.baselines;
    status = changed ? "applied" : "unchanged";
    detail = changed
      ? "The baselines file was updated; a follow-up pull request should follow."
      : "The baselines already sit at or below the proposed values — nothing to change.";
  } catch (error) {
    status = "refused";
    detail = `Refused: ${error.message}. A proposal may only tighten a gate.`;
  }
}

if (changed) {
  try {
    saveWholeScript(baselineFile, renderBaselines(baselines));
  } catch (error) {
    // The renderer produced text that does not balance, and the guard refused to land it —
    // so nothing was written and the pinned file still holds the numbers it was checked in
    // with. Reported as `refused`, the status this script already uses for a proposal it
    // would not apply, because a half-written baselines file is a refusal of the same kind.
    changed = false;
    status = "refused";
    detail = `Refused: ${error.message}`;
  }
}
if (changed) {
  try {
    const { left } = await repin([baselineKey]);
    // Named, not swallowed: the follow-up pull request is gated on the job's own whole-tree
    // drift check, so a reader who sees `applied` here and nothing else would be told a pull
    // request is coming when the next step is about to refuse it.
    if (left.length > 0) {
      detail +=
        ` ${left.length} other pinned file(s) also do not match this tree ` +
        `(${left.map((row) => row.path).join(", ")}), which this re-pin left alone — the ` +
        "job's own drift check decides whether the follow-up pull request opens.";
    }
  } catch (error) {
    // Both files or neither: the baselines went back, so the pin that was checked in
    // still describes this tree, and the reviewer is told what to run instead.
    writeFileSync(baselineFile, renderBaselines(committed));
    changed = false;
    status = "drift";
    detail =
      `Refused: ${error instanceof Error ? error.message : String(error)}. ` +
      "The baselines were put back, so the recorded pin still matches this tree.";
  }
}
if (status === "applied") {
  writeFileSync(pullRequestBodyFile, renderPullRequestBody(status, committed, baselines));
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? "true" : "false"}\nstatus=${status}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\n### Collect-budget apply — \`${status}\`\n\n${detail}\n`,
  );
}

console.log(`collect:apply: ${status} — ${detail}`);
if (process.env.COLLECT_APPLY_STDOUT_DETAIL) console.log(detail);
