/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMITTED_BASELINES,
  COMMITTED_IMPORT_BUDGET,
  MIN_SOFT_THRESHOLD,
  STALE_BAND_HEADROOM,
  aggregateSamples,
  collectBudgetBreaches,
  collectCeilingFor,
  importBudgetFor,
  importStaleThresholds,
  lowerImportBaselines,
  measuredImportCosts,
  medianCollect,
  nextSoftThreshold,
  proposalChanges,
  renderBaselines,
  renderProposal,
  slowestCollects,
  softWarnings,
  staleBaseline,
  staleGates,
  staleHighBaselines,
  staleSoftBand,
  TRACKED_IMPORTS,
  worstUsed,
  type CollectSample,
  type CommittedBaselines,
  type ImportBudget,
  type ModuleTiming,
} from "@/test/collect-budget";
// The propose launcher, as source: the repeat count and the fail-closed check are
// what make the proposal noise-proof, and they live in a plain script a test
// cannot otherwise reach.
import proposeLauncherSource from "../../.freebuff/propose-collect-baselines.mjs?raw";
// The committed baseline, both as values and as source: the values drive the
// default budget, and the source is compared to what the record step writes so a
// hand-edited file cannot sit there as if it had been recorded.
import {
  importBaselines,
  importMarginMs,
  softThreshold,
} from "../../.freebuff/collect-budget-baselines.mjs";
import baselineSource from "../../.freebuff/collect-budget-baselines.mjs?raw";
// The sidecar contract the reporter and the CI runner share, so a warning a green
// run leaves behind is turned into an annotation rather than dropped.
import { SOFT_GATE_FILE, softGateDetails } from "../../.freebuff/collect-budget-soft.mjs";
// The apply contract: the payload a proposal carries, the tighten-only merge that
// turns it into the baselines file, and the command and markers the workflow and
// this suite both name. The shared renderer is imported under a distinct name so
// a test can prove it still agrees byte for byte with the reporter's own.
import {
  APPLY_COMMAND,
  APPLY_REPLY_MARKER,
  PROPOSAL_MARKER,
  applyProposal,
  parseProposalState,
  renderBaselines as renderBaselinesShared,
  renderProposalState,
} from "../../.freebuff/collect-apply.mjs";
// The apply launcher, as source: it is the script that rewrites a *pinned* gate file,
// and the re-pin it has to do in the same breath is part of the contract — but running
// it for real writes checked-in files, so its shape is pinned here and the behaviour of
// the re-pin itself is pinned in `gate-drift.test.ts`, against fixture trees.
import applyScriptSource from "../../.freebuff/apply-collect-baselines.mjs?raw";
// The record launcher, as source: it is what writes the baselines on a recording run,
// so the re-pin that keeps the manifest describing them belongs to it — and running it
// for real means running the whole suite, so its shape is pinned here instead.
import recordLauncherSource from "../../.freebuff/record-collect-baselines.mjs?raw";
// The manifest renderer, and the two helpers the checks below need: a manifest that cannot
// record what the applier wrote (the refusal), one that can (the commit the workflow makes),
// and the hash comparison that proves the two files moved together.
import { hashFile, rel, renderManifest } from "../../.freebuff/gate-drift.mjs";
// The workflow that acts on the command, as source: its guard and its markers
// have to match the constants above, and nothing else would notice if one drifted.
import applyWorkflowSource from "../../.github/workflows/collect-apply.yml?raw";
import ciWorkflowSource from "../../.github/workflows/ci.yml?raw";
// Every workflow, so the rule about committing a pinned file can be stated over the whole
// directory rather than over the one file that happens to obey it today.
import nightlyWorkflowSource from "../../.github/workflows/nightly.yml?raw";
// The two proposal writers, as source: each comment step hands `gh` the file its writer
// declares, and neither writer can be imported for its constant — both are scripts whose
// top level does the work — so the declared path is read out of the source instead.
import coverageProposeSource from "../../.freebuff/coverage-propose.mjs?raw";
import collectProposeSource from "../../.freebuff/propose-collect-baselines.mjs?raw";
// The summary renderer's own marker and output path: the workflow posts the file it
// writes, so the marker the poster greps for, and the path it hands `gh` as the body,
// both have to be the ones the renderer emits.
import { REPORT_PATH, SUMMARY_MARKER } from "../../.freebuff/collect-gates.mjs";
// The poster's own derivation of a body's redaction record: the artifact lists below are held
// to that function rather than to a path a hand kept in step with it.
import { recordPathFor } from "../../.freebuff/pr-comment.mjs";

/** The committed baselines as a plain map, so a loop over tracked modules can index them. */
const committedBaselines: Readonly<Record<string, number>> = importBaselines;
// The reporter as *source*: its `onTestRunEnd` cannot be reached from a test
// (it only runs in the main process, over the whole run), so the guarantee that
// it still reads the diagnostic and fails the process is pinned by reading it.
import reporterSource from "./collect-budget.ts?raw";

/**
 * The coverage proposer's marker, which its module declares privately.
 *
 * `.freebuff/coverage-propose.mjs` writes its proposal and its `earned` output as it is
 * imported, so it cannot be imported for a constant; the checks below read the declaration
 * out of its source instead, which is why the literal is spelled once, here, and matched
 * against both that source and the workflow that greps for it.
 */
const COVERAGE_PROPOSAL_MARKER = "<!-- coverage-threshold-proposal -->";

/** A module timing with everything under its budgets, to be mutated per case. */
function timing(overrides: Partial<ModuleTiming> = {}): ModuleTiming {
  return { file: "src/test/some.test.ts", collect: 10, imports: [], ...overrides };
}

/**
 * An import budget for fixtures: it names both tracked modules with small
 * recorded costs, so the arithmetic is legible without depending on whatever the
 * committed file happens to hold today.
 */
const IMPORT_BUDGET: ImportBudget = {
  baselines: { "src/test/module-index.ts": 10, "src/test/source-scan.ts": 8 },
  marginMs: 50,
};

/** The apply launcher and the file it writes — for the one case that runs it for real. */
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const applyScript = fileURLToPath(
  new URL("../../.freebuff/apply-collect-baselines.mjs", import.meta.url),
);
const baselineFile = fileURLToPath(
  new URL("../../.freebuff/collect-budget-baselines.mjs", import.meta.url),
);
/** The alarm itself, run for real below over the manifest the applier leaves behind. */
const driftScript = fileURLToPath(new URL("../../.freebuff/gate-drift.mjs", import.meta.url));
/**
 * The pull-request body the applier writes on a successful apply — git-ignored, and the one
 * artifact a real run of that path leaves in the tree, so the case below puts back whatever
 * it found (or removes what it wrote) rather than leaving scratch behind.
 */
const pullRequestBodyFile = fileURLToPath(
  new URL("../../.freebuff/collect-apply-pr.md", import.meta.url),
);

describe("medianCollect", () => {
  it("takes the middle collect of an odd run", () => {
    expect(medianCollect([timing({ collect: 30 }), timing({ collect: 10 }), timing({ collect: 20 })])).toBe(
      20,
    );
  });

  it("averages the two middles of an even run", () => {
    expect(medianCollect([timing({ collect: 10 }), timing({ collect: 40 })])).toBe(25);
  });

  it("is zero for an empty run, so the floors take over", () => {
    expect(medianCollect([])).toBe(0);
  });
});

describe("collectCeilingFor", () => {
  it("scales a src/test file by the tighter multiple of the median", () => {
    // Fourteen times the run's median, once the median is past the floor.
    expect(collectCeilingFor("src/test/rendered-a11y.test.tsx", 200)).toBe(2800);
  });

  it("scales a file elsewhere in the app by the looser multiple", () => {
    // The app's route tests legitimately collect further above the median:
    // importing a handler pulls in the real client stack.
    expect(collectCeilingFor("src/app/api/posts/route.test.ts", 200)).toBe(3400);
    expect(collectCeilingFor("src/components/ui/button.test.tsx", 200)).toBe(3400);
  });

  it("never drops below the floor, however fast the run", () => {
    // A focused or mostly-cached run has a median small enough that the multiple
    // alone would pin a real file to a ceiling load can cross. The floor is the
    // backstop that keeps the budget from being tighter than the machine allows.
    expect(collectCeilingFor("src/test/rendered-a11y.test.tsx", 10)).toBe(2000);
    expect(collectCeilingFor("src/app/api/posts/route.test.ts", 10)).toBe(2600);
  });

  it("finds `src/test` in an absolute path, either platform's separators", () => {
    // Vitest reports an absolute module id, and this reporter is loaded by path
    // rather than from `import.meta.url`, where it could not know the root. The
    // `/src/` marker is what tells the two kinds of file apart.
    expect(collectCeilingFor("C:/repo/src/test/x.test.tsx", 200)).toBe(2800);
    expect(collectCeilingFor("C:\\repo\\src\\test\\x.test.tsx", 200)).toBe(2800);
    expect(collectCeilingFor("C:/repo/src/app/x.test.tsx", 200)).toBe(3400);
  });
});

