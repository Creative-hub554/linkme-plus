#!/usr/bin/env node
/**
 * The collect-budget gates, published in the CI run summary.
 *
 * `.freebuff/coverage-report.mjs` answers "how much room is left before the
 * coverage gate trips?"; this answers the sibling question for the *other* gate
 * the suite carries. A test file's collect time, and the import cost of the shared
 * scanners every convention guard reads through, are checked on every run against
 * values recorded in `.freebuff/collect-budget-baselines.mjs` — and nothing else on
 * the build page says what those values currently are. So a hit of the hard gate
 * reads as a surprise, and a quiet tightening reads as nothing at all. The fix is
 * to publish them beside the coverage table, in the same job summary.
 *
 * Two sources, deliberately: the recorded values come straight from the baselines
 * file — the very one the gate itself imports — so the displayed number cannot
 * disagree with the enforced one; and this run's measurements come from the
 * reporter's run report, which is the only place a real measurement exists
 * (`importDurations` is reachable only from inside Vitest). Reading them together
 * is the point: the gap between what is recorded and what the tree actually pays is
 * what says whether a gate is loose, or whether the tree is closer to its budget
 * than the recorded number suggests — and it is legible on a *green* run, which is
 * the one time nobody is looking at the gate. Both recorded halves get it: the
 * per-module import costs, and the warning band against the tightest file the run
 * saw, so a green run shows the headroom each half still has — and each carries the
 * reporter's verdict, when it found one loose, so the number printed and the check
 * enforced are read off the same page. When no report is
 * there (the script
 * run on its own, or before any suite run in the job) the recorded columns still
 * render, and the row says so rather than showing a blank as if it were zero.
 *
 * Only the collect ceilings and their floors — constants inside
 * `src/test/collect-budget.ts` — are left out: a plain Node script cannot import a
 * TypeScript module, and copying them here to display them is how a displayed number
 * and an enforced one come apart. Everything recorded does come from the source that
 * enforces it, down to the cost each recorded baseline would be called loose past, the
 * headroom at which the band is called stale, and the floor below which it is not
 * judged — all of which the reporter publishes rather than this script restating. The
 * footer says where the rest live.
 *
 * In CI it appends to `$GITHUB_STEP_SUMMARY` — run with `if: always()`, so a red
 * build still publishes the gates it was judged by — and writes
 * `.freebuff/collect-gates.md`, which the workflow uploads beside the coverage
 * report and, on a pull request, posts as a comment that updates in place — which is
 * what the marker the markdown opens with is for.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importBaselines, importMarginMs, softThreshold } from "./collect-budget-baselines.mjs";
import { RUN_REPORT_FILE, parseRunReport } from "./collect-run.mjs";

/**
 * Where the rendered markdown lands, relative to the project root.
 *
 * Exported because the workflow posts this very file as a pull-request comment, and
 * the file it names has to be the one this renderer wrote: two literals that merely
 * happen to match today would let the comment post a stale body — or fail the upload
 * against a file that is not there — with every other assertion still green. The test
 * pins the workflow's `-F body=@…` argument to this constant, and the renderer's test
 * proves the run above really wrote it here.
 */
export const REPORT_PATH = ".freebuff/collect-gates.md";

/**
 * The HTML comment the rendered markdown opens with.
 *
 * The workflow posts the markdown as a pull-request comment and finds its own
 * previous one by this marker, so a run updates that comment in place rather than
 * stacking a new one every time. Exported because the poster and this renderer have
 * to name the same string, and nothing else would notice if one of them moved.
 */
export const SUMMARY_MARKER = "<!-- collect-budget-summary -->";

/** The same footer identity the coverage report prints, so the two read alike. */
function metaLine() {
  const meta = [];
  if (process.env.GITHUB_SHA) meta.push(`\`${process.env.GITHUB_SHA.slice(0, 7)}\``);
  if (process.env.GITHUB_REF_NAME) meta.push(`\`${process.env.GITHUB_REF_NAME}\``);
  if (process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY) {
    meta.push(
      `[run ${process.env.GITHUB_RUN_ID}]` +
        `(https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID})`,
    );
  }
  return meta;
}

/**
 * This run's report, as the reporter left it, or null when there is none.
 *
 * Read by path relative to the working directory, exactly as the reporter writes
 * it. Anything unreadable or malformed is simply "no measurement": the summary is a
 * display, and a display must never be the thing that fails a build.
 */
