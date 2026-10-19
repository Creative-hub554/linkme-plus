import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONVENTION_GUARDS } from "@/test/convention-guards";
// The one declaration of this guard's reading: its sidecar, the env seam that can point a run
// at scratch, and the prefix the line carries. Publishing a third reading cost this file an
// import and a close-out — the runner, the run page, the payload shape, the history and
// `.gitignore` all learned nothing about it.
import {
  CONVENTION_GUARDS_READING,
  metricOf,
  readingPath,
} from "../../.freebuff/coverage-readings.mjs";
import { EXPECTED_GUARDS } from "./declared-strikes";
import { makeScratchDir, removeScratchDir } from "./scratch";

/**
 * The meta-test for the convention guards.
 *
 * Each guard — mount, settle, body-clear, stylesheet, beat-seam, beat-clock,
 * runbook, client-env, public-vocabulary, client-config, stale-stage-lists, frozen-scratch,
 * relative-fixture — reads a file's source
 * and fails when it breaks a rule no rendered test can see. A guard is
 * only worth its noise while its detector still *catches* something, and a
 * detector is exactly the kind of code that can stop catching without anyone
 * noticing: a regex that no longer fits the shape it was written for, a filter
 * narrowed one condition too far. Its own test file is the wrong place to
 * notice — that is the author's own fixture, trusted by the same assumption that
 * wrote the detector.
 *
 * So the detectors live in `@/test/convention-guards` with the registry below,
 * and this file drives every one of them against two sources stated side by
 * side: the forbidden shape the guard exists to catch, and the clean shape that
 * replaces it. A guard that has quietly stopped firing fails here, on the
 * forbidden shape, with its own name — rather than passing forever while the
 * rule it documents goes unenforced.
 *
 * The guard test files keep their own richer fixtures; this is the one place
 * that proves each detector fires at all, in one pass, and names the guard if it
 * does not.
 *
 * Firing is only half the claim. The other half is that the check which proves it fires
 * cannot itself go quiet: `npm run mutation:guards` neuters each of these detectors in
 * turn and requires *this* file to fail. So the ids are held against `CONVENTION_GUARDS`
 * here — `EXPECTED_GUARDS`, declared in `./declared-strikes` — and the sweep's `--list` is
 * held against the same declaration, both ways, by the generated case in
 * `src/test/declared-strikes.test.ts`. A guard the registry gains without a declaration,
 * or a declaration no registered guard carries, is a failure in one of the two.
 */

/**
 * Where this guard's close-out leaves its reading: the sidecar its registry entry names.
 *
 * Built from the entry rather than spelled, so the file and the seam a test can point at
 * scratch (`CI_CONVENTION_GUARDS_STAMP_FILE`) are the same declaration the runner reads the
 * line back through.
 */
const readingSidecar = readingPath(
  CONVENTION_GUARDS_READING,
  fileURLToPath(new URL("../..", import.meta.url)),
);

/**
 * The line this guard publishes: which convention guards were exercised, and how many.
 *
 * The answer this file already gives — every guard fired on its forbidden shape and left its
 * clean shape alone — says nothing about *which* guards it drove, and a guard that quietly
 * left `CONVENTION_GUARDS` (or arrived in it with no fixture pair) would leave that sentence
 * exactly as green. The roster is the answer to that: the ids the meta-test actually walked,
 * stated on the run page the way the frozen-scratch pass states the suites it judged. `null`
 * for an empty registry, so the reading is an answer to a question this run asked, never a
 * line written for its own sake.
 */
function conventionGuardsReading(guards: readonly { id: string }[]): string | null {
  if (guards.length === 0) return null;
  const roster = guards.map((guard) => guard.id).sort();
  return (
    `${CONVENTION_GUARDS_READING.prefix} ${roster.length} guard(s) exercised on both of their shapes — ` +
    roster.join(", ")
  );
}

