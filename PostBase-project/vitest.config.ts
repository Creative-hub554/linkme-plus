import { configDefaults, defineConfig } from "vitest/config";
import path from "path";
// The thresholds live in their own module so the report that publishes the
// headroom against them reads the same numbers this config enforces.
import thresholds from "./.freebuff/coverage-thresholds.mjs";

export default defineConfig({
  // `tsconfig.json` keeps `jsx: "preserve"` for Next, so the transform left JSX
  // alone and every component test died on a missing `React`. Compiling with the
  // automatic runtime here is what lets a test render a real component without
  // the app having to import React in every file. This is the `oxc` option (vite
  // 8's transform engine) — the older `esbuild.jsx` shape is ignored with a
  // warning on this line, and .tsx files then fail to parse at all.
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  test: {
    // The Workers-like environment this used to ask for (`miniflare`) comes from
    // `vitest-environment-miniflare`, which is not a dependency here — so the
    // suite could not start at all. `node` runs the pure units below (a SQL
    // predicate and a presentational component rendered to a string); switch it
    // back once that package, or `@cloudflare/vitest-pool-workers`, is added.
    //
    // Kept as the default on purpose even now that `jsdom` is installed, because
    // most of this suite genuinely is pure — a predicate, a truth table — and
    // jsdom costs seconds per file to start. A file that needs a document asks
    // for one with `// @vitest-environment jsdom` at the top and mounts through
    // `src/test/render.tsx`. The browser globals that environment needs are
    // shimmed in `src/test/setup.ts`, behind a `typeof window` guard so they can
    // never leak into the node ones.
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The coverage gate mutation check edits those scripts in place while it runs,
    // so it must not share this parallel run with the tests that read them — see
    // `vitest.mutation.config.ts` and `npm run mutation:coverage`. `configDefaults`
    // keeps Vitest's own excludes (node_modules, dist, …) alongside this one.
    //
    // `.ci/` is working scratch space, and scratch is not suite: a killed run can
    // leave a partial copy of the tree in there for days, and a `*.test.ts` under
    // one that imports modules its partial tree lacks fails *collection* — a red
    // suite about nobody's code. Dot-directories offer no shelter here (the default
    // excludes did not keep `.temp/**` out when a scratch tree was parked under
    // one), so the scratch root is excluded by name. `vitest.mutation.config.ts`
    // needs no such entry: its `include` is a single named file, a whitelist junk
    // cannot enter. Pinned by `src/test/suite-excludes.test.ts`.
    exclude: [
      ...configDefaults.exclude,
      ".ci/**",
      "src/test/coverage-mutation.test.ts",
    ],
    // Suite-level drift watch, run once per suite rather than once per file.
    // This checkout is shared: another writer can land between the first file a
    // source-reading guard loads and the last, so a failure taken then may be
    // about code that is already gone. Fingerprinting the tree before and after
    // the whole run and reporting what moved is what lets a reader tell that
    // apart from a real failure. It only warns; a moving checkout is a fact
    // about the environment, not a defect in the code.
    globalSetup: ["./src/test/suite-drift.ts"],
    // Fail the run when a test file's collection crosses its budget. Collection
    // is time a passing test never sees, so it is the only symptom a returning
    // eager import or `?raw` glob leaves; this is the backstop the source guards
    // cannot be. Named by path, the way a reporter is loaded — see the module for
    // what it measures and why. `default` stays first so the usual report is
    // unchanged.
    reporters: ["default", "./src/test/collect-budget.ts"],
    // Cap the worker pool. Vitest sizes it to the machine — this one reports
    // twelve cores — and runs one test *file* per worker, so on a development
    // box (where more than one session may run the suite at once) the heavy DOM
    // files fight each other for the CPU. That contention is what made the a11y
    // file's `waitFor` calls — a Radix menu opening, a whole page mounting —
    // miss their budget and fail as flakes in tests that had not changed.
    //
    // Four is deliberately below the core count: measured here, the capped suite
    // was both greener (no flaky timeouts across runs) and *faster* (~18s vs
    // ~21-27s), because the same work spent less time thrashing. It is a
    // ceiling, not a target, so a quiet machine just runs files back to back.
    maxWorkers: 4,
    // Needed by `src/test/globals-layer.test.ts`, which imports `globals.css`
    // with Vite's `?raw` query to read the stylesheet's *source*. Without this,
    // Vitest replaces every CSS import with an empty string and `?raw` hands back
    // `""` — a stylesheet contract test that silently asserts nothing.
    css: true,
    coverage: {
      provider: "v8",
      // A source file no test imports is still counted, at 0%, so a new module
      // cannot land without pulling the total down. Vitest 4 removed the old
      // `all: true` flag: with `coverage.include` defined, files matching the
      // pattern are now always in the report, covered or not — the same
      // semantics, so the floor reads the same numbers. Only `src/` is measured
      // — `worker/` and the config files are outside the app surface this suite
      // covers.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Tests and the harness they share. `src/test/**` is infrastructure
        // (render helpers, the leak tracker, the fake db), not product code.
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/test/**",
        // The demo seed is an operational script: `npm run db:seed` imports it
        // and it runs on load (inserting rows and then ending the pool), so it
        // cannot be exercised in-process. It is not reachable at runtime by the
        // app, so it is not part of the surface a coverage floor is about.
        "src/lib/db/seed.ts",
      ],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./.coverage",
      // Thresholds, by directory — read from `.freebuff/coverage-thresholds.mjs`,
      // which carries the rationale for each number and which
      // `.freebuff/coverage-report.mjs` also reads so the report cannot claim
      // headroom the gate does not have.
      thresholds,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
