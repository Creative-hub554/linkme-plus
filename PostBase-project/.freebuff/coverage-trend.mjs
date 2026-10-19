/**
 * The coverage-over-time block: the readings the committed runbook's dated records carry,
 * charted one series per declared reading.
 *
 * A reading is published per run and quoted on the run page one run at a time, and the two
 * surfaces that accrue them over time are the runbook's dated bullets (`.freebuff/run.md`,
 * appended by a whole-gate close) and `.freebuff/coverage-history.md` (the nightly job's table).
 * This module reads **both**: it pulls each record's reading lines out of each surface through the
 * registry's own prefixes, matches the two up by night, and plots each guard's series — so a
 * reading is as long as the two files together make it. A night the runbook recorded *without*
 * that reading is a point the table's cell supplies, and a night the runbook never recorded at all
 * is a record the trend would otherwise forget entirely.
 *
 * One night is one record, and where the two surfaces carry a line for the same reading the
 * runbook's wins: that file is the record the run wrote — and the one the command cannot answer
 * without — while the table is what the answer *adds*. A cell that is empty, or that does not read
 * like the reading its column stands for, carries nothing rather than becoming a point, which is
 * the same omission a record that carried no reading makes.
 *
 * What it deliberately does *not* do is read the numbers out of prose. A trend needs one number
 * per record and a reading's line is a sentence, so the number plotted is the one the entry
 * *declares* under `metric` — read off the line by `metricOf` rather than recomputed, so the
 * chart cannot disagree with the prose it came from. Three consequences are the design:
 *
 *   - A record that carried no reading for a guard is **left out** of that guard's series, not
 *     plotted as a zero: the reading's absence is an omission every other consumer also makes,
 *     and a zero on a chart of "how much was audited" would be a fabricated measurement rather
 *     than a missing one.
 *   - A line the entry's metric cannot read is **named** — the record's date is carried in the
 *     row — rather than dropped. A chart that silently skipped it would show a shorter series,
 *     which is exactly what a record that was never written looks like.
 *   - A record is the bullet the *runner* writes: a dated heading that says `ci verdict`. The
 *     runbook's prose bullets are record-keeping about the gate rather than the gate's own
 *     record, and one of them quotes a reading line inside a paragraph — so "dated bullet" alone
 *     would chart a sentence somebody wrote about a reading as though a run had measured it.
 *
 * The chart is a sparkline drawn from the series' own range, plus the numbers a reader needs to
 * make the bars mean something: the latest value with its label, how it moved from the first
 * plotted record, and which window of records was plotted. The bars carry no scale of their own
 * — a sparkline normalizes — so the range is stated in words beside them, and a series with no
 * spread is drawn flat at the middle bar of the scale rather than as a spike or a trough.
 *
 * Under each series is the *floor* the reading is held against: the level the committed low-water
 * records for it, drawn on the series' own scale so a reader can see which of the plotted nights
 * cleared it and which fell under the line the trend fails on. Movement and floor are two different
 * questions — the command below answers with the second — and a chart that showed only the shape of
 * the bars would say the reading moved without saying what it moved against.
 *
 * ## The command
 *
 * The module is also `npm run coverage:trend`, which turns the same records into an *answer*
 * rather than a shape: for every declared reading, the newest record it has is held against the
 * low-water mark recorded for it — the lowest number the reading has settled to, not the night
 * immediately before and not the peak, so a reading that dips back to a level it has held passes
 * while one that settles *below* where it has been is a regression. A coverage reading
 * says how much was judged, so a fall is the movement worth failing: the command exits 1 naming
 * the guards that stepped down, and 0 with the movement of every reading it could compare. A
 * reading the recorded low-water does not name — a guard declared this morning, a tree with no file
 * at all — is held against the nights at hand instead, which are both surfaces' records: a fall only
 * the table can show, a night the runbook's bullet carried no line for or a night the runbook never
 * recorded at all, is a fall this command still fails on, and its report says what it was read from.
 *
 * Three answers are deliberately not failures. A reading with fewer than two records has never
 * moved — `no-history`, said out loud rather than counted as a pass. A newest line the entry's
 * metric cannot read is `unreadable`: the pipeline is named (and the registry's own suite is
 * where a metric is held), but a hand-edited line is not a coverage regression. And a runbook
 * with no records at all compares nothing, which is a fresh checkout rather than a red tree —
 * the same omission the chart and the history table make.
 *
 * ## The floor is committed, so it outlives the window
 *
 * The low-water is **recorded as well as derived**: `.freebuff/coverage-low-water.json` holds, per
 * declared reading, the lowest level its records have settled to and the night that settled it, and
 * the newest record is held against *that* number. Two consequences are the point rather than side
 * effects. A fall is no longer measured against the chart's own 20-record window, so a level a
 * reading held months ago still holds, and a reading whose records are one night old — a guard that
 * has just started publishing — is held against its floor instead of having nothing to be held
 * against. And the number is a reviewed line in a committed file rather than a fact recomputed from
 * whatever stretch of nights a caller happened to hand in: `npm run coverage:low-water` derives it
 * from the records and rewrites the file, so the file's diff is where a deliberate step down is
 * decided — the same decision the runbook's next bullet records, in the place this command reads.
 *
 * The derivation is this module's own (`derivedLowWater`): for each declared reading, the minimum of
 * every record that carried a readable line for it, and `since`, the earliest night at that level.
 * It is deterministic on purpose — no timestamp, no window, keys in the registry's order — because
 * the committed file is held to it **byte for byte** by `src/test/coverage-low-water.test.ts`, which
 * is what stops the one edit that would let a fall through: a floor lowered by hand. A reading the
 * file does not name is held against the low-water of the nights at hand instead, which is the rule
 * this command had before the file and the one a fresh checkout needs; `sources.lowWater` says how
 * many readings the file named, and each row's `floorFrom` says which of the two its floor was,
 * because an answer has to say what it was read from.
 *
 * The ratchet itself is unchanged and is still the trend line's: a fall fails the night that
 * measured it, the next record carries the new level, and the recorder is what writes it down.
 *
 * ## What the night does about it
 *
 * A step down fails the night that measured it — and re-recording the floor used to be a thing a
 * person had to remember to do by hand, from a red run and a command in a comment. So the same
 * script has a second writer mode, `--propose-low-water`, which the nightly job reaches for on the
 * two reds that can mean the floors have stopped stating the records: the trend's verdict, and the
 * gate's — where the byte-for-byte comparison of the committed file against the derivation lands
 * the night a record sits below the level the file draws for it while the *newest* record cleared
 * it, which the trend's own rule cannot see. It derives the floors from the records the way the
 * recorder does, reads the committed file to see which lines that moves, and renders the change as
 * a **proposal** — the file the commit carries, and the body the pull request is opened with
 * (`LOW_WATER_PROPOSAL_FILE`) — so what the night is asking for is a reviewable merge rather than an
 * errand left in the log.
 *
 * Three things about it are the design rather than the plumbing. It proposes and never applies:
 * the floor file it writes is the one the proposal's own branch carries, and a floor is a gate, so
 * a lower number is a person's decision — the rule the red answer already names, moved from "somebody
 * has to run the recorder" to "somebody has to merge this". It refuses rather than erases: a
 * derivation that names no reading at all is not a tree with no floors but a records file it could
 * not read, so nothing is written and the status says so. And it carries the whole story — the
 * trend's own report, the line each reading would move, and the level it would settle at — because
 * the one thing a reviewer accepting a looser gate has to be able to see is how much looser.
 *
 * The module is machinery, not a gate: `.freebuff/nightly-report.mjs` renders the block into the
 * nightly page, `.github/workflows/nightly.yml` runs the command after the gate, goes red on a
 * regression and reaches for the proposal mode on either of those reds, and the module is pinned with its
 * siblings so a quietly changed marker or window is a red alarm rather than a page whose chart
 * stops moving.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { READINGS, carriedReading, metricOf } from "./coverage-readings.mjs";
// The table the nightly job appends its rows to, named by the module that writes it: the trend
// reads that writer's file rather than keeping a second copy of its path in step by hand.
import { HISTORY_FILE } from "./coverage-history.mjs";
// Which comment on a pull request is a collect-budget proposal, which is the reply that answered it, and
// what that reply declared doing with it: the module that posts both owns both markers and the outcome
// vocabulary, so the settlement reader asks it instead of spelling second copies that could drift from the
// poster's — including the list of outcome words the runbook has to be able to read back.
import {
  APPLY_STATUSES,
  applyAdopted,
  proposalAnswer,
  proposalPostedAt,
} from "./collect-apply.mjs";

/**
 * The file a run's records accrue in, from the checkout root: the one spelling of the path this
 * module reads, and the default `.freebuff/nightly-report.mjs` reads for its page too.
 */
export const RUNBOOK_FILE = ".freebuff/run.md";

/**
 * The other file a reading accrues in: the nightly job's dated table, re-exported from the module
 * that appends to it, so the consumers that chart the trend name both surfaces' paths from here
 * rather than spelling one of them a second time.
 */
export { HISTORY_FILE };

/**
 * The committed low-water marks: the floor each declared reading's records have settled to, one
 * number and the night that settled it.
 *
 * It is a *record*, not a second derivation: `derivedLowWater` computes what it must hold,
 * `--write-low-water` writes it, and `src/test/coverage-low-water.test.ts` holds the committed bytes
 * to that derivation — so the file and the records cannot say two things about what a fall is
 * measured against. What it buys is reach, and it is the reason the file is read rather than the
 * other way round: the floor of a reading it names is *its* number, so a level held long before the
 * chart's window — or before the records a caller was handed — is still the level a fall below it
 * fails.
 */
export const LOW_WATER_FILE = ".freebuff/coverage-low-water.json";

/**
 * Where the proposal a red trend earns is rendered, from the checkout root: the body the nightly
 * job opens its pull request with.
 *
 * A transient of the run, like the collect-budget proposal beside it — written by the step that
 * derives the floors and read by the step that opens the request — so `.gitignore` keeps it out of
 * the tree. The path is declared here, beside the floors it is about, because both writer modes are
 * this module's own and a caller (the workflow, a case) should have to name neither by hand.
 */
export const LOW_WATER_PROPOSAL_FILE = ".freebuff/coverage-floor-proposal.md";

/**
 * Where the night's nudge comment is rendered, beside the proposal it is about.
 *
 * A run transient like the proposal body, and named for the same reason: the step that renders the
 * comment, the poster that reads it, and the artifact that keeps it write about one file, and the
 * name is declared here rather than spelled three times in YAML. The workflow lands it under
 * `.ci/`, where this run's own transients live.
 */
export const NUDGE_COMMENT_FILE = ".freebuff/coverage-floor-proposal-nudge.md";

/**
 * Where a risen wait's comment is rendered, beside the nudge's.
 *
 * The same night can leave two comments on the same request, and they are two files because they are
 * two findings: the nudge says how long *this request* has sat and exists only on a night the floors
 * moved, while this one is about the *record* — the middle of every age the runbook holds, past the
 * worst any earlier night ended at — and is owed on any night that stands above that line with a
 * request still open to answer it. Named here rather than spelled in YAML for the nudge's reason: the
 * renderer, the poster and the artifact write about one file.
 */
export const WAIT_COMMENT_FILE = ".freebuff/coverage-floor-proposal-wait.md";

/** The checkout root this module lives in (`.freebuff/` is one level under it). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** How many records a series is charted over, newest window last. */
export const TREND_LIMIT = 20;

/**
 * The head of a runbook record: the bullet a whole-gate close appends.
 *
 * The date and the words `ci verdict` are both required, and the two together are what keeps the
 * file's prose out of the trend: a hand-written bullet that merely mentions a date is
 * record-keeping *about* the gate, and a line of it can quote a reading without having measured
 * one.
 */
const RECORD_HEAD = /^- \*\*(\d{4}-\d{2}-\d{2}) — ci verdict:/;

/** The bars a series is drawn with, lowest first. */
const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * The dated records a runbook's text carries, oldest first, as `[{ date, readings }]`.
 *
 * `readings` is keyed by the registry's ids and holds the *line* each record carried for that
 * reading — carried out through `carriedReading`, so a record's continuation line is a reading
 * only when it begins with that entry's own prefix. The day's suspects and any other indented
 * line the bullet grows are therefore not readings, and a line that arrived twice under one
 * heading keeps its first: one record, one line per reading, which is the shape the runner
 * writes.
 *
 * A record ends where the bullet does — the next heading, a prose bullet, a blank line — so a
 * reading line that appears in the runbook's prose (a bullet explaining the readings feature
 * quotes them) belongs to no record and is not charted.
 */
export function runbookRecords(text) {
  const records = [];
  let current = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const head = RECORD_HEAD.exec(line);
    if (head !== null) {
      current = { date: head[1], readings: {} };
      records.push(current);
      continue;
    }
    // Anything that is not the bullet's own continuation closes it: the next heading (handled
    // above), a blank line, or a paragraph.
    if (current === null) continue;
    if (!line.startsWith("  ") || line.trim() === "") {
      current = null;
      continue;
    }
    const carried = line.trim();
    const entry = READINGS.find((candidate) => carriedReading(candidate, carried) !== null);
    if (entry !== undefined && current.readings[entry.id] === undefined) {
      current.readings[entry.id] = carried;
    }
  }
  return records;
}

/**
 * A history-table row: `| 2026-10-02 | <one cell per declared reading> |` — the line the nightly
 * job's writer renders, which is what makes a row a record rather than a table of something else.
 */
const HISTORY_ROW = /^\| (\d{4}-\d{2}-\d{2}) \|/;

/**
 * One cell back as the reading wrote it: the writer escapes the pipes its own `" | "` join uses as
 * `\|`, so reading it back is one substitution — the same one the writer's own row reader makes.
 */
const unescapedCell = (text) => text.replace(/\\\|/g, "|");

/**
 * The dated rows a history table's text carries, oldest first, as `[{ date, readings }]` — the same
 * shape `runbookRecords` answers in, read from the other surface.
 *
 * The table is written one row per night and one column per declared reading, in the registry's own
 * order (`.freebuff/coverage-history.mjs`), each cell holding that reading's line verbatim with its
 * pipes escaped. The column is therefore not read by position but by the line itself: a cell is a
 * reading when it begins with that entry's own prefix (`carriedReading`), so an empty cell, a short
 * row's missing one, a stray line, and a column a hand moved are each an omission rather than a
 * point filed under the reading whose column they happened to sit in. The date is the row's own, so
 * the rows line up with the runbook's records by night rather than by position in either file.
 *
 * A row is kept whatever its cells hold — a night the table states with none of the readings is
 * still a night, and one it states with a line this metric cannot read is still named by the
 * chart — because dropping it would shorten a series in exactly the way a record that was never
 * written does.
 */
export function historyRecords(text) {
  const records = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const head = HISTORY_ROW.exec(line);
    if (head === null) continue;
    const readings = {};
    for (const cellText of line.split(/(?<!\\)\|/).slice(1, -1)) {
      const carried = unescapedCell(cellText.trim());
      const entry = READINGS.find((candidate) => carriedReading(candidate, carried) !== null);
      if (entry !== undefined && readings[entry.id] === undefined) readings[entry.id] = carried;
    }
    records.push({ date: head[1], readings });
  }
  return records;
}

/**
 * Both surfaces' records as one record per night, in date order: the runbook's records, with the
 * table's rows merged into them.
 *
 * One night is one record and a reading has one line per night. Two records for one night would be
 * the same night counted twice — a step in a series that never happened, and a low-water mark drawn
 * from a night two files both described — so a night the runbook recorded keeps its own record and
 * the table's row for that date only *fills in* the readings the bullet carried no line for: that
 * is the case which lengthens a **reading's** series rather than the record list, and it is where a
 * new guard's reading gets the earlier night the bullet could not give it. Where both surfaces
 * carry a line for the same reading the runbook's wins, because that file is the record the run
 * wrote and the one the command cannot answer without, while the table is an addition to it.
 *
 * A whole night the runbook never recorded is inserted **in place** rather than appended: the window
 * is a stretch of nights, so a table row older than the runbook's tail belongs where its date says
 * even if the table is read after the runbook. A date a table row repeats is folded into the first
 * row for it, the way a reading repeated under one runbook heading keeps its first line.
 *
 * Neither list has to hold anything: no table at all — a checkout that never ran the nightly job, a
 * caller with only a runbook — leaves the runbook's records exactly as they were, and two empty
 * ones answer no records, which every caller already renders as an omission.
 */
export function mergeRecords(runbook = [], history = []) {
  const records = runbook.map((record) => ({
    date: record.date,
    readings: { ...record.readings },
  }));
  for (const row of history) {
    const known = records.find((record) => record.date === row.date);
    if (known !== undefined) {
      for (const [id, line] of Object.entries(row.readings)) {
        if (known.readings[id] === undefined) known.readings[id] = line;
      }
      continue;
    }
    const at = records.findIndex((record) => record.date > row.date);
    records.splice(at === -1 ? records.length : at, 0, {
      date: row.date,
      readings: { ...row.readings },
    });
  }
  return records;
}

/**
 * A date as both surfaces write it: what the low-water's `since` is, and all the reader accepts.
 */
const RECORD_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The low-water the records state, per declared reading: the lowest level each one has settled to,
 * and the night that settled it, in the registry's order.
 *
 * One number per reading, over **every** record the two surfaces hold rather than a window of them,
 * and only records whose line the entry's metric reads — a line nobody can read is not a level the
 * reading settled at. `since` is the *earliest* night at that level rather than the latest, so "the
 * floor has held since …" is a fact that does not move when the reading repeats itself at it.
 *
 * Deterministic by contract, because the committed file is compared to this byte for byte: no
 * timestamp, no window, and no dependence on which surface a record came from — the merge has
 * already given one night one record.
 */
export function derivedLowWater(records = []) {
  const floors = {};
  for (const entry of READINGS) {
    const measured = records
      .filter((record) => record.readings[entry.id] !== undefined)
      .map((record) => ({ date: record.date, value: metricOf(entry, record.readings[entry.id]) }))
      .filter((point) => point.value !== null);
    if (measured.length === 0) continue;
    const lowest = Math.min(...measured.map((point) => point.value));
    floors[entry.id] = {
      value: lowest,
      since: measured.find((point) => point.value === lowest).date,
    };
  }
  return floors;
}

/** What the committed file says about itself: JSON has no comments, so the file carries its how. */
const LOW_WATER_NOTE =
  "The low-water mark each declared reading is held against: the lowest level its records have " +
  "settled to, and the night that settled it. A fall below it fails `npm run coverage:trend`; a " +
  "return to a level the reading has held does not. Regenerate with: npm run coverage:low-water";

/**
 * The committed low-water file, as text: its own shape exactly, so a re-record is a reviewed diff
 * and nothing else.
 *
 * Keys keep the order they were derived in — the registry's, which is the report's and the history
 * table's columns' — because a file that reordered itself would be drift nobody decided. The
 * `note` is the file's own statement of the rule; it is written, read back and compared like any
 * other line of it, so a hand-edit to the words that say what the numbers mean is drift too.
 */
export function renderLowWater(floors) {
  const readings = Object.fromEntries(
    Object.entries(floors).map(([id, held]) => [id, { value: held.value, since: held.since }]),
  );
  return `${JSON.stringify({ note: LOW_WATER_NOTE, readings }, null, 2)}\n`;
}

/**
 * The committed low-water file, read back: `{ id: { value, since } }` for the readings it names.
 *
 * A reading that is no longer declared carries nothing (the file is older than the registry, and a
 * stale line is not a floor for anything), but an entry that *is* declared and cannot be read is an
 * error rather than a number to guess at: the command answers with the records' own low-water in
 * that case and says so on stderr, and the suite's byte comparison is where the file itself is
 * repaired. Junk that parses as no map at all is the same kind of error.
 */
export function readLowWater(text) {
  const parsed = JSON.parse(String(text ?? ""));
  const readings = parsed?.readings;
  if (readings === null || readings === undefined || typeof readings !== "object" || Array.isArray(readings)) {
    throw new Error("it carries no `readings` map");
  }
  const floors = {};
  for (const [id, held] of Object.entries(readings)) {
    if (!READINGS.some((entry) => entry.id === id)) continue;
    if (held === null || typeof held !== "object" || Array.isArray(held)) {
      throw new Error(`${id} is not an entry with a value and a date`);
    }
    if (!Number.isInteger(held.value)) throw new Error(`${id} declares no whole-number value`);
    if (typeof held.since !== "string" || !RECORD_DATE.test(held.since)) {
      throw new Error(`${id} declares no \`since\` date`);
    }
    floors[id] = { value: held.value, since: held.since };
  }
  return floors;
}

/**
 * Why the committed low-water could not be read, in the words a caller's own note needs.
 *
 * Two callers read this file — the command here and the nightly page's renderer — and both have to
 * say *what* still stands in for the floors, so only the fact is shared: a file that is not there
 * and a file that is there and unreadable are different facts, and "no committed low-water" alone
 * would hide a broken file behind the wording for a missing one. The reader's own message (which
 * line was wrong) is carried through for that reason.
 */
export function lowWaterTrouble(path, error) {
  const why =
    error !== null && typeof error === "object" && error.code === "ENOENT"
      ? "there is none"
      : `it could not be read: ${error instanceof Error ? error.message : String(error)}`;
  return `no committed low-water at ${path} (${why})`;
}

/**
 * One reading's series over those records, windowed to the most recent `limit` that carried it.
 *
 * The window is taken over *records*, so it is the same stretch of nights for every reading the
 * runbook holds; `dropped` is how many of the reading's records fell before it, which is what
 * lets the row say `last 20 of 31 record(s)` instead of quietly charting a shorter history than
 * the file holds. `points` is the window in file order, each with the metric's number or `null`
 * (the line could not be read), and `values` is the readable ones — the chart's own input.
 */
export function readingSeries(entry, records, { limit = TREND_LIMIT } = {}) {
  const carried = records.filter((record) => record.readings[entry.id] !== undefined);
  const windowed = limit > 0 ? carried.slice(-limit) : carried;
  const points = windowed.map((record) => ({
    date: record.date,
    value: metricOf(entry, record.readings[entry.id]),
  }));
  return {
    id: entry.id,
    entry,
    label: entry?.metric?.label ?? entry.id,
    points,
    values: points.filter((point) => point.value !== null).map((point) => point.value),
    unreadable: points.filter((point) => point.value === null).map((point) => point.date),
    records: carried.length,
    dropped: carried.length - windowed.length,
    from: windowed[0]?.date ?? null,
    to: windowed[windowed.length - 1]?.date ?? null,
  };
}

/**
 * The bar a value is drawn as on a scale from `low` to `high`.
 *
 * One rule for both lines of a reading's chart — the series and the floor drawn beside it — because
 * the whole point of drawing the floor is that the two are read against one scale: a second
 * rounding, off by a bar, would make the comparison a lie nobody could see. A value outside the
 * scale is drawn at the end of it (the floor of a window that never reached it) rather than off the
 * chart, and a scale with no spread is the middle bar: that is a statement about normalizing to a
 * range, not a claim that the value sat halfway up some scale.
 */
function barFor(value, low, high) {
  if (high === low) return BARS[Math.floor((BARS.length - 1) / 2)];
  const at = ((value - low) / (high - low)) * (BARS.length - 1);
  return BARS[Math.round(Math.min(Math.max(at, 0), BARS.length - 1))];
}

/**
 * A series drawn as one bar per value, scaled to the series' own range.
 *
 * The scale is the series': the lowest value gets the lowest bar and the highest the tallest, so
 * the bars show the *shape* of the movement and the numbers beside them say what it was. A series
 * with no spread — every record the same number — has no shape to draw, so it is drawn flat at
 * the middle; that is a statement about the chart normalizing to its own range, not a claim that
 * the value sat halfway up some scale.
 */
export function sparkline(values) {
  if (values.length === 0) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  return values.map((value) => barFor(value, low, high)).join("");
}

/** What a reading the committed file does not name says for itself, in place of a drawn floor. */
const NO_FLOOR_LINE =
  "  no committed floor — this reading is held against the nights at hand rather than against a " +
  "recorded level";

/**
 * The floor drawn beside its series: the same bar, one per plotted record, with the level in words.
 *
 * The floor is drawn on the *series'* own range rather than on a range widened to include it, and
 * that is what makes the two lines comparable: a floor inside the window lands exactly where its
 * level is, so a reader sees at a glance whether the bars cleared it, and one below (or above) the
 * whole window is drawn at the end of the scale — where it belongs, since every record is on the
 * far side of it — with the distance said in numbers instead of exaggerated by a scale stretched
 * to reach it. The words are the part a picture cannot carry: the level, the night it settled (the
 * floor outlives the window, so its own date is the one a row cannot show on the bars), where the
 * newest record sits against it, and — the reason the floor is drawn at all — how many of the
 * plotted records are *below* it, which is the count of nights this window would have failed.
 */
function floorLine(series, floor) {
  const { values } = series;
  const bars = barFor(floor.value, Math.min(...values), Math.max(...values)).repeat(values.length);
  const latest = values[values.length - 1];
  const against =
    latest === floor.value
      ? `the newest ${latest} is level with it`
      : `the newest ${latest} is ${Math.abs(latest - floor.value)} ` +
        `${latest > floor.value ? "above" : "below"} it`;
  const below = values.filter((value) => value < floor.value).length;
  const crossed = below > 0 ? `; ${below} of these ${values.length} record(s) below it` : "";
  return `  \`${bars}\` floor ${floor.value} (recorded ${floor.since}) — ${against}${crossed}`;
}

/**
 * One series as the page's row: the bars, the numbers that make them mean something, and the floor.
 *
 * Two lines, because the floor is a second series: the reading's own history above, and the level
 * its records have settled to beneath it on the same scale. A reading with nothing readable at all
 * gets the defect line alone — there is no scale to draw a floor against, and what is missing there
 * is the metric, not the floor.
 */
function seriesRow(series, floor = null) {
  const { values, unreadable } = series;
  const window =
    series.dropped > 0
      ? `the last ${series.points.length} of ${series.records} record(s)`
      : `${series.records} record(s)`;
  const span = series.from === series.to ? `${series.from}` : `${series.from} → ${series.to}`;
  const named = unreadable.length > 0 ? `; ${unreadable.length} record(s) whose line this metric cannot read (${unreadable.join(", ")})` : "";

  if (values.length === 0) {
    // No number at all: the row is the defect, said plainly, rather than an absent guard.
    return [
      `- **${series.id}** — nothing to plot: ${window} carry a line this entry's metric cannot read (${unreadable.join(", ")})`,
    ];
  }

  const first = values[0];
  const latest = values[values.length - 1];
  const change =
    latest === first
      ? `no change from ${first}`
      : `${latest > first ? "up" : "down"} ${Math.abs(latest - first)} from ${first}`;
  return [
    `- **${series.id}** \`${sparkline(values)}\` — ${latest} ${series.label}, ${change} ` +
      `(range ${Math.min(...values)}–${Math.max(...values)}) over ${window} (${span})${named}`,
    floor === null ? NO_FLOOR_LINE : floorLine(series, floor),
  ];
}

/**
 * One reading's movement: its newest record held against the nights before it.
 *
 * `current` is the newest record the reading has; the number it is held against is the reading's
 * **committed low-water** when `lowWater` names it — the level it has settled to over its whole
 * history, which is what outlives the window — and the low-water of the nights at hand otherwise.
 * Either way the floor is a *low-water*, not the night immediately before and not the peak: that is
 * the whole of "did it move": returning to a level the reading has held is `held`, a number below
 * the floor is `regressed`, above it is `rose`. `floorFrom` says which of the two the number came
 * from and `floorSince` the night the committed one settled, so a row can say where its floor is.
 *
 * `no-history` is a reading with no floor to hold its newest record against — one record and no
 * committed low-water, none at all, or earlier records whose own lines this metric cannot read: it
 * has never moved, and that is an answer rather than a pass. `unreadable` is a newest line the
 * entry's metric cannot read — the movement cannot be answered from it, and it is named rather
 * than treated as a number. Baseline records whose own numbers cannot be read are left out of the
 * nights-at-hand low-water (they are not measurements) and counted apart, so a broken line in the
 * middle of the history cannot quietly become the floor.
 */
export function readingMovement(entry, records, { limit = TREND_LIMIT, lowWater = {} } = {}) {
  const carried = records.filter((record) => record.readings[entry.id] !== undefined);
  const windowed = limit > 0 ? carried.slice(-limit) : carried;
  const points = windowed.map((record) => ({
    date: record.date,
    value: metricOf(entry, record.readings[entry.id]),
  }));
  const current = points[points.length - 1] ?? null;
  const earlier = points.slice(0, -1);
  const measured = earlier.filter((point) => point.value !== null);
  // The committed low-water wins where the file names this reading — that is the whole point of
  // recording it — and the nights at hand are the floor for a reading no file has recorded yet.
  const held = lowWater?.[entry.id] ?? null;
  const atHand = measured.length > 0 ? Math.min(...measured.map((point) => point.value)) : null;
  const floor = held !== null && Number.isInteger(held.value) ? held.value : atHand;
  const floorFrom =
    floor === null ? null : held !== null && Number.isInteger(held.value) ? "low-water" : "records";
  const value = current?.value ?? null;

  const status =
    current === null || floor === null
      ? "no-history"
      : value === null
        ? "unreadable"
        : value < floor
          ? "regressed"
          : value > floor
            ? "rose"
            : "held";

  return {
    id: entry.id,
    label: entry?.metric?.label ?? entry.id,
    status,
    current,
    floor,
    floorFrom,
    floorSince: floorFrom === "low-water" ? held.since : null,
    delta: floor === null || value === null ? null : value - floor,
    before: measured.length,
    records: carried.length,
    dropped: carried.length - windowed.length,
    unreadable: earlier.filter((point) => point.value === null).map((point) => point.date),
    from: measured[0]?.date ?? null,
    to: measured[measured.length - 1]?.date ?? null,
  };
}

