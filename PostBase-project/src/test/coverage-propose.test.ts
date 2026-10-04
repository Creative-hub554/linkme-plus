import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The proposer, pinned on fixtures.
 *
 * `.freebuff/coverage-propose.mjs` turns a pull request's coverage delta into
 * proposed threshold raises, and its arithmetic is the whole of it: the tightest
 * integer a scope could be held to (`floor(measured - target)`), which rows that
 * move, and which of those *this* change earned. None of that needs a real
 * coverage run to check — a crafted `coverage-summary.json` is enough — so it is
 * pinned here rather than left to the probes the other coverage scripts use.
 *
 * The fixtures use **relative** keys (`src/lib/a.ts`) on purpose: the script
 * matches them with the same `relative(process.cwd(), file)` the report does, and
 * a relative key resolves to itself whatever the checkout's real casing is — the
 * trap that makes absolute Windows keys awkward in a test.
 *
 * The baseline comparison is pinned per row rather than by a boolean. `earned` is
 * what decides whether a pull request leaves a comment, and it is not a property
 * of a scope's number but of whether *this* change moved it: a raise the base
 * branch already had is slack the change did not create and must not count. So
 * the second describe builds a change that moves one metric and leaves its
 * neighbours alone, parses the raises table it renders, and asserts the `earned`
 * count equals *exactly* the rows whose `Δ` column is positive — a claim that
 * holds whatever the thresholds are, since the expected count comes from the
 * table it is checking.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(projectRoot, ".freebuff", "coverage-propose.mjs");

const METRICS = ["lines", "statements", "branches", "functions"] as const;
type MetricName = (typeof METRICS)[number];

