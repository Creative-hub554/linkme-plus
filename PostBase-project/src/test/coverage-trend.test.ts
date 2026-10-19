import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeScratchDir, removeScratchDir } from "./scratch";
// The registry is the whole declaration of the readings — and of the numbers they are charted
// by — so this suite builds its records out of the entries rather than spelling a guard's
// vocabulary: a reading added there is charted by these cases without a line being added, and a
// metric that stops reading its own line fails here rather than on a page nobody looks at.
import {
  CONVENTION_GUARDS_READING,
  READINGS,
  RENDERED_LINKS_READING,
  SCRATCH_PATHS_READING,
  metricOf,
} from "../../.freebuff/coverage-readings.mjs";
// The table's path as the module that writes it spells it, held against the trend's re-export: the
// two ends of one path, so the CLI's default cannot drift from the file the nightly job appends to.
import { HISTORY_FILE } from "../../.freebuff/coverage-history.mjs";
import {
  HISTORY_FILE as TREND_HISTORY_FILE,
  LOW_WATER_FILE,
  TREND_LIMIT,
  coverageOverTime,
  historyRecords,
  mergeRecords,
  readLowWater,
  readingMovement,
  readingSeries,
  renderTrendReport,
  runbookRecords,
  sparkline,
  trendReport,
} from "../../.freebuff/coverage-trend.mjs";

/**
 * A test for the coverage trend the nightly page charts.
 *
 * The surface where a full gate's readings accrue is the runbook's dated records — one record per
 * run (`.freebuff/run.md`) — and the nightly job's table (`.freebuff/coverage-history.md`) is the
 * other, one dated row per night. `.freebuff/coverage-trend.mjs` reads both, matches them up by
 * night, and turns them into a series per guard. Three things about it are contracts rather than
 * details, and each is a case here: a record is the bullet the *runner* wrote (not a dated
 * paragraph that quotes a reading) or the row the *writer* rendered, a guard's chart holds only
 * the records that carried its reading (a quiet record is an omission, never a zero), and a line
 * whose number the entry's metric cannot read is **named** rather than dropped — because a
 * silently shorter series is exactly what a record that was never written looks like.
 *
 * The same records also answer a question — `npm run coverage:trend`, whose command half is
 * exercised here too: each reading's newest record held against the low-water mark of the nights
 * before it, a fall below that floor failing the command and everything else (a rise, a level, a
 * reading with no history, a line the metric cannot read) reported rather than red.
 *
 * The committed runbook is the integration case at the end: the machinery is exercised against
 * the tree's own readings, so a marker or a window that stopped matching the records the runner
 * appends would fail here rather than quietly charting nothing.
 */

const runbookPath = fileURLToPath(new URL("../../.freebuff/run.md", import.meta.url));
const trendModule = fileURLToPath(new URL("../../.freebuff/coverage-trend.mjs", import.meta.url));
// The committed floors the page draws under each series, and the path the module spells: the chart
// is held to the file the command is held to, so the two cannot be reading different records' levels.
const lowWaterPath = fileURLToPath(new URL(`../../${LOW_WATER_FILE}`, import.meta.url));
// …and the committed table, so the integration case charts the two surfaces the page charts.
const historyPath = fileURLToPath(new URL(`../../${TREND_HISTORY_FILE}`, import.meta.url));

/** A reading's line as its writer builds it: the entry's own prefix, then what it audited. */
const line = (entry: { prefix: string }, body: string): string => `${entry.prefix} ${body}`;

/**
 * One record, as a whole-gate close writes it: a dated head announcing the verdict, then one
 * indented line per reading that run carried. The head is the runner's own shape, which is what
 * makes the bullet a record rather than a paragraph about one.
 */
function record(date: string, readingLines: string[] = []): string {
  const head =
    `- **${date} — ci verdict: 5 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, ` +
    "0 excluded (5 selected); all stages passed.** typecheck PASS.";
  return [head, ...readingLines.map((carried) => `  ${carried}.`)].join("\n");
}

/**
 * The records the module answers with, typed for reading: a date and the line each declared
 * reading id carried under it. The walk itself is the module's; this only says what its answer
 * is, so a case can index `readings` by the id it is asking about.
 */
function recordsOf(text: string): { date: string; readings: Record<string, string> }[] {
  return runbookRecords(text) as { date: string; readings: Record<string, string> }[];
}

/**
 * One nightly history row, as `.freebuff/coverage-history.mjs` renders it: the date, then one cell
 * per declared reading in the registry's own order, each holding that reading's line with the
 * pipes its own `" | "` join uses escaped — which is exactly what a reader has to undo.
 */
function historyRow(date: string, lines: Partial<Record<string, string>> = {}): string {
  const cells = READINGS.map((entry) => (lines[entry.id] ?? "").replace(/\|/g, "\\|"));
  return `| ${date} | ${cells.join(" | ")} |`;
}

/** A table holding those rows under the two rows the writer scaffolds: the header and alignment. */
function historyTable(rows: string[]): string {
  return [
    "# Coverage history",
    "",
    `| Date | ${READINGS.map((entry) => entry.id).join(" | ")} |`,
    `| :-- |${READINGS.map(() => " :-- |").join("")}`,
    ...rows,
    "",
  ].join("\n");
}

