import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLUMNS,
  HISTORY_FILE,
  appendCoverageRow,
  columnTitle,
  scaffold,
} from "../../.freebuff/coverage-history.mjs";
// The one declaration of the readings the pipeline carries. The history keeps a column for every
// one of them, so its fixtures, its expected rows and its header case are all built from the
// registry rather than from a second copy of an id, a prefix or a column name.
import {
  CONVENTION_GUARDS_READING,
  READINGS,
  RENDERED_LINKS_READING,
  SCRATCH_PATHS_READING,
} from "../../.freebuff/coverage-readings.mjs";
import workflowSource from "../../.github/workflows/nightly.yml?raw";

/**
 * A test for the coverage history — the committed file the nightly job appends each run's
 * coverage readings to, one dated row per run and one column per reading.
 *
 * Every reading already reaches three consumers (the suite's console line, the runbook's dated
 * bullet, the nightly summary's `### Coverage` section) and every one of them answers the question
 * about a *single* run. `.freebuff/coverage-history.mjs` is the accumulator: a table where each
 * guard's coverage is a column of its own, so a link the chrome stopped advertising, a suite that
 * stopped keeping a scratch directory or a convention guard that fell out of the meta-test is a
 * column that moved over nights instead of a number nobody remembers.
 *
 * The rows are written by a job nobody watches and read months later, so the exact rules are held
 * here: one row per date (a rerun corrects the day rather than duplicating it), one cell per
 * declared reading (the column set is the registry, and a reading a run left none of leaves its
 * cell empty rather than fabricating a zero), and — the rule this shape exists for — a run writes
 * only the cells it carried, so a second run of the same night can correct one column without
 * erasing the readings the first one recorded. The CLI's refusals are held too, because a broken
 * input folded into a history is a quietly wrong trend, and the nightly workflow's wiring is
 * pinned the way `collect-budget.test.ts` pins its steps — by reading the workflow source — so a
 * step that stops invoking the recorder, or a commit that drops the pin manifest it must stage
 * beside the history, fails here rather than on a morning when the trend has silently stopped
 * moving.
 */

/** A real-shaped rendered-links reading: the chrome half and the data half, escaper-visible. */
const RENDERED_LINKS_LINE = `${RENDERED_LINKS_READING.prefix} chrome — the footer 14, the signed-in header 5 (9 unique destinations) | data — 27 page mounts, 18 unique destinations`;

/** A real-shaped frozen-scratch reading: the roster of judged suites and the tree it read. */
const SCRATCH_PATHS_LINE = `${SCRATCH_PATHS_READING.prefix} 7 suite(s) keep a scratch directory and were judged — src/test/scratch.test.ts (211 test file(s) scanned)`;

/** A real-shaped convention-guards reading: the roster of guards the meta-test exercised. */
const CONVENTION_GUARDS_LINE = `${CONVENTION_GUARDS_READING.prefix} 13 guard(s) exercised on both of their shapes — beat-clock, runbook, stale-stage-lists`;

/** A night on which every guard measured: the report's map, keyed as the report keys it. */
const FULL_NIGHT = {
  [RENDERED_LINKS_READING.id]: RENDERED_LINKS_LINE,
  [SCRATCH_PATHS_READING.id]: SCRATCH_PATHS_LINE,
  [CONVENTION_GUARDS_READING.id]: CONVENTION_GUARDS_LINE,
};

/** The readings map a report with only some of the guards measuring carries. */
const THIN_NIGHT = {
  [SCRATCH_PATHS_READING.id]: SCRATCH_PATHS_LINE,
  [CONVENTION_GUARDS_READING.id]: CONVENTION_GUARDS_LINE,
};

/** A reading's text as a table cell holds it: the pipes its own join uses escaped. */
const escaped = (text: string) => text.replace(/\|/g, "\\|");

/** The row the table writes for a date, with the readings given for the leading columns. */
const rowOf = (date: string, ...leadingCells: string[]) =>
  `| ${date} | ${[
    ...leadingCells,
    ...Array<string>(COLUMNS.length - leadingCells.length).fill(""),
  ].join(" | ")} |`;

