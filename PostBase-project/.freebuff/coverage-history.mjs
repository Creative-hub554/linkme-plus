#!/usr/bin/env node
/**
 * The rendered-links guard's coverage readings, accrued one dated row per run.
 *
 * The stamp already has three consumers — the suite's own console line, the
 * runbook bullet the runner's close appends, and the nightly summary's
 * `### Coverage` section — and each of them answers the same question about
 * *one* run: what did the guard audit this time? None of them accumulates.
 * This file is the accumulator: a committed Markdown table the nightly job
 * appends to, so the coverage trend is visible over time rather than one run
 * at a time, and a regression (a link the chrome stopped advertising) reads as
 * a falling column instead of a number nobody remembers.
 *
 * The stamp arrives the way every other consumer gets it: the vitest suite's
 * own close-out writes it to the transient sidecar, the runner folds it into
 * the `--json` report as `coverageStamp`, and the nightly job hands this
 * script the report (`--report .ci/report.json`). A row is recorded for a red
 * run too — the stamp is a reading, not a verdict — but never for a suite that
 * left no stamp: a stubbed or failed suite omits the row rather than
 * fabricating a zero, the same omission the run page and the runbook make.
 *
 * Re-running the same date replaces that date's row rather than duplicating it
 * (a `workflow_dispatch` rerun updates the day it re-ran), and a row identical
 * to the one already there changes nothing — so a rerun over an already-recorded
 * night leaves the file, and the commit that would carry it, untouched.
 *
 * Usage:
 *   node .freebuff/coverage-history.mjs --report .ci/report.json
 *   node .freebuff/coverage-history.mjs --report .ci/report.json --file .freebuff/coverage-history.md
 *   node .freebuff/coverage-history.mjs --stamp "rendered-links coverage: …" --date 2026-10-02
 *
 * `--file` defaults to the committed `.freebuff/coverage-history.md`;
 * `--date` defaults to today, UTC, the same clock the runbook bullet uses.
 *
 * The exit code is 0 when a row was recorded, updated, already present — or
 * when the report carried no stamp, which is a normal night for a suite that
 * failed before it ran, not an error. It is 1 when the input is broken: a
 * report that cannot be read or parsed, a stamp that does not read like one
 * (the prefix guard is the same one the runner's own reader applies), a
 * malformed date, or an invocation naming two sources for one row — a broken
 * record is loud, or the trend it feeds is quietly wrong.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The stamp's one prefix, spelled as the runner's own reader guards it — the
 * `startsWith` in `readRenderedLinksCoverage` that keeps a stray file at the
 * sidecar's path from writing a line of its choosing into the history. The
 * literal is duplicated here rather than imported because `ci.mjs` is the
 * runner whole and is not importable for a constant; `src/test/coverage-history.test.ts`
 * holds the two spellings together, so a changed stamp contract fails there
 * instead of silently forking the vocabulary.
 */
export const STAMP_PREFIX = "rendered-links coverage:";

/** The committed file the nightly job appends to. */
export const HISTORY_FILE = ".freebuff/coverage-history.md";

/** A date column value: exactly a `YYYY-MM-DD`, no clock, no timezone. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A history row: `| 2026-10-02 | rendered-links coverage: … |`. */
const ROW = /^\| (\d{4}-\d{2}-\d{2}) \|/;

/** The table's alignment row, the line a first row is inserted under. */
const ALIGNMENT = /^\| :--/;

/**
 * The file a tree without one starts from: the header explaining where rows
 * come from, and the empty table they land under. The committed file travels
 * with the checkout and accrues rows in commits the nightly job makes; this
 * shape is also what a missing `--file` is built from, so the scaffold is
 * defined once and the test holds the committed file to it.
 */
export function scaffold() {
  return `# Rendered-links coverage history

One dated row per nightly full-gate run, appended by the nightly job (\`.github/workflows/nightly.yml\`) through \`.freebuff/coverage-history.mjs\`: the \`rendered-links coverage:\` stamp the vitest suite's own close-out writes, carried in the \`ci.mjs --json\` report as \`coverageStamp\`, and quoted verbatim on the run page and in the runbook's dated bullets. This table is where the readings accrue, so the guard's coverage is a trend over time rather than one run at a time.

A row is recorded for a red run too — the stamp is a reading, not a verdict — but never for a suite that left no stamp: a stubbed or failed suite omits the row rather than fabricating a zero. Re-running the same date replaces that date's row rather than duplicating it, and a row identical to the one already there changes nothing.

Record a row by hand with:

    node .freebuff/coverage-history.mjs --report .ci/report.json
    node .freebuff/coverage-history.mjs --stamp "rendered-links coverage: …" --date 2026-10-02

| Date | Rendered-links coverage |
| :-- | :-- |
`;
}