function readMeasurement() {
  try {
    return parseRunReport(readFileSync(join(".freebuff", RUN_REPORT_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** A fraction of a collect budget, as the percentage a person reads it as. */
function percent(value) {
  return `${Math.round(value * 100)}%`;
}

/** A fraction of a collect budget, as the points a headroom is counted in. */
function points(value) {
  return `${Math.round(value * 100)} pts`;
}

/** A millisecond value, whole when it is one and to a decimal otherwise. */
function ms(value) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}ms`;
}

/** The mark a row carries when the reporter called its gate too loose. */
const LOOSE_MARK = "⚠";

/**
 * The gates the reporter called too loose, keyed `kind|name` so a row can ask.
 *
 * Read from the run report's `stale` list rather than re-deciding here: the verdict
 * is the reporter's, reached from the same measurement these columns print, so the
 * display cannot disagree with the check. Reaching it here would mean copying the
 * clearances out of `src/test/collect-budget.ts`, which is how a displayed rule and
 * an enforced one come apart.
 */
function looseKeys(measurement) {
  const keys = new Set();
  for (const entry of measurement?.stale ?? []) keys.add(`${entry.kind}|${entry.name}`);
  return keys;
}

/** A cell, marked when the reporter called this gate loose against the measurement. */
function verdict(cell, loose) {
  return loose ? `${cell} ${LOOSE_MARK}` : cell;
}

/**
 * The warning band's headroom: the recorded band against this run's tightest file.
 *
 * The band and the tightest file are both fractions of a collect budget, so the gap
 * is in points rather than milliseconds. Signed, like the import rows' `gap`: a
 * positive number is room between the tree and the band — the ratchet could warn
 * earlier — and a negative one is a file already at or past the band, which is what
 * the band exists to flag while the run stays green.
 */
function headroomCell(threshold, tightest) {
  const points = Math.round((threshold - tightest) * 100);
  const magnitude = `${Math.abs(points)} pts`;
  if (points > 0) return `+${magnitude}`;
  if (points < 0) return `-${magnitude}`;
  return magnitude;
}

/**
 * The band's one row: what it is recorded at, what this run's tightest file used, and
 * the headroom the gate calls the band loose past.
 *
 * The last cell is the gate's own boundary, read from the run report rather than
 * recomputed here — the number a reader compares a headroom against is the number the
 * reporter enforces, so this table cannot call a band loose that the gate would not.
 * A run whose tightest file never reached the judged floor is not measured against the
 * band at all, so its cell is the word rather than a boundary it had no chance to
 * cross; the floor is the reporter's, not copied here either.
 */
function bandRows(threshold, tightest, stalePast, judgedFrom, loose) {
  const cells = ["`soft threshold`", percent(threshold)];
  if (tightest !== null) {
    cells.push(percent(tightest));
    cells.push(verdict(headroomCell(threshold, tightest), loose.has("band|softThreshold")));
    cells.push(tightest < judgedFrom ? "not judged" : points(stalePast));
  }
  return [`| ${cells.join(" | ")} |`];
}

/** A measurement against what is recorded: how far the tree pays above the mark. */
function gapCell(cost, recorded) {
  const delta = cost - recorded;
  const magnitude = `${Math.abs(delta).toFixed(1)}ms`;
  if (delta > 0) return `+${magnitude}`;
  if (delta < 0) return `-${magnitude}`;
  return magnitude;
}

/**
 * One table row per tracked scanner: what it costs, what it is held to, and — when
 * this job measured one — the cost its recorded baseline would be called loose past.
 *
 * That last cell is the gate's own threshold, read from the run report rather than
 * recomputed here, so the number a reader compares a baseline against is the one that
 * judged it. It is a function of the *measurement*, which is why the reporter builds
 * it per module instead of publishing the rule for this script to apply.
 */
function importRows(baselines, marginMs, measured, staleAbove, loose) {
  return Object.keys(baselines)
    .sort()
    .map((tracked) => {
      const recorded = baselines[tracked];
      const cells = [`\`${tracked}\``, `${recorded}ms`, `${marginMs}ms`, `${recorded + marginMs}ms`];
      if (measured) {
        const cost = measured[tracked];
        const above = staleAbove[tracked];
        cells.push(cost === undefined ? "—" : `${cost.toFixed(1)}ms`);
        cells.push(
          cost === undefined
            ? "—"
            : verdict(gapCell(cost, recorded), loose.has(`import|${tracked}`)),
        );
        cells.push(above === undefined ? "—" : ms(above));
      }
      return `| ${cells.join(" | ")} |`;
    });
}

