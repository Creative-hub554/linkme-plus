import { describe, expect, it } from "vitest";
import { settlesWithoutWait } from "@/test/convention-guards";
import { readTestSources } from "@/test/source-scan";

/**
 * A guard for the mounted DOM tests: a `settle()` is a sleep, and an assertion
 * made straight after one is an assertion about the clock.
 *
 * `settle(ms)` waits for nothing in particular, so `await ui.settle(20); expect(...)`
 * passes only while whatever it is waiting for takes under twenty milliseconds —
 * and goes on passing until the machine is busy or a request is chained behind
 * another, at which point it fails as a flake in a test that has not changed.
 * `waitFor` is the fix: it returns the moment the awaited thing is there and
 * says what it was waiting for when it never arrives. Every DOM test was
 * converted to it once already; this is what keeps the pattern from creeping
 * back in a new test, in the same spirit as the runbook and skill-index drift
 * tests — the convention is checked by a test rather than trusted to review.
 *
 * The one legitimate sleep is a claim about an *absence* ("nothing was
 * published", "nothing was adopted"): there is no arrival to wait for, so a
 * marker — `// settle-on-purpose:` on the `settle` line — opts that line out.
 * The `settle-then-assert` shape is otherwise the failure.
 *
 * The scan reads the shared tokenizer, so "the next thing" is the next
 * *statement* rather than the next line: a comment or blank line between the
 * sleep and the assertion no longer hides the pair, a `settle` whose call spans
 * several lines is still read as one statement, and a same-line
 * `settle(…); expect(…)` is caught rather than missed. The test files come from
 * `@/test/source-scan`, shared with the other convention guards so they all
 * scan exactly the same set.
 */
const testSources = readTestSources();

/** This file names `settle(` only in strings and its own helper; it is not scanned. */
const SELF = "dom-test-waits.test.ts";

/** Only a test that mounts a document can call `settle()`. */
const domTests = Object.entries(testSources).filter(
  ([path, source]) => source.includes("settle(") && !path.includes(SELF),
);

/*
 * The detector this guard runs lives in `@/test/convention-guards`, alongside
 * the other convention guards, so one meta-test can drive them all. This file
 * keeps the assertions: which files are scanned and what the rule means.
 */

