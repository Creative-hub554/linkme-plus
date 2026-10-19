import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONVENTION_GUARDS_READING,
  QUEUE_SETTLED_READING,
  READINGS,
  RENDERED_LINKS_READING,
  SCRATCH_PATHS_READING,
  carriedReading,
  carriedReadings,
  metricOf,
  reading,
  readingPath,
} from "../../.freebuff/coverage-readings.mjs";

/**
 * A test for the registry of suite coverage readings — the one declaration of what a run
 * carries besides its verdict.
 *
 * A reading is a line a guard writes while the test stage runs (the rendered-links guard's
 * destinations, the frozen-scratch pass's roster of judged suites), which the runner reads
 * afterwards, carries in its `--json` report under an id, and the nightly summary prints. Each
 * one used to cost a sidecar name, an env seam, a reader, a payload field and its own cases in
 * three suites, all agreeing by convention; `.freebuff/coverage-readings.mjs` is the entry a
 * third guard adds instead, so what this file holds is exactly the contract an entry has to
 * satisfy — and the claim that the rest of the pipeline reads it rather than re-deriving it.
 *
 * The pipeline halves are asserted as bytes because that is what they are: the runner and the
 * renderer are held to read their readings from the registry, the two writer suites to build
 * their lines from the same entry they are read back through, and neither of the two files
 * that only *carry* a reading to spell a prefix of its own. That is the property the
 * refactor bought — one spelling, one entry, one payload shape — and it is invisible to a
 * case that only drives a payload, because a re-forked literal still works until the day it
 * does not.
 */

/** A source file reached from this one, so no path is ever resolved against the cwd. */
function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const runnerSource = readSource("../../.freebuff/ci.mjs");
const rendererSource = readSource("../../.freebuff/nightly-report.mjs");
const historySource = readSource("../../.freebuff/coverage-history.mjs");
const renderedLinksSource = readSource("./rendered-links.test.tsx");
const scratchPathsSource = readSource("./scratch-paths.test.ts");
const conventionGuardsSource = readSource("./convention-guards.test.ts");
// The queue's writer builds its line inside the live alarm case, beside the verdict sidecar it
// already writes — the one suite honest about publishing the reading only when the alarm is on.
const queueSettledSource = readSource("./verification-queue-alarm.test.ts");

/** The name the module exports an entry under, derived from the id the report keys it by. */
function exportedName(id: string): string {
  return `${id.toUpperCase().replace(/-/g, "_")}_READING`;
}

describe("the readings a run can carry", () => {
  it("declares each one once, in the vocabulary a third guard would join", () => {
    // Two entries may not share an id (the report would key one over the other), a sidecar (a
    // parallel worker would overwrite a sibling's line), an env seam (a test could not point
    // one at scratch without moving the other) or a prefix (the runner's carry would read one
    // guard's file as another's). The shapes are the conventions the pipeline depends on: an
    // id is what a consumer asks for, a dot-file beside the reporter's other sidecars, an
    // upper-snake variable name, and a prefix that reads as the marker it is.
    expect(READINGS.length, "no reading is declared at all").toBeGreaterThan(0);
    expect(READINGS).toEqual(
      expect.arrayContaining([RENDERED_LINKS_READING, SCRATCH_PATHS_READING]),
    );
    for (const entry of READINGS) {
      expect(entry.id, `${entry.id} is not a lower-kebab id`).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.file, `${entry.id}'s sidecar is not a dot-file`).toMatch(/^\.[a-z0-9-]+\.txt$/);
      expect(entry.env, `${entry.id}'s seam is not an upper-snake env name`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.prefix, `${entry.id}'s prefix does not read as a marker`).toMatch(/^[a-z][a-z0-9-]* coverage:$/);
    }
    for (const field of ["id", "file", "env", "prefix"] as const) {
      const values = READINGS.map((entry) => entry[field]);
      expect(new Set(values).size, `two readings share a ${field}`).toBe(values.length);
    }
  });

  it("answers one reading by id, and refuses an id it does not declare", () => {
    // The consumer the lookup exists for is the coverage history, which records one reading by
    // id. A rename on one side without the other is a programming error rather than a missing
    // measurement, so it throws at load with the declared ids in the message.
    expect(reading(RENDERED_LINKS_READING.id)).toBe(RENDERED_LINKS_READING);
    expect(() => reading("no-such-reading")).toThrow(/the declared ids are /);
    expect(() => reading("no-such-reading")).toThrow(RENDERED_LINKS_READING.id);
  });
});

