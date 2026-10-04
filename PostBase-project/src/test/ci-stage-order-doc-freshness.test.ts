import { describe, it } from "vitest";

import { expectDocSelfHeld, expectHeld, readSource } from "./doc-freshness";

/**
 * `src/test/ci-stage-order.test.ts` defines `lastEnumeratedLine()`, which reads
 * `.freebuff/ci.mjs` and uses a `numberedHeader` regex —
 * `/^[<TAB> ]*<TAB>*<TAB>]+(\\d+)\\.[ <TAB>]+`([a-z-]+)`/` (where <TAB> is a literal
 * tab character, byte 0x09, not a `\t` escape) — to find the last numbered header
 * line in the stage enumeration. The helper's cases rely on that regex matching the
 * committed format: a whitespace shift in ci.mjs, a removed marker, or a rewritten
 * generated block that the regex no longer sees would let `lastEnumeratedLine()`
 * silently re-anchor on the wrong line, and the cases it feeds would pass against
 * a stale anchor.
 *
 * Held: the `numberedHeader` regex declaration (doc-self, so a reworded pattern
 * fails by name), the `<!-- stage-order:begin -->` / `<!-- stage-order:end -->`
 * markers both the test and ci.mjs quote, the `stage(s), in canonical order:`
 * generated-line format, and sample enumerated header lines (` *  1. `typecheck``
 * and ` * 11. `mutation``) so the format the regex scans for is still present in
 * the committed file.
 *
 * Deliberately outside the hold: the `lastEnumeratedLine()` runtime behavior itself
 * (that it returns the correct count and name is covered by the cases it feeds, not
 * by a textual needle here), the STAGE_TABLE declaration in
 * `.freebuff/gate-drift.mjs` (held by the ci-stage-order suite's table-reading
 * case), and the prose comments above the helper (paraphrased, not a literal line).
 */

const doc = readSource("src/test/ci-stage-order.test.ts");
const ci = readSource(".freebuff/ci.mjs");

// The `numberedHeader` regex uses literal TAB characters (byte 0x09) inside its
// character classes, not the `\t` escape.  Building the needle from `"\t"` (which
// TS processes to a real TAB) and `"\\"` (which TS processes to a single backslash)
// reproduces the exact bytes on disk in `ci-stage-order.test.ts`, so the doc-self
// hold fails if the regex is ever reworded.
const TAB = "\t";
const BACKSLASH = "\\";

/** Every doc needle the rules quote, so one lookup table answers "where did it go?". */
const DOC_NEEDLES: Record<string, string> = {
  numberedHeaderRegex:
    "const numberedHeader = /^[" + TAB + " ]*" + BACKSLASH + "*[" + TAB + " ]+(" + BACKSLASH + "d+)" + BACKSLASH + ".[ " + TAB + "]+`([a-z-]+)`/;",
  stageOrderBeginMarker: "<!-- stage-order:begin -->",
  stageOrderEndMarker: "<!-- stage-order:end -->",
  generatedLineFormat: "stage(s), in canonical order:",
};

describe("ci-stage-order.test.ts's lastEnumeratedLine scan against ci.mjs", () => {
  it("is quoted accurately: the patterns it names exist in the test itself", () => {
    // The rules below quote fragments of the test file; if an edit rewords a quoted
    // line without updating the rule, the failure must be the missing needle and
    // not a silent pass.  The shared doc-self hold makes every other rule
    // self-checking.
    expectDocSelfHeld(DOC_NEEDLES, doc, "ci-stage-order.test.ts");
  });

  it("names the numbered-header format ci.mjs still enumerates", () => {
    // The regex scans for ` * <n>. `<name>` ` lines — the first and last of which
    // must still be present so the helper's anchor is not a phantom.
    expectHeld(" *  1. `typecheck`", ci, "ci.mjs");
    expectHeld(" * 11. `mutation`", ci, "ci.mjs");
  });

  it("names the stage-order markers ci.mjs still carries", () => {
    // The begin/end markers the generator writes and `blockLine` reads — if either
    // is removed from ci.mjs, the generated-block check loses its anchor.
    expectHeld(DOC_NEEDLES.stageOrderBeginMarker, ci, "ci.mjs");
    expectHeld(DOC_NEEDLES.stageOrderEndMarker, ci, "ci.mjs");
  });

  it("names the generated-line format ci.mjs still prints", () => {
    // The `count stage(s), in canonical order:` line the generator writes inside
    // the markers — held verbatim so a reworded prefix is a finding, not a stale
    // assumption.
    expectHeld(DOC_NEEDLES.generatedLineFormat, ci, "ci.mjs");
  });
});