describe("collectBudgetBreaches", () => {
  it("reports nothing when every file is under its ceiling", () => {
    const breached = collectBudgetBreaches(
      [timing(), timing({ file: "src/app/x.test.ts", collect: 1500 })],
      200,
    );
    expect(breached).toEqual([]);
  });

  it("flags a src/test file whose collect crosses the tighter ratio ceiling", () => {
    const breaches = collectBudgetBreaches([timing({ collect: 2900 })], 200);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ kind: "collect", ms: 2900, budget: 2800 });
  });

  it("does not flag an app file at the same collect, which is under its own ceiling", () => {
    // The two shapes are the point: the same number is over one budget and under
    // the other, so location is what decides.
    const breaches = collectBudgetBreaches([timing({ file: "src/app/x.test.ts", collect: 2900 })], 200);
    expect(breaches).toEqual([]);
  });

  it("flags a collect that crossed the looser app ceiling too", () => {
    const breaches = collectBudgetBreaches([timing({ file: "src/app/x.test.ts", collect: 3500 })], 200);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ kind: "collect", budget: 3400 });
  });

  it("lifts the ceiling with the run's median, so load alone cannot trip a file", () => {
    // The same collect is over the budget in a quiet run and under it in a busy
    // one. That is the whole reason to normalize by the median instead of fixing
    // a number the busiest machine has to fit under.
    const quiet = collectBudgetBreaches([timing({ collect: 2900 })], 180);
    expect(quiet).toHaveLength(1);
    expect(quiet[0].budget).toBe(2520); // 14 × 180, above the 2000 floor

    expect(collectBudgetBreaches([timing({ collect: 2900 })], 300)).toEqual([]);
  });

  it("defaults the median to the run's own when none is given", () => {
    // The reporter passes the median it already computed, but the check has to
    // stand alone too: with a single module its own collect is the median, and
    // the multiple makes it far too large to fire.
    expect(collectBudgetBreaches([timing({ collect: 2900 })])).toEqual([]);
  });

  it("flags a test file that pays more than the recorded cost plus the margin", () => {
    // The sharp signal: the imported scanners cost a few milliseconds, so a
    // returning glob — which makes a file register the whole tree — trips this
    // long before the file's own collect ceiling.
    const breaches = collectBudgetBreaches(
      [timing({ collect: 400, imports: [{ path: "src/test/module-index.ts", total: 900 }] })],
      undefined,
      IMPORT_BUDGET,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ kind: "import", ms: 900, budget: 60 });
    expect(breaches[0].detail).toContain("module-index.ts");
  });

  it("flags a tracked import however the path is spelled", () => {
    // The reporter normalizes first, but the match is on the path's tail either
    // way, so a change to the normalization cannot silently stop tracking.
    const breaches = collectBudgetBreaches(
      [timing({ imports: [{ path: "C:/repo/src/test/source-scan.ts", total: 250 }] })],
      undefined,
      IMPORT_BUDGET,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0].kind).toBe("import");
  });

  it("takes the dearest import of a tracked module, not the cheapest", () => {
    const breaches = collectBudgetBreaches(
      [
        timing({
          imports: [
            { path: "src/test/module-index.ts", total: 5 },
            { path: "src/test/module-index.ts", total: 400 },
          ],
        }),
      ],
      undefined,
      IMPORT_BUDGET,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0].ms).toBe(400);
  });

  it("leaves an import under the recorded cost plus the margin alone", () => {
    const breaches = collectBudgetBreaches(
      [timing({ imports: [{ path: "src/test/module-index.ts", total: 50 }] })],
      undefined,
      IMPORT_BUDGET,
    );
    expect(breaches).toEqual([]);
  });

  it("does not track an unrelated import, however slow", () => {
    const breaches = collectBudgetBreaches(
      [timing({ imports: [{ path: "src/lib/db/client.ts", total: 900 }] })],
      undefined,
      IMPORT_BUDGET,
    );
    expect(breaches).toEqual([]);
  });
});

describe("the stale-baseline check", () => {
  it("flags a recorded cost far above what the tree measures", () => {
    // The direction the ratchet cannot correct: it lowers a baseline a run beats
    // and never raises one, so a number that is too *high* has nothing pushing it
    // down until something fails. A baseline raised by hand to silence a breach,
    // or recorded on the one day a scanner was slow, would otherwise sit there
    // keeping the gate loose for good.
    expect(staleBaseline(40, 2)).toBe(true);
    expect(staleBaseline(12, 2)).toBe(true);
  });

  it("stays quiet within a few milliseconds of the measurement", () => {
    // One run is one noisy sample on a shared machine, so a baseline a little
    // above a single reading is the ordinary case rather than a stale gate — a
    // check that failed on it would be useless exactly where it has to run.
    expect(staleBaseline(4, 2)).toBe(false);
    expect(staleBaseline(8, 2)).toBe(false);
    expect(staleBaseline(10, 2)).toBe(false);
  });

  it("does not let a sub-millisecond reading condemn a reasonable baseline", () => {
    // The absolute clearance is what makes the ratio safe: a warm cache can put
    // an import far below its usual cost, and that is not evidence of staleness.
    expect(staleBaseline(6, 0.5)).toBe(false);
    expect(staleBaseline(11, 0.5)).toBe(true);
  });

  it("is a report, not a breach: one run notes it without failing", () => {
    // The direction the ratchet cannot correct is the one thing a single run may
    // not fail on — one reading is one noisy sample of a wall-clock quantity, and
    // the repeated `collect:propose` session is what confirms it.
    const breaches = collectBudgetBreaches(
      [timing({ imports: [{ path: "src/test/module-index.ts", total: 2 }] })],
      undefined,
      { baselines: { "src/test/module-index.ts": 40, "src/test/source-scan.ts": 2 }, marginMs: 50 },
    );
    expect(breaches).toEqual([]);
  });

  it("names the loose module and both numbers, for the run report", () => {
    expect(
      staleHighBaselines({ "src/test/module-index.ts": 40 }, { "src/test/module-index.ts": 2 }),
    ).toEqual([
      { kind: "import", name: "src/test/module-index.ts", recorded: 40, measured: 2 },
    ]);
  });

  it("judges the dearest reading, so every run of a session has to agree", () => {
    // The session aggregates by worst case, and the staleness threshold rises with
    // the measurement — so judging the dearest reading is what makes one quietly
    // fast run unable to condemn a baseline the others would not.
    const measured = measuredImportCosts([
      timing({ imports: [{ path: "src/test/module-index.ts", total: 2 }] }),
      timing({ imports: [{ path: "src/test/module-index.ts", total: 12 }] }),
    ]);
    // 40ms is 3.3× the dearest reading of the session, which is not stale...
    expect(staleHighBaselines({ "src/test/module-index.ts": 40 }, measured)).toEqual([]);
    // ...where the same recorded number against the quiet run alone would be.
    expect(
      staleHighBaselines({ "src/test/module-index.ts": 40 }, { "src/test/module-index.ts": 2 }),
    ).toHaveLength(1);
  });

  it("says nothing about a module the measurement never mentions", () => {
    // No measurement is not a measurement of zero, so a focused run over unrelated
    // files must not condemn every baseline in the file — and a rename must not
    // quietly drop one from the check either.
    expect(
      staleHighBaselines({ "src/test/module-index.ts": 40, "src/test/source-scan.ts": 40 }, {}),
    ).toEqual([]);
  });

  it("says nothing about a baseline the file does not name", () => {
    expect(staleHighBaselines({}, { "src/test/module-index.ts": 1 })).toEqual([]);
  });
});

describe("the published import staleness boundary", () => {
  it("draws each module's boundary with the very rule staleBaseline uses", () => {
    // The run summary prints this number beside a baseline, so it has to be the one
    // that judged it. Pinned by behaviour: a recorded value a hair over the boundary
    // is stale, a hair under it is not.
    const measured = { "src/test/module-index.ts": 3.1, "src/test/source-scan.ts": 2 };
    const limits = importStaleThresholds(measured);
    expect(limits["src/test/module-index.ts"]).toBeCloseTo(12.4, 5);
    // Under the floor the ratio would be below the absolute clearance, so the floor is
    // what the boundary actually is.
    expect(limits["src/test/source-scan.ts"]).toBe(10);
    for (const [tracked, cost] of Object.entries(measured)) {
      const limit = limits[tracked];
      expect(staleBaseline(limit + 0.01, cost), tracked).toBe(true);
      expect(staleBaseline(limit, cost), tracked).toBe(false);
    }
  });

  it("says nothing about a module the run never imported", () => {
    // No measurement is not a measurement of zero, so a boundary for it would be a
    // number nobody could compare anything against.
    expect(importStaleThresholds({})).toEqual({});
  });
});