/** One row's cells as the file holds them, so a case can say which column holds what. */
function cellsOf(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((text) => text.trim());
}

/** The row a history's text holds for a date, or the empty string when it holds none. */
function rowFor(text: string, date: string): string {
  return text.split("\n").find((line) => line.startsWith(`| ${date} |`)) ?? "";
}

/** A report shaped like `ci.mjs --json` emits it, carrying the readings under their registry ids. */
const reportWith = (readings: unknown) => ({ gate: "pass", exitCode: 0, readings });

describe("the coverage history row", () => {
  it("appends the first row to a fresh scaffold, with a cell for every declared reading", () => {
    const result = appendCoverageRow("", "2026-10-02", FULL_NIGHT);

    expect(result.action).toBe("appended");
    expect(result.recorded).toEqual(READINGS.map((entry) => entry.id));
    expect(result.text).toContain(
      rowOf("2026-10-02", ...COLUMNS.map((entry) => escaped(FULL_NIGHT[entry.id]))),
    );
    // One date cell and one cell per declared reading: the row is as wide as the registry, so a
    // column is never missing from a row a reader is comparing against the night before.
    expect(cellsOf(rowFor(result.text, "2026-10-02"))).toHaveLength(COLUMNS.length + 1);
    // The row landed inside the table, not after a stray blank line: directly under the
    // alignment row, where every future append will find the table.
    expect(result.text.indexOf("| 2026-10-02 |")).toBeGreaterThan(result.text.indexOf("| :-- |"));
    expect(result.text.startsWith("# Coverage history")).toBe(true);
  });

  it("appends a later date after the rows already there, so each column reads top to bottom", () => {
    const first = appendCoverageRow("", "2026-10-01", FULL_NIGHT).text;
    const second = appendCoverageRow(first, "2026-10-02", FULL_NIGHT);

    expect(second.action).toBe("appended");
    expect(second.text.indexOf("| 2026-10-01 |")).toBeLessThan(second.text.indexOf("| 2026-10-02 |"));
  });

  it("writes only the cells a run carried, leaving the night's other readings standing", () => {
    // The rule the side-by-side table exists for. A second run of the same night that measured
    // one reading corrects that reading's cell — and nothing else about the row moves, because
    // the columns accrue independently: a correction of one guard's coverage is not a statement
    // about the others.
    const seeded = appendCoverageRow("", "2026-10-02", FULL_NIGHT).text;
    const moved = `${SCRATCH_PATHS_READING.prefix} 8 suite(s) keep a scratch directory and were judged — src/test/scratch.test.ts (212 test file(s) scanned)`;

    const corrected = appendCoverageRow(seeded, "2026-10-02", {
      [SCRATCH_PATHS_READING.id]: moved,
    });

    expect(corrected.action).toBe("updated");
    expect(corrected.recorded).toEqual([SCRATCH_PATHS_READING.id]);
    expect(cellsOf(rowFor(corrected.text, "2026-10-02"))).toEqual([
      "2026-10-02",
      ...COLUMNS.map((entry) =>
        entry.id === SCRATCH_PATHS_READING.id ? escaped(moved) : escaped(FULL_NIGHT[entry.id]),
      ),
    ]);
    expect(corrected.text.match(/\| 2026-10-02 \|/g)).toHaveLength(1);
    expect(corrected.text).not.toContain(escaped(SCRATCH_PATHS_LINE));
  });

  it("changes nothing when every cell it carried is already exactly there — a rerun is not a row", () => {
    const first = appendCoverageRow("", "2026-10-02", FULL_NIGHT);

    const again = appendCoverageRow(first.text, "2026-10-02", FULL_NIGHT);

    expect(again.action).toBe("unchanged");
    expect(again.text).toBe(first.text);
    // …and the same holds for a rerun that carries one reading the row already has: nothing to
    // write is nothing to commit, whatever the run measured of the row.
    const oneColumn = appendCoverageRow(first.text, "2026-10-02", {
      [RENDERED_LINKS_READING.id]: RENDERED_LINKS_LINE,
    });
    expect(oneColumn.action).toBe("unchanged");
    expect(oneColumn.text).toBe(first.text);
  });

  it("states a reading the run left none of as an empty cell, never as a zero", () => {
    const result = appendCoverageRow("", "2026-10-02", THIN_NIGHT);

    expect(result.action).toBe("appended");
    expect(result.recorded).toEqual([SCRATCH_PATHS_READING.id, CONVENTION_GUARDS_READING.id]);
    // The ledger's own words for "this guard left nothing" are the empty cell beside a reading
    // somebody did measure — the same omission the run page and the runbook make, and never a
    // `0` a reader would have to interpret.
    expect(cellsOf(rowFor(result.text, "2026-10-02"))).toEqual([
      "2026-10-02",
      "",
      escaped(SCRATCH_PATHS_LINE),
      escaped(CONVENTION_GUARDS_LINE),
    ]);
    // The row is still one row of four cells: an absence is a cell the table states, not a
    // column that quietly shifted its neighbour into the reading's place.
    expect(result.text.match(/\| 2026-10-02 \|/g)).toHaveLength(1);
  });

  it("records nothing at all for a run that carried no declared reading — no measurement, no row", () => {
    // A stubbed suite, a suite that failed before its guard ran, a narrower selection: the report
    // says `null` for every reading, and the history answers with an omission rather than a row
    // of empty cells — which would read as a night that ran and measured nothing rather than as
    // a night this table has no reading for.
    const seeded = appendCoverageRow("", "2026-10-01", FULL_NIGHT).text;

    const none = appendCoverageRow(seeded, "2026-10-02", {});
    expect(none.action).toBe("none");
    expect(none.recorded).toEqual([]);
    expect(none.text).toBe(seeded);
    expect(none.text).not.toContain("| 2026-10-02 |");

    // …and a blank history is not scaffolded for one either: nothing measured writes nothing.
    expect(appendCoverageRow("", "2026-10-02", {}).text).toBe(scaffold());
  });

  it("escapes the pipes the reading itself joins its parts with, or they would end the row's cells", () => {
    // The rendered-links reading's halves are joined with `" | "` — the one character a Markdown
    // table cell may not carry. Unescaped, the row's date cell would end at the first pipe and
    // the reading would shred into cells that mean nothing.
    const result = appendCoverageRow("", "2026-10-02", FULL_NIGHT);

    const line = rowFor(result.text, "2026-10-02");
    expect(line).toContain("\\|");
    expect(cellsOf(line)).toHaveLength(COLUMNS.length + 1);
    // The reading reads back byte for byte: what the cell holds, unescaped, is the line the
    // suite wrote.
    expect(cellsOf(line)[1].replace(/\\\|/g, "|")).toBe(RENDERED_LINKS_LINE);
  });

  it("widens a row written before the table had its columns, keeping the reading it held", () => {
    // The committed file's own history: a row recorded when the table had one reading. It is a
    // reading for the first column and nothing for the others — the rows already accruing must
    // not be lost, or interpreted as another column's, when the table grows.
    const legacy = [
      "| Date | Rendered-links coverage |",
      "| :-- | :-- |",
      `| 2026-10-05 | ${escaped(RENDERED_LINKS_LINE)} |`,
      "",
    ].join("\n");

    const result = appendCoverageRow(legacy, "2026-10-05", {
      [CONVENTION_GUARDS_READING.id]: CONVENTION_GUARDS_LINE,
    });

    expect(result.action).toBe("updated");
    expect(cellsOf(rowFor(result.text, "2026-10-05"))).toEqual([
      "2026-10-05",
      escaped(RENDERED_LINKS_LINE),
      "",
      escaped(CONVENTION_GUARDS_LINE),
    ]);
  });

  it("starts a blank file from the scaffold, so a missing history is begun rather than failed", () => {
    const fromBlank = appendCoverageRow("", "2026-10-02", FULL_NIGHT);
    const fromWhitespace = appendCoverageRow("   \n", "2026-10-02", FULL_NIGHT);

    expect(fromBlank.text).toBe(fromWhitespace.text);
    expect(fromBlank.text).toContain(`| Date | ${COLUMNS.map(columnTitle).join(" | ")} |`);
  });

  it("refuses a reading that does not read like one", () => {
    // Each of these would otherwise be a cell the table states as a measurement: a line with no
    // prefix at all, a bare prefix that says nothing was audited, and — the one a growing
    // registry makes possible — another reading's line filed under this reading's id.
    for (const wrong of [
      "coverage: 27 destinations",
      `${RENDERED_LINKS_READING.prefix}   `,
      SCRATCH_PATHS_LINE,
    ]) {
      expect(() => appendCoverageRow("", "2026-10-02", { [RENDERED_LINKS_READING.id]: wrong })).toThrow(
        /does not read like one/,
      );
    }
  });

  it("refuses a reading that is not a string", () => {
    expect(() =>
      appendCoverageRow("", "2026-10-02", { [RENDERED_LINKS_READING.id]: 27 as unknown as string }),
    ).toThrow(/is a number, not a string/);
  });

  it("refuses a malformed date rather than filing the readings under nothing", () => {
    expect(() => appendCoverageRow("", "October 2", FULL_NIGHT)).toThrow(/not a YYYY-MM-DD date/);
    expect(() => appendCoverageRow("", "2026-10-02T00:00:00Z", FULL_NIGHT)).toThrow(
      /not a YYYY-MM-DD date/,
    );
  });
});