/**
 * The command's whole answer: every declared reading's movement, and the verdict they add up to.
 *
 * `rows` is the registry's order — the order of the page's chart and the history table's columns,
 * so the three surfaces read alike — and `compared` is how many rows had a floor and a current
 * number to hold against it. `regressed` names the guards that stepped down, which is the only
 * thing that makes the command fail: the absence of a history to compare is reported, not red.
 *
 * `history` is the nightly table's text and `sources` records what the answer was read from: how
 * many records the runbook held, how many rows the table held, how many nights the table added that
 * the runbook never recorded, and how many declared readings were held against the committed
 * low-water `lowWater` names rather than against the nights at hand. The counts are the report's
 * provenance — an answer built from two files and a recorded floor has to say so, because a row a
 * reader cannot find in the runbook is otherwise unexplained — and `sources.history` of 0 is how a
 * machine tells a missing table from a reader who forgot to hand one in.
 */
export function trendReport(text, { limit = TREND_LIMIT, history = "", lowWater = {} } = {}) {
  const runbook = runbookRecords(text);
  const table = historyRecords(history);
  const records = mergeRecords(runbook, table);
  const rows = READINGS.map((entry) => readingMovement(entry, records, { limit, lowWater }));
  const compared = rows.filter((row) => row.floor !== null && row.current?.value !== null);
  const regressed = compared.filter((row) => row.status === "regressed");
  // …and the record the *other* answer on this page is written in, held against the very settlements
  // it claims to describe (`waitCrossingDrift`). It is the second reason this command can fail, and
  // deliberately not a row: a reading's movement is a measurement of the tree, while a crossing line
  // is the bar a night's *decision* reads — the level a comment has already been about — so a line the
  // records cannot produce is a level nothing has held, and the night that reads it is the one that
  // has to say so rather than measure against it.
  // …one series at a time, because a crossing belongs to one of them: each kind's lines are held
  // against that kind's own settlements, so a level the floor proposal's wait passed is never measured
  // against the collect proposals' records, or the other way round.
  const kinds = Object.keys(WAIT_CROSSING_HEADS);
  const crossings = waitCrossings(text);
  const waitDrift = kinds.flatMap((kind) =>
    waitCrossingDrift(settlementsOf(text, kind), waitCrossings(text, kind)),
  );
  const failing = regressed.length > 0 || waitDrift.length > 0;
  return {
    command: "coverage:trend",
    gate: failing ? "fail" : "pass",
    exitCode: failing ? 1 : 0,
    compared: compared.length,
    regressed: regressed.map((row) => row.id),
    waitDrift,
    sources: {
      runbook: runbook.length,
      history: table.length,
      added: table.filter((row) => !runbook.some((record) => record.date === row.date)).length,
      lowWater: READINGS.filter((entry) => lowWater?.[entry.id] !== undefined).length,
      waits: crossings.length,
    },
    rows,
  };
}

/** The mark a row carries: what the reading did against the nights before it. */
const MARKS = {
  regressed: "REGRESSED",
  held: "HELD",
  rose: "ROSE",
  "no-history": "NO HISTORY",
  unreadable: "UNREADABLE",
};

/** One row of the command's report: the movement in words, with the numbers behind it. */
function movementRow(row) {
  const mark = (MARKS[row.status] ?? row.status).padEnd(11);
  const head = `${mark} ${row.id}`.padEnd(34);
  if (row.status === "no-history") {
    if (row.current === null) {
      return `${head} no record at all — neither the runbook nor the history table has carried this reading`;
    }
    // The newest record is readable; what is missing is a number *before* it — either no earlier
    // record at all, or earlier records whose lines this metric cannot read. Those are two
    // different facts — a guard that has just started publishing, and a metric that stopped
    // reading its own line — and flattening the second into "the only record there is" would be
    // the one thing this module refuses everywhere else: a line it cannot read going unnamed.
    const before =
      row.unreadable.length === 0
        ? `the only record there is (${row.current.date}), nothing before it to move against`
        : `no earlier line this metric can read (${row.unreadable.length}: ${row.unreadable.join(", ")}) — nothing to move against`;
    return `${head} ${row.current.value ?? "?"} ${row.label} — ${before}`;
  }
  if (row.status === "unreadable") {
    return `${head} the newest line is not one this metric can read (${row.current.date}) — ${row.label} cannot be compared`;
  }
  const movement =
    row.status === "held"
      ? `level with the low-water ${row.floor}`
      : `${row.delta > 0 ? "up" : "down"} ${Math.abs(row.delta)} from the low-water ${row.floor}`;
  // A committed floor is not the nights at hand, so the row names it as what it is and says when it
  // settled: the reader cannot find this number in the records either file carries, and a row that
  // read like the records' own would send them looking for it.
  if (row.floorFrom === "low-water") {
    const against =
      row.status === "held"
        ? `level with the committed low-water ${row.floor}`
        : `${row.delta > 0 ? "up" : "down"} ${Math.abs(row.delta)} from the committed low-water ${row.floor}`;
    return `${head} ${row.current.value} ${row.label} — ${against} (recorded ${row.floorSince})`;
  }
  const span = row.from === row.to ? `${row.from}` : `${row.from} → ${row.to}`;
  const skipped = row.unreadable.length > 0 ? `, ${row.unreadable.length} baseline line(s) unreadable (${row.unreadable.join(", ")})` : "";
  return (
    `${head} ${row.current.value} ${row.label} — ${movement} of ${row.before} previous ` +
    `record(s) (${span})${skipped}`
  );
}

/**
 * What the answer was read from, as one line: the two surfaces' record counts, and how many nights
 * the table contributed that the runbook never recorded. It is printed whatever the counts are —
 * "the answer is the runbook's records alone" is a fact about the answer and not a detail — and a
 * night the table added is named, because that is the one a reader cannot account for from the
 * runbook they are holding.
 */
function sourcesLine(sources) {
  const added = sources.added > 0 ? ` — ${sources.added} night(s) the runbook never recorded` : "";
  // …and the other thing this answer was read from where the runbook holds one: the crossing lines,
  // because they are checked against the records on this run and a reader who cannot see that the check
  // happened cannot tell a clean record from a record nothing looked at. Absent when there are none,
  // which is the omission every other surface makes rather than a count of zero to read past.
  const waits =
    (sources.waits ?? 0) > 0 ? `, ${sources.waits} settled-wait line(s) checked against the records` : "";
  return (
    `  from ${sources.runbook} runbook record(s) and ${sources.history} nightly history row(s)` +
    added +
    waits
  );
}

/**
 * One drifting crossing as the command states it, per reason the records refute a line: the sentence
 * is the *first* leg the arithmetic fails, so a reader is told what is wrong rather than what follows
 * from it — a level the history never held, a median no night reached, a night the level first stood
 * somewhere else, or a line dated before the night it is about.
 *
 * `held` is the fixed point in every one of them, because it is the number the night's decision reads:
 * the crossing was *above* it, and the wait is commented on while the median is above everywhere a
 * comment has already been. The two refusals of a level are kept apart — the level the records never
 * held and, where the line states the very first night the series has, a level with no history behind
 * it at all — because the second is a line about a night the record does not have.
 */
const WAIT_DRIFT_NOTES = {
  unreached: (seen) =>
    `the records hold no night whose middle is ${seen.latest} night(s), so the crossing it states ` +
    "never happened",
  unpassed: (seen) =>
    `it states a median of ${seen.latest} night(s) against the ${seen.held} it says it passed, and a ` +
    "crossing is a median strictly above the level behind it",
  unheld: (seen) =>
    seen.worst === null
      ? "it states the first night the records hold — a crossing is measured against the nights before " +
        "it, and there are none"
      : `the worst the records had held before that night is ${seen.worst} night(s), not the ${seen.held} ` +
        "it says it passed",
  unsince: (seen) =>
    `the records first held ${seen.held} night(s) on ${seen.first}, not on the ${seen.since} it states`,
  premature: (seen) =>
    `it is dated ${seen.date}, before the night the middle of the ages moved (${seen.movedOn})`,
};

/**
 * One drifting line, named as both surfaces name it: the request and the night the runbook holds it
 * under, which is the pair a reader looks the line up by.
 */
function waitDriftWhere(finding) {
  const { crossing } = finding;
  // Two ways of naming a line, because the two kinds' lines name different things: the floor's a
  // request its comment was left on, the collect's the series itself — there being no request of this
  // job's own in that story to point at.
  return crossing?.kind === "collect"
    ? `the collect-budget wait on ${crossing.date}`
    : `#${crossing.number} on ${crossing.date}`;
}

/**
 * What is wrong with one drifting line, as the *first* leg the arithmetic fails — one sentence behind
 * every surface that states the finding, so the command's log and the run page cannot come to describe
 * the same line two ways. A reason this module has no note for is stated as itself rather than dropped:
 * a finding is not something to swallow for want of a sentence.
 */
function waitDriftNote(finding) {
  const note = WAIT_DRIFT_NOTES[finding.reason];
  return note === undefined ? String(finding.reason) : note(finding.seen);
}

/**
 * The record's own red, as the lines between the sources line and the rows.
 *
 * One line per drifting crossing — the line as the runbook holds it, then the first thing about it the
 * records cannot produce — and then the rule and the repair, because "the records do not produce this"
 * is a fact about the runbook whose consequence a reader has to be told: the bar is what the night's
 * comment is decided by, so a bar nothing has held either silences a crossing that is really new or
 * says one that has already been said. It leads the rows for the reason every warning on this page
 * leads what it is about: the readings below are measurements of the tree, and this is the line the
 * *decision* reads — the one failure here that a table of movements cannot show.
 */
function waitDriftLines(findings) {
  return [
    ...findings.map((finding) => `  ${waitDriftWhere(finding)} — ${waitDriftNote(finding)}`),
    "",
    "  A crossing line is the bar this job's own reading is written in — the level one of the two waits",
    "  has already been told about, which is why the level is recorded once per crossing rather than on",
    "  every night the wait stands — and the night that said the crossing wrote it from these records.",
    "  A line they cannot produce is a level nothing has held, and it fails in both directions: too high",
    "  and a crossing that is really new is never said, too low and one already said is said again. So",
    "  the line is fixed against the settlement records rather than the other way round, and the night",
    "  fails until it is: re-derive it from the records, or delete it and let the next rise say the",
    "  crossing again. Each line is held against its own kind's settlements, the two waits being watched",
    "  separately.",
  ];
}

/**
 * The command's report, as text: the verdict, then one row per declared reading.
 *
 * The verdict leads, the way the runner's own does — the counts first, then the names — so a
 * morning reader knows whether anything moved before reading the rows, with the sources line under
 * it saying what the answer was read from and which of the answer's nights the runbook itself never
 * recorded. A failure also says what the baseline is and what to do about it, because "below the
 * low-water" is a fact about the runbook and the reader needs the rule to act on it.
 *
 * **Two reds, and they are not the same question.** A reading below its floor is a measurement of the
 * tree, and the paragraph after the rows is that one's rule and repair. The settled-wait record is the
 * other: the lines the job's own decision is written in, held against the settlements they claim to
 * describe, whose failure is that a *level* — the bar a comment is decided by — is one nothing has
 * held. That block leads the rows instead of following them, and the verdict names both when both
 * happen: a reader has to be able to tell which red they have, and the floor's paragraph would be the
 * wrong repair for a record the records refute.
 */
export function renderTrendReport(report) {
  const total = report.rows.length;
  const drift = report.waitDrift ?? [];
  const readings =
    report.compared === 0
      ? `coverage:trend: 0 of ${total} reading(s) compared — no declared reading has a floor or an ` +
        "earlier night to be held against, so there is nothing to answer."
      : report.regressed.length > 0
        ? `coverage:trend: ${report.regressed.length} of ${report.compared} compared reading(s) regressed ` +
          `below their low-water: ${report.regressed.join(", ")}.`
        : `coverage:trend: ${report.compared} of ${total} reading(s) compared against their low-water, ` +
          "none regressed.";
  const head =
    drift.length === 0
      ? readings
      : `${readings} ${drift.length} settled-wait line(s) the settlement records do not produce, which is ` +
        "this run's red:";
  const lines = [head, sourcesLine(report.sources)];
  if (drift.length > 0) lines.push(...waitDriftLines(drift));
  lines.push(...report.rows.map(movementRow));
  if (report.regressed.length > 0) {
    lines.push(
      "",
      "  The floor is the reading's committed low-water: the lowest level its records have settled to,",
      "  so a fall below it fails the night that measured it while a return to a level it has held does",
      "  not. A reading that really stepped down is a decision to write down — `npm run",
      "  coverage:low-water` records the new level from the records, in the same commit as that night.",
    );
  }
  return lines.join("\n");
}

/** The word a proposal row uses for what the recorder would do to that reading's floor. */
const FLOOR_MOVES = {
  down: "lowered it",
  up: "raised it",
  new: "named it for the first time",
  dropped: "dropped it — no readable record any more",
};

/**
 * The floors the records now derive, and whether that is a proposal to make.
 *
 * `rows` is one entry per declared reading whose floor the derivation would move, in the registry's
 * order, each with the level it holds now (`was`, or `null` when the file names no floor for it) and
 * the level it would hold (`now`, or `null` when no record states one any more) — so the body of a
 * proposal can be read as the file's diff in a table, which is what a reviewer is being asked to
 * accept. A reading whose two levels are the same is not a row: a floor that does not move is not a
 * change to review, however the file around it is ordered.
 *
 * Three statuses, and `changed` is the one the caller acts on:
 *
 *   - `proposed` — the derivation differs from the file, so the floors are written and a proposal is
 *     owed. The lines it would *lower* are named apart (`stepped`), because that is the movement
 *     this exists for: a raise or a drop the same derivation would make is a line of the same edit
 *     and has to be visible beside it, not silently folded in.
 *   - `unchanged` — the file already states the derivation, so nothing is written and no pull
 *     request is owed. A night that has been recorded by hand, or a second run of the same night,
 *     reads this way.
 *   - `refused` — the derivation names no reading at all while the file names some. That is not a
 *     tree with floors of zero: it is records whose every line the metrics could not read (or a
 *     runbook that was handed in empty), and recording it would *erase* the floors the file holds,
 *     which is the one direction a ratchet must never move by accident. Nothing is written.
 *
 * `report` is the trend answer the proposal was earned by, when the caller has one: its `regressed`
 * ids are carried through for the body (`regressed`), which is what lets the proposal say whether a
 * step down is why it exists rather than a derivation somebody ran on request.
 *
 * @param {Object} [options]
 * @param {{ regressed?: string[] }|null} [options.report] the trend answer, when a caller has one
 * @param {Record<string, { value: number, since: string }>} [options.committed] the floors the file states
 * @param {Record<string, { value: number, since: string }>} [options.derived] the floors the records derive
 */
export function floorProposal(options = {}) {
  const { report = null, committed = {}, derived = {} } = options;
  // A caller with no answer to hand over is a caller that ran the recorder rather than answering a
  // night, and `null` is the one way the rest of this function says so: `undefined` and `null` are
  // the same thing here, and the renderer reads the pair the same way.
  const answer = report ?? null;
  const rows = [];
  for (const entry of READINGS) {
    const was = committed?.[entry.id] ?? null;
    const now = derived?.[entry.id] ?? null;
    if (was === null && now === null) continue;
    if (was !== null && now !== null && was.value === now.value) continue;
    const kind =
      was === null ? "new" : now === null ? "dropped" : now.value < was.value ? "down" : "up";
    rows.push({
      id: entry.id,
      label: entry?.metric?.label ?? entry.id,
      kind,
      move: FLOOR_MOVES[kind],
      was,
      now,
      delta: was === null || now === null ? null : now.value - was.value,
    });
  }

  const status =
    rows.length === 0
      ? "unchanged"
      : Object.keys(derived ?? {}).length === 0
        ? "refused"
        : "proposed";

  return {
    status,
    changed: status === "proposed",
    rows,
    stepped: rows.filter((row) => row.kind === "down").map((row) => row.id),
    regressed: answer?.regressed ?? [],
    before: renderLowWater(committed ?? {}),
    after: renderLowWater(derived ?? {}),
  };
}

/** One proposal row as the body's table line: the floor it held, the one it would hold. */
function floorRow(row) {
  const was = row.was === null ? "—" : `${row.was.value} (${row.was.since})`;
  return `| \`${row.id}\` | ${was} | ${row.now === null ? "—" : row.now.value} | ${
    row.now === null ? "—" : row.now.since
  } | ${row.move} |`;
}

/** The one word each movement takes in a drift line, where the proposal's table has a sentence. */
const FLOOR_VERBS = {
  down: "lowered",
  up: "raised",
  new: "named",
  dropped: "dropped",
};

/**
 * The recorder's diff, as the message a stale committed file fails with.
 *
 * The suite's byte comparison is where a `.freebuff/coverage-low-water.json` that no longer states
 * the records goes red, and what it said there was the comparison and nothing else: two long JSON
 * texts for a reader to diff by eye, naming neither the reading whose floor moved nor the command
 * that writes the file back. This is the same derivation `floorProposal` already computes for the
 * night's proposal, said as the message that red leaves on the spot — one line per reading whose
 * floor the derivation would move, then the recorder that writes them.
 *
 * Two things it must not do, and both are pinned by cases. It cannot invent a movement: a file that
 * differs from the derivation in a line a floor does not state — a `since` date at an unchanged
 * level, the note, the order of the entries — has no rows, and the message says so rather than
 * printing an empty diff under a verdict about one. And it cannot promise that the recorder *is* the
 * repair, because it is not the whole of it: a floor the diff lowers is a decision rather than an
 * errand, which is why the nightly job opens the same diff as a proposal for review instead of
 * writing a gate down on its own. The message says both.
 *
 * @param {any} proposal the proposal `floorProposal` answered with
 */
export function renderFloorDrift(proposal) {
  const rows = proposal?.rows ?? [];
  if (rows.length === 0) {
    return [
      `the committed low-water (${LOW_WATER_FILE}) is not what the records derive, but no reading's`,
      "floor moved: the difference is in a line a floor does not state — a `since` date at an",
      "unchanged level, the note, the order of the entries. `npm run coverage:low-water` rewrites",
      "the file from the records, and that is the whole repair.",
    ].join("\n");
  }
  return [
    `the committed low-water (${LOW_WATER_FILE}) is not what the records derive — the recorder`,
    `would move ${rows.length} floor(s):`,
    "",
    ...rows.map((row) => {
      const was = row.was === null ? "no floor" : `${row.was.value} (${row.was.since})`;
      const now = row.now === null ? "no floor" : `${row.now.value} (${row.now.since})`;
      return `  ${row.id}`.padEnd(26) + `${was} → ${now} — ${FLOOR_VERBS[row.kind] ?? row.kind}`;
    }),
    "",
    "`npm run coverage:low-water` writes exactly those floors, from these records. A line the diff",
    "lowers is a decision rather than an errand, so the nightly job opens the same diff as a pull",
    "request instead of rewriting a gate on its own: this red and that proposal are one discrepancy,",
    "and a person is the one who answers it.",
  ].join("\n");
}

/**
 * The proposal, as Markdown: the pull request's body, and the run page's section.
 *
 * It is rendered from the derivation and the answer it was earned by rather than from the files on
 * disk, so a case can hold the exact text a reviewer will read: the verdict and the rows that moved
 * first, then the trend's own report fenced under it, then what the merge does and does not change.
 * The `unchanged` and `refused` bodies are short by design — they are the run saying it owed
 * nothing, and a page that rendered a table under either would read like a proposal nobody made.
 *
 * The wording of the first line is the report's: a proposal a red trend earned says so, and one a
 * person ran by hand over a green tree does not claim a fall it never measured.
 *
 * @param {Object} [options]
 * @param {{ regressed?: string[] }|null} [options.report] the same answer the proposal was derived from
 * @param {any} options.proposal the proposal `floorProposal` answered with
 */
export function renderFloorProposal(options = {}) {
  const { report = null, proposal } = options;
  const answer = report ?? null;
  if (proposal.status === "unchanged") {
    return [
      "## Coverage floor — nothing to record",
      "",
      "The records already state the floors `.freebuff/coverage-low-water.json` holds: no declared",
      "reading's line would move, so nothing was written and no proposal is owed.",
      "",
    ].join("\n");
  }

  if (proposal.status === "refused") {
    return [
      "## Coverage floor — nothing recorded",
      "",
      "The records state no readable level for any declared reading, so recording what they derive",
      "would erase the floors the file holds rather than lower one. Nothing was written: the file",
      "holds the numbers it was checked in with, and the red run stands for a person to read.",
      "",
    ].join("\n");
  }

  return [
    "## Proposed coverage floor",
    "",
    (answer?.regressed ?? []).length > 0
      ? "`npm run coverage:trend` failed after tonight's record: " +
        `${proposal.stepped.join(", ")} stepped below the floor the records had settled to.`
      : "No reading the trend command could compare is below its floor: the floors the file holds " +
        "are not the ones the records state, which is the red the suite's byte comparison raises.",
    "",
    "The floors below are the ones those records derive — the number `npm run coverage:low-water`",
    "writes — recorded as a pull request instead of left for somebody to run the recorder by hand",
    "the morning after the red.",
    "",
    "**Merging this lowers a gate, which is why it is a proposal and not a commit on the branch.** A",
    "floor is what a reading's next night is held against: this accepts the lower level as the level",
    "the reading has settled to, so a fall below *that* is what the next night fails on. The red",
    "stands until this lands — the committed file is not what the records derive, which is what the",
    "suite's byte comparison raises over this branch — and merging this is the decision that answers",
    "it.",
    "",
    "| reading | committed floor | proposed floor | holds since | the recorder |",
    "| :-- | --: | --: | :-- | :-- |",
    ...proposal.rows.map(floorRow),
    "",
    ...(answer === null
      ? []
      : ["The answer it was proposed from:", "", "```text", ...renderTrendReport(answer).trimEnd().split("\n"), "```", ""]),
    "`src/test/coverage-low-water.test.ts` holds `.freebuff/coverage-low-water.json` to the records",
    "byte for byte, so the suite is red on this branch until the re-record lands — which is this",
    "change. It is that command's output and nothing else: regenerate it by hand with `npm run",
    "coverage:low-water`.",
    "",
    "<sub>proposed by `.freebuff/coverage-trend.mjs --propose-low-water`, from the nightly job</sub>",
    "",
  ].join("\n");
}

/**
 * How many nights a floor proposal may sit unmerged before the run page names it out loud.
 *
 * Three, because one night is not a pattern: a request may simply have been opened after this
 * morning's reader looked at the page, and re-firing once is the same request restated. By the
 * third night the job has re-derived the same floors three times with nobody answering, which is
 * what a run page should say in one line instead of leaving in a pull request nobody opened. It is
 * a *night count* rather than a deadline: nothing here closes, rebases or expires anything — the
 * job only stops being quiet about it.
 */
export const STALE_NIGHTS = 3;

/**
 * How many nights a floor proposal may sit before the night's comment stops being a note and starts
 * naming a person.
 *
 * A week, and deliberately a long way past `STALE_NIGHTS`: three nights is the job saying out loud
 * that nobody has answered, which a person reading the run page in the morning sees, and seven is
 * the job doing something about it. It is the same night count and the same "nothing expires" rule
 * — what changes is only where the night's signal lands.
 *
 * The escalation is a mention, because that is the one thing a comment can do that a page cannot:
 * a *new* comment notifies nobody who was not already watching the request, and the person who can
 * answer a floor proposal is usually the repository's owner rather than whoever happens to open the
 * run page. Naming somebody is the whole of it — nothing here assigns, labels, closes, re-requests
 * review or touches the branch, and a request somebody has answered stops being commented on the
 * next night simply because there is nothing left to re-fire.
 */
export const ESCALATED_NIGHTS = 7;

/**
 * `@name` for a handle that reads as one, and `""` for anything else.
 *
 * The handle comes from outside — the run's own `GITHUB_REPOSITORY_OWNER`, or whatever a caller
 * passes as `--owner` — and the mention *is* the escalation, so a string that is not a handle must
 * not be pasted into a comment as if it named somebody. GitHub's own rule is the shape accepted
 * here: letters, digits and hyphens, at most 39 characters, not starting or ending with a hyphen.
 * A display name, a list, a URL or an empty string therefore renders *no* mention, and the caller
 * is told the escalation had nobody to name rather than the comment quietly citing a person who
 * does not exist.
 *
 * @param {unknown} handle a bare handle, with or without a leading `@`
 * @returns {string} the mention, or `""` when the text is not a handle
 */
export function mentionOf(handle) {
  const name = String(handle ?? "")
    .trim()
    .replace(/^@+/, "");
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(name) ? `@${name}` : "";
}

/** A whole day, in milliseconds, for the night arithmetic below. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day an instant falls on, as `YYYY-MM-DD`, or `null` when the text is not a date. */
function utcDay(text) {
  const at = Date.parse(String(text));
  return Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);
}

/**
 * How many whole *nights* apart two instants are — the age of a proposal the job has re-fired.
 *
 * Whole UTC dates rather than a 24-hour span, and that is the reason this is a function rather
 * than one subtraction: the nightly job runs at 02:17 UTC, so the request last night's run opened
 * is nineteen and a half hours old when tonight's re-fires it — a span that floors to *zero* days
 * and would report "opened today" through the first two nights of its life. Counting dates keeps a
 * night meaning the night the job ran on, which is how every sentence around this reads.
 *
 * `null` when either end is not a date: an age read from something unreadable is not a small age,
 * so a caller that cannot compute one refuses instead of nudging from a guess.
 *
 * @param {string} created when the request was opened
 * @param {string} today the night it re-fired
 * @returns {number|null} whole nights, or `null` when a date could not be read
 */