describe("the stale warning band check", () => {
  it("flags a band that warns far later than the tightest file the run saw", () => {
    // The band exists to warn *before* a file breaches. One recorded at 0.9 while
    // the tree's worst file uses a third of its budget warns nobody of anything —
    // and the ratchet only moves it when someone happens to run the recorder.
    expect(staleSoftBand(0.9, 0.34)).toBe(true);
    // Also on a loaded run, where the tightest file gets most of the way to the
    // band: the clearance is sized for exactly that, since a loaded CI runner is
    // where the judgment has to hold.
    expect(staleSoftBand(0.9, 0.52)).toBe(true);
  });

  it("stays quiet for the recorder's own margin above the tightest file", () => {
    // `nextSoftThreshold` sets the band a margin above the tightest file, and the
    // committed band sits a little above that again — housekeeping, not a gate that
    // has gone slack.
    expect(staleSoftBand(0.58, 0.34)).toBe(false);
    expect(staleSoftBand(0.58, 0.52)).toBe(false);
    expect(staleSoftBand(0.55, 0.3)).toBe(false);
  });

  it("draws its boundary at a fixed headroom, which the run report publishes", () => {
    // The run summary prints this number beside a run's headroom, so it has to be the
    // boundary the check actually draws rather than a second copy of it. Pinned by
    // behaviour: a run a hair inside the published headroom is not stale, a hair
    // outside it is.
    const threshold = 0.95;
    const boundary = threshold - STALE_BAND_HEADROOM;
    expect(staleSoftBand(threshold, boundary + 0.01)).toBe(false);
    expect(staleSoftBand(threshold, boundary - 0.01)).toBe(true);
    // The judged floor is the same shape of number: a run at it is judged, a run
    // below it is not, so the summary can print the word rather than a boundary.
    expect(staleSoftBand(threshold, MIN_SOFT_THRESHOLD)).toBe(true);
    expect(staleSoftBand(threshold, MIN_SOFT_THRESHOLD - 0.001)).toBe(false);
    // And the reporter publishes both, rather than the summary restating constants
    // it cannot import.
    expect(reporterSource).toContain("staleBandHeadroom");
    expect(reporterSource).toContain("STALE_BAND_HEADROOM");
    expect(reporterSource).toContain("bandJudgedFrom");
    expect(reporterSource).toContain("MIN_SOFT_THRESHOLD");
  });

  it("cannot be failed by machine speed or load alone", () => {
    // A faster machine shrinks every collect, so the tightest file falls and the
    // band looks looser without anything about the tree having changed; a loaded one
    // pushes it the other way. Across that whole range the committed band is never
    // moved more than the clearance — and a run too quiet to judge at all is not
    // judged, rather than being counted as evidence.
    for (const worst of [0.52, 0.45, 0.34, 0.3, 0.2, 0.1, 0.05, 0]) {
      expect(staleSoftBand(0.58, worst), `worst ${worst}`).toBe(false);
    }
  });

  it("does not judge the band against a run that never got near it", () => {
    // A focused run collects one file far from its ceiling, so the recorder would
    // clamp its target to the floor rather than reading the tree — nothing about the
    // band is learned from that, and pretending otherwise would have every focused
    // run calling the committed band loose.
    expect(staleSoftBand(0.58, 0.06)).toBe(false);
    expect(staleSoftBand(0.95, 0.06)).toBe(false);
  });

  it("reaches the run report, naming the value and both readings", () => {
    const baseline: CommittedBaselines = {
      importMarginMs: 50,
      softThreshold: 0.9,
      importBaselines: { "src/test/module-index.ts": 4, "src/test/source-scan.ts": 2 },
    };
    expect(
      staleGates(baseline, { measured: { "src/test/module-index.ts": 3 }, tightest: 0.35 }),
    ).toEqual([{ kind: "band", name: "softThreshold", recorded: 0.9, measured: 0.35 }]);
  });

  it("lists the loose imports and the loose band together", () => {
    const baseline: CommittedBaselines = {
      importMarginMs: 50,
      softThreshold: 0.9,
      importBaselines: { "src/test/module-index.ts": 40, "src/test/source-scan.ts": 2 },
    };
    const stale = staleGates(baseline, {
      measured: { "src/test/module-index.ts": 3, "src/test/source-scan.ts": 2 },
      tightest: 0.35,
    });
    expect(stale.map((entry) => [entry.kind, entry.name])).toEqual([
      ["import", "src/test/module-index.ts"],
      ["band", "softThreshold"],
    ]);
  });
});

describe("importBudgetFor", () => {
  it("is the recorded baseline plus the margin", () => {
    expect(importBudgetFor("src/test/module-index.ts", IMPORT_BUDGET)).toBe(60);
    expect(importBudgetFor("src/test/source-scan.ts", IMPORT_BUDGET)).toBe(58);
  });

  it("defaults to the committed baseline file's numbers", () => {
    expect(importBudgetFor("src/test/module-index.ts")).toBe(
      importBaselines["src/test/module-index.ts"] + importMarginMs,
    );
  });

  it("holds an unnamed tracked module to the margin alone", () => {
    // A new tracked scanner is still held to a small number before the recorder
    // gives it a baseline, rather than slipping through with no budget at all.
    expect(importBudgetFor("src/test/brand-new.ts", IMPORT_BUDGET)).toBe(50);
  });
});

describe("slowestCollects", () => {
  // At a 200ms median the app file's ceiling is 3400 and the src/test file's is
  // 2800, so the src/test file is nearer its budget (61%) despite collecting
  // less (1700ms to the app file's 2000ms).
  const heavy = timing({ file: "src/app/big.test.ts", collect: 2000 });
  const creeping = timing({ file: "src/test/creep.test.ts", collect: 1700 });

  it("orders by the fraction of the budget used, not raw milliseconds", () => {
    // Ordering by raw milliseconds would keep naming the same heavy route tests
    // and hide the file that is actually moving toward its ceiling.
    const rows = slowestCollects([heavy, creeping], 200);
    expect(rows.map((row) => row.file)).toEqual([
      "src/test/creep.test.ts",
      "src/app/big.test.ts",
    ]);
    expect(rows[0].used).toBeCloseTo(1700 / 2800, 5);
    expect(rows[1].used).toBeCloseTo(2000 / 3400, 5);
  });

  it("carries each file's own ceiling, so the report can show both numbers", () => {
    const [first] = slowestCollects([creeping], 200);
    expect(first).toMatchObject({ collect: 1700, ceiling: 2800 });
  });

  it("keeps only the requested number of files", () => {
    expect(slowestCollects([heavy, creeping], 200, 1)).toHaveLength(1);
    expect(slowestCollects([heavy, creeping], 200)[0].file).toBe("src/test/creep.test.ts");
  });
});

describe("softWarnings", () => {
  // At a 200ms median a src/test file's ceiling is 2800: 2240ms is exactly 80% of
  // it, 2400ms is over, and 2000ms is under.
  const under = timing({ file: "src/test/under.test.ts", collect: 2000 });
  const exact = timing({ file: "src/test/exact.test.ts", collect: 2240 });
  const over = timing({ file: "src/test/over.test.ts", collect: 2400 });

  it("names every file at or over the threshold, tightest first", () => {
    expect(softWarnings([under, exact, over], 200, 0.8).map((row) => row.file)).toEqual([
      "src/test/over.test.ts",
      "src/test/exact.test.ts",
    ]);
  });

  it("includes a file sitting exactly on the threshold", () => {
    expect(softWarnings([exact], 200, 0.8).map((row) => row.file)).toEqual([
      "src/test/exact.test.ts",
    ]);
  });

  it("leaves a file under the threshold out of the notice", () => {
    expect(softWarnings([under], 200, 0.8)).toEqual([]);
  });

  it("takes an explicit threshold, so the band is not baked in", () => {
    expect(softWarnings([under], 200, 0.5).map((row) => row.file)).toEqual([
      "src/test/under.test.ts",
    ]);
  });

  it("defaults to the committed, recorded threshold", () => {
    // A row a millisecond over the committed threshold is in and one a
    // millisecond under is out, whatever that recorded number currently is — so
    // the test pins that the default is the file's value without freezing it.
    const on = timing({ file: "src/test/on.test.ts", collect: 2800 * softThreshold + 1 });
    const below = timing({ file: "src/test/below.test.ts", collect: 2800 * softThreshold - 1 });
    expect(softWarnings([on, below], 200).map((row) => row.file)).toEqual(["src/test/on.test.ts"]);
  });
});

describe("worstUsed", () => {
  it("is the largest fraction of a budget any file used", () => {
    // At a 200ms median the src/test ceiling is 2800 and the app one is 3400.
    const rows = [
      timing({ file: "src/test/a.test.ts", collect: 1400 }), // 0.5 of 2800
      timing({ file: "src/app/b.test.ts", collect: 1700 }), // 0.5 of 3400
      timing({ file: "src/test/c.test.ts", collect: 2100 }), // 0.75 of 2800
    ];
    expect(worstUsed(rows, 200)).toBeCloseTo(0.75, 5);
  });

  it("is zero for an empty run, so the threshold cannot move on one", () => {
    expect(worstUsed([], 200)).toBe(0);
  });
});