/** The section, as the run summary and the artifact both carry it. */
function renderMarkdown(baselines, marginMs, threshold, meta, measurement) {
  // The reporter's verdicts, so each measured number can carry the mark that says
  // the gate it sits beside was found loose against it.
  const loose = looseKeys(measurement);
  return [
    SUMMARY_MARKER,
    "## Collect budget",
    "",
    ...(meta.length > 0 ? [meta.join(" · "), ""] : []),
    "The recorded gates the collect-time reporter enforces on every run, from",
    "`.freebuff/collect-budget-baselines.mjs`. A shared scanner every convention",
    "guard reads through must be imported within its recorded low-water cost plus",
    "the margin; a test file warns once it is past the soft threshold of its own",
    "collect budget, and only fails once it is over the whole of it. Either recorded",
    "value left far above what a run measures — a scanner's cost, or a warning band",
    "sitting high above the tightest file — is reported too, so a gate that has gone",
    "loose is tightened rather than left loose.",
    "",
    measurement
      ? "| tracked import | recorded | + margin | enforced | this run | gap | stale above |"
      : "| tracked import | recorded | + margin | enforced |",
    measurement
      ? "| --- | --: | --: | --: | --: | --: | --: |"
      : "| --- | --: | --: | --: |",
    ...importRows(
      baselines,
      marginMs,
      measurement ? measurement.measured : null,
      measurement ? measurement.importStaleAbove : {},
      loose,
    ),
    "",
    // The other half of the collect gate, in the same shape as the import rows: the
    // recorded warning band beside the file nearest its budget this run. The band is
    // one number, but pairing it here is what puts both halves of the gate on the
    // page on a green run — the imports were the only half with a table before.
    measurement
      ? "| warning band | recorded | this run | headroom | stale past |"
      : "| warning band | recorded |",
    measurement ? "| --- | --: | --: | --: | --: |" : "| --- | --: |",
    ...bandRows(
      threshold,
      measurement ? measurement.tightest : null,
      measurement ? measurement.staleBandHeadroom : 0,
      measurement ? measurement.bandJudgedFrom : 0,
      loose,
    ),
    "",
    ...(measurement
      ? [
          "`this run` is the dearest import this run measured, and `gap` is that",
          "measurement against the recorded low-water mark: a negative gap is a run that",
          "beat the record, so the ratchet has room to tighten the gate further.",
          "",
          "`stale above` is the recorded cost the reporter would call loose against this",
          "run's measurement — a baseline above it has nothing pushing it back down.",
          "",
          "For the warning band, `this run` is the tightest file, as a fraction of its own",
          "collect budget, and `headroom` is how far below the recorded band it sat — a",
          "positive number is room the ratchet could take back by warning earlier.",
          "",
          "`stale past` is the headroom at which the reporter calls the band loose,",
          "published by the gate itself so this table cannot drift from it.",
          "",
          // Only spelled out when a mark is actually on the page: a lone run's finding
          // is a warning the reporter also annotates, and the gate below fails one a
          // repeated session confirmed — this is the same verdict, beside its number.
          ...(loose.size > 0
            ? [
                `${LOOSE_MARK} marks a gate the reporter found looser than this run measured —`,
                "the verdict `npm run collect:stale` fails a repeated session on, shown",
                "beside the number it was reached from.",
                "",
              ]
            : []),
        ]
      : [
          "No run report in this job, so this run's measurements are not shown — the",
          "reporter leaves one on every run it judges, and these columns read it.",
          "",
        ]),
    `**Soft threshold — ${percent(threshold)}.** A test file starts warning at ` +
      `${percent(threshold)} of its own`,
    "collect budget, while still green. Both are ratchets: `npm run collect:record`",
    "lowers a value a run beat and never raises one, so these gates only tighten.",
    "",
    `<sub>recorded by \`npm run collect:record\` · proposed by \`npm run collect:propose\` · ` +
      `applied by \`npm run collect:apply\` · ceilings and floors (the non-recorded half of the ` +
      "gate) in `src/test/collect-budget.ts`</sub>",
  ].join("\n");
}

// Run only as the entry point: importing this module for `SUMMARY_MARKER` (which the
// tests do) must not write the report or touch a step summary, so the imperative half
// waits until this module is the program. Same guard as `gate-drift.mjs`.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const markdown = renderMarkdown(
    importBaselines,
    importMarginMs,
    softThreshold,
    metaLine(),
    readMeasurement(),
  );

  mkdirSync(dirname(resolve(REPORT_PATH)), { recursive: true });
  writeFileSync(REPORT_PATH, `${markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}\n`);
  }
  console.log(markdown);
  console.log(`\ncollect-gates: wrote ${REPORT_PATH}`);
}