describe("the table's columns", () => {
  it("are the declared readings, in the registry's own order", () => {
    // The column set is the registry, walked rather than restated: a guard that starts publishing
    // is a column here — and in the committed file's header — without this module being edited,
    // and the order two nights are read against each other is the order the run page prints.
    expect(COLUMNS).toBe(READINGS);
    expect(COLUMNS.map((entry) => entry.id)).toEqual(READINGS.map((entry) => entry.id));
  });

  it("are headed with each reading's own words, taken from its declaration", () => {
    // No second spelling of a reading's name: the header is the entry's prefix without its colon
    // and with its first letter raised, so a rename in the registry moves the column's heading
    // with it — which is what the committed file's own header was written from.
    expect(READINGS.map(columnTitle)).toEqual([
      "Rendered-links coverage",
      "Scratch-paths coverage",
      "Convention-guards coverage",
    ]);
    // …and no two columns can carry the same heading: the ids are the table's keys and the
    // prefixes its contract, so a reading that arrived under a name already taken is refused by
    // the registry's own suite rather than silently over-writing a column here.
    expect(new Set(READINGS.map(columnTitle)).size).toBe(READINGS.length);
  });
});

describe("the scaffold and the committed file", () => {
  const committedPath = fileURLToPath(new URL("../../.freebuff/coverage-history.md", import.meta.url));

  it("is a complete file: the provenance, the hand commands, and a cell for every reading", () => {
    const text = scaffold();

    expect(text.startsWith("# Coverage history\n")).toBe(true);
    expect(text).toContain("nightly.yml");
    expect(text).toContain("coverage-history.mjs");
    expect(text).toContain("coverage-readings.mjs");
    expect(text).toContain("node .freebuff/coverage-history.mjs --report .ci/report.json");
    expect(text).toContain("node .freebuff/coverage-history.mjs --stamp");
    // The table's two rows are built from the registry: one column per reading, and an alignment
    // cell for each — a hand-edited header with a column missing fails here by name.
    expect(text).toContain(`| Date | ${COLUMNS.map(columnTitle).join(" | ")} |`);
    expect(text).toContain(`| :-- |${COLUMNS.map(() => " :-- |").join("")}\n`);
  });

  it("is the prefix of the committed file, however many rows the nights have added", () => {
    // The scaffold is defined once, in the module, and the committed file is that text with rows
    // appended under its table — so the module stays the single source of the file's shape and a
    // hand-edited header fails here with the repair spelled out, rather than drifting from the
    // writer.
    const committed = readFileSync(committedPath, "utf8");

    expect(committed.startsWith(scaffold())).toBe(true);
  });

  it("holds rows that are as wide as the table, reading by reading", () => {
    // The committed file travels with the checkout and its rows are read beside each other: a row
    // narrower than the header would put one reading's cell somewhere a reader does not look.
    const committed = readFileSync(committedPath, "utf8");
    const rows = committed.split("\n").filter((line) => /^\| \d{4}-\d{2}-\d{2} \|/.test(line));

    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) {
      expect(cellsOf(line), `${line.slice(0, 24)}… is not as wide as the table`).toHaveLength(
        COLUMNS.length + 1,
      );
    }
  });
});