export function nightsBetween(created, today) {
  const from = utcDay(created);
  const to = utcDay(today);
  if (from === null || to === null) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The night the proposal re-fired, as the comment it leaves on the request.
 *
 * A comment per night rather than an edit of the last one, which is the whole of why it exists:
 * editing the request's body or an existing comment notifies nobody, so a proposal nobody has read
 * stays exactly as quiet as it was. This is the night's own note — the same table restated, said
 * out loud — and it is deliberately short, because the numbers a reviewer needs are in the body
 * above it, which the same night rewrote.
 *
 * The night count is the request's age, not a threat: night 1 is the night it was opened, so the
 * first *re-fire* is night 2.
 *
 * Past `ESCALATED_NIGHTS` the same comment changes voice instead of gaining a second one: the
 * heading carries the age, the first paragraph says the note has become a mention and why, and the
 * footer says which threshold it is past — every line below that is byte for byte the note the
 * younger nights get, so what a reviewer reads is one comment that grew louder rather than two
 * texts to reconcile. `owner` is the *handle* (a mention is rendered from it, and a string that is
 * not a handle renders none): the caller is told about a nameless escalation rather than the
 * comment citing somebody who cannot be notified.
 *
 * @param {{ number: string, nights: number, created: string, escalated?: boolean, owner?: string }} nudge
 */
export function renderNudgeComment({ number, nights, created, escalated = false, owner = "" }) {
  const night = nights + 1;
  const mention = escalated ? mentionOf(owner) : "";
  return [
    escalated
      ? `## The floor proposal re-fired tonight — night ${night} · unmerged for ${nights} nights`
      : `## The floor proposal re-fired tonight — night ${night}`,
    "",
    ...(escalated
      ? [
          `${mention === "" ? "This request" : `${mention} — this request`} has sat unmerged for ${nights} nights.`,
          // The escalation said honestly, both ways round: an escalation that named nobody while
          // reading as if it had would be worse than one that admits it, since nobody would look for
          // the person it never told.
          ...(mention === ""
            ? [
                "Every one of those nights this job has re-derived the same floors and re-asked the same",
                "question, and the red on this branch has stood the whole time — the night should be naming",
                "a person here, and this run had no owner handle to name, so it says that instead of",
                "mentioning nobody.",
              ]
            : [
                "Every one of those nights this job has re-derived the same floors and re-asked the same",
                "question, and the red on this branch has stood the whole time — so tonight's comment names",
                "a person instead of posting another note nobody has read.",
              ]),
          "",
        ]
      : []),
    "The nightly job re-derived the floors from tonight's records and they are still the ones this",
    `request carries: nothing about what is being asked for has changed since it was opened on`,
    `${created}, and the body above is tonight's derivation — the step rewrites it in place every`,
    "night this fires, so read that table rather than the diff you first saw.",
    "",
    "**A floor is a gate, so this is a decision rather than an errand.** Merging accepts the lower",
    "level as the level those readings have settled to, and the discrepancy this request exists for",
    "is answered. Closing it means the other answer: the floors you would rather hold, written by",
    "`npm run coverage:low-water` over this tree and committed with the file it writes.",
    "",
    "For as long as it stays open the committed file is not what the records derive, so the suite's",
    "byte comparison is red on it every night — this comment is the job saying so, not a second",
    "finding.",
    "",
    `<sub>#${number} · night ${night}` +
      (escalated
        ? ` · past the ${ESCALATED_NIGHTS} nights this job only comments through` +
          (mention === "" ? ", and no owner handle to name in this run" : "")
        : "") +
      " · posted by the nightly job · `.freebuff/coverage-trend.mjs --nudge`</sub>",
    "",
  ].join("\n");
}

/**
 * The request as the run page names it, once it has sat past `STALE_NIGHTS`.
 *
 * The second half of getting louder, and the half that outlives one pull request's notifications:
 * the page a person reads in the morning says the proposal is still open, how long it has sat, and
 * that the red above it is this request's business rather than anything new tonight. It names no
 * numbers on purpose — they are the proposal body's, which the step rewrote a moment earlier — and
 * it names the one command that answers it without a merge.
 *
 * Past `ESCALATED_NIGHTS` it also says where tonight's signal went: a page cannot notify anybody,
 * and a reader looking at this section should know that the request now names a person — otherwise
 * the escalation is invisible to exactly the person reading the page instead of their inbox.
 *
 * @param {{ number: string, nights: number, created: string, escalated?: boolean, owner?: string }} nudge
 */
export function renderNudgePage({ number, nights, created, escalated = false, owner = "" }) {
  const mention = escalated ? mentionOf(owner) : "";
  return [
    `## Floor proposal — ⏳ #${number} has sat unmerged for ${nights} nights`,
    "",
    "The nightly job has re-derived the floors this request carries on every night since it was",
    `opened on ${created}, and filed them as a request again tonight rather than committing them`,
    "itself, because a floor is a gate. The suite's byte comparison is red on the same discrepancy",
    "every night until somebody answers it, so what the report above is red about is this request's",
    "business rather than a new finding.",
    "",
    ...(escalated
      ? [
          `Past the ${ESCALATED_NIGHTS} nights this job only comments through, tonight's comment ` +
            (mention === ""
              ? "names nobody — this run had no owner handle to mention"
              : `names \`${mention}\` on the request`) +
            ", so the answer is being asked of a person rather than left on this page.",
          "",
        ]
      : []),
    "- What it asks for: `.freebuff/coverage-low-water.json` re-recorded from the records — `npm run",
    "  coverage:low-water` over this tree writes exactly the diff the branch carries.",
    `- Where to answer: #${number}, from the body the same step rewrote tonight.`,
    "",
    `<sub>named here because it has gone unmerged past the ${STALE_NIGHTS} nights this job waits · ` +
      "`.freebuff/coverage-trend.mjs --nudge`</sub>",
    "",
  ].join("\n");
}

/**
 * The night's nudge: how long the open proposal has sat, the comment it gets tonight — a mention
 * once the age is past `ESCALATED_NIGHTS` — and the run-page section once it has sat past
 * `STALE_NIGHTS`.
 *
 * `null` for a caller that named no request or handed over a date that is not one, because every
 * sentence this answers with is a claim about that age — and a nudge built from a guess would be
 * the job telling a reviewer something it does not know. The handle is optional for the opposite
 * reason: an age is knowable and an owner may not be, so an escalation is answered without one —
 * every sentence that is true of the request still stands — and `owner` comes back `""` for the
 * caller to report.
 *
 * @param {Object} [options]
 * @param {string|number} [options.number] the open request's number
 * @param {string} [options.created] when it was opened (`gh pr view --json createdAt`)
 * @param {string} [options.today] the night this is being written for; today, by default
 * @param {string} [options.owner] the handle to name once the age is past `ESCALATED_NIGHTS`
 */
export function proposalNudge(options = {}) {
  const number = options.number === undefined || options.number === null ? "" : String(options.number).trim();
  const now = options.today ?? new Date().toISOString();
  const created = utcDay(options.created);
  const nights = nightsBetween(options.created, now);
  if (number === "" || nights === null) return null;
  const escalated = nights >= ESCALATED_NIGHTS;
  return {
    number,
    created,
    today: utcDay(now),
    nights,
    stale: nights >= STALE_NIGHTS,
    escalated,
    // The mention the comment carries, or `""` when the age has not earned one *or* the handle it
    // was handed is not a handle: the caller reports the second case rather than the comment
    // naming somebody who cannot be notified.
    owner: escalated ? mentionOf(options.owner) : "",
    comment: renderNudgeComment({ number, nights, created, escalated, owner: options.owner }),
    page: nights >= STALE_NIGHTS ? renderNudgePage({ number, nights, created, escalated, owner: options.owner }) : null,
  };
}

/**
 * A settlement record's own head, per kind: `- **<date> — floor proposal #<n>: merged after <k>
 * nights.**` and `- **<date> — collect-budget proposal on #<n>: answered after <k> nights.**`.
 *
 * One pattern per kind, and it is the whole of what makes a line a settlement record of that kind:
 * the marker the dedupe matches against, and the shape a person greps the runbook for when the
 * question is how long these requests actually sit. Both are deliberately **not** the shape
 * `runbookRecords` reads — that reader's head is a `ci verdict:` — so a night's answer to a proposal
 * contributes no reading to the floors and cannot move a floor: a record of *when the job was
 * answered* is not a measurement of anything the job measures. Two patterns rather than one with the
 * kind in a group, because the kind is what a line is *about*: a floor proposal #23 and a collect
 * proposal on #23 are different requests that can share a number, so the head has to say which story
 * it belongs to before its fields mean anything.
 */
/**
 * The two outcome words the *reader* adds to a collect reply's own vocabulary, named because more than one
 * reader of this module asks about them.
 *
 * `COLLECT_ANSWERED_OUTCOME` is what a reply that declared nothing at all is recorded as — the plain word
 * every such record has always read as — and `COLLECT_CLOSE_OUTCOME` is the other ending: a pull request
 * that went away with the ask still standing. The second is the only collect word that says anything about
 * the *pull request* rather than about the ask (`SETTLEMENT_KINDS.collect.ends`), which is why it is a
 * constant rather than a literal repeated at the head, at the record and at the table that reads it.
 */
const COLLECT_ANSWERED_OUTCOME = "answered";
const COLLECT_CLOSE_OUTCOME = "closed unanswered";

/**
 * The words a collect proposal's record can state as its outcome: the apply job's own vocabulary (every
 * word a reply can declare) plus the two the *reader* adds — `answered` for a reply that declares nothing
 * at all, which is what every record of such a reply has always read as, and `closed unanswered` for the
 * other ending, a pull request that went away with the ask still standing.
 *
 * Imported rather than copied, so a status the applier learns is a word the runbook can read back the day
 * it exists — and a word this list does not hold is one the reader turns into `unknown` rather than into a
 * record nothing could read again, which is what keeps the dedupe honest.
 */
const COLLECT_OUTCOMES = [...APPLY_STATUSES, COLLECT_ANSWERED_OUTCOME, COLLECT_CLOSE_OUTCOME];

const SETTLEMENT_HEADS = {
  floor: /^- \*\*(\d{4}-\d{2}-\d{2}) — floor proposal #(\d+): (merged|closed) after (\d+) night/,
  // Built from the vocabulary above rather than spelled out, so the words a record can state and the
  // words this pattern accepts cannot be two lists: a status added to the applier's own table is readable
  // back here without a second edit, and one this pattern refused would make the dedupe write the same
  // settlement again every night it saw it.
  collect: new RegExp(
    `^- \\*\\*(\\d{4}-\\d{2}-\\d{2}) — collect-budget proposal on #(\\d+): (${COLLECT_OUTCOMES.join(
      "|",
    )}) after (\\d+) night`,
  ),
};

/**
 * The head of a *close* record: the pull request behind a collect-budget proposal, gone after the ask there
 * was answered.
 *
 * Deliberately not an entry of `SETTLEMENT_HEADS`, and the reason is the one that table states for itself: a
 * settlement line is about the *ask* — its day is the day the ask ended, its `nights` are the ask's age, its
 * outcome is the word a reply declared — while this line is about the pull request the ask sat on, which can
 * outlive the answer by weeks. Folding the close into the settlement head would give one record two meanings
 * and move arithmetic nothing should move: a settlement is counted by the distribution, charted by the median
 * trend, held against the crossing record and deduped so that one ask stays one line, and a close is none of
 * those things. So it is a record of its own, read by the one reader that asks what it states
 * (`proposalThreadEnding`, through `pullCloses`), and — like `WAIT_CROSSING_HEADS` — invisible to every other
 * reader in this module.
 *
 * A floor proposal needs no such line, and that is not an omission: a floor proposal *is* the request it asks
 * about, so its settlement is the end of the ask and of the pull request at once, and a second line would
 * have nothing left to state. Which kind does need one is a row of `SETTLEMENT_KINDS` (`closes`).
 */
const PULL_CLOSE_HEAD =
  /^- \*\*(\d{4}-\d{2}-\d{2}) — the pull request behind collect-budget proposal #(\d+) closed, after the ask there was answered/;

/**
 * How each kind's request is *named* in a statement about the pull request under it.
 *
 * The two kinds say it differently because the request is a different thing: a floor proposal is a request
 * this job opened itself, while a collect-budget proposal is a comment left on somebody else's pull request
 * — which is the whole reason only the second kind's thread can be stated on its own at all. One place for
 * the words, so the line a writer renders and the head a reader matches can only agree.
 */
const THREAD_NOUNS = {
  collect: (number) => `the pull request behind collect-budget proposal #${number}`,
  floor: (number) => `floor proposal #${number}`,
};

/**
 * The other half of `PULL_CLOSE_HEAD`, and the reason it exists: **the record of a thread has to be able to
 * say the thread came back.**
 *
 * A close line is written once per close and read as the end of a thread, and a pull request can be
 * reopened: the close stays in the file as the history it is, while the *standing* word about the request
 * has to stop being "gone", or every later night goes on treating a live thread as one nobody will read
 * (`proposalThreadEnding`). So the reopening is a record of its own, appended by the settle step the night
 * it sees the request open again (`recordPullReopens`), and the readers walk the two heads in file order and
 * take the *last* statement per number — the same rule the settlement lines already keep for two lines
 * about one request.
 *
 * Its own day is the night the job noticed, and it is the one date in this file that cannot be GitHub's:
 * a request carries `closedAt` and nothing for a reopening, so the fact is "as of this run, this request is
 * open again" and it is dated by the run — the clock the crossing line is written on (`--today`, the same
 * flag) rather than a day the feed states. The close it supersedes is quoted in the head, so a reader has
 * both days and can tell which statement came first without trusting either one's clock.
 *
 * The noun alternation is what lets one head read both kinds: the sentence names the request the way that
 * kind's lines name it (`THREAD_NOUNS`), and nothing else about the line differs. A request named here is
 * the pull request the closure was about, which is why the field the reader wants back is the close's day.
 */
const PULL_REOPEN_HEAD =
  /^- \*\*(\d{4}-\d{2}-\d{2}) — (?:the pull request behind collect-budget proposal|floor proposal) #(\d+) reopened, after the close recorded for (\d{4}-\d{2}-\d{2})\.\*\*/;

/**
 * The two kinds of request the runbook's settlement record holds, each with the things that differ
 * between them: the head its lines are read by, the flag the night records it with, how one of GitHub's
 * own requests is read into the days the record is made of, the reader that turns those days into a
 * line, the page section that states its history, the judgement of the wait's own crossing record
 * (`waitDrift`, over that kind's own settlements and that kind's own lines), and the *name* a finding
 * about this kind is announced under — the night's log line and its GitHub annotation have one sentence
 * between two steps, so which kind's wait moved has to be readable off it. Everything else — the dedupe,
 * the append, the chronological order, the exit codes, the artifact, the median trend, the warning it
 * raises and the output the step below reads to decide whether to post — is one writer for both, because
 * the question they answer is one question: how long did a request this job raised sit before somebody
 * answered it.
 *
 * Two rows are *capabilities* rather than names, and both are about the crossing record, which is the
 * half of a kind's story that lives outside this table (`WAIT_CROSSING_HEADS`, `CROSSING_WORDS`): the
 * request a risen wait can be *said* on, with the comment it gets there, and — for the kind whose wait
 * has no comment to be said in — the absence of that row, which is what makes its crossing a rise the
 * page and the annotation state rather than a comment it leaves. A kind with no comment to leave is a
 * kind whose wait has nowhere of its own to be said, so the comment machinery skips it rather than
 * inventing a target; its crossing is still recorded, and its section still refutes the lines.
 *
 * `closes` is a third capability of the same shape, one request further out: whether the *pull request* a
 * kind's asks sit on can outlive an answer to one of them, which is true of an ask left as a comment on
 * somebody else's pull request and not of a request this job opens for itself. A kind with the row records
 * the close (`recordPullCloses`, appending what `pullCloses` reads back); a kind without it records nothing
 * further, because its own settlement line is already the end of both. The row is what keeps that judgement
 * out of the recording call, where a condition on the kind would be the first of its kind in this file.
 *
 * `reopens` is the fourth, and it is on **both** kinds — a request can be reopened whoever raised it — while
 * the kind decides only the noun its line names (`THREAD_NOUNS`). It is a capability of the same shape as
 * `closes` because what it corrects is the *thread* rather than the ask: tonight's list says the request is
 * open while the file still says its thread is over, and the line records that the record's own word has
 * been contradicted (`recordPullReopens`, appending what `pullThreads` reads back). A kind without the row
 * would keep the permanence `PULL_CLOSE_HEAD` was written with: every later night treating a live thread as
 * one nobody will read.
 *
 * `settled` is where the two kinds' *evidence* differs, and it is why there is a table rather than one
 * reader both kinds pass through. A floor proposal is answered by the merge or the close of the very
 * request it opened — `gh pr list --json number,createdAt,closedAt,mergedAt` states that whole story
 * in the pull request's own fields — while a collect proposal is a comment this job leaves on somebody
 * else's pull request, so its days have to be read out of that request's *comments* (the two markers
 * that say which comment is the proposal and which is the reply live in `.freebuff/collect-apply.mjs`,
 * with the poster that writes them) and its close is only ever an unanswered end. Both mappers hand
 * their reader the same three days — when the job asked, when the question ended, and what ended it —
 * which is what lets the writer, the page and the CLI be one implementation.
 *
 * `ends` is the one row where the two kinds say different things about the *same* pull request, and it belongs
 * to this table rather than to the caller for that reason: a floor proposal's line is the request's own life —
 * it is the pull request, merged or dropped — so any of those settlements means the thread is over, while a
 * collect proposal's line is the ending of an *ask left as a comment* on somebody else's pull request, where a
 * reply ends the ask and leaves the thread standing and only `closed unanswered` ends both. A reader that asked
 * "does any settlement name this number" would get the second kind wrong in both directions: it would call a
 * live pull request closed, and it would keep a comment standing on a thread nobody is watching.
 */
const SETTLEMENT_KINDS = {
  floor: {
    head: SETTLEMENT_HEADS.floor,
    mode: "--settle-floor",
    label: "floor proposals",
    // A floor proposal's line is the request's own life, so every one of them ends the thread: merged or
    // dropped, the pull request the comment would be written to is over either way.
    ends: () => true,
    settled: (request) => ({
      number: request?.number,
      created: request?.createdAt,
      // A merged request states both days; a dropped one only the close, which is the day it was
      // answered either way — so the age is read against the day the request stopped waiting.
      closed: request?.mergedAt ?? request?.closedAt,
      merged: request?.mergedAt ?? null,
    }),
    read: floorProposalSettlement,
    section: renderFloorSettlementSection,
    // …and the one request a risen wait can be *said* on, out of the same list the settlements were
    // read from. A floor proposal is a request this job keeps open itself — one branch, rewritten
    // every night the floors disagree — so the entry that states neither a close nor a merge is the
    // request still waiting for an answer, and `createdAt` is the day it has been waiting since. The
    // collect kind has no row here and that is the point of the row being per kind: its proposals are
    // comments on somebody else's pull request, so there is no request of the job's own to answer a
    // wait with and nothing this could comment on that would reach anyone.
    waiting: (request) => {
      const number =
        request?.number === undefined || request?.number === null ? "" : String(request.number).trim();
      const created = utcDay(request?.createdAt);
      // An entry that states a close was answered — the two fields a merged request carries, and the
      // one a dropped request carries — so what is left is the open one, which is the only request
      // whose staying open is still this job's business.
      const answered = request?.closedAt != null || request?.mergedAt != null;
      return number === "" || created === null || answered ? null : { number, created };
    },
    // …and the comment that finding earns on it. Absent for the other kind, which is what makes the
    // comment floor-only without a second condition anywhere: a kind with no `waitComment` is a kind
    // whose wait has no pull request of its own to be said on.
    waitComment: renderFloorWaitComment,
    // …and the judgement of the record the section renders: the crossing lines these settlements cannot
    // produce. It is the same call the section makes, so the block a reader is shown and the count the
    // night is judged by cannot come apart — and it is per kind rather than over one shared record,
    // because a crossing is a level *one series* has been told about.
    waitDrift: (records, crossings) => waitCrossingDrift(records, crossings),
    // …and the reopening the settlement line cannot state either, for the reason the collect kind's row
    // gives: a request this job dropped can be reopened in the same window, and the file's word about that
    // request then says the thread is over while GitHub says it is open. The noun is the only difference.
    reopens: (text, settled, night) => recordPullReopens(text, settled, { kind: "floor", night }),
  },
  collect: {
    head: SETTLEMENT_HEADS.collect,
    mode: "--settle-collect",
    label: "collect-budget proposals",
    // …and this kind's line is the ending of an *ask* rather than of the request it sits on, so only the
    // close ends the thread as well: a reply ends the ask and leaves the pull request standing, and a
    // comment on that pull request is still one this job may have to rewrite.
    ends: (record) => record.outcome === COLLECT_CLOSE_OUTCOME,
    // …and the row for the half of this kind's story its own settlement line cannot state: a collect ask is a
    // comment, so the pull request under it can outlive the answer, and a comment left on a request that has
    // gone would be a note handed to a closed door. The floor kind has no row here, and that is the point of
    // the row being per kind rather than a rule at the recording call: a floor proposal *is* its request.
    closes: (text, settled) => recordPullCloses(text, settled),
    // …and the other direction of that same story, which the close cannot state about itself: somebody
    // reopened the pull request, so the close's word that the thread is gone is one GitHub has contradicted.
    // Read off the file's own answer rather than off tonight's list alone (`proposalThreadEnding`), so the
    // reader that every surface already asks is also what decides a line is owed — and what stops a second
    // one being written on the next night the window still holds the same pull request.
    reopens: (text, settled, night) => recordPullReopens(text, settled, { kind: "collect", night }),
    settled: (request) => {
      // The reply, whenever it arrived and whatever it said: its day and the outcome it declared, both
      // read off the *earliest* reply comment, because a settlement is one answer rather than a day from
      // one comment and a description from another.
      const answer = proposalAnswer(request);
      return {
        number: request?.number,
        // When the job asked, which is the comment's own day rather than the pull request's: a proposal
        // is posted the first time that pull request's collect time is measured to have moved, and a
        // request raised on Tuesday was not ignored on Monday.
        proposed: proposalPostedAt(request),
        answered: answer?.at ?? null,
        // What the reply declared doing with the proposal — `applied`, `refused`, `drift`, `fork` — or
        // `null` for a reply that declares nothing, which the reader records as the plain `answered` it
        // has always read as. This is the fact the record was missing: a reply is not an adoption, and
        // the word the runbook states is the word the job itself wrote.
        status: answer?.status ?? null,
        // …and the other ending: a pull request that went away with the proposal still unanswered.
        closed: request?.closedAt,
      };
    },
    read: collectProposalSettlement,
    section: renderCollectSettlementSection,
    // …and this kind's own judgement of the record its section renders: the collect crossings the
    // runbook holds, held against the collect settlements they claim to describe. The floor kind has had
    // one since the record was gated; what this kind was missing is the record itself — nothing wrote a
    // collect crossing, so there was nothing for a section to hold lines against — and that is the row
    // below in the settle mode rather than here. The call is the floor's own, over this kind's own two
    // lists, so the two sections cannot come to measure their records differently.
    waitDrift: (records, crossings) => waitCrossingDrift(records, crossings),
  },
};

/**
 * Every settlement of one kind the runbook states, oldest row first as the file holds them.
 *
 * `[{ date, number, outcome, nights }]`, where `date` is the day it was answered, `outcome` is the
 * kind's own word for how it ended (a floor proposal `merged` or `closed`; a collect proposal the word
 * the reply declared — `applied`, `refused`, `drift`, … — or `answered` for a reply that declared none,
 * or `closed unanswered` for a request that went away first) and `nights` is the age the record itself
 * claims. Read rather than re-derived, on purpose: the record is what a person reviews the job against,
 * so it has to be readable back exactly as it was written — a line about a request the *job* raised is
 * not something a second script should be able to disagree with.
 *
 * @param {string} text the runbook's text
 * @param {"floor"|"collect"} kind which kind of request to read
 */
export function settlementsOf(text, kind) {
  const spec = SETTLEMENT_KINDS[kind];
  if (spec === undefined) throw new Error(`unknown settlement kind: ${String(kind)}`);
  return settlementLines(text)
    .filter((record) => record.kind === kind)
    .map((record) => ({
    date: record.date,
    number: record.number,
    outcome: record.outcome,
    nights: record.nights,
  }));
}

/**
 * Every settlement line the runbook holds, of *either* kind, in the order the file states them, each record
 * carrying the `kind` whose head matched it.
 *
 * One pass over the file rather than one per kind, because the order is a fact this reads rather than a
 * detail of how it was asked: the two kinds' lines are dated bullets in one file, so "the last line the file
 * holds" is the latest answer a request got, whichever kind wrote it (`proposalThreadEnding`). The `kind` is
 * the same thing it is in `SETTLEMENT_HEADS`: which story the line's fields belong to, and — through
 * `SETTLEMENT_KINDS[*].ends` — what the line says about the pull request under it.
 */
function settlementLines(text) {
  const records = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    // The two heads are told apart by their own words, so they can only match one line each and a `break`
    // after the first match states that rather than relying on it.
    for (const [kind, spec] of Object.entries(SETTLEMENT_KINDS)) {
      const head = spec.head.exec(line);
      if (head === null) continue;
      records.push({
        kind,
        date: head[1],
        number: head[2],
        outcome: head[3],
        nights: Number(head[4]),
      });
      break;
    }
  }
  return records;
}

/**
 * The floor proposals recorded in the runbook, as `settlementsOf` reads them.
 *
 * @param {string} text the runbook's text
 */
export function floorProposalSettlements(text) {
  return settlementsOf(text, "floor");
}

/**
 * The collect-budget proposals recorded in the runbook, as `settlementsOf` reads them.
 *
 * @param {string} text the runbook's text
 */
export function collectProposalSettlements(text) {
  return settlementsOf(text, "collect");
}

/**
 * What the runbook *currently* says about each pull request's thread: `[{ state, date, number, closed }]`,
 * one entry per number, in the order the file first states that number.
 *
 * One reader over both heads (`PULL_CLOSE_HEAD`, `PULL_REOPEN_HEAD`) and one pass over the file, because the
 * question "is this thread over" is answered by the *last* statement rather than by any of them: a close
 * states the request is gone and a reopening states it is back, and either can follow the other however many
 * times the pull request's life turns. `state` is `closed` or `reopened`; `date` is the day that standing
 * statement is about (the day it closed, or the night a reopening was noticed); and `closed` is the close the
 * statement rests on — its own day for a close, the day it corrects for a reopening.
 *
 * Read rather than re-derived, like every other record here, and read in *this* module rather than by the
 * caller: this is the module that writes the lines, and the question they answer — is the pull request under
 * a comment still there — has to be answered from the same file the rest of the night's history is built
 * from. A file that somehow holds two statements for one number answers with the later, as the endings read
 * does, and the later one is the one a person reading the file top to bottom reaches last.
 */
export function pullThreads(text) {
  const standing = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const close = PULL_CLOSE_HEAD.exec(line);
    const reopen = close === null ? PULL_REOPEN_HEAD.exec(line) : null;
    if (close === null && reopen === null) continue;
    // The later statement replaces the earlier one *in place*, so the map keeps the order the file first
    // names each number while carrying the statement that stands.
    const record =
      close !== null
        ? { state: "closed", date: close[1], number: close[2], closed: close[1] }
        : { state: "reopened", date: reopen[1], number: reopen[2], closed: reopen[3] };
    standing.set(record.number, record);
  }
  return [...standing.values()];
}

/**
 * Every close the runbook records that still *stands*: `[{ date, number }]`, oldest first as the file first
 * names them, where `date` is the day the pull request went away.
 *
 * "Stands" is the half of this that a close alone cannot say, and it is the reason this is a projection over
 * `pullThreads` rather than a walk of the close head: a request whose close the file has since recorded a
 * reopening for is not one the record calls gone any more, and a reader that kept counting it would keep the
 * very permanence the reopening exists to end — on the page's pull request column and in the dedupe that
 * decides whether a later close is news. So a number the file has reopened is simply absent here, and
 * appears again if the request closes a second time.
 */
export function pullCloses(text) {
  return pullThreads(text)
    .filter((thread) => thread.state === "closed")
    .map((thread) => ({ date: thread.date, number: thread.number }));
}

/**
 * The settlement the runbook records for a request whose *thread* is over — or `null` while that thread still
 * stands.
 *
 * The question this answers is about a *pull request*, and it is asked here rather than at the call site
 * because the answer is a fact about this module's own vocabularies. A comment on GitHub is written to a
 * pull request, and a request of either kind can sit on one — a comment left by one of the night's steps is
 * aimed at the request its settle step has open today (a floor proposal this job raised), and the same
 * question is what a comment left anywhere else has to be asked — so the file's settlement lines of both
 * kinds are read, no matter which kind raised the request the comment stands on. What the two kinds say about
 * the thread is not the same thing, which is why the judgement is a row of the table rather than a match on
 * the number (`SETTLEMENT_KINDS[*].ends`): a floor proposal's line *is* the request's own life and ends the
 * thread whether it was merged or dropped, while a collect proposal's line is the ending of an ask left as a
 * comment, where a reply leaves the pull request standing and only the close ends both.
 *
 * **And a settlement is not the only line that can say it.** A collect ask can be answered weeks before the
 * pull request it sits on goes away, and the settlement line — written the night the answer landed — states
 * the ask's ending and nothing about the request's, so the file records the close separately
 * (`PULL_CLOSE_HEAD`, `recordPullCloses`). This reader answers with that close where the file holds one: the
 * day the pull request closed, the word `closed`, and the ask's own age out of the settlement line the close
 * is about — every field one the file states, and the close winning because it is by construction the later
 * line, the later event and the stronger fact (a request that has gone is gone whatever its ask did).
 *
 * **And a close is not the last word either**, which is the one thing this reader could not say before: a
 * pull request can be *reopened*, and a close states a fact about a request whose life this job does not own
 * (a collect ask is a comment on somebody else's pull request, which that person can close and reopen as they
 * please). So the file can hold a later statement saying the request is back (`PULL_REOPEN_HEAD`,
 * `recordPullReopens`), and this reader takes the *last* statement about the thread in file order
 * (`pullThreads`): a reopened request is not an ending, and every surface downstream follows from that one
 * answer — the comment the night may rewrite, the retraction it may write, the sentence it states instead.
 * Nothing about the ask is undone by it: the settlement line is the history of the ask, and a reopening
 * corrects the record's word about the *pull request*, which is a different fact about the same number.
 *
 * The last line the file holds wins where it somehow holds two for one number: a settlement is written once
 * per request (`recordProposalSettlements` dedupes on the same head this reads), a close is written once per
 * close, and if anything did say one twice, the later statement is the later answer.
 *
 * @param {string} text the runbook's text
 * @param {string} number the request number the comment stands on
 * @returns {null | { date: string, number: string, outcome: string, nights: number|null }}
 */
export function proposalThreadEnding(text, number) {
  // The record's own correction, read first because it is the *latest* thing the file says about this
  // request's thread: a close that a later night recorded a reopening for is not the end of anything, so the
  // question this function answers is asked of the thread's standing statement before any settlement line is
  // consulted. The order is the whole of the self-correction — nothing else has to know a request came back.
  const thread = pullThreads(text).find((record) => record.number === number) ?? null;
  if (thread !== null && thread.state === "reopened") return null;
  let ending = null;
  let settled = null;
  for (const record of settlementLines(text)) {
    if (record.number !== number) continue;
    settled = record;
    if (!SETTLEMENT_KINDS[record.kind].ends(record)) continue;
    ending = {
      date: record.date,
      number: record.number,
      outcome: record.outcome,
      nights: record.nights,
    };
  }
  // …and the close, which no settlement head can state for the collect kind and which outranks one that does
  // not: `closed` is this module's own word for a request that went away (the floor head's own outcome), said
  // here by the reader because the line that earned it is a record of the pull request and not of an ask. It
  // is the thread's *standing* statement, so a request that closed, came back and closed again is dated by
  // that later close rather than by the one the reopening in between corrected.
  if (thread === null) return ending;
  return {
    date: thread.date,
    number: thread.number,
    outcome: "closed",
    // The ask's age, from the settlement line this close is about: a close is written only where that line
    // already states an answered ask, so the file holds it — and `null` for a file somebody has edited into
    // holding a close without one, which is the omission the rest of this module makes rather than a zero.
    nights: settled === null ? null : settled.nights,
  };
}

