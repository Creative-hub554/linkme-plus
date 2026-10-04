/// <reference types="vite/client" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The mutation sweep's baseline ratchet, and the half of it that covers the
 * decisions no limb strike reaches.
 *
 * `.freebuff/mutation-guards.mjs --baseline` reads `.freebuff/mutation-baseline.json` and
 * fails when this run has a gap the recorded one does not: a *survivor* the sweep used to
 * have (a guard whose test stopped noticing) and, since the sweep grew an audit, an
 * *un-struck rule* — a decision in `src/test/convention-guards.ts` that a limb strike used
 * to reach and no longer does. The second is the sharper of the two in one direction: a
 * survivor is a gap someone can read in the report, while an un-struck rule is a gap the
 * *strikes* cannot show at all, because a detector that lost one limb still reports and the
 * meta-test that drives it still passes. The ratchet is what makes the audit's list a
 * floor rather than a snapshot: `43 of 55` may fall and may not rise.
 *
 * What this file drives is the real script, through the seams the other sweep suites use:
 *
 *   - `MUTATION_BASELINE_FILE` moves the baseline file into this test's temp directory, so
 *     the recorded baseline — and the ratchet's own run — are the ones under test and never
 *     the developer's file;
 *   - `MUTATION_LOCK_FILE` keeps the run away from the lock a real sweep may be holding;
 *   - `--file=<a scope that matches nothing>` runs the sweep with **no mutation in scope**.
 *
 * That last one is why this suite can test a tree-editing check at all. The sweep's whole
 * job is to rewrite a file, run a test, and put the file back, and a suite that did that to
 * `src/test/convention-guards.ts` while the rest of the tests were reading it would fail
 * some of them for a reason that has nothing to do with them. A scope that matches nothing
 * runs zero mutations and edits nothing, and the un-struck half is read from the detector
 * file directly — the audit is whole-file by construction and is *not* narrowed by `--file`
 * (that is asserted below), so a scoped run compares exactly the same list. Both the
 * direction this ratchet exists for (a recorded rule that lost its strike → exit 1) and the
 * direction it tolerates (a rule that gained one → reported, exit 0) are exercised this way,
 * with nothing on disk disturbed.
 *
 * The one thing that is *not* covered here is the survivor half's `NEW SURVIVORS` branch,
 * which needs a mutation to actually run and therefore a real tree edit. It is left out on
 * purpose rather than fudged: the survivor comparison is unchanged by the un-struck half —
 * the same keys, the same tally, the same wording — and its recorded-baseline direction is
 * asserted below.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sweep = path.join(projectRoot, ".freebuff", "mutation-guards.mjs");

/**
 * A `--file` scope that cannot match a route or a mutation, so the run checks nothing and
 * touches nothing.
 */
const NO_MUTATIONS = "--file=__mutation_baseline_no_such_scope__";

/** What the baseline file holds: the survivors it may not exceed and the rules it may not lose. */
interface RecordedBaseline {
  generatedAt: string;
  note: string;
  survivors: {
    path: string;
    descriptor: string;
    line: number | null;
    kind: string;
    named: string[];
  }[];
  unstruck: { where: string; code: string }[];
}

let workdir = "";
let lockPath = "";

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "mutation-baseline-"));
  lockPath = path.join(workdir, "lock.json");
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** Runs the real sweep with this test's lock and baseline, and no real file at risk. */
function run(args: string[], baselinePath = path.join(workdir, "baseline.json")) {
  return spawnSync(process.execPath, [sweep, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MUTATION_LOCK_FILE: lockPath,
      MUTATION_BASELINE_FILE: baselinePath,
    },
  });
}

/** The audit's own list — the authoritative set of decisions no limb strike reaches. */
function auditEntries(): { where: string; code: string }[] {
  const result = run(["--audit", "--json"]);
  expect(result.status, `the audit failed:\n${result.stderr ?? ""}`).toBe(0);
  const payload = JSON.parse(result.stdout ?? "{}");
  return (payload.unstruck as { where: string; code: string }[]).map(({ where, code }) => ({
    where,
    code,
  }));
}