describe("the mounted DOM tests", () => {
  it("are found, so this guard is not silently scanning nothing", () => {
    expect(Object.keys(testSources).length, "no test sources matched the glob").toBeGreaterThan(20);
    // Checked against `mount`, not against `settle`: if every legitimate sleep
    // were removed the rule would have nothing to flag, and that is a pass — the
    // coverage to assert is that the glob reached the mounted tests at all.
    const mounted = Object.values(testSources).filter((source) => source.includes("@/test/render"));
    expect(mounted.length, "the glob did not reach the mounted DOM tests").toBeGreaterThan(3);
  });

  it("never assert straight after a settle() instead of waiting", () => {
    const offenders = domTests.flatMap(([path, source]) =>
      settlesWithoutWait(source).map((line) => `${path}:${line}`),
    );

    expect(
      offenders,
      "These tests sleep with `settle()` and then assert, which passes only while the awaited " +
        "thing arrives in under the sleep. Wait for it with `waitFor` instead — or, when the claim " +
        "is an absence rather than an arrival, mark the call with `// settle-on-purpose:`.",
    ).toEqual([]);
  });

  it("fires on the shape it exists to catch", () => {
    // A guard only ever run against a clean tree is a guard never shown to fire.
    // These are the shapes, stated once, with the plain `settle`→`expect` pair
    // as the one that must be caught and the wait (or the marker) as the fix.
    const settleThenAssert = [
      "test('x', async () => {",
      "  await ui.settle(20);",
      "  expect(ui.tooltips()).toEqual(['Bookmark post']);",
      "});",
    ].join("\n");
    expect(settlesWithoutWait(settleThenAssert)).toEqual([2]);

    const settleThenCommentThenAssert = [
      "  await ui.settle(30);",
      "  // Commented, but the sleep is still why this passes.",
      "  expect(accentOf(ui)).toBe('amber');",
    ].join("\n");
    expect(settlesWithoutWait(settleThenCommentThenAssert)).toEqual([1]);

    // The same-line pair was invisible to the old line-based scan; the token
    // walk reads the statement boundary and catches it.
    const settleThenAssertOnOneLine =
      "  await ui.settle(20); expect(accentOf(ui)).toBe('amber');";
    expect(settlesWithoutWait(settleThenAssertOnOneLine)).toEqual([1]);

    const settleThenWait = [
      "  await ui.settle(20);",
      "  await ui.waitFor(() => ui.tooltips().length > 0, { description: 'the tooltip to open' });",
      "  expect(ui.tooltips()).toEqual(['Bookmark post']);",
    ].join("\n");
    expect(settlesWithoutWait(settleThenWait)).toEqual([]);

    const marked = [
      "  await ui.settle(30); // settle-on-purpose: an absence, not an arrival",
      "  expect(accentOf(ui)).toBe('amber');",
    ].join("\n");
    expect(settlesWithoutWait(marked)).toEqual([]);

    // A sleep whose call spans lines is still one statement, so the assertion
    // that follows it is caught all the same.
    const multilineSettle = [
      "  await ui.settle(",
      "    30,",
      "  );",
      "  expect(accentOf(ui)).toBe('amber');",
    ].join("\n");
    expect(settlesWithoutWait(multilineSettle)).toEqual([1]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * One substitution in a real file's own text, which must land exactly once.
 *
 * This case patches a file the scan actually reads rather than a shape written for the
 * test, so the anchor is what keeps it honest: the sleep moving, or its marker changing,
 * fails the case instead of leaving a patch that changed nothing and a detector quietly
 * handed a clean source. The mutation sweep's own entries hold themselves to the same
 * rule, for the same reason.
 */
function replaceOnce(source: string, find: string, replace: string): string {
  expect(
    source.split(find).length - 1,
    `the file no longer contains this anchor exactly once: ${find}`,
  ).toBe(1);
  return source.replace(find, replace);
}

/** The real file a case patches, keyed the way the source scan keys it. */
function scannedSource(path: string): string {
  const source = testSources[path];
  expect(source, `${path} was not read by the source scan`).toBeTruthy();
  return source ?? "";
}

/**
 * The sleep, brought back in the one real file this repo keeps one in.
 *
 * The fixture above states the sleep-then-assert in the abstract; this states the shape
 * *this repo* would write, patched into the file the guard actually scans and handed to
 * the same detector. The marker is the whole reason `theme-sync.test.tsx` may sleep — its
 * claim is an absence, so there is no arrival to wait for — which makes deleting the
 * marker, in the file itself, exactly the reintroduction. A rename or a refactor that
 * moved the sleep would fail the case rather than leaving a patch that changed nothing.
 */
describe("the sleep, reintroduced in the real file", () => {
  it("catches the marker removed from the one sleep the repo keeps", () => {
    const path = "../components/providers/theme-sync.test.tsx";
    const source = scannedSource(path);
    // The premise, asserted against the file rather than assumed: the marked sleep sits in
    // this file and the guard leaves it alone, which is what makes removing the marker the
    // reintroduction rather than a change to some other file.
    expect(source, `${path} no longer keeps the marked sleep`).toContain(
      "await ui.settle(30); // settle-on-purpose: an absence, not an arrival",
    );
    expect(settlesWithoutWait(source), `${path} already trips the guard`).toEqual([]);

    // The reintroduction is one deletion: the marker that opted the line out, gone, so the
    // sleep the repo already writes is read as the sleep-then-assert it would have been.
    const reintroduced = replaceOnce(
      source,
      " // settle-on-purpose: an absence, not an arrival",
      "",
    );

    const flagged = settlesWithoutWait(reintroduced);
    expect(flagged, `${path}: the sleep this file writes was not seen`).toHaveLength(1);
    // …and the line it names is the line the sleep is on, read back out of the patched
    // source rather than taken on trust from the detector's own report.
    expect(reintroduced.split("\n")[flagged[0] - 1]).toContain("await ui.settle(30);");
  });
});
