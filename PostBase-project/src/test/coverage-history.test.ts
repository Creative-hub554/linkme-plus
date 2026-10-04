import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HISTORY_FILE,
  STAMP_PREFIX,
  appendCoverageRow,
  scaffold,
} from "../../.freebuff/coverage-history.mjs";
import workflowSource from "../../.github/workflows/nightly.yml?raw";
import runnerSource from "../../.freebuff/ci.mjs?raw";
import renderedLinksSource from "./rendered-links.test.tsx?raw";

/**
 * A test for the coverage history — the committed file the nightly job appends
 * each run's rendered-links stamp to, one dated row per run.
 *
 * The stamp already reaches three consumers (the suite's console line, the
 * runbook's dated bullet, the nightly summary's `### Coverage` section), and
 * every one of them answers the question about a single run. `.freebuff/coverage-history.mjs`
 * is the accumulator, so the trend — a link the chrome stopped advertising, a
 * page that stopped mounting — reads as a falling column instead of a number
 * nobody remembers. The rows are written by a job nobody watches at night and
 * read months later, so the exact rules matter and are held here: one row per
 * date (a rerun corrects the day rather than duplicating it), rows in the
 * order they arrived, the stamp verbatim, nothing fabricated for a suite that
 * left no reading. The CLI's refusals are held too, because a broken input
 * folded into a history is a quietly wrong trend, and the nightly workflow's
 * wiring is pinned the way `collect-budget.test.ts` pins its steps — by
 * reading the workflow source — so a step that stops invoking the recorder, or
 * a commit that drops the pin manifest it must stage beside the history, fails
 * here rather than on a morning when the trend has silently stopped moving.
 */

/** A real-shaped stamp: the chrome half and the data half, joined as the suite writes them. */
const STAMP =
  "rendered-links coverage: chrome — the footer 14, the signed-in header 5 (9 unique destinations) | data — 27 page mounts, 18 unique destinations";

/** The same stamp as it reads inside a row: the joining pipes escaped, as the cell rule escapes them. */
const STAMP_CELL = STAMP.replace(/\|/g, "\\|");

/** A report shaped like `ci.mjs --json` emits it, carrying the stamp. */
const reportWith = (coverageStamp: unknown) => ({ gate: "pass", exitCode: 0, coverageStamp });

