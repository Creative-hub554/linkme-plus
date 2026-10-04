import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as scopesModule from "../../.freebuff/coverage-scopes.mjs";

/**
 * The whole-tree headroom gate, pinned on fixtures.
 *
 * `.freebuff/coverage-headroom.mjs` makes the *gap* the gate: it fails
 * `npm run test:coverage` when the whole-tree aggregate clears its backstop by
 * less than `HEADROOM_TARGET`. That is an inequality with exactly one interesting
 * point — the boundary — and one branch that never runs against the real report,
 * because Vitest always writes the `total` row. So the two things worth pinning
 * are the thin ones the exports above cannot: a tree landing *exactly* on the
 * line passes (the comparison is inclusive, so the boundary is where a report and
 * a gate most easily disagree), a hundredth under fails naming the metric, and a
 * report without a `total` row is summed from its files rather than passed.
 *
 * The fixtures are built from `BACKSTOP` and `HEADROOM_TARGET` read out of
 * `.freebuff/coverage-scopes.mjs`, so the test moves with the numbers instead of
 * pinning a second copy of them. The keys are **relative** (`src/lib/a.ts`): the
 * script matches them the same way the report does, and a relative key is
 * checkout-casing-proof.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(projectRoot, ".freebuff", "coverage-headroom.mjs");
const { BACKSTOP, HEADROOM_TARGET } = scopesModule as unknown as {
  BACKSTOP: Record<string, number>;
  HEADROOM_TARGET: number;
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

/** Enough units that a hundredth of a point is a whole covered count. */
const UNITS = 10000;

/** The percentage a metric sits at when its scope has exactly the target margin. */
function boundary(metric: MetricName): number {
  return BACKSTOP[metric] + HEADROOM_TARGET;
}

/** The target percentages for every metric, with any explicit overrides applied. */
function atBoundary(overrides: Partial<Record<MetricName, number>> = {}): Record<MetricName, number> {
  const percentages = {} as Record<MetricName, number>;
  for (const metric of METRICS) percentages[metric] = boundary(metric);
  return { ...percentages, ...overrides };
}

/** A file whose metrics each read the given percentage, over `UNITS` units. */
function fileAt(percentages: Record<MetricName, number>): FileMetrics {
  const file = {} as FileMetrics;
  for (const metric of METRICS) {
    file[metric] = {
      total: UNITS,
      covered: Math.round((percentages[metric] / 100) * UNITS),
      skipped: 0,
      pct: percentages[metric],
    };
  }
  return file;
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
  dir = mkdtempSync(path.join(tmpdir(), "coverage-headroom-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a summary fixture and return its path. */
function fixture(name: string, body: Record<string, unknown>): string {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(body, null, 2));
  return file;
}

/** Run the gate over a fixture, optionally with extra flags, and read it back. */
function gate(summary: string, extra: string[] = []): { status: number; message: string } {
  const run = spawnSync(process.execPath, [SCRIPT, "--summary", summary, ...extra], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (run.error) throw run.error;
  return { status: run.status ?? -1, message: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

const target = `+${HEADROOM_TARGET.toFixed(2)}`;

describe("the whole-tree headroom gate", () => {
  it("passes a whole tree exactly one point over its backstop", () => {
    const summary = fixture("exact", withTotal({ "src/lib/a.ts": fileAt(atBoundary()) }));
    const { status, message } = gate(summary);

    expect(status).toBe(0);
    // Exactly the target is not "under" it: the comparison is inclusive, so the
    // one point the backstop's own doc promises is the point the gate allows.
    expect(message).toContain("clears its backstop by");
    expect(message).toContain(`by ${target} to ${target} points`);
    expect(message).toContain(`minimum ${HEADROOM_TARGET.toFixed(2)}`);
    expect(message).not.toContain("margin under");
  });

  it("fails a whole tree a hundredth of a point under the target", () => {
    const under = BACKSTOP.lines + HEADROOM_TARGET - 0.01;
    const summary = fixture(
      "just-under",
      withTotal({ "src/lib/a.ts": fileAt(atBoundary({ lines: under })) }),
    );
    const { status, message } = gate(summary);

    expect(status).toBe(1);
    expect(message).toContain("whole-tree margin under");
    // The failure names the offending metric and the margin it really has.
    expect(message).toContain(`${under.toFixed(2)}%`);
    expect(message).toContain(`${(HEADROOM_TARGET - 0.01).toFixed(2)} over`);
    expect(message).toContain("lines");
  });

  it("sums the files itself when the report has no total row", () => {
    // Two files straddling the boundary by five points each, so the aggregate the
    // gate must compute lands exactly on it. The branch under test runs only
    // because there is deliberately no `total` key for the gate to read instead.
    const low = {} as Record<MetricName, number>;
    const high = {} as Record<MetricName, number>;
    for (const metric of METRICS) {
      low[metric] = boundary(metric) - 5;
      high[metric] = boundary(metric) + 5;
    }
    const summary = fixture("no-total", {
      "src/lib/a.ts": fileAt(low),
      "src/lib/b.ts": fileAt(high),
    });
    const { status, message } = gate(summary);

    expect(status).toBe(0);
    expect(message).toContain(`by ${target} to ${target} points`);
  });

  it("honours --minimum over the shared target", () => {
    const summary = fixture("minimum", withTotal({ "src/lib/a.ts": fileAt(atBoundary()) }));
    expect(gate(summary).status).toBe(0);

    // The same tree is under a two-point request, which pins the boundary as
    // relative to the configured minimum rather than to a hard-coded one.
    const stricter = gate(summary, ["--minimum", "2"]);
    expect(stricter.status).toBe(1);
    expect(stricter.message).toContain("margin under 2 point(s)");
  });
});