/**
 * Which of the job's two thresholds an age crossed, as the short phrase the records and the pages'
 * tables both use.
 *
 * Three bands, and they are the whole point of recording either kind of settlement at all: `before
 * either threshold` is a request that answered itself, `after the run page` one that sat past the
 * night the job starts naming it in the morning, and `after the escalation` one where the night's
 * comment had already started naming a person. The boundaries are the constants' own, so moving
 * `STALE_NIGHTS` or `ESCALATED_NIGHTS` moves what the records of the past are read as — which is the
 * intended direction: the question is whether *these* numbers are the right ones.
 *
 * **One function for both kinds, and one clock.** The two names in the bands are the *floor*
 * proposal's mechanisms — that is the request these thresholds were chosen for, the one the job
 * re-fires nightly, names on the run page and mentions a person about — and a collect proposal, which
 * is a comment on somebody else's pull request, has no loudness of its own to cross them with. That
 * asymmetry is stated rather than papered over: the ages of both kinds are read against the same two
 * numbers, in the bands these names came from, and each kind's section says in its own words what
 * crossing one meant for it (see `SETTLEMENT_WORDS`).
 *
 * @param {number} nights the whole nights the request sat
 */
export function settlementBand(nights) {
  if (nights >= ESCALATED_NIGHTS) return "after the escalation";
  if (nights >= STALE_NIGHTS) return "after the run page";
  return "before either threshold";
}

/**
 * The three bands an age can fall in, youngest first — the rows `settlementDistribution` counts, in
 * the order a reader meets them: the answers that arrived before the job had anything to say about a
 * proposal, then the ones the run page had started naming, then the ones where the night's comment
 * had already named a person.
 *
 * They are `settlementBand`'s own phrases rather than a second description of the boundaries,
 * and the case that holds the counting reads them back out of that function at its three boundaries:
 * a band renamed there fails the case rather than leaving this table claiming a name nothing
 * produces.
 */
const SETTLEMENT_BANDS = ["before either threshold", "after the run page", "after the escalation"];

/**
 * The middle of a list of ages: the median, or the average of the two middles when the count is
 * even.
 *
 * Whole nights are what a record holds, so an even count answers with a half night — `2.5` — and that
 * is stated rather than rounded, because the series this feeds is read for its *movement*: a rounding
 * of every second point would hide half of the smallest step it can take. The list is copied before
 * it is sorted, because the order it was handed in is the records' and not this function's to change.
 *
 * `null` for an empty list — no ages is not zero nights — and every caller here has already dropped
 * the ages a record could not state.
 *
 * @param {number[]} ages the ages, in any order
 * @returns {null|number}
 */