describe("nextSoftThreshold", () => {
  it("drops to a margin above the tightest file", () => {
    expect(nextSoftThreshold(0.8, 0.4)).toBeCloseTo(0.6, 5);
  });

  it("never raises the threshold, however busy the run", () => {
    // A loaded run that saw a file at 0.9 must not loosen a band a quiet run set
    // at 0.5: the recorder only ever tightens.
    expect(nextSoftThreshold(0.5, 0.9)).toBe(0.5);
  });

  it("will not tighten past the floor, however comfortable the tree", () => {
    expect(nextSoftThreshold(0.8, 0.05)).toBe(0.3);
  });

  it("takes an explicit margin", () => {
    expect(nextSoftThreshold(0.8, 0.4, 0.1)).toBeCloseTo(0.5, 5);
  });

  it("rounds the proposal to two decimals", () => {
    // Keeps a stable number in the committed file rather than a fresh noise tail.
    expect(nextSoftThreshold(0.8, 0.3817)).toBe(0.58);
  });
});

describe("the soft-gate sidecar", () => {
  it("names the file the reporter writes and the runner reads", () => {
    expect(SOFT_GATE_FILE).toBe(".collect-budget-soft.json");
  });

  it("turns a warning into a WARN detail that pins the file", () => {
    const [detail] = softGateDetails([
      { file: "src/app/x.test.ts", collect: 2552, ceiling: 2686, used: 0.95 },
    ]);
    expect(detail).toMatchObject({
      mark: "WARN",
      name: "src/app/x.test.ts",
      location: { file: "src/app/x.test.ts" },
    });
    expect(detail.detail).toContain("95%");
    expect(detail.detail).toContain("2552ms");
  });

  it("survives a malformed warning rather than crashing the runner", () => {
    const [detail] = softGateDetails([{ file: "src/app/y.test.ts" }]);
    expect(detail).toMatchObject({ mark: "WARN", name: "src/app/y.test.ts" });
    expect(detail.detail).toContain("0%");
  });
});

describe("the baseline ratchet", () => {
  it("lowers a recorded baseline to what the run measured", () => {
    expect(lowerImportBaselines({ a: 10 }, { a: 4 })).toEqual({ a: 4 });
  });

  it("never raises one, so a regression cannot be recorded away", () => {
    // The direction is the point: if this run measured 9ms against a recorded 4,
    // the recorder keeps 4 and the gate stays where it was — the regression has
    // to be fixed, not absorbed.
    expect(lowerImportBaselines({ a: 4 }, { a: 9 })).toEqual({ a: 4 });
  });

  it("keeps a module the run did not import", () => {
    expect(lowerImportBaselines({ a: 4, b: 2 }, { a: 1 })).toEqual({ a: 1, b: 2 });
  });

  it("adds a module the baseline does not yet name", () => {
    expect(lowerImportBaselines({ a: 4 }, { a: 4, b: 3 })).toEqual({ a: 4, b: 3 });
  });

  it("rounds a measured cost to whole milliseconds", () => {
    expect(lowerImportBaselines({}, { a: 3.6 })).toEqual({ a: 4 });
  });

  it("measures the dearest import across the run, skipping modules none imported", () => {
    const measured = measuredImportCosts([
      timing({ imports: [{ path: "src/test/module-index.ts", total: 3 }] }),
      timing({
        imports: [
          { path: "src/test/module-index.ts", total: 7 },
          { path: "src/test/source-scan.ts", total: 2 },
        ],
      }),
    ]);
    expect(measured).toEqual({ "src/test/module-index.ts": 7, "src/test/source-scan.ts": 2 });
  });
});

describe("the collect-budget proposal", () => {
  const committed: CommittedBaselines = {
    importMarginMs: 50,
    softThreshold: 0.6,
    importBaselines: { "src/test/module-index.ts": 4, "src/test/source-scan.ts": 2 },
  };
  const lowered: CommittedBaselines = {
    importMarginMs: 50,
    softThreshold: 0.45,
    importBaselines: { "src/test/module-index.ts": 3, "src/test/source-scan.ts": 2 },
  };

  it("lists only the values the run beat, threshold first", () => {
    expect(proposalChanges(committed, lowered)).toEqual([
      { kind: "band", name: "softThreshold", from: 0.6, to: 0.45, stale: false },
      { kind: "import", name: "src/test/module-index.ts", from: 4, to: 3, stale: false },
    ]);
  });

  it("is empty when nothing beat its committed value", () => {
    expect(proposalChanges(committed, committed)).toEqual([]);
  });

  it("marks a brand-new baseline as having no committed value", () => {
    const next: CommittedBaselines = {
      ...committed,
      importBaselines: { ...committed.importBaselines, "src/test/new.ts": 1 },
    };
    expect(proposalChanges(committed, next)).toEqual([
      { kind: "import", name: "src/test/new.ts", from: undefined, to: 1, stale: false },
    ]);
  });

  it("flags a baseline the run measured far below as stale-high", () => {
    // The other direction the gate fails on: the committed number is so far above
    // what the run measured that the gate is red on it, and the ratchet lowering it
    // is a fix rather than a tidy-up. The proposal has to say which of the two a
    // row is, because the diff alone cannot.
    const loose: CommittedBaselines = {
      ...committed,
      importBaselines: { ...committed.importBaselines, "src/test/module-index.ts": 40 },
    };
    const fixed: CommittedBaselines = {
      ...loose,
      importBaselines: { ...loose.importBaselines, "src/test/module-index.ts": 3 },
    };
    expect(proposalChanges(loose, fixed, { "src/test/module-index.ts": 3 })).toEqual([
      { kind: "import", name: "src/test/module-index.ts", from: 40, to: 3, stale: true },
    ]);
  });

  it("flags a band the run's tightest file left far behind", () => {
    // The same direction for the other recorded value: the diff cannot say whether
    // a lower threshold is housekeeping or a band that has stopped warning anyone.
    const loose: CommittedBaselines = { ...committed, softThreshold: 0.9 };
    const fixed: CommittedBaselines = { ...loose, softThreshold: 0.6 };
    expect(proposalChanges(loose, fixed, {}, 0.4)).toEqual([
      { kind: "band", name: "softThreshold", from: 0.9, to: 0.6, stale: true },
    ]);
    // With no measurement the caller marks nothing: an unmarked change claims no
    // more than "this could be tighter".
    expect(proposalChanges(loose, fixed)[0].stale).toBe(false);

    // And the callout reads it in the band's own units — a percentage of a budget,
    // not milliseconds — and names the band the recorder would set rather than
    // claiming a measurement it does not hold.
    const markdown = renderProposal(proposalChanges(loose, fixed, {}, 0.4), fixed);
    expect(markdown).toContain("the warning band is recorded at 90% of a budget");
    expect(markdown).toContain("the recorder would set it to 60%");
    expect(markdown).toContain("| `softThreshold` **(stale)** | 0.9 | 0.6 |");
  });

  it("leaves an ordinary drop unmarked even when the run measured it", () => {
    // 4ms to 3ms is the ratchet working as designed, not a loose gate: the
    // staleness floor has to keep ordinary micro-drift out of the callout.
    expect(proposalChanges(committed, lowered, { "src/test/module-index.ts": 3 }, 0.4)).toEqual([
      { kind: "band", name: "softThreshold", from: 0.6, to: 0.45, stale: false },
      { kind: "import", name: "src/test/module-index.ts", from: 4, to: 3, stale: false },
    ]);
  });

  it("renders a marker-tagged table a workflow can comment", () => {
    const markdown = renderProposal(proposalChanges(committed, lowered), lowered);
    expect(markdown).toContain(PROPOSAL_MARKER);
    expect(markdown).toContain("| `softThreshold` | 0.6 | 0.45 |");
    expect(markdown).toContain("| `src/test/module-index.ts` | 4 | 3 |");
    expect(markdown).toContain("Nothing here is applied");
  });

  it("still renders a body when there is nothing to propose", () => {
    const markdown = renderProposal([], committed);
    expect(markdown).toContain(PROPOSAL_MARKER);
    expect(markdown).toContain("Nothing to record");
  });

  it("calls a stale-high baseline out above the table, as a red gate", () => {
    const loose: CommittedBaselines = {
      ...committed,
      importBaselines: { ...committed.importBaselines, "src/test/module-index.ts": 40 },
    };
    const fixed: CommittedBaselines = {
      ...loose,
      importBaselines: { ...loose.importBaselines, "src/test/module-index.ts": 3 },
    };
    const markdown = renderProposal(
      proposalChanges(loose, fixed, { "src/test/module-index.ts": 3 }),
      fixed,
    );
    expect(markdown).toContain("A loose gate, not a tidy-up");
    expect(markdown).toContain("recorded at 40ms, this run measured 3ms");
    // The row is marked too, so a reader skimming the table still sees it.
    expect(markdown).toContain("| `src/test/module-index.ts` **(stale)** | 40 | 3 |");
    // And the payload still rides along, so the same reply applies the fix.
    expect(markdown).toContain(APPLY_COMMAND);
  });

  it("adds no stale callout to an ordinary tightening", () => {
    const markdown = renderProposal(
      proposalChanges(committed, lowered, { "src/test/module-index.ts": 3 }),
      lowered,
    );
    expect(markdown).not.toContain("A loose gate");
    expect(markdown).not.toContain("(stale)");
  });

  it("says how many runs a repeated proposal held across", () => {
    const markdown = renderProposal(proposalChanges(committed, lowered), lowered, 3);
    expect(markdown).toContain("held across 3 runs");
  });

  it("makes no such claim for a single-sample proposal", () => {
    // A plain `npm run collect:propose` is one sample, and the comment must not
    // claim a confirmation it does not have.
    const markdown = renderProposal(proposalChanges(committed, lowered), lowered);
    expect(markdown).not.toContain("held across");
  });
});