/** Bodies the guards are known to write, shaped so the number a metric reads is unambiguous. */
const bodies = {
  // Several numbers, and the declared one is neither the first nor the last: a chart that took
  // the first integer it found would plot the footer's count, which is what the registry's own
  // metric exists to prevent.
  renderedLinks: (destinations: number) =>
    `chrome — the footer 14 (${destinations} unique destinations) | data — 28 page mounts, ` +
    "18 unique destinations",
  scratchPaths: (suites: number) =>
    `${suites} suite(s) keep a scratch directory and were judged — src/test/a.test.ts ` +
    "(200 test file(s) scanned)",
  conventionGuards: (guards: number) =>
    `${guards} guard(s) exercised on both of their shapes — mount, settle`,
};

describe("the runbook's dated records", () => {
  it("reads the bullets the runner wrote, and only the lines that are readings", () => {
    const text = [
      "- **2026-10-01 — a paragraph about the gate, quoting `rendered-links coverage: 99 chrome`.**",
      "",
      line(RENDERED_LINKS_READING, bodies.renderedLinks(99)),
      "",
      record("2026-10-02", [
        line(RENDERED_LINKS_READING, bodies.renderedLinks(27)),
        "Suspects: src/a.ts (changed).",
      ]),
      "not indented, so the bullet ended",
      "",
      "- **2026-10-02 — attempt 9, a hand record of the same night.**",
    ].join("\n");

    const records = recordsOf(text);

    // One record: the dated *prose* bullet above is not one (its head does not say `ci verdict`),
    // and the indented reading line under it belongs to no record — a paragraph quoting a reading
    // is somebody writing about a run, not a run's own record of one.
    expect(records).toEqual([
      {
        date: "2026-10-02",
        // The line as the bullet holds it — the writer terminates it with a full stop, and the
        // record keeps the file's own bytes rather than normalizing them; the metric reads a
        // line either way.
        readings: {
          [RENDERED_LINKS_READING.id]: `${line(RENDERED_LINKS_READING, bodies.renderedLinks(27))}.`,
        },
      },
    ]);
  });

  it("carries nothing for a runbook with no record at all", () => {
    expect(recordsOf("")).toEqual([]);
    expect(runbookRecords(undefined as unknown as string)).toEqual([]);
    expect(coverageOverTime("")).toEqual([]);
    expect(coverageOverTime("# Coverage history\n\n| Date | x |\n| :-- | :-- |\n")).toEqual([]);
  });
});