function medianOf(ages) {
  const sorted = ages.slice().sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The ages as a trend across the nights they were answered on: one point per night an answer arrived,
 * oldest such night first, each stating the median of every age recorded up to and including it.
 *
 * This is the reading the bands cannot give. A band is read one age at a time — an answer either
 * crossed a threshold or it did not — and the counts above them change with every record; the median
 * is read *across* the answers, so it can climb toward a threshold over several answers before any
 * single one of them crosses it, which is what makes a drift visible while the job still has nothing
 * to say about any individual request. Two properties are deliberate, and both are stated on the page
 * rather than left to the reader:
 *
 *   - the count behind every point travels with it (`count`), because a median over three answers
 *     moves whenever one of them sat longer than half of the rest — the earlier a rise can be seen,
 *     and exactly why it is not on its own evidence that the job is getting slower;
 *   - the points are the **nights an answer arrived**, not every night: a night nothing was answered
 *     adds no point, since there is no new age for a median to move on, and a series with a blank in
 *     it would claim the job was measured on a night it was not.
 *
 * `ages` is that night's own ages — what arrived to move the median — and `change` is how far the
 * median moved against the previous point (`null` on the first point, which has nothing before it).
 * Two answers on one night are one point: the median is a reading of the answers so far rather than of
 * the night, so the second one moves that night's point rather than adding a second point beside it.
 * A record whose *age* cannot be read is left out, the rule the counts follow, and one that states no
 * day at all has no point to belong to: it is counted above and absent here, which the page says out
 * loud rather than plotting it at a day nothing stated.
 *
 * @param {Array<{ date: string, number?: string, nights: number, outcome?: string }>} records the
 *   settled requests, as the sections above hold them
 * @returns {Array<{ date: string, ages: number[], count: number, median: number, change: null|number }>}
 */
export function settlementAgeTrend(records) {
  const dated = (Array.isArray(records) ? records : [])
    .map((record) => ({
      date: record?.date,
      number: record?.number,
      nights: Number(record?.nights),
    }))
    .filter(
      (record) =>
        typeof record.date === "string" &&
        record.date !== "" &&
        Number.isFinite(record.nights) &&
        record.nights >= 0,
    )
    // The order the sections sort by, so a day's answers are met in the same order here as in the
    // receipts: the day, then the request's number within it, and never the order a caller listed
    // them in.
    .sort((left, right) => {
      if (left.date !== right.date) return left.date < right.date ? -1 : 1;
      return Number(left.number) - Number(right.number);
    });

  const ages = [];
  const points = [];
  for (const record of dated) {
    ages.push(record.nights);
    const latest = points[points.length - 1];
    const median = medianOf(ages);
    if (latest !== undefined && latest.date === record.date) {
      // Another answer on a night already plotted: that night's point restated with the answer
      // counted, rather than a second point carrying the same date.
      latest.ages.push(record.nights);
      latest.count = ages.length;
      latest.median = median;
      latest.change =
        points.length > 1 ? median - points[points.length - 2].median : null;
      continue;
    }
    points.push({
      date: record.date,
      ages: [record.nights],
      count: ages.length,
      median,
      change: latest === undefined ? null : median - latest.median,
    });
  }
  return points;
}

/**
 * The settlements as a distribution: how many answers landed in each band, what their ages say about
 * the escalation — the loudest thing this job does, and the one part of its loudness that only a
 * record of *timing* can judge — and how the middle of those ages moved across the nights they were
 * answered on.
 *
 * Counts of *answers* rather than of nights: a band holding four proposals says how often the job was
 * ignored, not how long it went ignored, which is why the fastest and slowest ages travel beside the
 * counts — three bands across two thresholds is a coarse reading of however many numbers the records
 * hold, and a reader who cannot see the spread cannot tell a band of one-night answers from a band of
 * three-night ones.
 *
 * The escalation is counted from the same ages and in the terms the constants are written in:
 * `crossed` is every settlement whose answer arrived once the job's clock had reached its loud end
 * (`nights >= ESCALATED_NIGHTS`), `onFirstNight` those answered on the day it was reached
 * (`nights === ESCALATED_NIGHTS`) — the only reading these records can give the loud end as having
 * done the answering, since an answer and that day are as close as two whole dates can come — `later`
 * the rest, and `spareNights` the nights those sat *after* it, which is what a request that goes
 * unanswered past the job's loudest mechanism costs. `crossed` and `spareNights` are the same two
 * numbers for both kinds, and each kind's section says in its own words what its loud end is
 * (`SETTLEMENT_WORDS`): the floor proposal's mention, or — for the kind the job does not shout about
 * — the clock it keeps for the request it does.
 *
 * A record whose age cannot be read is left out rather than counted as zero — an unreadable number
 * is not a small one, the rule the records' own writer follows — and a list with nothing readable in
 * it answers `null`, the omission the rest of the page follows: a night with no settlements to
 * summarise adds nothing rather than a row of zeroes.
 *
 * `trend` is those same ages read across the nights rather than into three bands
 * (`settlementAgeTrend`): it is a third reading of one history and not a second set of numbers — the
 * ages it runs on are the ones the counts above were made from, dropped records included — which is
 * what lets a rise be visible while every band above still reads the same. It can be shorter than
 * `total`, and only for one reason, which the page states: a record whose own day cannot be read has
 * no night to belong to.
 *
 * @param {Array<{ number: string, date: string, nights: number, outcome: string }>} records
 * @returns {null|{
 *   total: number,
 *   bands: Array<{ band: string, count: number, share: number }>,
 *   fastest: number,
 *   slowest: number,
 *   escalation: { crossed: number, onFirstNight: number, later: number, spareNights: number },
 *   trend: Array<{ date: string, ages: number[], count: number, median: number, change: null|number }>,
 * }}
 */
export function settlementDistribution(records) {
  const ages = (Array.isArray(records) ? records : [])
    .map((record) => Number(record?.nights))
    .filter((nights) => Number.isFinite(nights) && nights >= 0);
  if (ages.length === 0) return null;
  const total = ages.length;
  const crossed = ages.filter((nights) => nights >= ESCALATED_NIGHTS).length;
  const onFirstNight = ages.filter((nights) => nights === ESCALATED_NIGHTS).length;
  return {
    total,
    bands: SETTLEMENT_BANDS.map((band) => {
      const count = ages.filter((nights) => settlementBand(nights) === band).length;
      // Whole percents, because a share is here to say which band is the common case and a reading
      // three bands deep at a decimal place would not change one — which is also why the column may
      // read 99 or 101 where it should read 100, a rounding the page says out loud rather than
      // hiding by adjusting a row.
      return { band, count, share: Math.round((count / total) * 100) };
    }),
    fastest: Math.min(...ages),
    slowest: Math.max(...ages),
    escalation: {
      crossed,
      onFirstNight,
      later: crossed - onFirstNight,
      spareNights: ages
        .filter((nights) => nights > ESCALATED_NIGHTS)
        .reduce((sum, nights) => sum + nights - ESCALATED_NIGHTS, 0),
    },
    // …and the same ages as a series rather than as three bands: asked of the records themselves,
    // because a trend is a reading of one age after another and nothing about the counts above can
    // say which night an answer arrived on.
    trend: settlementAgeTrend(records),
  };
}

/**
 * How each kind's own prose names the clock its ages are read against, and what crossing it meant.
 *
 * One entry per kind rather than one set of words, because the two kinds do not get loud the same way
 * and a sentence claiming they did would be a lie about one of them. The floor proposal is re-fired
 * every night, named on the run page from the third night and sent a comment that starts naming a
 * person from the seventh — those two mechanisms are what `STALE_NIGHTS` and `ESCALATED_NIGHTS` were
 * chosen against, and the floor's entries are the mechanisms themselves. A collect proposal is a
 * comment this job leaves on somebody else's pull request: nothing in the job re-fires it, names it on
 * a page or mentions anybody for it, so its entries name the same two numbers as the clock the job
 * keeps for the request it *does* shout about, which is the only way the two kinds' ages can be read
 * against one another without inventing a loudness one of them has not got.
 *
 * The pieces are the places the words appear: `clause` is what a record's own line ends with (`stale`
 * covers both bands under the loud end, because a zero-night answer and a two-night one are inside the
 * job's patience either way), `quiet` and `loud` are the escalation paragraph for a history that has
 * never gone past the loud end and for one that has, `rows` labels the two table rows that name it, and
 * `clock` names the two thresholds themselves for the one block that reads an age *against* them rather
 * than counting how many crossed — the median trend, where a number is held up to each threshold in
 * turn and the kind has to say what that night was. The counts and their arithmetic are
 * `settlementDistribution`'s and are shared; only the words are here.
 */
const SETTLEMENT_WORDS = {
  floor: {
    // What happens on each threshold night, as a *clause*: `clock` is read after "at which" by the wait
    // warning and turned into a noun phrase ("the night …") by the trend that names the night itself, and
    // a value carrying its own article could be read by only one of the two.
    clock: {
      first: "the run page starts naming one",
      second: "the night's comment starts naming a person",
    },
    clause: {
      escalated:
        `past the ${ESCALATED_NIGHTS} nights at which the night's comment names a person, so the ` +
        "escalation had already been spent on it",
      stale:
        `past the ${STALE_NIGHTS} nights at which the run page starts naming it, and answered before ` +
        `the ${ESCALATED_NIGHTS} at which a comment names a person`,
      inside: `inside the ${STALE_NIGHTS} nights this job waits before it says anything about one`,
    },
    quiet: (total, answers) =>
      `The escalation has not been reached once: every one of the ${total} ${answers} arrived inside ` +
      `the ${ESCALATED_NIGHTS} nights at which the night's comment starts naming a person, so nothing ` +
      "here yet says whether naming somebody is what answers one of these.",
    loud: (total, answers, escalation) =>
      `${escalation.crossed} of the ${total} ${answers} arrived with the mention already out: ` +
      `${escalation.onFirstNight} on the day it first went out — the one reading that can be given as ` +
      "the mention having done the answering" +
      (escalation.later === 0
        ? "."
        : ` — and ${escalation.later} later, with the mention already out and unanswered for ` +
          `${escalation.spareNights} ${escalation.spareNights === 1 ? "night" : "nights"}.`) +
      (total === escalation.crossed
        ? ""
        : ` The other ${total - escalation.crossed} arrived before the job had a person to name.`),
    rows: {
      header: "nights the mention was already out",
      loud: `the day the mention first went out (\`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS})`,
      before: "before the mention ever went out",
    },
  },
  collect: {
    clock: {
      first: "the job's own floor request starts being named on the run page",
      second: "that request's comment starts naming a person",
    },
    clause: {
      escalated:
        `past the ${ESCALATED_NIGHTS} nights at which the job's own floor request starts naming a ` +
        "person — a collect proposal has no escalation of its own, so what the age crossed is the " +
        "clock this job keeps rather than a comment that named somebody",
      stale:
        `past the ${STALE_NIGHTS} nights at which the job's own floor request starts being named on ` +
        `the run page, and answered before the ${ESCALATED_NIGHTS} at which that request starts ` +
        "naming a person",
      inside:
        `inside the ${STALE_NIGHTS} nights the job waits before it says anything about a request of ` +
        "its own",
    },
    quiet: (total, answers) =>
      `Nothing here has reached the clock's loud end yet: every one of the ${total} ${answers} ` +
      `arrived inside the ${ESCALATED_NIGHTS} nights at which the job's own floor request starts ` +
      "naming a person. A collect proposal is escalated by no comment of this job's and mentions " +
      "nobody, so the table below is that clock read on a request the job does not shout about — and " +
      "the first row to leave zero is the first evidence of what these ages look like past it.",
    loud: (total, answers, escalation) =>
      `${escalation.crossed} of the ${total} ${answers} arrived past the ${ESCALATED_NIGHTS} nights ` +
      `at which the job's own floor request starts naming a person: ${escalation.onFirstNight} on the ` +
      `first day that clock's loud end was reached and ${escalation.later} later, with ` +
      `${escalation.spareNights} ${escalation.spareNights === 1 ? "night" : "nights"} standing past ` +
      "it. No comment of this job's names anybody for a collect proposal, so what the row records is " +
      "a request that sat unread through the clock rather than a mention that went unanswered" +
      (total === escalation.crossed
        ? "."
        : `; the other ${total - escalation.crossed} arrived inside the clock.`),
    rows: {
      header: "nights past the clock's loud end",
      loud: `the day that clock's loud end is reached (\`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS})`,
      before: "before that clock's loud end was reached",
    },
  },
};

/** The band above, as the clause a record's own line ends with, in its kind's words. */
function settlementClause(nights, kind) {
  const band = settlementBand(nights);
  const clause = SETTLEMENT_WORDS[kind].clause;
  if (band === "after the escalation") return clause.escalated;
  if (band === "after the run page") return clause.stale;
  return clause.inside;
}

/**
 * The age a request sat, as the dated bullet that becomes the runbook's record of it.
 *
 * `null` for a request that is not settled (no `closed` day: an open proposal is not an answer), one
 * whose dates or number cannot be read, and one whose close reads *before* its open — a negative age
 * is not an age. Zero is a real answer and is recorded as one: a proposal adopted the day it was
 * opened sat no nights at all, which is exactly the fast end of the distribution the review is
 * reading, so dropping it would quietly remove the best case. A merge and a close
 * are distinguished by `merged`, which is the `mergedAt` GitHub states: `""` and `null` mean the
 * request was dropped, and both are read here rather than by the caller so the two can never
 * disagree about what "merged" means.
 *
 * @param {Object} [options]
 * @param {string|number} [options.number] the request's number
 * @param {string} [options.created] when it was opened (`createdAt`)
 * @param {string|null} [options.closed] when it was answered (`closedAt`), or `null` while it is open
 * @param {string|null} [options.merged] when it was merged (`mergedAt`), or empty for a drop
 */
export function floorProposalSettlement(options = {}) {
  const number = options.number === undefined || options.number === null ? "" : String(options.number).trim();
  const opened = utcDay(options.created);
  const closed = utcDay(options.closed);
  const nights = nightsBetween(options.created, options.closed);
  if (number === "" || opened === null || closed === null || nights === null || nights < 0) return null;
  const outcome = options.merged ? "merged" : "closed";
  const record = { number, opened, closed, nights, outcome };
  return { ...record, line: floorSettlementLine(record) };
}

/**
 * The dated bullet a floor proposal's settlement is recorded as.
 *
 * One line, and its head is fixed: it is the marker the dedupe reads
 * (`SETTLEMENT_HEADS.floor`), so a later night cannot record the same request twice, and a person
 * can read the whole history of how long these sat out of one grep of the runbook. Every clause
 * about *why* the age matters comes from the two constants, so moving either one moves what the
 * records of the past are read as.
 *
 * @param {{ number: string, opened: string, closed: string, nights: number, outcome: string }} record
 */
function floorSettlementLine({ number, opened, closed, nights, outcome }) {
  const night = nights === 1 ? "night" : "nights";
  const dropped =
    outcome === "merged"
      ? ""
      : " It was dropped rather than adopted, which is not a decision about the floors: the next " +
        "night's records derive the same discrepancy, so the job opens the next request from it.";
  const between =
    nights === 0
      ? `It was opened ${opened} and answered ${closed} the same day, so no night passed for the ` +
        "job to re-derive the floors or re-ask for them"
      : `It was opened ${opened} and answered ${closed}, and the job re-derived the floors it carried ` +
        "and re-asked for them " +
        (nights === 1 ? "on the one night in between" : `on every one of the ${nights} nights it sat`);
  return `- **${closed} — floor proposal #${number}: ${outcome} after ${nights} ${night}.** ${between} — ${settlementClause(nights, "floor")}.${dropped}`;
}

/**
 * The age a collect-budget proposal sat, as the dated bullet that becomes the runbook's record of it.
 *
 * The mirror of `floorProposalSettlement`, and the one place the two kinds really differ: what an
 * answer *is*. A floor proposal is answered by the request it opened — merged, or closed unmerged —
 * while this one is a comment this job left on somebody else's pull request, so its answer is the
 * reply on *that* request (`.freebuff/collect-apply.mjs` owns the marker that says which comment it
 * is) and the request's own close is only the other ending: a pull request that went away with the
 * proposal still unanswered settled the question too, and it is recorded rather than dropped, because
 * what this measures is how long the job's ask stood — and an ask closed out unanswered stood every
 * night of it.
 *
 * An answer wins over a close whenever both are read, which is why they are read here rather than by
 * the caller: a pull request can be closed *after* it was answered (the branch goes away once the
 * follow-up lands), and the age this record is about is the one that ended with the answer — counting
 * to the close instead would make the record of the proposal's own wait depend on the life of a
 * second request.
 *
 * The outcome is the *reply's own word* wherever it declared one (`status`, which
 * `.freebuff/collect-apply.mjs`'s `applyOutcomeIn` reads out of the reply the apply job posts): a
 * proposal the job refused to apply and one it adopted are different records — `refused` and `applied`
 * — because they are different facts about the gate, and a table that called both of them `answered`
 * would say the tightening landed when it did not. A reply that declares nothing at all is the plain
 * `answered` every such record has always read as, which is what keeps the older replies meaningful
 * rather than retro-actively described.
 *
 * `null` for a proposal that is not settled (nothing answered it and nobody closed it — it is still
 * being asked), one whose days or number cannot be read, and one whose end reads *before* its open — a
 * negative age is not an age. Zero is a real answer and is recorded as one, as on the floor's side: a
 * proposal applied the day it was posted is the fast end of the distribution this review is reading
 * rather than an absence.
 *
 * @param {Object} [options]
 * @param {string|number} [options.number] the pull request the proposal was left on
 * @param {string} [options.proposed] when it was first proposed (the comment's own `createdAt`)
 * @param {string|null} [options.answered] when the reply landed, or `null` while none has
 * @param {string|null} [options.status] the outcome that reply declared, or `null` for one that
 *   declared none — `applyOutcomeIn`'s answer, not a word this module invents. A word outside
 *   `COLLECT_OUTCOMES` is recorded as `unknown`: the dedupe matches the head, so a word the head
 *   cannot read back is a record that would be written again every night
 * @param {string|null} [options.closed] when the pull request closed, or `null` while it is open
 */
export function collectProposalSettlement(options = {}) {
  const number = options.number === undefined || options.number === null ? "" : String(options.number).trim();
  const proposed = utcDay(options.proposed);
  // The reply is an answer wherever it arrived; the close ends it only for a proposal nothing
  // answered. Asked of the field rather than of its truth, so a reply whose day cannot be read is
  // refused below rather than quietly re-read as a close — an unreadable answer is not an answer.
  const answered =
    options.answered === undefined || options.answered === null || options.answered === ""
      ? null
      : options.answered;
  // What the reply did with the proposal, as `applyOutcomeIn` read it: a declared word, `unknown` for a
  // declaration nothing can interpret, or `null` for a reply that declares nothing. Read as it was handed
  // over rather than re-derived here, for the reason the days are: the record has to state what the reply
  // said, not what this module would have guessed from it.
  const declared = options.status === undefined || options.status === null || options.status === ""
    ? null
    : options.status;
  const ended = answered ?? options.closed;
  const closed = utcDay(ended);
  const nights = nightsBetween(options.proposed, ended);
  if (number === "" || proposed === null || closed === null || nights === null || nights < 0) return null;
  // …and narrowed to the words the head can read back, because the dedupe is the head: a caller that
  // handed over a status outside this vocabulary would write a record nothing could match again, and the
  // same proposal would be recorded every night it was seen. `applyOutcomeIn` never produces one — this is
  // the same guarantee stated where the record is made rather than only where the word is read.
  const outcome =
    answered === null
      ? COLLECT_CLOSE_OUTCOME
      : declared === null
        ? COLLECT_ANSWERED_OUTCOME
        : COLLECT_OUTCOMES.includes(declared)
          ? declared
          : "unknown";
  const record = { number, opened: proposed, closed, nights, outcome };
  return { ...record, line: collectSettlementLine(record) };
}

/**
 * The dated bullet a collect-budget proposal's settlement is recorded as.
 *
 * One line, and its head is fixed: it is the marker the dedupe reads (`SETTLEMENT_HEADS.collect`), so
 * a later night cannot record the same request twice, and a person can read the whole history of how
 * long these sat out of one grep of the runbook. What it shares with the floor's line is the question
 * and the closing clause about the two thresholds; what it cannot borrow is the sentence about the
 * job re-deriving the floors and re-asking — this request is not re-fired, it is a comment that the
 * pull request's own runs re-measured while it stood, and the ask itself never moved.
 *
 * The head's outcome is the whole of what this kind's records now distinguish: `applied` and
 * `unchanged` are proposals that were adopted (the tightening was written, or needed no writing), every
 * other declared word (`refused`, `drift`, `unverified`, `no-payload`, `fork`, `unknown`) is a reply
 * that left the gates alone, `answered` is a reply that declared nothing, and `closed unanswered` is a
 * pull request that went away with the ask still standing. Only the last carries the sentence about what
 * that means — nothing was applied and the drops it measured are still there to be earned — while each
 * reply that did not adopt the proposal carries what its own word means for the gate
 * (`COLLECT_OUTCOME_NOTES`). A settled adoption needs no such reading.
 *
 * @param {{ number: string, opened: string, closed: string, nights: number, outcome: string }} record
 */
function collectSettlementLine({ number, opened, closed, nights, outcome }) {
  const night = nights === 1 ? "night" : "nights";
  // A reply or a close: the head's two families, and the only thing the span's own words turn on.
  const replied = outcome !== COLLECT_CLOSE_OUTCOME;
  // The same span in both readings, and the same words for it: what differs between an answer and a
  // close is what those days *were*, not how long the gap between them is.
  const span =
    nights === 0
      ? replied
        ? "the same day, so no night passed between the question and the answer"
        : "the same day, so no night passed between the question and the end of it"
      : nights === 1
        ? "one night later"
        : `${nights} nights later`;
  const between = replied
    ? `It was proposed ${opened} and answered ${closed}, ${span}, with the ask standing as a comment ` +
      "on the pull request it was measured against and re-measured by every run that request carried"
    : `It was proposed ${opened} and the pull request was closed ${closed} with the ask unanswered, ` +
      `${span} — it stood as a comment on that request the whole time, re-measured by every run the ` +
      "request carried";
  const note = replied
    ? (COLLECT_OUTCOME_NOTES[outcome] ?? "")
    : " Nothing was applied, and that is not a verdict on the baselines: the drops it measured are " +
      "still there to be earned, so the next run that measures them proposes them again.";
  return `- **${closed} — collect-budget proposal on #${number}: ${outcome} after ${nights} ${night}.** ${between} — ${settlementClause(nights, "collect")}.${note}`;
}

/**
 * One pull request's close as the dated bullet it is recorded with, or `null` for one that cannot be stated:
 * a day that cannot be read, or a request with no number to name.
 *
 * Dated by the day the pull request *closed* — GitHub's own `closedAt`, read into a UTC day — rather than by
 * the night the step that noticed it ran, which is the convention every record in this file keeps: the
 * settlement lines are dated by the day the thing happened, not by the night somebody read it, and a step that
 * skipped a night or a window that lagged would otherwise date a fact by the wrong clock.
 *
 * It is owed only where the request's own settlement has *already answered* the ask (`recordPullCloses`), and
 * the sentence says so, because that is the whole reason the line exists: the end of an ask is not the end of
 * the pull request it was left on, and a comment written to a request that has gone is a note handed to a
 * closed door.
 *
 * @param {Object} [options]
 * @param {string|number} [options.number] the pull request the ask was left on
 * @param {string} [options.closed] when it closed (`closedAt`)
 */
export function pullClose(options = {}) {
  const number =
    options.number === undefined || options.number === null ? "" : String(options.number).trim();
  const date = utcDay(options.closed);
  if (number === "" || date === null) return null;
  const record = { date, number };
  return { ...record, line: pullCloseLine(record) };
}

/**
 * The line itself: the bullet, and why the ask's own record cannot be it.
 *
 * Two sentences and no table, unlike the settlement lines: there is one thing to say here (the request is
 * gone, and the ask on it had already been answered) and one thing to explain (why that is a fact the
 * settlement line does not carry), and the explanation is the same whatever word the ask was answered with.
 */
function pullCloseLine({ date, number }) {
  return (
    `- **${date} — the pull request behind collect-budget proposal #${number} closed, after the ask there ` +
    `was answered.** The ask's own line states the day that answer landed and what came of it; this line is ` +
    `the other half of the same story — the request a comment on that ask would be written to is gone, so ` +
    `nothing is written there any more.`
  );
}

/**
 * The closes the runbook does not hold yet, appended — `{ text, added }`, in `recordProposalSettlements`'
 * own shape so one caller can write both lists with one write.
 *
 * Owed for exactly one state, and every clause of it refuses a case that would otherwise be recorded twice or
 * recorded early:
 *
 *   - the pull request has a close day to read (`closedAt`), because a request still standing is not one;
 *   - the runbook already states the *ask's* ending for that number — the settlement line the pass above has
 *     just made sure of — because a request nothing answered is recorded as `closed unanswered`, where the
 *     close *is* the ask's ending and a second line would say one thing twice;
 *   - that ending is not the close itself (`closed unanswered`), for the same reason; and
 *   - no close *stands* for that number yet, so a retried step, or a second night whose window still holds the
 *     same pull request, writes nothing — and a request whose close the file has since recorded a reopening
 *     for is owed this line again, because the second close is a fact the first line does not state.
 *
 * The precondition is read off the *text handed over* rather than off GitHub's own fields, and that is the
 * discipline the rest of this mode keeps: a later night reaches its answer through this file, so this is
 * where the question is asked — an ask whose blank reply nobody could read is not one this may call answered,
 * however the feed's comments looked to the mapper.
 *
 * The list it reads is the one the *recorder* was handed, which is this kind's own `settled` mapper's output
 * rather than GitHub's own shape: the close is the `closed` field there, the day the mapper read out of
 * `closedAt`, so the one row of `SETTLEMENT_KINDS` that writes this line and the one that writes the ask's
 * line read their days out of the same place.
 *
 * @param {string} text the runbook's text, this night's settlements included
 * @param {Array<object>} [settled] the requests a caller found, as this kind's `settled` mapper states them
 */
export function recordPullCloses(text, settled = []) {
  let next = String(text ?? "");
  const known = new Set(pullCloses(next).map((record) => record.number));
  // The numbers whose ask the file says was answered: the only requests whose close their own settlement line
  // does not already state.
  const answered = new Set(
    collectProposalSettlements(next)
      .filter((record) => record.outcome !== COLLECT_CLOSE_OUTCOME)
      .map((record) => record.number),
  );
  const added = [];
  for (const request of Array.isArray(settled) ? settled : []) {
    // A list off a workflow is whatever it is: an entry that is not an object is dropped here, as the
    // settlement recorder drops it.
    if (request === null || typeof request !== "object") continue;
    const number =
      request.number === undefined || request.number === null ? "" : String(request.number).trim();
    if (number === "" || known.has(number) || !answered.has(number)) continue;
    const close = pullClose({ number, closed: request.closed });
    if (close === null) continue;
    known.add(number);
    added.push(close);
    next = appendRecord(next, close.line);
  }
  return { text: next, added };
}

/**
 * One reopening as the dated bullet it is recorded with, or `null` for one that cannot be stated: a night or
 * a close that cannot be read, or a request with no number to name.
 *
 * Dated by the night the job saw the request open again, and it is the one date in this file that GitHub does
 * not state — a pull request carries `closedAt` and nothing for a reopening, so the fact is "as of this run,
 * this request is open again" and the run's own clock is what dates it (`--today`, the flag the crossing line
 * and the settle step's ages are read against). The close it supersedes is quoted in the head, so a reader
 * has both days and neither has to be guessed at.
 *
 * @param {Object} [options]
 * @param {"floor"|"collect"} [options.kind] whose request this is, for the noun the line names it by
 * @param {string|number} [options.number] the pull request that came back
 * @param {string} [options.night] the night this was noticed
 * @param {string} [options.closed] the day the close it supersedes states
 */
export function pullReopen(options = {}) {
  const kind = options.kind === "floor" ? "floor" : "collect";
  const number =
    options.number === undefined || options.number === null ? "" : String(options.number).trim();
  const date = utcDay(options.night);
  const closed = utcDay(options.closed);
  if (number === "" || date === null || closed === null) return null;
  const record = { kind, date, number, closed };
  return { ...record, line: pullReopenLine(record) };
}

/**
 * The line itself: the bullet, and what it makes of the close above it.
 *
 * What it says that the close cannot say about itself is the *standing* half: the request went away on the
 * day that close states and GitHub now reports it open, so the record's word about that thread is no longer
 * that it is gone — a comment left on it is one a later night may rewrite, where the close had made every
 * later night leave it alone. The ask's own settlement is explicitly not undone: it is the history of the
 * ask, which is a different fact about the same number, and a reader who took this line for a correction of
 * it would read an answered proposal as an unanswered one.
 */
function pullReopenLine({ kind, date, number, closed }) {
  const noun = (THREAD_NOUNS[kind] ?? THREAD_NOUNS.collect)(number);
  return (
    `- **${date} — ${noun} reopened, after the close recorded for ${closed}.** The request went away on the ` +
    `day that close line states, and GitHub now reports it open again — so the standing word about that ` +
    `thread is no longer that it is gone: a comment this job left on it is one a later night may rewrite, ` +
    `and the close above stands as the history it is. The ask's own line is untouched either way, being what ` +
    `became of the ask rather than of the request.`
  );
}

/**
 * The reopens the runbook does not hold yet, appended — `{ text, added }`, in `recordPullCloses`' own shape so
 * one caller can write every list to the one file with one write.
 *
 * Owed for exactly one state, and it is the state a close cannot correct on its own: tonight's list says the
 * request is *open* — no close day to read — while the file's own answer for that number is still an ending
 * (`proposalThreadEnding`, the same reader every surface asks), so the record's word about the pull request is
 * one GitHub has contradicted. Two clauses, each refusing a case that would otherwise write a line about
 * nothing or write one twice:
 *
 *   - the entry states no close day, because a request still gone has not come back; and
 *   - the file's answer is an ending — a settlement row of the kind, or a close that stands. A request nothing
 *     has ended is nothing to correct, which is also what keeps every open pull request in the nightly list
 *     from becoming a line; and a request the file already calls reopened answers `null` here, so the *reader*
 *     is the dedupe exactly as it is for a crossing, and a retried step writes nothing.
 *
 * The line is worth writing rather than saying once in a log because the thread is where a person is: every
 * surface that decides whether to write into that comment asks this file whether the thread is over, so a
 * correction kept only in a run page would leave all of them repeating a record GitHub has contradicted. Both
 * kinds have the row, and the kind decides only the noun — a request this job raised itself can be reopened in
 * the same window as one left on somebody else's pull request, and the file states both the same way.
 *
 * @param {string} text the runbook's text, this night's settlements included
 * @param {Array<object>} [settled] the requests a caller found, as a kind's `settled` mapper states them
 * @param {Object} [options]
 * @param {"floor"|"collect"} [options.kind] which kind's mapper produced the list
 * @param {string} [options.night] the night this run is dated by
 */
export function recordPullReopens(text, settled = [], { kind = "collect", night } = {}) {
  let next = String(text ?? "");
  const added = [];
  for (const request of Array.isArray(settled) ? settled : []) {
    if (request === null || typeof request !== "object") continue;
    const number =
      request.number === undefined || request.number === null ? "" : String(request.number).trim();
    if (number === "") continue;
    // Tonight's own field, read the way the close writer reads it: the mapper puts the close day in `closed`
    // whatever stated it, so an entry with none is the request the list says is open.
    const closed = request.closed;
    if (closed !== null && closed !== undefined && String(closed).trim() !== "") continue;
    // …and the file's own answer, which is the dedupe as well as the reason: a request the record already
    // calls open again is not one this may state twice.
    const ending = proposalThreadEnding(next, number);
    if (ending === null) continue;
    const reopen = pullReopen({ kind, number, night, closed: ending.date });
    if (reopen === null) continue;
    added.push(reopen);
    next = appendRecord(next, reopen.line);
  }
  return { text: next, added };
}

/**
 * What each outcome a reply can leave means for the proposal it answered, as the sentence a record ends
 * with — the kind's own words for the other half of the answer, and the reason the word is in the head at
 * all: a settlement of a proposal is only useful if a reader can tell an adopted tightening from a turned
 * down one without opening the pull request.
 *
 * Empty for the two words that need nothing added: `applied` (the values were written; the record already
 * says where they went) and `answered` (a reply that declared nothing, whose sentences are the answer and
 * whose outcome this module has no business asserting). Every other word states what did *not* happen,
 * in that reply's own vocabulary, because the alternative — one sentence covering a refused payload, a
 * pin that would not record the file, a fork with no branch to stack on — would be true of none of them
 * and misleading about most.
 *
 * Keyed by the record's outcome, so a word added to the applier's vocabulary and not here is a record
 * that states its word and adds nothing: worse reading than a sentence, and never a wrong one.
 */
const COLLECT_OUTCOME_NOTES = {
  applied: "",
  unchanged:
    " Nothing had to be written for it: the recorded baselines already sat at or below what the " +
    "proposal asked for, so the gates were that tight already.",
  refused:
    " The reply refused it — the payload would have raised a recorded budget, and a proposal may only " +
    "tighten a gate — so the gates are what they were, and the drops it measured are still there to be " +
    "earned.",
  drift:
    " The reply refused it on the way out: the values applied, but the pin could not record the baselines " +
    "they write, so nothing was committed, the baselines were put back, and the gates are what they were.",
  unverified:
    " The reply refused it on the way out: the values applied and were re-pinned, but the drift check then " +
    "disagreed with the tree, so nothing was committed and the gates are what they were.",
  "no-payload":
    " The reply refused it: the comment carried no proposal payload, so there was nothing to apply — the " +
    "command was used somewhere other than on a proposal.",
  fork:
    " The reply refused it: the proposal stood on a fork, where there is no branch of this repository to " +
    "open a follow-up against, so nothing could be applied from here.",
  unknown:
    " The reply could not report an outcome: the approval could not be applied for a reason the reply does " +
    "not state, so nothing here says what the gates are — that reply's own log is where the reason is.",
  answered: "",
};

/**
 * The runbook with every newly settled request of one kind recorded in it, and what was added.
 *
 * One writer for both kinds, because nothing below the kind's own reading differs: the dedupe is the
 * runbook's own heads *of that kind*, the append is chronological however GitHub listed the requests,
 * and a request whose age cannot be read is left out rather than guessed at. Which head, which reader
 * and which section those are is `SETTLEMENT_KINDS`' — the caller says only which kind it is
 * recording, which is the one thing it knows and this cannot.
 *
 * One line per request, written once: the dedupe is the runbook's own heads, so a detection step
 * that runs every night records a settlement on the first night it can see it and then says nothing
 * about it — and a request that was reopened and closed again is still one record, because the
 * question it answers (how long did this sit before somebody answered) was answered the first time.
 *
 * `settled` is whatever the caller could find, in any order — GitHub lists newest first — and the
 * records are appended oldest first, so the runbook reads chronologically even on a night that finds
 * several at once. Requests a kind's reader cannot make a record of (one still waiting, an unreadable
 * date, a close that reads before its open) are left out rather than guessed at, and the return says
 * which: `added` is what was written, `records` is every settlement of that kind the file now states.
 *
 * @param {Object} [options]
 * @param {"floor"|"collect"} [options.kind] which kind of request the settled ones are
 * @param {string} [options.text] the runbook's text
 * @param {Array<object>} [options.settled] the settled requests a caller found, as that kind's own
 *   reader reads them
 */
/**
 * One record appended to a runbook: the bullet, with a blank line between it and what came before and no
 * more.
 *
 * A file that already ends the way this needs is left as it is, so a retried step cannot stack blank lines,
 * and every writer of this file — the settlements, the closes and the wait crossings — appends through here
 * rather than carrying its own three lines of the same rule.
 *
 * @param {string} text the runbook's text
 * @param {string} line the bullet to append
 */
function appendRecord(text, line) {
  let next = String(text ?? "");
  if (next !== "" && !next.endsWith("\n")) next += "\n";
  if (next !== "" && !next.endsWith("\n\n")) next += "\n";
  return `${next}${line}\n`;
}

/**
 * The settlement records a night's own read of GitHub earns, appended — the writer both kinds share.
 *
 * `added` is the settlements this pass wrote (empty on a night that answered nothing), `records` is every
 * settlement the runbook holds by the end of it, and `closed` is the *other* half of the story for the kind
 * whose asks can outlive their answers (`SETTLEMENT_KINDS.collect.closes`, run over the text this pass just
 * wrote, so an ask answered and closed in the same window is one read rather than two): a pull request that
 * went away after the ask on it was answered is recorded beside that ask, and the reader that asks whether a
 * thread still exists (`proposalThreadEnding`) is the one that reads it back. `reopened` is the other
 * direction of that same half, and the half both kinds have (`SETTLEMENT_KINDS[*].reopens`): a request
 * tonight's list reports open again, whose thread the file still calls over, is recorded as the correction it
 * is — so this writer's three lists are one file's worth of news rather than three, and the caller writes
 * them with one write.
 *
 * Both of those read the file this pass has *just* written, so a request that was answered and closed in one
 * window is one reading rather than a night's lag, and neither can come to a different answer about the same
 * text than the reader every surface consults.
 *
 * @param {Object} [options]
 * @param {"floor"|"collect"} [options.kind] the kind of request being recorded
 * @param {string} [options.text] the runbook's text
 * @param {Array<object>} [options.settled] the settled requests a caller found
 * @param {string} [options.night] the night this run is dated by — the one record here that cannot be dated
 *   by the feed, a reopening having no day of its own for GitHub to state
 */
export function recordProposalSettlements(options = {}) {
  const kind = options.kind;
  const spec = SETTLEMENT_KINDS[kind];
  if (spec === undefined) throw new Error(`unknown settlement kind: ${String(kind)}`);
  const known = new Set(settlementsOf(options.text, kind).map((record) => record.number));
  const added = [];
  let text = String(options.text ?? "");
  const candidates = (Array.isArray(options.settled) ? options.settled : [])
    // A list off a workflow is whatever it is, and an entry that is not an object is not a request:
    // it is dropped here rather than handed to a reader, which would otherwise have to defend itself
    // against every way a caller can be wrong. Everything else the reader refuses on its own.
    .filter((request) => request !== null && typeof request === "object")
    .map((request) => spec.read(request))
    .filter((record) => record !== null)
    .sort((left, right) => (left.closed < right.closed ? -1 : left.closed > right.closed ? 1 : 0));
  for (const record of candidates) {
    if (known.has(record.number)) continue;
    known.add(record.number);
    added.push(record);
    text = appendRecord(text, record.line);
  }
  const night = options.night ?? new Date().toISOString();
  const closed = spec.closes === undefined ? { text, added: [] } : spec.closes(text, options.settled);
  const reopened =
    spec.reopens === undefined ? { text: closed.text, added: [] } : spec.reopens(closed.text, options.settled, night);
  return {
    text: reopened.text,
    added,
    records: settlementsOf(reopened.text, kind),
    closed: closed.added,
    reopened: reopened.added,
  };
}

/**
 * The floor proposals the runbook has recorded, one line per answered request.
 *
 * The kind-named entry point, kept because it is the one the night's floor step and the suite speak
 * in: `recordProposalSettlements` with the kind filled in, so a caller that knows it is recording
 * floor proposals hands over no string it could mistype into silence.
 *
 * @param {Object} [options]
 * @param {string} [options.text] the runbook's text
 * @param {Array<object>} [options.settled] the settled requests a caller found
 */
export function recordFloorProposals(options = {}) {
  return recordProposalSettlements({ ...options, kind: "floor" });
}

/**
 * The collect-budget proposals the runbook has recorded, the mirror of `recordFloorProposals`.
 *
 * The one kind-named entry whose answer carries a third list: this kind's asks can outlive the pull requests
 * they are left on, so the closes it recorded come back in `closed` (`recordPullCloses`) beside the
 * settlements the generic recorder answers with. A caller reporting what the night did reads the three lists
 * rather than asking the kind what it is — the settle mode in this file logs both, and the workflow that runs
 * it passes no condition of its own.
 *
 * @param {Object} [options]
 * @param {string} [options.text] the runbook's text
 * @param {Array<object>} [options.settled] the settled requests a caller found, as
 *   `collectProposalSettlement` reads them
 */
export function recordCollectProposals(options = {}) {
  return recordProposalSettlements({ ...options, kind: "collect" });
}

/**
 * The median trend above as the run page states it: the running median per night an answer arrived,
 * and what the newest of them sits against the two thresholds — or `[]` when there is no such line to
 * draw.
 *
 * The third reading of one history, after the two bands' worth, and the only one that is a reading of
 * *movement*: the tables above can only change on the night a single age crosses a threshold, while a
 * drift of the whole set shows up in the middle of the ages several answers earlier. That is what
 * this block exists for, and it says so where a reader meets it rather than leaving the line to be
 * interpreted — with the count behind every point printed, on the page and not only in the code,
 * because a median over three answers moves whenever one of them sat longer than half of the rest and
 * a rise read without that number would be a stronger claim than the records make.
 *
 * The chart is drawn on a scale of **0 → the loud end** rather than on the series' own range, which is
 * the one place it departs from `sparkline`'s convention. The departure is the point of the block: a
 * series normalized to itself would draw a half-night drift as a full climb, while bars measured in
 * nights from zero can be read against the same two thresholds the bands use — how far the middle of
 * the ages has to travel before the job has anything to say about one of them. A median that has gone
 * past the loud end widens the scale, and the line says which of the two it is doing.
 *
 * Three cases are stated rather than rendered as an absence, the rule the rest of the page follows: a
 * single answer night has no movement to draw (the numbers are there, the bars are not, and the
 * sentence says a second night is what turns this into a series), no answer night at all in the
 * counts means no record named a day to read a median against, and a record whose own day cannot be
 * read is named as counted above and absent here rather than plotted at a day nothing stated.
 *
 * @param {{ total: number, trend: Array<{ date: string, ages: number[], count: number,
 *   median: number, change: null|number }> }} distribution what `settlementDistribution` answers
 * @param {"floor"|"collect"} kind whose words name the two thresholds the newest median is held against
 */
function renderSettlementTrend(distribution, kind) {
  const points = Array.isArray(distribution?.trend) ? distribution.trend : [];
  const words = SETTLEMENT_WORDS[kind];
  const total = Number(distribution?.total);
  const plotted = points.length === 0 ? 0 : points[points.length - 1].count;
  const unplaced = Number.isFinite(total) && total > plotted ? total - plotted : 0;
  /** A count of nights in its own number, so no cell or sentence has to say `1 nights`. */
  const nights = (count) => (count === 1 ? "night" : "nights");

  const lines = [
    "#### How the median wait moved",
    "",
    "One point per night an answer arrived, oldest first: the median of every age recorded up to and",
    "including that night, and a night nothing was answered adds no point because there is no new age",
    "for a median to move on. The tables above are read one age at a time — an answer either crossed a",
    "threshold or it did not — while this line is read across them, so the middle of the ages can climb",
    "toward a threshold over several answers before any single one of them crosses it, which is the",
    "drift the bands have nothing to say about. The count behind each point is printed for the reason",
    "the median is: a median over three answers moves whenever one of them sat longer than half of the",
    "rest, so a rise here is the earliest a drift can be *seen* rather than evidence that one is",
    "happening.",
    "",
  ];

  if (points.length === 0) {
    // Every record the counts were made of is one whose own day cannot be read. Said out loud rather
    // than omitted: a block that simply had no line in it would read as a history too young to have
    // one, which is the opposite of what an unreadable day is.
    lines.push(
      "No record counted above names a day it was answered, so there is no night to read a median",
      "against — the ages themselves are in the table below, and a record that states its own day is",
      "what turns them into a series.",
      "",
    );
    return lines;
  }

  const medians = points.map((point) => point.median);
  const first = points[0];
  const latest = points[points.length - 1];
  /** How far a point's median moved against the one before it — the column a rise is read out of. */
  const changeCell = (change) =>
    change === null ? "—" : `${change > 0 ? "+" : ""}${change}`;

  lines.push(
    "| night answered | ages that arrived | ages so far | median so far | change |",
    "| :-- | :-- | --: | --: | --: |",
    ...points.map(
      (point) =>
        `| ${point.date} | ${point.ages.join(", ")} | ${point.count} | ${point.median} | ` +
        `${changeCell(point.change)} |`,
    ),
    "",
  );

  // One point is a number and not a movement: the bars would be a single glyph scaled to itself, and
  // the reading below says in as many words that a second night is what makes this a series.
  if (points.length > 1) {
    const high = Math.max(ESCALATED_NIGHTS, ...medians);
    const bars = medians.map((median) => barFor(median, 0, high)).join("");
    const scale =
      high > ESCALATED_NIGHTS
        ? `on a scale of 0 → ${high} nights — wider than the \`ESCALATED_NIGHTS\` = ` +
          `${ESCALATED_NIGHTS} the two thresholds divide, because one median has gone past it`
        : `on a scale of 0 → ${high} nights, the span the two thresholds divide ` +
          `(\`STALE_NIGHTS\` = ${STALE_NIGHTS}, \`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS})`;
    lines.push(
      `- **median wait** \`${bars}\` — ${latest.median} ${nights(latest.median)}, ` +
        (latest.median === first.median
          ? `no change from ${first.median}`
          : `${latest.median > first.median ? "up" : "down"} ` +
            `${Math.abs(latest.median - first.median)} from ${first.median}`) +
        ` (range ${Math.min(...medians)}–${Math.max(...medians)}) over ${points.length} nights an ` +
        `answer arrived on (${first.date} → ${latest.date}), ${scale}.`,
      "",
    );
  }

  // The movement, then the number it ended at held against each threshold in turn: the two things the
  // bars show the shape of. The peak is named only where the series ended *below* it — a rise that is
  // still climbing has already said where it got to, and so has a series that never moved — while a
  // median that came back down from a high the newest number alone would hide is the fact worth
  // stating, with the day it stood at.
  const peak = Math.max(...medians);
  const atPeak = points.find((point) => point.median === peak);
  const peaked = peak > latest.median ? ` (it peaked at ${peak} on ${atPeak.date})` : "";
  const movement =
    points.length === 1
      ? `The median is ${latest.median} ${nights(latest.median)} so far, from the one night an answer ` +
        "arrived on — a second one is what makes this a movement."
      : latest.median === first.median
        ? `The median has not moved from ${latest.median} ${nights(latest.median)} across the ` +
          `${points.length} nights an answer arrived on${peaked}.`
        : `The median has ${latest.median > first.median ? "risen" : "fallen"} ${first.median} → ` +
          `${latest.median} ${nights(latest.median)} across the ${points.length} nights an answer ` +
          `arrived on${peaked}.`;
  // Where that number sits, in this kind's own words for what each night is: the floor proposal's
  // mention, or — for the kind the job does not shout about — the clock it keeps for the request it
  // does, which is the same two numbers and not the same sentence.
  // Each threshold as the *night* it is: the kind's clause for what happens on it, in the phrase this
  // block names a night with — the bare clause is the wait warning's, which reads it after "at which".
  const night = (clause) => `the night ${clause}`;
  const place =
    latest.median >= ESCALATED_NIGHTS
      ? `past both thresholds (${night(words.clock.first)} at ${STALE_NIGHTS}, ` +
        `${night(words.clock.second)} at ${ESCALATED_NIGHTS})`
      : latest.median >= STALE_NIGHTS
        ? `past the first threshold (${night(words.clock.first)}, \`STALE_NIGHTS\` = ${STALE_NIGHTS}) ` +
          `and ${ESCALATED_NIGHTS - latest.median} ` +
          `${nights(ESCALATED_NIGHTS - latest.median)} short of the second ` +
          `(${night(words.clock.second)}, \`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS})`
        : `inside the first threshold: ${STALE_NIGHTS - latest.median} ` +
          `${nights(STALE_NIGHTS - latest.median)} short of ${night(words.clock.first)} ` +
          `(\`STALE_NIGHTS\` = ${STALE_NIGHTS})`;
  const absent =
    unplaced === 0
      ? ""
      : ` ${unplaced} of the ${total} records counted above ${unplaced === 1 ? "names" : "name"} ` +
        `no day it was answered, so ${unplaced === 1 ? "it is" : "they are"} in the tables above and ` +
        "not on this line.";

  lines.push(
    `${movement} The newest median, ${latest.median} ${nights(latest.median)}, is ${place}.${absent}`,
    "",
  );
  return lines;
}

/**
 * The warning a rise in the median earns: the level the history had held, and what crossed it.
 *
 * The two thresholds the job is tuned by are read one *request* at a time — a proposal crosses `3`
 * nights or it does not — so the first night either of them says anything about this job's wait is the
 * night a single request has already sat that long. The middle of the ages moves earlier than that: it
 * can climb past the worst it has ever been while every age in the records is still inside the first
 * band, which is the reading this exists to turn into something the night *says* rather than something
 * a person has to notice on a page.
 *
 * **What "the level it had held" is.** Not a committed number and not last night's: the highest median
 * any *earlier* answer night ended at, taken from the same series the page draws — the worst the middle
 * of the ages has ever been, and the night it first stood there. A median strictly above that is a
 * level nothing in the history has held, so the reading is an event rather than a state: it fires on
 * the night the wait becomes worse than it has ever been and never re-fires as long as the median stays
 * below the line it crossed. A median that merely fell back to a level some earlier night held is not a
 * warning, and neither is one that matched the worst without passing it.
 *
 * A history with one answer night has held nothing yet — there is no "before" to be worse than — so it
 * answers `null`, the omission the rest of this page makes rather than a warning about a series that
 * has not moved. `reached` is how many of the ages counted above have already met each threshold, so the
 * sentence can say whether the rise arrived *before* the night-count thresholds did, which is the whole
 * claim: those ages are read exactly as the bands above read them, so the warning cannot disagree with
 * the tables it sits above.
 *
 * @param {Array<{ date: string, number?: string, nights: number, outcome?: string }>} records the
 *   settled requests, as the sections above hold them
 * @returns {null|{
 *   held: number, heldSince: string, latest: number, latestDate: string,
 *   answers: number, nights: number, total: number, reached: { first: number, second: number },
 * }}
 */
export function settlementWaitWarning(records) {
  const points = settlementAgeTrend(records);
  // The newest point is the reading; everything before it is the level it is read against. One point is
  // no history at all, and a night with no new answers cannot raise the middle of anything.
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const earlier = points.slice(0, -1);
  const held = Math.max(...earlier.map((point) => point.median));
  if (!(latest.median > held)) return null;
  // The crossing counts come off the records the same way the distribution's bands do — the same
  // filter, so `reached.first` and the second band's count are one number rather than two readings of
  // it — while the series' own count is the one printed beside the median.
  const ages = (Array.isArray(records) ? records : [])
    .map((record) => Number(record?.nights))
    .filter((nights) => Number.isFinite(nights) && nights >= 0);
  return {
    held,
    heldSince: earlier.find((point) => point.median === held).date,
    latest: latest.median,
    latestDate: latest.date,
    answers: latest.count,
    nights: points.length,
    total: ages.length,
    reached: {
      first: ages.filter((nights) => nights >= STALE_NIGHTS).length,
      second: ages.filter((nights) => nights >= ESCALATED_NIGHTS).length,
    },
  };
}

/**
 * The half of a wait warning that both the page and the night's own line say: whether the rise arrived
 * *before* the two night-count thresholds did — an age still to cross the first of them, or the plain
 * fact that some have.
 *
 * One declaration for two readers, because it is the claim the warning is made of rather than a
 * sentence about it: a page that said "before the thresholds" while the annotation said "after them"
 * would be two answers to one question, and the numbers behind both are the same records.
 *
 * @param {NonNullable<ReturnType<typeof settlementWaitWarning>>} warning
 * @param {"floor"|"collect"} kind whose words name the first threshold
 */
function waitThresholdsClause(warning, kind) {
  const words = SETTLEMENT_WORDS[kind];
  const nights = (count) => (count === 1 ? "night" : "nights");
  const at = `the ${STALE_NIGHTS} ${nights(STALE_NIGHTS)} at which ${words.clock.first}`;
  return warning.reached.first === 0
    ? `no age in the records has yet reached ${at}`
    : `${warning.reached.first} of the ${warning.total} ages in the records have already reached ${at}`;
}

/**
 * The warning above as the run page states it, or `[]` when nothing crossed a level the history held.
 *
 * It leads the section rather than joining the blocks under it, because a warning is only worth raising
 * where a reader meets it first: the distribution, the trend and the receipts are all read *after* the
 * fact, and a night that has something to say about its own wait should say it before the tables they
 * are the arithmetic of. It is still one section of the same page, so the artifact and the summary carry
 * it with everything else, and it is absent — not empty — on the nights nothing crossed.
 *
 * Both thresholds are named with their numbers and this kind's words for what each night is, exactly as
 * the trend's reading does: the sentence has to say whether the rise came before *the night-count
 * thresholds* did, and those are the two numbers the whole job is tuned by.
 *
 * `crossings` is the runbook's own record of the crossings a comment has already been about
 * (`waitCrossings`), and the block's last paragraph is the *event* half of the reading: this page and
 * the run's annotation go on stating a wait that stands — each is a rendering of a night rather than a
 * message to somebody — while the comment, the one channel of the three that lands where a person is, is
 * left once per crossing. The rule for which of the two paragraphs is stated is the decider's own
 * (`unsaidWaitWarning` over `saidWaitLevel`), so the page cannot claim a comment is still owed on a night
 * the step decided not to leave one, nor the other way round. `null` is a caller that handed over no
 * record at all and gets neither paragraph, because it cannot be known; `[]` is a runbook that records
 * none, which is a fact and is said as one.
 *
 * @param {NonNullable<ReturnType<typeof settlementWaitWarning>>} warning what the decider answered
 * @param {"floor"|"collect"} kind whose words name the two thresholds
 * @param {null|Array<object>} [crossings] the crossings the runbook records, or `null` for a caller
 *   with no record to hand over
 */
function renderSettlementWaitWarning(warning, kind, crossings = null) {
  const nights = (count) => (count === 1 ? "night" : "nights");
  const answers = `answer${warning.answers === 1 ? "" : "s"}`;
  const said = crossings === null ? null : saidWaitCrossing(crossings);
  const owed = unsaidWaitWarning(warning, said === null ? null : said.held);
  return [
    "#### The median wait is past the level it had held",
    "",
    `The middle of these ages is now ${warning.latest} ${nights(warning.latest)}, higher than the ` +
      `${warning.held} ${nights(warning.held)} the history had held since ${warning.heldSince} — ` +
      `${waitThresholdsClause(warning, kind)}. That is what a median is carried for: a band only moves ` +
      "on the night a single age crosses a threshold, while the middle of the ages moves first, and " +
      `this one moved on ${warning.latestDate}, over the ${warning.answers} ${answers} recorded so far.`,
    "",
    ...(crossings === null
      ? []
      : [
          said !== null && owed === null
            ? `The night has already said it where a person will meet it: the comment it left on ` +
              `#${said.number} on ${said.date} announced this crossing, and the record of that in the ` +
              "runbook is why there is no second one — this page and the run's annotation restate a " +
              "wait that stands, while a comment is left once per crossing, the level it passed being " +
              "what a later rise has to beat to be news."
            : "No comment has been left about this crossing yet — the night leaves one on the floor " +
              "proposal that is open to answer it, and records the crossing it said in `.freebuff/run.md`, " +
              "so it is said once rather than every night this stands.",
          "",
        ]),
  ];
}

/**
 * The same warning as the night's own words: one line for the step's log and, under
 * `--github-annotations`, for the annotation GitHub attaches to the run.
 *
 * One sentence behind two surfaces, because they are the same finding and a log line that disagreed
 * with the annotation would be the one thing worse than saying nothing. It is written in the step's own
 * `night(s)` register rather than the page's prose — the log is a night's log — and it leads with the
 * kind, because one run carries two of these and which kind's wait moved has to be readable off it.
 *
 * @param {NonNullable<ReturnType<typeof settlementWaitWarning>>} warning what the decider answered
 * @param {"floor"|"collect"} kind which kind's wait rose
 */
function settlementWaitLine(warning, kind) {
  const nights = (count) => (count === 1 ? "night" : "nights");
  return (
    `the median wait for ${SETTLEMENT_KINDS[kind].label} is ${warning.latest} ` +
    `${nights(warning.latest)}, past the ${warning.held} ${nights(warning.held)} it had held since ` +
    `${warning.heldSince} — ${waitThresholdsClause(warning, kind)}`
  );
}

/**
 * A warning as the GitHub Actions workflow command that becomes an annotation on the run.
 *
 * The shape is `.freebuff/ci.mjs`'s own — `::warning file=…,title=…::message`, with the message's `%`,
 * CR and LF escaped and the property list's `:`, `,` and `%` as well — so the two ways this repository
 * annotates a run are one shape rather than two that drift. The message is escaped here rather than
 * trusted: it carries a decimal median, which is exactly where a `%` would come from.
 *
 * The file is the runbook, not a source file: what the annotation points at is the record the reading
 * was taken from, which is the only place a reader can check the numbers behind it.
 *
 * The level is the caller's, because the two findings this module annotates are not the same kind of
 * thing: the settled wait is a `warning`, since nothing about a median is a verdict, while a crossing
 * line the settlements cannot produce is an `error` — the night stops over it, and the annotation is how
 * a reviewer watching the run meets the line rather than only the red that follows.
 *
 * @param {string} title the annotation's title, which the run groups by
 * @param {string} message the line to attach
 * @param {"warning"|"error"} [level] which annotation GitHub shows, `warning` by default
 */
function waitAnnotation(title, message, level = "warning") {
  const escapeData = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return (
    `::${level} file=${escapeProperty(RUNBOOK_FILE)},title=${escapeProperty(title)}::` +
    escapeData(message)
  );
}

/**
 * The warning above as the comment the night leaves on the request that is still open.
 *
 * The third channel for one finding, and the only one of the three that can reach a person: the page
 * reaches whoever opens the run, the annotation reaches whoever is watching the job, and a comment on
 * the pull request is where somebody who can answer it is already looking. It is deliberately *not* a
 * paragraph in the night's other comment (`renderNudgeComment`), because the two are different
 * findings with different triggers and a reviewer should be able to tell which is which from the first
 * line: the nudge is about *this request's* age and exists only on a night the floors moved, while
 * this is about the record — the middle of every age the runbook holds, past the worst any earlier
 * night ended at — and is owed on any night that stands above that line with a request open to answer
 * it. A night can carry both; a night can carry either.
 *
 * What it is *about* is the sample rather than this request, and it says so: the finding is that these
 * proposals are now being answered later than they have ever been, which is a fact about the job's own
 * loudness and not a complaint about one merge. So the request the comment sits on is named as the one
 * that answers the reading — it is the only floor proposal the job has in play — while how long it has
 * sat is left to the footer, where it is a detail rather than the subject. The same reading is what
 * makes the comment *not* an escalation: the mention past `ESCALATED_NIGHTS` belongs to the night's own
 * comment about this request's age, and a mention that meant two different things would mean neither.
 *
 * `nights` is the request's own age, or `null` when it cannot be read: the footer drops the phrase
 * rather than printing a number this could not compute, the omission the rest of the page makes.
 *
 * @param {{
 *   wait: NonNullable<ReturnType<typeof settlementWaitWarning>>,
 *   number: string|number,
 *   created?: string|null,
 *   nights?: null|number,
 * }} options the finding, and the request it is being said on
 */
export function renderFloorWaitComment({ wait, number, created = null, nights = null }) {
  /** A count of nights in its own number, so no sentence here has to say `1 nights`. */
  const counted = (count) => (count === 1 ? "night" : "nights");
  // The request's own age, which is a detail of this comment rather than its subject: dropped rather
  // than guessed when a caller hands over no number to state, the omission the page makes elsewhere.
  const open = [
    nights === null ? "" : `${nights} ${counted(nights)} open`,
    created === null ? "" : `since ${created}`,
  ]
    .filter((part) => part !== "")
    .join(", ");
  return [
    "## The wait these proposals settle at is now the worst the record holds",
    "",
    `The middle of every age in the record is now ${wait.latest} ${counted(wait.latest)}, higher than ` +
      `the ${wait.held} ${counted(wait.held)} the history had held since ${wait.heldSince} — ` +
      `${waitThresholdsClause(wait, "floor")}.`,
    "",
    "That is a reading of the record rather than of this request: the two thresholds this job is tuned",
    "by are read one request at a time, so the first night either of them says anything about a floor",
    "proposal is the night one of them has already sat that long, while the middle of the ages moves",
    "first — and it has just moved past the worst any night before it ended at. The ages behind it are",
    "how long the proposals before this one sat before somebody merged or closed them.",
    "",
    "**This request is the one that answers that reading**, because it is the only floor proposal the",
    "job has in play: merging accepts the lower level as the level those readings have settled to, and",
    "closing it means the other answer — the floors you would rather hold, written by `npm run",
    "coverage:low-water` over this tree and committed with the file it writes.",
    "",
    "The nightly job says this on its own run page too, and as an annotation on the run; the comment is",
    "here because a page reaches nobody's inbox. It names no person on purpose: the mention past the",
    `${ESCALATED_NIGHTS} nights this job only comments through belongs to the night's *own* note about ` +
      "how long this request has sat, and a mention that meant two findings would mean neither.",
    "",
    `<sub>#${number}${open === "" ? "" : ` · ${open}`} · the median wait is ${wait.latest} ` +
      `${counted(wait.latest)} · posted by the nightly job · \`.freebuff/coverage-trend.mjs --settle-floor\`</sub>`,
    "",
  ].join("\n");
}

/**
 * The head of a recorded wait crossing: the line the night appends for a crossing it has commented on.
 *
 * `- **<night> — settled wait on #<request>: the median reached <median> nights, past the <level> it
 * had held since <since>.**` — the night the comment was left, the request it was left on, the median
 * standing at the time, and the field the record exists for: the *level* the crossing passed, with the
 * night that level had stood since.
 *
 * Deliberately not a `SETTLEMENT_HEADS` entry. A settlement is a fact about one of the job's *requests*
 * (it sat for so long and then somebody answered it); this is a fact about the job's own wait — the
 * middle of the ages passed a level the history had held — and the two answer different questions, so
 * they are read by different readers: `waitCrossings` here, `settlementsOf` there. Nothing else in this
 * module can even see this head (`runbookRecords` needs a `ci verdict` line, `settlementsOf` needs one
 * of its two), which is what keeps a crossing out of the readings the floors are derived from and out
 * of the settlement dedupe.
 *
 * The head is what makes the line a record rather than prose about one, exactly as a settlement's dated
 * head is: the pattern is anchored on the sentence, so a line that has been edited by hand into
 * something else stops being a crossing rather than being read as a nearly-right one.
 */
const WAIT_CROSSING_HEADS = {
  floor:
    /^- \*\*(\d{4}-\d{2}-\d{2}) — settled wait on #(\d+): the median reached ([\d.]+) nights?, past the ([\d.]+) it had held since (\d{4}-\d{2}-\d{2})\.\*\*/,
  collect:
    /^- \*\*(\d{4}-\d{2}-\d{2}) — settled collect-budget wait: the median reached ([\d.]+) nights?, past the ([\d.]+) it had held since (\d{4}-\d{2}-\d{2})\.\*\*/,
};

/**
 * How each kind *says* a crossing, in this module's own words, for the sentences that name it: the
 * line's own (what said it, and what that makes of the finding) and the block's (what the bar is, and
 * who wrote the line).
 *
 * Two channels, because the kinds have different ones. The floor kind leaves a comment — on the request
 * it keeps open itself — and that comment is the crossing's saying; the collect kind has none, its
 * proposals being comments on somebody else's pull request, so the run page and the run's annotation
 * are the whole of what tells a reader and the recorded level is what the section is held against. The
 * finding is an event for both, and for the same reason: the two renderings go on stating a wait that
 * stands, while the level passed is written down once.
 */
const CROSSING_WORDS = {
  floor: {
    subject: (record) => `settled wait on #${record.number}`,
    said:
      "Said the night it happened, in the comment this job left on that request — the one channel of " +
      "the three that reaches somebody who is not reading the run.",
    event:
      "That is what makes the finding an *event*: the page and the run's annotation go on stating a " +
      "wait that stands, and the night stops leaving comments until a later answer passes a level " +
      "above this one.",
    rule: "a comment is left while the middle of the ages is above every level on record",
    wrote: "The night that left the comment wrote the line from these records",
  },
  collect: {
    subject: () => "settled collect-budget wait",
    said:
      "Said the night it happened, on this run's page and in its annotation — this kind leaves no " +
      "comment, having no request of its own to leave one on.",
    event:
      "That is what makes the finding an *event* here as well: the page and the annotation go on " +
      "stating a wait that stands while the level it passed is on record, and that record is what the " +
      "settlement section holds its own lines against.",
    rule:
      "the run page and the run's annotation say it while the middle of the ages is above every level " +
      "on record",
    wrote: "The night that rendered that page wrote the line from these records",
  },
};

/** The dated bullet a crossing is recorded as: its head, then what the record is for. */
function waitCrossingLine(record, kind) {
  const { date, latest, held, since } = record;
  const words = CROSSING_WORDS[kind] ?? CROSSING_WORDS.floor;
  const nights = (count) => (count === 1 ? "night" : "nights");
  return (
    `- **${date} — ${words.subject(record)}: the median reached ${latest} ${nights(Number(latest))}, ` +
    `past the ${held} it had held since ${since}.** ${words.said} ${words.event}`
  );
}

/**
 * One crossing as the dated bullet the runbook records it with, or `null` for one that cannot be
 * stated: a night or a level that is not a number, or — for the kind whose line names one — a request
 * with no number to name.
 *
 * The same refusal the settlement records make, and for the same reason — a line this module cannot read
 * back is not a record — while `latest` is carried as the number it was, so a half night (`2.5`) is
 * stated as one rather than rounded into a different reading.
 *
 * The kind is what the line is written *for*: the floor kind's names the request its comment was left
 * on, which is a number it must therefore have, while the collect kind's names the series, there being
 * no request of this job's own in that story.
 *
 * @param {Object} [options]
 * @param {"floor"|"collect"} [options.kind] the series the crossing belongs to, `floor` when left out
 * @param {string} [options.date] the night it was said
 * @param {string|number} [options.number] the request the comment was left on, for the floor kind
 * @param {string|number} [options.latest] the median when the crossing was noticed
 * @param {string|number} [options.held] the level the crossing passed
 * @param {string} [options.since] the night that level had stood since
 */
export function waitCrossing(options = {}) {
  const kind = options.kind === "collect" ? "collect" : "floor";
  const date = utcDay(options.date);
  const since = utcDay(options.since);
  const number =
    options.number === undefined || options.number === null ? "" : String(options.number).trim();
  const latest = Number(options.latest);
  const held = Number(options.held);
  if (
    date === null ||
    since === null ||
    (kind === "floor" && number === "") ||
    !Number.isFinite(latest) ||
    !Number.isFinite(held)
  ) {
    return null;
  }
  const record = { kind, date, number, latest, held, since };
  return { ...record, line: waitCrossingLine(record, kind) };
}

/**
 * Every crossing the runbook records, oldest first as the file holds them.
 *
 * `[{ kind, date, number, latest, held, since }]`, read rather than re-derived for the settlement
 * records' reason: the record is what a person reviews the job against, so it has to be readable back
 * exactly as it was written. The *oldest first* order is the file's own, and the level the record is
 * consulted for is taken from all of them (`saidWaitCrossing`), so an out-of-order line — a bullet added
 * by hand, a backfilled night — changes nothing about the bar.
 *
 * **One kind at a time, or all of them.** A `kind` reads that series' own lines and nothing else: the
 * two waits are watched separately (`settlementWaitWarning` per kind's own records), so a level one
 * series passed is nothing the other may measure against — a comment about the floor proposal's wait
 * says nothing about the collect proposals'. The whole-file form reads every kind's head and tags each
 * record with the kind it belongs to, which is what the trend step's check over the runbook needs: it
 * holds each series' lines against that series' own settlements. A collect record carries no request
 * number, because there is no request of this job's own in that story.
 *
 * @param {string} text the runbook's text
 * @param {"floor"|"collect"} [kind] the series to read, or every kind when left out
 */
export function waitCrossings(text, kind) {
  const kinds = kind === undefined ? Object.keys(WAIT_CROSSING_HEADS) : [kind];
  const records = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    for (const entry of kinds) {
      const head = WAIT_CROSSING_HEADS[entry]?.exec(line);
      if (head === null || head === undefined) continue;
      records.push({
        kind: entry,
        date: head[1],
        number: entry === "collect" ? "" : head[2],
        latest: Number(entry === "collect" ? head[2] : head[3]),
        held: Number(entry === "collect" ? head[3] : head[4]),
        since: entry === "collect" ? head[4] : head[5],
      });
      break;
    }
  }
  return records;
}