describe("every convention guard", () => {
  it("is registered, so none can fall out of the meta-check", () => {
    const ids = CONVENTION_GUARDS.map((guard) => guard.id).sort();
    expect(
      ids,
      "A convention guard is missing from CONVENTION_GUARDS. Register it there, with its " +
        "forbidden and clean fixtures, or a guard that no longer fires will go unnoticed.",
    ).toEqual([...EXPECTED_GUARDS].sort());
  });

  it("fires on its forbidden shape", () => {
    for (const guard of CONVENTION_GUARDS) {
      expect(guard.detect(guard.forbidden).length, `${guard.id}: ${guard.failure}`).toBeGreaterThan(
        0,
      );
    }
  });

  it("leaves its clean shape alone", () => {
    for (const guard of CONVENTION_GUARDS) {
      expect(guard.detect(guard.clean), `${guard.id}: the clean shape was flagged`).toEqual([]);
    }
  });

  it("states a forbidden shape that is not its own clean shape", () => {
    for (const guard of CONVENTION_GUARDS) {
      // A fixture pair that is the same source proves nothing: the detector
      // could do anything and still pass both checks.
      expect(guard.forbidden, `${guard.id}: forbidden and clean are the same source`).not.toBe(
        guard.clean,
      );
      expect(guard.failure, `${guard.id}: the guard states no failure`).not.toBe("");
    }
  });

  it("states the count the trend charts, in a line the entry's metric reads", () => {
    // The reading is prose the run page prints and a record's number is what the trend plots, so
    // the two have to agree about the same line: the entry declares which number is the
    // measurement, and this is the line the close-out writes — held here, where it is built,
    // rather than assumed by the chart.
    const reading = conventionGuardsReading(CONVENTION_GUARDS);
    expect(reading).not.toBeNull();
    expect(metricOf(CONVENTION_GUARDS_READING, reading as string)).toBe(CONVENTION_GUARDS.length);
  });

  // The reading rides the same channel the rendered-links and frozen-scratch readings do: the
  // console line for a developer's own run, and the sidecar for the CI close, which the runner
  // clears at each attempt and carries in its report by the registry's id. Published from the
  // hook rather than from a case, so a red run still says which guards it judged on its way to
  // the red; fail-silent, because a tree that cannot host the sidecar costs the run page one
  // line and never this guard a test.
  afterAll(() => {
    const reading = conventionGuardsReading(CONVENTION_GUARDS);
    if (reading === null) return;
    console.log(reading);
    try {
      writeFileSync(readingSidecar, `${reading}\n`, "utf8");
    } catch {
      return;
    }
  });
});

/** One stage-order finding the audit answers with through `--stages=check --json`. */
interface OrderFinding {
  file: string;
  line: number | null;
  kind: string;
  detail: string;
}

/**
 * The stage-order guard's fixtures, held against the audit that already owns this rule.
 *
 * `staleStageLists` reads a line the way `node .freebuff/ci.mjs --stages=check` does, and this
 * drives the *same two fixtures* through the real audit — copied tree, real runner, real
 * `--watch-glob` — so the agreement is tested rather than assumed. A fixture only this detector
 * catches would document a rule the runner does not enforce; a fixture only the audit catches
 * would leave the guard's own pair lying about what its detector does. The scratch tree also
 * carries a copy of the audit's watched files, so any finding the run reports has to come from
 * the fixture and not from a half-built tree.
 */
describe("the stale-stage-lists fixtures, against the --stages=check audit", () => {
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const ciRunner = path.join(projectRoot, ".freebuff", "ci.mjs");

  /** The audit's watched files, copied so the fixture is the tree's only difference. */
  const WATCHED_FILES = [
    ".freebuff/ci.mjs",
    ".freebuff/run.md",
    ".freebuff/gate-drift.mjs",
    "src/test/ci-runner.test.ts",
    "src/test/ci-runner-tree-editing.test.ts",
    ".github/workflows/nightly.yml",
  ];

  /** The fixture's path in a scratch tree — named so `--watch-glob` can single it out. */
  const FIXTURE_FILE = "stages-fixture.md";

  /** What the audit says about a tree, through its JSON contract. */
  function auditTree(root: string): { status: number | null; findings: OrderFinding[] } {
    const result = spawnSync(
      process.execPath,
      [ciRunner, "--stages=check", "--json", `--watch-glob=${FIXTURE_FILE}`],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, CI_STAGE_ORDER_ROOT: root },
      },
    );
    expect(result.error, result.error?.message ?? "").toBeUndefined();
    expect(result.stdout, `the audit produced no report:\n${result.stderr ?? ""}`).not.toBe("");
    return {
      status: result.status,
      findings: (JSON.parse(result.stdout) as { findings: OrderFinding[] }).findings,
    };
  }

  it("gives the audit the same answer about both shapes", { timeout: 30000 }, () => {
    const guard = CONVENTION_GUARDS.find((entry) => entry.id === "stale-stage-lists");
    if (guard === undefined) {
      throw new Error("the stale-stage-lists guard is not registered in CONVENTION_GUARDS");
    }

    const root = makeScratchDir("stale-stage-lists-");
    try {
      for (const file of WATCHED_FILES) {
        const target = path.join(root, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(path.join(projectRoot, file), "utf8"), "utf8");
      }

      // The forbidden shape: the audit refuses the tree, and every finding on it is the
      // fixture's own — one for the order, one for the count, both limbs the guard states.
      writeFileSync(path.join(root, FIXTURE_FILE), `${guard.forbidden}\n`, "utf8");
      const refused = auditTree(root);
      expect(refused.status).toBe(1);
      expect(refused.findings.map((finding) => finding.file)).toEqual([
        FIXTURE_FILE,
        FIXTURE_FILE,
      ]);
      expect(refused.findings.map((finding) => finding.kind)).toEqual(["order", "count"]);
      expect(refused.findings[0].detail).toContain("not the canonical order");

      // …and the clean shape repairs it: the same tree, the same audit, nothing to report.
      writeFileSync(path.join(root, FIXTURE_FILE), `${guard.clean}\n`, "utf8");
      const clean = auditTree(root);
      expect(clean.status).toBe(0);
      expect(clean.findings).toEqual([]);
    } finally {
      removeScratchDir(root);
    }
  });
});
