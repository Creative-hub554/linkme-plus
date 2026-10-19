/**
 * The coverage readings a run carries: one entry per guard that publishes what it audited.
 *
 * A reading is a line the suite writes while the test stage runs — the rendered-links guard's
 * destinations, the frozen-scratch pass's roster of judged suites, the convention guards'
 * exercised roster — which the runner reads
 * afterwards, carries in its `--json` report, and the nightly summary prints under its
 * `### Coverage` heading. Each one used to be its own constant, reader, capture variable,
 * payload field and test triple in `.freebuff/ci.mjs`; this module is the one declaration
 * they share, so a third guard's reading is an entry here — its file, its env seam, the
 * prefix that makes a line recognisably its own — and nothing new in the runner, the summary
 * or the report's shape. The writers read the same declaration, so a reading's file and
 * prefix are spelled once in the tree rather than agreed between two files by convention.
 *
 * Five things per entry, and each is a contract rather than a detail:
 *
 *   - `id` — the reading's name in the report: `payload.readings[id]` is its line, or `null`
 *     when this run's suite left none. Every consumer that wants a particular reading — the
 *     runner's own reader, the coverage history's columns, the summary's walk — goes through
 *     the id rather than a field of its own, so the report keeps one shape however many
 *     readings exist.
 *   - `file` — the sidecar's name under `.freebuff/`. It has to be a desk of its own: the
 *     suite's test files run in parallel workers, so two writers sharing a file would leave
 *     whichever finished last, and the run page would quote one guard's coverage under the
 *     other's name.
 *   - `env` — the seam a test points at scratch instead of at the tree's real sidecar. A
 *     relative value resolves against the checkout root, exactly as the runner's other file
 *     seams (`CI_RECORD_RUNBOOK_FILE`, `CI_CACHE_FILE`) do; this is `isAbsolute`-style, so a
 *     test can hand either.
 *   - `prefix` — the guard the runner carries a sidecar's line past: a file whose content does
 *     not begin with it is not a reading, so a stray file at that path cannot write a line of
 *     its choosing onto the run page. A bare prefix with nothing after it is not a reading
 *     either — the same refusal `.freebuff/coverage-history.mjs` makes of a stamp handed to
 *     it, stated once here so both ends of the pipeline agree.
 *   - `metric` — the number the reading is *charted* by, and the words a chart labels it with:
 *     a pattern with one capture group, matched against the line with the prefix stripped (so a
 *     pattern anchors on the reading's own words rather than on the marker the runner carried
 *     the line past), and the label those words are printed under. A reading is prose, and a
 *     trend needs one number per record, so the entry states *which* of the numbers its line
 *     carries is the measurement — rather than the chart picking the first integer it finds,
 *     which is how a footer's count of links becomes a guard's metric. A line the pattern
 *     cannot read is named as unreadable by every consumer, never plotted as a zero.
 *
 * One field is optional, and its absence is the rule it exists to depart from:
 *
 *   - `floored` — whether the reading's records are floors, which is yes by default. A
 *     default-yes is the whole of what the low-water derivation needs: every reading whose
 *     number is "how much the tree was audited" wants a floor, so a level it settled to once is
 *     a level its next night is held against. A reading whose number is *how much work remains*
 *     wants no floor at all — the queue's size falling is the queue being served, and a fall
 *     below its lowest night is good news a red night would lie about — so it declares
 *     `floored: false` and is thereby charted without one: the derivation names it in no
 *     `coverage-low-water.json`, the command holds it against no level, and its row and its
 *     chart's floor line say the absence is deliberate (`noFloorWords`) rather than a history
 *     nothing has accrued. The flag is read by the one derivation and the two renderers, both
 *     of which walk the registry, so a second unfloored reading is one field, not an edit in
 *     three files.
 *
 * The module is machinery, not a gate: it is imported by `.freebuff/ci.mjs`,
 * `.freebuff/nightly-report.mjs`, `.freebuff/coverage-history.mjs` and the suites that publish
 * readings, and it is pinned like its siblings so a quietly narrowed prefix or a changed
 * filename is a red alarm rather than a run page that stops saying anything.
 */

import { join, isAbsolute } from "node:path";