/** Seeds a baseline file from the audit, with one thing changed. */
function seed(name: string, change: (baseline: RecordedBaseline) => void): string {
  const file = path.join(workdir, name);
  const baseline: RecordedBaseline = {
    generatedAt: new Date().toISOString(),
    note: "seeded by src/test/mutation-baseline.test.ts",
    survivors: [],
    unstruck: auditEntries(),
  };
  change(baseline);
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return file;
}

describe("the sweep's baseline ratchet", () => {
  it("records the un-struck half as the audit lists it, whole-file, however the sweep was scoped", () => {
    const file = path.join(workdir, "written.json");
    const written = run([NO_MUTATIONS, "--write-baseline"], file);

    expect(written.status, `--write-baseline failed:\n${written.stderr ?? ""}`).toBe(0);
    expect(existsSync(file)).toBe(true);
    // The scope matched nothing, so the survivor half is empty — the scoped run records only
    // the survivors it saw. The un-struck half is not the scope's to narrow: it comes from the
    // detector file as a whole, which is what keeps a scoped `--write-baseline` from recording
    // a baseline that would read as a regression the next time the sweep ran in full.
    const recorded = JSON.parse(readFileSync(file, "utf8")) as RecordedBaseline;
    expect(recorded.survivors).toEqual([]);

    const audit = auditEntries();
    expect(audit.length).toBeGreaterThan(0);
    expect(recorded.unstruck).toEqual(audit);
  });

  it("passes when the run matches the baseline, and says what it checked", () => {
    const file = seed("matching.json", () => {});
    const result = run([NO_MUTATIONS, "--baseline"], file);

    expect(result.status, `a matching baseline failed:\n${result.stdout ?? ""}`).toBe(0);
    expect(result.stdout).toContain("Baseline OK");
    expect(result.stdout).toContain("un-struck entry(ies) checked");
  });

  it("fails when a decision the baseline records as un-struck no longer has a limb strike", () => {
    // The recorded baseline says a strike reaches this decision; this run says nothing does.
    // That is the failure the ratchet exists for, and it does not need the sweep to run a
    // single mutation to see it: the list is read from the detector file either way.
    let lost = { where: "", code: "" };
    const file = seed("lost-a-strike.json", (baseline) => {
      lost = baseline.unstruck[baseline.unstruck.length - 1];
      baseline.unstruck = baseline.unstruck.slice(0, -1);
    });
    const result = run([NO_MUTATIONS, "--baseline"], file);

    expect(result.stdout).toContain("Checked 0 mutation(s)");
    expect(result.status, `an un-struck rule was not reported:\n${result.stdout ?? ""}`).toBe(1);
    expect(result.stdout).toContain("NEW UN-STRUCK RULES (1)");
    expect(result.stdout).toContain(`${lost.where}  ${lost.code}`);
  });

  it("reports a rule a strike reaches again without failing, so the gap can only shrink", () => {
    const file = seed("gained-a-strike.json", (baseline) => {
      baseline.unstruck.push({ where: "mount", code: "return [];" });
    });
    const result = run([NO_MUTATIONS, "--baseline"], file);

    expect(
      result.status,
      `a baseline that lost a gap failed:\n${result.stdout ?? ""}`,
    ).toBe(0);
    expect(result.stdout).toContain("Struck since the baseline (1)");
    expect(result.stdout).toContain("mount  return [];");
  });

  it("reports a survivor the run no longer has, and does not fail for it", () => {
    // The survivor half is compared only against the recorded entries it can speak for — the
    // ones whose path the scope matches — so the seeded survivor carries the scope's own name.
    const file = seed("survivor-gone.json", (baseline) => {
      baseline.survivors = [
        {
          path: `src/app/${NO_MUTATIONS.slice("--file=".length)}/route.ts`,
          descriptor: "if (!session) [fail-open]",
          line: 1,
          kind: "guard",
          named: [],
        },
      ];
    });
    const result = run([NO_MUTATIONS, "--baseline"], file);

    expect(result.status, `a resolved survivor failed:\n${result.stdout ?? ""}`).toBe(0);
    expect(result.stdout).toContain("Resolved since the baseline (1)");
    expect(result.stdout).toContain("if (!session) [fail-open]");
  });

  it("says so before failing on a baseline recorded before the un-struck half existed", () => {
    // A file from the version that ratcheted only survivors: it holds no un-struck list, so
    // every rule reads as newly un-struck. Failing closed is right — the file cannot say the
    // gap is the known one — and the message names the one thing that fixes it.
    const file = seed("legacy.json", (baseline) => {
      delete (baseline as Partial<RecordedBaseline>).unstruck;
    });
    const result = run([NO_MUTATIONS, "--baseline"], file);

    expect(result.status, `a legacy baseline passed:\n${result.stdout ?? ""}`).toBe(1);
    expect(result.stdout).toContain("holds no un-struck list");
    expect(result.stdout).toContain("NEW UN-STRUCK RULES");
  });

  it("records a baseline when there is none to compare against, and passes", () => {
    const file = path.join(workdir, "fresh.json");
    rmSync(file, { force: true });
    const result = run([NO_MUTATIONS, "--baseline"], file);

    expect(result.status, `a missing baseline failed:\n${result.stdout ?? ""}`).toBe(0);
    expect(result.stdout).toContain("No baseline existed");
    const recorded = JSON.parse(readFileSync(file, "utf8")) as RecordedBaseline;
    expect(recorded.unstruck).toEqual(auditEntries());
  });

  it("carries the recorded un-struck count on the report payload, so a run past it can warn", () => {
    // The report payload's half of the same floor: `--baseline` compares key by key
    // and fails; a plain `--json` run — the one the nightly gate actually makes —
    // carries both counts so the runner can warn on the run page when this run's gap
    // is past the recorded one. Seeded two rules *below* the audit, so the payload
    // reads the run as `+2` past the floor.
    const file = seed("carried.json", (baseline) => {
      baseline.unstruck = baseline.unstruck.slice(0, -2);
    });
    const result = run([NO_MUTATIONS, "--json"], file);

    expect(result.status, `the report run failed:\n${result.stderr ?? ""}`).toBe(0);
    const payload = JSON.parse(result.stdout ?? "{}") as {
      unstruck: number;
      unstruckBaseline?: number;
    };
    const recorded = JSON.parse(readFileSync(file, "utf8")) as RecordedBaseline;
    const audit = auditEntries();
    expect(payload.unstruck).toBe(audit.length);
    expect(recorded.unstruck).toHaveLength(audit.length - 2);
    // The count rides beside the measurement, read from the same file the ratchet
    // compares against — one floor for both readings.
    expect(payload.unstruckBaseline).toBe(recorded.unstruck.length);
    expect(payload.unstruck - (payload.unstruckBaseline ?? 0)).toBe(2);
  });

  it("carries no baseline count when nothing records one, rather than a zero", () => {
    // The warning may only fire against a floor that exists: a missing file (or one
    // written before the un-struck half joined it) serializes to *no key* on the
    // payload, so a consumer reads "no comparison" rather than "baseline of 0" —
    // which would read every tree as grown past a floor nothing ever recorded.
    const file = path.join(workdir, "absent-for-report.json");
    rmSync(file, { force: true });
    const result = run([NO_MUTATIONS, "--json"], file);

    expect(result.status, `the report run failed:\n${result.stderr ?? ""}`).toBe(0);
    const payload = JSON.parse(result.stdout ?? "{}") as {
      unstruck: number;
      unstruckBaseline?: number;
    };
    expect(payload.unstruck).toBeGreaterThan(0);
    expect("unstruckBaseline" in payload).toBe(false);
  });
});