describe("the coverage history row", () => {
  it("appends the first row to a fresh scaffold, directly under the empty table", () => {
    const result = appendCoverageRow("", "2026-10-02", STAMP);

    expect(result.action).toBe("appended");
    expect(result.text).toContain(`| 2026-10-02 | ${STAMP_CELL} |`);
    // The row landed inside the table, not after a stray blank line: directly
    // under the alignment row, where every future append will find the table.
    expect(result.text.indexOf("| 2026-10-02 |")).toBeGreaterThan(result.text.indexOf("| :-- |"));
    expect(result.text.startsWith("# Rendered-links coverage history")).toBe(true);
  });

  it("appends a later date after the rows already there, so the trend reads top to bottom", () => {
    const first = appendCoverageRow("", "2026-10-01", STAMP).text;
    const second = appendCoverageRow(first, "2026-10-02", STAMP);

    expect(second.action).toBe("appended");
    expect(second.text.indexOf("| 2026-10-01 |")).toBeLessThan(second.text.indexOf("| 2026-10-02 |"));
  });

  it("replaces the same date's row in place when the reading moved, and only that row", () => {
    const day1 = "rendered-links coverage: chrome — the footer 12 (25 unique destinations)";
    const day1Late = "rendered-links coverage: chrome — the footer 14, the signed-in header 5 (27 unique destinations)";

    const seeded = appendCoverageRow(appendCoverageRow("", "2026-10-01", STAMP).text, "2026-10-02", day1).text;
    const replaced = appendCoverageRow(seeded, "2026-10-02", day1Late);

    expect(replaced.action).toBe("updated");
    const rows = replaced.text.split("\n").filter((line) => line.startsWith("| 2026-10-02 |"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(day1Late);
    // In place: the day's row keeps its position in the trend, so the column
    // reads as a correction of that date, not a second measurement appended.
    expect(replaced.text.indexOf("| 2026-10-01 |")).toBeLessThan(replaced.text.indexOf("| 2026-10-02 |"));
    expect(replaced.text).not.toContain(day1);
  });

  it("changes nothing when the row is already exactly there — a rerun is not a second row", () => {
    const first = appendCoverageRow("", "2026-10-02", STAMP);

    const again = appendCoverageRow(first.text, "2026-10-02", STAMP);

    expect(again.action).toBe("unchanged");
    expect(again.text).toBe(first.text);
  });

  it("escapes the pipes the stamp itself joins its parts with, or they would end the row's cells", () => {
    // The stamp's halves are joined with `" | "` — the one character a Markdown
    // table cell may not carry. Unescaped, the row's date cell would end at the
    // first pipe and the reading would shred into cells that mean nothing.
    const result = appendCoverageRow("", "2026-10-02", STAMP);

    const row = result.text.split("\n").find((line) => line.startsWith("| 2026-10-02 |")) ?? "";
    expect(row).toContain("\\|");
    // A row whose cell escaping held still parses back to exactly two columns.
    expect(row.split(/(?<!\\)\|/)).toHaveLength(4);
  });

  it("starts a blank file from the scaffold, so a missing history is begun rather than failed", () => {
    const fromBlank = appendCoverageRow("", "2026-10-02", STAMP);
    const fromWhitespace = appendCoverageRow("   \n", "2026-10-02", STAMP);

    expect(fromBlank.text).toBe(fromWhitespace.text);
    expect(fromBlank.text).toContain("| Date | Rendered-links coverage |");
  });

  it("refuses a stamp that does not read like one", () => {
    expect(() => appendCoverageRow("", "2026-10-02", "coverage: 27 destinations")).toThrow(/does not read like one/);
    // A bare prefix that says nothing audited is the same refusal: the runner's
    // own reader would never have carried it past its prefix guard.
    expect(() => appendCoverageRow("", "2026-10-02", `${STAMP_PREFIX}   `)).toThrow(/does not read like one/);
    expect(() => appendCoverageRow("", "2026-10-02", 27 as unknown as string)).toThrow(/does not read like one/);
  });

  it("refuses a malformed date rather than filing the reading under nothing", () => {
    expect(() => appendCoverageRow("", "October 2", STAMP)).toThrow(/not a YYYY-MM-DD date/);
    expect(() => appendCoverageRow("", "2026-10-02T00:00:00Z", STAMP)).toThrow(/not a YYYY-MM-DD date/);
  });
});

describe("the scaffold and the committed file", () => {
  const committedPath = fileURLToPath(new URL("../../.freebuff/coverage-history.md", import.meta.url));

  it("is a complete file: the provenance, the hand command, and the empty table", () => {
    const text = scaffold();

    expect(text.startsWith("# Rendered-links coverage history\n")).toBe(true);
    expect(text).toContain("nightly.yml");
    expect(text).toContain("coverage-history.mjs");
    expect(text).toContain("coverageStamp");
    expect(text).toContain("node .freebuff/coverage-history.mjs --report .ci/report.json");
    expect(text).toContain("| Date | Rendered-links coverage |");
    expect(text.endsWith("| :-- | :-- |\n")).toBe(true);
  });

  it("is the prefix of the committed file, however many rows the nights have added", () => {
    // The scaffold is defined once, in the module, and the committed file is
    // that text with rows appended under its table — so the module stays the
    // single source of the file's shape and a hand-edited header fails here
    // with the repair spelled out, rather than drifting from the writer.
    const committed = readFileSync(committedPath, "utf8");

    expect(committed.startsWith(scaffold())).toBe(true);
  });

  it("spells the stamp prefix exactly as the pipeline's two ends do", () => {
    // The prefix is the contract three files share: the suite writes it, the
    // runner's reader guards on it, and the history refuses a stamp without
    // it. The literal is duplicated in the module because `ci.mjs` is not
    // importable for a constant, so this case is what keeps the spellings
    // from forking — a changed stamp contract fails here by name.
    expect(runnerSource).toContain(`startsWith("${STAMP_PREFIX}")`);
    expect(renderedLinksSource).toContain(`${STAMP_PREFIX} $\{parts.join`);
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

  it("appends the report's stamp to the file, and says what it did", () => {
    const report = path.join(dir, "report.json");
    const history = path.join(dir, "history.md");
    writeFileSync(report, JSON.stringify(reportWith(STAMP)));

    const result = run(["--report", report, "--file", history, "--date", "2026-10-02"]);

    expect(result.status).toBe(0);
    expect(readFileSync(history, "utf8")).toContain(`| 2026-10-02 | ${STAMP_CELL} |`);
    expect(result.stderr).toContain("appended 2026-10-02's row");
  });

  it("reruns over the same report without duplicating the day — a dispatch rerun corrects nothing twice", () => {
    const report = path.join(dir, "rerun.json");
    const history = path.join(dir, "rerun.md");
    writeFileSync(report, JSON.stringify(reportWith(STAMP)));
    run(["--report", report, "--file", history, "--date", "2026-10-02"]);
    const before = readFileSync(history, "utf8");

    const result = run(["--report", report, "--file", history, "--date", "2026-10-02"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("already holds 2026-10-02's row — unchanged");
    expect(readFileSync(history, "utf8")).toBe(before);
  });

  it("records nothing for a suite that left no stamp, and calls that a normal night", () => {
    const report = path.join(dir, "nostamp.json");
    const history = path.join(dir, "nostamp.md");
    writeFileSync(report, JSON.stringify({ gate: "fail", exitCode: 1, coverageStamp: null }));
    writeFileSync(history, scaffold());

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("no coverageStamp — nothing to record");
    expect(readFileSync(history, "utf8")).toBe(scaffold());
  });

  it("records nothing for a report with no coverageStamp field at all", () => {
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

  it("is loud about a coverageStamp that is not a string — a broken pipeline, not a quiet night", () => {
    const report = path.join(dir, "numeric.json");
    const history = path.join(dir, "numeric.md");
    writeFileSync(report, JSON.stringify({ gate: "pass", coverageStamp: 42 }));

    const result = run(["--report", report, "--file", history]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is a number, not a string");
  });

  it("refuses an invocation naming two sources for one row, or none", () => {
    const both = run(["--report", "a.json", "--stamp", STAMP]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("two sources for one row");

    const neither = run([]);
    expect(neither.status).toBe(1);
    expect(neither.stderr).toContain("nothing to record");
  });

  it("refuses a hand-passed stamp that does not read like one", () => {
    const result = run(["--stamp", "coverage: 27 destinations", "--file", path.join(dir, "c.md")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not read like one");
  });

  it("records a hand-measured reading on the date it is given", () => {
    const history = path.join(dir, "manual.md");

    const result = run(["--stamp", STAMP, "--file", history, "--date", "2026-09-30"]);

    expect(result.status).toBe(0);
    const row = readFileSync(history, "utf8").split("\n").find((line) => line.startsWith("| 2026-09-30 |"));
    expect(row).toContain(STAMP_CELL);
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
    // A night whose gate crashed before writing a report says so and records
    // nothing — the same fallback shape the publish step above it takes.
    expect(step).toContain("[ -s .ci/report.json ]");
  });

  it("commits the row back, staging the pin manifest beside the history", () => {
    const step = stepBlock("Commit the coverage history");

    expect(step).toContain("if: always()");
    // The doctrine every workflow that commits is held to: whatever commits,
    // commits the manifest with it (the rule `collect-budget.test.ts` states
    // over the whole directory).
    expect(step).toContain("git add .freebuff/coverage-history.md .freebuff/gate-hashes.mjs");
    expect(step).toContain("git commit");
    // The push must not wake the push-triggered jobs in `ci.yml` — a bot
    // commit at night records a reading, it does not start a deploy.
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