/** The rendered-links guard's reading: which destinations its mounts resolved. */
export const RENDERED_LINKS_READING = {
  id: "rendered-links",
  file: ".rendered-links-coverage.txt",
  env: "CI_COVERAGE_STAMP_FILE",
  prefix: "rendered-links coverage:",
  // The parenthesised total the chrome half closes with — the one head number the line has, and
  // the one the summary has always quoted — not the per-surface counts before it.
  metric: {
    pattern: /^chrome — .*\((\d+) unique destinations\)/,
    label: "chrome unique destinations",
  },
};

/** The frozen-scratch pass's reading: which suites that keep a scratch directory were judged. */
export const SCRATCH_PATHS_READING = {
  id: "scratch-paths",
  file: ".scratch-paths-coverage.txt",
  env: "CI_SCRATCH_STAMP_FILE",
  prefix: "scratch-paths coverage:",
  // The roster's own size — the number of suites judged, i.e. what the reading is *for* — rather
  // than the size of the tree the scan read them in, which the line states in parentheses after
  // the roster and which moves with the suite's own file count.
  metric: {
    pattern: /^(\d+) suite\(s\) keep a scratch directory/,
    label: "judged suites",
  },
};

/**
 * The convention guards' reading: which guards were exercised, and on their two shapes.
 *
 * A declared third entry and nothing else: this module is the whole of what a new reading
 * costs the shared machinery. The runner learns to clear, read and carry it by walking
 * `READINGS` below; the nightly summary learns to print it the same way; the report's shape
 * does not change (the id is another key in a map that already tolerates any of them); the
 * coverage history keeps a column for every declared reading, this one included, without an
 * edit of its own; and `.gitignore` covers the sidecar by the one rule every reading's name
 * obeys. What a reading does need is a writer,
 * and that is the one other file such a change touches — here
 * `src/test/convention-guards.test.ts`'s own close-out.
 */
export const CONVENTION_GUARDS_READING = {
  id: "convention-guards",
  file: ".convention-guards-coverage.txt",
  env: "CI_CONVENTION_GUARDS_STAMP_FILE",
  prefix: "convention-guards coverage:",
  metric: {
    pattern: /^(\d+) guard\(s\) exercised/,
    label: "guards exercised",
  },
};

/**
 * The verification queue's reading: the size the armed alarm judged the queue at.
 *
 * A reading whose number is a queue's *settled size* rather than a measure of the tree, and the
 * registry's one entry that says so with `floored: false` — the field the header documents: a
 * floor is the level a fall below reds the night, and the queue falling is the queue being
 * served, so the readings' floor machinery has no business in it. `coverage-trend`'s derivation
 * and both renderers read the flag from here.
 */
export const QUEUE_SETTLED_READING = {
  id: "queue-settled",
  file: ".queue-settled-coverage.txt",
  env: "CI_QUEUE_SETTLED_STAMP_FILE",
  prefix: "queue-settled coverage:",
  // The queue's settled size — the count the alarm judged — is the reading's head number, side
  // by side with the window it was judged against and the rows it owed, which are the prose the
  // chart keeps out and the bullet keeps.
  metric: {
    pattern: /^(\d+) pending application\(s\)/,
    label: "pending applications",
  },
  // The one reading's records are deliberately not floors: a queue's drain past its lowest night
  // is good news the floor machinery would red, so no `coverage-low-water.json` names this
  // reading, and the chart and the command say the absence is the rule.
  floored: false,
  // …and the words its chart line answers with in place of the generic "held against the nights
  // at hand", which is the floor machinery's own reason and not this reading's.
  noFloorWords:
    "charted without a floor, deliberately — this reading's number is how much work remains, and a " +
    "drain past the lowest night is good news a red would lie about",
};

/**
 * Every reading a run can carry, in the order the summary prints them.
 *
 * The array is the register: the runner walks it to clear and to read, the summary walks it to
 * render the run page's section, the coverage history to lay out its table's columns, and the
 * tests walk it so a reading added here is exercised by cases that were written before it
 * existed. Order is the run page's and the table's order — oldest reading first, a new one
 * appended — because a stable order is what lets two nights' sections be read against each
 * other.
 */