describe("a reading's sidecar", () => {
  const base = join("tmp", "a-checkout");

  it("lives beside the reporter's sidecars, and answers the seam that points elsewhere", () => {
    const entry = RENDERED_LINKS_READING;

    expect(readingPath(entry, base, {})).toBe(join(base, ".freebuff", entry.file));
    // An empty seam is not a path — the same reading as no seam at all, which is what an
    // environment that sets the variable to nothing holds.
    expect(readingPath(entry, base, { [entry.env]: "" })).toBe(join(base, ".freebuff", entry.file));
    // A relative seam resolves against the checkout, exactly as the runner's other file seams
    // do, so a test can hand either a scratch directory or an absolute path.
    expect(readingPath(entry, base, { [entry.env]: "scratch/reading.txt" })).toBe(
      join(base, "scratch", "reading.txt"),
    );
    const absolute = resolve(base, "absolute-reading.txt");
    expect(readingPath(entry, base, { [entry.env]: absolute })).toBe(absolute);
  });
});

describe("the line a sidecar carries", () => {
  const entry = SCRATCH_PATHS_READING;
  const line = `${entry.prefix} 7 suite(s) keep a scratch directory and were judged — src/test/scratch.test.ts`;

  it("is the entry's own line once the writer's newline is trimmed", () => {
    expect(carriedReading(entry, `${line}\n`)).toBe(line);
    expect(carriedReading(entry, `\n  ${line}  \n`)).toBe(line);
  });

  it("is nothing at all for every other way a file can be wrong", () => {
    // One answer for all of them on purpose: what the callers are deciding is whether to
    // print a line, and "there is no reading here" is the only answer they can act on.
    for (const wrong of [
      "",
      "   \n",
      entry.prefix,
      `${entry.prefix}   `,
      "a scratch file at the reading's path",
      `note: ${line}`,
      `${RENDERED_LINKS_READING.prefix} chrome — the footer 14 (9 unique destinations)`,
      undefined as unknown as string,
      42 as unknown as string,
    ]) {
      expect(carriedReading(entry, wrong), `${JSON.stringify(wrong)} was carried as a reading`).toBeNull();
    }
  });
});

describe("the readings a report carries", () => {
  it("walks the registry in its own order, only for the readings that arrived", () => {
    const readings = Object.fromEntries(
      READINGS.map((entry) => [entry.id, `${entry.prefix} something measured`]),
    );
    // A key no entry declares is not a reading — an older report's field, a hand-written
    // fixture — and a reading an entry declares but the suite never wrote is the omission
    // every consumer prints nothing for.
    const carried = carriedReadings({
      readings: { ...readings, "retired-reading": "a reading nothing declares any more", [READINGS[0].id]: null },
    });

    expect(carried.map((row) => row.id)).toEqual(READINGS.slice(1).map((entry) => entry.id));
    for (const row of carried) expect(row.line).toBe(readings[row.id]);
  });

  it("answers nothing for a report with no readings map, or one that is not a map", () => {
    for (const payload of [
      undefined,
      null,
      {},
      { readings: null },
      { readings: [] as unknown as Record<string, string> },
      { readings: "readings" as unknown as Record<string, string> },
    ]) {
      expect(carriedReadings(payload)).toEqual([]);
    }
  });
});