/**
 * The crossing the bar is read from: the one whose `held` is the highest any comment has been about,
 * and — where two stand at the same level — the later of them.
 *
 * One function rather than a maximum computed where it is needed, because two readers ask it: the
 * decider that says whether a night still owes a comment (`unsaidWaitWarning`, through `saidWaitLevel`)
 * and the page, which names the comment a standing wait has already been said in. A page that named one
 * crossing while the decider measured against another would be two answers to one question, and the two
 * tie-breaks here are the reading that keeps them one. `null` for a list with no readable level in it,
 * which is the omission the rest of this module makes rather than a bar of zero — a level nobody has
 * held is not a level a rise has to pass.
 *
 * @param {Array<{ date: string, number: string, latest: number, held: number, since: string }>} crossings
 */
export function saidWaitCrossing(crossings) {
  const records = (Array.isArray(crossings) ? crossings : []).filter(
    (crossing) =>
      crossing !== null &&
      typeof crossing === "object" &&
      Number.isFinite(Number(crossing.held)),
  );
  if (records.length === 0) return null;
  return records.reduce((best, crossing) => {
    const level = Number(crossing.held);
    const standing = Number(best.held);
    if (level > standing) return crossing;
    if (level === standing && String(crossing.date) > String(best.date)) return crossing;
    return best;
  });
}

/**
 * The level a comment has already been about, or `null` when the runbook records no crossing at all.
 *
 * The number the `unsaidWaitWarning` comparison is written in, and the reason the crossing is recorded
 * as a *level* rather than as a night: what makes a later rise news is not that some time has passed
 * but that the middle of the ages has climbed past somewhere it had already been and been told about.
 *
 * @param {Array<{ held: number }>} crossings
 */
export function saidWaitLevel(crossings) {
  const crossing = saidWaitCrossing(crossings);
  return crossing === null ? null : Number(crossing.held);
}

/**
 * The warning a night still owes a comment for: the crossing above every level a comment has already
 * been about, or `null` when the wait is held or when this crossing is one the night has said.
 *
 * This is the half of the reading that makes the finding an **event**. `settlementWaitWarning` is a
 * *state*: it answers whether the newest median is above the worst any earlier night ended at, and the
 * run page and the run's annotation say so for as long as that stands, each of them being a rendering
 * of the night rather than a message to somebody. A comment is the other thing — it lands where a person
 * is, and it stays there — so it is left once per crossing, and `said` (the level already commented on,
 * `saidWaitLevel`) is the bar that decides. *Strictly above*, because a crossing's own level grows as
 * the series does: a median that came back down and later climbed past a level already announced is
 * not news, while one that passed a level no comment has ever been about is exactly the event this
 * exists for. `null` — no crossing recorded at all — owes the comment, because nothing has been said
 * yet.
 *
 * A night that rises with nothing to say it on records nothing (`recordWaitCrossing` is only reached
 * once a comment has been written), so the crossing stays owed and the next night with a request open
 * says it. That is deliberate: a crossing swallowed by a quiet night would be the one failure this
 * whole channel is for.
 *
 * @param {null|NonNullable<ReturnType<typeof settlementWaitWarning>>} warning what the state read
 * @param {null|number} said the highest level a comment has already been about
 */
export function unsaidWaitWarning(warning, said) {
  if (warning === null || warning === undefined) return null;
  if (said === null || said === undefined) return warning;
  return warning.held > said ? warning : null;
}

/**
 * The runbook with a crossing recorded in it, and whether this call is what recorded it.
 *
 * The settlement writer's shape — one line appended, the blank line before it, `added` naming what went
 * in — with one difference that is the whole of the record's value: a crossing at or below a level the
 * runbook already states is **not** written again, so the writer is total. A second run over the same
 * night (a retried step, a mode a person runs by hand) therefore records nothing and says so by
 * answering `added: null`, and the record cannot come to state two crossings at one level however the
 * caller calls it. The caller's own decision (`unsaidWaitWarning`) reads the same bar, so the two agree
 * by construction rather than by both being written carefully.
 *
 * "A comment has been written" is exactly that and no more: the CLI reaches this once the body the
 * poster step reads exists, because the record and the comment are one decision made once, while the
 * *delivery* is the poster's own business — a night whose comment never arrived is a red run (the gate
 * at the end of the job reads that step's outcome), and its finding is still carried every night by the
 * run page and the run's annotation. Recording at the post instead would put the line after the commit-
 * back into a runner's checkout, where it would die with the runner — the loss this record exists to stop.
 *
 * @param {string} text the runbook's text
 * @param {null|ReturnType<typeof waitCrossing>} crossing the crossing to record
 */
export function recordWaitCrossing(text, crossing) {
  const runbook = String(text ?? "");
  if (crossing === null || crossing === undefined || typeof crossing !== "object") {
    return { text: runbook, added: null };
  }
  // The bar this is held against is its *own* kind's: the two series are watched separately, so a
  // collect crossing is not a level the floor proposal's wait has been told about, or the other way
  // round.
  const said = saidWaitLevel(waitCrossings(runbook, crossing.kind));
  if (said !== null && !(Number(crossing.held) > said)) return { text: runbook, added: null };
  return { text: appendRecord(runbook, crossing.line), added: crossing };
}

/**
 * What is wrong with the runbook's record of the crossings a comment has been about, read against the
 * settlement records themselves: every way the bar a night's decision is written in can have drifted
 * from the history it claims to describe.
 *
 * This is the gate over the record, and it exists for the reason the record does. A crossing line is
 * not a reading — nothing derives a floor from it and the trend charts nothing off it — it is the
 * **bar**: `unsaidWaitWarning` answers a comment while the median is above every level the runbook says
 * one has already been about, so a line the history cannot produce is not a stale note, it is a level
 * nothing has held. Both directions are failures. A bar above what the records held suppresses comments
 * about a wait that really is worse than any night before; a bar below it invites a comment about a
 * level the night has already been told about, which is the repeat the record exists to stop. And the
 * line is a person-readable record in a file people edit, written by a *previous* night's run, so it has
 * to be held against the records rather than trusted — which is why this fails a night rather than
 * correcting anything: the records are the history, the line is a claim about it, and the night that
 * reads the claim is the night that can tell the two apart.
 *
 * The series is `settlementAgeTrend`'s own — the points the page's trend and `settlementWaitWarning` are
 * built from — so the bar is checked against the very numbers the decision is written in, and a recorded
 * crossing is exactly one of that series' events: a night whose median is the `latest` the line states,
 * whose earlier points had held the `held` it says it passed, with that level first standing on the
 * `since` it names, and a night it was said on that is not before it. One leg missing is one finding,
 * and the legs are checked in the order the arithmetic fails — the median, then the level, then the
 * night the level first stood, then the date — so the sentence a reader gets is the first thing that is
 * wrong rather than a list of everything that follows from it.
 *
 * Two omissions, both deliberate. A `records` list that is not a series yet — fewer than two nights an
 * answer arrived on — produces no findings: a line with nothing to check it against is not a line the
 * records refute, and a bar is only wrong about a history there is one. And a runbook that records no
 * crossings is checked for nothing, so a checkout before the first rise reads exactly as it did.
 *
 * @param {Array<{ date: string, number?: string, nights: number, outcome?: string }>} records the
 *   settled requests, as `settlementsOf` answers them
 * @param {Array<{ date: string, number: string, latest: number, held: number, since: string }>} crossings
 *   the crossings the runbook records, as `waitCrossings` answers them
 * @returns {Array<{ crossing: object, reason: string, seen: object }>} one finding per drifting line,
 *   and `[]` when every line is a crossing the records produce
 */
export function waitCrossingDrift(records, crossings) {
  const lines = (Array.isArray(crossings) ? crossings : []).filter(
    (crossing) => crossing !== null && typeof crossing === "object",
  );
  if (lines.length === 0) return [];
  const points = settlementAgeTrend(records);
  if (points.length < 2) return [];

  const findings = [];
  for (const crossing of lines) {
    const latest = Number(crossing.latest);
    const held = Number(crossing.held);
    // The crossing's own arithmetic first: the writer only ever states a median above the level behind
    // it, so a line that states either the other way round is not a crossing anything should measure
    // against — and a level that is not a number at all cannot be compared with the series.
    if (!Number.isFinite(latest) || !Number.isFinite(held) || !(latest > held)) {
      findings.push({ crossing, reason: "unpassed", seen: { latest, held } });
      continue;
    }
    // Every night the middle of the ages stood at the level the line states: the crossing is one of
    // them, and which one is pinned by the legs below rather than by the line's own date.
    const at = points
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => point.median === latest);
    if (at.length === 0) {
      findings.push({ crossing, reason: "unreached", seen: { latest } });
      continue;
    }
    const heldAt = at.filter(
      ({ index }) => index > 0 && Math.max(...points.slice(0, index).map((point) => point.median)) === held,
    );
    if (heldAt.length === 0) {
      const newest = at[at.length - 1];
      findings.push({
        crossing,
        reason: "unheld",
        // `null` is the line that states the very first night the series has, where there is no history
        // behind it to have held anything: a bar with nothing before it, rather than a bar of zero.
        seen: {
          held,
          worst: newest.index === 0 ? null : Math.max(...points.slice(0, newest.index).map((point) => point.median)),
        },
      });
      continue;
    }
    const sinceAt = heldAt.filter(({ index }) =>
      points
        .slice(0, index)
        .find((point) => point.median === held)
        ?.date === crossing.since,
    );
    if (sinceAt.length === 0) {
      const newest = heldAt[heldAt.length - 1];
      findings.push({
        crossing,
        reason: "unsince",
        seen: {
          held,
          since: crossing.since,
          first: points.slice(0, newest.index).find((point) => point.median === held)?.date ?? null,
        },
      });
      continue;
    }
    // …and the last leg, which is the line's own date: a crossing cannot have been said before the night
    // it happened, so a night that reads before the night the median moved is a line about a night the
    // record does not have — the wrong `--today`, most often.
    if (!sinceAt.some(({ index }) => String(crossing.date) >= points[index].date)) {
      const newest = sinceAt[sinceAt.length - 1];
      findings.push({
        crossing,
        reason: "premature",
        seen: { date: crossing.date, movedOn: points[newest.index].date },
      });
    }
  }
  return findings;
}

/**
 * The distribution above as the run page states it, or `null` when there is nothing to count.
 *
 * Two tables and a trend, because the questions are separate and a reader should not have to do the
 * arithmetic that joins them: where the ages landed against the thresholds the job is tuned by, the
 * escalation read the only way whole dates can be read — how often an answer arrived on the day the
 * mention first went out, which is the one reading that can be given as the mention having answered
 * something, against how many nights the mentions that arrived and were not answered stood there —
 * and how the middle of those ages moved across the nights they were answered on, which is the one of
 * the three that can rise before any single age has crossed a threshold. Every count is printed,
 * zeroes included: a row reading 0 is what the next year of records is read against, and a table that
 * dropped it would make an escalation that has never happened indistinguishable from a band this page
 * does not count.
 *
 * `kind` picks the vocabulary the two thresholds are named with (`SETTLEMENT_WORDS`): the counts and
 * their arithmetic are this function's and are shared, while what the loud end is *called* is not —
 * the floor proposal's mention and the clock the job keeps for it are the same two numbers and not
 * the same sentence, and a section that said otherwise would be describing a mechanism its kind has
 * not got. The kind is asked for rather than a table handed in, so the one place the words live stays
 * module-private and a caller cannot pass another kind's.
 *
 * @param {{ total: number, bands: Array<{ band: string, count: number, share: number }>,
 *   fastest: number, slowest: number, escalation: { crossed: number, onFirstNight: number,
 *   later: number, spareNights: number } }} distribution what `settlementDistribution` answers
 * @param {"floor"|"collect"} kind whose words for the clock the section is written in
 */
export function renderSettlementDistribution(distribution, kind) {
  if (distribution === null || typeof distribution !== "object") return null;
  const { total, bands, fastest, slowest, escalation } = distribution;
  const words = SETTLEMENT_WORDS[kind];
  const answers = total === 1 ? "answer" : "answers";
  // The escalation, in one paragraph: how many arrived past the loud end of the job's clock, how many
  // of those on the day it was reached, and what the rest cost in nights. The reading is named as a
  // reading rather than as a causal claim, because a date cannot carry one — an answer landing on the
  // day the loud end was reached is the closest two whole dates come, and this page says that instead
  // of asserting that whatever the words call it is what did it.
  const escalationRead =
    escalation.crossed === 0 ? words.quiet(total, answers) : words.loud(total, answers, escalation);
  return [
    "#### Where the ages landed",
    "",
    "Every settlement recorded so far, counted by the band its age falls in — the same three",
    "boundaries the records' own lines name, so the table and the wording of the records cannot",
    "disagree:",
    "",
    "| band | answered | share |",
    "| :-- | --: | --: |",
    ...bands.map((entry) => `| ${entry.band} | ${entry.count} | ${entry.share}% |`),
    "",
    "Shares are whole percents, so the column may read 99 or 101 where it should read 100. The",
    `fastest answer came after ${fastest} ${fastest === 1 ? "night" : "nights"} and the slowest ` +
      `after ${slowest}, which is the spread these bands are a coarse reading of.`,
    "",
    "#### How often the escalation mattered",
    "",
    `| the answer came | answers | ${words.rows.header} |`,
    "| :-- | --: | --: |",
    `| ${words.rows.loud} | ${escalation.onFirstNight} | 0 |`,
    `| later than that | ${escalation.later} | ${escalation.spareNights} |`,
    `| ${words.rows.before} | ${total - escalation.crossed} | — |`,
    "",
    escalationRead,
    "",
    // …and the third reading, which is the only one of them about *movement* rather than about how
    // many answers landed where: the same ages read across the nights instead of into three bands.
    ...renderSettlementTrend(distribution, kind),
  ].join("\n");
}

/**
 * The crossing lines the records do not produce, as the settlement section states them, or `null` when
 * there is nothing to state.
 *
 * The same finding the trend step reds its log with (`waitDriftLines`), on the page instead of in a
 * step's log — and it is a page worth having it on, because the lines are the runbook's *record* of
 * what the job has already said, and the run page is where that record is discussed. A reader of the
 * trend step alone knows a night failed; a reader of this section knows it while reading the very
 * history the lines were derived from, without opening the log of a step two stages away.
 *
 * Both directions are failures and both are stated, which is the whole reason the finding exists: a bar
 * above what these records held silences a crossing that is really new, and one below invites a second
 * comment about a level already said — the single-saying the record is kept for. It is placed with the
 * reading rather than under it, for the reason a warning leads this page: the sentences below lean on
 * these very lines, so a record the settlements cannot produce has to be met before the paragraphs that
 * quote it as settled fact.
 *
 * `null` — not an empty block — when there is nothing to state, which is every night whose record
 * matches its settlements, and the section is only rendered at all when there are records to hold the
 * lines against: a night with no settlements yet has no section and no drift on the page, and the trend
 * step is where that night reads the finding.
 *
 * @param {null|Array<{ crossing: { number: string, date: string }, reason: string, seen: object }>}
 *   findings what `waitCrossingDrift` answers for these records and the runbook's crossings
 */
export function renderWaitDrift(findings, kind = "floor") {
  const lines = (Array.isArray(findings) ? findings : []).filter(
    (finding) => finding !== null && typeof finding === "object",
  );
  if (lines.length === 0) return null;
  // The kind's own words for what the bar is and who wrote the line, because the two kinds say a
  // crossing in different channels: the block is rendered by whichever series' findings these are,
  // and it may not claim a comment the collect kind has never left.
  const words = CROSSING_WORDS[kind] ?? CROSSING_WORDS.floor;
  return [
    "#### A crossing line the records do not produce",
    "",
    "The runbook's record of the crossings this wait has already been told about (`.freebuff/run.md`)",
    "is the bar this job's reading is written in: " +
      `${words.rule}, which is what makes the finding an event said once rather than a state restated ` +
      "every night. These lines are not crossings these settlement records produce, each with the first",
    "thing about it the records cannot answer:",
    "",
    ...lines.map((finding) => `- **${waitDriftWhere(finding)}** — ${waitDriftNote(finding)}.`),
    "",
    "Both directions are failures, which is why the line is what has to move: a bar above what these",
    "records held silences a crossing that is really new, and one below has a level said again that was",
    `already said. ${words.wrote}, and the trend step at the end of this job holds these same lines ` +
      "against these same settlements and fails the run over them — this is that finding stated where the",
    "record is discussed, not a second one. So the repair is the record's: re-derive the line from the",
    "settlements, or delete it and let the next rise say the crossing again.",
    "",
  ].join("\n");
}

