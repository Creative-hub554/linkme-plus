#!/usr/bin/env node
/**
 * Proposed threshold raises, from a pull request's measured coverage.
 *
 * The gates in this directory keep the ratchet from slipping; none of them turn
 * the screw. A PR that lifts `src/lib/**` by a point and a half leaves that row's
 * threshold where it was, so the slack the headroom gate exists to bound grows
 * quietly with every good change — the one direction a ratchet is supposed to
 * move is up.
 *
 * This script closes that loop. Given the PR's `.coverage/coverage-summary.json`
 * and, from CI, the base branch's uploaded `coverage-report` artifact, it reports
 * the delta per scope and computes the tightest integer each threshold could be
 * held to while still leaving the headroom `.freebuff/coverage-headroom.mjs`
 * enforces — `floor(measured - target)`, which is exactly the boundary the gate
 * checks. Rows that would not actually move are left out; what remains is a
 * proposal to paste into `.freebuff/coverage-thresholds.mjs`.
 *
 * It proposes rather than applies. Raising a threshold is a decision about how
 * much noise the suite can absorb, so the numbers land as a sticky comment on
 * the PR (and in the job summary, for fork PRs whose token cannot comment) and a
 * person makes the edit. It exits 0 even when it proposes nothing: it is advice,
 * not a gate.
 *
 * The comment is left only when **this change is what earned** a raise — a row
 * that actually moved up against the baseline — so a PR that touches no coverage
 * does not collect one. Slack that was already there is still listed, marked as
 * not this PR's, because hiding it would defeat the point of publishing the
 * proposal at all.
 *
 * The scopes and their aggregates come from `.freebuff/coverage-scopes.mjs`, the
 * same rows the report publishes and the gate checks, so a proposal cannot claim
 * a number the gate would not agree with.
 *
 * Usage:
 *   node .freebuff/coverage-propose.mjs --baseline baseline/coverage-summary.json
 *   node .freebuff/coverage-propose.mjs --baseline path --baseline-label main
 *   node .freebuff/coverage-propose.mjs --target 1.5 --summary path --output path
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HEADROOM_TARGET, METRICS, argValue, scopesOf, signed } from "./coverage-scopes.mjs";

/** The report `vitest run --coverage` writes, relative to the project root. */
const DEFAULT_SUMMARY = ".coverage/coverage-summary.json";

/** Where the proposal markdown lands, relative to the project root. */
const PROPOSAL_PATH = ".coverage/coverage-proposal.md";

/**
 * The first line of the proposal, and the way a later run finds the comment to
 * update instead of posting a second one. It must stay byte-identical to the
 * marker the workflow greps for.
 */
const MARKER = "<!-- coverage-threshold-proposal -->";

/**
 * The headroom a proposed threshold must leave, in points — read from
 * `.freebuff/coverage-scopes.mjs`, the same constant `.freebuff/coverage-headroom.mjs`
 * gates on, so a proposal is always a number the gate would pass.
 */
const DEFAULT_TARGET = HEADROOM_TARGET;

/** How many of the tightest rows to name when there is nothing to propose. */
const CONTEXT_ROWS = 3;

function readSummary(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(
      `${label}: could not read ${path}\n` +
        "Run `npm run test:coverage`, which writes this report.\n" +
        String(error instanceof Error ? error.message : error),
    );
    process.exit(1);
  }
}

const targetArg = argValue("--target");
if (targetArg !== undefined && !Number.isFinite(Number(targetArg))) {
  console.error(`coverage-propose: --target must be a number, got ${targetArg}`);
  process.exit(1);
}
const target = targetArg === undefined ? DEFAULT_TARGET : Number(targetArg);

const summaryPath = resolve(argValue("--summary") ?? DEFAULT_SUMMARY);
const summary = readSummary(summaryPath, "coverage-propose");

// A baseline is optional: without one the proposal is still computable, just
// without a Δ column to explain it. A baseline the caller *named* but that
// cannot be read is worth saying out loud — it usually means the artifact
// download step failed — but it is not worth failing the run over.
const baselineArg = argValue("--baseline");
let baseline;
if (baselineArg) {
  try {
    baseline = JSON.parse(readFileSync(resolve(baselineArg), "utf8"));
  } catch (error) {
    console.error(
      `coverage-propose: ignoring the baseline at ${baselineArg} — ` +
        String(error instanceof Error ? error.message : error),
    );
  }
}
const baselineLabel = argValue("--baseline-label");

const scopes = scopesOf(summary);
const baselineMetrics = baseline
  ? new Map(scopesOf(baseline).map((row) => [row.label, row.metrics]))
  : null;

/**
 * One row per scope and metric that has both a threshold and a measured number.
 * `proposed` is the tightest integer the scope could be held to and still clear
 * the target headroom — `Math.floor`, because a threshold is an integer and
 * rounding up would spend the last fraction of the margin the gate needs.
 */
const cells = [];
for (const row of scopes) {
  // The "no glob" row has no threshold to raise.
  if (!row.floors) continue;
  // A glob that matched no measured files aggregates to 100% by construction
  // (see `aggregate`), which is a display convention rather than evidence:
  // proposing a raise from it would be proposing a number nothing measured.
  if (row.files === 0) continue;
  for (const metric of METRICS) {
    const floor = row.floors[metric];
    const pct = row.metrics[metric]?.pct;
    if (typeof floor !== "number" || typeof pct !== "number") continue;
    const basePct = baselineMetrics?.get(row.label)?.[metric]?.pct;
    const proposed = Math.floor(pct - target);
    cells.push({
      row,
      metric,
      floor,
      pct,
      basePct,
      proposed,
      raise: proposed - floor,
      headroom: pct - floor,
    });
  }
}

