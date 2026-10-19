import { describe, expect, it } from "vitest";
import configSource from "../../vitest.config.ts?raw";
// The config is read as source, not as a module — the same reason
// `house-timeout.test.ts` and `suite-excludes.test.ts` read it this way:
// `vitest.config.ts` resolves paths through `import.meta.dirname`, which the
// suite's transform does not provide, and the source is the truth the suite
// runs on. These are the bytes vitest loads.

/**
 * Three of the config's keys beyond the house timeout are load-bearing the
 * same way it is: a tidy-up that moved one would fail nothing loudly — it
 * would only change what a *passing* run tells you, or re-create contention
 * flake that reads as red in tests that have not changed. That is the failure
 * house-timeout exists to remember, generalized:
 *
 * - `maxWorkers: 4` caps a pool vitest otherwise sizes to the machine, so two
 *   concurrent session runs fight for cores and DOM files miss their budgets.
 * - `reporters` must keep `default` first with the collect-budget backstop
 *   second; without the backstop, a creeping collection regression is the one
 *   symptom an otherwise-green run never shows.
 * - `coverage.include` naming the whole `src` tree is the floor's denominator:
 *   with it (and vitest 4's removed `all` flag), included-but-unimported files
 *   still count at 0%, so a new module cannot land without pulling the total
 *   down. Drop the key and that guarantee is gone.
 */
describe("the suite config's load-bearing keys beyond the timeout", () => {
  // Slicing by block keeps a stray mention inside a comment or a helper from
  // being mistaken for the setting the runner reads — the same rule the
  // timeout pin applies between `test: {` and `coverage: {`.
  const testBlock = configSource.slice(
    configSource.indexOf("test: {"),
    configSource.indexOf("coverage: {"),
  );
  const coverageBlock = configSource.slice(configSource.indexOf("coverage: {"));

  it("caps the worker pool at 4, below the machine's core count", () => {
    const value = testBlock.match(/maxWorkers:\s*([0-9_]+)/)?.[1] ?? "";
    expect(value, "the test block carries no `maxWorkers:` — the pool is back to machine-sized").not.toBe("");
    expect(Number(value.replaceAll("_", ""))).toBe(4);
  });

  it("keeps the default report first and the collect-budget backstop beside it", () => {
    const declared = /(?:^|\n\s*)reporters:/.test(testBlock);
    expect(declared, "the test block carries no `reporters:` — the run answers with vitest's bare defaults").toBe(true);
    const array = testBlock.match(/reporters:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    const defaultAt = array.indexOf(`"default"`);
    const budgetAt = array.indexOf("./src/test/collect-budget.ts");
    expect(
      defaultAt >= 0 && budgetAt >= 0,
      "either the usual report or the collection backstop is gone from the `reporters` array",
    ).toBe(true);
    expect(
      defaultAt < budgetAt,
      "the backstop is named first or around the usual report — a BudgetFailure would surface in a report the reader does not recognize",
    ).toBe(true);
  });

  it("measures the whole src tree for coverage, covered or not", () => {
    const declared = /(?:^|\n\s*)include:/.test(coverageBlock);
    expect(declared, "the coverage block declares no `include:` — unimported source files stop counting").toBe(true);
    const include = coverageBlock.match(/include:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    expect(
      include.includes("src/**/*.{ts,tsx}"),
      "the floor's denominator does not name the source tree — a new module can land without pulling the total down",
    ).toBe(true);
  });
});