/**
 * The settled proposals as the run page states them, or `null` when there is nothing to state.
 *
 * This is the review the records exist for, on the page a person reads: every proposal the job has
 * opened, how long it sat and which threshold that crossed, so the two constants can be read against
 * what actually happens instead of against what they were meant to catch. It says so in as many
 * words, because a table of ages without the question it answers is decoration.
 *
 * Two findings lead all of it, in the order the reader needs them: the crossing lines these records
 * cannot produce where there are any — the record itself refuted, stated before the paragraphs that
 * quote it — and then the warning for a middle of the ages risen past the worst the history had held,
 * the one reading of this page that is a *finding* rather than a table and the one that can arrive
 * while every age in it is still inside the first threshold. The distribution comes next and the
 * receipts after it: the counts are the answer a reviewer is here for, and the per-request table below
 * is where they come from rather than a second answer to the same question. The trend comes after the distribution and before the receipts, because it is
 * the one reading of the three that moves *before* a band does — a drift of the whole set shows up in
 * the middle of the ages several answers before any single age crosses a threshold — and a reader who
 * met it after the table of ages would have nothing left to add to it. The three are rendered together
 * — a distribution is only ever built from records this section already holds — and a `null` from
 * either side is the same omission, never an empty table.
 *
 * `null` rather than an empty section for a runbook with no settlements yet — the same omission the
 * report and the chart make — so a night before the first proposal was ever answered adds nothing to
 * the page.
 *
 * `crossings` is the runbook's record of the crossings the night has already commented on
 * (`waitCrossings`). It is passed through to the warning block so the page can say whether the wait it
 * is stating has been said out loud yet — the one thing about a standing wait a reader cannot work out
 * from this page alone — and it is what the page holds against these very records (`waitCrossingDrift`),
 * so the record the sentences below lean on is answered in the section that leans on it and not only in
 * the trend step's log. It defaults to `null`, which is a caller with no such record to hand over and
 * gets neither the warning's sentence nor the drift block, and the night's own run — which has just read
 * the runbook — always passes what it read, an empty list included.
 *
 * @param {Array<{ number: string, date: string, nights: number, outcome: string }>} records
 * @param {Object} [options]
 * @param {null|Array<object>} [options.crossings] the crossings the runbook records, or `null`
 */
export function renderFloorSettlementSection(records, { crossings = null } = {}) {
  // Oldest answer first, which is not always the order the file holds them in: a settlement the job
  // noticed late is recorded late, and a table that inherited that order would read as a history of
  // when the job looked rather than of when the proposals were answered.
  const rows = (Array.isArray(records) ? records : [])
    .slice()
    .sort((left, right) =>
      left.date < right.date ? -1 : left.date > right.date ? 1 : Number(left.number) - Number(right.number),
    );
  if (rows.length === 0) return null;
  const distribution = settlementDistribution(rows);
  // The one thing on this page a night is meant to *say* rather than leave to be read: the middle of
  // the ages past the worst the history had held, which is the reading that moves before any band does.
  const warning = settlementWaitWarning(rows);
  // …and the record of what the job has already said, held against these same records: the lines the
  // runbook carries as crossings the settlements cannot produce. The trend step reds the night's log
  // with the same finding; here it is stated where the record is discussed, and only when a caller
  // handed its crossings over — `null` is a caller with no record to check, not a record that matches.
  const drift = crossings === null ? null : renderWaitDrift(waitCrossingDrift(rows, crossings), "floor");
  return [
    "### Floor proposals answered",
    "",
    "Every floor proposal this job has opened that somebody has since answered, read from the",
    "runbook's own records (`.freebuff/run.md`): the nightly job appends one line per settlement, so",
    `the nights below are the age a request actually sat, not a reading of it. \`STALE_NIGHTS\` ` +
      `(${STALE_NIGHTS}) is where the run page starts naming one and \`ESCALATED_NIGHTS\` ` +
      `(${ESCALATED_NIGHTS}) is where the night's comment starts naming a person.`,
    "",
    // The two findings lead the section rather than joining the blocks under it: everything below is
    // read *after* the fact, and these are the two things about it worth meeting before the arithmetic
    // of it. The refuted record comes first because the warning's own paragraphs cite those lines as
    // settled fact, so a line these settlements cannot produce has to be said before they are read.
    // Both are absent on the nights there is nothing to state — the omission every other block here
    // makes — and each carries its own trailing blank line, so the heading after it keeps its separator.
    ...(drift === null ? [] : [drift]),
    ...(warning === null ? [] : renderSettlementWaitWarning(warning, "floor", crossings)),
    // The distribution block carries its own trailing blank line, which is the one the table after it
    // separates on: adding a second here would read as a paragraph gap rather than one section.
    ...(distribution === null ? [] : [renderSettlementDistribution(distribution, "floor")]),
    "Every one of them, oldest answer first:",
    "",
    "| request | answered | nights | how it was answered |",
    "| :-- | :-- | --: | :-- |",
    ...rows.map(
      (row) =>
        `| #${row.number} | ${row.date} | ${row.nights} | ${row.outcome === "merged" ? "merged" : "closed unmerged"}, ` +
        `${settlementBand(row.nights)} |`,
    ),
    "",
    "A column of ages inside the first threshold is a job being loud about proposals that answer",
    "themselves; one past the second is a mention arriving after somebody had already decided not to",
    "act on it. Both are read against the same two numbers, which is the whole of what these lines are",
    "for.",
    "",
  ].join("\n");
}

/**
 * Each outcome as the receipts table states it, in the words of the reply that earned it — the page's
 * version of `COLLECT_OUTCOME_NOTES`, short enough for a cell and specific enough that the row does not
 * need the line above it to be read.
 *
 * `answered` and `closed unanswered` are the reader's own two words and are stated exactly as the
 * records' heads state them, so the table, the head and this map cannot come to disagree about what a
 * row is. Every declared word says what the reply did, and the four that left the gates alone say so in
 * their first word rather than making a reader compare them against `applied`.
 *
 * The two reader-owned keys are written from the constants those words are made of
 * (`COLLECT_ANSWERED_OUTCOME` and `COLLECT_CLOSE_OUTCOME`) rather than as a second spelling of either, so the
 * row a reader sees and the word a record's head holds are one word.
 */
const COLLECT_OUTCOME_PHRASES = {
  applied: "applied",
  unchanged: "already at or below it",
  refused: "refused — the payload would have raised a budget",
  drift: "refused — the pin would not record the baselines",
  unverified: "refused — the drift check disagreed with the tree",
  "no-payload": "refused — no payload on the comment",
  fork: "refused — a fork has no branch to open a follow-up against",
  unknown: "nothing reported — the approval could not be applied",
  [COLLECT_ANSWERED_OUTCOME]: "answered",
  [COLLECT_CLOSE_OUTCOME]: "closed without the reply",
};

/**
 * Whether a record is a reply that declared an outcome and did not adopt the proposal.
 *
 * Not `outcome === "refused"`: `refused` is one of several ways the gates were left alone, and the count
 * this feeds answers the reader's question — was the tightening adopted? — rather than one word's. A
 * record reading `answered` is deliberately not one of these: its reply declared nothing, so nothing here
 * can say whether the tightening landed, and counting it as a refusal would be the same invention in the
 * other direction.
 */
function refusedReply(row) {
  return APPLY_STATUSES.includes(row.outcome) && !applyAdopted(row.outcome);
}

/**
 * The settled collect-budget proposals as the run page states them, or `null` when there is nothing to
 * state.
 *
 * The floor's section, asked of the other kind of request this job raises: every proposal it has left
 * on a pull request that somebody has since answered — or that went away with the ask unanswered —
 * with how long each sat and which threshold that crossed, the distribution their ages make, how the
 * median of those ages moved across the nights they were answered on, the receipts themselves, and —
 * ahead of all three — the warning a median past the worst the history had held earns. A `null` for a runbook with no collect settlements yet is the same omission every
 * other block on this page makes, never an empty table.
 *
 * The two things it says that the floor's section does not are both about the *kind*. Its loudness,
 * because there is none to describe: a collect proposal is a comment on somebody else's pull request,
 * and nothing in this job re-fires it, names it on the run page or mentions anybody for it — so the two
 * thresholds are named as the clock this job keeps for the request it does shout about rather than as a
 * loudness this kind has not got. And its *outcome*, because this is the one kind whose answer can be a
 * refusal: the word in the runbook's head is what the reply declared doing with the proposal
 * (`applyOutcomeIn`, `.freebuff/collect-apply.mjs`), so a proposal read and turned down is a different
 * record from one that was adopted — and the table's rows, the count below it and the sentence about the
 * word all say so.
 *
 * **And its *request*, which is the third thing only this kind has to state.** A collect ask is a comment on
 * somebody else's pull request, so the pull request can go away before the ask is answered (which the ask's own
 * record says, as `closed unanswered`) or weeks *after* it is (which is a close record of its own,
 * `pullCloses`). Both are facts about the request rather than about the ask, and a reader of this page is one
 * question away from them — is there still a thread under any of these — so the receipts table gains a column
 * for the pull request, and the paragraph under it says what a dash there means. The cell is one answer to one
 * question, read from both heads that can state it, so a reader does not have to know which head said it: a
 * request that went away with its ask unanswered is dated by its settlement line (whose word column says the
 * same thing in words), and one whose ask was answered first is dated by its close record. Two boundaries are
 * the design. The column is rendered only where the runbook records a request as gone at all: a history in
 * which none has is a history with no such state to state, and a column of dashes would be a table claiming a
 * question it was handed no answers to (the omission every other block on this page makes). And what the
 * column says is what the *record* says, never more: a dash is a request the runbook does not record as
 * closed, which is not the same as one still standing, because the settle step records a close only while the
 * pull request is inside the window it reads — so the paragraph spells that gap out rather than leaving the
 * page to imply a survival nothing has established.
 *
 * **And the *record* can change its mind about that column, which is why it is read from the thread's standing
 * statement rather than from the close head.** A pull request that was closed and then reopened is not one the
 * record calls gone any more (`pullThreads`, `PULL_REOPEN_HEAD`), so its cell goes: the page says what the file
 * currently says, and the file says the request came back. The order the two heads are read in is the whole of
 * it — the settlement rows' own `closed unanswered` entries first, the standing closes over them, and the
 * standing reopens *deleting* whatever either said — because a reopening is the last word about the request and
 * a page that kept the cell would be the one surface still telling a reader that nobody will read that thread.
 *
 * @param {Array<{ number: string, date: string, nights: number, outcome: string }>} records
 * @param {Object} [options]
 * @param {null|Array<object>} [options.crossings] the crossings the runbook records, or `null`
 * @param {Array<{ state: string, date: string, number: string }>} [options.threads] what the runbook
 *   *currently* says about the pull requests these asks sit on (`pullThreads`), whose standing closes and
 *   reopens are what the pull request column is read from beside the settlement lines' own `closed
 *   unanswered` rows
 */
