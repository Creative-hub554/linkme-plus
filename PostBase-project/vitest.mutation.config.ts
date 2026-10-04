import { defineConfig } from "vitest/config";

/**
 * The config for the coverage gate mutation check. `npm run mutation:coverage` runs
 * it through `.freebuff/mutation-coverage.mjs`, which turns this run's Vitest report
 * into the same `--json` contract the guard sweep speaks — `gate`, `checked`,
 * `survivors` — so `.freebuff/ci.mjs` reports a survived coverage gate the way it
 * reports a survived route guard. Running the config directly (`npx vitest run
 * --config vitest.mutation.config.ts`) is the way to watch a single case.
 *
 * It is deliberately *not* the suite's `vitest.config.ts`, and the reason is the
 * check's own mechanism: `src/test/coverage-mutation.test.ts` edits each coverage
 * script **in place** for the duration of one case and runs that script's own test
 * file against the weakened source. Vitest runs test *files* in parallel, so if the
 * check ran inside the default suite, a sibling file reading the same script would
 * see the weakened source at the same moment and fail — a false alarm arriving
 * exactly as the check was proving the opposite. That is not hypothetical: run in
 * one command with the other coverage tests, it tripped `coverage-floor.test.ts`'s
 * four boundary cases.
 *
 * So the check is isolated instead of being made to fit: one file, no other test it
 * could race, loading the scripts it means to weaken. `environment: "node"` is all
 * it needs — the check spawns its own Vitest children, which discover the ordinary
 * `vitest.config.ts` for the files they run — so this config can stay this small.
 * It exists so the mutation check can be the only writer of those scripts while it
 * runs; run it on its own, the way `.freebuff/mutation-guards.mjs` is run on its own.
 */
export default defineConfig({
  test: {
    include: ["src/test/coverage-mutation.test.ts"],
    environment: "node",
  },
});