describe("the number a reading is charted by", () => {
  it("declares one per entry: a pattern with a single capture, and the words it is labelled with", () => {
    // The trend charts one number per record, and a reading's line is a sentence with several
    // numbers in it, so *which* one is the measurement is a declaration rather than a guess: the
    // chart reads this pattern off the line instead of taking the first integer it finds — which
    // is how a footer's count of links would become a guard's metric. A stateful pattern would
    // read the same line differently on the second call, so it is refused here too.
    for (const entry of READINGS) {
      const metric = entry.metric as { pattern: RegExp; label: string } | undefined;
      expect(metric, `${entry.id} declares no charted number`).toBeDefined();
      expect(metric?.pattern, `${entry.id}'s metric is not a pattern`).toBeInstanceOf(RegExp);
      expect(metric?.pattern.flags, `${entry.id}'s metric keeps state between calls`).not.toContain("g");
      // The number of *capture groups*, counted the only way a pattern can be asked: an
      // alternation with the empty string always matches, and the array it answers with is the
      // whole match plus one entry per group. Counting parentheses would count the escaped ones
      // a pattern needs for the words around the number.
      const captures = new RegExp(`(?:${metric?.pattern.source})|`).exec("")?.length ?? 1;
      expect(captures - 1, `${entry.id}'s metric does not capture exactly one number`).toBe(1);
      expect(metric?.label, `${entry.id}'s metric carries no label`).not.toBe("");
    }
  });

  it("reads the number off a line, and answers nothing for a line it cannot read", () => {
    // The number is read off the line rather than recomputed, so a chart cannot disagree with the
    // prose it came from. Every way of being unreadable answers the same `null` — the caller's
    // only decision is whether to plot a point — and the chart *names* the record it cannot plot
    // rather than drawing a zero.
    expect(
      metricOf(
        RENDERED_LINKS_READING,
        `${RENDERED_LINKS_READING.prefix} chrome — the footer 14 (27 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
      ),
    ).toBe(27);
    expect(
      metricOf(SCRATCH_PATHS_READING, `${SCRATCH_PATHS_READING.prefix} 7 suite(s) keep a scratch directory and were judged — src/test/a.test.ts (200 test file(s) scanned)`),
    ).toBe(7);
    expect(
      metricOf(CONVENTION_GUARDS_READING, `${CONVENTION_GUARDS_READING.prefix} 13 guard(s) exercised on both of their shapes — mount`),
    ).toBe(13);

    for (const wrong of [
      // The wording moved out from under the pattern.
      `${RENDERED_LINKS_READING.prefix} chrome — the footer 14, no total at all`,
      // Another guard's sentence under this prefix: not this entry's reading at all.
      `${RENDERED_LINKS_READING.prefix} 7 suite(s) keep a scratch directory and were judged`,
      // A bare prefix, a stray file, and non-strings.
      RENDERED_LINKS_READING.prefix,
      "a scratch file at the reading's path",
      undefined as unknown as string,
      42 as unknown as string,
    ]) {
      expect(
        metricOf(RENDERED_LINKS_READING, wrong),
        `${JSON.stringify(wrong)} was charted as a measurement`,
      ).toBeNull();
    }
  });

  it("reads the lines the committed runbook already carries, so no chart is plotted against a stale metric", () => {
    // The runbook is where the readings accrue, so its recorded lines are the real input of the
    // trend — and the only way to know a metric still fits the sentences a guard writes is to try
    // it on the ones a run left behind. Every committed line resolves (and resolves as an
    // integer); an entry the file has no line for yet is not a failure, it simply has no history
    // to chart, which is the state of the two readings declared most recently.
    const lines = readSource("../../.freebuff/run.md")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => ({ line, entry: READINGS.find((entry) => carriedReading(entry, line) !== null) }))
      .filter((row) => row.entry !== undefined);

    expect(lines.length, "the committed runbook carries no reading line at all").toBeGreaterThan(0);
    for (const { line, entry } of lines) {
      const value = metricOf(entry, line);
      expect(value, `${entry?.id} carries a line its metric cannot read: ${line}`).not.toBeNull();
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
});

describe("the one spelling the pipeline keeps", () => {
  it("is what the writers, the runner, the renderer and the history all read", async () => {
    const registry = (await import("../../.freebuff/coverage-readings.mjs")) as Record<string, unknown>;

    // The module exports each entry under the name its id implies, so an entry is reachable
    // from the id a report keys it by rather than from a name someone typed.
    for (const entry of READINGS) {
      expect(registry[exportedName(entry.id)], `${exportedName(entry.id)} is not exported`).toBe(entry);
    }

    // The ends that only *carry* a reading spell no prefix: what they read, they read out of the
    // registry. The history is one of them — every declared reading is a column there, headed
    // with the entry's own words — so the table's vocabulary is derived rather than written down
    // a second time beside the declaration.
    for (const { name, source } of [
      { name: ".freebuff/ci.mjs", source: runnerSource },
      { name: ".freebuff/nightly-report.mjs", source: rendererSource },
      { name: ".freebuff/coverage-history.mjs", source: historySource },
    ]) {
      expect(source, `${name} does not read the registry`).toContain("coverage-readings.mjs");
      for (const entry of READINGS) {
        expect(source, `${name} spells ${entry.id}'s prefix instead of reading it`).not.toContain(
          entry.prefix,
        );
      }
    }

    // The writers build their lines from the entry their line is read back through, so a
    // changed file, seam or prefix moves both ends of the pipeline in one edit.
    const writers = [
      { name: "src/test/rendered-links.test.tsx", source: renderedLinksSource, entry: RENDERED_LINKS_READING },
      { name: "src/test/scratch-paths.test.ts", source: scratchPathsSource, entry: SCRATCH_PATHS_READING },
      {
        name: "src/test/convention-guards.test.ts",
        source: conventionGuardsSource,
        entry: CONVENTION_GUARDS_READING,
      },
      {
        name: "src/test/verification-queue-alarm.test.ts",
        source: queueSettledSource,
        entry: QUEUE_SETTLED_READING,
      },
    ];
    for (const { name, source, entry } of writers) {
      expect(source, `${name} builds its line from a literal, not from ${exportedName(entry.id)}`).toContain(
        exportedName(entry.id),
      );
    }
    // …and every declared reading has one: an entry nobody publishes would sit in every report
    // as a permanent `null`, which is exactly what a guard that never ran looks like. That is
    // the shape of the whole claim — a new reading costs the registry an entry and its suite a
    // close-out, and nothing else in the pipeline — so it is the pair, not either half, that
    // is held: the list above is every declared entry, and each of those files names its own.
    expect(writers.map((writer) => writer.entry.id).sort()).toEqual(
      READINGS.map((entry) => entry.id).sort(),
    );

    // …and the history's columns are the same walk: the registry itself for the column set, and
    // the entry's prefix for the words the header carries, so a fourth reading is a column with
    // no edit to the history at all.
    expect(historySource).toContain("READINGS");
    expect(historySource).toContain("columnTitle");
  });

  it("leaves every reading's sidecar ignored by the one rule, so a run cannot dirty the tree", () => {
    // The sidecars are per-run output the runner clears at each attempt, so they are never
    // checked in — and this is the last place a per-reading edit used to be needed: one rule
    // covers every reading, because every reading's sidecar is named after its id. So the
    // convention is what is held here, and it is held both ways: each declared sidecar obeys
    // `.<id>-coverage.txt`, and `.gitignore` carries exactly the rule that covers that shape.
    // A reading added to the registry is then ignored without this list being touched, which
    // is the difference between a registry and a list of files that happen to agree.
    const ignore = readSource("../../.gitignore");

    expect(ignore, "no rule covers a reading's sidecar").toContain(".freebuff/.*-coverage.txt");
    for (const entry of READINGS) {
      expect(entry.file, `${entry.id}'s sidecar breaks the .<id>-coverage.txt convention`).toBe(
        `.${entry.id}-coverage.txt`,
      );
    }
  });
});
