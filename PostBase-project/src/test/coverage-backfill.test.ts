import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeScratchDir, removeScratchDir } from "./scratch";
// The table's own declaration — its columns and the scaffold a tree without a file starts from —
// so the fixtures are the writer's shape rather than a second spelling of it.
import { COLUMNS, HISTORY_FILE, scaffold } from "../../.freebuff/coverage-history.mjs";
// The readers of both surfaces, and the registry whose ids key a row's cells: the backfill adds
// exactly the nights and the lines the chart would have charted.
import {
  CONVENTION_GUARDS_READING,
  READINGS,
  RENDERED_LINKS_READING,
  SCRATCH_PATHS_READING,
  metricOf,
} from "../../.freebuff/coverage-readings.mjs";
import { historyRecords, readingSeries, runbookRecords } from "../../.freebuff/coverage-trend.mjs";
import { backfillRecords } from "../../.freebuff/coverage-backfill.mjs";

/**
 * A test for the one-off that writes the history table's missing nights.
 *
 * The table begins on the night it was introduced while the runbook's dated records reach back
 * further, so `.freebuff/coverage-backfill.mjs` writes the nights that predate it — through the
 * writer's own row rendering (`appendCoverageRow`, asked for chronological placement) and the
 * trend's own runbook walk. Three things are contracts rather than details, and each is a case
 * here: it is **append-only** (a night the table already holds is left byte for byte, so a
 * recorded measurement is never silently revised), a record with no declared reading adds **no
 * row** (the writer's "no measurement, no row"), and a second run over its own output appends
 * nothing — the command is a migration, and it has to be able to be run twice.
 */

const backfill = fileURLToPath(new URL("../../.freebuff/coverage-backfill.mjs", import.meta.url));

/** A reading's line as its writer builds it: the entry's own prefix, then what it audited. */
const line = (entry: { prefix: string }, body: string): string => `${entry.prefix} ${body}`;

/** Bodies shaped so the number a metric reads is unambiguous, as the guard's own suite writes them. */
const bodies = {
  renderedLinks: (destinations: number) =>
    `chrome — the footer 14 (${destinations} unique destinations) | data — 28 page mounts, ` +
    "18 unique destinations",
  scratchPaths: (suites: number) =>
    `${suites} suite(s) keep a scratch directory and were judged — src/test/a.test.ts ` +
    "(200 test file(s) scanned)",
  conventionGuards: (guards: number) =>
    `${guards} guard(s) exercised on both of their shapes — mount, settle`,
};

/**
 * One record, as a whole-gate close writes it: a dated head announcing the verdict, then one
 * indented line per reading that run carried.
 */
function record(date: string, readingLines: string[] = []): string {
  const head =
    `- **${date} — ci verdict: 5 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, ` +
    "0 excluded (5 selected); all stages passed.** typecheck PASS.";
  return [head, ...readingLines.map((carried) => `  ${carried}.`)].join("\n");
}

/** One history row, as the nightly writer renders it: the date, then a cell per declared reading. */
function row(date: string, lines: Partial<Record<string, string>> = {}): string {
  const cells = READINGS.map((entry) => (lines[entry.id] ?? "").replace(/\|/g, "\\|"));
  return `| ${date} | ${cells.join(" | ")} |`;
}

/** A table holding those rows under the scaffold a tree without a file starts from. */
const tableOf = (rows: string[]): string => [scaffold(), ...rows.map((held) => `${held}\n`)].join("");

/**
 * One row's cells, unescaped back into what a reading wrote — the writer's `\|` undone exactly
 * once, so a cell that holds a reading whose own middle is a pipe reads as that reading.
 */
const cellsOf = (rowLine: string): string[] =>
  rowLine
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));

