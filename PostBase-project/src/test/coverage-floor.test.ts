import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as floorRules from "../../.freebuff/coverage-floor-rules.mjs";

/**
 * The per-file floor, pinned on fixtures.
 *
 * `.freebuff/coverage-floor.mjs` holds every file to `BASE_FLOOR` on lines and
 * statements, and the pure-logic directories to extra floors on branches and
 * functions. That is three inequalities with exactly one interesting point each
 * — the floor itself. A file sitting *on* it passes (the comparison is `<`, not
 * `<=`, so the boundary is where a report and a gate most easily disagree), a
 * hundredth under fails naming the file and the metric, and only a breach of a
 * *directory* extra is tagged `(directory floor)`. Those thin edges are what the
 * numbers alone cannot show, so they are pinned here.
 *
 * The fixtures are built from `BASE_FLOOR`, `DIRECTORY_FLOORS`, and `EXEMPTIONS`
 * read out of `.freebuff/coverage-floor-rules.mjs`, so the test moves with the
 * numbers instead of keeping a second copy of them. The keys are **relative**
 * (`src/lib/a.ts`): the script matches them the same way the report does, and a
 * relative key is checkout-casing-proof.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(projectRoot, ".freebuff", "coverage-floor.mjs");

const { BASE_FLOOR, DIRECTORY_FLOORS, EXEMPTIONS } = floorRules as unknown as {
  BASE_FLOOR: Record<string, number>;
  DIRECTORY_FLOORS: { prefix: string; floors: Record<string, number> }[];
  EXEMPTIONS: Map<string, string>;
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

/** Every metric above any floor, with the given overrides applied. */
function passing(overrides: Partial<Record<MetricName, number>> = {}): Record<MetricName, number> {
  const percentages = {} as Record<MetricName, number>;
  for (const metric of METRICS) percentages[metric] = 100;
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

/** The extra floors a directory prefix adds, read from the rules module. */
function directoryFloors(prefix: string): Record<string, number> {
  const entry = DIRECTORY_FLOORS.find((candidate) => candidate.prefix === prefix);
  if (!entry) throw new Error(`no directory floor for ${prefix}`);
  return entry.floors;
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "coverage-floor-"));
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