describe("aggregateSamples", () => {
  const quiet: CollectSample = { measured: { "src/test/module-index.ts": 3 }, tightest: 0.4 };
  const busy: CollectSample = { measured: { "src/test/module-index.ts": 5 }, tightest: 0.52 };
  const other: CollectSample = { measured: { "src/test/source-scan.ts": 2 }, tightest: 0.31 };

  it("takes the worst case of each module, so a drop must hold in every run", () => {
    // The dearest the module was ever measured at is what the ratchet sees: one
    // quiet run reporting 3ms cannot propose a drop the 5ms run would not confirm.
    expect(aggregateSamples([quiet, busy])).toEqual({
      measured: { "src/test/module-index.ts": 5 },
      tightest: 0.52,
    });
  });

  it("keeps a module only some of the samples measured, at its dearest", () => {
    expect(aggregateSamples([quiet, other]).measured).toEqual({
      "src/test/module-index.ts": 3,
      "src/test/source-scan.ts": 2,
    });
  });

  it("takes the tightest file of the worst run, not an average of them", () => {
    expect(aggregateSamples([quiet, other, busy]).tightest).toBe(0.52);
  });

  it("is empty for no samples, so a session that measured nothing proposes nothing", () => {
    expect(aggregateSamples([])).toEqual({ measured: {}, tightest: 0 });
  });
});

describe("the proposal payload", () => {
  const lowered: CommittedBaselines = {
    importMarginMs: 50,
    softThreshold: 0.45,
    importBaselines: { "src/test/module-index.ts": 3, "src/test/source-scan.ts": 2 },
  };
  const committed: CommittedBaselines = {
    importMarginMs: 50,
    softThreshold: 0.6,
    importBaselines: { "src/test/module-index.ts": 4, "src/test/source-scan.ts": 2 },
  };

  it("round-trips the values a run earned", () => {
    expect(parseProposalState(renderProposalState(lowered))).toEqual({
      softThreshold: 0.45,
      importBaselines: lowered.importBaselines,
    });
  });

  it("rides inside the proposal comment, so the applied values are the reviewed ones", () => {
    // Applying reads the values out of the comment rather than re-measuring, so a
    // separate machine cannot substitute a different tightening for the approved
    // one — which only holds if the payload survives the round trip through the
    // comment body.
    const markdown = renderProposal(proposalChanges(committed, lowered), lowered);
    expect(parseProposalState(markdown)).toEqual({
      softThreshold: 0.45,
      importBaselines: lowered.importBaselines,
    });
    expect(markdown).toContain(APPLY_COMMAND);
  });

  it("carries no payload when there is nothing to propose", () => {
    expect(parseProposalState(renderProposal([], committed))).toBeNull();
  });

  it("is null for anything that is not a well-formed payload", () => {
    // Every failure is one answer, because the caller is only deciding whether to
    // apply — and a malformed payload on a public pull request must never throw.
    expect(parseProposalState("no marker here")).toBeNull();
    expect(parseProposalState("<!-- collect-budget-proposal-state {")).toBeNull();
    expect(parseProposalState("<!-- collect-budget-proposal-state not json -->")).toBeNull();
    expect(parseProposalState('<!-- collect-budget-proposal-state {"softThreshold":2} -->')).toBeNull();
    expect(parseProposalState('<!-- collect-budget-proposal-state {"softThreshold":0.4} -->')).toBeNull();
    expect(parseProposalState(undefined)).toBeNull();
  });
});

describe("applyProposal", () => {
  const committed: CommittedBaselines = {
    importMarginMs: 50,
    softThreshold: 0.6,
    importBaselines: { "src/test/module-index.ts": 4, "src/test/source-scan.ts": 2 },
  };

  it("lowers each value to the payload's and reports the change", () => {
    const { baselines, changed } = applyProposal(committed, {
      softThreshold: 0.45,
      importBaselines: { "src/test/module-index.ts": 3, "src/test/source-scan.ts": 2 },
    });
    expect(changed).toBe(true);
    expect(baselines).toEqual({
      importMarginMs: 50,
      softThreshold: 0.45,
      importBaselines: { "src/test/module-index.ts": 3, "src/test/source-scan.ts": 2 },
    });
  });

  it("keeps the hand-set margin, which is not the payload's to move", () => {
    const { baselines } = applyProposal(committed, { softThreshold: 0.45, importBaselines: {} });
    expect(baselines.importMarginMs).toBe(50);
  });

  it("is unchanged when the payload equals what the file already holds", () => {
    // What makes a second approval of the same proposal a no-op instead of a
    // second commit.
    const { changed } = applyProposal(committed, {
      softThreshold: 0.6,
      importBaselines: { "src/test/module-index.ts": 4, "src/test/source-scan.ts": 2 },
    });
    expect(changed).toBe(false);
  });

  it("refuses to raise a recorded baseline rather than clamping it", () => {
    expect(() =>
      applyProposal(committed, {
        softThreshold: 0.6,
        importBaselines: { "src/test/module-index.ts": 9 },
      }),
    ).toThrow(/raise/);
  });

  it("refuses to raise the soft threshold", () => {
    expect(() => applyProposal(committed, { softThreshold: 0.9, importBaselines: {} })).toThrow(
      /raise/,
    );
  });

  it("adds a tracked module the baseline does not yet name", () => {
    const { baselines } = applyProposal(committed, {
      softThreshold: 0.6,
      importBaselines: { "src/test/new.ts": 3 },
    });
    expect(baselines.importBaselines["src/test/new.ts"]).toBe(3);
  });
});