describe("the backfill from the runbook's records", () => {
  it("adds the nights the table never held, where their dates say, and never revises one it has", () => {
    const existing = tableOf([
      row("2026-10-02", {
        [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(25)),
      }),
    ]);
    const runbook = [
      record("2026-10-01", [line(RENDERED_LINKS_READING, bodies.renderedLinks(28))]),
      // The same night the table holds, with a *different* number: the table's own row is the
      // night's record, and this command writes missing history rather than revising it.
      record("2026-10-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(26))]),
      record("2026-10-03", [line(SCRATCH_PATHS_READING, bodies.scratchPaths(7))]),
    ].join("\n\n");

    const result = backfillRecords(existing, runbookRecords(runbook));

    expect(result.appended).toEqual(["2026-10-01", "2026-10-03"]);
    // The nights read top to bottom in date order, with the table's own row between them…
    expect(historyRecords(result.text).map((held) => held.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    // …and the entry's series is the two lines that mean it: the backfilled night's 28, then the
    // table's own 25 — not the runbook's 26, because that row was left exactly as it was.
    expect(readingSeries(RENDERED_LINKS_READING, historyRecords(result.text)).values).toEqual([28, 25]);
    expect(readingSeries(SCRATCH_PATHS_READING, historyRecords(result.text)).values).toEqual([7]);
    expect(result.text).not.toContain("26 unique destinations");

    // The rows the writer wrote: the scaffold untouched, and every row as wide as the table.
    expect(result.text.startsWith(scaffold())).toBe(true);
    const rows: string[] = result.text
      .split("\n")
      .filter((held: string) => /^\| \d{4}-\d{2}-\d{2} \|/.test(held));
    expect(rows).toHaveLength(3);
    for (const held of rows) {
      expect(cellsOf(held), `${held.slice(0, 14)}… is not as wide as the table`).toHaveLength(
        COLUMNS.length + 1,
      );
    }
    // A cell is the reading's own line, pipes and all, in the column that reading's id keys: the
    // writer's escaping undone once leaves the line's own `" | "` inside one cell, and the
    // entry's metric reads the number that night's record states.
    const backfilled = cellsOf(rows[0])[1];
    expect(metricOf(RENDERED_LINKS_READING, backfilled)).toBe(28);
    expect(backfilled).toContain(" | data — 28 page mounts, 18 unique destinations");
  });

  it("leaves a night the table already holds alone, cell for cell, even when the runbook knows more", () => {
    const existing = tableOf([
      row("2026-09-30", {
        [RENDERED_LINKS_READING.id]: line(RENDERED_LINKS_READING, bodies.renderedLinks(25)),
      }),
    ]);
    const runbook = record("2026-09-30", [
      line(RENDERED_LINKS_READING, bodies.renderedLinks(25)),
      line(SCRATCH_PATHS_READING, bodies.scratchPaths(7)),
      line(CONVENTION_GUARDS_READING, bodies.conventionGuards(13)),
    ]);

    const result = backfillRecords(existing, runbookRecords(runbook));

    // Nothing added and nothing changed: not one byte, which is the strongest form of the claim
    // that this command cannot rewrite a measurement another run recorded.
    expect(result.appended).toEqual([]);
    expect(result.text).toBe(existing);
  });

  it("adds no row for a night the runbook states without a declared reading", () => {
    const existing = tableOf([]);
    const runbook = [
      record("2026-09-29", ["Suspects: src/a.ts (changed)."]),
      record("2026-09-28"),
    ].join("\n\n");

    const result = backfillRecords(existing, runbookRecords(runbook));

    // A night nobody measured is not a row of empty cells — the writer's own answer to a report
    // that carried none of the declared readings, reached here through the same call.
    expect(result.appended).toEqual([]);
    expect(result.text).toBe(existing);
  });

  it("folds two records for one night into the one row the table has", () => {
    const existing = tableOf([]);
    const runbook = [
      record("2026-09-30", [
        line(RENDERED_LINKS_READING, bodies.renderedLinks(25)),
        line(SCRATCH_PATHS_READING, bodies.scratchPaths(7)),
      ]),
      // A second bullet for the same night, as a rerun or a hand-written record leaves: one row,
      // with the readings it did not carry filled in and its own line winning where both do.
      record("2026-09-30", [
        line(RENDERED_LINKS_READING, bodies.renderedLinks(99)),
        line(CONVENTION_GUARDS_READING, bodies.conventionGuards(13)),
      ]),
    ].join("\n\n");

    const result = backfillRecords(existing, runbookRecords(runbook));

    expect(result.appended).toEqual(["2026-09-30"]);
    expect(historyRecords(result.text)).toHaveLength(1);
    expect(readingSeries(RENDERED_LINKS_READING, historyRecords(result.text)).values).toEqual([25]);
    expect(readingSeries(SCRATCH_PATHS_READING, historyRecords(result.text)).values).toEqual([7]);
    expect(readingSeries(CONVENTION_GUARDS_READING, historyRecords(result.text)).values).toEqual([13]);
  });

  it("appends nothing the second time it is run over its own output", () => {
    const runbook = [
      record("2026-09-01", [line(RENDERED_LINKS_READING, bodies.renderedLinks(25))]),
      record("2026-09-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(26))]),
    ].join("\n\n");
    const first = backfillRecords(tableOf([]), runbookRecords(runbook));
    expect(first.appended).toEqual(["2026-09-01", "2026-09-02"]);

    const second = backfillRecords(first.text, runbookRecords(runbook));

    expect(second.appended).toEqual([]);
    expect(second.text).toBe(first.text);
    // A table it has never seen is scaffolded rather than refused, which is what would let this
    // command rebuild the file from the records alone.
    expect(backfillRecords("", runbookRecords(runbook)).text.startsWith(scaffold())).toBe(true);
  });
});

describe("the backfill as a command", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchDir("coverage-backfill-");
  });
  afterAll(() => {
    removeScratchDir(scratch);
  });

  /**
   * Runs the command over a runbook and a table written to the suite's scratch directory.
   *
   * `--file` and `--runbook` are always given: their defaults are the committed files, and a run
   * that fell back to them would rewrite this checkout's own table instead of a fixture.
   */
  const run = (runbook: string, file: string, args: string[] = []) =>
    spawnSync(
      process.execPath,
      [backfill, "--runbook", runbook, "--file", file, ...args],
      { encoding: "utf8" },
    );

  it("appends the missing nights, reports them, and leaves the checkout's own pair alone", () => {
    const runbook = path.join(scratch, "runbook.md");
    const file = path.join(scratch, "history.md");
    writeFileSync(
      runbook,
      [
        record("2026-09-01", [line(RENDERED_LINKS_READING, bodies.renderedLinks(25))]),
        record("2026-09-02", [line(SCRATCH_PATHS_READING, bodies.scratchPaths(7))]),
      ].join("\n\n"),
      "utf8",
    );
    writeFileSync(file, tableOf([]), "utf8");

    const appended = run(runbook, file);

    expect(appended.status).toBe(0);
    expect(appended.stderr).toContain("appended 2 row(s)");
    expect(appended.stderr).toContain("2026-09-01, 2026-09-02");
    const written = readFileSync(file, "utf8");
    expect(historyRecords(written).map((held) => held.date)).toEqual(["2026-09-01", "2026-09-02"]);

    // The second run finds every night held: nothing to append, the file byte-identical, exit 0.
    const again = run(runbook, file);
    expect(again.status).toBe(0);
    expect(again.stderr).toContain("nothing to append");
    expect(readFileSync(file, "utf8")).toBe(written);
  });

  it("writes nothing on a dry run, and refuses a runbook it cannot read", () => {
    const runbook = path.join(scratch, "dry-runbook.md");
    const file = path.join(scratch, "dry-history.md");
    writeFileSync(runbook, record("2026-09-03", [line(CONVENTION_GUARDS_READING, bodies.conventionGuards(13))]), "utf8");
    writeFileSync(file, tableOf([]), "utf8");
    const before = readFileSync(file, "utf8");

    const dry = run(runbook, file, ["--dry-run"]);

    expect(dry.status).toBe(0);
    expect(dry.stderr).toContain("would append 1 row(s)");
    expect(dry.stderr).toContain("2026-09-03");
    expect(readFileSync(file, "utf8")).toBe(before);

    // A runbook that is not there is exit 1 — the records are what this command writes down, and
    // with none there is nothing to say — while the table it would have written is untouched.
    const missing = run(path.join(scratch, "no-such-runbook.md"), file, ["--dry-run"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("cannot read");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("defaults the table to the committed history's path", () => {
    // A path, not a run: the default is the file the nightly job appends to, which is why every
    // case above hands `--file` explicitly.
    expect(HISTORY_FILE).toBe(".freebuff/coverage-history.md");
  });
});