export const READINGS = [
  RENDERED_LINKS_READING,
  SCRATCH_PATHS_READING,
  CONVENTION_GUARDS_READING,
  QUEUE_SETTLED_READING,
];

/**
 * One reading by id, for the consumers that record or print a particular one.
 *
 * A consumer naming a reading that this module does not declare is a programming error rather
 * than a missing measurement — the runner's reader resolves each sidecar through it — so a
 * rename here without one there has to fail loudly at load rather than read nothing forever.
 */
export function reading(id) {
  const found = READINGS.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(
      `coverage-readings: no reading is declared under ${JSON.stringify(id)} — ` +
        `the declared ids are ${READINGS.map((entry) => entry.id).join(", ")}`,
    );
  }
  return found;
}

/**
 * Where one reading's sidecar lives, for a run rooted at `base`.
 *
 * `base` is the checkout root — the directory holding `.freebuff/` — and the env override is
 * resolved against it when it is relative, so a caller can hand either an absolute scratch path
 * (what a test does) or a repository-relative one. The default is the transient dot-file beside
 * the collect reporter's sidecars: per-run output, read by the runner's close and printed once,
 * never a checked-in artifact.
 *
 * @param {{ id: string, file: string, env: string, prefix: string }} entry the reading's entry
 * @param {string} base the checkout root the default and a relative override resolve against
 * @param {Record<string, string | undefined>} [env] the environment its seam is read from,
 *   `process.env` unless a caller (a test, pointing a run at scratch) hands another
 */
export function readingPath(entry, base, env = process.env) {
  const override = env[entry.env];
  if (override === undefined || override === "") return join(base, ".freebuff", entry.file);
  return isAbsolute(override) ? override : join(base, override);
}

/**
 * The line a sidecar's text carries for `entry`, or `null` when it is not that reading.
 *
 * Null is the answer for every way this can be wrong — an empty file, a file another guard
 * wrote, a file whose first line is some other text, a bare prefix with nothing after it — and
 * they are one state rather than five on purpose: what the callers are deciding is whether to
 * print a line, and "there is no reading here" is the only answer they can act on. The text is
 * trimmed, so the newline a writer leaves is not part of the reading.
 */
export function carriedReading(entry, text) {
  const line = typeof text === "string" ? text.trim() : "";
  if (!line.startsWith(entry.prefix)) return null;
  return line.slice(entry.prefix.length).trim() === "" ? null : line;
}

/**
 * The number one reading's line states under `entry.metric`, or `null` when it cannot be read.
 *
 * The number is the reading's own — whichever of the integers in its line the entry declares to
 * be the measurement — and it is read off the line rather than recomputed, so a chart cannot
 * disagree with the prose beside it. The prefix is stripped first, so a pattern anchors on the
 * reading's words rather than on the marker the runner carried the line past. `null` is the
 * answer for every way this can fail — a line that is not that reading at all, a line whose
 * wording moved out from under the pattern, a capture that is not a number — and they are one
 * answer on purpose, because the callers' only decision is whether to plot a point: a record
 * whose number cannot be read is *named* by the chart, never drawn as a zero.
 */
export function metricOf(entry, line) {
  const carried = carriedReading(entry, line);
  const pattern = entry?.metric?.pattern;
  if (carried === null || !(pattern instanceof RegExp)) return null;
  const match = pattern.exec(carried.slice(entry.prefix.length).trim());
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Every reading a `ci.mjs --json` payload carries, as `{ id, entry, line }` rows, in the
 * registry's order and only for the readings that arrived.
 *
 * The summary's renderer and the runner's own close both read the report rather than the
 * sidecars, so this is where the report's shape meets the registry: a row appears when the
 * payload carries a non-empty string for that id and not otherwise. A payload with no
 * `readings` at all — an older report, a hand-written fixture, a crashed gate — answers an
 * empty list, which renders as no coverage section rather than as an empty one.
 */
export function carriedReadings(payload) {
  const readings = payload?.readings;
  if (typeof readings !== "object" || readings === null) return [];
  return READINGS.filter(
    (entry) => typeof readings[entry.id] === "string" && readings[entry.id].trim() !== "",
  ).map((entry) => ({ id: entry.id, entry, line: readings[entry.id].trim() }));
}