export function renderCollectSettlementSection(records, { crossings = null, threads = [] } = {}) {
  // Oldest answer first, for the reason the floor's table is sorted: a settlement the job noticed late
  // is recorded late, and a table that inherited GitHub's order would read as a history of when the job
  // looked rather than of when these were answered.
  const rows = (Array.isArray(records) ? records : [])
    .slice()
    .sort((left, right) =>
      left.date < right.date ? -1 : left.date > right.date ? 1 : Number(left.number) - Number(right.number),
    );
  if (rows.length === 0) return null;
  const distribution = settlementDistribution(rows);
  // The same warning as the floor's, off this kind's own history and in this kind's own words: the two
  // kinds are watched here rather than against each other, because a proposal this job leaves on
  // somebody else's pull request and a request it opens itself do not have one wait between them.
  const warning = settlementWaitWarning(rows);
  // …and the record of what *this* kind's wait has already been told about, held against these same
  // records through the same function and the same series as the floor section's: the lines the runbook
  // carries as crossings this series cannot produce. The only difference between the two is the channel
  // a crossing is said in, and `renderWaitDrift` states that in this kind's own words rather than
  // claiming a comment this kind never leaves.
  const drift =
    crossings === null ? null : renderWaitDrift(waitCrossingDrift(rows, crossings), "collect");
  // The replies that did not adopt the proposal, and which words they used, in the applier's own
  // vocabulary order so the sentence reads the same however GitHub listed the pull requests. Only
  // rendered when there is at least one: a history of adoptions needs no paragraph about refusals.
  const refusals = rows.filter(refusedReply);
  const tally = [...new Set(refusals.map((row) => row.outcome))]
    .sort((left, right) => APPLY_STATUSES.indexOf(left) - APPLY_STATUSES.indexOf(right))
    .map((word) => `\`${word}\` (${refusals.filter((row) => row.outcome === word).length})`)
    .join(", ");
  // The requests the runbook records as *gone* — the pull request each ask was left on — read from the two
  // heads that can state it: a settlement whose own word is `closed unanswered` (the close *is* the ask's
  // ending there, and its day is the day the request closed) and a close record of its own for an ask that was
  // answered first (`pullCloses`). The settlement's rows go in first and the close records over them, so a file
  // that somehow held both answers with the more specific line — the writer never writes a close for an
  // unanswered ask, so this is the order a hand-edited file is read in rather than a case that arises.
  // …and the thread's *standing* statements come last, because they are the record's latest word about each
  // request and they can say the opposite of either head: a close the file has since recorded a reopening for
  // is not a request that is gone, so its cell is not rendered — the same correction, from the same reader,
  // that the gate makes when it decides whether a comment may be rewritten. A page that kept the cell would be
  // the one surface still saying nobody will read that thread.
  const gone = new Map(
    rows
      .filter((row) => row.outcome === COLLECT_CLOSE_OUTCOME)
      .map((row) => [row.number, row.date]),
  );
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (thread === null || typeof thread !== "object" || thread.number === undefined) continue;
    if (thread.state === "reopened") gone.delete(String(thread.number));
    else gone.set(String(thread.number), thread.date);
  }
  // The table's four columns, and the fifth only where the record has something to put in it.
  const headers = ["proposal", "answered", "nights", "how it was answered"];
  const rules = [":--", ":--", "--:", ":--"];
  if (gone.size > 0) {
    headers.push("pull request");
    rules.push(":--");
  }
  return [
    "### Collect-budget proposals answered",
    "",
    "Every collect-budget proposal this job has left on a pull request that somebody has since",
    "answered, read from the runbook's own records (`.freebuff/run.md`): the nightly job appends one",
    "line per settlement, so the nights below are the age a proposal actually sat, not a reading of it.",
    "And it is the age of the *comment* — the day the job first proposed the tightening — rather than",
    "of the pull request it was posted on, so a proposal made a week into a branch is not recorded as a",
    "week of being ignored.",
    "",
    `A record's own word is what the reply did, not merely that there was one: the apply job declares ` +
      `its outcome in the reply it posts (\`${APPLY_STATUSES.join("`, `")}\`), and the runbook states ` +
      "that word, so a tightening that was adopted and one that was refused are two different records " +
      "rather than one answer with a date on it. A reply that declares no outcome at all — one the job " +
      "posted before this vocabulary existed — still reads as the plain `answered` it always did.",
    "",
    `\`STALE_NIGHTS\` (${STALE_NIGHTS}) and \`ESCALATED_NIGHTS\` (${ESCALATED_NIGHTS}) are the clock`,
    "this job keeps for its own floor proposal: where the run page starts naming a request, and where a",
    "comment starts naming a person. A collect proposal has no escalation of its own — nothing re-fires",
    "it and nothing mentions anybody for it — so the tables below read these ages against that one clock",
    "rather than against a loudness this kind has not got.",
    "",
    // …and the refuted record leads even the warning, for the floor section's reason: everything below
    // is read after the fact, and a line these settlements cannot produce is a claim about the very
    // history the paragraphs under it lean on.
    ...(drift === null ? [] : [drift]),
    // …and the warning leads this section for the floor's reason, in this kind's words for what the
    // threshold night is. It is the floor's own paragraphs with the kind's words in them — this page
    // and the run's annotation restating a wait that stands, and a comment left once per crossing — so
    // the crossings are deliberately *not* handed over here: this kind leaves no comment, and a
    // paragraph about one it never leaves would be the floor's story told about another kind.
    ...(warning === null ? [] : renderSettlementWaitWarning(warning, "collect")),
    // The distribution block carries its own trailing blank line, which is the one the table after it
    // separates on: adding a second here would read as a paragraph gap rather than one section.
    ...(distribution === null ? [] : [renderSettlementDistribution(distribution, "collect")]),
    "Every one of them, oldest answer first:",
    "",
    // The pull request column only where there is something to say in it, the header and the cells together: a
    // history with no close recorded renders the four-column table it always did, byte for byte.
    `| ${headers.join(" | ")} |`,
    `| ${rules.join(" | ")} |`,
    ...rows.map((row) =>
      `| ${[
        `#${row.number}`,
        row.date,
        row.nights,
        `${COLLECT_OUTCOME_PHRASES[row.outcome] ?? row.outcome}, ${settlementBand(row.nights)}`,
        ...(gone.size === 0 ? [] : [gone.has(row.number) ? `closed ${gone.get(row.number)}` : "—"]),
      ].join(" | ")} |`,
    ),
    "",
    // …and the paragraph the column is owed, after the word column's own and in the order the columns are
    // read: what the state is, where it is read from, and what a dash in it does *not* mean.
    ...(gone.size === 0
      ? []
      : [
          `**${gone.size} of these requests ${gone.size === 1 ? "is" : "are"} recorded as gone.** The last column is the state of the ` +
            "pull request each ask was left on rather than of the ask itself, read from the runbook's own " +
            "record of the close: one that went away with its ask unanswered is closed on the day its " +
            "settlement line states, and one whose ask was answered before it went is closed on the day its " +
            "own close line states. A comment this job left on either is written to a thread nobody is " +
            "watching, which is why the gate that keeps those comments current leaves an ended request alone. " +
            "A request the record has since recorded as *reopened* is not one of these: the cell is not " +
            "rendered for it, because the last thing the file says about that pull request is that it came back.",
          "",
          "A dash there is a request the runbook does not record as closed, which is not the same as one still " +
            "standing: the settle step records a close only while that pull request is inside the window it " +
            "reads, so a request closed outside it waits for a later night to be seen, and one whose ask was " +
            "answered and which is still open has no line at all.",
          "",
        ]),
    ...(refusals.length === 0
      ? []
      : [
          `${refusals.length} of these replies did not adopt the tightening — ${tally} — which is the`,
          "difference this record keeps: the word beside each row is what the reply did, so a proposal that",
          "was read and turned down reads as a refusal rather than as an answered one, and the ages above",
          "are how long each sat before *that* reply rather than before a tightening landed.",
          "",
        ]),
    "A column of ages inside the first threshold is a proposal that answered itself; one past the",
    "second is a question that sat through the point at which the job's own request would have been",
    "naming a person, with nothing in the job saying so. Both are read against the same two numbers,",
    "which is the whole of what these lines are for.",
    "",
  ].join("\n");
}

/** Reads a flag written `--flag value` or `--flag=value`. */
function argValue(name) {
  const joined = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * `npm run coverage:trend [--runbook <path>] [--history <path>] [--low-water <path>] [--limit <n>]
 * [--json]`, and `npm run coverage:low-water [--file <path>]` — the same script's recorder mode,
 * `--write-low-water`, which derives the floors from the records and rewrites the committed file.
 *
 * `--propose-low-water [--file <path>] [--output <path>]` is the recorder's other half and the flags
 * the nightly job uses: it derives the floors the same way, writes them to `--file` (the committed
 * path unless a caller names another) only when the committed file does not already state them, and
 * renders the proposal for the branch that carries them to `--output`
 * (`LOW_WATER_PROPOSAL_FILE`). It also reports what it did the way a workflow reads it — `changed`
 * and `status` on `$GITHUB_OUTPUT`, the proposal on `$GITHUB_STEP_SUMMARY` — and exits 1 exactly
 * when the derivation was *refused*, because a run that could not produce the file it was asked for
 * is not a run that succeeded, whether or not the night was already red.
 *
 * `--nudge --number <n> --created <date> [--today <date>] [--owner <handle>] [--output <path>]` is the
 * mode for the night *after* that one: the proposal is already open, so what this answers is how long
 * it has sat — the age of the request, whole nights apart — the comment that night leaves on it (`--output`,
 * or stdout when no path is given) and, past `STALE_NIGHTS`, the section the run page names it with
 * on `$GITHUB_STEP_SUMMARY`. Past `ESCALATED_NIGHTS` the comment itself changes rather than gaining a
 * second one: it names `--owner` (`GITHUB_REPOSITORY_OWNER` when a run supplies it), which is the one
 * signal a comment can send that a page cannot, and a run that has no handle to name is told so on
 * stderr instead of the escalation quietly naming nobody.
 * It reads no records at all on purpose: every number in it belongs to
 * the proposal body the step above just rewrote, and a mode that derived its own could disagree
 * with the file the branch is carrying. Exit 2 for a `--number` or `--created` it cannot read — the
 * age *is* the answer here, so a missing one is a usage error rather than a quiet skip — and 1 for
 * an `--output` it could not write.
 *
 * `--settle-floor` and `--settle-collect`, each with `--settled <path> [--runbook <path>]
 * [--output <path>] [--comment <path>] [--today <date>]`, are the night's *third* answer — about the proposals rather than about the
 * floors or the baselines: they read the requests the job raised that somebody has since answered and
 * append one dated line per newly settled one to the runbook, so how long each sat is a record a
 * person can review the two thresholds against. The two kinds are one implementation and two answers
 * to what an answer *is*, which is the whole of what `SETTLEMENT_KINDS` holds: a floor proposal is
 * answered by the merge or the close of the very request it opened, as
 * `gh pr list --json number,createdAt,closedAt,mergedAt` writes them, while a collect-budget proposal
 * is a comment this job leaves on somebody else's pull request and is answered by a reply left on it —
 * so its list is `gh pr list --json number,closedAt,comments`, a pull request that closed with the
 * proposal unanswered settles it too (`closed unanswered`, which is a fact about the wait and not a
 * verdict on the baselines), and the age counted is the age of the *comment* rather than of the
 * request it sits on, so a proposal made a week into a branch is not recorded as a week of being
 * ignored. One line per request, written once, because the dedupe is the runbook's own heads *of that
 * kind*; the page gets the whole history beside it — how those ages distribute across the two bands
 * the constants divide, how often the escalation had already been spent, and how the median of them
 * moved across the nights they were answered on, which is the one of the three readings that can rise
 * before a single age has crossed a threshold — and `--output` writes
 * that same page to a file, which is what the artifact carries, since a step summary is read once and
 * a file in the run's artifact can be read a year later. 0 settlements is a pass with a note rather
 * than a failure, since a night with nothing answered owed nothing, and so is a night with nothing to
 * state yet: no `--output` file is written rather than an empty one. Neither mode's *wait warning*
 * changes that verdict: a median that has risen past the worst the history had held is said on stderr
 * and, with `--github-annotations`, printed as a `::warning` workflow command for the run's own
 * annotations — the two channels a night has for a finding that is not a verdict — and it leads the page
 * as well, so a night whose annotation step was skipped still carries it. The two night-count thresholds
 * are read one request at a time, and they stay the only *numbers* that escalate anything.
 *
 * One thing this mode renders *is* a verdict, and it is not a number: the crossing lines the runbook
 * holds are the bar this job's own decision is written in, so a line these settlements cannot produce is
 * a level nothing has held — the section states it, and the night has to stop over it. The count travels
 * on `$GITHUB_OUTPUT` as `wait-drift`, and `.freebuff/wait-drift-gate.mjs` reads it back at the end of
 * the job. The step itself does not exit on it, because the recording this step exists for *was* done —
 * the settlements landed, and the page, the artifact and the comment body were written — so the red
 * belongs to the step that judges the record rather than to the one that recorded it, exactly as the
 * comment channel's red belongs to `comment-gate.mjs` rather than to the poster. The lines are said here
 * as well, in the module's own sentences and as `::error` annotations under `--github-annotations`,
 * because this is where a reader meets the block they are about. The count is the section's own
 * findings — the crossings this night read, judged by the function that renders them — so the block on
 * the page and the number the night is judged by are one answer rather than two readings of one file.
 * **The lines themselves travel with it**, as `wait-drift-set`: the identity the section, the annotation
 * and the artifact's record already name each line by (`waitDriftWhere` — the request or the series, and
 * the night), one per refuted line. The verdict step's comment is said *once* per finding rather than
 * every night the finding stands, so the step that leaves it has to know which lines a person has
 * already been told about; that is a comparison of lines, and the lines are here, where they are
 * structured — reading them back out of the rendered block would be one module parsing another's
 * prose. A kind that judged nothing, or held every line, publishes the empty value.
 * **Both kinds publish now.** The floor kind's count has been the section's since the record was gated;
 * the collect kind's is the same call over its own series, and the difference between them is only who
 * wrote the lines — a comment for the floor, this mode's own page and annotation for the collect — which
 * is a fact about the record rather than about the count.
 *
 * `--drift <path>` is the same finding written where a *reader* of the night's files meets it. The count
 * above is what the night is judged by and the section is what the lines say, but a section is a page:
 * the run page rolls away, while the artifact a night keeps is opened months later. So the very block
 * `renderWaitDrift` renders for the section — the same call, so the two cannot come to read differently
 * — is written to this file as well on the nights there is one, and nothing at all on a night every line
 * holds, which is the omission the section and the count make together. `.freebuff/wait-drift-gate.mjs`
 * reads it back into the verdict record it writes for the artifact and the review summary, and a kind
 * that judges nothing writes no file either. A write that fails is exit 1, like every other `--output`
 * here: a run asked for a file it did not write did not do what it was asked.
 *
 * `--comment <path>` is the third channel for that one finding, and the only one of the three that can
 * reach a person: a page reaches whoever opens the run and an annotation whoever watches the job, while
 * a comment can only be left on a request — so the mode looks for the one that is *still open* in the
 * list it was just handed (the kind's own `waiting` reader: no close, no merge) and renders
 * `renderFloorWaitComment` for it. Which request that is, is published on `$GITHUB_OUTPUT` as
 * `wait-request` — empty on every night nothing is owed — because the step that posts the comment
 * cannot see the list and must be `skipped` rather than run-and-say-nothing when there is no comment to
 * post. The request itself is published a second time as `open-request`, whether or not this night owes
 * a comment: the count `.freebuff/wait-drift-gate.mjs` reads back turns into a *red* job, and the repair
 * that red asks for is an edit to a person's file rather than a number to re-derive, so the verdict step
 * needs a request to leave its own comment on even on a night no wait rose — while `wait-request` is
 * empty on exactly those nights. A kind with no request of its own to say a wait on writes nothing at all, and so does a wait
 * that has not risen; a wait that *has* risen with no request open is said on stderr rather than
 * swallowed, since that is a finding with nowhere left to go beyond the page. `--today` is the clock
 * that request's age is read against, exactly as the nudge's is, and the file follows `--output`'s
 * rule: a run asked for a file it could not write did not do what it was asked.
 *
 * Exit 2 for a `--settled` it
 * cannot read as a list, 1 for a runbook it cannot read or write — the record *is* that file, so "no
 * record" is not a pass — and for an `--output` or a `--comment` it could not write. Nothing else: the
 * crossing drift is a verdict this mode *reports* rather than one its exit code takes, so a night that
 * recorded a line the settlements cannot produce still leaves this step green and is failed by the gate
 * that reads the count back — which is also why the settle steps' `continue-on-error` stays as it is.
 *
 * The exit code is the answer: 0 when every reading it could compare held or rose, 1 when one
 * stepped below its low-water, and 2 for a usage error (a `--limit` that is not a positive whole
 * number of records). A runbook it cannot read is exit 1 — this command's whole subject is that
 * file, and "no answer" is not a pass — while a history table it cannot read is a note on stderr
 * and an answer the runbook's records give alone: the table is what the answer *adds*, so a missing
 * one costs the extra nights and never the run. The committed low-water is read the same way and for
 * the same reason — a file that is missing or unreadable costs the floors, which fall back to the
 * nights at hand, and never a verdict — while the *recorder* requires the records and writes the
 * file it is pointed at, so a re-record is a line in the diff rather than a run-time surprise. The
 * recorder is reached before the read, because a write is not a verdict about coverage and a run
 * that is about to replace a file has nothing to report about the one it replaces.
 * `--limit` bounds the nights at hand for the readings no file has recorded and the dates a row
 * reports; it never bounds the derivation, which is the reading's whole history by definition.
 */
function main() {
  const runbookPath = argValue("--runbook") ?? join(ROOT, RUNBOOK_FILE);
  const historyPath = argValue("--history") ?? join(ROOT, HISTORY_FILE);
  const lowWaterPath = argValue("--low-water") ?? join(ROOT, LOW_WATER_FILE);
  const limitArg = argValue("--limit");
  let limit = TREND_LIMIT;
  if (limitArg !== undefined) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed < 1) {
      console.error(
        `coverage-trend: --limit ${JSON.stringify(limitArg)} is not a positive whole number of records`,
      );
      process.exit(2);
    }
    limit = parsed;
  }

  // …and the mode the night *after* a proposal uses: the request is already open and unanswered,
  // so what this answers is how long it has sat. It is reached before the records are read — like
  // the recorder, and for the same reason — because it reads none of them: every number a reader
  // sees in what it writes belongs to the proposal body the step above just rewrote, and a mode
  // that derived its own could disagree with the file the branch is carrying.
  if (process.argv.includes("--nudge")) {
    const nudge = proposalNudge({
      number: argValue("--number"),
      created: argValue("--created"),
      // The handle the escalation names. A run supplies `GITHUB_REPOSITORY_OWNER` for nothing else,
      // so it is the default rather than a flag every workflow has to remember; `--owner` is here so
      // a person can rehearse the escalated comment, or name somebody else.
      owner: argValue("--owner") ?? process.env.GITHUB_REPOSITORY_OWNER,
      ...(argValue("--today") === undefined ? {} : { today: argValue("--today") }),
    });
    if (nudge === null) {
      console.error(
        "coverage-trend: --nudge needs --number <n> and a readable --created <date> — how long " +
          "the request has sat is the whole of what it answers",
      );
      process.exit(2);
    }
    const output = argValue("--output");
    if (output === undefined) {
      process.stdout.write(nudge.comment);
    } else {
      try {
        writeFileSync(output, nudge.comment, "utf8");
      } catch (error) {
        console.error(
          `coverage-trend: cannot write ${output} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exit(1);
      }
    }
    // The second half of getting louder, and the only part of it a person who is *not* watching the
    // pull request ever sees: past `STALE_NIGHTS` the request is named on the run page, every night
    // from then on, rather than mentioned once and scrolled past.
    if (nudge.page !== null && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${nudge.page}\n`);
    }
    // The third, and the one that reaches somebody: a mention is the only thing a comment can do
    // that a page cannot. An escalation with no handle to name is said out loud rather than
    // swallowed — the comment says so in its own footer, and this is the same fact on stderr, where
    // a night's log can be read back.
    if (nudge.escalated && nudge.owner === "") {
      console.error(
        `coverage-trend: this request is past the ${ESCALATED_NIGHTS} nights this job only comments ` +
          "through, and no owner handle was given to name — pass --owner <handle>, or let the run " +
          "supply GITHUB_REPOSITORY_OWNER, or the comment will escalate without naming anybody",
      );
    }
    console.log(
      `\ncoverage-trend: nudge — #${nudge.number} has been open ${nudge.nights} night(s)` +
        (output === undefined ? ", comment on stdout" : `, comment to ${output}`) +
        (nudge.stale ? `, ⏳ named on the run page (past the ${STALE_NIGHTS} nights this job waits)` : "") +
        (nudge.escalated
          ? `, ⏳ past the ${ESCALATED_NIGHTS} nights this job only comments through — ` +
            (nudge.owner === "" ? "nothing to mention" : `${nudge.owner} named on the request`)
          : ""),
    );
    process.exit(0);
  }

  // …and the mode that only *writes* one: what became of the proposals the nights before this one
  // opened, in either of the two kinds this job raises. It is reached before the records are read for
  // the nudge's reason — it reads no records either — but unlike the nudge it does require one file,
  // the runbook, because appending a record to a file it could not read is how a settlement gets
  // recorded twice or not at all. Reached before the trend's own read below so its refusals are its
  // own: a missing runbook here is about the record, and the message says so rather than "nothing to
  // compare".
  //
  // One block for both kinds, because everything under the flag is one question: the list, the mapping
  // from GitHub's own fields onto the days a record is made of, the reader that refuses what it cannot
  // read, the section and the artifact are all `SETTLEMENT_KINDS`'. The kind comes off the flag that
  // was passed, so the two modes cannot be half-implemented apart: a third kind is a row in that
  // table, and a row is what a night's step would then have to name.
  const settleKind = Object.keys(SETTLEMENT_KINDS).find((kind) =>
    process.argv.includes(SETTLEMENT_KINDS[kind].mode),
  );
  if (settleKind !== undefined) {
    const spec = SETTLEMENT_KINDS[settleKind];
    const settledPath = argValue("--settled");
    if (settledPath === undefined) {
      console.error(
        `coverage-trend: ${spec.mode} needs --settled <path> — the list of settled requests is ` +
          "the whole of what it has to record",
      );
      process.exit(2);
    }
    let settled = null;
    try {
      settled = JSON.parse(readFileSync(settledPath, "utf8"));
    } catch (error) {
      console.error(
        `coverage-trend: cannot read ${settledPath} as the settled requests — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(2);
    }
    if (!Array.isArray(settled)) {
      console.error(
        `coverage-trend: ${settledPath} does not hold a list of requests — a settled one is what ` +
          "`gh pr list --json` states: `{ number, createdAt, closedAt, mergedAt }` for a floor " +
          "proposal and `{ number, closedAt, comments }` for a collect one",
      );
      process.exit(2);
    }
    let runbook = "";
    try {
      runbook = readFileSync(runbookPath, "utf8");
    } catch (error) {
      console.error(
        `coverage-trend: cannot read ${runbookPath} — the settlement is recorded *in* the runbook, ` +
          `and one that cannot be read is one this cannot add to — ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      process.exit(1);
    }
    // The events a comment has already been about, read *before* this night's own reading: `waitCrossings`
    // is the runbook's record of the crossings the job has said out loud, and it is the bar both the
    // decider below and the page measure against — so whether the wait that stands has been said, and
    // whether tonight is a night that says it, come off one read of one file rather than two.
    // …this kind's own crossings, and only its own: the two waits are watched separately, so the level
    // the floor proposal's wait has been told about is not one the collect proposals' wait may measure
    // against — each series' lines are read, decided against and refuted on their own.
    const crossings = waitCrossings(runbook, settleKind);
    const recorded = recordProposalSettlements({
      kind: settleKind,
      text: runbook,
      // GitHub's own entry, read into the days the record is made of — the kind's own mapper, because
      // what an answer is differs between a request that is merged and a comment that is replied to.
      settled: settled.map(spec.settled),
      // …and the night this run is about, which is the clock for the one record the feed cannot date: a
      // reopening has no day of its own on GitHub, so the line says when the job saw it, and `--today` is
      // the same flag the crossing line and the wait's ages are read against.
      night: argValue("--today") ?? new Date().toISOString(),
    });
    // …and the write carries all three lists, because they are one append to one file: a night whose only news
    // is that a pull request behind an answered ask has gone — or come back — writes that line and nothing
    // else, and the text the rest of this run reads below is the file with all of it in it.
    if (recorded.added.length > 0 || recorded.closed.length > 0 || recorded.reopened.length > 0) {
      try {
        writeFileSync(runbookPath, recorded.text, "utf8");
      } catch (error) {
        console.error(
          `coverage-trend: cannot write ${runbookPath} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exit(1);
      }
    }
    // …and every surface below reads the runbook as it *now* stands, this night's settlements included:
    // the crossing record below is appended to the same file, so one written from the text this night
    // started with would erase the age a request sat — the record the whole mode exists for.
    runbook = recorded.text;
    const section = spec.section(recorded.records, {
      crossings,
      // …and the closes the runbook records, which only one kind's section has anywhere to state: a floor
      // proposal *is* its own request, so an ending of it is its settlement, while a collect ask sits on
      // somebody else's pull request and that request can go before the ask is answered or weeks after it.
      // The option is offered to whichever kind is being recorded — the section with no use for it takes it and
      // renders nothing different, which is how the floor's pages stay byte for byte the pages they were.
      threads: pullThreads(runbook),
    });
    if (section !== null && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${section}\n`);
    }
    // …and the same finding as the *verdict* the page alone cannot carry. The section states the drift
    // block for whoever opens the run; the night has to stop over it, and this is the step that knows,
    // so the count travels on `$GITHUB_OUTPUT` for `.freebuff/wait-drift-gate.mjs` to read back at the
    // end of the job — the shape a comment step's failure already has, and the reason neither settle
    // step's `continue-on-error` has to change. The mode does not exit on it: the recording this step
    // was asked for *was* done, so the red belongs to the step that judges the record. The lines are
    // said here as well — the module's own sentences on stderr, and one `::error` annotation each under
    // `--github-annotations`, because this is the step whose section a reader meets them in.
    // `null` rather than `[]` for a kind that judges nothing: a kind with no crossing record of its own
    // has not read a clean record, and publishing a `0` for it would be a step claiming a judgement it
    // never made — the one reading the gate below must not take.
    const refuted = spec.waitDrift === undefined ? null : spec.waitDrift(recorded.records, crossings);
    if (refuted !== null && refuted.length > 0) {
      console.error(
        `coverage-trend: the record states ${refuted.length} crossing line(s) these settlements do ` +
          "not produce:",
      );
      console.error(waitDriftLines(refuted).join("\n"));
      if (process.argv.includes("--github-annotations")) {
        for (const finding of refuted) {
          console.log(
            waitAnnotation(
              `settled-wait drift (${spec.label})`,
              `${waitDriftWhere(finding)} — ${waitDriftNote(finding)}`,
              "error",
            ),
          );
        }
      }
    }
    // The one finding on that page a night is meant to *say* rather than leave to be read: the middle of
    // the ages rising past the worst the history had held, which is the reading that moves before a
    // single request has crossed either of the two thresholds the job is tuned by. It is said on stderr —
    // a step's own voice in the log, and never on stdout, which is where the page and the annotation go —
    // and, under `--github-annotations`, as the workflow command GitHub turns into an annotation on the
    // run: the one channel a night has that reaches somebody who is not reading its page. Neither is a
    // verdict. Nothing about a rising wait fails a night, and a gate over a *median* would be the job
    // acting on a number nothing has agreed on — which is why this is a warning and the two night-count
    // thresholds stay the only numbers that can escalate anything.
    const wait = settlementWaitWarning(recorded.records);
    if (wait !== null) {
      const line = settlementWaitLine(wait, settleKind);
      console.error(`coverage-trend: warning — ${line}`);
      if (process.argv.includes("--github-annotations")) {
        console.log(waitAnnotation(`settled wait (${spec.label})`, line));
      }
    }
    // …and the same reading as an *event*, which is what decides whether tonight leaves a comment: the
    // page and the annotation above state a wait for as long as it stands — each is a rendering of a night
    // — while a comment lands where a person is and stays there, so it is left once per crossing, at the
    // level the runbook's record says a comment has already been about. The rule is the module's own
    // (`unsaidWaitWarning` over `saidWaitLevel`) rather than a second comparison written out here, so the
    // decision and the page's paragraph about it cannot come apart.
    const owed = unsaidWaitWarning(wait, saidWaitLevel(crossings));
    // …and the same finding carried to the one place on GitHub a person will meet it. The page and the
    // annotation above reach whoever opens the run or watches the job; the request that is *still open*
    // is a pull request the night can comment on, and a new comment there is the only channel this job
    // has for a finding that is not a verdict. Which request that is comes out of the same list the
    // settlements were read from — the entry that states neither a close nor a merge is the one still
    // waiting, per the kind's own `waiting` reader — so the night's record and its comment are read off
    // one list rather than two. The comment is rendered here rather than by the step that posts it for
    // the reason the annotation is: the arithmetic is this module's, and a second reading of it in
    // shell would be a second answer.
    //
    // Three ways of owing nothing, and they are not the same fact. A wait that did not rise owes no
    // comment at all; a wait that rose with nothing open owes one that has nowhere to go — the night a
    // proposal is answered is usually the night its branch stops being open, so the request the finding
    // is about is often answered already — and that is said on stderr rather than left to be inferred
    // from a file nobody wrote; and a wait that stands above a level a comment has already been about
    // owes no second one, because this finding is an event rather than a state. The `wait-request`
    // output is what the step after this one reads: empty means the poster is `skipped`, which the gate
    // at the end of the job passes, because a comment
    // nobody was owed is not a comment lost.
    const waiting =
      spec.waiting === undefined || !Array.isArray(settled)
        ? null
        : (settled.map((request) => spec.waiting(request)).find((found) => found !== null) ?? null);
    const waitComment =
      owed === null || waiting === null || spec.waitComment === undefined
        ? null
        : spec.waitComment({
            wait: owed,
            number: waiting.number,
            created: waiting.created,
            // The request's own age, from the same clock the nudge reads it with: `--today` for a run
            // that is writing about a night other than the one it is running on.
            nights: nightsBetween(waiting.created, argValue("--today") ?? new Date().toISOString()),
          });
    // …and the one place a crossing is ever written, whichever kind it belongs to: the append, and the
    // failure a step asked for a record it could not make. `null` is the ordinary "already on record" —
    // the writer is total over the bar — and the runbook in hand is the one this night's own line was
    // just added to, so a later reader in this same run sees the record it just made.
    const noteCrossing = (crossing) => {
      const noted = recordWaitCrossing(runbook, crossing);
      if (noted.added === null) return null;
      try {
        writeFileSync(runbookPath, noted.text, "utf8");
      } catch (error) {
        // A record that cannot be written is the same failure the settlement write is: the step is a
        // recording aid, but the record *is* this file, so the night says so rather than leaving the
        // crossing to be said again on every night it stands.
        console.error(
          `coverage-trend: cannot write ${runbookPath} — the crossing is not recorded, so the next ` +
            `night says it again — ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
      runbook = noted.text;
      return noted.added;
    };
    const commentPath = argValue("--comment");
    if (commentPath !== undefined) {
      if (waitComment === null) {
        // Two ways to owe nothing, and only one of them is worth a word on stderr: a wait that held is
        // the ordinary night, while a wait that rose with nothing to say it on is a finding that has just
        // run out of channels — and a step asked for a file it did not write should say which of the two
        // it was. The same sentence answers a kind whose wait has no request of its own at all (the
        // collect kind, whose comment channel does not exist), which is a caller asking for a channel its
        // kind has not got rather than a request nobody left open — and `--comment` on such a step is a
        // workflow edit to fix, so saying it out loud is the useful half of it.
        if (owed !== null && waiting === null) {
          console.error(
            "coverage-trend: the settled wait rose but there is no open request of this kind's own to " +
              `say it on — nothing written to ${commentPath}, so the finding is on this run's page and ` +
              "in its annotation alone",
          );
        } else if (owed === null && wait !== null) {
          // The third way of owing nothing, and the one this record exists for: the wait that stands has
          // already been said. It is an ordinary night rather than a finding running out of channels, so
          // it is said on stdout with the ordinary nights — and the comment it names is the one the night
          // left when the level was passed, not a second one restating it.
          const said = saidWaitCrossing(crossings);
          console.log(
            "coverage-trend: the wait still stands, and this crossing has already been said — " +
              (said === null
                ? "a comment announced it"
                : `the comment left on #${said.number} on ${said.date} announced it`) +
              ` — nothing written to ${commentPath}`,
          );
        } else {
          console.log(`coverage-trend: no risen wait to say — nothing written to ${commentPath}`);
        }
      } else {
        try {
          writeFileSync(commentPath, waitComment, "utf8");
        } catch (error) {
          console.error(
            `coverage-trend: cannot write ${commentPath} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          process.exit(1);
        }
        // …and the night is recorded as having said it, which is the whole of what makes the finding an
        // event rather than a standing state: the crossing is *the level the median passed*, written once
        // per crossing, so a later night whose median is still above it — or has climbed but not past the
        // level *this* comment was about — leaves no second comment. It is written only here, after the
        // file the poster below reads exists, so the record states what this night did rather than what it
        // meant to; a night that rose with nothing open to say it on records nothing and the crossing stays
        // owed, which is deliberate — a crossing swallowed by a quiet night is the one failure this whole
        // channel is for. `--today` gives it the night it is being written about, the same clock the
        // footer's age is read against.
        const recorded = noteCrossing(
          waitCrossing({
            kind: settleKind,
            date: argValue("--today") ?? new Date().toISOString(),
            number: waiting.number,
            latest: owed.latest,
            held: owed.held,
            since: owed.heldSince,
          }),
        );
        console.log(
          `coverage-trend: the risen wait is said on #${waiting.number}, the request still open — ` +
            `the comment to ${commentPath}` +
            (recorded === null
              ? ", and the crossing was already on record"
              : `, and the crossing recorded in ${runbookPath}`),
        );
      }
    }
    // …and the kinds whose saying is *not* a comment record their crossing here, off the same decision:
    // this mode renders that kind's page and its annotation on every run, so the crossing has been said
    // by the time the record is written, and the record is the only place the level it passed outlives
    // the run. Without this the kind could have no record at all — nothing else writes one — and the
    // section that states its history would have nothing to hold a line against, which is exactly the
    // refutation the floor kind has had since the record was gated. The order is the floor's: the page
    // above is rendered from the crossings read *before* this append, so tonight's own line is judged
    // by the trend step at the end of the job, which reads the file after it.
    if (owed !== null && spec.waitComment === undefined) {
      const recorded = noteCrossing(
        waitCrossing({
          kind: settleKind,
          date: argValue("--today") ?? new Date().toISOString(),
          latest: owed.latest,
          held: owed.held,
          since: owed.heldSince,
        }),
      );
      console.log(
        recorded === null
          ? `coverage-trend: this kind's rise is already on record — nothing written to ${runbookPath}`
          : `coverage-trend: this kind's crossing recorded in ${runbookPath}`,
      );
    }
    // …and the same page as a file, which is the half of it that outlives the run: a step summary is
    // read once, by whoever is looking at that run, while the artifact the night uploads is what a
    // later reader — and the review of the two thresholds — has to hold. The whole section is written
    // (`--output`), so the artifact carries the same counts the page did rather than a second
    // rendering of them; a night with nothing to state writes nothing at all, the omission the section
    // makes rather than a file claiming a history this runbook does not have. A write that fails is
    // exit 1 like every other `--output` in this command: a run asked for a file it could not write
    // did not do what it was asked, whether or not the record the file came from landed.
    const output = argValue("--output");
    if (output !== undefined) {
      if (section === null) {
        console.log(`coverage-trend: no settlements to summarise — nothing written to ${output}`);
      } else {
        try {
          writeFileSync(output, `${section}\n`, "utf8");
        } catch (error) {
          console.error(
            `coverage-trend: cannot write ${output} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          process.exit(1);
        }
      }
    }
    // …and the same block as a *file*, which is the surface the other two cannot be: the run page is read
    // once and rolls away, while the artifact a night keeps is opened months later, and a reader there has
    // neither the page nor necessarily the runbook. The block is written by the very function that renders
    // it for the section — *with this kind* — so the file and the page state one set of lines in one set
    // of words rather than two renderings that could drift: the kind's own sentences behind the block name
    // the channel the crossing was said in, and a file that took the default would hand a reader the floor
    // kind's story about a comment this one never leaves. A night every line holds writes nothing at all,
    // the omission the section and the count make together, and so does a kind that judges nothing.
    // `.freebuff/wait-drift-gate.mjs` reads this file back and quotes it into the record it writes for the
    // artifact and the review summary. A write that fails is exit 1, like every other `--output` here.
    const driftPath = argValue("--drift");
    if (driftPath !== undefined) {
      if (refuted === null) {
        console.log(
          `coverage-trend: a ${spec.label} record has no crossing lines of its own to hold against the ` +
            `settlements — nothing written to ${driftPath}`,
        );
      } else if (refuted.length === 0) {
        console.log(
          `coverage-trend: no crossing line these settlements cannot produce — nothing written to ${driftPath}`,
        );
      } else {
        try {
          writeFileSync(driftPath, renderWaitDrift(refuted, settleKind), "utf8");
        } catch (error) {
          console.error(
            `coverage-trend: cannot write ${driftPath} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          process.exit(1);
        }
      }
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `recorded=${recorded.added.length}\nsettled=${recorded.records.length}\n` +
          // …and the one thing the poster step cannot work out for itself: which request a risen wait is
          // to be said on, which is empty on every night it is not. The step's `if:` is this output, so
          // a night that owes no comment skips the poster rather than posting nothing.
          `wait-request=${waitComment === null ? "" : waiting.number}\n` +
          // …and the same request again, published whether or not this night owes a remark on it, for the
          // one step that has a finding about the *record* rather than about the wait: a refuted crossing
          // line is repaired by a person, and this is the only request the night has to say so on. The two
          // outputs are deliberately not one — a step gated on `wait-request` must skip when no wait is
          // owed, while the verdict step's comment needs the open request on a night no median moved.
          `open-request=${waiting === null ? "" : waiting.number}\n` +
          // …and the one thing no later step can work out either: how many crossing lines the section
          // this step just rendered states that these settlements cannot produce. `0` is an ordinary
          // night and a positive count is the verdict `.freebuff/wait-drift-gate.mjs` fails the job over.
          // It is written on every run of a kind that *judges* rather than only when there is drift, so
          // an empty value means either that this step never ran or that its kind has no crossing record
          // to judge — a step that did not judge, never a record with nothing wrong with it — which is the
          // distinction the gate reads.
          (refuted === null ? "" : `wait-drift=${refuted.length}\n`) +
          // …and *which* lines those are, in the words the record and the section name them by, which is
          // what the verdict step's own comment is deduped on: the lines an earlier night has already
          // reported are not reported again, so a record left refuted for a week is one comment rather
          // than seven, and a new line joining it is the event that says it again.
          (refuted === null ? "" : `wait-drift-set=${refuted.map(waitDriftWhere).join("; ")}\n`),
      );
    }
    console.log(
      `coverage-trend: recorded ${recorded.added.length} settlement(s)` +
        (recorded.added.length > 0
          ? ` — ${recorded.added
              .map((record) => `#${record.number} ${record.outcome} after ${record.nights} night(s)`)
              .join(", ")}`
          : " — nothing was answered since the last night") +
        (recorded.records.length > 0
          ? `; ${recorded.records.length} settled so far: ${recorded.records
              .map((record) => record.nights)
              .join(", ")} night(s)`
          : "") +
        (recorded.closed.length === 0
          ? ""
          : `; ${recorded.closed.length} pull request(s) closed after the ask there was answered: ` +
            recorded.closed.map((close) => `#${close.number} on ${close.date}`).join(", ")) +
        (recorded.reopened.length === 0
          ? ""
          : `; ${recorded.reopened.length} pull request(s) reopened after the record said they were gone: ` +
            recorded.reopened
              .map((reopen) => `#${reopen.number}, closed on ${reopen.closed}`)
              .join(", ")) +
        (output === undefined || section === null ? "" : `; the summary to ${output}`) +
        (refuted === null || refuted.length === 0
          ? ""
          : `; ${refuted.length} crossing line(s) the settlements do not produce, which the drift gate ` +
            "fails the night over"),
    );
    process.exit(0);
  }

  let text;
  try {
    text = readFileSync(runbookPath, "utf8");
  } catch {
    console.error(
      `coverage-trend: cannot read ${runbookPath} — the runbook is where a run's readings are ` +
        "recorded, and with none there is nothing to compare",
    );
    process.exit(1);
  }

  // The nightly table, read best-effort: it is an addition to the runbook's records rather than a
  // second subject, so a checkout without one costs the answer its extra nights and says so on
  // stderr instead of failing a run over a file that is not the command's to require.
  let history = "";
  try {
    history = readFileSync(historyPath, "utf8");
  } catch {
    console.error(
      `coverage-trend: no history table at ${historyPath} — the trend is the runbook's records alone`,
    );
  }

  // The recorder comes first, and deliberately before the read below: it derives the floors from the
  // records this command was handed — the reading's whole history, which is what the committed file
  // must state — and writes them to the committed path (or `--file`). A write is not a verdict about
  // coverage but about whether it *could* write, so it has no business failing over a reading that
  // stepped down, and no business either reporting on a file it is on its way to writing.
  if (process.argv.includes("--write-low-water")) {
    const floors = derivedLowWater(mergeRecords(runbookRecords(text), historyRecords(history)));
    const target = argValue("--file") ?? lowWaterPath;
    try {
      writeFileSync(target, renderLowWater(floors), "utf8");
    } catch (error) {
      console.error(
        `coverage-trend: cannot write ${target} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
    console.log(
      `coverage-trend: recorded the low-water of ${Object.keys(floors).length} reading(s) in ${target}`,
    );
    process.exit(0);
  }

  // The committed low-water, read best-effort for the reason the table is: it is what the floors
  // are *read from*, and a file that is not there costs the answer the floors it names — the records'
  // own low-water stands in for the ones it does not — rather than failing a run over a file this
  // command did not have to be handed.
  let lowWater = {};
  try {
    lowWater = readLowWater(readFileSync(lowWaterPath, "utf8"));
  } catch (error) {
    console.error(
      `coverage-trend: ${lowWaterTrouble(lowWaterPath, error)} — the floors are the records' own`,
    );
  }

  // …and the recorder's other half, which is what a red trend is answered with: the same derivation
  // as a proposal rather than as a commit. It is reached *after* the committed read above (unlike
  // the recorder) because knowing what the file already states is the whole of deciding whether
  // there is anything to propose, and before the answer below because a run asked to write a file
  // is not answering a question about coverage.
  if (process.argv.includes("--propose-low-water")) {
    const derived = derivedLowWater(mergeRecords(runbookRecords(text), historyRecords(history)));
    const report = trendReport(text, { limit, history, lowWater });
    const proposal = floorProposal({ report, committed: lowWater, derived });
    const target = argValue("--file") ?? lowWaterPath;
    const output = argValue("--output") ?? join(ROOT, LOW_WATER_PROPOSAL_FILE);

    // Only a proposal writes the floor file: `unchanged` has nothing to write, and a `refused`
    // derivation is exactly the text that must not land (it holds no floor at all).
    if (proposal.changed) {
      try {
        writeFileSync(target, proposal.after, "utf8");
      } catch (error) {
        console.error(
          `coverage-trend: cannot write ${target} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exit(1);
      }
    }

    const body = renderFloorProposal({ report, proposal });
    try {
      writeFileSync(output, body, "utf8");
    } catch (error) {
      console.error(
        `coverage-trend: cannot write ${output} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${body}\n`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `changed=${proposal.changed ? "true" : "false"}\nstatus=${proposal.status}\n`,
      );
    }
    process.stdout.write(`${body}\n`);
    console.log(
      `\ncoverage-trend: ${proposal.status} — ${
        proposal.changed
          ? `wrote the floors the records derive to ${target}`
          : `the committed floors already state the derivation (${target} left as it is)`
      }, and the proposal to ${output}`,
    );
    process.exit(proposal.status === "refused" ? 1 : 0);
  }

  const report = trendReport(text, { limit, history, lowWater });
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderTrendReport(report)}\n`);
  }
  process.exit(report.exitCode);
}

// Only run the CLI when invoked as a script: the page renderer imports the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

/**
 * The page's `### Coverage over time` block, as lines, or `[]` when there is nothing to chart.
 *
 * One row per declared reading the two surfaces carried a line for, in the registry's order — the
 * same order the run page's `### Coverage` section and the history table's columns use, so a reader
 * moving between them is reading the same guard in the same place. Nothing is invented for a
 * reading neither file has recorded: such a guard has no row, and two files with no readings at all
 * (a fresh checkout, a file a caller handed in empty) render no heading either — an omission,
 * never an empty section.
 *
 * `history` is the nightly table's text, merged into the runbook's records by night; it is empty by
 * default, which charts the runbook alone and is what a caller with no table to hand over gets.
 *
 * `lowWater` is the floors the committed low-water file names, keyed by reading id — the same map
 * `trendReport` holds each reading against — and each reading's floor is drawn beneath its series.
 * A picture of a fall is only half the question a reader has: a dip in the bars says the reading
 * moved, and the floor beside it says whether it moved *below the level that counts*. So the row a
 * reading gets is two lines on one scale, and a reading the map does not name — an empty map by
 * default, which is what a caller with no file to hand over gets — says so in the row rather than
 * drawing a floor it does not have: an absent floor is an omission, the same as an absent record.
 */
export function coverageOverTime(text, { limit = TREND_LIMIT, history = "", lowWater = {} } = {}) {
  const records = mergeRecords(runbookRecords(text), historyRecords(history));
  const rows = READINGS.map((entry) => ({
    series: readingSeries(entry, records, { limit }),
    floor: lowWater?.[entry.id] ?? null,
  })).filter(({ series }) => series.points.length > 0);
  if (rows.length === 0) return [];

  return [
    "### Coverage over time",
    "",
    "From the committed runbook's dated records (`.freebuff/run.md`) and the nightly history table " +
      "(`.freebuff/coverage-history.md`), oldest first and one record per night — each reading's own " +
      "line, plotted by the number it declares. A record that carried no reading for a guard is left " +
      "out of that guard's chart rather than counted as a zero, a line the metric cannot read is " +
      "named instead of plotted, and a night only the table recorded is charted like any other.",
    "",
    "Beneath each series is the floor that reading is held against — the level its records have " +
      "settled to, recorded with the night it settled in `.freebuff/coverage-low-water.json` — drawn " +
      "on the series' own scale, so the bars can be read against the level a fall is measured from " +
      "and not only against each other.",
    "",
    ...rows.flatMap(({ series, floor }) => seriesRow(series, floor)),
    "",
  ];
}
