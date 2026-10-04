import { describe, expect, it } from "vitest";
// The config is imported as source, not as a module: `vitest.config.ts` resolves
// paths through `import.meta.dirname`, which the suite's transform does not
// provide — the same reason `suite-drift.test.ts` reads it as `?raw`. The source
// is the truth the suite runs on; these are the bytes vitest loads.
import configSource from "../../vitest.config.ts?raw";

/**
 * The suite's `test.exclude` decides which files the collector may walk into, so
 * it is a load-bearing list. `.ci/` is working scratch space: a killed run can
 * leave a partial copy of the project in there for days, and a `*.test.ts` under
 * one that imports modules its partial tree does not have fails *collection* —
 * the suite goes red about debris rather than about anyone's code. This happened:
 * two files under `.ci/scratch-debug-dedup/` red the suite's first stage for a
 * day, and parking the same tree under a dot-directory changed nothing, because
 * this vitest collects dot-directories and its own defaults did not exclude the
 * one it was parked under. These pins hold the list's shape so a tidy-up cannot
 * drop the scratch exclusion, and so the defaults cannot be quietly replaced by
 * a hand list that forgets them.
 */
describe("the suite config's exclude list", () => {
  // The `test:` block sits between its opening and the `coverage:` block, whose
  // own `exclude` is a different list about different files (source patterns, not
  // collected tests). The first `exclude:` array inside the `test:` block is the
  // collection one.
  const testBlock = configSource.slice(
    configSource.indexOf("test: {"),
    configSource.indexOf("coverage: {"),
  );
  const exclude = testBlock.match(/exclude:\s*\[([\s\S]*?)\]/)?.[1] ?? "";

  it("declares the test block's exclude array", () => {
    expect(exclude, "no test.exclude array found between `test: {` and `coverage: {`").not.toBe("");
  });

  it("keeps the `.ci` scratch root out of collection", () => {
    expect(exclude).toContain('".ci/**"');
  });

  it("still spreads configDefaults.exclude rather than replacing it", () => {
    expect(exclude).toContain("...configDefaults.exclude");
  });

  it("keeps the coverage-mutation file out of the shared run", () => {
    expect(exclude).toContain('"src/test/coverage-mutation.test.ts"');
  });
});
