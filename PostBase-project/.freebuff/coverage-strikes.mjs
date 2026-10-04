/**
 * The coverage gates' declared strike list — how many weakenings there are supposed to be,
 * and what each one is.
 *
 * A mutation table is a *count*, and the check that walks it reports the cases it saw, never
 * the cases there should have been: delete an entry from
 * `src/test/coverage-mutations.ts` and the sweep simply gets smaller, every remaining case
 * passes, and the gate reads green over a script nobody is checking any more. So the list is
 * declared here, apart from the table it mirrors, and **two** consumers hold the table against
 * it:
 *
 *   - this list's length is what `.freebuff/mutation-coverage.mjs` compares its run against —
 *     the opt-in run refuses when it weakened fewer gates than are declared, which is where a
 *     deleted strike would otherwise pass unnoticed; and
 *   - the entries are what `src/test/declared-strikes.ts` holds `MUTATIONS` against, both
 *     ways and anchor by anchor, in the default suite.
 *
 * It lives in `.freebuff/` rather than beside the table for one reason: the launcher is a
 * plain Node script, so the declaration has to be a module it can load, and naming it
 * `coverage-*.mjs` keeps it behind the `mutation-coverage` stage's key (the runner's inputs
 * already watch that family) and inside the pin's coverage rule. The table itself stays in
 * `src/test/coverage-mutations.ts`, where the check applies it.
 *
 * Each entry names the gate script, the test file whose failure is the verdict, and the exact
 * edit the check makes: `find` must occur once in the script, `replace` is the weakening. The
 * declaration is deliberately not generated from the table — a copy that could be regenerated
 * from it would hold nothing.
 */
export const COVERAGE_STRIKES = [
  {
    script: ".freebuff/coverage-floor.mjs",
    test: "src/test/coverage-floor.test.ts",
    find: "if (pct < threshold) {",
    replace: "if (pct <= threshold) {",
  },
  {
    script: ".freebuff/coverage-headroom.mjs",
    test: "src/test/coverage-headroom.test.ts",
    find: "if (headroom < minimum)",
    replace: "if (headroom <= minimum)",
  },
  {
    script: ".freebuff/coverage-scopes.mjs",
    test: "src/test/coverage-scopes.test.ts",
    find: "return new RegExp(`^${pattern}$`);",
    replace: "return new RegExp(`${pattern}`);",
  },
  {
    script: ".freebuff/coverage-report.mjs",
    test: "src/test/coverage-report.test.ts",
    find: "headroom < HEADROOM_TARGET",
    replace: "headroom <= HEADROOM_TARGET",
  },
  {
    script: ".freebuff/coverage-propose.mjs",
    test: "src/test/coverage-propose.test.ts",
    find: "cell.pct > cell.basePct",
    replace: "cell.pct >= cell.basePct",
  },
];
