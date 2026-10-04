#!/usr/bin/env node
/**
 * The coverage report.
 *
 * `vitest run --coverage` writes `.coverage/coverage-summary.json`, and
 * `.freebuff/coverage-floor.mjs` turns it into a pass/fail. Neither of those
 * answers the question a ratchet actually raises: *how much room is left before
 * the gate trips?* A green run and a run that clears every threshold by a tenth
 * of a point look identical in a log — right up until one of them isn't green.
 *
 * So this script reads the same report and publishes the numbers that make the
 * trajectory legible: the whole-tree totals, each directory's aggregate next to
 * the threshold it is held to, and the lowest-covered files, which are what caps
 * how high the per-file floor can go. In CI it writes the markdown to the job
 * summary (via `$GITHUB_STEP_SUMMARY`, run with `if: always()` so a failing gate
 * still publishes) and to `.coverage/coverage-report.md`, which the workflow
 * uploads alongside the raw summary as an artifact — so the next commit can be
 * diffed against this one.
 *
 * The ⚠ on the whole-tree row is not advisory: `.freebuff/coverage-headroom.mjs`
 * fails `npm run test:coverage` for a margin under a point, so the two read the
 * same numbers and a flag here is a red build there.
 *
 * The thresholds come from `.freebuff/coverage-thresholds.mjs` and the aggregate
 * per scope from `.freebuff/coverage-scopes.mjs`, so the headroom column cannot
 * drift from the gate it describes or from the proposal built on the same rows.
 *
 * Usage:
 *   node .freebuff/coverage-report.mjs                       # print, write, append
 *   node .freebuff/coverage-report.mjs --summary path        # another report
 *   node .freebuff/coverage-report.mjs --compare path        # add Δ vs an older summary
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HEADROOM_TARGET, METRICS, argValue, filesOf, scopesOf, signed } from "./coverage-scopes.mjs";

/** The report `vitest run --coverage` writes, relative to the project root. */
const DEFAULT_SUMMARY = ".coverage/coverage-summary.json";

/** Where the rendered markdown lands, relative to the project root. */
const REPORT_PATH = ".coverage/coverage-report.md";

/** How many of the weakest files to list — the floor's binding constraints. */
const WEAKEST_SHOWN = 8;

function readSummary(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(
      `coverage-report: could not read ${path}\n` +
        "Run `npm run test:coverage`, which writes this report.\n" +
        String(error instanceof Error ? error.message : error),
    );
    process.exit(1);
  }
}

/** One table cell: the percentage, and its headroom over the floor. */
function cell(metrics, floors, metric) {
  const pct = metrics[metric]?.pct;
  if (typeof pct !== "number") return "—";
  const floor = floors?.[metric];
  if (typeof floor !== "number") return `${pct.toFixed(2)}%`;
  const headroom = pct - floor;
  // A margin under a point is the interesting case: it is where a shared,
  // churning checkout turns a neighbour's untested line into a red build — and on
  // the whole-tree row the flag is a failing gate, not a warning. The point is
  // `HEADROOM_TARGET`, shared with the gate that fails on it and the proposer
  // that respects it, so the flag and the red build are the same event.
  const mark = headroom < HEADROOM_TARGET ? " ⚠" : "";
  return `${pct.toFixed(2)}% (${signed(headroom)})${mark}`;
}

function renderTable(rows, compare) {
  const header = [
    ...(compare ? ["Δ lines"] : []),
    "scope",
    "files",
    ...METRICS,
  ];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map((name) => (name === "scope" ? "---" : "--:")).join(" | ")} |`,
  ];
  for (const row of rows) {
    const delta = compare
      ? signed(compare.get(row.label) === undefined ? undefined : row.metrics.lines.pct - compare.get(row.label))
      : undefined;
    lines.push(
      `| ${[
        ...(compare ? [delta] : []),
        row.label,
        String(row.files),
        ...METRICS.map((metric) => cell(row.metrics, row.floors, metric)),
      ].join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

function renderWeakest(files) {
  const weakest = [...files]
    .sort((a, b) => (a.metrics.lines?.pct ?? 0) - (b.metrics.lines?.pct ?? 0))
    .slice(0, WEAKEST_SHOWN);
  return [
    "| file | lines | statements |",
    "| --- | --: | --: |",
    ...weakest.map(
      (file) =>
        `| \`${file.rel}\` | ${file.metrics.lines?.pct?.toFixed(2) ?? "—"}% | ` +
        `${file.metrics.statements?.pct?.toFixed(2) ?? "—"}% |`,
    ),
  ].join("\n");
}

const summaryPath = resolve(argValue("--summary") ?? DEFAULT_SUMMARY);
const summary = readSummary(summaryPath);
const files = filesOf(summary);
const rows = scopesOf(summary);

// An optional comparison against an older summary — the previous commit's
// `coverage-summary.json`, which the workflow keeps as an artifact — so the
// trajectory is a number rather than a memory.
const compareArg = argValue("--compare");
let compare;
if (compareArg) {
  const previous = readSummary(resolve(compareArg));
  compare = new Map(scopesOf(previous).map((row) => [row.label, row.metrics.lines.pct]));
}

const meta = [];
if (process.env.GITHUB_SHA) meta.push(`\`${process.env.GITHUB_SHA.slice(0, 7)}\``);
if (process.env.GITHUB_REF_NAME) meta.push(`\`${process.env.GITHUB_REF_NAME}\``);
if (process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY) {
  meta.push(
    `[run ${process.env.GITHUB_RUN_ID}]` +
      `(https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})`,
  );
}

const markdown = [
  "## Coverage",
  "",
  ...(meta.length > 0 ? [`${meta.join(" · ")}`, ""] : []),
  "Each metric cell is the aggregate percentage for that scope, with its headroom",
  "over the threshold that scope is held to. ⚠ marks a margin under one point.",
  "",
  renderTable(rows, compare),
  "",
  "**Weakest files** — what caps the per-file floor, and what to cover next to",
  "raise it:",
  "",
  renderWeakest(files),
  "",
  `<sub>${files.length} measured files · \`${REPORT_PATH}\` · thresholds from ` +
    "`.freebuff/coverage-thresholds.mjs` · floors from `.freebuff/coverage-floor.mjs` · " +
    "whole-tree headroom gate from `.freebuff/coverage-headroom.mjs`</sub>",
].join("\n");

writeFileSync(REPORT_PATH, `${markdown}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}\n`);
}
console.log(markdown);
console.log(`\ncoverage-report: wrote ${REPORT_PATH}`);
