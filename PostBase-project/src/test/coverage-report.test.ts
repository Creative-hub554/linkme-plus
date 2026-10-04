import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import thresholdsImport from "../../.freebuff/coverage-thresholds.mjs";
import * as scopesModule from "../../.freebuff/coverage-scopes.mjs";

/**
 * The report's ⚠, pinned on a crafted summary.
 *
 * `.freebuff/coverage-report.mjs` renders one table row per scope, and the ⚠ on a
 * cell is the only thing on the page that says *a gate is about to fail here*
 * rather than merely *here is a number*. It is drawn from `HEADROOM_TARGET` in
 * `.freebuff/coverage-scopes.mjs` — the same constant the whole-tree gate fails
 * on — so the flag and the red build are one event. That claim needs a behavioral
 * check: the wiring test in `coverage-gates.test.ts` proves the report *reads* the
 * constant, but not what it does with it, and the boundary is where a report and
 * a gate most easily disagree.
 *
 * So this spawns the real script over summaries built to land a scope on either
 * side of the line — one whose margin is exactly `HEADROOM_TARGET`, one a
 * hundredth of a point under — and reads the `src/lib/**` row back. The band is
 * computed from the threshold the report applies, not written down here, so the
 * test moves with the numbers instead of pinning a second copy of them. The keys
 * are **relative** (`src/lib/a.ts`): the script matches them with the same
 * `relative(process.cwd(), file)` the report uses, which resolves to itself
 * whatever the checkout's real casing is.
 *
 * The file's second describe covers the table's other two claims. A directory
 * row's metric cell is the scope's **count-weighted aggregate** beside the
 * threshold that scope is held to — `scopesOf` sums raw counts rather than
 * averaging the rounded per-file percentages, and the cell prints the headroom,
 * not a bare number — so the check builds a scope whose two readings differ. And
 * files **no glob names** get their own row with **no headroom column**, because
 * the whole-tree backstop would say nothing useful about them, so the row prints
 * the bare percentage and appears only when such a file exists.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(projectRoot, ".freebuff", "coverage-report.mjs");
const thresholds = thresholdsImport as unknown as Record<string, Record<string, number>>;
const { HEADROOM_TARGET, DIRECTORY_GLOBS, signed } = scopesModule as unknown as {
  HEADROOM_TARGET: number;
  DIRECTORY_GLOBS: string[];
  signed: (value: number | undefined) => string;
};

const METRICS = ["lines", "statements", "branches", "functions"] as const;
type MetricName = (typeof METRICS)[number];

interface MetricCount {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

type FileMetrics = Record<MetricName, MetricCount>;

/** A file whose every metric reads the given percentage, over `units` units. */
function coverageAt(pct: number, units = 10000): FileMetrics {
  const count = (value: number): MetricCount => ({
    total: units,
    covered: Math.round((value / 100) * units),
    skipped: 0,
    pct: value,
  });
  const value = count(pct);
  return { lines: value, statements: value, branches: value, functions: value };
}

/** The summary a run writes: the files plus the `total` row, summed per metric. */
function withTotal(files: Record<string, FileMetrics>): Record<string, unknown> {
  const total = {} as Record<MetricName, MetricCount>;
  for (const metric of METRICS) {
    const covered = Object.values(files).reduce((sum, file) => sum + file[metric].covered, 0);
    const units = Object.values(files).reduce((sum, file) => sum + file[metric].total, 0);
    total[metric] = { total: units, covered, skipped: 0, pct: (covered / units) * 100 };
  }
  return { ...files, total };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "coverage-report-"));
  // The script writes `.coverage/coverage-report.md` under its working directory;
  // running from the temp dir keeps it off the real report.
  mkdirSync(path.join(dir, ".coverage"), { recursive: true });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a summary fixture from a set of files and return its path. */
function summaryFixture(name: string, files: Record<string, FileMetrics>): string {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(withTotal(files), null, 2));
  return file;
}

/** Write a one-file `src/lib/` summary fixture and return its path. */
function fixture(name: string, pct: number): string {
  return summaryFixture(name, { "src/lib/a.ts": coverageAt(pct) });
}