describe("one guard's series", () => {
  const records = recordsOf(
    [
      record("2026-10-01", [line(RENDERED_LINKS_READING, bodies.renderedLinks(1))]),
      record("2026-10-02", [line(SCRATCH_PATHS_READING, bodies.scratchPaths(7))]),
      record("2026-10-03", [line(RENDERED_LINKS_READING, bodies.renderedLinks(3))]),
    ].join("\n\n"),
  );

  it("plots the number its entry declares, not the first integer in the line", () => {
    expect(metricOf(RENDERED_LINKS_READING, line(RENDERED_LINKS_READING, bodies.renderedLinks(27)))).toBe(27);
    expect(metricOf(SCRATCH_PATHS_READING, line(SCRATCH_PATHS_READING, bodies.scratchPaths(7)))).toBe(7);
    expect(metricOf(CONVENTION_GUARDS_READING, line(CONVENTION_GUARDS_READING, bodies.conventionGuards(13)))).toBe(13);
  });

  it("holds only the records that carried the reading — an omission, never a zero", () => {
    const series = readingSeries(RENDERED_LINKS_READING, records);

    // The middle record carried the other guard's reading, so it is not a point of this one: a
    // zero there would be a fabricated measurement of a night nothing was measured on.
    expect(series.points).toEqual([
      { date: "2026-10-01", value: 1 },
      { date: "2026-10-03", value: 3 },
    ]);
    expect(series.values).toEqual([1, 3]);
    expect(series.unreadable).toEqual([]);
    expect(series.records).toBe(2);
    expect(series.dropped).toBe(0);
    expect(series.label).toBe(RENDERED_LINKS_READING.metric.label);
  });

  it("names a record whose line its metric cannot read, rather than plotting one", () => {
    // A line the guard's own prefix carries but the metric cannot read: the wording moved, or a
    // hand-written record quoted something else. It is a record that says nothing chartable, and
    // what a reader needs is *which* one — a chart that skipped it would show a shorter series,
    // indistinguishable from a night that never recorded a reading.
    const moved = recordsOf(
      [
        record("2026-10-01", [`rendered-links coverage: chrome — the footer 14, no total at all`]),
        record("2026-10-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(27))]),
      ].join("\n\n"),
    );
    const series = readingSeries(RENDERED_LINKS_READING, moved);

    expect(series.values).toEqual([27]);
    expect(series.unreadable).toEqual(["2026-10-01"]);
    expect(series.points).toHaveLength(2);
    const block = coverageOverTime(
      [
        record("2026-10-01", ["rendered-links coverage: chrome — the footer 14, no total at all"]),
        record("2026-10-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(27))]),
      ].join("\n\n"),
    ).join("\n");
    expect(block).toContain("1 record(s) whose line this metric cannot read (2026-10-01)");
  });

  it("charts the most recent window and says how many records fell before it", () => {
    const many = recordsOf(
      Array.from({ length: 25 }, (_, index) =>
        record(`2026-09-${String(index + 1).padStart(2, "0")}`, [
          line(CONVENTION_GUARDS_READING, bodies.conventionGuards(index + 1)),
        ]),
      ).join("\n\n"),
    );
    const series = readingSeries(CONVENTION_GUARDS_READING, many);

    expect(series.records).toBe(25);
    expect(series.points).toHaveLength(TREND_LIMIT);
    expect(series.dropped).toBe(25 - TREND_LIMIT);
    expect(series.values[0]).toBe(6);
    expect(series.values[series.values.length - 1]).toBe(25);
    expect(series.from).toBe("2026-09-06");
    expect(series.to).toBe("2026-09-25");
  });
});

describe("the series drawn as bars", () => {
  it("scales to the series' own range, and draws a spreadless one flat", () => {
    expect(sparkline([])).toBe("");
    // One value, and a series that never moved: no shape to show, so the bars are flat at the
    // middle of the scale rather than reading as a spike or a trough.
    expect(sparkline([5])).toBe("▄");
    expect(sparkline([5, 5, 5])).toBe("▄▄▄");
    // Rising and falling over the same range are mirror images.
    expect(sparkline([1, 2, 3])).toBe("▁▅█");
    expect(sparkline([3, 2, 1])).toBe("█▅▁");
  });
});

describe("the page's coverage-over-time block", () => {
  const twoNights = [
    record("2026-10-01", [
      line(RENDERED_LINKS_READING, bodies.renderedLinks(25)),
      line(SCRATCH_PATHS_READING, bodies.scratchPaths(7)),
    ]),
    record("2026-10-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(28))]),
  ].join("\n\n");

  it("is one row per reading the runbook recorded, in the registry's order", () => {
    const block = coverageOverTime(twoNights).join("\n");

    expect(block.startsWith("### Coverage over time")).toBe(true);
    // The declaration's order, which is also the order of the page's own `### Coverage` section
    // and of the history table's columns: the same guard reads in the same place wherever it is
    // looked at. A reading the runbook never recorded has no row — the block does not invent one.
    expect(block).toContain(
      "- **rendered-links** `▁█` — 28 chrome unique destinations, up 3 from 25 (range 25–28) " +
        "over 2 record(s) (2026-10-01 → 2026-10-02)",
    );
    expect(block).toContain(
      "- **scratch-paths** `▄` — 7 judged suites, no change from 7 (range 7–7) " +
        "over 1 record(s) (2026-10-01)",
    );
    expect(block.indexOf("**rendered-links**")).toBeLessThan(block.indexOf("**scratch-paths**"));
    expect(block).not.toContain(`**${CONVENTION_GUARDS_READING.id}**`);
  });

  it("says which window it charted when the runbook holds more records than it plots", () => {
    const long = Array.from({ length: TREND_LIMIT + 5 }, (_, index) =>
      record(`2026-08-${String(index + 1).padStart(2, "0")}`, [
        line(SCRATCH_PATHS_READING, bodies.scratchPaths(index + 1)),
      ]),
    ).join("\n\n");
    const block = coverageOverTime(long).join("\n");

    expect(block).toContain(`the last ${TREND_LIMIT} of ${TREND_LIMIT + 5} record(s)`);
    expect(block).toContain("(2026-08-06 → 2026-08-25)");
  });

  it("is charted from the committed runbook's own readings", () => {
    // The integration case: the tree's real runbook, through the same walk the page uses. The
    // counts move whenever a full gate records another run, so what is held here is the
    // agreement rather than a number: every row is a declared reading the file really carries,
    // and its latest value is the metric read off the file's newest such line.
    const text = readFileSync(runbookPath, "utf8");
    const records = recordsOf(text);
    const block = coverageOverTime(text).join("\n");

    const charted = READINGS.filter((entry) =>
      records.some((record) => record.readings[entry.id] !== undefined),
    );
    expect(charted.length, "the committed runbook records no reading at all").toBeGreaterThan(0);
    for (const entry of charted) {
      expect(block, `${entry.id} has records in the runbook and no row on the page`).toContain(
        `- **${entry.id}**`,
      );
    }
    for (const entry of READINGS.filter((candidate) => !charted.includes(candidate))) {
      expect(block, `${entry.id} has no record and should not be charted`).not.toContain(
        `- **${entry.id}**`,
      );
    }

    const entry = charted[0];
    const carried = records
      .map((record) => record.readings[entry.id])
      .filter((carried) => carried !== undefined);
    const latest = metricOf(entry, carried[carried.length - 1]);
    expect(block).toContain(`${latest} ${entry.metric.label}`);
    expect(block).toContain(`of ${carried.length} record(s)`);
  });
});

describe("the floor drawn beside a series", () => {
  /** The block for a runbook built from those values, with the floors a committed file would name. */
  const chart = (
    values: (number | string)[],
    lowWater: Record<string, { value: number; since: string }> = {},
  ) => coverageOverTime(linksRunbook(values), { lowWater }).join("\n");

  it("draws the committed floor beneath the series, on the series' own scale", () => {
    // One scale for both lines, which is the point of drawing the floor at all: the series' low end
    // is the scale's bottom, so a floor that *is* that level gets the bottom bar and a reader can
    // see the newest record clearing it rather than only that the bars moved.
    const block = chart([27, 28, 25], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-20" },
    });

    expect(block).toContain(
      "- **rendered-links** `▆█▁` — 25 chrome unique destinations, down 2 from 27 (range 25–28) " +
        "over 3 record(s) (2026-09-01 → 2026-09-03)",
    );
    // The same bar, once per plotted record, so the two lines read as columns of one chart; the
    // level, the night it settled and where the newest record sits against it are in the words,
    // because a bar normalized to a range cannot carry a number.
    expect(block).toContain(
      "  `▁▁▁` floor 25 (recorded 2026-08-20) — the newest 25 is level with it",
    );
  });

  it("counts the plotted nights that fell under the floor, which is what the floor is for", () => {
    // A floor inside the window: the chart says how many of the nights it is showing are below the
    // level a fall is measured from — the count a reader would otherwise have to work out from the
    // bars and the range — and it says it as part of the same row rather than as a second verdict.
    const block = chart([25, 28, 24, 26], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-20" },
    });

    expect(block).toContain("floor 25 (recorded 2026-08-20)");
    expect(block).toContain("the newest 26 is 1 above it");
    expect(block).toContain("1 of these 4 record(s) below it");
  });

  it("draws a floor outside the window at the end of the scale, never off the chart", () => {
    // Above every plotted record and below every one: both are drawn at the end of the series' own
    // scale — a floor is not a fourth bar and stretching the scale to reach it would flatten the
    // movement the chart is about — and the words carry the distance the bars cannot.
    const above = chart([21, 22, 23], {
      [RENDERED_LINKS_READING.id]: { value: 40, since: "2026-08-01" },
    });
    expect(above).toContain("  `███` floor 40 (recorded 2026-08-01) — the newest 23 is 17 below it; 3 of these 3 record(s) below it");

    const below = chart([27, 28], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" },
    });
    expect(below).toContain("  `▁▁` floor 25 (recorded 2026-08-01) — the newest 28 is 3 above it");
    // Nothing fell under it, so nothing is counted: an empty clause would read as an omission of
    // the count rather than as the fact that every plotted night cleared the floor.
    expect(below).not.toContain("of these 2 record(s) below it");
  });

  it("says a reading has no committed floor rather than drawing one it does not have", () => {
    // The floors are a committed decision — the level the trend fails on — so a caller who hands in
    // none gets the rows *without* them, said out loud, rather than a floor this renderer derived:
    // a chart drawing an invented level is a chart telling a reader a level was agreed to.
    const block = chart([27, 28]);

    expect(block).toContain(
      "  no committed floor — this reading is held against the nights at hand rather than against a " +
        "recorded level",
    );
    expect(block).not.toContain("floor 25");
    // …and the block's prose names the file the floors would have come from, so a reader knows which
    // one is missing rather than only that the second line of every row is not a floor.
    expect(block).toContain("`.freebuff/coverage-low-water.json`");
  });

  it("gives a reading with nothing readable the defect line alone, with no floor to draw against", () => {
    // No number in the window means no scale: the row's job there is to name the records whose
    // lines the metric cannot read, and a floor drawn under it would be a bar with nothing beside
    // it — the missing thing is the metric, not the level.
    const stale = `${RENDERED_LINKS_READING.prefix} chrome — nothing on this line can be read`;
    const block = chart([stale, stale], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-20" },
    });

    expect(block).toContain("- **rendered-links** — nothing to plot: 2 record(s) carry a line this entry's metric cannot read (2026-09-01, 2026-09-02)");
    expect(block).not.toContain("floor 25");
  });

  it("draws the committed floors on the committed records' own chart", () => {
    // The integration case for this line of the block: the tree's real floors beside the tree's real
    // records, read the way the nightly page reads them — both surfaces, one merge. A file the page
    // no longer agrees with (a reading re-keyed, a floor recorded for a guard whose records went) is
    // a nightly page nobody diffed, which is what makes this the check rather than a fixture.
    const floors = readLowWater(readFileSync(lowWaterPath, "utf8"));
    const rows = coverageOverTime(readFileSync(runbookPath, "utf8"), {
      history: readFileSync(historyPath, "utf8"),
      lowWater: floors,
    });

    const named = Object.entries(floors);
    expect(named.length, "the committed low-water records no floor at all").toBeGreaterThan(0);
    for (const [id, floor] of named) {
      const at = rows.findIndex((row) => row.startsWith(`- **${id}**`));
      expect(at, `${id} has a committed floor and no row on the page`).toBeGreaterThanOrEqual(0);
      expect(
        rows[at + 1],
        `${id} is charted without the level the committed file records for it`,
      ).toContain(`floor ${floor.value} (recorded ${floor.since})`);
    }
  });
});