describe("the apply contract", () => {
  it("keeps the workflow's command and reply marker in step with the constants", () => {
    expect(applyWorkflowSource).toContain(APPLY_COMMAND);
    expect(applyWorkflowSource).toContain(APPLY_REPLY_MARKER);
    // The reply must never carry the command: the workflow matches on that text,
    // so its own reply would arm the trigger again.
    expect(APPLY_REPLY_MARKER).not.toContain(APPLY_COMMAND);
  });

  it("keeps the proposal marker in step with the job that posts it", () => {
    expect(ciWorkflowSource).toContain(PROPOSAL_MARKER);
  });

  it("keeps the summary marker in step with the step that posts it", () => {
    expect(ciWorkflowSource).toContain(SUMMARY_MARKER);
  });

  it("hands each body and marker to the shared poster, from the writer's own declaration", () => {
    // All three comment steps delegate to `.freebuff/pr-comment.mjs`, so the file guard, the
    // marker lookup and the post-or-patch live in one place that has its own tests
    // (`src/test/pr-comment.test.ts`). What is pinned here is what each step hands it: the
    // body is the file the writer declares and the marker is the one that writer's markdown
    // opens with, so a step cannot come to point at a different file, or to grep for a marker
    // nothing emits. The two proposers are read as source because neither can be imported —
    // both write files and step outputs as they run.
    expect(ciWorkflowSource).toContain(`--body ${REPORT_PATH}`);
    expect(ciWorkflowSource).toContain(`--marker '${SUMMARY_MARKER}'`);

    expect(ciWorkflowSource).toContain("--body .coverage/coverage-proposal.md");
    expect(coverageProposeSource).toContain(
      `const PROPOSAL_PATH = ".coverage/coverage-proposal.md";`,
    );
    expect(ciWorkflowSource).toContain(`--marker '${COVERAGE_PROPOSAL_MARKER}'`);
    expect(coverageProposeSource).toContain(`const MARKER = "${COVERAGE_PROPOSAL_MARKER}";`);

    expect(ciWorkflowSource).toContain("--body .freebuff/collect-budget-proposal.md");
    expect(ciWorkflowSource).toContain(`--marker '${PROPOSAL_MARKER}'`);
    // The reporter is what writes that markdown, inside the run — it imports the marker
    // rather than carrying a copy, and lands the file the workflow above names.
    expect(reporterSource).toContain("PROPOSAL_MARKER");      expect(reporterSource).toContain('"collect-budget-proposal.md"');
      expect(collectProposeSource).toContain('"collect-budget-proposal.md"');
  });

  it("keeps each body's redaction record in the artifact that carries the body", () => {
    // The poster writes the record beside the body it scrubbed, and it is only useful where the
    // raw text already is: the two have to ride in one upload, or the comparison the record exists
    // for cannot be made. The path comes from the poster's own function, so a rename moves this
    // check with it rather than leaving a hand-copied path behind to rot.
    for (const body of [
      REPORT_PATH,
      ".coverage/coverage-proposal.md",
      ".freebuff/collect-budget-proposal.md",
    ]) {
      const record = recordPathFor(body);
      expect(ciWorkflowSource).toContain(record);
      expect(artifactFor(ciWorkflowSource, body), `no artifact uploads ${body}`).toContain(record);
    }
  });

  it("posts nothing itself, only through the one guarded poster", () => {
    // The three steps used to inline the `gh` call, and the copies had already drifted: two
    // of them handed `gh` a path without checking it, under `continue-on-error`. A step that
    // inlines it again fails here, and the poster's own test is what proves the guard such a
    // step would have skipped.
    expect(ciWorkflowSource.split("node .freebuff/pr-comment.mjs").length - 1).toBe(3);
    expect(ciWorkflowSource).not.toContain("body=@");
  });

  it("routes the apply job's reply through the same poster", () => {
    // The fourth comment the workflows post, and the one a reviewer is most likely to be
    // waiting on: its text is composed in the step rather than rendered to a file, so it
    // goes through `--text` — and through the same guard, so a blank reply is announced on
    // the run page rather than posted as an empty comment. `gh api -X` appearing here again
    // is the failure: that is the day this comment starts drifting from the other three.
    expect(applyWorkflowSource).toContain("node .freebuff/pr-comment.mjs");
    expect(applyWorkflowSource).toContain(`marker='${APPLY_REPLY_MARKER}'`);
    expect(applyWorkflowSource).toContain('--marker "$marker"');
    expect(applyWorkflowSource).toContain('--text "$body"');
    expect(applyWorkflowSource).not.toContain("gh api -X");
    // One implementation, called once: the reply is posted, and posted in one place.
    expect(applyWorkflowSource.split("node .freebuff/pr-comment.mjs").length - 1).toBe(1);
  });

  it("stages the gate manifest in the same commit as the baselines", () => {
    // The baselines are a pinned gate file, so the commit that writes them has to carry
    // the hash that describes them. Committing one without the other is exactly the state
    // `npm run gates:drift` refuses, and the alarm is right to refuse it — this is the
    // half of the contract that only reads the workflow.
    expect(applyWorkflowSource).toContain(
      "git add .freebuff/collect-budget-baselines.mjs .freebuff/gate-hashes.mjs",
    );
    expect(applyWorkflowSource).toContain("\n              drift)");
  });

  it("checks the pin over the tree it is about to commit, and lets the reply say so", () => {
    // The alarm is what the two-file commit is *for*, and this job is the only place it can
    // run over that commit: a pull request opened with `GITHUB_TOKEN` starts no workflows, so
    // `ci.yml`'s drift stage never sees it. So the job runs the same command the stage does,
    // and gates the commit on it — belt and braces beside the applier's own re-pin, which is
    // what makes the check cheap enough to be unconditional.
    expect(applyWorkflowSource).toContain("run: node .freebuff/gate-drift.mjs");
    expect(applyWorkflowSource).toContain(
      "if: steps.apply.outputs.changed == 'true' && steps.verify.outcome == 'success'",
    );
    // And the reply cannot report a pull request that was never opened: the verification's
    // own outcome takes precedence over the applier's `applied`, and it has a case of its own.
    expect(applyWorkflowSource).toContain(
      "STATUS: ${{ steps.verify.outcome == 'failure' && 'unverified' || steps.apply.outputs.status }}",
    );
    expect(applyWorkflowSource).toContain("\n              unverified)");
  });

  it("escapes every backtick in the reply, which is a double-quoted shell string", () => {
    // The summaries are assigned inside `"…"`, so a backtick that is not escaped is command
    // substitution: bash would try to *run* the path it wraps, and under `set -e` the reply
    // step would exit before posting anything — which is the one outcome the reply exists to
    // prevent, on exactly the refusal paths a reader most needs to see. Found in the `drift`
    // summary, which predates this case.
    const start = applyWorkflowSource.indexOf('case "$STATUS" in');
    const end = applyWorkflowSource.indexOf("esac", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const bare = applyWorkflowSource
      .slice(start, end)
      .split("\n")
      .filter((line) => /(^|[^\\])`/.test(line));
    expect(bare).toEqual([]);
  });

  it("lets no workflow commit a pinned file without the manifest that describes it", () => {
    // The rule the apply job's two-file `git add` is an instance of, stated as a property of
    // the directory so a *future* job cannot reintroduce the defect by being written fresh:
    // whatever commits, commits the manifest with it. Today the only `git commit` in
    // `.github/workflows` is the apply job's, which is what makes this pass — but a nightly
    // job taught to commit a re-pinned baseline, or a formatter job that commits a gate
    // script, would land exactly the tree the drift alarm refuses.
    const workflows: Record<string, string> = {
      "ci.yml": ciWorkflowSource,
      "collect-apply.yml": applyWorkflowSource,
      "nightly.yml": nightlyWorkflowSource,
    };
    for (const [name, source] of Object.entries(workflows)) {
      if (!source.includes("git commit")) continue;
      expect(source, `${name} commits without staging .freebuff/gate-hashes.mjs`).toContain(
        ".freebuff/gate-hashes.mjs",
      );
    }
  });

  it("re-pins what it wrote through the alarm's own targeted write", () => {
    // The applier is what actually does it, and it does it through `repin` rather than a
    // whole-tree `--write`: a script that blessed every file in the checkout would absorb
    // somebody else's loosening, which is the failure the alarm exists for.
    expect(applyScriptSource).toContain('from "./gate-drift.mjs"');
    expect(applyScriptSource).toContain("await repin([baselineKey])");
    // ...and that it puts the baselines back when the pin will not record them, so the
    // two files move together or neither does.
    expect(applyScriptSource).toContain("renderBaselines(committed)");
  });

  it("puts the baselines back and reports `drift` when the pin cannot record them", () => {
    // The one path that can be exercised for real without leaving a checked-in file
    // changed: the applier writes the baselines, the targeted re-pin refuses against a
    // fixture manifest that pins nothing, and the write is undone.
    const dir = mkdtempSync(path.join(tmpdir(), "collect-apply-"));
    const manifest = path.join(dir, "gate-hashes.mjs");
    writeFileSync(
      manifest,
      renderManifest({
        algorithm: "sha1",
        watches: [{ dir: ".freebuff", pattern: "^collect-budget-baselines\\.mjs$" }],
        files: {},
      }),
    );
    const manifestBefore = readFileSync(manifest, "utf8");
    const proposed = { softThreshold: softThreshold * 0.9, importBaselines: {} };
    const body = renderProposalState(proposed);
    const before = readFileSync(baselineFile, "utf8");
    const applied = renderBaselinesShared(
      applyProposal({ importMarginMs, softThreshold, importBaselines }, proposed).baselines,
    );

    try {
      const result = spawnSync(process.execPath, [applyScript, "--body", body], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GATE_HASHES_FILE: manifest,
          GITHUB_OUTPUT: path.join(dir, "output"),
          GITHUB_STEP_SUMMARY: path.join(dir, "summary"),
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("collect:apply: drift");
      expect(result.stdout).toContain("npm run gates:pin");
      // The workflow reads these, and a refusal must never read as something to commit.
      const output = readFileSync(path.join(dir, "output"), "utf8");
      expect(output).toContain("changed=false");
      expect(output).toContain("status=drift");
      // Both files or neither: the baselines are byte for byte what they were, and the
      // manifest was not written either.
      expect(readFileSync(baselineFile, "utf8")).toBe(before);
      expect(readFileSync(manifest, "utf8")).toBe(manifestBefore);
    } finally {
      // Belt and braces, and deliberately narrow: only the applier's own half-finished
      // write is undone, so a concurrent `collect:record` is never clobbered by a test.
      if (readFileSync(baselineFile, "utf8") === applied) writeFileSync(baselineFile, before);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the pin describing the baselines it wrote, so the commit it opens is green", () => {
    // The other half of the refusal above, and the half the workflow's `git commit` actually
    // rests on: a refusal is safe by construction, but an *applied* run only avoids a red tree
    // if the manifest it hands the `git add` describes the baselines it just wrote. The fixture
    // manifest pins the real baselines file (a watch rule resolves against the project root),
    // so the targeted re-pin has something to refresh — and then the real alarm is run against
    // that manifest, which is the same check the branch would fail if the two files had gone in
    // out of step. `GATE_CONTENT_DIR` keeps the check's stash in the fixture directory, so a
    // test never writes the cache a real run reads.
    const dir = mkdtempSync(path.join(tmpdir(), "collect-apply-applied-"));
    const manifest = path.join(dir, "gate-hashes.mjs");
    const key = rel(baselineFile);
    writeFileSync(
      manifest,
      renderManifest({
        algorithm: "sha1",
        watches: [{ dir: ".freebuff", pattern: "^collect-budget-baselines\\.mjs$" }],
        files: { [key]: hashFile(baselineFile) },
      }),
    );
    const pinnedBefore = hashFile(baselineFile);
    const before = readFileSync(baselineFile, "utf8");
    const bodyBefore = existsSync(pullRequestBodyFile)
      ? readFileSync(pullRequestBodyFile, "utf8")
      : null;
    const proposed = { softThreshold: softThreshold * 0.9, importBaselines: {} };
    const applied = renderBaselinesShared(
      applyProposal({ importMarginMs, softThreshold, importBaselines }, proposed).baselines,
    );

    try {
      const result = spawnSync(
        process.execPath,
        [applyScript, "--body", renderProposalState(proposed)],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GATE_HASHES_FILE: manifest,
            GATE_CONTENT_DIR: path.join(dir, "content"),
            GITHUB_OUTPUT: path.join(dir, "output"),
            GITHUB_STEP_SUMMARY: path.join(dir, "summary"),
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("collect:apply: applied");
      // What the workflow reads before it stages anything.
      expect(readFileSync(path.join(dir, "output"), "utf8")).toContain("changed=true");

      // Both files moved, and the hash moved to describe the file: one commit's worth.
      expect(readFileSync(baselineFile, "utf8")).toBe(applied);
      expect(hashFile(baselineFile)).not.toBe(pinnedBefore);
      expect(readFileSync(manifest, "utf8")).toContain(hashFile(baselineFile));

      // And the alarm agrees — which is the property the commit rests on, and the one that
      // would be missing if the applier wrote the baselines and left the pin alone.
      const checked = spawnSync(process.execPath, [driftScript, "--json"], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GATE_HASHES_FILE: manifest,
          GATE_CONTENT_DIR: path.join(dir, "content"),
        },
      });
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
      expect(JSON.parse(checked.stdout).gate).toBe("pass");

      // And the body the workflow hands `gh pr create` describes the lowering it applied,
      // rather than being an artifact nobody read.
      expect(readFileSync(pullRequestBodyFile, "utf8")).toContain("| `softThreshold` |");
    } finally {
      // Same narrow restore as the refusal case: only this case's own write is undone, so a
      // concurrent `collect:record` is never clobbered by a test. The pull-request body is
      // git-ignored, but it is still this case's scratch, so it goes back too.
      if (readFileSync(baselineFile, "utf8") === applied) writeFileSync(baselineFile, before);
      if (bodyBefore === null) rmSync(pullRequestBodyFile, { force: true });
      else writeFileSync(pullRequestBodyFile, bodyBefore);
      rmSync(dir, { recursive: true, force: true });
    }
    // The chain is two real spawns — the applier and then the full drift alarm over its
    // re-pinned manifest, a 50-file hash of the real tree — riding the default 5s. Under
    // full-suite load that is contention-flake territory, so the case holds the same
    // budget the spawn count earns elsewhere: facts, not speed.
  }, 60_000);

  it("names the drift it leaves alone instead of refusing to record its own file", () => {
    // The case a shared checkout produces every day: the applier's own file is fine and
    // something *unrelated* in the tree is not. The re-pin records the baselines it was asked
    // about — so its two files still move together — and reports the rest, because absorbing
    // it is the one thing a targeted re-pin must not do. The fixture makes the unrelated file
    // drift without touching it: the manifest records a hash that file does not have, which is
    // exactly what "pinned, and no longer matching" looks like to the alarm.
    const dir = mkdtempSync(path.join(tmpdir(), "collect-apply-left-"));
    const manifest = path.join(dir, "gate-hashes.mjs");
    const key = rel(baselineFile);
    const otherKey = rel(path.join(projectRoot, ".freebuff", "coverage-floor.mjs"));
    const bogus = "0".repeat(40);
    writeFileSync(
      manifest,
      renderManifest({
        algorithm: "sha1",
        watches: [
          { dir: ".freebuff", pattern: "^(collect-budget-baselines|coverage-floor)\\.mjs$" },
        ],
        files: { [key]: hashFile(baselineFile), [otherKey]: bogus },
      }),
    );
    const before = readFileSync(baselineFile, "utf8");
    const bodyBefore = existsSync(pullRequestBodyFile)
      ? readFileSync(pullRequestBodyFile, "utf8")
      : null;
    const proposed = { softThreshold: softThreshold * 0.9, importBaselines: {} };
    const applied = renderBaselinesShared(
      applyProposal({ importMarginMs, softThreshold, importBaselines }, proposed).baselines,
    );

    try {
      const result = spawnSync(
        process.execPath,
        [applyScript, "--body", renderProposalState(proposed)],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GATE_HASHES_FILE: manifest,
            GATE_CONTENT_DIR: path.join(dir, "content"),
            GITHUB_OUTPUT: path.join(dir, "output"),
            GITHUB_STEP_SUMMARY: path.join(dir, "summary"),
            COLLECT_APPLY_STDOUT_DETAIL: "1",
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      // Its own two files moved, which is the job it was given…
      expect(result.stdout).toContain("collect:apply: applied");
      expect(readFileSync(path.join(dir, "output"), "utf8")).toContain("changed=true");
      expect(readFileSync(baselineFile, "utf8")).toBe(applied);
      expect(readFileSync(manifest, "utf8")).toContain(hashFile(baselineFile));
      // …and the unrelated file is named, with the reason it matters: the next step in the
      // workflow is the one that decides whether a pull request opens, and this is the line
      // that says so rather than promising one that will not arrive.
      expect(result.stdout).toContain(`1 other pinned file(s) also do not match this tree`);
      expect(result.stdout).toContain(otherKey);
      expect(result.stdout).toContain("the job's own drift check decides");

      // Nothing absorbed: the manifest still carries the hash it already had for that file,
      // and the real alarm still reports exactly that file — so the job's whole-tree check
      // refuses the commit, which is the truth about this tree. The `left` report is what
      // lets the applier say so without the re-pin itself being blocked.
      expect(readFileSync(manifest, "utf8")).toContain(`${JSON.stringify(otherKey)}: ${JSON.stringify(bogus)}`);
      const checked = spawnSync(process.execPath, [driftScript, "--json"], {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, GATE_HASHES_FILE: manifest, GATE_CONTENT_DIR: path.join(dir, "content") },
      });
      expect(checked.status).toBe(1);
      expect(JSON.parse(checked.stdout).changed).toEqual([otherKey]);
    } finally {
      // Narrow again: only this case's own write goes back, so a concurrent run is safe. The
      // pull-request body is git-ignored, and it is still this case's scratch — a case that
      // runs a real writer for real puts the tree back the way it found it.
      if (readFileSync(baselineFile, "utf8") === applied) writeFileSync(baselineFile, before);
      if (bodyBefore === null) rmSync(pullRequestBodyFile, { force: true });
      else writeFileSync(pullRequestBodyFile, bodyBefore);
      rmSync(dir, { recursive: true, force: true });
    }
    // The same two-spawn chain as the case above — applier, then the full drift alarm —
    // so it carries the same budget for the same reason.
  }, 60_000);

  it("renders the baselines file exactly as the reporter does", () => {
    // The shared renderer moved to plain ESM so the bare-Node apply launcher can
    // use it, but the reporter keeps its own copy for the record path. Two
    // renderers that have to agree is a drift risk, so the agreement is a test.
    expect(renderBaselinesShared(COMMITTED_BASELINES)).toBe(renderBaselines(COMMITTED_BASELINES));
  });
});
/**
 * The `id:` and the `--label` of every step in a workflow whose script calls the poster.
 *
 * A step block is what follows a `      - ` at the steps' own indentation, which is the one
 * fact about the file's layout this relies on — and the workflows are pinned by content, so a
 * reformat that moved these would be an edit somebody made on purpose, failing here rather
 * than quietly letting a step out of the check.
 */
function posterSteps(source: string): { id: string; label: string }[] {
  return source
    .split(/\n      - /)
    .slice(1)
    .filter((block) => block.includes("node .freebuff/pr-comment.mjs"))
    .map((block) => ({
      id: /(?:^|\n)        id: (\S+)/.exec(block)?.[1] ?? "",
      label: /--label '([^']+)'/.exec(block)?.[1] ?? "",
    }));
}

/**
 * The `path:` list of the artifact step that uploads a given file — the upload a redaction record
 * has to ride in to be worth writing at all.
 */
function artifactFor(source: string, file: string): string {
  return (
    source
      .split(/\n      - /)
      .slice(1)
      .find((step) => step.includes("uses: actions/upload-artifact@v4") && step.includes(file)) ??
    ""
  );
}

/** The steps that fail a job for a comment that never arrived. */
function gateSteps(source: string): string[] {
  return source
    .split(/\n      - /)
    .slice(1)
    .filter((block) => block.includes("node .freebuff/comment-gate.mjs"));
}

describe("the job-level gate on the comment steps", () => {
  const steps = posterSteps(ciWorkflowSource);

  it("gives every step that posts a comment an id to be judged by", () => {
    // `continue-on-error: true` is what keeps a comment failure from taking the drift and
    // mutation checks with it, and the price is that the job stayed green: the verdict has to
    // be read from outside the step, as `steps.<id>.outcome`. A step added without an `id`
    // would be silently outside the gate, and gets named here instead. The exit status being
    // read is the poster's own — pinned non-zero for a skip in `src/test/pr-comment.test.ts`,
    // where the note and the status are asserted together.
    expect(steps.map((step) => step.id)).toEqual([
      "comment-summary",
      "comment-coverage",
      "comment-proposal",
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Collect-budget summary comment",
      "Coverage-proposal comment",
      "Collect-budget proposal comment",
    ]);
  });

  it("names each of them in a gate, under the label its own step used", () => {
    // The tie that makes the two notes one story: the poster heads its run-page note with this
    // label and the gate's line about it carries the same one, so a reader following either
    // lands on the same step. A gate that invented a second name would send them looking for a
    // comment nobody can find.
    expect(gateSteps(ciWorkflowSource)).toHaveLength(2);
    for (const step of steps) {
      expect(ciWorkflowSource).toContain(`"${step.label}=\${{ steps.${step.id}.outcome }}"`);
    }
    // Counted rather than listed, so a fourth comment step added without a gate cannot pass by
    // being outside a list some test keeps by hand.
    expect(ciWorkflowSource.split("=${{ steps.").length - 1).toBe(steps.length);
  });

  it("fails the job rather than the step, and runs after the step it judges", () => {
    // `if: always()`, because a step that fails without `continue-on-error` — the drift check
    // is one — otherwise takes the rest of the job's steps with it, and the verdict on the
    // comments would never be reported. No `continue-on-error` of its own: the one thing that
    // must not happen here is a gate that fails quietly.
    for (const gate of gateSteps(ciWorkflowSource)) {
      expect(gate).toContain("if: always()");
      expect(gate).not.toContain("continue-on-error");
      expect(gate).toContain("name: Fail when a comment this run owed was not posted");
    }
    for (const step of steps) {
      expect(ciWorkflowSource.indexOf(`--label '${step.label}'`)).toBeLessThan(
        ciWorkflowSource.indexOf(`"${step.label}=`),
      );
    }
  });

  it("needs no gate in the apply job, where the reply is already the verdict", () => {
    // The one comment step that is not `continue-on-error`: it is the last thing that job
    // does, so a poster exiting non-zero — a blank reply, or a `gh` that refused — fails it
    // directly and there is nothing after it to protect. Pinned as an asymmetry rather than
    // left to be rediscovered: a gate there would be harmless, and losing that
    // `continue-on-error` would not.
    expect(applyWorkflowSource).not.toContain("node .freebuff/comment-gate.mjs");
    const reply = applyWorkflowSource
      .split(/\n      - /)
      .slice(1)
      .find((block) => block.includes("node .freebuff/pr-comment.mjs"));
    expect(reply).toBeDefined();
    expect(reply).not.toContain("continue-on-error");
  });
});