/** Run the report over a fixture from the temp directory and return its markdown. */
function render(summary: string): { status: number; markdown: string } {
  const run = spawnSync(process.execPath, [SCRIPT, "--summary", summary], {
    cwd: dir,
    encoding: "utf8",
    // Kept deterministic: the summary line and the run link are noise here.
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: "",
      GITHUB_SHA: "",
      GITHUB_REF_NAME: "",
      GITHUB_RUN_ID: "",
      GITHUB_REPOSITORY: "",
    },
  });
  if (run.error) throw run.error;
  return { status: run.status ?? -1, markdown: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/** The rendered table row for a scope, so the assertion is about that row alone. */
function row(markdown: string, label: string): string {
  return markdown.split("\n").find((line) => line.startsWith(`| ${label} `)) ?? "";
}

describe("the coverage report's headroom flag", () => {
  const linesFloor = thresholds["src/lib/**"].lines;

  it("leaves a scope exactly at the target unmarked", () => {
    const atTarget = render(fixture("at-target", linesFloor + HEADROOM_TARGET));
    expect(atTarget.status).toBe(0);

    const lib = row(atTarget.markdown, "`src/lib/**`");
    expect(lib, "the report should have a `src/lib/**` row to read").not.toBe("");
    // Exactly `HEADROOM_TARGET` of margin is not "under" it: the flag is for the
    // cell a shared checkout is about to turn red, and this one has not.
    expect(lib).not.toContain("⚠");
    // And no other cell trips it either, so the absence above is meaningful.
    // (The page's own legend mentions the ⚠ — only the cell form `…) ⚠` is a flag.)
    expect(atTarget.markdown).not.toContain(") ⚠");
  });

  it("marks a scope a hundredth of a point under the target", () => {
    const justUnder = render(fixture("just-under", linesFloor + HEADROOM_TARGET - 0.01));
    expect(justUnder.status).toBe(0);

    const lib = row(justUnder.markdown, "`src/lib/**`");
    expect(
      lib,
      "A margin under `HEADROOM_TARGET` must be flagged — it is the same margin " +
        "`.freebuff/coverage-headroom.mjs` fails the build on.",
    ).toContain("⚠");
    // The flag sits on the offending cell, not merely somewhere on the page.
    const under = (HEADROOM_TARGET - 0.01).toFixed(2);
    expect(lib).toContain(`(+${under}) ⚠`);
  });
});

describe("the coverage report's scope table", () => {
  const linesFloor = thresholds["src/lib/**"].lines;

  it("shows a scope's count-weighted aggregate beside its threshold", () => {
    // Three files, two perfect and one at 73%, so the scope reads 91.00% — a
    // number no single file in it has.
    const summary = summaryFixture("aggregate", {
      "src/lib/a.ts": coverageAt(100),
      "src/lib/b.ts": coverageAt(100),
      "src/lib/c.ts": coverageAt(73),
    });
    const { markdown } = render(summary);
    const lib = row(markdown, "`src/lib/**`");
    expect(lib, "the report should have a `src/lib/**` row to read").not.toBe("");

    const aggregate = (100 + 100 + 73) / 3;
    // The files column counts the scope, and the metric cell is the aggregate
    // and its headroom over the threshold the report applies — computed from the
    // imported number, not written down here.
    expect(lib).toContain("| 3 |");
    expect(lib).toContain(`${aggregate.toFixed(2)}% (${signed(aggregate - linesFloor)})`);
  });

  it("weights the aggregate by raw counts, not the mean of the percentages", () => {
    // 75% over 20000 units and 100% over 10000: count-weighted 83.33%, but the
    // plain mean is 87.50 — so the row proves which one `aggregate` computes.
    const summary = summaryFixture("weighted", {
      "src/lib/a.ts": coverageAt(75, 20000),
      "src/lib/b.ts": coverageAt(100, 10000),
    });
    const { markdown } = render(summary);
    const lib = row(markdown, "`src/lib/**`");

    const weighted = (75 * 200 + 100 * 100) / 300;
    expect(lib).toContain(`${weighted.toFixed(2)}%`);
    expect(lib).not.toContain("87.50%");
  });

  it("renders one row per configured scope plus the whole-tree backstop", () => {
    const summary = summaryFixture("scopes", { "src/lib/a.ts": coverageAt(100) });
    const { markdown } = render(summary);

    expect(row(markdown, "all `src/**` *(whole-tree backstop)*")).not.toBe("");
    for (const glob of DIRECTORY_GLOBS) {
      expect(row(markdown, `\`${glob}\``), `no row for the ${glob} scope`).not.toBe("");
    }
  });

  it("gives files no glob names a row of their own, without a headroom", () => {
    const summary = summaryFixture("unmatched", {
      "src/lib/a.ts": coverageAt(100),
      "src/other/a.ts": coverageAt(100),
      "src/other/b.ts": coverageAt(50),
    });
    const { markdown } = render(summary);
    const unmatched = row(markdown, "no glob *(backstop only)*");
    expect(unmatched).not.toBe("");

    // The two files no glob named, aggregated to 75.00%.
    const aggregate = (100 + 50) / 2;
    expect(unmatched).toContain("| 2 |");
    expect(unmatched).toContain(`${aggregate.toFixed(2)}%`);
    // No headroom column: the whole-tree backstop says nothing about these files,
    // so the cell is the bare percentage rather than a `% (+x.xx)` pair.
    expect(unmatched).not.toContain("% (");
  });

  it("omits the unmatched row when every file is named by a glob", () => {
    const summary = summaryFixture("all-matched", { "src/lib/a.ts": coverageAt(100) });
    const { markdown } = render(summary);
    expect(row(markdown, "no glob *(backstop only)*")).toBe("");
  });
});
