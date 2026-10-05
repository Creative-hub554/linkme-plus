/**
 * The per-file floor's numbers, in one place.
 *
 * `.freebuff/coverage-floor.mjs` applies these, and until now that script was
 * also where they were written — which is exactly the shape of a gate that can
 * be weakened without anything failing. Lowering a number here makes the floor
 * looser and the script simply reports fewer breaches, while every other check
 * in the suite reads the coverage *report* rather than these rules, so none of
 * them would notice. Keeping the numbers in a module is what lets
 * `src/test/coverage-gates.test.ts` import them and fail when one is lowered —
 * the same arrangement, for the same reason, as
 * `.freebuff/coverage-thresholds.mjs`.
 *
 * The script still owns *how* the floor is applied — which metrics each file is
 * held to, and the `--threshold` override — so this module is only the numbers,
 * and the whole gate can be read at a glance.
 */

/**
 * The floor every file must clear, in percent, for lines and statements.
 *
 * Set just under the lowest file, which is the binding constraint on how high it
 * can go: today that is `src/components/cover-studio/cover-studio.tsx` at 28.72%
 * lines and 25.85% statements, so the floor is 28 / 25. It was 52 until the
 * 2026-10-05 re-baseline — the newest components landed well under the old
 * binding file (`authenticator-security.tsx`, 52.87) and the floor follows its
 * constraint down exactly as it follows it up: covering `cover-studio.tsx` is
 * what raises this number again, and until then a floor above it would cry wolf
 * on every run rather than catch a new file dropping under the tree.
 */
export const BASE_FLOOR = { lines: 28, statements: 25 };

/**
 * The extra floors the pure-logic directories are held to, per file.
 *
 * Each is a point or so under that directory's lowest file:
 *   src/lib   — lowest branches 60.00% (`src/lib/db/ensure-profile.ts`),
 *               lowest functions 61.53% (`src/lib/r2.ts`).
 *   src/utils — every file is at 100% on both.
 */
export const DIRECTORY_FLOORS = [
  { prefix: "src/lib/", floors: { branches: 59, functions: 60 } },
  { prefix: "src/utils/", floors: { branches: 99, functions: 99 } },
];

/**
 * Files the *extra* floors do not reach, each for a structural reason rather
 * than because it is hard to test. They are still held to the base floor.
 *
 * The test is whether a number below the floor would be a gap a test could
 * close. For the one below, it would not: the uncovered "functions" are not
 * units the app calls but the schema builders, which are exercised as data at
 * import time. The browser Supabase factory used to sit here too, but it now
 * has a test of its own and is held to the directory floors like everything
 * else. An exemption is a loosening of a gate, so it is pinned by file in the
 * test that guards these rules.
 */
export const EXEMPTIONS = new Map([
  [
    "src/lib/db/schema.ts",
    "Drizzle table and column definitions — the count is its schema builders, " +
      "which are exercised as data at import time, not called by the app",
  ],
]);
