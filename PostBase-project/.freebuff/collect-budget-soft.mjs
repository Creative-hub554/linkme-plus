/**
 * The soft-gate sidecar: the contract between the collect-time reporter and the
 * CI runner.
 *
 * The reporter runs inside Vitest and the runner reads its output through pipes,
 * so a warning written to stderr on a *passing* run is captured and never shown.
 * Instead the reporter leaves this one small JSON file when — and only when — a
 * test file has crossed a high fraction of its collect budget, and `ci.mjs` turns
 * it into the `WARN` details that print in the report and become GitHub
 * `::warning` annotations.
 *
 * The two sides share this module so the filename and the detail's shape cannot
 * drift apart, the way `.freebuff/coverage-scopes.mjs` keeps the report, the gate
 * and the proposer agreeing about a coverage number.
 *
 * The sidecar is transient: `ci.mjs` deletes any stale copy before the run and
 * reads (then deletes) this run's afterward. It is deliberately **not** a
 * checked-in file — the recorded baselines in `collect-budget-baselines.mjs` are,
 * but this is per-run output.
 */

/** The sidecar's filename, under `.freebuff/`, that both sides agree on. */
export const SOFT_GATE_FILE = ".collect-budget-soft.json";

/**
 * The CI details a set of soft-gate warnings earns.
 *
 * A `WARN` mark is what makes the runner treat the entry as a warning rather than
 * an error — it is printed for a passing stage and annotated as `::warning`,
 * without failing anything. `warning` is a `CollectRow` from the reporter:
 * `{ file, collect, ceiling, used }`; the arithmetic is re-derived here so a
 * malformed file cannot produce a misleading percentage.
 */
export function softGateDetails(warnings) {
  return warnings.map((warning) => ({
    mark: "WARN",
    name: warning.file,
    detail:
      `${Math.round((warning.used ?? 0) * 100)}% of its collect budget ` +
      `(${Math.round(warning.collect ?? 0)}ms of ${Math.round(warning.ceiling ?? 0)}ms) — ` +
      "nearing the collect-time gate",
    location: { file: warning.file },
  }));
}
