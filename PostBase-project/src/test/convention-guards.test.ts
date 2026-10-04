import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONVENTION_GUARDS } from "@/test/convention-guards";
import { EXPECTED_GUARDS } from "./declared-strikes";
import { makeScratchDir, removeScratchDir } from "./scratch";

/**
 * The meta-test for the convention guards.
 *
 * Each guard — mount, settle, body-clear, stylesheet, beat-seam, beat-clock,
 * runbook, client-env, public-vocabulary, client-config, stale-stage-lists — reads a file's source
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
