#!/usr/bin/env node
/**
 * The whole-tree headroom gate.
 *
 * `.freebuff/coverage-thresholds.mjs` sets the bare numbers — the whole-tree
 * backstop — a point or two under what the tree reaches, so a real regression
 * trips them and a rounding wobble does not. That "a point or two" was a promise
 * the config could not keep: nothing stopped the gap from being spent a tenth at
 * a time, by a file here and an untested branch there, until the backstop sat a
 * hair above the tree and the next change of any size turned the suite red for a
 * reason no one could name.
 *
 * So this script makes the gap the gate. It is the third and last half of
 * `npm run test:coverage`, after the per-file floor, and it fails when the
 * whole-tree aggregate clears its backstop by **less than a point** on any
 * metric. The effect is a ratchet that tightens without anyone editing a number:
 * the enforcement line is a point above the configured one, and it rises on its
 * own as the tree improves, while the thresholds stay legible and rarely
 * touched. The margin the gate keeps is exactly the margin the backstop's own
 * doc comment describes, so the two cannot disagree about how much slack there
 * is.
 *
 * It computes the aggregate through `.freebuff/coverage-scopes.mjs`, the same
 * module the report's whole-tree row reads, so a `⚠` on that row in
 * `coverage-report.mjs` and a red build here are the same event.
 *
 * Usage:
 *   node .freebuff/coverage-headroom.mjs                  # the gate, from .coverage/
 *   node .freebuff/coverage-headroom.mjs --minimum 0.5    # a smaller cushion
 *   node .freebuff/coverage-headroom.mjs --summary path   # against another report
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BACKSTOP,
  HEADROOM_TARGET,
  METRICS,
  aggregate,
  argValue,
  signed,
} from "./coverage-scopes.mjs";

/** The report `vitest run --coverage` writes, relative to the project root. */
const DEFAULT_SUMMARY = ".coverage/coverage-summary.json";

/**
 * The cushion the whole-tree aggregate must keep over its backstop, in points.
 *
 * A margin under a point is where a shared, churning checkout turns a
 * neighbour's untested line into a red build, so the gate trips there rather
 * than waiting for the backstop itself — by the time the configured threshold
 * fails, the failure is a post-mortem instead of a warning. It is read from
 * `.freebuff/coverage-scopes.mjs` rather than written here, so the proposer —
 * which proposes the tightest integer leaving the same margin — cannot be built
 * against a different one.
 */
const DEFAULT_MINIMUM = HEADROOM_TARGET;

const minimumArg = argValue("--minimum");
if (minimumArg !== undefined && !Number.isFinite(Number(minimumArg))) {
  console.error(`coverage-headroom: --minimum must be a number, got ${minimumArg}`);
  process.exit(1);
}
const minimum = minimumArg === undefined ? DEFAULT_MINIMUM : Number(minimumArg);

const summaryPath = resolve(argValue("--summary") ?? DEFAULT_SUMMARY);

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch (error) {
  console.error(
    `coverage-headroom: could not read ${summaryPath}\n` +
      "Run `npm run test:coverage`, which writes this report and then checks it.\n" +
      String(error instanceof Error ? error.message : error),
  );
  process.exit(1);
}

/**
 * The whole-tree metrics: the reporter's own `total` row when it is there —
 * which is what Vitest checks the bare global threshold against — otherwise the
 * per-file counts summed by hand.
 */
const wholeTree = summary.total
  ? aggregate([summary.total])
  : aggregate(
      Object.entries(summary)
        .filter(([file]) => file !== "total")
        .map(([, metrics]) => metrics),
    );

const checked = METRICS.filter((metric) => typeof BACKSTOP[metric] === "number");
const failures = [];
for (const metric of checked) {
  const pct = wholeTree[metric]?.pct;
  if (typeof pct !== "number") continue;
  const floor = BACKSTOP[metric];
  const headroom = pct - floor;
  if (headroom < minimum) failures.push({ metric, pct, floor, headroom });
}

if (failures.length > 0) {
  const width = String(
    Math.max(...failures.map((failure) => failure.pct.toFixed(2).length)),
  ).length;
  console.error(
    `coverage-headroom: whole-tree margin under ${minimum} point(s)\n` +
      failures
        .sort((a, b) => a.headroom - b.headroom)
        .map(
          (failure) =>
            `  ${failure.pct.toFixed(2).padStart(width)}%  ` +
            `${signed(failure.headroom)} over ${String(failure.floor).padStart(3)}%  ` +
            `${failure.metric}`,
        )
        .join("\n") +
      "\nCover the area, or lower the backstop in `.freebuff/coverage-thresholds.mjs` " +
      "deliberately — a header under a point is a red build made of noise.",
  );
  process.exit(1);
}

const margins = checked.map((metric) => ({ metric, headroom: wholeTree[metric].pct - BACKSTOP[metric] }));
const tightest = margins.reduce((worst, row) => (row.headroom < worst.headroom ? row : worst));
const widest = margins.reduce((best, row) => (row.headroom > best.headroom ? row : best));
console.log(
  `coverage-headroom: whole tree clears its backstop by ${signed(tightest.headroom)} to ` +
    `${signed(widest.headroom)} points (tightest ${tightest.metric}: ` +
    `${wholeTree[tightest.metric].pct.toFixed(2)}% vs ${BACKSTOP[tightest.metric]}%); ` +
    `minimum ${minimum.toFixed(2)}.`,
);
