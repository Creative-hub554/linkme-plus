/**
 * The collect-budget baselines: the recorded inputs the collect-time reporter
 * enforces, in one place.
 *
 * `importBaselines` and `softThreshold` are recorded — `npm run collect:record`
 * measures a run and lowers either one the run beat, never raises it, so both
 * gates only ever tighten:
 *
 *   - `importBaselines` — each tracked scanner's low-water import cost. A file's
 *     import of that scanner must stay within `importMarginMs` of it.
 *   - `softThreshold` — the fraction of its collect budget at which a file stops
 *     being merely interesting and starts being a warning, kept a margin above
 *     the tightest file the recording run saw.
 *
 * `importMarginMs` is the fixed margin the import gate keeps over each
 * `importBaselines` entry. It is hand-set on purpose: it is about how much noise
 * a single import can absorb, not about what the machine measured.
 *
 * Generated — do not edit `importBaselines` or `softThreshold` by hand. `npm
 * run collect:record` rewrites them, and a hand-edit fails the freshness test in
 * `src/test/collect-budget.test.ts`. To loosen a gate deliberately, edit this
 * file and say why in the commit.
 *
 * Mirrors the coverage pair whose shape it borrows: `coverage-thresholds.mjs`
 * holds the backstop and `coverage-headroom.mjs` fails the build when the margin
 * over it is too thin. Here the recorded values are the backstops.
 */

export const importMarginMs = 50;

export const softThreshold = 0.58;

export const importBaselines = {
  "src/test/module-index.ts": 4,
  "src/test/source-scan.ts": 2,
};
