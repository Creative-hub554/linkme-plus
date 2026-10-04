/**
 * The coverage gates' mutation table: one deliberate weakening per coverage script, and the
 * test file that must fail when the script is weakened.
 *
 * `src/test/coverage-mutation.test.ts` applies each entry in turn and requires the mapped test
 * file to fail, which is the whole check; this module is only its data, and it lives apart from
 * the check for one reason: a table is a *count*. Delete an entry and the check goes on passing
 * over whatever is left — the launcher counts the cases it saw, not the cases there should have
 * been — so `src/test/declared-strikes.test.ts` holds a declared copy of this list against it,
 * both ways, the way the other sweeps' tables are held. A strike
 * removed without its declaration, or a declaration left behind by a strike, is a failing case
 * rather than a smaller sweep.
 *
 * Each entry is the change a reader would most fear: the `<` that lets a file sitting exactly on
 * its floor pass, the `<` that makes exactly-a-point-of-headroom pass, the `^…$` that keeps a
 * glob from matching a partial path, the `<` behind the report's ⚠, and the strict `>` that
 * keeps pre-existing slack from counting as earned. `find` is a substring of the script's own
 * source and must occur exactly once — the check refuses rather than skips when it no longer
 * does, and the ratchet holds the same anchor against the same script from the default suite,
 * so a rotted anchor is a cheap failure rather than a whole `npm run mutation:coverage` run.
 */

/** One deliberate weakening of one coverage script, and the test that must notice. */
export interface Mutation {
  /** The coverage script to weaken, project-relative. */
  script: string;
  /** The test file that must fail when the script is weakened. */
  test: string;
  /** A substring of the script's source that must occur exactly once. */
  find: string;
  /** What replaces it — the weakening. */
  replace: string;
  /** What the weakening costs, for the failure message. */
  why: string;
}

export const MUTATIONS: Mutation[] = [
  {
    script: ".freebuff/coverage-floor.mjs",
    test: "src/test/coverage-floor.test.ts",
    find: "if (pct < threshold) {",
    replace: "if (pct <= threshold) {",
    why:
      "the floor would fail a file sitting exactly on it, so `coverage-floor.test.ts` " +
      "no longer pins the boundary as inclusive.",
  },
  {
    script: ".freebuff/coverage-headroom.mjs",
    test: "src/test/coverage-headroom.test.ts",
    find: "if (headroom < minimum)",
    replace: "if (headroom <= minimum)",
    why:
      "a whole tree clearing its backstop by exactly the target would fail, so the " +
      "headroom test no longer pins the one-point line as the pass boundary.",
  },
  {
    script: ".freebuff/coverage-scopes.mjs",
    test: "src/test/coverage-scopes.test.ts",
    find: "return new RegExp(`^${pattern}$`);",
    replace: "return new RegExp(`${pattern}`);",
    why:
      "an unanchored glob matches a partial path, so a threshold could hold files it " +
      "should not — and `coverage-scopes.test.ts` no longer pins the anchoring.",
  },
  {
    script: ".freebuff/coverage-report.mjs",
    test: "src/test/coverage-report.test.ts",
    find: "headroom < HEADROOM_TARGET",
    replace: "headroom <= HEADROOM_TARGET",
    why:
      "the report would flag a scope with exactly the target margin, so the report " +
      "test no longer pins the ⚠ to the margin *under* the line.",
  },
  {
    script: ".freebuff/coverage-propose.mjs",
    test: "src/test/coverage-propose.test.ts",
    find: "cell.pct > cell.basePct",
    replace: "cell.pct >= cell.basePct",
    why:
      "every unchanged row would count as earned, so the proposer test no longer pins " +
      "`earned` to the rows this change actually moved.",
  },
];