/**
 * A table cell cannot carry a pipe or a line break: the stamp itself joins its
 * parts with `" | "`, so the same escaping the nightly summary's cells use
 * applies here — `\|` for a pipe, a space for a line break — or the stamp's
 * own separators would end the row's cells early and shred the table.
 */
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * Appends one dated row to the history's text and returns the new text with
 * what the append was: `appended` when the date is new, `updated` when it
 * replaces that date's earlier row, `unchanged` when the row is already
 * exactly there. A blank or missing history is started from the scaffold.
 *
 * The rules are the file's whole honesty: one row per date (the latest reading
 * wins, so a rerun corrects the day rather than lying twice), rows in the
 * order they arrived (the trend reads top to bottom), the stamp verbatim in
 * the cell, and no row invented for a date nobody measured. It throws rather
 * than repairs on a malformed date or a stamp that does not read like one —
 * a caller feeding the history junk should be stopped, not folded in.
 */
export function appendCoverageRow(existing, date, stamp) {
  if (!ISO_DATE.test(date)) {
    throw new Error(`coverage-history: ${JSON.stringify(date)} is not a YYYY-MM-DD date`);
  }
  const reading = typeof stamp === "string" ? stamp.trim() : "";
  if (!reading.startsWith(STAMP_PREFIX) || reading.slice(STAMP_PREFIX.length).trim() === "") {
    throw new Error(
      `coverage-history: the stamp does not read like one — it must start with ${JSON.stringify(STAMP_PREFIX)} ` +
        `and say what was audited`,
    );
  }

  const row = `| ${date} | ${cell(reading)} |`;
  const base = existing && existing.trim() !== "" ? existing : scaffold();
  const lines = base.split("\n");
  const rowIndexes = lines.reduce((found, line, index) => {
    if (ROW.test(line)) found.push(index);
    return found;
  }, []);
  const dateIndex = rowIndexes.find((index) => ROW.exec(lines[index])[1] === date);

  let next;
  if (dateIndex !== undefined) {
    next = [...lines];
    next[dateIndex] = row;
  } else if (rowIndexes.length > 0) {
    // After the last row: the trend reads top to bottom, so a new date lands
    // at the bottom of the table whatever a hand may have left above it.
    next = [...lines];
    next.splice(rowIndexes[rowIndexes.length - 1] + 1, 0, row);
  } else {
    // The table is empty: the row goes directly under the alignment row, where
    // every future append will find it.
    const after = lines.findIndex((line) => ALIGNMENT.test(line));
    next = [...lines];
    next.splice(after === -1 ? next.length : after + 1, 0, row);
  }

  const text = `${next.join("\n").replace(/\n*$/, "\n")}`;
  return { text, action: text === base ? "unchanged" : dateIndex !== undefined ? "updated" : "appended" };
}

/** Reads a flag written `--flag value` or `--flag=value`. */
function argValue(name) {
  const joined = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const reportPath = argValue("--report");
  const stampArg = argValue("--stamp");
  const file = argValue("--file") ?? HISTORY_FILE;
  const date = argValue("--date") ?? new Date().toISOString().slice(0, 10);

  if (reportPath !== undefined && stampArg !== undefined) {
    console.error("coverage-history: --report and --stamp are two sources for one row — pass one");
    process.exit(1);
  }
  if (reportPath === undefined && stampArg === undefined) {
    console.error(
      "coverage-history: nothing to record — pass --report <a ci.mjs --json report> or --stamp <the stamp line>",
    );
    process.exit(1);
  }

  let stamp;
  if (reportPath !== undefined) {
    let raw;
    try {
      raw = readFileSync(reportPath, "utf8");
    } catch {
      console.error(`coverage-history: cannot read ${reportPath} — the gate may have crashed before writing it`);
      process.exit(1);
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error(`coverage-history: ${reportPath} is not valid JSON`);
      process.exit(1);
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      console.error(`coverage-history: ${reportPath} does not hold a ci.mjs report object`);
      process.exit(1);
    }
    if (payload.coverageStamp === undefined || payload.coverageStamp === null) {
      // The shape a suite that left no reading writes: a red suite that died
      // before the guard ran, or a stubbed one. The run page and the runbook
      // omit the line the same way — an omission, never a fabricated zero.
      console.error("coverage-history: the report carries no coverageStamp — nothing to record");
      return;
    }
    if (typeof payload.coverageStamp !== "string") {
      console.error(
        `coverage-history: the report's coverageStamp is a ${typeof payload.coverageStamp}, not a string — ` +
          "the stamp pipeline is broken, and a broken one is loud rather than folded in",
      );
      process.exit(1);
    }
    stamp = payload.coverageStamp;
  } else {
    stamp = stampArg;
  }

  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    // A missing file is scaffolded rather than an error: the committed file
    // travels with the checkout, but a run against a tree without it starts
    // the history fresh instead of failing the night over a first row.
    existing = "";
  }

  let result;
  try {
    result = appendCoverageRow(existing, date, stamp);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (result.action === "unchanged") {
    console.error(`coverage-history: ${file} already holds ${date}'s row — unchanged`);
    return;
  }
  try {
    writeFileSync(file, result.text, "utf8");
  } catch (error) {
    console.error(`coverage-history: could not write ${file} — ${error.message}`);
    process.exit(1);
  }
  console.error(`coverage-history: ${result.action} ${date}'s row in ${file}`);
}

// Only run the CLI when invoked as a script; a test imports the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