describe("the committed baseline file", () => {
  it("is exactly what the record step writes", () => {
    // The freshness contract, the same one `npm run skill:index` keeps for its
    // generated index: a hand-edited number would fail here rather than pass
    // itself off as recorded.
    expect(baselineSource.replace(/\r\n/g, "\n")).toBe(renderBaselines(COMMITTED_BASELINES));
  });

  it("is re-pinned by the record step, in the same command", () => {
    // The recorder lowers these numbers and the file is pinned, so the command that
    // writes them has to record the hash that describes them — otherwise committing a
    // recording leaves a tree that is red on drift for a change the person did not make,
    // and the answer is a second command they have to remember.
    expect(recordLauncherSource).toContain('from "./gate-drift.mjs"');
    expect(recordLauncherSource).toContain("await repin([baselineKey])");
    // And a refusal is loud rather than a warning: the numbers are on disk either way,
    // but the tree is inconsistent until somebody has looked at why.
    expect(recordLauncherSource).toContain("npm run gates:pin");
    expect(recordLauncherSource).toContain("process.exit(status === 0 ? 1 : status)");
  });

  it("names every tracked module and nothing else", () => {
    expect(Object.keys(importBaselines).sort()).toEqual([...TRACKED_IMPORTS].sort());
  });

  it("holds each baseline below the margin, so the margin is what the gate is", () => {
    // These imports cost single-digit milliseconds; the gate's real size is the
    // margin. A baseline that grew past the margin would mean the scanner itself
    // became expensive, which should be fixed rather than accommodated.
    for (const tracked of TRACKED_IMPORTS) {
      const recorded = committedBaselines[tracked];
      expect(Number.isFinite(recorded)).toBe(true);
      expect(recorded).toBeGreaterThanOrEqual(0);
      expect(recorded).toBeLessThan(importMarginMs);
    }
    expect(Number.isFinite(importMarginMs)).toBe(true);
    expect(importMarginMs).toBeGreaterThan(0);
  });

  it("records a soft threshold inside the useful band", () => {
    expect(Number.isFinite(softThreshold)).toBe(true);
    expect(softThreshold).toBeGreaterThan(0);
    expect(softThreshold).toBeLessThan(1);
  });

  it("is what the reporter enforces by default", () => {
    expect(COMMITTED_IMPORT_BUDGET.baselines).toBe(importBaselines);
    expect(COMMITTED_IMPORT_BUDGET.marginMs).toBe(importMarginMs);
    expect(COMMITTED_BASELINES.softThreshold).toBe(softThreshold);
  });
});