describe("the coverage-history CLI", () => {
  let dir = "";
  const script = fileURLToPath(new URL("../../.freebuff/coverage-history.mjs", import.meta.url));

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "coverage-history-test-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs the CLI against files in the scratch dir; paths are given back joined. */
  function run(args: string[]) {
    return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  }

  it("records every declared reading the report carried, side by side, and says which it recorded", () => {
    const report = path.join(dir, "report.json");
    const history = path.join(dir, "history.md");
    writeFileSync(report, JSON.stringify(reportWith(FULL_NIGHT)));

    const result = run(["--report", report, "--file", history, "--date", "2026-10-02"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("appended 2026-10-02's row");
    expect(result.stderr).toContain(READINGS.map((entry) => entry.id).join(", "));
    expect(readFileSync(history, "utf8")).toContain(
      rowOf("2026-10-02", ...COLUMNS.map((entry) => escaped(FULL_NIGHT[entry.id]))),
    );
  });

  it("leaves the column of a reading the report carried none of empty", () => {
    const report = path.join(dir, "thin.json");
    const history = path.join(dir, "thin.md");
    writeFileSync(report, JSON.stringify(reportWith(THIN_NIGHT)));

    const result = run(["--report", report, "--file", history, "--date", "2026-10-02"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`— ${SCRATCH_PATHS_READING.id}, ${CONVENTION_GUARDS_READING.id}`);
    expect(cellsOf(rowFor(readFileSync(history, "utf8"), "2026-10-02"))).toEqual([
      "2026-10-02",
      "",
      escaped(SCRATCH_PATHS_LINE),
      escaped(CONVENTION_GUARDS_LINE),
    ]);
  });

  it("reruns over the same report without duplicating the day — a dispatch rerun corrects nothing twice", () => {
    const report = path.join(dir, "rerun.json");
    const history = path.join(dir, "rerun.md");
    writeFileSync(report, JSON.stringify(reportWith(FULL_NIGHT)));
    run(["--report", report, "--file", history, "--date", "2026-10-02"]);
    const before = readFileSync(history, "utf8");

    const result = run(["--report", report, "--file", history, "--date", "2026-10-02"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("already holds 2026-10-02's row — unchanged");
    expect(readFileSync(history, "utf8")).toBe(before);
  });

  it("corrects one column of the night without erasing the readings another run recorded", () => {
    const full = path.join(dir, "night-a.json");
    const partial = path.join(dir, "night-b.json");
    const history = path.join(dir, "night.md");
    const moved = `${RENDERED_LINKS_READING.prefix} chrome — the footer 13 (25 unique destinations)`;
    writeFileSync(full, JSON.stringify(reportWith(FULL_NIGHT)));
    writeFileSync(partial, JSON.stringify(reportWith({ [RENDERED_LINKS_READING.id]: moved })));
    run(["--report", full, "--file", history, "--date", "2026-10-02"]);

    const result = run(["--report", partial, "--file", history, "--date", "2026-10-02"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("updated 2026-10-02's row");
    expect(cellsOf(rowFor(readFileSync(history, "utf8"), "2026-10-02"))).toEqual([
      "2026-10-02",
      escaped(moved),
      escaped(SCRATCH_PATHS_LINE),
      escaped(CONVENTION_GUARDS_LINE),
    ]);
  });

  it("records nothing for a report whose readings are all unmeasured, and calls that a normal night", () => {
    const report = path.join(dir, "nostamp.json");
    const history = path.join(dir, "nostamp.md");
    writeFileSync(
      report,
      JSON.stringify(reportWith(Object.fromEntries(READINGS.map((entry) => [entry.id, null])))),
    );
    writeFileSync(history, scaffold());

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("carries none of the declared readings");
    expect(result.stderr).toContain("nothing to record");
    expect(readFileSync(history, "utf8")).toBe(scaffold());
  });

  it("records nothing for a report with no readings map at all — an older report, not a broken one", () => {
    const report = path.join(dir, "nofield.json");
    const history = path.join(dir, "nofield.md");
    writeFileSync(report, JSON.stringify({ gate: "pass", exitCode: 0 }));
    writeFileSync(history, scaffold());

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(0);
    expect(readFileSync(history, "utf8")).toBe(scaffold());
  });

  it("is loud about a report it cannot read or parse", () => {
    const missing = run(["--report", path.join(dir, "absent.json"), "--file", path.join(dir, "a.md")]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("cannot read");

    const garbage = path.join(dir, "garbage.json");
    writeFileSync(garbage, "{not json");
    const unparseable = run(["--report", garbage, "--file", path.join(dir, "b.md")]);
    expect(unparseable.status).toBe(1);
    expect(unparseable.stderr).toContain("is not valid JSON");
  });

  it("is loud about a readings field that is not a map keyed by reading id", () => {
    // A `readings` field the runner could not have written: read as an omission it would look
    // like a night whose guards all left nothing, which is a silent loss of the whole row.
    const report = path.join(dir, "notamap.json");
    const history = path.join(dir, "notamap.md");
    writeFileSync(report, JSON.stringify({ gate: "pass", exitCode: 0, readings: "readings" }));
    writeFileSync(history, scaffold());

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not a map keyed by reading id");
    expect(readFileSync(history, "utf8")).toBe(scaffold());
  });

  it("is loud about a reading that is not a string — a broken pipeline, not a quiet night", () => {
    const report = path.join(dir, "numeric.json");
    const history = path.join(dir, "numeric.md");
    writeFileSync(report, JSON.stringify(reportWith({ ...FULL_NIGHT, [RENDERED_LINKS_READING.id]: 42 })));

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${RENDERED_LINKS_READING.id} reading is a number, not a string`);
  });

  it("is loud about a reading filed under another reading's id", () => {
    // The shape a registry rename or a mis-keyed map leaves: a well-formed reading, in the wrong
    // column. Recorded, it would put one guard's roster under another guard's heading forever.
    const report = path.join(dir, "misfiled.json");
    const history = path.join(dir, "misfiled.md");
    writeFileSync(
      report,
      JSON.stringify(
        reportWith({ ...FULL_NIGHT, [SCRATCH_PATHS_READING.id]: FULL_NIGHT[RENDERED_LINKS_READING.id] }),
      ),
    );
    writeFileSync(history, scaffold());

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SCRATCH_PATHS_READING.id} reading does not read like one`);
    expect(readFileSync(history, "utf8")).toBe(scaffold());
  });

  it("refuses an invocation naming two sources for one row, or none", () => {
    const both = run(["--report", "a.json", "--stamp", RENDERED_LINKS_LINE]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("two sources for one row");

    const neither = run([]);
    expect(neither.status).toBe(1);
    expect(neither.stderr).toContain("nothing to record");
  });

  it("files a hand-passed stamp under the reading whose prefix it carries", () => {
    // A hand-measured line does not say which column it belongs to — its prefix does. The first
    // stamp fills one column and leaves the rest empty; the second, a different reading's line,
    // fills its own beside it.
    const history = path.join(dir, "manual.md");

    const scratch = run(["--stamp", SCRATCH_PATHS_LINE, "--file", history, "--date", "2026-09-30"]);
    expect(scratch.status).toBe(0);
    expect(scratch.stderr).toContain(`— ${SCRATCH_PATHS_READING.id}`);
    expect(cellsOf(rowFor(readFileSync(history, "utf8"), "2026-09-30"))).toEqual([
      "2026-09-30",
      "",
      escaped(SCRATCH_PATHS_LINE),
      "",
    ]);

    const rendered = run(["--stamp", RENDERED_LINKS_LINE, "--file", history, "--date", "2026-09-30"]);
    expect(rendered.status).toBe(0);
    expect(cellsOf(rowFor(readFileSync(history, "utf8"), "2026-09-30"))).toEqual([
      "2026-09-30",
      escaped(RENDERED_LINKS_LINE),
      escaped(SCRATCH_PATHS_LINE),
      "",
    ]);
  });

  it("refuses a hand-passed stamp that reads like no declared reading", () => {
    const result = run(["--stamp", "coverage: 27 destinations", "--file", path.join(dir, "c.md")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not read like one");
    for (const entry of READINGS) expect(result.stderr).toContain(entry.prefix);
  });

  it("defaults --file to the committed history's path", () => {
    expect(HISTORY_FILE).toBe(".freebuff/coverage-history.md");
  });
});

describe("the nightly job's wiring", () => {
  /** One step's YAML block, found by its `name:`, so the pins read like the file does. */
  function stepBlock(name: string): string {
    const marker = `      - name: ${name}`;
    const start = workflowSource.indexOf(marker);
    expect(start, `nightly.yml has no step named ${name}`).toBeGreaterThan(-1);
    const next = workflowSource.indexOf("\n      - name: ", start + marker.length);
    return workflowSource.slice(start, next === -1 ? workflowSource.length : next);
  }

  it("records the row from the gate's report, even when the gate failed", () => {
    const step = stepBlock("Record the coverage history row");

    expect(step).toContain("if: always()");
    expect(step).toContain(`node .freebuff/coverage-history.mjs --report .ci/report.json --file ${HISTORY_FILE}`);
    // A night whose gate crashed before writing a report says so and records nothing — the same
    // fallback shape the publish step above it takes.
    expect(step).toContain("[ -s .ci/report.json ]");
  });

  it("records every declared reading, not one of them", () => {
    // The step is the recorder's only caller in CI, and the recorder reads the registry for its
    // columns: nothing here may name a reading, or a guard that starts publishing would land in
    // the report and never in the table.
    const step = stepBlock("Record the coverage history row");

    for (const entry of READINGS) {
      expect(step, `the record step names ${entry.id} instead of reading the report`).not.toContain(
        entry.id,
      );
    }
  });

  it("commits the row back, staging the pin manifest beside the history", () => {
    const step = stepBlock("Commit the coverage history");

    expect(step).toContain("if: always()");
    // The doctrine every workflow that commits is held to: whatever commits, commits the manifest
    // with it (the rule `collect-budget.test.ts` states over the whole directory).
    expect(step).toContain(`git add ${HISTORY_FILE} .freebuff/gate-hashes.mjs`);
    expect(step).toContain("chore(coverage): record the nightly coverage readings");
    expect(step).toContain("git commit");
    // The push must not wake the push-triggered jobs in `ci.yml` — a bot commit at night records
    // a reading, it does not start a deploy.
    expect(step).toContain("[skip ci]");
    expect(step).toContain("git push");
  });

  it("holds contents: write on the one job that commits, with the workflow default still read", () => {
    expect(workflowSource).toContain("    permissions:\n      contents: write\n");
    expect(workflowSource).toContain("permissions:\n  contents: read");
  });

  it("keeps the accrued history with the report artifact", () => {
    const step = stepBlock("Upload the report");

    expect(step).toContain(HISTORY_FILE);
  });
});