/** A runbook of one rendered-links record per value, dated consecutively from 2026-09-01. */
function linksRunbook(values: (number | string)[]): string {
  return values
    .map((value, index) =>
      record(`2026-09-${String(index + 1).padStart(2, "0")}`, [
        typeof value === "number" ? line(RENDERED_LINKS_READING, bodies.renderedLinks(value)) : value,
      ]),
    )
    .join("\n\n");
}

describe("the nightly history table, read beside the runbook", () => {
  it("names the table the history writer appends to", () => {
    // One spelling of the path, in the module that writes the file: the trend re-exports it, so
    // the renderer, the CLI and the trend itself hold one default between them rather than two
    // literals kept in step by hand.
    expect(TREND_HISTORY_FILE).toBe(HISTORY_FILE);
    expect(TREND_HISTORY_FILE).toBe(".freebuff/coverage-history.md");
  });

  it("reads the writer's rows back into records, taking every cell at its own prefix", () => {
    const table = historyTable([
      historyRow("2026-10-01", {
        [SCRATCH_PATHS_READING.id]: line(SCRATCH_PATHS_READING, bodies.scratchPaths(7)),
      }),
      historyRow("2026-10-02", {
        [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(27)),
      }),
    ]);

    // The line comes back as the guard wrote it: the writer escapes the pipes its own `" | "`
    // join uses and the reader undoes exactly that, so a reading whose middle is a pipe is one
    // cell and its declared number still reads.
    expect(historyRecords(table)).toEqual([
      {
        date: "2026-10-01",
        readings: { [SCRATCH_PATHS_READING.id]: line(SCRATCH_PATHS_READING, bodies.scratchPaths(7)) },
      },
      {
        date: "2026-10-02",
        readings: {
          [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(27)),
        },
      },
    ]);
    expect(readingSeries(RENDERED_LINKS_READING, historyRecords(table)).values).toEqual([27]);

    // A row's cells are read by the line in each of them rather than by the column it sits in, so
    // a hand that moved the columns is not a reading filed under another guard's name.
    const escaped = (text: string) => text.replace(/\|/g, "\\|");
    const swapped = historyTable([
      [
        "| 2026-10-03 ",
        `| ${escaped(line(CONVENTION_GUARDS_READING, bodies.conventionGuards(9)))} `,
        `| ${escaped(line(RENDERED_LINKS_READING, bodies.renderedLinks(28)))} `,
        `| ${escaped(line(SCRATCH_PATHS_READING, bodies.scratchPaths(8)))} |`,
      ].join(""),
    ]);
    expect(historyRecords(swapped)).toEqual([
      {
        date: "2026-10-03",
        readings: {
          [CONVENTION_GUARDS_READING.id]: line(
            CONVENTION_GUARDS_READING,
            bodies.conventionGuards(9),
          ),
          [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(28)),
          [SCRATCH_PATHS_READING.id]: line(SCRATCH_PATHS_READING, bodies.scratchPaths(8)),
        },
      },
    ]);

    // …and a cell that is not a declared reading, an empty one and a row narrower than the table
    // each carry nothing rather than a point: the omission a record without a reading makes. A
    // table with no rows — the scaffold a fresh checkout carries — and a file that is not there
    // at all are no records either.
    const ragged = historyTable([
      ["| 2026-10-04 ", "| chrome — the footer 14, no guard's words at all ", "| ", "|"].join(""),
      "| 2026-10-05 |",
    ]);
    expect(historyRecords(ragged).map((record) => Object.keys(record.readings))).toEqual([[], []]);
    expect(historyRecords(historyTable([]))).toEqual([]);
    expect(historyRecords("")).toEqual([]);
  });

  it("makes one record per night out of the two surfaces, the runbook's line winning", () => {
    const runbook = recordsOf(
      [
        record("2026-10-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(25))]),
        record("2026-10-04", [line(RENDERED_LINKS_READING, bodies.renderedLinks(26))]),
      ].join("\n\n"),
    );
    const table = historyRecords(
      historyTable([
        // One night is one record: the table's different number for a night the runbook recorded
        // does not become a second step, and the runbook's own line is the one that stands.
        historyRow("2026-10-02", {
          [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(99)),
        }),
        // A night the runbook never recorded, dated before the runbook's tail: it lands where its
        // date says rather than being appended after the records that follow it, because the
        // window is a stretch of nights.
        historyRow("2026-10-03", {
          [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(30)),
        }),
      ]),
    );

    const merged = mergeRecords(runbook, table);

    expect(merged.map((mergedRecord) => mergedRecord.date)).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(
      merged.map((mergedRecord) =>
        metricOf(RENDERED_LINKS_READING, mergedRecord.readings[RENDERED_LINKS_READING.id]),
      ),
    ).toEqual([25, 30, 26]);

    // A reading the runbook's record of a night did not carry is supplied by the table's cell for
    // it — the same night, not a second record: that is what lengthens a *reading's* series rather
    // than the record list.
    const filled = mergeRecords(
      recordsOf(record("2026-10-02", [line(SCRATCH_PATHS_READING, bodies.scratchPaths(7))])),
      historyRecords(
        historyTable([
          historyRow("2026-10-02", {
            [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(25)),
          }),
        ]),
      ),
    );
    expect(filled).toHaveLength(1);
    expect(Object.keys(filled[0].readings).sort()).toEqual(
      [RENDERED_LINKS_READING.id, SCRATCH_PATHS_READING.id].sort(),
    );

    // With no table at all the runbook's records are what they were — an empty list and a missing
    // one change nothing, which is what a checkout that never ran the nightly job hands in.
    expect(mergeRecords(runbook)).toEqual(runbook);
    expect(mergeRecords(runbook, [])).toEqual(runbook);
    expect(mergeRecords()).toEqual([]);
  });

  it("answers the command from both surfaces: the table's earlier night is what a fall is held against", () => {
    const runbook = linksRunbook([25]);
    const table = historyTable([
      historyRow("2026-08-31", {
        [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(27)),
      }),
    ]);

    // The runbook alone: one record, so the reading has never moved and the command says so.
    const alone = trendReport(runbook);
    expect(alone).toMatchObject({
      exitCode: 0,
      compared: 0,
      regressed: [],
      sources: { runbook: 1, history: 0, added: 0 },
    });
    expect(renderTrendReport(alone)).toContain("the only record there is");

    // With the table: the same record is now held against the night the table alone carries, and
    // the reading that stepped below it fails the run.
    const both = trendReport(runbook, { history: table });
    expect(both).toMatchObject({
      gate: "fail",
      exitCode: 1,
      compared: 1,
      regressed: [RENDERED_LINKS_READING.id],
      sources: { runbook: 1, history: 1, added: 1 },
    });
    const page = renderTrendReport(both);
    expect(page).toContain(
      "REGRESSED   rendered-links         25 chrome unique destinations — down 2 from the low-water 27 of 1 previous record(s) (2026-08-31)",
    );
    // …and the report says what it was read from, because a night the runbook does not hold is
    // otherwise unexplained.
    expect(page).toContain(
      "  from 1 runbook record(s) and 1 nightly history row(s) — 1 night(s) the runbook never recorded",
    );
  });

  it("charts a night only the table recorded beside the runbook's own", () => {
    const block = coverageOverTime(linksRunbook([25]), {
      history: historyTable([
        historyRow("2026-08-31", {
          [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(27)),
        }),
      ]),
    }).join("\n");

    expect(block).toContain(
      "- **rendered-links** `█▁` — 25 chrome unique destinations, down 2 from 27 (range 25–27) " +
        "over 2 record(s) (2026-08-31 → 2026-09-01)",
    );
    // The block's own words say which two files it is charted from.
    expect(block).toContain("nightly history table");
  });
});

describe("the movement one reading made", () => {
  const movementOf = (values: (number | string)[], limit?: number) =>
    readingMovement(
      RENDERED_LINKS_READING,
      recordsOf(linksRunbook(values)),
      limit === undefined ? {} : { limit },
    );

  it("holds the newest record against the low-water of the nights before it, not the night before", () => {
    // A dip back from a one-night spike is the reading holding the level it has kept, and a number
    // below everything the reading has settled to is the movement worth failing. The night
    // immediately before would call the first a regression and, after a single good night, would
    // see nothing in the second — which is why the baseline is the floor of the nights before.
    expect(movementOf([25, 25, 28, 25])).toMatchObject({ status: "held", floor: 25, delta: 0 });
    expect(movementOf([27, 28, 25])).toMatchObject({ status: "regressed", floor: 27, delta: -2 });
    expect(movementOf([13, 7, 13, 20])).toMatchObject({ status: "rose", floor: 7, delta: 13 });
    expect(movementOf([25, 25, 25])).toMatchObject({ status: "held", floor: 25, delta: 0 });

    // The numbers a verdict rests on are on the row: what it compared, where from, and when.
    const regressed = movementOf([27, 28, 25]);
    expect(regressed.current).toEqual({ date: "2026-09-03", value: 25 });
    expect(regressed.before).toBe(2);
    expect(regressed.from).toBe("2026-09-01");
    expect(regressed.to).toBe("2026-09-02");
  });

  it("answers no history — not a pass — for a reading with nothing before its newest record", () => {
    // One record, and none at all: the reading has never moved, and saying so is an answer rather
    // than a quiet green — the same omission the chart makes, in the command's own words.
    expect(movementOf([25])).toMatchObject({
      status: "no-history",
      floor: null,
      delta: null,
      current: { date: "2026-09-01", value: 25 },
    });
    const never = readingMovement(RENDERED_LINKS_READING, []);
    expect(never.status).toBe("no-history");
    expect(never.current).toBeNull();
  });

  it("cannot read a movement off a line the metric does not fit, and never lets one be the floor", () => {
    // A hand-edited newest line: the movement cannot be answered from it, and that is said plainly
    // rather than read as a number. A baseline line the metric cannot read is not a measurement
    // either, so it cannot quietly become the low-water the newest record is held against.
    const handEdited = movementOf([27, `${RENDERED_LINKS_READING.prefix} chrome — the footer 14`]);
    expect(handEdited.status).toBe("unreadable");
    expect(handEdited.floor).toBe(27);
    expect(handEdited.current).toEqual({ date: "2026-09-02", value: null });

    const withHole = movementOf([
      10,
      `${RENDERED_LINKS_READING.prefix} chrome — nothing on this line can be read`,
      12,
    ]);
    expect(withHole).toMatchObject({ status: "rose", floor: 10, before: 1, delta: 2 });
    expect(withHole.unreadable).toEqual(["2026-09-02"]);
  });

  it("names the baselines its metric cannot read, rather than calling the reading new", () => {
    // The newest record is readable, so this is not `unreadable`; what it lacks is a number before
    // it. Two histories look the same from the counts alone — a guard that has just started
    // publishing and a metric that stopped reading its own line — and the row says which one it
    // is, because calling the second "the only record there is" would be a line this module cannot
    // read going unnamed, which is the one thing it refuses everywhere else.
    const stale = `${RENDERED_LINKS_READING.prefix} chrome — nothing on this line can be read`;
    const moved = movementOf([stale, 25]);
    expect(moved).toMatchObject({ status: "no-history", floor: null, before: 0 });
    expect(moved.unreadable).toEqual(["2026-09-01"]);
    expect(moved.current).toEqual({ date: "2026-09-02", value: 25 });

    const page = renderTrendReport(trendReport(linksRunbook([stale, 25])));
    expect(page).toContain("no earlier line this metric can read (1: 2026-09-01)");
    expect(page).not.toContain("the only record there is");

    // …and a reading that really is new still reads as new: the two are kept apart rather than
    // one wording covering both.
    const fresh = renderTrendReport(trendReport(linksRunbook([25])));
    expect(fresh).toContain(`the only record there is (2026-09-01)`);
    expect(fresh).not.toContain("no earlier line this metric can read");
  });

  it("compares only the window it was handed, and says how many records fell before it", () => {
    const values = Array.from({ length: 25 }, (_, index) => index + 1);
    const windowed = movementOf(values, 5);

    expect(windowed.records).toBe(25);
    expect(windowed.dropped).toBe(20);
    expect(windowed.current?.value).toBe(25);
    expect(windowed.before).toBe(4);
    expect(windowed.floor).toBe(21);
  });
});

describe("the coverage:trend command", () => {
  it("leads with the verdict and lists every reading's movement", () => {
    const report = trendReport(linksRunbook([27, 28, 25]));

    expect(report).toMatchObject({
      command: "coverage:trend",
      gate: "fail",
      exitCode: 1,
      compared: 1,
      regressed: [RENDERED_LINKS_READING.id],
    });
    // The exact report, because this is what a morning reader and the run page get: the counts
    // first, then a row per declared reading — the ones with nothing to compare included, since an
    // absent guard and a guard that never moved look the same unless the row says which it is.
    expect(renderTrendReport(report)).toBe(
      [
        "coverage:trend: 1 of 1 compared reading(s) regressed below their low-water: rendered-links.",
        "  from 3 runbook record(s) and 0 nightly history row(s)",
        "REGRESSED   rendered-links         25 chrome unique destinations — down 2 from the low-water 27 of 2 previous record(s) (2026-09-01 → 2026-09-02)",
        "NO HISTORY  scratch-paths          no record at all — neither the runbook nor the history table has carried this reading",
        "NO HISTORY  convention-guards      no record at all — neither the runbook nor the history table has carried this reading",        "",
        "  The floor is the reading's committed low-water: the lowest level its records have settled to,",
        "  so a fall below it fails the night that measured it while a return to a level it has held does",
        "  not. A reading that really stepped down is a decision to write down — `npm run",
        "  coverage:low-water` records the new level from the records, in the same commit as that night.",
      ].join("\n"),
    );
  });

  it("passes a runbook with nothing to compare, and says the answer is vacuous rather than green", () => {
    const report = trendReport("");

    expect(report).toMatchObject({ gate: "pass", exitCode: 0, compared: 0, regressed: [] });
    expect(renderTrendReport(report).split("\n")[0]).toBe(
      "coverage:trend: 0 of 3 reading(s) compared — no declared reading has a floor or an earlier " +
        "night to be held against, so there is nothing to answer.",
    );
  });

  describe("run as a command", () => {
    let scratch = "";
    beforeAll(() => {
      scratch = makeScratchDir("coverage-trend-cli-");
    });
    afterAll(() => {
      removeScratchDir(scratch);
    });

    /**
     * Runs the command over a runbook written to the suite's scratch directory, with a table and a
     * committed low-water that hold nothing: these cases are about the runbook they write, and the
     * checkout's own committed files would otherwise add their nights *and their floors* to the
     * answer — a three-night fixture held against the level this checkout has settled to is a verdict
     * about neither. The committed floor is the subject of `coverage-low-water.test.ts`; here it is
     * deliberately kept out.
     */
    const runTrend = (values: (number | string)[], args: string[] = []) => {
      const name = `${values.length}-${args.join("_") || "plain"}`;
      const runbook = path.join(scratch, `run-${name}.md`);
      const table = path.join(scratch, `table-${name}.md`);
      const lowWater = path.join(scratch, `low-water-${name}.json`);
      writeFileSync(runbook, linksRunbook(values), "utf8");
      writeFileSync(table, historyTable([]), "utf8");
      writeFileSync(lowWater, JSON.stringify({ readings: {} }), "utf8");
      return spawnSync(
        process.execPath,
        [trendModule, "--runbook", runbook, "--history", table, "--low-water", lowWater, ...args],
        { encoding: "utf8" },
      );
    };

    it("exits 1 on a regression and 0 when the reading held", () => {
      const regressed = runTrend([27, 28, 25]);
      expect(regressed.status).toBe(1);
      expect(regressed.stdout).toContain("1 of 1 compared reading(s) regressed");
      expect(regressed.stdout).toContain("REGRESSED   rendered-links");

      const held = runTrend([25, 25, 28, 25]);
      expect(held.status).toBe(0);
      expect(held.stdout).toContain("none regressed");
      expect(held.stdout).toContain("HELD        rendered-links");
    });

    it("answers a machine with the whole reading, verdict and rows alike", () => {
      const result = runTrend([27, 28, 25], ["--json"]);

      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload).toMatchObject({
        command: "coverage:trend",
        gate: "fail",
        exitCode: 1,
        compared: 1,
        regressed: [RENDERED_LINKS_READING.id],
      });
      expect(payload.rows.map((row: { id: string }) => row.id)).toEqual(
        READINGS.map((entry) => entry.id),
      );
      expect(payload.rows[0]).toMatchObject({
        status: "regressed",
        floor: 27,
        delta: -2,
        current: { date: "2026-09-03", value: 25 },
      });
    });

    it("refuses a window that is not a number of records, and a runbook it cannot read", () => {
      // A usage error is exit 2 and names the flag; a runbook the command cannot read is exit 1,
      // because that file is the command's whole subject and "no answer" is not a pass.
      for (const limit of ["0", "-3", "many"]) {
        const usage = runTrend([27, 28, 25], [`--limit=${limit}`]);
        expect(usage.status, `--limit=${limit} was accepted`).toBe(2);
        expect(usage.stderr).toContain(`--limit "${limit}" is not a positive whole number`);
      }

      const missing = spawnSync(
        process.execPath,
        [trendModule, "--runbook", path.join(scratch, "no-such-runbook.md")],
        { encoding: "utf8" },
      );
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("cannot read");
      expect(missing.stdout).toBe("");
    });

    it("reads the table it is handed, notes one that is not there, and defaults to the checkout's", () => {
      const runbook = path.join(scratch, "table-runbook.md");
      const table = path.join(scratch, "table-with-a-night.md");
      const emptyTable = path.join(scratch, "table-empty.md");
      // The floors are kept out of these answers for the reason the table is not the default one:
      // what is being asserted is what the *records* say, night by night.
      const noFloors = path.join(scratch, "table-low-water.json");
      writeFileSync(noFloors, JSON.stringify({ readings: {} }), "utf8");
      writeFileSync(runbook, linksRunbook([25]), "utf8");
      writeFileSync(
        table,
        historyTable([
          historyRow("2026-08-31", {
            [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(27)),
          }),
        ]),
        "utf8",
      );
      writeFileSync(emptyTable, historyTable([]), "utf8");

      // The night the table alone recorded is what the runbook's one record is held against, so
      // the reading that stepped below it fails the run.
      const regressed = spawnSync(
        process.execPath,
        [trendModule, "--runbook", runbook, "--history", table, "--low-water", noFloors],
        { encoding: "utf8" },
      );
      expect(regressed.status).toBe(1);
      expect(regressed.stdout).toContain("REGRESSED   rendered-links");
      expect(regressed.stdout).toContain("1 night(s) the runbook never recorded");

      // The same runbook with an empty table — the scaffold's own shape, not a missing file — has
      // the one record again, and the command answers rather than failing: the night that turned
      // this into a fall was the table's.
      const empty = spawnSync(
        process.execPath,
        [trendModule, "--runbook", runbook, "--history", emptyTable, "--low-water", noFloors],
        { encoding: "utf8" },
      );
      expect(empty.status).toBe(0);
      expect(empty.stdout).toContain("NO HISTORY");
      expect(empty.stderr).not.toContain("no history table at");

      // A table that is not there costs the answer its extra nights and says so on stderr; it is
      // never a failure, because the runbook is what this command cannot answer without.
      const missing = spawnSync(
        process.execPath,
        [
          trendModule,
          "--runbook",
          runbook,
          "--history",
          path.join(scratch, "no-such-table.md"),
          "--low-water",
          noFloors,
        ],
        { encoding: "utf8" },
      );
      expect(missing.status).toBe(0);
      expect(missing.stderr).toContain("no history table at");

      // …and with no --history at all the table beside the module is read, which is the invocation
      // the nightly job makes: the nights it holds are ones this fixture runbook never recorded.
      const payload = JSON.parse(
        spawnSync(process.execPath, [trendModule, "--runbook", runbook, "--json"], {
          encoding: "utf8",
        }).stdout,
      );
      expect(payload.sources).toMatchObject({ runbook: 1 });
      expect(payload.sources.history).toBeGreaterThan(0);
      expect(payload.sources.added).toBeGreaterThan(0);
    });
  });
});
