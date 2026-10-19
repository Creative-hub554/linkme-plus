#!/usr/bin/env node
/**
 * The coverage readings a run carries, accrued side by side: one dated row per run, one column
 * per declared reading.
 *
 * Every reading already has three consumers — the suite's own console line, the runbook bullet
 * the runner's close appends, and the nightly summary's `### Coverage` section — and every one of
 * them answers the same question about *one* run: what did that guard audit this time? None of
 * them accumulates. This file is the accumulator: a committed Markdown table the nightly job
 * appends to, one row per night and one column per reading, so each guard's coverage is a trend
 * of its own — a link the chrome stopped advertising, a suite that stopped keeping a scratch
 * directory, a convention guard that fell out of the meta-test, each one a column that moved —
 * rather than a number nobody remembers.
 *
 * The readings arrive the way every other consumer gets them: each suite's close-out writes its
 * line to the sidecar its entry names, the runner folds the ones that arrived into the `--json`
 * report's `readings` map under the ids `.freebuff/coverage-readings.mjs` declares, and the
 * nightly job hands this script the report (`--report .ci/report.json`). Which columns the table
 * has is that same declaration: the registry is walked rather than a reading named here, so a
 * guard that starts publishing is a column — and a header words — without this file being
 * edited, and the column's words are the entry's own (`columnTitle`), not a second spelling of
 * the reading's name kept in step by hand.
 *
 * The rules are the table's honesty:
 *
 *   - **One row per date.** A rerun updates that date's row rather than appending a second one,
 *     and a row already exactly there changes nothing — so a `workflow_dispatch` rerun over an
 *     already-recorded night leaves the file, and the commit that would carry it, untouched. A
 *     date the table has not seen lands under the last row, in the order the nights arrived,
 *     unless the caller asks for `at: "date"` — which is the backfill writing nights that are
 *     already past, and which is the only caller that wants a row anywhere but at the bottom.
 *   - **A cell belongs to one reading and one date.** A run that carried a reading writes that
 *     reading's cell; a reading the run carried nothing for keeps the cell it already had, so a
 *     second run of the same night can correct one column without erasing the others, and a date
 *     the table had no row for states the absence as an empty cell. The row is always as wide as
 *     the registry: a reading's absence is an empty cell, never a missing one.
 *   - **No measurement, no row.** A report that carried none of the declared readings records
 *     nothing at all (`none`) rather than a row of empty cells — the same omission the run page
 *     and the runbook make. A red run records its readings like a green one; a reading is a
 *     reading, not a verdict.
 *   - **The reading, verbatim.** Each cell holds the line as the suite wrote it, with the pipes
 *     its own `" | "` join uses escaped, so the table reads back as the run page and the runbook
 *     bullet do.
 *   - **Junk is loud.** A report that cannot be read or parsed, a `readings` field that is not a
 *     map keyed by reading id, a value that is not a string, a value that is not the reading it
 *     is keyed as, a hand-passed stamp that is no declared reading's line, a malformed date, and
 *     an invocation naming two sources for one row all exit 1 — a broken record is loud, or the
 *     trend it feeds is quietly wrong.
 *
 * Usage:
 *   node .freebuff/coverage-history.mjs --report .ci/report.json
 *   node .freebuff/coverage-history.mjs --report .ci/report.json --file .freebuff/coverage-history.md
 *   node .freebuff/coverage-history.mjs --stamp "<a reading's own line>" --date 2026-10-02
 *
 * `--report` records every declared reading the report carries; `--stamp` records one hand-measured
 * line, filed under the declared reading whose prefix it carries. `--file` defaults to the
 * committed `.freebuff/coverage-history.md`; `--date` defaults to today, UTC, the same clock the
 * runbook bullet uses.
 *
 * The exit code is 0 when a row was recorded, updated, already present — or when the report
 * carried no declared reading at all, which is a normal night for a suite that failed before its
 * guard ran, not an error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
// The one declaration of the readings this table has a column for: the ids the report keys them
// by, their sidecars, and the prefix that makes a line recognisably theirs. The history walks
// that declaration — as the runner's clear, the summary's render and the registry's own suite do
// — instead of naming a reading of its own, so a guard's new reading is a column here and a
// header cell without a second declaration to keep in step.
import { READINGS, carriedReading } from "./coverage-readings.mjs";

/** The committed file the nightly job appends to. */
export const HISTORY_FILE = ".freebuff/coverage-history.md";

