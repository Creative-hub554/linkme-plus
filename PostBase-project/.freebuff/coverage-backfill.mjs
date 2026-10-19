#!/usr/bin/env node
/**
 * The one-off that lengthens the committed coverage history table to meet the runbook it reads
 * beside: the nights `.freebuff/run.md` recorded before `.freebuff/coverage-history.md` existed,
 * written into the table as the rows the writer would have written had it been running then.
 *
 * Both surfaces accrue the same readings — the runbook's dated bullets since the first whole-gate
 * close, the nightly job's table since the pass that introduced it — and the chart and the
 * command read *both* (`.freebuff/coverage-trend.mjs` matches them up by night), so an answer is
 * already as long as the two files together make it. What that leaves short is the table itself:
 * it begins on the night it was introduced, while the runbook reaches back to the first record,
 * and every row the nightly job appends lands under a series that starts in the middle of its own
 * history. This command closes that gap once — and is what would rebuild the table from the
 * records if it were ever recreated.
 *
 * The rules are the table's, taken from the modules that own them rather than restated here:
 *
 *   - **Append only.** A night the table already holds is left exactly as it is, byte for byte.
 *     That row is the night's own record as the writer took it down from that run's report, and
 *     this command writes history rather than revising it: if the runbook knows a reading that row
 *     does not, the *trend's* merge — where the runbook's line wins — is what holds the two
 *     surfaces together, and a command that quietly rewrote a recorded measurement would be
 *     exactly the kind of edit nobody could see in a diff of added lines.
 *   - **The writer writes the rows.** Rendering, the escaping of a reading's own pipes, the
 *     scaffold, the width and the "no measurement, no row" rule all come from
 *     `.freebuff/coverage-history.mjs` (`appendCoverageRow`), asked for chronological placement
 *     because a night that is already past belongs where its date says, not under the newest row.
 *   - **The runbook's records are the runbook's walk.** `runbookRecords` in
 *     `.freebuff/coverage-trend.mjs` reads the dated `ci verdict` bullets, so this command adds
 *     exactly the nights and the lines the chart would have charted — a dated paragraph, a
 *     reading quoted in prose and an indented `Suspects:` line are none of them records here
 *     either.
 *   - **One row per date.** Two records for one night fold into the one row the table has, the
 *     earlier record's line winning per reading, which is the rule the runbook walk itself makes
 *     (one record, one line per reading) applied to the file underneath it.
 *   - **Nothing to append is the answer, not a failure.** A table already holding every night the
 *     runbook records — which is what a second run of this command finds — changes nothing and
 *     exits 0.
 *
 * It is machinery, not a gate: no stage runs it and the nightly job does not either (the job
 * records *its* night from the report it just read, which is the row's proper origin). It is a
 * hand-run migration for the nights that predate the table.
 *
 * Usage:
 *   node .freebuff/coverage-backfill.mjs                      # the checkout's runbook and table
 *   node .freebuff/coverage-backfill.mjs --dry-run            # say what it would append, write nothing
 *   node .freebuff/coverage-backfill.mjs --runbook <path> --file <path>
 *
 * The exit code is 0 when rows were appended, when there was nothing to append, and on a dry run;
 * 1 when the runbook the records come from cannot be read, when the table cannot be written, and
 * when a caller hands in a reading that does not read like one of the declared readings — a
 * broken record is loud, or the trend it feeds is quietly wrong.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The table's writer: the row rendering, the scaffold, the escaping and the "no measurement, no
// row" rule are its own, so a backfilled row is a row the writer would have written rather than a
// second statement of the file's format kept in step by hand.
import { HISTORY_FILE, appendCoverageRow } from "./coverage-history.mjs";
// The readers of both surfaces: the runbook's dated records, and the rows the table already holds
// (read through the same walk the chart and the command read the table with, so a date this
// command thinks is missing is one they would think is missing too).
import { RUNBOOK_FILE, historyRecords, runbookRecords } from "./coverage-trend.mjs";

/** The checkout root this module lives in (`.freebuff/` is one level under it). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The table's text with every night `records` holds that it does not, appended in date order.
 *
 * `records` is what `runbookRecords` answers with — `[{ date, readings }]`, each reading's own line
 * keyed by the registry's id — and the result is the table the writer would produce: `text` is the
 * new file (the table unchanged when there is nothing to add) and `appended` names the dates that
 * went in, oldest first, which is what the command reports and what a dry run prints.
 *
 * A date the table already holds is skipped before the writer is asked, so an existing row is
 * never a cell of a merge: this is append-only by construction rather than by the writer's
 * per-reading behaviour. A record that carries none of the declared readings is offered to the
 * writer like any other and answers `none` — no measurement, no row — so a night the runbook
 * states with only prose does not become a row of empty cells. Two records for one date are folded
 * into one readings map first, the earlier record's line winning wherever both carry the reading.
 */
export function backfillRecords(existing, records = []) {
  const held = new Set(historyRecords(existing).map((row) => row.date));
  const nights = new Map();
  for (const record of records) {
    const known = nights.get(record.date);
    if (known === undefined) {
      nights.set(record.date, { ...record.readings });
      continue;
    }
    for (const [id, line] of Object.entries(record.readings)) {
      if (known[id] === undefined) known[id] = line;
    }
  }

  let text = existing;
  const appended = [];
  for (const date of [...nights.keys()].sort()) {
    if (held.has(date)) continue;
    // `at: "date"` because these nights are already past: the writer's own rule puts a new row
    // under the last one, which is right for a night that just happened and wrong for a history.
    const row = appendCoverageRow(text, date, nights.get(date), { at: "date" });
    if (row.action === "none") continue;
    text = row.text;
    appended.push(date);
  }
  return { text, appended };
}

/** Reads a flag written `--flag value` or `--flag=value`. */
function argValue(name) {
  const joined = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const runbookPath = argValue("--runbook") ?? join(ROOT, RUNBOOK_FILE);
  const file = argValue("--file") ?? HISTORY_FILE;
  const dryRun = process.argv.includes("--dry-run");

  let runbook;
  try {
    runbook = readFileSync(runbookPath, "utf8");
  } catch {
    console.error(
      `coverage-backfill: cannot read ${runbookPath} — the records to backfill are that file's, ` +
        "and with none there is nothing to write down",
    );
    process.exit(1);
  }

  // The table is read best-effort, exactly as its writer reads it: a tree without one is the
  // scaffold rather than an error, which is what makes this command able to rebuild a table from
  // the records alone.
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = "";
  }

  let result;
  try {
    result = backfillRecords(existing, runbookRecords(runbook));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (result.appended.length === 0) {
    console.error(
      `coverage-backfill: ${file} already holds every night ${runbookPath} records — nothing to append`,
    );
    return;
  }
  if (dryRun) {
    console.error(
      `coverage-backfill: would append ${result.appended.length} row(s) to ${file} — ` +
        `${result.appended.join(", ")}`,
    );
    return;
  }
  try {
    writeFileSync(file, result.text, "utf8");
  } catch (error) {
    console.error(`coverage-backfill: could not write ${file} — ${error.message}`);
    process.exit(1);
  }
  console.error(
    `coverage-backfill: appended ${result.appended.length} row(s) to ${file} — ` +
      `${result.appended.join(", ")}`,
  );
}

// Only run the CLI when invoked as a script; a test imports the function above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