interface MetricCount {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

type FileMetrics = Record<MetricName, MetricCount>;

/** A file whose every metric is the given percentage, over 100 lines. */
function coverage(lines: number, statements = lines, branches = lines, functions = lines): FileMetrics {
  const count = (pct: number): MetricCount => ({ total: 100, covered: pct, skipped: 0, pct });
  return {
    lines: count(lines),
    statements: count(statements),
    branches: count(branches),
    functions: count(functions),
  };
}

/** The summary a run writes: the files plus the `total` row, summed per metric. */
function withTotal(files: Record<string, FileMetrics>): Record<string, unknown> {
  const total = {} as Record<MetricName, MetricCount>;
  for (const metric of METRICS) {
    const covered = Object.values(files).reduce((sum, file) => sum + file[metric].covered, 0);
    const lines = Object.values(files).reduce((sum, file) => sum + file[metric].total, 0);
    total[metric] = { total: lines, covered, skipped: 0, pct: (covered / lines) * 100 };
  }
  return { ...files, total };
}

let dir: string;
// The fixture files are written in `beforeAll`, not in the `describe` body: the
// body runs at collection time, before the temp directory exists.
let baseline: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "coverage-propose-"));
  baseline = fixture("baseline", {
    "src/lib/a.ts": coverage(90, 90, 80, 70),
    "src/components/b.ts": coverage(90, 90, 80, 70),
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a summary fixture and return its path. */
function fixture(name: string, files: Record<string, FileMetrics>): string {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(withTotal(files), null, 2));
  return file;
}

/**
 * Run the proposer over a fixture, with `$GITHUB_OUTPUT` pointed at a scratch
 * file so the workflow's trigger can be read the way the workflow reads it.
 */
function propose(
  args: string[],
): { status: number; output: string; message: string } {
  const outputFile = path.join(dir, "github-output.txt");
  writeFileSync(outputFile, "");
  const proposal = path.join(dir, "proposal.md");
  const run = spawnSync(process.execPath, [SCRIPT, ...args, "--output", proposal], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });
  if (run.error) throw run.error;
  return {
    status: run.status ?? -1,
    output: readFileSync(outputFile, "utf8"),
    message: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/**
 * The raises table the proposal rendered, as its cell arrays, plus the counts on
 * the closing line. Cell 5 is the `Δ` column, which is what "this change moved
 * this row" looks like in the output.
 */
function parseProposal(message: string): { rows: string[][]; available: number; earned: number } {
  const rows = message
    .split("\n")
    .filter((line) => /^\| .* \| (lines|statements|branches|functions) \| /.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()));
  const summary = /coverage-propose: (\d+) raise\(s\) available, (\d+) earned/.exec(message);
  if (!summary) throw new Error("the proposer's closing line was not found");
  return { rows, available: Number(summary[1]), earned: Number(summary[2]) };
}

describe("the coverage threshold proposer", () => {
  it("proposes the tightest integer that keeps a point of headroom", () => {
    const head = fixture("head", {
      "src/lib/a.ts": coverage(98, 98, 90, 80),
      "src/components/b.ts": coverage(90, 90, 80, 70),
    });
    const { status, message } = propose([
      "--summary",
      head,
      "--baseline",
      baseline,
      "--baseline-label",
      "main",
    ]);

    expect(status).toBe(0);
    // `src/lib/**` is held on lines 92; 98% measured leaves room for 97 (a raise
    // of 5), and the Δ column names what the change did.
    expect(message).toContain("| `src/lib/**` | lines | 90.00% | 98.00% | +8.00 | 92 | 97 (+5) |");
    // The whole tree's own row: 94% against the bare 85 backstop, so 93.
    expect(message).toContain(
      "| all `src/**` *(whole-tree backstop)* | lines | 90.00% | 94.00% | +4.00 | 85 | 93 (+8) |",
    );
    // The paste-ready row carries every metric, raised or not.
    expect(message).toContain('"src/lib/**": { lines: 97, statements: 97, branches: 89, functions: 79 },');
  });

  it("leaves a glob with no measured files alone", () => {
    // `aggregate` answers 100% for a scope with zero files, which is a display
    // convention — proposing a raise from it would be proposing a number nothing
    // measured. `src/app/**` matches nothing in this fixture.
    const head = fixture("head-sparse", { "src/lib/a.ts": coverage(98, 98, 90, 80) });
    const { status, message } = propose(["--summary", head]);

    expect(status).toBe(0);
    expect(message).not.toContain("`src/app/**`");
    expect(message).not.toContain("`src/hooks/**`");
    expect(message).toContain("`src/lib/**`");
  });

  it("separates slack the change earned from slack that was already there", () => {
    // The same summary twice: the raises are real, but this change is not what
    // made them possible, so the workflow posts no comment.
    const head = fixture("head-flat", {
      "src/lib/a.ts": coverage(90, 90, 80, 70),
      "src/components/b.ts": coverage(90, 90, 80, 70),
    });
    const { status, output, message } = propose([
      "--summary",
      head,
      "--baseline",
      baseline,
    ]);

    expect(status).toBe(0);
    expect(message).toContain("slack this change did not");
    expect(output).toContain("earned=false");
  });

  it("reports the raises a real improvement earned", () => {
    const head = fixture("head-raised", {
      "src/lib/a.ts": coverage(98, 98, 90, 80),
      "src/components/b.ts": coverage(90, 90, 80, 70),
    });
    const { output } = propose(["--summary", head, "--baseline", baseline]);
    expect(output).toContain("earned=true");
  });

  it("proposes nothing when the target headroom is not reachable", () => {
    const head = fixture("head-small", { "src/lib/a.ts": coverage(93, 93, 90, 80) });
    const { status, output, message } = propose(["--summary", head, "--target", "20"]);

    expect(status).toBe(0);
    expect(message).toContain("Nothing to raise");
    expect(output).toContain("earned=false");
  });

  it("fails loudly when there is no summary to read", () => {
    const { status, message } = propose(["--summary", path.join(dir, "absent.json")]);
    expect(status).toBe(1);
    expect(message).toContain("could not read");
  });
});

describe("the proposer's baseline comparison", () => {
  it("counts as earned exactly the rows this change moved", () => {
    const base = fixture("earned-base", {
      "src/lib/a.ts": coverage(90, 90, 80, 70),
      "src/components/b.ts": coverage(90, 90, 80, 70),
    });
    // Only `src/lib/a.ts` moves — functions 70 → 75. Every other cell is the same
    // number the base branch measured, so only the rows that moved may be earned.
    const head = fixture("earned-head", {
      "src/lib/a.ts": coverage(90, 90, 80, 75),
      "src/components/b.ts": coverage(90, 90, 80, 70),
    });
    const { status, output, message } = propose(["--summary", head, "--baseline", base]);

    expect(status).toBe(0);
    const { rows, available, earned } = parseProposal(message);
    expect(rows.length).toBeGreaterThan(0);

    // The Δ column is the row's own verdict: `src/lib/a.ts` functions and the
    // whole-tree functions it lifts are the only two rows this change moved.
    const moved = rows.filter((cells) => cells[5] !== "+0.00");
    expect(moved.length).toBe(2);

    // The count the workflow comments on is exactly those rows — derived from the
    // table, not written down, so it stays true as the thresholds move.
    expect(available).toBe(rows.length);
    expect(earned).toBe(moved.length);
    // The rest is carried as slack: listed, but named as not this change's.
    expect(message).toContain(`${rows.length - moved.length} of them are slack this change did not`);
    expect(output).toContain("earned=true");
  });

  it("carries a raise the change did not make as slack, not earned", () => {
    // The same summary as its own baseline: the raises are available, but the
    // base branch could have made every one of them, so none is earned and no
    // comment is left.
    const files = {
      "src/lib/a.ts": coverage(90, 90, 80, 70),
      "src/components/b.ts": coverage(90, 90, 80, 70),
    };
    const base = fixture("flat-base", files);
    const head = fixture("flat-head", files);
    const { status, output, message } = propose(["--summary", head, "--baseline", base]);

    expect(status).toBe(0);
    const { rows, earned } = parseProposal(message);
    expect(rows.length).toBeGreaterThan(0);
    // Every row is unchanged, so every raise is pre-existing slack.
    expect(rows.every((cells) => cells[5] === "+0.00")).toBe(true);
    expect(earned).toBe(0);
    expect(message).toContain(`${rows.length} of them are slack this change did not`);
    expect(output).toContain("earned=false");
  });
});