/**
 * The table's columns: every declared reading, in the registry's own order.
 *
 * The order is what makes two nights readable against each other — the run page prints the same
 * readings in the same order — so a new reading is appended to the registry, never inserted here.
 */
export const COLUMNS = READINGS;

/** A date column value: exactly a `YYYY-MM-DD`, no clock, no timezone. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A history row: `| 2026-10-02 | <one cell per declared reading> |`. */
const ROW = /^\| (\d{4}-\d{2}-\d{2}) \|/;

/** The table's alignment row, the line a first row is inserted under. */
const ALIGNMENT = /^\| :--/;

/**
 * The words one reading's column is headed with: the entry's own prefix without its colon, first
 * letter raised.
 *
 * The header is therefore the reading's own vocabulary, as the registry declares it: the words a
 * reading's own line opens with head that reading's column, rather than a second name that a
 * change to the prefix would leave behind.
 *
 * @param {{ prefix: string }} entry the reading's entry
 */
export function columnTitle(entry) {
  const words = entry.prefix.replace(/:$/, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A table cell cannot carry a pipe or a line break: a reading joins its own parts with `" | "`,
 * so the same escaping the nightly summary's cells use applies here — `\|` for a pipe, a space
 * for a line break — or the reading's own separators would end the row's cells early and shred
 * the table.
 */
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * One row's cells as the file holds them: the date first, then one per column.
 *
 * The split skips an escaped pipe for the same reason the escaping exists — the reading's own
 * `" | "` join is not a cell boundary — and the cells come back as they were written, already
 * escaped, so re-rendering a row cannot double-escape a reading it only moved past.
 */
function rowCells(line) {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((text) => text.trim());
}

/** Renders one row: the date, then one cell per column, empty where the run carried none. */
function renderRow(date, cells) {
  return `| ${date} | ${COLUMNS.map((_, index) => cells[index] ?? "").join(" | ")} |`;
}

/**
 * Where a row for `date` goes when the table holds no row for it.
 *
 * `"bottom"` is after the last row — the nights read top to bottom as they arrived — whatever a
 * hand may have left above it; `"date"` is the first row dated later than this one, which is
 * where a night that is already past belongs when it is being written down late. With no row
 * later than it the two answers are the same row, and an empty table takes it directly under the
 * alignment row, where every future append will find it.
 */
function insertionIndex(lines, rowIndexes, date, at) {
  if (rowIndexes.length === 0) {
    const after = lines.findIndex((line) => ALIGNMENT.test(line));
    return after === -1 ? lines.length : after + 1;
  }
  if (at === "date") {
    const later = rowIndexes.find((index) => ROW.exec(lines[index])[1] > date);
    if (later !== undefined) return later;
  }
  return rowIndexes[rowIndexes.length - 1] + 1;
}

/**
 * The reading one entry's value in a report's `readings` map is — or `null` when this run carried
 * none for it.
 *
 * Absent, `null` and an empty string are one state on purpose: each is what a suite that left no
 * reading behind writes (a stub, a failure before the guard ran, a narrower selection), and the
 * history's answer to all three is the omission the run page and the runbook make. Anything else
 * is a broken pipeline rather than a missing measurement, and a broken pipeline is loud: a value
 * that is not a string is not something the runner writes, and a line that does not carry this
 * entry's own prefix is a line filed under the wrong id — either would put a cell in the table
 * that states as a reading something no guard measured.
 *
 * @param {{ id: string, prefix: string }} entry the reading's entry
 * @param {unknown} value the report's value for that id
 */
function readingOf(entry, value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(
      `coverage-history: the report's ${entry.id} reading is a ${typeof value}, not a string — ` +
        "the readings pipeline is broken, and a broken one is loud rather than folded in",
    );
  }
  const line = carriedReading(entry, value);
  if (line === null) {
    throw new Error(
      `coverage-history: the ${entry.id} reading does not read like one — it must start with ` +
        `${JSON.stringify(entry.prefix)} and say what was audited`,
    );
  }
  return line;
}

/**
 * The file a tree without one starts from: the header explaining where the rows come from, and
 * the table with a column per declared reading and no rows in it. The committed file travels
 * with the checkout and accrues rows in commits the nightly job makes; this shape is also what a
 * missing `--file` is built from, so the scaffold is defined once and the test holds the
 * committed file to it.
 */
export function scaffold() {
  return `# Coverage history

One dated row per nightly full-gate run, appended by the nightly job (\`.github/workflows/nightly.yml\`) through \`.freebuff/coverage-history.mjs\`: one column per reading — the lines the vitest suite's own close-outs write, carried in the \`ci.mjs --json\` report's \`readings\` map under the ids \`.freebuff/coverage-readings.mjs\` declares — and quoted verbatim on the run page and in the runbook's dated bullets. This table is where the readings accrue, so each guard's coverage is a trend of its own over time rather than one run at a time.

A row is recorded for a red run too — a reading is not a verdict — but never for a run that carried no reading at all: a stubbed or failed suite leaves its cell empty rather than fabricating a zero, and a rerun writes only the cells it carried, so a second run of the same night cannot erase the first's readings.

Record a row by hand with:

    node .freebuff/coverage-history.mjs --report .ci/report.json
    node .freebuff/coverage-history.mjs --stamp "<a reading's own line>" --date 2026-10-02

| Date | ${COLUMNS.map(columnTitle).join(" | ")} |
| :-- |${COLUMNS.map(() => " :-- |").join("")}
`;
}

/**
 * Appends one dated row to the history's text and returns the new text with what the append was:
 * `appended` when the date is new, `updated` when this run's readings moved a cell of that date's
 * row, `unchanged` when every cell it carried already reads exactly like that, and `none` when
 * the run carried no declared reading at all — no measurement, no row. A blank or missing history
 * is started from the scaffold.
 *
 * `readings` is the report's map, `{ [id]: line | null }` keyed by the ids `READINGS` declares.
 * Only the entries it carries are written: a reading this run left none of keeps whatever cell it
 * already had, so the columns accrue independently — that is what makes each reading a trend of
 * its own — and a row for a date the table had not seen states the absences as empty cells. The
 * returned `recorded` names the readings this run wrote, which is the row's own answer to what it
 * measures. It throws rather than repairs on a malformed date or on a value that is not the
 * reading it is keyed as — a caller feeding the history junk should be stopped, not folded in.
 *
 * `at` is where a new row goes, and the two answers are for two callers. `"bottom"` — the
 * writer's own rule, and the default — puts it under the last row: a night lands under the nights
 * recorded before it, and a rerun of an older date is a correction of *that* row rather than a
 * second one, so the table reads top to bottom as the nights arrived. `"date"` puts it at the
 * first row dated later than it, which is what `.freebuff/coverage-backfill.mjs` asks for: it
 * writes rows for nights that are already past — the runbook's records from before this table
 * existed — and those belong where their dates say rather than under the newest row, or the
 * table's order would stop being chronological for every reader after it.
 *
 * @param {string} existing the history's current text, empty for a tree without one
 * @param {string} date the row's date, `YYYY-MM-DD`
 * @param {Record<string, string | null | undefined>} readings the report's readings map
 * @param {{ at?: "bottom" | "date" }} [options] where a date the table has not seen goes
 */
export function appendCoverageRow(existing, date, readings, { at = "bottom" } = {}) {
  if (!ISO_DATE.test(date)) {
    throw new Error(`coverage-history: ${JSON.stringify(date)} is not a YYYY-MM-DD date`);
  }
  const arrived = COLUMNS.map((entry) => readingOf(entry, readings?.[entry.id]));
  const recorded = COLUMNS.filter((_, index) => arrived[index] !== null).map((entry) => entry.id);
  const base = existing && existing.trim() !== "" ? existing : scaffold();

  if (recorded.length === 0) {
    // No measurement, no row: a date nobody measured is not a row of empty cells, because an
    // empty cell is how the table says "this reading was not measured" for a *night that ran*.
    return { text: base, action: "none", recorded };
  }

  const lines = base.split("\n");
  const rowIndexes = lines.reduce((found, line, index) => {
    if (ROW.test(line)) found.push(index);
    return found;
  }, []);
  const dateIndex = rowIndexes.find((index) => ROW.exec(lines[index])[1] === date);
  // What the row already holds: the cells this run did not carry keep their text, and a reading
  // the row has no cell for is empty — the width is the registry's, however narrow an older
  // file's row was written.
  const held = dateIndex === undefined ? [] : rowCells(lines[dateIndex]).slice(1);
  const cells = arrived.map((line, index) => (line === null ? (held[index] ?? "") : cell(line)));
  const rendered = renderRow(date, cells);

  const next = [...lines];
  if (dateIndex !== undefined) {
    next[dateIndex] = rendered;
  } else {
    next.splice(insertionIndex(lines, rowIndexes, date, at), 0, rendered);
  }

  const text = `${next.join("\n").replace(/\n*$/, "\n")}`;
  return {
    text,
    action: text === base ? "unchanged" : dateIndex !== undefined ? "updated" : "appended",
    recorded,
  };
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
      "coverage-history: nothing to record — pass --report <a ci.mjs --json report> or " +
        "--stamp <one reading's own line>",
    );
    process.exit(1);
  }

  let readings;
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
    // A report with no `readings` at all is an older or hand-written one, and every declared
    // reading is an omission for it. A `readings` field that is not a map keyed by reading id is
    // not an older shape but a broken pipeline, and a broken one is loud: it would otherwise read
    // as a night whose guards all left nothing.
    const map = payload.readings;
    if (map !== undefined && (typeof map !== "object" || map === null || Array.isArray(map))) {
      console.error(
        `coverage-history: ${reportPath}'s readings is not a map keyed by reading id — ` +
          "the readings pipeline is broken, and a broken one is loud rather than folded in",
      );
      process.exit(1);
    }
    readings = map ?? {};
  } else {
    // A hand-measured line is filed under the declared reading whose prefix it carries, so a
    // stamped row writes its own column and leaves the others as they were — the id is read off
    // the line, not chosen by the caller.
    const filed = COLUMNS.map((entry) => ({ entry, line: carriedReading(entry, stampArg) })).find(
      ({ line }) => line !== null,
    );
    if (filed === undefined) {
      console.error(
        "coverage-history: the stamp does not read like one — it must start with a declared " +
          `reading's prefix (${COLUMNS.map((entry) => JSON.stringify(entry.prefix)).join(", ")}) ` +
          "and say what was audited",
      );
      process.exit(1);
    }
    readings = { [filed.entry.id]: stampArg };
  }

  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    // A missing file is scaffolded rather than an error: the committed file travels with the
    // checkout, but a run against a tree without it starts the history fresh instead of failing
    // the night over a first row.
    existing = "";
  }

  let result;
  try {
    result = appendCoverageRow(existing, date, readings);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (result.action === "none") {
    // The shape a suite that left no reading writes: a red suite that died before a guard ran,
    // or a stubbed one. The run page and the runbook omit the lines the same way — an omission,
    // never a fabricated zero.
    console.error(
      `coverage-history: the report carries none of the declared readings ` +
        `(${COLUMNS.map((entry) => entry.id).join(", ")}) — nothing to record`,
    );
    return;
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
  console.error(
    `coverage-history: ${result.action} ${date}'s row in ${file} — ${result.recorded.join(", ")}`,
  );
}

// Only run the CLI when invoked as a script; a test imports the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
