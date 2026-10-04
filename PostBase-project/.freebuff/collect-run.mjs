/**
 * The collect run report: what a run measured, and which recorded gates it found loose.
 *
 * The reporter runs inside Vitest and cannot fail a build on a *loose* gate — one
 * run is one noisy sample of a wall-clock quantity, so a single reading is not
 * evidence enough to call a recorded value stale. Instead it leaves this one small
 * JSON file on every run that judged the gates, and three readers divide up what it
 * says:
 *
 *   - `ci.mjs` turns the loose baselines into `WARN` details, so a single-run
 *     sighting is annotated and printed without failing anything;
 *   - `npm run collect:stale` reads it after a *repeated* session and fails when the
 *     session was complete and every run agreed a recorded gate is loose (at least
 *     `MIN_CONFIRMING_RUNS` of them, all having left a sample); and
 *   - `npm run collect:gates` publishes the per-module measurements, the tightest
 *     file this run saw, and the headroom at which the band is called stale, beside
 *     the recorded baselines in the run summary, so the gap between what is recorded
 *     and what the tree pays is legible on a *green* build — the one time nobody is
 *     watching the gate.
 *
 * The three share this module so the filename and the shape cannot drift apart, the
 * way `.freebuff/collect-budget-soft.mjs` keeps the reporter and the runner
 * agreeing about a soft-gate warning.
 *
 * The report is transient: every run rewrites it, and it is deliberately **not** a
 * checked-in file — the baselines in `collect-budget-baselines.mjs` are.
 */

/** The report's filename, under `.freebuff/`, that its readers agree on. */
export const RUN_REPORT_FILE = ".collect-budget-run.json";

/**
 * How many runs a session must have taken before a loose gate is confirmed.
 *
 * Two is the floor, not a preference: "every run agrees" is vacuous for a single
 * run, and one run is exactly the noisy sample the repeated session exists to
 * average out. The reporter writes `runs: 1` for a plain run — it *judged* the
 * recorded values, which is why the warning is worth annotating and the measurement
 * worth publishing, but it cannot confirm one — so `npm run collect:stale` reads
 * that report as unable to speak rather than as a clean bill of health.
 */
export const MIN_CONFIRMING_RUNS = 2;

/** Whether a value is a plain object, not an array or null. */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a real, finite number. */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** A millisecond count, as an integer when it is one and to a decimal otherwise. */
function ms(value) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}ms`;
}

/** A fraction of a collect budget, as the percentage a person reads it as. */
function percent(value) {
  return `${Math.round(value * 100)}%`;
}

/** The kinds of recorded gate a report can call loose. */
const KINDS = ["import", "band"];

/**
 * The report the reporter writes, or null when the text is not one.
 *
 * Null is the answer for every way this can go wrong — not JSON, the wrong shape, a
 * run count that is not a positive number, a measurement or threshold map that is not
 * costs, a tightest file, band headroom or judged floor that is not a non-negative
 * fraction, an entry missing its module or its numbers — because the readers are deciding
 * whether to fail a build, and "there is nothing trustworthy here" is one state,
 * not five. A malformed report must never be read as "nothing is loose".
 */
export function parseRunReport(text) {
  if (typeof text !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isFiniteNumber(parsed.runs) || parsed.runs < 1) return null;
  if (!isFiniteNumber(parsed.samples) || parsed.samples < 0) return null;
  if (!isRecord(parsed.measured)) return null;
  for (const cost of Object.values(parsed.measured)) {
    if (!isFiniteNumber(cost) || cost < 0) return null;
  }
  // The per-import staleness thresholds are costs too: a reader compares a recorded
  // baseline against one, so a blank or a negative there is as untrustworthy as a
  // missing measurement.
  if (!isRecord(parsed.importStaleAbove)) return null;
  for (const limit of Object.values(parsed.importStaleAbove)) {
    if (!isFiniteNumber(limit) || limit < 0) return null;
  }
  // `tightest` is the fraction of its budget the run's dearest file used,
  // `staleBandHeadroom` the fraction of it the band is called loose past, and
  // `bandJudgedFrom` the fraction a run must reach before the band is judged at all —
  // so the one thing any of them cannot be is negative or absent. The summary reads
  // them against one another, and a missing number there is a report, not a
  // measurement.
  if (!isFiniteNumber(parsed.tightest) || parsed.tightest < 0) return null;
  if (!isFiniteNumber(parsed.staleBandHeadroom) || parsed.staleBandHeadroom < 0) return null;
  if (!isFiniteNumber(parsed.bandJudgedFrom) || parsed.bandJudgedFrom < 0) return null;
  if (!Array.isArray(parsed.stale)) return null;
  const stale = [];
  for (const entry of parsed.stale) {
    if (!isRecord(entry)) return null;
    if (!KINDS.includes(entry.kind)) return null;
    if (typeof entry.name !== "string") return null;
    if (!isFiniteNumber(entry.recorded) || !isFiniteNumber(entry.measured)) return null;
    stale.push({
      kind: entry.kind,
      name: entry.name,
      recorded: entry.recorded,
      measured: entry.measured,
    });
  }
  return {
    runs: parsed.runs,
    samples: parsed.samples,
    measured: parsed.measured,
    importStaleAbove: parsed.importStaleAbove,
    tightest: parsed.tightest,
    staleBandHeadroom: parsed.staleBandHeadroom,
    bandJudgedFrom: parsed.bandJudgedFrom,
    stale,
  };
}

/**
 * The CI details a set of stale-high baselines earns.
 *
 * A `WARN` mark is what makes the runner treat the entry as a warning rather than
 * an error — printed for a passing stage and annotated as `::warning` — because a
 * lone run only *suspects* a recorded value is stale; the repeated session is what
 * confirms it. `stale` is the report's entries:
 * `{ kind, name, recorded, measured }`, re-derived here so a malformed file cannot
 * produce a misleading line. The kind picks the units: an import is milliseconds
 * and points at the module, while the band is a fraction of a budget and belongs to
 * the reporter's own file rather than to any test file.
 */
export function staleGateDetails(stale) {
  return (Array.isArray(stale) ? stale : []).map((entry) => {
    if (entry?.kind === "band") {
      return {
        mark: "WARN",
        name: String(entry.name ?? "?"),
        detail:
          `recorded ${percent(Number(entry.recorded) || 0)} of a collect budget but the ` +
          `run's tightest file used only ${percent(Number(entry.measured) || 0)} — the ` +
          "band warns later than the tree needs",
      };
    }
    return {
      mark: "WARN",
      name: String(entry?.name ?? "?"),
      detail:
        `recorded ${ms(Number(entry?.recorded) || 0)} but the run measured ` +
        `${ms(Number(entry?.measured) || 0)} — the gate is looser than the tree needs`,
      location: { file: String(entry?.name ?? "?") },
    };
  });
}