/** Run the floor over a fixture, optionally with extra flags, and read it back. */
function gate(summary: string, extra: string[] = []): { status: number; message: string } {
  const run = spawnSync(process.execPath, [SCRIPT, "--summary", summary, ...extra], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (run.error) throw run.error;
  return { status: run.status ?? -1, message: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/** The threshold column the failure rows print, padded to three characters. */
function belowThreshold(threshold: number): string {
  return `below ${String(threshold).padStart(3)}%`;
}

describe("the per-file coverage floor", () => {
  it("passes a file exactly on the base floor and fails one a hundredth under", () => {
    // `src/components/**` is held only on lines and statements, so a component
    // sitting exactly on the base floor passes even with no branch or function
    // coverage at all — which is the other half of the directory-override story.
    const at = fixture("base-at", {
      "src/components/a.tsx": fileAt(
        passing({
          lines: BASE_FLOOR.lines,
          statements: BASE_FLOOR.statements,
          branches: 0,
          functions: 0,
        }),
      ),
    });
    const ok = gate(at);
    expect(ok.status).toBe(0);
    expect(ok.message).toContain("1 file(s) at or above");
    expect(ok.message).toContain(`${BASE_FLOOR.lines}% lines and statements`);

    const under = BASE_FLOOR.lines - 0.01;
    const below = fixture("base-under", {
      "src/components/a.tsx": fileAt(
        passing({
          lines: under,
          statements: BASE_FLOOR.statements,
          branches: 0,
          functions: 0,
        }),
      ),
    });
    const bad = gate(below);
    expect(bad.status).toBe(1);
    expect(bad.message).toContain("1 file metric(s) below their floor");
    expect(bad.message).toContain(`${under.toFixed(2)}%`);
    expect(bad.message).toContain(belowThreshold(BASE_FLOOR.lines));
    expect(bad.message).toContain("lines");
    // A base breach is not tagged as coming from a directory's extra floors.
    expect(bad.message).not.toContain("(directory floor)");
  });

  it("enforces the src/lib directory override on branches and functions", () => {
    const lib = directoryFloors("src/lib/");
    const at = fixture("lib-at", {
      "src/lib/a.ts": fileAt(
        passing({ branches: lib.branches, functions: lib.functions }),
      ),
    });
    expect(gate(at).status).toBe(0);

    const under = lib.branches - 0.01;
    const bad = fixture("lib-under", {
      "src/lib/a.ts": fileAt(passing({ branches: under })),
    });
    const run = gate(bad);
    expect(run.status).toBe(1);
    expect(run.message).toContain("branches");
    expect(run.message).toContain(`${under.toFixed(2)}%`);
    expect(run.message).toContain(belowThreshold(lib.branches));
    // Only the directory's extra floors carry the tag.
    expect(run.message).toContain("(directory floor)");
  });

  it("enforces the src/utils directory override too", () => {
    const utils = directoryFloors("src/utils/");
    const at = fixture("utils-at", {
      "src/utils/a.ts": fileAt(passing({ branches: utils.branches, functions: utils.functions })),
    });
    expect(gate(at).status).toBe(0);

    const under = utils.functions - 0.01;
    const bad = fixture("utils-under", {
      "src/utils/a.ts": fileAt(passing({ functions: under })),
    });
    const run = gate(bad);
    expect(run.status).toBe(1);
    expect(run.message).toContain("functions");
    expect(run.message).toContain("(directory floor)");
  });

  it("holds an exempt file to the base floor but not the directory extras", () => {
    const [exempt] = [...EXEMPTIONS.keys()];
    // The test is only meaningful if the file sits under a directory that adds
    // extras — otherwise it would pass for the wrong reason.
    expect(DIRECTORY_FLOORS.some((entry) => exempt.startsWith(entry.prefix))).toBe(true);

    // No branch or function coverage at all, and still fine: the extras skip it.
    const extrasFree = fixture("exempt-extras", {
      [exempt]: fileAt(passing({ branches: 0, functions: 0 })),
    });
    expect(gate(extrasFree).status).toBe(0);

    // But the base floor still applies, and a base breach is not tagged.
    const under = BASE_FLOOR.statements - 0.01;
    const bad = fixture("exempt-base", {
      [exempt]: fileAt(passing({ statements: under, branches: 0, functions: 0 })),
    });
    const run = gate(bad);
    expect(run.status).toBe(1);
    expect(run.message).toContain("statements");
    expect(run.message).toContain(belowThreshold(BASE_FLOOR.statements));
    expect(run.message).not.toContain("(directory floor)");
  });

  it("moves the base line with --threshold and leaves the directory floors alone", () => {
    const summary = fixture("threshold", {
      "src/components/a.tsx": fileAt(
        passing({
          lines: BASE_FLOOR.lines,
          statements: BASE_FLOOR.statements,
          branches: 0,
          functions: 0,
        }),
      ),
    });
    expect(gate(summary).status).toBe(0);

    const raised = gate(summary, ["--threshold", String(BASE_FLOOR.lines + 1)]);
    expect(raised.status).toBe(1);
    expect(raised.message).toContain("lines");
    expect(raised.message).toContain(belowThreshold(BASE_FLOOR.lines + 1));
    expect(raised.message).not.toContain("(directory floor)");
  });

  it("rejects a non-numeric --threshold", () => {
    const summary = fixture("threshold-bad", {
      "src/components/a.tsx": fileAt(passing()),
    });
    const run = gate(summary, ["--threshold", "lots"]);
    expect(run.status).toBe(1);
    expect(run.message).toContain("--threshold must be a number");
  });

  it("fails loudly when the report is missing", () => {
    const run = gate(path.join(dir, "does-not-exist.json"));
    expect(run.status).toBe(1);
    expect(run.message).toContain("could not read");
  });
});
