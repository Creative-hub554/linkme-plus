/**
 * The shared shape for doc-freshness suites: the comparison between a review record
 * under `docs/` and the sources it names, held as tests.
 *
 * The pattern: a doc names functions, scripts, files, entities and labels, and a doc
 * that nothing compiled against ages silently — the first rename after review leaves
 * it lying, and no tool says so. A freshness suite draws needles out of the doc and
 * holds each against the artifact that should still say it, byte-exact. Every suite
 * keeps a doc-self case (every needle must exist in the doc, so a reworded paragraph
 * fails by name instead of a silently-passing rule claiming the doc is held) and
 * states its exclusions in its header — the prose paraphrases and aspirational
 * paragraphs that no literal line states, which are deliberately outside the hold.
 *
 * The assertion shape is chosen for its failure output: a plain `expect(source.includes
 * (needle)).toBe(true)` prints the boolean, not the needle's home; asserting an object
 * keyed by the source's name prints *which file* lost the needle, which is the whole
 * of the diagnosis when a suite holds several sources.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/** The checkout root, resolved once — needle sources are repo-relative paths. */
export const docFreshnessRoot = fileURLToPath(new URL("../..", import.meta.url));

/** A repo-relative file read whole from the checkout, byte for byte. */
export function readSource(path: string): string {
  return readFileSync(`${docFreshnessRoot}/${path}`, "utf8");
}

/**
 * The doc says it; the source must still say it back. The failure names the source
 * file and the needle together, so a red test is the diagnosis.
 */
export function expectHeld(
  needle: string,
  source: string,
  sourceName: string,
): void {
  expect({ [sourceName]: source.includes(needle), needle }).toEqual({
    [sourceName]: true,
    needle,
  });
}

/**
 * Every needle a suite quotes, held against the doc itself before anything else.
 * A needle that a doc edit has reworded fails here, naming the missing text, rather
 * than below, where its absence would read as a source drift the doc never made.
 * Pass the keys whose needles are *not* doc-side quotes (a source-only line the doc
 * paraphrases) — those are held in the source cases, not here.
 */
export function expectDocSelfHeld(
  needles: Record<string, string>,
  doc: string,
  docName: string,
  skip: readonly string[] = [],
): void {
  for (const key of Object.keys(needles).filter((k) => !skip.includes(k))) {
    expectHeld(needles[key], doc, docName);
  }
}