describe("the reporter", () => {
  it("reads the diagnostic, normalizes by the median, and fails the process", () => {
    // A reporter error is swallowed into a warning that does not fail the run,
    // so the failure has to be `process.exitCode`. Pinned so a refactor cannot
    // quietly turn the gate into a comment.
    expect(reporterSource).toContain("diagnostic()");
    expect(reporterSource).toContain("collectDuration");
    expect(reporterSource).toContain("medianCollect");
    expect(reporterSource).toContain("process.exitCode = 1");
  });

  it("prints the nearest-to-budget files on every run, on stderr", () => {
    // The notice is what makes a creep visible before it breaches, so it must
    // run unconditionally; and it must stay on stderr, where the CI runner's
    // JSON report on stdout cannot be corrupted by it.
    expect(reporterSource).toContain("slowestCollects");
    expect(reporterSource).toContain("formatTightest");
    expect(reporterSource).toContain("process.stderr.write");
  });

  it("escalates to a warning near the budget, without failing the run", () => {
    // The soft gate is not a failure: it warns and leaves a sidecar for the CI
    // runner rather than touching the exit code, and it never sets that exit code
    // on its own.
    expect(reporterSource).toContain("softWarnings");
    expect(reporterSource).toContain("writeSoftGate");
    expect(reporterSource).toContain("SOFT_GATE_FILE");
  });

  it("enforces the committed baseline and only records when asked", () => {
    // The gate half reads `COMMITTED_IMPORT_BUDGET`; the write half is behind the
    // record environment variable, so a normal run — including CI — never writes
    // the checked-in file.
    expect(reporterSource).toContain("COMMITTED_IMPORT_BUDGET");
    expect(reporterSource).toContain("COLLECT_BASELINE_RECORD");
  });

  it("ratchets the recorded band in the record step", () => {
    // The threshold is not a constant any more: the recorder lowers it from the
    // run's tightest file, and the file it writes carries the new value.
    expect(reporterSource).toContain("worstUsed");
    expect(reporterSource).toContain("nextSoftThreshold");
    expect(reporterSource).toContain("renderBaselines");
  });

  it("proposes from the worst case of a repeated session", () => {
    // The noise-proofing lives in the reporter rather than the launcher because
    // the ratchet lives here; the launcher only drives the repeats and reads the
    // result back.
    expect(reporterSource).toContain("COLLECT_PROPOSAL_SAMPLE");
    expect(reporterSource).toContain("aggregateSamples");
    expect(reporterSource).toContain("samples: samples.length");
  });

  it("refuses to publish a session that came up short of its runs", () => {
    // An aggregate over fewer samples is a weaker claim, so a session that
    // measured less than it asked for proposes nothing at all.
    expect(proposeLauncherSource).toContain("COLLECT_PROPOSE_RUNS");
    expect(proposeLauncherSource).toContain("samples < runs");
    expect(proposeLauncherSource).toContain('?? "3"');
  });

  it("leaves the run report for the gate step", () => {
    // The same runs answer both questions: the proposal it posts, and the report
    // `npm run collect:stale` fails on. It clears any earlier report first — an
    // absent one is what tells the gate step the session never judged anything —
    // and declares its run count so a short session cannot read as a complete one.
    expect(proposeLauncherSource).toContain("RUN_REPORT_FILE");
    expect(proposeLauncherSource).toContain("COLLECT_PROPOSAL_RUNS");
  });

  it("proposes without writing, behind its own mode", () => {
    // The propose mode measures the same way as the recorder but writes a
    // proposal instead of the checked-in file, so a pull request can be told what
    // it would tighten without anything under version control changing.
    expect(reporterSource).toContain("COLLECT_BASELINE_PROPOSE");
    expect(reporterSource).toContain("proposalChanges");
    expect(reporterSource).toContain("renderProposal");
    expect(reporterSource).toContain("PROPOSAL_MARKER");
  });

  it("warns on a loose baseline and leaves a report, without failing the run", () => {
    // The one direction the ratchet cannot correct is the one a single run may not
    // fail on: it warns, and leaves the run report the repeated session's gate step
    // reads. The failure lives in `npm run collect:stale`, not here. The report goes
    // out on every judged run, stale or not, because the run summary publishes the
    // measurement it carries.
    expect(reporterSource).toContain("staleHighBaselines");
    expect(reporterSource).toContain("RUN_REPORT_FILE");
    expect(reporterSource).toContain("formatStale");
    expect(reporterSource).toContain("writeRunReport");
  });
});