const raises = cells.filter((cell) => cell.raise >= 1);

/**
 * The raises this change earned: a row it moved up. Without a baseline there is
 * nothing to compare against, so every available raise counts — the proposal is
 * the point, and only the workflow's decision to comment depends on this.
 */
const earned = baseline
  ? raises.filter((cell) => cell.basePct !== undefined && cell.pct > cell.basePct)
  : raises;

/** The scopes whose threshold should move, with the value each metric would take. */
const changed = [];
for (const row of scopes) {
  if (!row.floors) continue;
  const next = {};
  let moved = false;
  for (const cell of cells.filter((candidate) => candidate.row === row)) {
    next[cell.metric] = cell.raise >= 1 ? cell.proposed : cell.floor;
    if (cell.raise >= 1) moved = true;
  }
  if (moved) changed.push({ row, next });
}

/** A percentage, or "—" when the number is not available. */
function pct(value) {
  return value === undefined ? "—" : `${value.toFixed(2)}%`;
}

function renderRaises() {
  const header = "| scope | metric | baseline | this PR | Δ | threshold | proposed |";
  const divider = "| --- | --- | --: | --: | --: | --: | --: |";
  const rows = raises.map(
    (cell) =>
      `| ${cell.row.label} | ${cell.metric} | ${pct(cell.basePct)} | ${pct(cell.pct)} | ` +
      `${signed(cell.basePct === undefined ? undefined : cell.pct - cell.basePct)} | ` +
      `${cell.floor} | ${cell.proposed} (+${cell.raise}) |`,
  );
  return [header, divider, ...rows].join("\n");
}

/**
 * The change as it would appear in `.freebuff/coverage-thresholds.mjs`: the bare
 * backstop as its own keys, every directory row as its object literal, each with
 * the proposed value where it moved and the current one where it did not.
 */
function renderSnippet() {
  const lines = [];
  for (const { row, next } of changed) {
    const values = METRICS.map((metric) => `${metric}: ${next[metric]}`);
    if (row.kind === "backstop") {
      lines.push("  // Whole-tree backstop.");
      lines.push(...values.map((value) => `  ${value},`));
    } else {
      lines.push(`  "${row.key}": { ${values.join(", ")} },`);
    }
  }
  return ["```js", ...lines, "```"].join("\n");
}

function renderTightest() {
  const tightest = [...cells].sort((a, b) => a.headroom - b.headroom).slice(0, CONTEXT_ROWS);
  return tightest
    .map(
      (cell) =>
        `\`${cell.row.label.replaceAll("`", "")}\` ${cell.metric} ` +
        `${pct(cell.pct)} vs ${cell.floor}% (${signed(cell.headroom)})`,
    )
    .join(" · ");
}

const comparison = baseline
  ? `Compared against ${baselineLabel ? `\`${baselineLabel}\`` : "the baseline summary"}'s ` +
    "coverage artifact."
  : "No baseline artifact was found, so the Δ column is empty.";
const targetLabel = `${target.toFixed(1)} point${target === 1 ? "" : "s"}`;

const markdown = [
  MARKER,
  "## Proposed coverage thresholds",
  "",
  `${comparison} Each proposed number is the tightest integer that still leaves the`,
  `${targetLabel} of headroom \`.freebuff/coverage-headroom.mjs\` gates on, so none of`,
  "them would weaken a gate. Propose, don't apply: a threshold is a decision about",
  "how much noise the suite can absorb.",
  "",
  ...(raises.length > 0
    ? [
        `**${raises.length} raise${raises.length === 1 ? "" : "s"} available:**`,
        "",
        renderRaises(),
        "",
        ...(earned.length < raises.length
          ? [
              `${raises.length - earned.length} of them are slack this change did not`,
              "create — those rows would have been raisable on the base branch too.",
              "",
            ]
          : []),
        "Suggested values, to paste over the matching lines in",
        "`.freebuff/coverage-thresholds.mjs`:",
        "",
        renderSnippet(),
      ]
    : [
        `Nothing to raise: no scope is more than ${targetLabel} above its threshold.`,
      ]),
  "",
  `Tightest rows right now: ${renderTightest()}.`,
  "",
  "<sub>proposed by `.freebuff/coverage-propose.mjs` · scopes and thresholds from " +
    "`.freebuff/coverage-scopes.mjs` and `.freebuff/coverage-thresholds.mjs`</sub>",
].join("\n");

const outputPath = resolve(argValue("--output") ?? PROPOSAL_PATH);
writeFileSync(outputPath, `${markdown}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}\n`);
}
// The workflow reads this to decide whether the pull request is worth a comment.
// It is `earned`, not `raises`: a change that moved no coverage should not leave
// a comment behind even when the tree has slack to spare.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `earned=${earned.length > 0 ? "true" : "false"}\n`);
}

console.log(markdown);
console.log(
  `\ncoverage-propose: ${raises.length} raise(s) available, ` +
    `${earned.length} earned by this change, wrote ${outputPath}`,
);
