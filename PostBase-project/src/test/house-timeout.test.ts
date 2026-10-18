import { describe, expect, it } from "vitest";
// The config is read as source, not as a module — the same reason
// `suite-excludes.test.ts` reads it this way: `vitest.config.ts` resolves paths
// through `import.meta.dirname`, which the suite's transform does not provide,
// and the source is the truth the suite runs on. These are the bytes vitest
// loads. The kit's own copy is imported raw beside it: a hosted run executes
// `.ci/gate-content/vitest.config.ts` as its config, so the two files are two
// truths that have to agree.
import configSource from "../../vitest.config.ts?raw";
import kitConfigSource from "../../.ci/gate-content/vitest.config.ts?raw";

/**
 * The suite's house timeout is one number in the test block, and it is
 * load-bearing: `testTimeout: 20_000` replaced Vitest's 5s default because the
 * default assumes a quiet box, and this suite spawns real processes — whole
 * tests sat at 3-4.9s against the 5s cliff on a hosted runner, red in tests
 * that had not changed. These pins hold that decision so a config tidy-up
 * cannot silently resurrect a 5s cliff (which would re-flake every spawn-heavy
 * case the explicit budgets above it back), nor quietly tighten or replace the
 * floor. The per-describe and per-test budgets (60s, 120s) are ceilings above
 * this floor; they are pinned in the files that hold them.
 */
describe("the suite config's house timeout", () => {
  // The `test:` block sits between its opening and the `coverage:` block, whose
  // own keys are about the coverage report rather than the collected run. Slicing
  // there keeps a stray `testTimeout` mention inside a comment or a helper from
  // being mistaken for the setting the runner reads.
  function testBlock(source: string): string {
    return source.slice(source.indexOf("test: {"), source.indexOf("coverage: {"));
  }

  const block = testBlock(configSource);
  const kitBlock = testBlock(kitConfigSource);

  it("declares testTimeout at all, so the key cannot be quietly dropped", () => {
    const declared = block.match(/(?:^|\n\s*)testTimeout:/) !== null;
    expect(
      declared,
      "the test block carries no `testTimeout:` — vitest is back on its 5s default",
    ).toBe(true);
  });

  it("holds the 20s house budget, not Vitest's 5s cliff and not a stricter bound", () => {
    const value = block.match(/testTimeout:\s*([0-9_]+)/)?.[1] ?? "";
    expect(value, "testTimeout found by the pin is missing or unreadable").not.toBe("");
    expect(Number(value.replaceAll("_", ""))).toBe(20_000);
  });

  it("keeps the kit mirror in step, since a hosted run executes its copy", () => {
    const kitValue = kitBlock.match(/testTimeout:\s*([0-9_]+)/)?.[1] ?? "";
    const value = block.match(/testTimeout:\s*([0-9_]+)/)?.[1] ?? "";
    expect(
      kitValue !== "" && value !== "" && kitValue === value,
      "the two configs name different budgets — a hosted run would time out where the dev box does not (or the reverse)",
    ).toBe(true);
  });
});
