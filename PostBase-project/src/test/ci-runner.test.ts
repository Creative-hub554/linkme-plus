/// <reference types="vite/client" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The alarm's watch rules, read as the alarm itself reads them. The drift stage's `inputs`
// are derived from that declaration, so the tests that hold them to it have to resolve the
// same rules rather than keep a copy of the globs they render to.
import {
  DEFAULT_WATCHES,
  MANIFEST_FILE,
  STAGE_NAMES,
  STAGE_TABLE,
  hashFile,
  manifestPath,
  pin,
  renderManifest,
} from "../../.freebuff/gate-drift.mjs";
import { makeScratchDir, removeScratchDir } from "./scratch";
// The import closure the runner folds into each script-backed stage's key: imported
// rather than restated, so the invariant case pins the same walker the run uses
// instead of carrying a second copy that could drift from it.
import { importClosure } from "../../.freebuff/import-closure.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * How many `.env*` files this working tree has. The preflight stage's inputs are
 * globbed against the working tree, so anything counted from them — an input
 * count, a "file(s) behind the key" line — depends on the machine: a clean
 * checkout (a hosted runner) has only the committed `.env.example`, this one
 * also has a developer's `.env.local`. Counts are asserted against what is
 * actually on disk rather than pinned to one machine's secret files.
 */
const envFileCount = () =>
  readdirSync(projectRoot).filter((name) => name.startsWith(".env")).length;
const ciRunner = path.join(projectRoot, ".freebuff", "ci.mjs");
const preflight = path.join(projectRoot, ".freebuff", "preview-preflight.mjs");
const sweep = path.join(projectRoot, ".freebuff", "mutation-guards.mjs");
/** The shared vocabulary module the sweeps import their tables from. */
const vocabularyModule = path.join(projectRoot, ".freebuff", "mutation-vocabulary.mjs");
const coverageLauncher = path.join(projectRoot, ".freebuff", "mutation-coverage.mjs");
const reporter = path.join(projectRoot, ".freebuff", "nightly-report.mjs");
/** The alarm itself, for the one case that runs it beside the stage it stands behind. */
const alarmScript = path.join(projectRoot, ".freebuff", "gate-drift.mjs");

/**
 * A port nothing should be listening on. The preflight's reach checks target it
 * so the payload is deterministic without starting (or stopping) a server.
 */
const UNUSED_PORT = "41337";

/**
 * The slice of the preflight's `--json` payload this test asserts on. It mirrors
 * what `.freebuff/ci.mjs` reads, so a rename on either side shows up here first.
 */
interface PreflightPayload {
  gate: "pass" | "fail";
  checks: { name: string; status: string; detail: string; fix?: string }[];
}

/**
 * The slice of the mutation sweep's `--json` payload this test asserts on. It
 * mirrors what `.freebuff/ci.mjs` reads: the `gate`, the `checked` count, the
 * strikes that ran counted by family — a test helper, a check inside the runner
 * itself, a detector struck whole, and one limb of a detector — and each survivor's
 * `kind`, `path`, `line` and `descriptor` — plus the two records the sweep publishes
 * beside the counts and the runner does not read yet: which cases caught each
 * self-mutation, and the decisions no limb strike reaches.
 */
interface MutationPayload {
  gate: "pass" | "fail";
  exitCode: number;
  checked: number;
  helperSelfMutations: number;
  runnerSelfMutations: number;
  conventionSelfMutations: number;
  limbSelfMutations: number;
  lockSelfMutations: number;
  ratchetSelfMutations: number;
  strikes: {
    path: string;
    line: number | null;
    kind: string;
    descriptor: string;
    test: string;
    total: number;
    margin: number;
    caughtBy: string[];
  }[];
  thinMargin: number;
  decisionSites: number;
  unstruck: number;
  /** The recorded baseline's own un-struck count — absent when nothing records one. */
  unstruckBaseline?: number;
  unstruckRules: { where: string; line: number; code: string }[];
  survivors: { kind: string; path: string; line: number | null; descriptor: string }[];
}

/**
 * A small, fast slice of the real sweep: two mutations on the admin routes,
 * without the fail-open pass. Running a handful of real mutations keeps the
 * contract honest without paying for the whole sweep, which is minutes long.
 */
const REAL_SWEEP_SLICE = ["--no-fail-open", "--file=admin", "--limit=2"];

/**
 * A preflight sweep that fails both ways: one branch the suite stopped noticing (a
 * `survived` mutation, which asks for a test) and one anchor that no longer fits the
 * source (a `broken` check, which asks for the table to be re-fit). The ids are the
 * real ones from `.freebuff/mutation-preflight.mjs`, so the stub answers the shape the
 * sweep actually writes rather than one invented for the fixture.
 */
const FAILING_MUTATION_PREFLIGHT = [
  "process.stdout.write(JSON.stringify({",
  "  root: process.cwd(),",
  "  target: '.freebuff/preview-preflight.mjs',",
  "  test: 'src/test/preview-preflight.test.ts',",
  "  gate: 'fail',",
  "  exitCode: 1,",
  "  checked: 19,",
  "  caught: [],",
  "  survivors: [",
  "    { path: '.freebuff/preview-preflight.mjs', line: 412, id: 'health/wedged', kind: 'survived', descriptor: 'a live lock pid that answers nothing on its port is not reported as wedged' },",
  "    { path: '.freebuff/preview-preflight.mjs', line: null, id: 'tab/gone', kind: 'broken', descriptor: 'a tab that is gone is reported as gone', detail: 'its anchor occurs 0 time(s), expected exactly 1' },",
  "  ],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A test for the CI runner's contract with its JSON gates.
 *
 * `.freebuff/ci.mjs` is a *process* runner: it spawns each stage and reads the
 * `--json` object the stage writes on stdout. That makes its most important
 * behaviour — does a stage's payload turn into the right pass/fail and the right
 * summary — exactly the part a plain unit test cannot reach without a stubbed
 * child. This test is that stub: it points the preflight stage at a throwaway
 * script (`CI_PREFLIGHT_SCRIPT`, the seam `stageScript` exposes for precisely
 * this) and drives the real runner end to end, in a child process, on all three
 * shapes a stage can hand back:
 *
 *   - **pass**  — a `gate: "pass"` object; the runner prints a PASS line and exits 0;
 *   - **fail**  — a `gate: "fail"` object; the runner prints the failing checks
 *     with their fixes and exits 1;
 *   - **crash** — no JSON at all (the stage wrote to stderr and died); the runner
 *     refuses to read that as a pass and exits 1 with the raw output.
 *
 * The same seam is used for the mutation stage (`CI_MUTATION_SCRIPT`), whose
 * payload is a survivor list rather than a check list: the test proves each
 * survivor is named by file and line, grouped by how it survived, and that any
 * survivor fails the job.
 *
 * The coverage-gate mutation stage (`CI_MUTATION_COVERAGE_SCRIPT`) is that shape
 * again — one mark for a gate whose own test file missed the weakening, another for
 * a case the check could not answer — and one test reads *the real launcher* through
 * it, pointed at a stub Vitest, so the two halves of that contract cannot be renamed
 * apart.
 *
 * No dev server, no network, no real preflight or sweep: the stubs are the
 * stage. The pass stubs also assert the runner forwarded `--json`, so the
 * contract it is reading is the one actually under test.
 *
 * One test does *not* stub: it runs the real preflight and the real runner over
 * the same unused port and checks that the runner's summary is derived from the
 * preflight's own fields — the failure count it prints equals the number of
 * `status: "fail"` checks the payload carries, and every failed check's `name`
 * and `fix` reach the log. That is what keeps the two from drifting apart
 * silently: rename a key on either side and the derived count no longer matches.
 *
 * The mutation counterpart (the real sweep's `checked`/`survivors` against the
 * runner's summary) exists too but is opt-in under `CI_SHAPE_CONTRACT=1`: the
 * sweep rewrites source as it runs, so it cannot share a tree with the rest of
 * the suite without a route test seeing a half-mutated guard. The coverage-gate
 * counterpart needs no such guard: with the stub in Vitest's place, the real
 * launcher maps a report this test wrote, and nothing in the tree is weakened.
 */

let stubDir = "";

beforeAll(() => {
  stubDir = makeScratchDir("ci-runner-test-");
  // A default for any spawn that spreads `process.env`: even a direct one is
  // pointed at a throwaway cache rather than the project's own `.ci/cache.json`,
  // which no test may read from or write to.
  process.env.CI_CACHE_FILE = path.join(stubDir, "cache-default.json");
  // The same for the lock a tree-editing check holds: no test here seeds one, and a run
  // that read the project's own `.freebuff/.mutation-lock.json` could heal a real run's
  // debris — or be described by it. `ci-runner-tree-editing.test.ts` is where the
  // recovery itself is driven, against a lock of its own.
  process.env.MUTATION_LOCK_FILE = path.join(stubDir, "lock-default.json");
});

afterAll(() => {
  delete process.env.CI_CACHE_FILE;
  delete process.env.MUTATION_LOCK_FILE;
  removeScratchDir(stubDir);
});

/** Writes a stub preflight script and answers its absolute path. */
function writeStub(name: string, body: string): string {
  const stubPath = path.join(stubDir, name);
  writeFileSync(stubPath, body, "utf8");
  return stubPath;
}

let cacheSeq = 0;
let reportSeq = 0;

/** The project-relative, forward-slashed key a manifest records for a file. */
function keyOf(file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join("/");
}

/**
 * A cache path nothing has written yet, so every run in a test that does not ask
 * otherwise starts cold and never reads — or writes — the developer's own
 * `.ci/cache.json`. A test that wants to observe reuse passes the same path twice.
 */
function freshCachePath(): string {
  cacheSeq += 1;
  return path.join(stubDir, `cache-${cacheSeq}.json`);
}

interface CacheFile {
  version: number;
  stages: Record<
    string,
    { hash: string; startedHash?: string; pass: boolean; summary?: string; at?: string }
  >;
}

/** Reads a cache file a run just wrote, so a test can age one entry out. */
function readCache(cacheFile: string): CacheFile {
  return JSON.parse(readFileSync(cacheFile, "utf8")) as CacheFile;
}

/** Backdates one stage's recorded pass, keeping its digest the same. */
function ageOut(cacheFile: string, stage: string, days: number): void {
  const cache = readCache(cacheFile);
  cache.stages[stage].at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(cacheFile, JSON.stringify(cache), "utf8");
}

/** Runs the real CI runner, preflight stage only, against a stub script. */
function runPreflightStage(stubPath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [ciRunner, "--only=preflight", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CI_PREFLIGHT_SCRIPT: stubPath, CI_CACHE_FILE: freshCachePath() },
  });
}

/** Runs the real CI runner, mutation stage only, against a stub script. */
function runMutationStage(stubPath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [ciRunner, "--only=mutation", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CI_MUTATION_SCRIPT: stubPath, CI_CACHE_FILE: freshCachePath() },
  });
}

/**
 * Runs the real CI runner, coverage-gate mutation stage only, against a stub. The
 * stub stands in for `.freebuff/mutation-coverage.mjs`, so what is under test is
 * the runner's read of its payload.
 */
function runMutationCoverageStage(stubPath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [ciRunner, "--only=mutation-coverage", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI_MUTATION_COVERAGE_SCRIPT: stubPath,
      CI_CACHE_FILE: freshCachePath(),
    },
  });
}

/**
 * Runs the real CI runner, preflight-mutation stage only, against a stub. The stub
 * stands in for `.freebuff/mutation-preflight.mjs`, so what is under test is the
 * runner's read of *its* payload, which names a survivor by the mutation's own id
 * rather than by a route and a line — a different shape from the route sweep's.
 */
function runMutationPreflightStage(stubPath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [ciRunner, "--only=mutation-preflight", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI_MUTATION_PREFLIGHT_SCRIPT: stubPath,
      CI_CACHE_FILE: freshCachePath(),
    },
  });
}

/**
 * Runs the real CI runner, drift stage only, against a stub. The stub stands in for
 * `.freebuff/gate-drift.mjs`, so what is under test is the runner's read of its payload.
 */
function runDriftStage(stubPath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [ciRunner, "--only=drift", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CI_DRIFT_SCRIPT: stubPath, CI_CACHE_FILE: freshCachePath() },
  });
}

/** Runs the real CI runner, lint stage only, against a stub script. */
function runLintStage(stubPath: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [ciRunner, "--only=lint", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CI_LINT_SCRIPT: stubPath, CI_CACHE_FILE: freshCachePath() },
  });
}

/**
 * Every CI marker `ci.mjs`'s `inCi()` reads (its `CI_MARKERS` list). All of them
 * are cleared for spawned runs, not just `CI`: a hosted runner sets
 * `GITHUB_ACTIONS` alongside `CI`, and one surviving marker is enough to flip
 * the spawned run's default to keep-going — which is exactly the local-vs-CI
 * distinction these cases exist to pin.
 */
const CI_MARKERS: Record<string, string> = {
  CI: "",
  CONTINUOUS_INTEGRATION: "",
  GITHUB_ACTIONS: "",
  GITLAB_CI: "",
  CIRCLECI: "",
  TRAVIS: "",
  BUILDKITE: "",
};

/**
 * Runs the real CI runner with arbitrary args and stage-script overrides. Every
 * CI marker is cleared by default (see `CI_MARKERS`) so a run keeps the *local*,
 * fail-fast behavior even when the suite itself is executed inside a CI
 * environment; a test that wants the CI default passes `CI: "true"`.
 */
function runCi(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [ciRunner, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...CI_MARKERS,
      CI_CACHE_FILE: freshCachePath(),
      // A run's test-stage attempt clears the stamp path its stage names, and a
      // stubbed suite never writes it — so every spawned run points the seam at
      // scratch, or this suite's own runs would delete the tree's real sidecar
      // written by rendered-links' close-out. Cases that exercise the stamp
      // override this with their own path (the default scratch path is the
      // stamping stubs' target, which they overwrite — harmless in scratch).
      CI_COVERAGE_STAMP_FILE: path.join(stubDir, "coverage-stamp-default.txt"),
      ...env,
    },
  });
}

/**
 * Renders a run's `--json` report through the *real* `.freebuff/nightly-report.mjs`,
 * the way the nightly job does, so the runner's payload and the run page are checked
 * against each other rather than against a fixture someone keeps in step by hand.
 */
function renderReport(payload: unknown, extraArgs: string[] = []) {
  reportSeq += 1;
  const reportPath = path.join(stubDir, `report-${reportSeq}.json`);
  writeFileSync(reportPath, JSON.stringify(payload), "utf8");
  return spawnSync(process.execPath, [reporter, "--report", reportPath, ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

/** A stub preflight that passes, used where only stage *selection* is under test. */
const PASSING_PREFLIGHT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'pass', exitCode: 0, only: null, registerUrl: null,",
  "  failures: [], warnings: [],",
  "  checks: [{ name: 'node_modules', status: 'ok', detail: 'installed' }],",
  "}) + '\\n');",
].join("\n");

/**
 * A passing preflight that records that it ran (into `$CI_STUB_MARKER`), so a
 * reuse is proved by the stage *not* executing a second time rather than by a
 * banner the runner could print for any reason.
 */
const RECORDING_PREFLIGHT = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.CI_STUB_MARKER, 'ran');",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'pass', exitCode: 0, failures: [], warnings: [],",
  "  checks: [{ name: 'node_modules', status: 'ok', detail: 'installed' }],",
  "}) + '\\n');",
].join("\n");

/** A stub runbook check that passes, asserting it was asked for `--check` and `--json`. */
const PASSING_RUNBOOK = [
  "if (!process.argv.includes('--json') || !process.argv.includes('--check')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'pass', exitCode: 0, sections: 60,",
  "  message: 'run.md: Contents is up to date (60 sections).',",
  "}));",
].join("\n");

/** A stub runbook check that reports a stale Contents. */
const STALE_RUNBOOK = [
  "if (!process.argv.includes('--json') || !process.argv.includes('--check')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'fail', exitCode: 1, sections: 61,",
  "  message: 'run.md: Contents is stale (61 sections) — run `npm run runbook:contents` and commit the result.',",
  "}));",
].join("\n");

/** A stub preflight that fails, for the runner's own report. */
const FAILING_PREFLIGHT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'fail', exitCode: 1,",
  "  checks: [{ name: 'dev server pid', status: 'fail', detail: 'process 1 is gone', fix: 'npm run dev' }],",
  "}));",
].join("\n");

/** A stub mutation sweep that reports survivors, with and without a line. */
const FAILING_MUTATION = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'fail', exitCode: 1, checked: 5, survivors: [",
  "  { kind: 'guard', path: 'src/app/api/admin/moderate/route.ts', line: 42, descriptor: 'guard removed (reports gate)' },",
  "  { kind: 'self', path: 'src/app/api/admin/reports/route.ts', line: null, descriptor: 'helper self-mutation' },",
  "] }) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub mutation sweep whose two survivors are the two depths a convention detector
 * can fail at: the whole detector reporting nothing, and one limb of a detector going
 * dark while the rest of it still reports. The runner has to tell them apart — in the
 * stage summary and in the mark each detail carries — rather than print two lines that
 * read like the same regression.
 */
const DETECTOR_DEPTHS_SWEEP = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  root: process.cwd(),",
  "  gate: 'fail',",
  "  exitCode: 1,",
  "  checked: 530,",
  "  helperSelfMutations: 9,",
  "  conventionSelfMutations: 7,",
  "  limbSelfMutations: 14,",
  "  survivors: [",
  "    { path: 'src/test/convention-guards.ts', line: null, kind: 'convention', descriptor: 'mount: the detector flags no raw mount', where: 'src/test/convention-guards.ts  mount: the detector flags no raw mount', test: 'src/test/convention-guards.test.ts', total: 5, masked: 1, named: 0 },",
  "    { path: 'src/test/convention-guards.ts', line: null, kind: 'limb', descriptor: 'beat-seam: the step limb stops seeing a callback that was renamed out of it', where: 'src/test/convention-guards.ts  beat-seam: the step limb stops seeing a callback that was renamed out of it', test: 'src/test/beat-seams.test.ts', total: 18, masked: 1, named: 0 },",
  "  ],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub mutation sweep whose one survivor names a secret-looking file — the shape
 * that must not reach the published report, the uploaded JSON or an annotation.
 */
const SECRET_SURVIVOR_SWEEP = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'fail', exitCode: 1, checked: 1, survivors: [",
  "  { kind: 'guard', path: '.env.local', line: 5, descriptor: 'guard removed' },",
  "] }) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub lint run whose finding carries a comma in its path and a `%` and a
 * newline in its message, to prove the annotation escapes what a workflow
 * command cannot carry raw.
 */
const ESCAPING_LINT = [
  "process.stdout.write(JSON.stringify({",
  "  gate: 'fail', exitCode: 1, files: 1, errors: 1, warnings: 0,",
  "  findings: [{ file: 'src/lib/a,b.ts', line: 5, column: 2, rule: 'rule', severity: 2, message: '50% off\\nand a: colon' }],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub mutation sweep that records it was reached (`$CI_STUB_MARKER`) and
 * passes — the proof a change-based skip did or did not run the stage.
 */
const RECORDING_MUTATION = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.CI_STUB_MARKER, 'ran');",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 1, survivors: [] }) + '\\n');",
].join("\n");

/** A stub mutation sweep that passes. */
const PASSING_MUTATION = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 1, survivors: [] }) + '\\n');",
].join("\n");

/**
 * A stub preflight-mutation sweep that passes.
 *
 * It is a *stub*, never an option to leave out: a real sweep rewrites
 * `.freebuff/preview-preflight.mjs` one branch at a time for minutes and cannot share a
 * tree with the rest of the suite, so any test that executes the tail of the stage list
 * — `--from=preflight`, `--from=test` — has to name it here. Left unstubbed, the real
 * sweep runs inside the test process, outlives the case that started it, and leaves the
 * preflight mutated with no lock behind it.
 */
const PASSING_MUTATION_PREFLIGHT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 19, survivors: [] }) + '\\n');",
].join("\n");

/** A stub coverage-gate mutation run that passes. */
const PASSING_MUTATION_COVERAGE = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 5, files: 1, survivors: [] }) + '\\n');",
].join("\n");

/** A stub drift check that finds nothing: every pinned script matches. */
const PASSING_DRIFT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  mode: 'check', gate: 'pass', exitCode: 0, checked: 7, findings: [],",
  "  changed: [], unpinned: [], gone: [],",
  "}) + '\\n');",
].join("\n");

/**
 * A stub drift check with the two findings a drift is made of: a pinned script whose
 * hash moved, and a watched script nobody pinned.
 */
const FAILING_DRIFT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  mode: 'check', gate: 'fail', exitCode: 1, checked: 7,",
  "  findings: [",
  "    { kind: 'changed', path: '.freebuff/coverage-floor.mjs', detail: 'on disk 11111111, pinned 22222222',",
  "      diff: '--- pinned  .freebuff/coverage-floor.mjs\\n+++ on disk .freebuff/coverage-floor.mjs\\n@@ -124,7 +124,7 @@\\n-    if (pct < threshold) {\\n+    if (pct <= threshold) {' },",
  "    { kind: 'unpinned', path: '.freebuff/coverage-perfile.mjs', detail: 'not in the pinned hashes — a gate nobody pinned' },",
  "  ],",
  "  changed: ['.freebuff/coverage-floor.mjs'], gone: [],",
  "  unpinned: ['.freebuff/coverage-perfile.mjs'],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * The sentence the alarm puts on a *refusal*: a red drift in which a moved family is behind no
 * stage's key, so the re-pin the raw line advises is not the whole repair. Kept apostrophe-free so
 * the stub below is a JSON literal rather than an escape exercise; the wording itself is pinned in
 * `src/test/gate-drift.test.ts`, and what this file holds is that the stage passes it through.
 */
const REFUSAL_SENTENCE = "1 moved watch family behind no stage key, so name it in a stage inputs";

/** A red drift the alarm refuses as well as reports, so the stage's summary carries its sentence. */
const REFUSED_DRIFT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  mode: 'check', gate: 'fail', exitCode: 1, checked: 41,",
  "  findings: [",
  "    { kind: 'changed', path: '.github/workflows/nightly.yml', detail: 'on disk 33333333, pinned 44444444',",
  "      family: '.github/workflows/^.*\\\\.ya?ml$', owner: ' — no stage keys it' },",
  "  ],",
  "  changed: ['.github/workflows/nightly.yml'], unpinned: [], gone: [],",
  "  refused: [{ rule: '.github/workflows/^.*\\\\.ya?ml$', moved: 1 }],",
  `  refusal: '${REFUSAL_SENTENCE}',`,
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A red drift run whose findings are spread across watch families, plus one pinned path no rule
 * names any more: the shape a whole-tree re-pin leaves behind. The report is then a long list of
 * paths at exactly the moment a reader needs the one thing a path does not say — which *family*
 * moved, because that is the rule to re-check rather than the tree to re-pin.
 */
const MIXED_DRIFT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  mode: 'check', gate: 'fail', exitCode: 1, checked: 41,",
  "  findings: [",
  "    { kind: 'changed', path: '.freebuff/coverage-floor.mjs', detail: 'on disk 11111111, pinned 22222222' },",
  "    { kind: 'unpinned', path: '.freebuff/coverage-headroom.mjs', detail: 'not in the pinned hashes' },",
  "    { kind: 'changed', path: '.github/workflows/nightly.yml', detail: 'on disk 33333333, pinned 44444444' },",
  "    { kind: 'gone', path: '.freebuff/gate-removed.mjs', detail: 'pinned, not on disk' },",
  "  ],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub drift check that found no drift but could not keep the text it matched: the pin
 * matches and the diff cache is degraded. The alarm names that on its payload — the loss as
 * `warning`, the reason as `cause` — and the stage has to carry both to the run page: a green
 * row that stayed silent would make the cache look maintained at exactly the moment it
 * stopped working, and a warning with no reason sends a reader to the CLI for the one thing
 * they can act on. `cause` is a parameter so the same stub can pin the payload a *version of
 * the gate* that reported only the loss would write, which is the branch the stage has to
 * survive rather than invent a reason for.
 */
function stashLostDrift(cause?: string): string {
  return [
    "if (!process.argv.includes('--json')) process.exit(3);",
    "process.stdout.write(JSON.stringify({",
    "  mode: 'check', gate: 'pass', exitCode: 0, checked: 7, findings: [],",
    "  changed: [], unpinned: [], gone: [],",
    "  warning: 'the matched text could not be stashed — the next drift will show hashes only',",
    ...(cause === undefined ? [] : [`  cause: ${JSON.stringify(cause)},`]),
    "}) + '\\n');",
  ].join("\n");
}

/** The loss and the reason for it, the shape the alarm emits today. */
const STASH_LOST_DRIFT = stashLostDrift(
  "ENOSPC: no space left on device, write — writing to .ci/gate-content",
);

/** The same loss with no reason beside it, as a payload from before `cause` existed. */
const STASH_LOST_WITHOUT_CAUSE = stashLostDrift();

/**
 * A stub drift check whose usual stash directory refused the write but whose fallback took
 * the text, so this payload carries a `stash` *and* a `warning` at once.
 *
 * That is the shape the stage has to be careful with: the diff survives, so the warning is
 * not a loss, but the cache is not where it belongs and the warning is not a silence. A
 * consumer that reads `stash` as "everything is fine and nothing to report" would drop the
 * one fact here — that the next diff depends on a directory the OS may clear.
 */
const STASH_MOVED_DRIFT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  mode: 'check', gate: 'pass', exitCode: 0, checked: 7, findings: [],",
  "  changed: [], unpinned: [], gone: [],",
  "  stash: { dir: '/tmp/gate-content-fixture-1f2e3d4c', stashed: 7, fallback: '/tmp/gate-content-fixture-1f2e3d4c' },",
  "  warning: 'the matched text could not be stashed in the usual place — kept at /tmp/gate-content-fixture-1f2e3d4c instead, which the OS may clear, and then the next drift shows hashes only',",
  "  cause: \"EEXIST: file already exists, mkdir '/repo/.ci/gate-content' — writing to .ci/gate-content\",",
  "}) + '\\n');",
].join("\n");

/** A stub drift check that cannot read its manifest: exit 2, nothing compared. */
const UNREADABLE_DRIFT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  mode: 'check', gate: 'fail', exitCode: 2, checked: 0, findings: [],",
  "  changed: [], unpinned: [], gone: [],",
  "  message: '.freebuff/gate-hashes.mjs does not exist — run `npm run gates:pin` to record the gate hashes',",
  "}) + '\\n');",
  "process.exit(2);",
].join("\n");

/**
 * A stub sweep whose run recovered a lock out of the shared lock file, and passed: the
 * shape `.freebuff/mutation-guards.mjs` emits when a previous run died mid-mutation.
 * The recovery is a *warning* on a green stage, which is the case with nowhere else to
 * be said on the nightly run page.
 */
const RECOVERED_SWEEP = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  root: process.cwd(), gate: 'pass', exitCode: 0, checked: 12, survivors: [],",
  "  recovered: [{",
  "    action: 'restored',",
  "    path: 'src/app/api/admin/moderate/route.ts',",
  "    check: 'guard sweep',",
  "    kind: 'guard',",
  "    where: 'src/app/api/admin/moderate/route.ts:29',",
  "    message: 'RESTORED src/app/api/admin/moderate/route.ts from an interrupted guard sweep (guard: src/app/api/admin/moderate/route.ts:29).',",
  "  }],",
  "}) + '\\n');",
].join("\n");

/**
 * The coverage counterpart, with both halves of the recovery in it: one file the check
 * put back, and one somebody else had edited, whose lock is left for a human.
 */
const RECOVERED_COVERAGE = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  root: process.cwd(), gate: 'pass', exitCode: 0, checked: 5, files: 1, survivors: [],",
  "  recovered: [",
  "    { action: 'restored', path: '.freebuff/coverage-floor.mjs', check: 'coverage mutation check', kind: 'gate', where: 'src/test/coverage-floor.test.ts', message: 'RESTORED .freebuff/coverage-floor.mjs from an interrupted coverage mutation check (gate: src/test/coverage-floor.test.ts).' },",
  "    { action: 'left', path: '.freebuff/coverage-scopes.mjs', check: 'coverage mutation check', kind: 'gate', where: 'src/test/coverage-scopes.test.ts', message: 'WARNING: .freebuff/coverage-scopes.mjs differs from both the pre- and post-mutation content — someone else edited it. Leaving it as it is now, and the lock in place; inspect it by hand.' },",
  "  ],",
  "}) + '\\n');",
].join("\n");

/**
 * A stub lint run that passes, asserting the runner asked for `--json`. The
 * payload mirrors `.freebuff/lint-baseline.mjs`: a `gate`, the linted file
 * count, and the `findings` array.
 */
const PASSING_LINT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'pass', exitCode: 0, files: 346, findings: [], errors: 0, warnings: 0,",
  "}) + '\\n');",
].join("\n");

/** A stub lint run that reports two findings and exits nonzero. */
const FAILING_LINT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'fail', exitCode: 1, files: 346, errors: 1, warnings: 1,",
  "  findings: [",
  "    { file: 'src/app/api/foo/route.ts', line: 12, column: 7, rule: '@typescript-eslint/no-unused-vars', severity: 2, message: 'x is assigned a value but never used' },",
  "    { file: 'src/lib/bar.ts', line: 3, column: 1, rule: 'react-hooks/exhaustive-deps', severity: 1, message: 'missing dependency: y' },",
  "  ],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub lint run with two findings in one file and one in another: the shape the per-file fold
 * exists for, where a flat list of `file:line:col` rows gives no sign that two of the findings
 * share a file.
 */
const MULTI_FILE_LINT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'fail', exitCode: 1, files: 346, errors: 1, warnings: 2,",
  "  findings: [",
  "    { file: 'src/app/api/foo/route.ts', line: 12, column: 7, rule: '@typescript-eslint/no-unused-vars', severity: 2, message: 'x is assigned a value but never used' },",
  "    { file: 'src/app/api/foo/route.ts', line: 20, column: 3, rule: '@typescript-eslint/no-explicit-any', severity: 1, message: 'unexpected any' },",
  "    { file: 'src/lib/bar.ts', line: 3, column: 1, rule: 'react-hooks/exhaustive-deps', severity: 1, message: 'missing dependency: y' },",
  "  ],",
  "}) + '\\n');",
  "process.exit(1);",
].join("\n");

/** A stub typecheck that emits two tsc-style errors and exits nonzero. */
const FAILING_TYPECHECK = [
  "process.stdout.write('src/app/api/foo/route.ts(1,2): error TS2322: bad assignment\\n');",
  "process.stdout.write('src/lib/bar.ts(9,9): error TS2345: bad argument\\n');",
  "process.exit(2);",
].join("\n");

/**
 * A stub test run that writes a vitest-JSON report with one failed assertion.
 * It honors `--outputFile=` the way vitest does, so the runner reads it exactly
 * as it reads a real report.
 */
const FAILING_TEST_REPORT = [
  "import { writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 3,",
  "  numFailedTests: 1,",
  "  testResults: [{",
  "    name: join(process.cwd(), 'src/test/stub.test.ts'),",
  "    status: 'failed',",
  "    assertionResults: [",
  "      { status: 'passed', title: 'passes one' },",
  "      { status: 'failed', title: 'renders the thing' },",
  "    ],",
  "  }],",
  "}));",
  "process.exit(1);",
].join("\n");

/**
 * A stub test run that records that it was reached (by writing the file named
 * in `$CI_STUB_MARKER`) and then writes a passing report. It proves a stage
 * *ran* — an absent banner only proves the runner did not print one.
 */
const RECORDING_TEST = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.CI_STUB_MARKER, 'ran');",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 1,",
  "  numFailedTests: 0,",
  "  testResults: [{",
  "    name: 'src/test/stub.test.ts',",
  "    status: 'passed',",
  "    assertionResults: [{ status: 'passed', title: 'passes one' }],",
  "  }],",
  "}));",
].join("\n");

/**
 * A stub for the test stage whose own run deletes one of the files its key covers — the
 * shape a stage that cleans up its scratch output has, and the one the runner used to die
 * on: the key is re-read after the pass, and a file gone by then cannot be read. It reports
 * a passing run, so the only thing under test is how the runner reads a key over a tree it
 * no longer fully has.
 */
const VANISHING_TEST = [
  "import { rmSync, writeFileSync } from 'node:fs';",
  "rmSync(process.env.CI_STUB_VANISH, { force: true });",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 1,",
  "  numFailedTests: 0,",
  "  testResults: [{",
  "    name: 'src/test/stub.test.ts',",
  "    status: 'passed',",
  "    assertionResults: [{ status: 'passed', title: 'passes one' }],",
  "  }],",
  "}));",
].join("\n");

/**
 * A stub whose every test passes but whose process still exits nonzero — the
 * shape the collect-time budget reporter produces when a file overruns.
 */
const PASSED_TESTS_FAILED_RUN_REPORT = [
  "import { writeFileSync } from 'node:fs';",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 2,",
  "  numFailedTests: 0,",
  "  testResults: [{",
  "    name: 'src/test/stub.test.ts',",
  "    status: 'passed',",
  "    assertionResults: [{ status: 'passed', title: 'passes one' }],",
  "  }],",
  "}));",
  "process.stderr.write('collect-budget: 1 breach(es) — a file over its budget\\n');",
  "process.exit(1);",
].join("\n");

/**
 * A stub whose every test passes while the *file* they are in still failed — the shape a
 * throwing file-level hook leaves, an `afterAll` clearing a scratch tree being the usual
 * one. Vitest records it as a failed suite with no failed assertion inside it, so nothing in
 * the test list names it, and the file's own `message` is the only place the reason is
 * written at all.
 */
const BROKEN_SUITE_REPORT = [
  "import { writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 2,",
  "  numFailedTests: 0,",
  "  testResults: [{",
  "    name: join(process.cwd(), 'src/test/stub.test.ts'),",
  "    status: 'failed',",
  "    message: 'Error: EBUSY: resource busy or locked, rmdir scratch',",
  "    assertionResults: [{ status: 'passed', title: 'passes one' }],",
  "  }],",
  "}));",
  "process.exit(1);",
].join("\n");

/**
 * A stub whose tests all pass while the *run* reports an unhandled error — the other shape
 * that fails the process with nothing in the test list to blame.
 */
const UNHANDLED_ERROR_REPORT = [
  "import { writeFileSync } from 'node:fs';",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 1,",
  "  numFailedTests: 0,",
  "  testResults: [{",
  "    name: 'src/test/stub.test.ts',",
  "    status: 'passed',",
  "    assertionResults: [{ status: 'passed', title: 'passes one' }],",
  "  }],",
  "  errors: [{ name: 'Unhandled Rejection', message: 'stub rejection: nobody awaited this' }],",
  "}));",
  "process.exit(1);",
].join("\n");

describe("the CI runner's preflight stage", () => {
  it("prints a PASS line and exits 0 for a passing payload", () => {
    const stub = writeStub(
      "pass.mjs",
      [
        "if (!process.argv.includes('--json')) {",
        "  process.stderr.write('stub: --json was not forwarded\\n');",
        "  process.exit(3);",
        "}",
        "const payload = {",
        "  projectRoot: process.cwd(),",
        "  port: 3000,",
        "  gate: 'pass',",
        "  exitCode: 0,",
        "  only: null,",
        "  registerUrl: 'http://localhost:3000',",
        "  pid: 4242,",
        "  failures: [],",
        "  warnings: ['dev lock'],",
        "  checks: [",
        "    { name: 'node_modules', status: 'ok', detail: 'installed' },",
        "    { name: '.env.local', status: 'ok', detail: 'present' },",
        "    { name: 'dev lock', status: 'warn', detail: 'absent but a server answers' },",
        "  ],",
        "};",
        "process.stdout.write(JSON.stringify(payload, null, 2) + '\\n');",
        "process.exit(0);",
      ].join("\n"),
    );

    const result = runPreflightStage(stub);

    // The stub exits 3 if `--json` was not forwarded, so a passing status also
    // proves the runner asked for the machine-readable contract.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  preview preflight");
    expect(result.stdout).toContain("3 check(s), 1 warning(s)");
    expect(result.stdout).toContain("WARN  dev lock");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  it("names the failing checks and exits 1 for a failing payload", () => {
    const stub = writeStub(
      "fail.mjs",
      [
        "const payload = {",
        "  projectRoot: process.cwd(),",
        "  port: 3000,",
        "  gate: 'fail',",
        "  exitCode: 1,",
        "  only: null,",
        "  registerUrl: null,",
        "  pid: null,",
        "  failures: ['dev server pid', 'reach port 3000'],",
        "  warnings: [],",
        "  checks: [",
        "    { name: 'dev server pid', status: 'fail', detail: 'process 1 is gone (stale lock)', fix: 'npm run dev' },",
        "    { name: 'reach port 3000', status: 'fail', detail: 'nothing answered on loopback', fix: 'npm run dev, then re-run this preflight' },",
        "  ],",
        "};",
        "process.stdout.write(JSON.stringify(payload, null, 2) + '\\n');",
        "process.exit(1);",
      ].join("\n"),
    );

    const result = runPreflightStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  preview preflight");
    expect(result.stdout).toContain("gate \"fail\", 2 check(s) failed");
    expect(result.stdout).toContain("dev server pid");
    expect(result.stdout).toContain("reach port 3000");
    expect(result.stdout).toContain("fix: npm run dev");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: preflight");
  });

  it("fails a stage that writes no JSON rather than reading it as a pass", () => {
    const stub = writeStub(
      "crash.mjs",
      "process.stderr.write('stub preflight: exploded before writing JSON\\n');\nprocess.exit(2);\n",
    );

    const result = runPreflightStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("produced no JSON — the gate may have crashed");
    // The child's own output is surfaced, so the crash is diagnosable.
    expect(result.stdout).toContain("stub preflight: exploded before writing JSON");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: preflight");
  });
});

/**
 * The self-mutation families the sweep declares, read from the one table that names them.
 *
 * `STRIKE_WORDS` is what `strikeKind` resolves a strike to and what the sweep's own report
 * looks a family's words up in, so its keys are the vocabulary a self-mutation survivor can
 * carry: the helper, the detector struck whole, one limb of one, a check in the runner, an
 * answer from the shared lock, and the declared-table ratchet. `broken` is deliberately not
 * among them — it is a strike the sweep could not apply, not a family that survived. The
 * table is declared in the shared vocabulary module the sweep imports it from, so that is
 * where it is read.
 *
 * Read from the source because no run reports the set: a survivor's `kind` names one family
 * and never the whole list, and a sweep whose anchors do not fit exits before striking. The
 * table is one family to a line, so the keys are read rather than the literal parsed.
 */
function declaredSelfMutationFamilies(): string[] {
  const source = readFileSync(vocabularyModule, "utf8");
  const table = source.match(/const STRIKE_WORDS = \{([\s\S]*?)\n\};/);
  if (table === null) {
    throw new Error(
      ".freebuff/mutation-vocabulary.mjs no longer declares STRIKE_WORDS as an object literal; " +
        "re-point this case at whatever names the strike families now.",
    );
  }
  return [...table[1].matchAll(/^ {2}(\w+):\s*\{/gm)].map((hit) => hit[1]);
}

/**
 * The `--json` field a family's strike count lands in. Every family's field is its kind with
 * `SelfMutations` after it, with one exception: the helper family is struck as kind `self`,
 * and `helperSelfMutations` is the only place that says `helper`.
 */
function selfMutationCountField(kind: string): string {
  return kind === "self" ? "helperSelfMutations" : `${kind}SelfMutations`;
}

/**
 * A stub sweep that reports one survivor of every family the real sweep declares, each on a
 * path of its own so a case can read back the mark and the count word the runner gave it.
 * The families come from the sweep, so a family added there is driven here without an edit
 * and without a copy of the list.
 */
function vocabularySweep(families: string[]): string {
  const survivors = families.map(
    (family) =>
      `    { path: 'src/lib/vocabulary-${family}.ts', line: null, kind: '${family}', ` +
      `descriptor: '${family}: the ${family} family reports nothing' },`,
  );
  return [
    "if (!process.argv.includes('--json')) process.exit(3);",
    "process.stdout.write(JSON.stringify({",
    "  root: process.cwd(),",
    "  gate: 'fail',",
    "  exitCode: 1,",
    `  checked: ${families.length},`,
    "  survivors: [",
    ...survivors,
    "  ],",
    "}) + '\\n');",
    "process.exit(1);",
  ].join("\n");
}

describe("the CI runner's mutation stage", () => {
  it("reports a clean sweep and exits 0 for a passing payload", () => {
    const stub = writeStub(
      "sweep-pass.mjs",
      [
        "if (!process.argv.includes('--json')) {",
        "  process.stderr.write('stub: --json was not forwarded\\n');",
        "  process.exit(3);",
        "}",
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'pass',",
        "  exitCode: 0,",
        "  checked: 530,",
        "  survivors: [],",
        "}) + '\\n');",
        "process.exit(0);",
      ].join("\n"),
    );

    const result = runMutationStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  mutation sweep");
    expect(result.stdout).toContain("530 mutation(s) checked, no survivors");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  it("names each survivor by file and line, grouped by kind, and exits 1", () => {
    const stub = writeStub(
      "sweep-fail.mjs",
      [
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'fail',",
        "  exitCode: 1,",
        "  checked: 530,",
        "  survivors: [",
        "    { path: 'src/app/api/posts/route.ts', line: 31, kind: 'guard', descriptor: 'removed the isUuid guard', where: 'POST', total: 22, masked: 0, named: 0 },",
        "    { path: 'src/app/api/jobs/route.ts', line: 37, kind: 'failopen', descriptor: 'guard returned success instead of failing', where: 'POST', total: 22, masked: 0, named: 0 },",
        "    { path: 'src/app/api/groups/route.ts', line: 15, kind: 'catch', descriptor: 'rethrow removed from catch', where: 'POST', total: 22, masked: 0, named: 0 },",
        "    { path: '.freebuff/mutation-guards.mjs', line: null, kind: 'self', descriptor: 'helper isUuid inverted', where: 'self', total: 1, masked: 0, named: 0 },",
        "    { path: '.freebuff/ci.mjs', line: null, kind: 'runner', descriptor: 'dead-input: the runner reports no stage input that matches no file', where: '.freebuff/ci.mjs  dead-input: the runner reports no stage input that matches no file', test: 'src/test/ci-runner.test.ts', total: 129, masked: 1, named: 0 },",
        "    { path: '.freebuff/mutation-lock.mjs', line: null, kind: 'lock', descriptor: 'absorbed: the lock reports no file that still carries the mutation it recorded', where: '.freebuff/mutation-lock.mjs  absorbed: the lock reports no file that still carries the mutation it recorded', test: 'src/test/mutation-sweep-recovery.test.ts', total: 9, masked: 1, named: 0 },",
        "    { path: 'src/test/declared-strikes.ts', line: null, kind: 'ratchet', descriptor: 'ratchet: the declared-table hold returns before it compares anything', where: 'src/test/declared-strikes.ts  ratchet: the declared-table hold returns before it compares anything', test: 'src/test/declared-strikes.test.ts', total: 9, masked: 1, named: 0 },",
        "    { path: 'src/test/convention-guards.ts', line: null, kind: 'convention', descriptor: 'mount: the detector flags no raw mount', where: 'src/test/convention-guards.ts  mount: the detector flags no raw mount', test: 'src/test/convention-guards.test.ts', total: 5, masked: 1, named: 0 },",
        "    { path: 'src/test/convention-guards.ts', line: null, kind: 'limb', descriptor: 'beat-seam: the step limb stops seeing a callback that was renamed out of it', where: 'src/test/convention-guards.ts  beat-seam: the step limb stops seeing a callback that was renamed out of it', test: 'src/test/beat-seams.test.ts', total: 18, masked: 1, named: 0 },",
        "  ],",
        "}) + '\\n');",
        "process.exit(1);",
      ].join("\n"),
    );

    const result = runMutationStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  mutation sweep");
    // The count is broken down by kind, and the depths are named apart — a check inside
    // the runner is neither a test helper nor a detector, a detector that reports nothing
    // at all is not one limb of one that went dark — so none of them reads as another's
    // count.
    expect(result.stdout).toContain(
      "530 checked, 9 survivor(s): 1 guard, 1 fail-open guard, 1 undriven catch, 1 helper, " +
        "1 runner check, 1 lock check, 1 declared-table ratchet, 1 whole detector, 1 detector limb",
    );
    // Each survivor is named by project-relative path and line, and grouped by
    // how it survived.
    expect(result.stdout).toContain("SURVIVED GUARD  src/app/api/posts/route.ts:31");
    expect(result.stdout).toContain("SURVIVED FAIL-OPEN  src/app/api/jobs/route.ts:37");
    expect(result.stdout).toContain("UNDRIVEN CATCH  src/app/api/groups/route.ts:15");
    // A survivor with no line (a helper self-mutation) is named by path alone.
    expect(result.stdout).toContain("SURVIVED HELPER  .freebuff/mutation-guards.mjs");
    expect(result.stdout).not.toContain(".freebuff/mutation-guards.mjs:null");
    // A check in the runner gets its own mark rather than the helper's or the detector's:
    // `SURVIVED (runner)`, the sweep's own fallback for a kind this summary does not know,
    // is what a reader would be left with if this line were missing.
    expect(result.stdout).toContain("SURVIVED RUNNER  .freebuff/ci.mjs");
    expect(result.stdout).not.toContain("SURVIVED (runner)");
    // …and one from the shared lock gets its own mark for the same reason: a kind this
    // summary does not know falls back to `SURVIVED (lock)`, which reads as "some kind of
    // survivor" rather than as the answer the three tree-editing checks share.
    expect(result.stdout).toContain("SURVIVED LOCK  .freebuff/mutation-lock.mjs");
    expect(result.stdout).not.toContain("SURVIVED (lock)");
    // …and the ratchet that holds the other families' declarations gets its own mark for the
    // same reason: a kind this summary does not know falls back to `SURVIVED (ratchet)`,
    // which reads as "some kind of survivor" rather than as the declared-table hold itself.
    expect(result.stdout).toContain("SURVIVED RATCHET  src/test/declared-strikes.ts");
    expect(result.stdout).not.toContain("SURVIVED (ratchet)");
    expect(result.stdout).toContain("SURVIVED DETECTOR  src/test/convention-guards.ts");
    expect(result.stdout).toContain(
      "SURVIVED DETECTOR LIMB  src/test/convention-guards.ts  beat-seam: the step limb stops",
    );
    expect(result.stdout).toContain("removed the isUuid guard");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: mutation");
  });

  /**
   * The sweep measures two things a survivor count cannot show: detector limbs a
   * single test case alone holds up (`thinMargin`), and detector decisions no
   * strike reaches (`unstruck` of `decisionSites`). Both used to die in the sweep's
   * own log — the run page showed only "N checked, no survivors", so a limb
   * sliding to one case was invisible until somebody read the log. This pins them
   * onto the stage line the report renders, and pins the regression shape: a thin
   * limb rides as a `WARN THIN MARGIN` detail naming the detector and the one case
   * that notices it — the run page's Warnings section and a `::warning` annotation
   * — while the gate stays green, because nothing is broken while that case holds.
   */
  /**
   * The sweep's answer on a green night that still carries a margin regression:
   * checked, no survivors, one thin limb held up by a single case — under the
   * report mode every real spawn carries. Shared by the cases that pin what the
   * run does with that answer, so the stage line a human reads and the annotation
   * a machine publishes are held against one payload rather than two lookalikes.
   */
  const THIN_MARGIN_SWEEP = [
    "if (!process.argv.includes('--json')) {",
    "  process.stderr.write('stub: --json was not forwarded\\n');",
    "  process.exit(3);",
    "}",
    "process.stdout.write(JSON.stringify({",
    "  root: process.cwd(),",
    "  gate: 'pass',",
    "  exitCode: 0,",
    "  checked: 590,",
    "  survivors: [],",
    "  thinMargin: 1,",
    "  unstruck: 63,",
    "  decisionSites: 114,",
    "  strikes: [",
    "    { path: 'src/test/convention-guards.ts', line: null, kind: 'limb',",
    "      descriptor: 'beat-seam: the step limb stops seeing a callback that was renamed out of it',",
    "      test: 'src/test/beat-seams.test.ts', total: 27, margin: 1,",
    "      caughtBy: ['catches the frame loop a surface opens beside the carousel'] },",
    "  ],",
    "}) + '\\n');",
    "process.exit(0);",
  ].join("\n");

  it("carries the sweep's margin and un-struck readings onto the stage line, and warns on a thin limb", () => {
    const stub = writeStub("sweep-thin-margin.mjs", THIN_MARGIN_SWEEP);

    const result = runMutationStage(stub);

    // The readings ride on the summary itself, after the survivor clause and any
    // recovery note, so the table row the run page prints carries them on a green
    // night as well as a red one.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  mutation sweep — 590 mutation(s) checked, no survivors — 1 thin-margin " +
        "limb(s) — 63 of 114 decision(s) un-struck",
    );
    // …and the regression, named rather than counted: the detector file, the limb's
    // own descriptor, and the single case that alone notices it.
    expect(result.stdout).toContain("WARN THIN MARGIN");
    expect(result.stdout).toContain(
      "beat-seam: the step limb stops seeing a callback that was renamed out of it",
    );
    expect(result.stdout).toContain("catches the frame loop a surface opens beside the carousel");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  /**
   * The clean night's line: the readings are reported every run, so the run page
   * shows a trend rather than only an alarm — `0 thin-margin limb(s)` is the number
   * that may fall and may not rise, and it is only meaningful beside the
   * un-struck count it is printed with. The gate stays green and no warning is
   * fabricated from a zero.
   */
  it("reports the readings on a clean night without warning from the zero", () => {
    const stub = writeStub(
      "sweep-audit-clean.mjs",
      [
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'pass',",
        "  exitCode: 0,",
        "  checked: 590,",
        "  survivors: [],",
        "  thinMargin: 0,",
        "  unstruck: 63,",
        "  decisionSites: 114,",
        "  strikes: [],",
        "}) + '\\n');",
        "process.exit(0);",
      ].join("\n"),
    );

    const result = runMutationStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  mutation sweep — 590 mutation(s) checked, no survivors — 0 thin-margin " +
        "limb(s) — 63 of 114 decision(s) un-struck",
    );
    expect(result.stdout).not.toContain("WARN THIN MARGIN");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  /**
   * The other direction of the same contract: each clause rides only when the
   * payload carries the fields it measures. The baseline shape, a refusal, and
   * every stub written before these readings existed answer without them, and a
   * summary that appended anyway would print `undefined` clauses on the run page —
   * a reading fabricated from nothing, which is the failure the conditional exists
   * to prevent.
   */
  it("prints no clause a payload did not measure", () => {
    const stub = writeStub(
      "sweep-no-audit.mjs",
      [
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'pass',",
        "  exitCode: 0,",
        "  checked: 530,",
        "  survivors: [],",
        "}) + '\\n');",
        "process.exit(0);",
      ].join("\n"),
    );

    const result = runMutationStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  mutation sweep — 530 mutation(s) checked, no survivors",
    );
    expect(result.stdout).not.toContain("thin-margin");
    expect(result.stdout).not.toContain("un-struck");
    // …and no baseline warning is fabricated from a payload that never saw a
    // baseline: the mark's own word is asserted apart from the lowercase clause
    // above, which is case-sensitive and would miss it.
    expect(result.stdout).not.toContain("WARN UN-STRUCK GROWTH");
    expect(result.stdout).not.toContain("undefined");
    expect(result.stdout).not.toContain("NaN");
  });

  /**
   * The thin-limb warning's whole route, pinned end to end: the sweep's payload →
   * the stage's `WARN THIN MARGIN` detail → the `--json` report's `annotations`
   * entry → the nightly job's `--annotations` stdout. Each piece already has a
   * case of its own — the stage line above, the renderer's Warnings section — but
   * ends pinned separately cannot notice the seam between them: a `mark` the
   * payload dropped, a redaction that ate the quoted case name, or a level that
   * flipped to `error` would each leave one end green while the diff stayed
   * silent on a night nobody read the log.
   *
   * So the runner is driven in its real report mode, and its own payload is
   * written to a file and handed to the real reporter exactly as the nightly job
   * hands it. The last assertion is one workflow command, whole: level, file,
   * stage title, and the message naming the limb and the single case that
   * notices it.
   */
  it("carries the thin-limb warning from the runner's --json into the nightly report's --annotations", () => {
    const stub = writeStub("sweep-thin-margin-annotations.mjs", THIN_MARGIN_SWEEP);

    const result = runMutationStage(stub, ["--json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("pass");

    const message =
      "beat-seam: the step limb stops seeing a callback that was renamed out of it " +
      '— one case alone notices it: "catches the frame loop a surface opens beside ' +
      'the carousel" (src/test/beat-seams.test.ts)';

    // The detail rides in the JSON with its mark and its name — what the uploaded
    // report's Warnings section reads, quoted exactly as the sweep's own line
    // quotes it (the quotes and the case name included: redaction may collapse a
    // secret-looking name, and none of these is one).
    const mutation = payload.stages.find(
      (stage: { name: string; details: { mark: string }[] }) => stage.name === "mutation",
    );
    expect(mutation.details).toContainEqual(
      expect.objectContaining({
        mark: "WARN THIN MARGIN",
        name: "src/test/convention-guards.ts",
        detail: message,
      }),
    );

    // …and the same detail as an annotation: a warning (the gate stays green),
    // pinned to the detector's file, titled for the stage — the only one this run
    // earns, so the array is the whole answer rather than a place to look in it.
    expect(payload.annotations).toEqual([
      {
        level: "warning",
        file: "src/test/convention-guards.ts",
        title: "mutation sweep",
        message,
      },
    ]);

    // The payload, written to a file and published by the real reporter — the
    // nightly job's two steps, in the job's order.
    const report = path.join(stubDir, "report-thin-margin.json");
    const summary = path.join(stubDir, "summary-thin-margin.md");
    writeFileSync(report, JSON.stringify(payload, null, 2));

    const published = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, ".freebuff", "nightly-report.mjs"),
        "--report",
        report,
        "--summary",
        summary,
        "--annotations",
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );

    expect(published.status, published.stderr).toBe(0);
    // One workflow command on stdout, and it is the whole warning — nothing in
    // the publish boundary muted it, re-leveled it, or dropped the case's name.
    const commands = published.stdout.split(/\r?\n/).filter((line) => line.startsWith("::"));
    expect(commands).toEqual([
      `::warning file=src/test/convention-guards.ts,title=mutation sweep::${message}`,
    ]);

    // …and the run page's half of the same payload: the Warnings section on a
    // green gate, with no Failures section for the warning to have joined.
    const md = readFileSync(summary, "utf8");
    expect(md).toContain("## Nightly full CI gate — ✅ all 1 stage(s) passed");
    expect(md).toContain(
      "- **WARN THIN MARGIN** (mutation sweep) `src/test/convention-guards.ts` — " +
        "beat-seam: the step limb stops",
    );
    expect(md).not.toContain("### Failures");
  }, 20_000);

  /**
   * A green sweep payload reporting its un-struck count against a recorded baseline
   * of `baseline` — the two numbers the run page's warning reads, with the rest of
   * the fields a passing night carries. Stands in for the real sweep, which emits
   * the same pair from `.freebuff/mutation-baseline.json` (pinned in
   * `src/test/mutation-baseline.test.ts`).
   */
  const unstruckSweep = (baseline: number) =>
    [
      "process.stdout.write(JSON.stringify({",
      "  root: process.cwd(),",
      "  gate: 'pass',",
      "  exitCode: 0,",
      "  checked: 590,",
      "  survivors: [],",
      "  thinMargin: 0,",
      "  unstruck: 63,",
      "  decisionSites: 114,",
      `  unstruckBaseline: ${baseline},`,
      "  strikes: [],",
      "}) + '\\n');",
      "process.exit(0);",
    ].join("\n");

  /**
   * The baseline's reading warned on the run page, end to end: the sweep carries
   * the recorded baseline's un-struck count (`unstruckBaseline`) beside the count
   * it measured, and a run past that floor is the gap having grown. Reported and
   * not failed — the ratchet (`--baseline`) owns the failure and names the
   * decisions — but green is not silent: the stage's detail feeds the run page's
   * Warnings section and the run's `::warning`, both naming both numbers and the
   * two commands that say which decisions grew and re-record the floor. Driven
   * through the real reporter like the chain above, so the bullet and the workflow
   * command are pinned against what the runner actually published.
   */
  it("warns the run page when the un-struck count grows past the recorded baseline", () => {
    const stub = writeStub("sweep-unstruck-growth.mjs", unstruckSweep(61));

    const result = runMutationStage(stub, ["--json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("pass");

    const message =
      "63 of 114 decision(s) un-struck, past the recorded baseline of 61 by 2 — " +
      "`node .freebuff/mutation-guards.mjs --baseline` names the decisions, " +
      "`--write-baseline` re-records the list once strikes reach them again";

    // The warning rides the stage's details with its mark — what the run page
    // reads — while the stage itself still passes: the warning exists precisely
    // because the gate does not fail for it.
    const mutation = payload.stages.find(
      (stage: { name: string; details: { mark: string }[] }) => stage.name === "mutation",
    );
    expect(mutation.pass).toBe(true);
    expect(mutation.details).toContainEqual(
      expect.objectContaining({ mark: "WARN UN-STRUCK GROWTH", detail: message }),
    );

    // …and as the run's one annotation: a warning titled for the stage, with no
    // file to pin — the gap is a whole-run reading, not a place on the diff.
    expect(payload.annotations).toEqual([{ level: "warning", title: "mutation sweep", message }]);

    const report = path.join(stubDir, "report-unstruck-growth.json");
    const summary = path.join(stubDir, "summary-unstruck-growth.md");
    writeFileSync(report, JSON.stringify(payload, null, 2));

    const published = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, ".freebuff", "nightly-report.mjs"),
        "--report",
        report,
        "--summary",
        summary,
        "--annotations",
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );

    expect(published.status, published.stderr).toBe(0);
    const commands = published.stdout.split(/\r?\n/).filter((line) => line.startsWith("::"));
    expect(commands).toEqual([`::warning title=mutation sweep::${message}`]);
    const md = readFileSync(summary, "utf8");
    expect(md).toContain("## Nightly full CI gate — ✅ all 1 stage(s) passed");
    expect(md).toContain(`- **WARN UN-STRUCK GROWTH** (mutation sweep) — ${message}`);
    expect(md).not.toContain("### Failures");
  }, 20_000);

  /**
   * The other side of the same conditional: a run *at* its recorded floor has not
   * grown past it, so there is nothing to warn about. No detail and no annotation
   * — the warning exists only for the run that opened the gap, and a green night
   * at the floor publishes no noise for an alert to fire on.
   */
  it("stays silent when the un-struck count sits at the recorded baseline", () => {
    const stub = writeStub("sweep-unstruck-at-baseline.mjs", unstruckSweep(63));

    const result = runMutationStage(stub, ["--json"]);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    const mutation = payload.stages.find(
      (stage: { name: string; details: { mark: string }[] }) => stage.name === "mutation",
    );
    expect(mutation.details).toEqual([]);
    expect(payload.annotations).toEqual([]);
  }, 20_000);

  /**
   * The families a strike can belong to are written down in two files that never read each
   * other: `.freebuff/mutation-guards.mjs` stamps a `kind` on every self-mutation survivor,
   * and `.freebuff/ci.mjs` marks and counts that survivor by the word. The case above pins
   * them for the families someone remembered to put in a fixture; this one takes the
   * vocabulary from the sweep itself, so a family added there is held to a mark, a count
   * word and a payload field without anyone remembering to say so.
   *
   * None of the three readings is a copy of the list: the families are read out of the
   * sweep's own declaration, the count fields out of the real sweep's `--json` payload, and
   * the marks and count words out of the real runner driven over a stub that reports one
   * survivor of every family at once. A family with no word in either map falls through to
   * the sweep's `SURVIVED (<kind>)` and `unclassified` fallbacks — this is the case that
   * goes red for it. (The *spelling* of those words is held separately, source against
   * source, in the "the runner's stage vocabulary against the sweeps' declared tables"
   * describe below — a stub cannot know the sweep's declared set, so this case holds the
   * mechanism and that one holds the words.)
   */
  it("holds every family the sweep declares to a mark, a count word and a payload field", () => {
    const families = declaredSelfMutationFamilies();
    // A parse that found nothing would make every assertion below vacuous.
    expect(families.length).toBeGreaterThan(0);

    // The payload: the real sweep, narrowed by a scope no file carries and by `--limit=0`,
    // so nothing is struck and the counts are read as fields. The empty `checked` is
    // asserted rather than assumed, so a scope that quietly began matching a file turns up
    // here as a red case instead of as a mutated tree.
    const probe = spawnSync(
      process.execPath,
      [sweep, "--json", "--file=no-such-scope", "--limit=0"],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, MUTATION_LOCK_FILE: path.join(stubDir, "lock-vocabulary.json") },
      },
    );
    expect(probe.status).toBe(0);
    const payload = JSON.parse(probe.stdout) as { checked: number } & Record<string, unknown>;
    expect(payload.checked).toBe(0);
    const fields = Object.keys(payload).filter((key) => key.endsWith("SelfMutations"));
    expect(fields.sort()).toEqual(families.map(selfMutationCountField).sort());

    // The runner: one survivor of every family, each on its own path, so the mark it was
    // given and the word it was counted under can both be read back per family.
    const stub = writeStub("sweep-vocabulary.mjs", vocabularySweep(families));
    const result = runMutationStage(stub);
    expect(result.status).toBe(1);
    const lines = result.stdout.split("\n");

    const marks = families.map((family) => {
      const line = lines.find((candidate) => candidate.includes(`vocabulary-${family}.ts`));
      expect(line, `the runner printed no detail line for the ${family} family`).toBeDefined();
      const mark = (line as string).trim().split("  ")[0];
      // The fallback a kind with no `group` entry reaches: a mark that reads as "some kind
      // of survivor" rather than as the family this strike came from.
      expect(mark).not.toBe(`SURVIVED (${family})`);
      return mark;
    });
    // Distinct marks: one word reused for two families would read as one regression twice.
    expect(new Set(marks).size).toBe(families.length);

    // `unclassified` is the count-side fallback — a survivor whose kind is in no `noun`.
    expect(result.stdout).not.toContain("unclassified");
    const summary = lines.find((line) => line.includes("survivor(s):"));
    expect(summary).toBeDefined();
    const counted = (summary as string).split("survivor(s): ")[1].split(", ");
    // One clause per family, each a count of one, and no two clauses the same word, so no
    // family is hidden inside another family's noun.
    expect(counted).toHaveLength(families.length);
    for (const clause of counted) expect(clause).toMatch(/^1 \S/);
    expect(new Set(counted).size).toBe(families.length);
  });

  it("names a strike the sweep could not apply apart from a survivor, and fails the stage", () => {
    // The sweep refuses before its first strike when one of its own anchors no longer occurs,
    // and writes that as a `broken` survivor with `checked: 0`. It is not a survivor — nothing
    // ran — so it carries the preflight sweep's own mark for an anchor to re-fit, and its
    // reason reaches the log rather than only its name.
    const stub = writeStub(
      "sweep-broken.mjs",
      [
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'fail',",
        "  exitCode: 1,",
        "  checked: 0,",
        "  lockSelfMutations: 2,",
        "  survivors: [",
        "    { path: '.freebuff/mutation-lock.mjs', line: null, kind: 'broken', descriptor: 'absorbed: the lock reports no file that still carries the mutation it recorded', where: '.freebuff/mutation-lock.mjs  absorbed: the lock reports no file that still carries the mutation it recorded', detail: 'its anchor occurs 0 time(s), expected exactly 1' },",
        "  ],",
        "}) + '\\n');",
        "process.exit(1);",
      ].join("\n"),
    );

    const result = runMutationStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  mutation sweep");
    expect(result.stdout).toContain("CHECK BROKEN  .freebuff/mutation-lock.mjs");
    expect(result.stdout).not.toContain("SURVIVED (broken)");
    expect(result.stdout).toContain(
      "absorbed: the lock reports no file that still carries the mutation it recorded — " +
        "its anchor occurs 0 time(s), expected exactly 1",
    );
    expect(result.stdout).toContain("0 checked, 1 survivor(s): 1 broken strike");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: mutation");
  });

  it("counts the two detector depths apart on the run page the nightly job publishes", () => {
    const stub = writeStub("sweep-depths.mjs", DETECTOR_DEPTHS_SWEEP);

    const result = runMutationStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "530 checked, 2 survivor(s): 1 whole detector, 1 detector limb",
    );
    expect(result.stdout).toContain("SURVIVED DETECTOR  src/test/convention-guards.ts");
    expect(result.stdout).toContain("SURVIVED DETECTOR LIMB  src/test/convention-guards.ts");

    // The same two, read apart on the run page — from the payload the runner itself
    // emits, pushed through the real renderer the nightly job uses, so the count on the
    // page is the runner's own and not a fixture kept in step by hand.
    const payload = JSON.parse(runMutationStage(stub, ["--json"]).stdout);
    const summary = renderReport(payload);

    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain(
      "| mutation sweep | ❌ fail | 530 checked, 2 survivor(s): 1 whole detector, 1 detector limb |",
    );
    expect(summary.stdout).toContain(
      "- **SURVIVED DETECTOR** `src/test/convention-guards.ts` — mount: the detector flags no raw mount",
    );
    expect(summary.stdout).toContain(
      "- **SURVIVED DETECTOR LIMB** `src/test/convention-guards.ts` — beat-seam: the step limb " +
        "stops seeing a callback that was renamed out of it",
    );
    // Three real processes: the runner twice and the renderer once. The default budget is
    // for an in-process case and this one is a queue behind the rest of the file's spawns.
  }, 20_000);

  it("reports a recovered lock as a warning on a stage that still passes", () => {
    const stub = writeStub("sweep-recovered.mjs", RECOVERED_SWEEP);

    const result = runMutationStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  mutation sweep — 12 mutation(s) checked, no survivors — 1 recovered lock",
    );
    expect(result.stdout).toContain(
      "WARN RECOVERED  src/app/api/admin/moderate/route.ts  RESTORED " +
        "src/app/api/admin/moderate/route.ts from an interrupted guard sweep",
    );
    expect(result.stderr).not.toContain("failed");
  });
});

/**
 * The sweep's own report, read by the same rule as the runner above it: a family is a word
 * the sweep declares, so every surface that speaks about a family has to have one.
 *
 * `survivedSelf` is split into one block per family — each printed under its own heading,
 * with the sentence that says what a reader has to do about it — and that split is one
 * `filter` per `kind`, so the buckets and the families are two lists that have to agree.
 * They did not: the declared-table ratchet had no bucket, so a survived ratchet strike was
 * counted, exited on and carried in the `--json` survivors while the human report printed no
 * block for it at all — the one place a reader looks for what to fix.
 *
 * The check is against the sweep's source rather than a run because a real survivor needs a
 * strike to go uncaught, which is a hand proof — the runbook records the one this bucket was
 * written from — and not something a suite can stage without editing the file under test.
 * What the bucket *prints* is the other half of that hand proof; what this holds is that the
 * bucket is still there and still has no family missing from beside it.
 */
describe("the sweep's strike-family vocabulary", () => {
  it("prints every family it declares under a block of its own", () => {
    const report = readFileSync(sweep, "utf8");
    const buckets = [
      ...report.matchAll(/survivedSelf\.filter\(\(item\) => item\.kind === "(\w+)"\)/g),
    ].map((hit) => hit[1]);
    const families = declaredSelfMutationFamilies();

    // A parse that found no bucket would make the comparison below vacuous.
    expect(buckets.length).toBeGreaterThan(0);
    // Two families sharing one block would print a survivor under a neighbour's words.
    expect(new Set(buckets).size, "two families share one block").toBe(buckets.length);
    expect(buckets.sort()).toEqual([...families].sort());
  });

  /**
   * The other end of the same vocabulary: not which words are declared, but which ones the
   * sweep's own entries can *stamp*.
   *
   * A `kind` is written into an entry — or into the constructor that builds one, which is how
   * every family but the helpers does it — and `strikeKind` resolves it: `limb` for a detector
   * struck at one limb, the entry's own `kind` otherwise, `self` for a helper that names none.
   * Stamp a word `STRIKE_WORDS` does not declare and two things go wrong at once: the
   * survivor's own log line dereferences `STRIKE_WORDS[kind].what` and throws, and the runner
   * is handed a word it does not know and falls back to `SURVIVED (<kind>)`. So the stamped
   * set and the declared set have to be the same set.
   *
   * The stamped half is read out of the sweep rather than re-derived here — a second copy of
   * the resolution would go on answering after `strikeKind` changed, which is the silent pass
   * this case exists to prevent. `--anchors --json` already reports a row for every
   * self-mutation and runs nothing, and each row carries the `kind` `strikeKind` gives the
   * entry, so the vocabulary the sweep would speak is read from the resolution the report
   * itself uses. A drifted anchor is what that mode reports and it refuses nothing, so the
   * rows are read whether or not the tree is currently clean.
   */
  it("stamps only the kinds its own vocabulary declares", () => {
    const probe = spawnSync(process.execPath, [sweep, "--anchors", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: path.join(stubDir, "lock-stamps.json") },
    });
    const payload = JSON.parse(probe.stdout) as { strikes: { name: string; kind: string }[] };
    // A run that reported no strike would make the comparison below vacuous.
    expect(payload.strikes.length).toBeGreaterThan(0);

    const stamped = [...new Set(payload.strikes.map((row) => row.kind))].sort();
    // Both ways: every kind the entries stamp has a declared word, and every declared word is
    // stamped by some entry — a word nothing can stamp is a family the report claims to speak
    // and never does.
    expect(stamped).toEqual(declaredSelfMutationFamilies().sort());
  });
});

/** A table's body: the lines from `= {` to the line that closes it at column zero. */
function tableBody(source: string, table: RegExp, what: string): string {
  const start = source.search(table);
  if (start === -1) {
    throw new Error(
      `${table.source} no longer matches the source; re-point the vocabulary hold at ` +
        `whatever now declares ${what}.`,
    );
  }
  const open = source.indexOf("{", start);
  const close = source.indexOf("\n};", open);
  if (open === -1 || close === -1) {
    throw new Error(`${what} is no longer an object literal spanning whole lines; re-read it.`);
  }
  return source.slice(open, close);
}

/** The table's keys, read the way the sweeps' own scans read them: one per line, first word. */
function tableKeys(body: string): string[] {
  return [...body.matchAll(/^ {2}(\w+):/gm)].map((hit) => hit[1]);
}

/** The mark a key's value carries, read from the first double-quoted string after the key. */
function tableMarks(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/^ {2}(\w+):[\s\S]*?"([^"]+)"/gm)].map((hit) => [hit[1], hit[2]]),
  );
}

/**
 * A stage map's own body, brace-matched from `const <name> = {` after the stage heading —
 * the two single-line stage groups have no line of their own to close on, so the closing
 * brace is counted rather than searched for.
 */
function stageMapBody(stageSource: string, stage: RegExp, mapName: "group" | "noun"): string {
  const stageStart = stageSource.search(stage);
  if (stageStart === -1) {
    throw new Error(
      `${stage.source} no longer matches the stage table; re-point this hold at the stage.`,
    );
  }
  const open = stageSource.indexOf(`const ${mapName} = {`, stageStart);
  if (open === -1) {
    throw new Error(
      `the stage no longer declares const ${mapName} = { after the stage heading; ` +
        "re-point this hold at whatever names the stage's words now.",
    );
  }
  let depth = 0;
  for (let i = stageSource.indexOf("{", open); i < stageSource.length; i += 1) {
    if (stageSource[i] === "{") depth += 1;
    if (stageSource[i] === "}") {
      depth -= 1;
      if (depth === 0) return stageSource.slice(stageSource.indexOf("{", open), i + 1);
    }
  }
  throw new Error(`const ${mapName} = { after the stage heading never closes; re-read the stage.`);
}

/**
 * A stage map's key-to-mark pairs. Every entry's value is a plain double-quoted string —
 * that shape is part of what this hold keeps — so the pairs are scanned wherever they sit:
 * the mutation stage's map is one key to a line, the other two stages' groups are single-line
 * literals, and a reader that assumed either shape would silently read the other as empty.
 */
function stageMarks(body: string): Map<string, string> {
  return new Map([...body.matchAll(/\b(\w+):\s*"([^"]+)"/g)].map((hit) => [hit[1], hit[2]]));
}

/** The words whose stamps a sweep's own source must still spell, beside its table. */
function stampProbe(word: string): RegExp {
  return new RegExp(`(?:\\bkind:|KIND_[A-Z]+ =) "${word}"`);
}

/** The one sweep-relative path each stage is read against, for red-case messages. */
const SWEEP_OF: Record<string, string> = {
  "mutation-coverage": ".freebuff/mutation-coverage.mjs",
  "mutation-preflight": ".freebuff/mutation-preflight.mjs",
  mutation: ".freebuff/mutation-guards.mjs",
};

/**
 * The runner's stage words against the vocabularies the sweeps declare.
 *
 * Each mutation stage maps the `kind` a survivor carries to the mark it is reported under and
 * — for the guard sweep — the count word its summary names. Those words are declared twice: by
 * the sweep that stamps the kind, and by the runner that reports it. A mark renamed in
 * `.freebuff/ci.mjs` alone leaves the survivor readable but no longer the sweep's word; a key
 * dropped from a stage map silently routes that family to the runner's `SURVIVED (<kind>)` /
 * `unclassified` fallbacks, which the runtime stub cases above deliberately let pass (a stub
 * cannot know the sweep's declared set). So the three stage maps are read from the runner's own
 * source and held, key-for-key and word-for-word, against the tables read from the sweeps' own
 * sources:
 *
 *   - the mutation stage's `group` and `noun` carry every kind the guard sweep's own report
 *     sorts survivors into — the six families `STRIKE_WORDS` declares plus the three route
 *     kinds it stamps by hand — plus `broken`, and nothing else, both ways. Every declared
 *     family is held to sit inside the report's set. The marks and count words themselves are
 *     the runner's own coin — the sweep declares kinds, not marks — so their spelling is held
 *     by the runtime cases over a stub survivor of each kind, and this case holds which kinds
 *     exist on each side. The `self`/`noun` discrepancy (a helper struck as kind `self`) is
 *     why the keys are held per map rather than derived from one;
 *   - the preflight and coverage stages' `group` keys are their sweeps' `SURVIVOR_WORDS` words,
 *     both ways. The coverage stage's marks are that table's marks verbatim; the preflight
 *     stage's are the runner's own (`SURVIVED MUTATION`, not the sweep's bare `SURVIVED`, so
 *     three stages' details cannot read as one sweep's);
 *   - one mark crosses sweeps — `broken` reporting as `CHECK BROKEN` in all three stages —
 *     because one repair is shared: an anchor to re-fit. That, and the apartness of every
 *     other stage's marks, is held as its own claim, so a mark copied between stages reds
 *     here rather than only in the run page it would blur.
 *
 * Each table is read out of the one place its words are declared now — the shared vocabulary
 * module the three sweeps import from — one key to a line, the way the sweeps' own scans read
 * them; and each sweep's source must still name its table (`SURVIVOR_WORDS`) in its import,
 * so a sweep whose import is reworded away reds loudly here instead of comparing empty sets.
 */
describe("the runner's stage vocabulary against the sweeps' declared tables", () => {
  const ciSource = readFileSync(ciRunner, "utf8");
  const guardsSource = readFileSync(sweep, "utf8");
  const vocabularySource = readFileSync(
    path.join(projectRoot, ".freebuff", "mutation-vocabulary.mjs"),
    "utf8",
  );
  const preflightSource = readFileSync(
    path.join(projectRoot, ".freebuff", "mutation-preflight.mjs"),
    "utf8",
  );
  const coverageSource = readFileSync(coverageLauncher, "utf8");
  /** The fourth sweep — the minimal end-to-end proof of the inheritance claim. */
  const fourthSource = readFileSync(path.join(projectRoot, ".freebuff", "mutation-example.mjs"), "utf8");

  const guardsFamilies = tableKeys(
    tableBody(vocabularySource, /const STRIKE_WORDS = /, "STRIKE_WORDS"),
  );
  // The kinds the guard sweep's own report sorts survivors into, read from its bucket
  // filters: the six `STRIKE_WORDS` families a strike resolves to through `strikeKind`, plus
  // the route kinds it stamps by hand (`guard`, `failopen`, `catch`), each with a bucket of
  // its own in the log and the `--json` list. This is the report-side vocabulary — the set a
  // survivor's `kind` can actually carry when the sweep hands it to the runner.
  const guardsReportKinds = [
    ...new Set(
      [...guardsSource.matchAll(/\bitem\.kind === "(\w+)"/g)].map((hit) => hit[1]),
    ),
  ];
  const preflightWords = tableKeys(
    tableBody(
      vocabularySource,
      /const PREFLIGHT_SURVIVOR_WORDS = /,
      "the preflight sweep's SURVIVOR_WORDS",
    ),
  );
  const coverageWordsTable = tableMarks(
    tableBody(
      vocabularySource,
      /const COVERAGE_SURVIVOR_WORDS = /,
      "the coverage launcher's SURVIVOR_WORDS",
    ),
  );
  const coverageWords = tableKeys(
    tableBody(
      vocabularySource,
      /const COVERAGE_SURVIVOR_WORDS = /,
      "the coverage launcher's SURVIVOR_WORDS",
    ),
  );

  const mutationGroup = stageMarks(stageMapBody(ciSource, /^  mutation: \(stage\)/m, "group"));
  const mutationNoun = stageMarks(stageMapBody(ciSource, /^  mutation: \(stage\)/m, "noun"));
  const preflightGroup = stageMarks(
    stageMapBody(ciSource, /^  "mutation-preflight": \(stage\)/m, "group"),
  );
  const coverageGroup = stageMarks(
    stageMapBody(ciSource, /^  "mutation-coverage": \(stage\)/m, "group"),
  );

  for (const [sweepFile, words] of [
    [SWEEP_OF["mutation-preflight"], preflightWords],
    [SWEEP_OF["mutation-coverage"], coverageWords],
  ] as const) {
    it(`keeps the ${sweepFile} words its own source can stamp`, () => {
      // A parse that found nothing would make the comparison below vacuous.
      expect(words.length).toBeGreaterThan(0);
      const source = readFileSync(path.join(projectRoot, sweepFile), "utf8");
      // The sweep still names the table it imports (the refusal and the report read their
      // words through the local alias), so a hold re-pointed at a file that no longer
      // consumes the vocabulary reads a real disagreement rather than two empty sets.
      expect(source).toContain("SURVIVOR_WORDS");
      for (const word of words) {
        expect(
          stampProbe(word).test(source),
          `${sweepFile} declares "${word}" but no longer stamps it beside the table`,
        ).toBe(true);
      }
    });
  }

  it("holds the mutation stage's marks and count words to the kinds the guard sweep's report sorts", () => {
    expect(guardsFamilies.length).toBeGreaterThan(0);
    expect(guardsReportKinds.length).toBeGreaterThan(0);
    expect(mutationGroup.size).toBeGreaterThan(0);
    expect(mutationNoun.size).toBeGreaterThan(0);
    // Every family the sweep declares is one its report can hand over: a family with no
    // bucket is struck, counted, and reported nowhere.
    expect(guardsReportKinds).toEqual(expect.arrayContaining([...guardsFamilies].sort()));
    // `broken` is not a survivor kind — it is the strike the sweep could not apply, and the
    // one word all three stages share — so it is the only key outside the report's set.
    const survivorsOf = (map: Map<string, string>) =>
      [...map.keys()].filter((kind) => kind !== "broken").sort();
    // Both ways: a kind with no mark is reported under the runner's `SURVIVED (<kind>)`
    // fallback and counted under `unclassified`; a map key the sweep's report cannot stamp is
    // a word kept warm for a kind that no longer exists.
    expect(survivorsOf(mutationGroup)).toEqual(guardsReportKinds.sort());
    expect(survivorsOf(mutationNoun)).toEqual([...guardsReportKinds].sort());
    // One word to a kind: a count word reused for two kinds reads one regression twice.
    expect(new Set(mutationNoun.values()).size).toBe(mutationNoun.size);
    // The sweep still stamps `broken` beside its table — its refusals carry it — and the stage
    // still keeps the count word for it, so a strike that cannot be applied is counted even
    // when nothing survived.
    expect(stampProbe("broken").test(guardsSource), 'the guard sweep no longer stamps "broken"').toBe(true);
    expect(mutationNoun.get("broken"), "no count word for a strike the sweep could not apply").toBeDefined();
  });

  it("holds the preflight stage's kinds to the preflight sweep's SURVIVOR_WORDS", () => {
    expect(preflightWords.length).toBeGreaterThan(0);
    expect(preflightGroup.size).toBeGreaterThan(0);
    // Both ways, and here the words themselves do cross: the sweep's table is the one place its
    // buckets and its refusal read their words from, and the stage map is the one place the
    // runner names them, so a kind renamed on either side leaves the other counting a survivor
    // under a word nothing reports. The marks are the runner's own — held apart across stages
    // below, and spelled by the runtime cases over a stub payload.
    expect([...preflightGroup.keys()].sort()).toEqual([...preflightWords].sort());
    expect(new Set(preflightGroup.values()).size).toBe(preflightGroup.size);
  });

  it("holds the coverage stage's marks to the coverage launcher's SURVIVOR_WORDS", () => {
    expect(coverageWords.length).toBeGreaterThan(0);
    expect(coverageGroup.size).toBeGreaterThan(0);
    expect([...coverageGroup.keys()].sort()).toEqual([...coverageWords].sort());
    for (const word of coverageWords) {
      expect(coverageGroup.get(word), `the coverage stage rewords "${word}"`).toBe(
        coverageWordsTable.get(word),
      );
    }
  });

  it("finds every sweep that reports survivors through the shared vocabulary module", () => {
    // A fourth sweep inherits its refusal and its spelling pins only while its consumer line
    // is written the way these three write theirs: an import from `./mutation-vocabulary.mjs`
    // aliased to the name the suites hold (`as SURVIVOR_WORDS`, or the guard sweep's
    // `STRIKE_WORDS`). A consumer written any other way is invisible to this case — which is
    // the honest failure, red here until the hold is taught the new shape — and the alias is
    // what the suite-side holds read, so the shapes stay one.
    const consumers = [
      [sweep, guardsSource],
      [path.join(projectRoot, SWEEP_OF["mutation-preflight"]), preflightSource],
      [coverageLauncher, coverageSource],
      // The fourth sweep: the minimal end-to-end proof this case existed for — a real
      // consumer that inherits the table (`FOURTH_SURVIVOR_WORDS`, named for itself as the
      // module's header directs), the refusal and the spelling pins by importing alone.
      [path.join(projectRoot, ".freebuff", "mutation-example.mjs"), fourthSource],
    ] as const;
    for (const [file, source] of consumers) {
      expect(
        source,
        `${file} no longer imports its table from the shared vocabulary module`,
      ).toMatch(/import \{[^}]*\} from "\.\/mutation-vocabulary\.mjs"/);
    }
    expect(guardsSource).toContain("STRIKE_WORDS");
  });

  it("holds the fourth sweep to the vocabulary its import speaks", () => {
    // The consumer-discovery case above finds the sweep by its import shape; this one holds
    // what the import bought it. Read from the module rather than restated, because the
    // inheritance is the claim: a word renamed in `FOURTH_SURVIVOR_WORDS` alone reds here, a
    // table re-declared in the sweep alone reds the consumer case, and neither can drift from
    // the other silently.
    const fourthWords = tableKeys(
      tableBody(vocabularySource, /const FOURTH_SURVIVOR_WORDS = /, "the fourth sweep's SURVIVOR_WORDS"),
    );
    expect(fourthWords.length).toBeGreaterThan(0);
    // The sweep speaks the table: the local alias is what its report reads, and the refusal
    // names the table by the name the suite holds.
    expect(fourthSource).toContain("SURVIVOR_WORDS");
    expect(fourthSource).toContain('from "./mutation-vocabulary.mjs"');
    // Every declared word is stamped in the sweep beside its table, and every stamp names a
    // declared word — the same two-way scan-health reading the three grown-up sweeps get.
    for (const word of fourthWords) {
      expect(
        stampProbe(word).test(fourthSource),
        `the fourth sweep declares "${word}" but no longer stamps it`,
      ).toBe(true);
    }
    const stamped = [...fourthSource.matchAll(/\bkind: "(\w+)"/g)].map((hit) => hit[1]);
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.every((kind) => fourthWords.includes(kind)), `the fourth sweep stamps ${stamped.join(", ")}`).toBe(
      true,
    );
    // The refusal it inherited is the module's one comparison answering through the sweep's
    // own stamps: the sweep must still call `vocabularyHoles`, and still refuse on it.
    expect(fourthSource).toContain("vocabularyHoles(");
    expect(fourthSource).toContain("START-UP REFUSAL");
  });

  it("keeps the three stages' marks apart, except the one repair they share", () => {
    // `broken` is the same event in every sweep — an anchor no longer in the file it rewrites —
    // so all three stages report it under one word, the coverage launcher's own.
    for (const stage of [mutationGroup, preflightGroup, coverageGroup]) {
      expect(stage.get("broken"), "a stage has no word for an anchor it could not strike").toBe(
        "CHECK BROKEN",
      );
    }
    // Every other mark names one sweep's repair: a survivor of the guard sweep reads nothing
    // like a survivor of the coverage launcher, because the run page renders the three stages'
    // details together. A mark copied from one stage to another would file two different
    // weakenings under one word.
    const marks = [...mutationGroup.values(), ...preflightGroup.values(), ...coverageGroup.values()];
    for (const mark of new Set(marks)) {
      const uses = marks.filter((word) => word === mark).length;
      expect(uses, `"${mark}" names more than one repair`).toBe(mark === "CHECK BROKEN" ? 3 : 1);
    }
  });
});

/**
 * The runner's vocabulary pre-pass: a tree-editing stage answers `--vocabulary --json` before it
 * spawns its sweep, and a vocabulary hole reds the stage on its own.
 *
 * Every sweep's own suite holds its refusal, and the cross-sweep describe below holds the three
 * payloads to each other; what the runner adds is sequencing — a hole makes the sweep refuse
 * before its first strike anyway, so a run that pays for the sweep to reach that refusal has
 * bought nothing but the wait. The pre-pass is folded into `runJsonGate` as an opt-in
 * (`vocabularyFirst`), and these cases hold both halves of its bargain: a hole positively read
 * fails the stage and the sweep is never spawned (proven by a stub that logs what argv it was
 * asked with), and *anything else* — a clean table, a legacy stub whose `--vocabulary` output is
 * not a vocabulary report at all — hands the stage to the sweep untouched, because the stub seam
 * every other case here drives the runner through is exactly that second kind of script, and a
 * pre-pass that summarised it as a broken contract would red the whole suite. A hole must be
 * positively read to fail a stage; the sweep's own refusal speaks for every other way the mode
 * can fail.
 */
describe("the runner's vocabulary pre-pass over the tree-editing stages", () => {
  /** Runs the real runner's mutation stage against a stub, with extra env beside the defaults. */
  function runMutationStageEnv(stubPath: string, extraEnv: Record<string, string>) {
    return spawnSync(process.execPath, [ciRunner, "--only=mutation"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI_MUTATION_SCRIPT: stubPath,
        CI_CACHE_FILE: freshCachePath(),
        ...extraEnv,
      },
    });
  }

  /**
   * What the last stub recorded as the argv it was invoked with, one entry per spawn. Lazy on
   * purpose: `stubDir` is made in `beforeAll`, after this describe's body has run, so a const
   * here would bake in an empty prefix and land the log at the project root.
   */
  const spawnLog = () => path.join(stubDir, "vocabulary-pre-pass-spawns.log");

  /** The runner's own source, for the source-level hold on the wiring. */
  const ciSource = readFileSync(ciRunner, "utf8");

  /**
   * A stub sweep that answers a vocabulary payload of `body` on `--vocabulary`, and a clean
   * run report on anything else — logging the argv it was invoked with, so a case can prove
   * which mode the runner actually asked for.
   */
  const vocabularyPayload = (...body: string[]) =>
    [
      `import fs from "node:fs";`,
      // Logged before the mode branch, so a spawn the runner cuts short is on the log too —
      // the hole case's whole proof is that the log holds exactly one entry. The log is
      // optional: a case that never reads it passes no path, and the stub still answers.
      `if (process.env.STUB_SPAWN_LOG) fs.appendFileSync(process.env.STUB_SPAWN_LOG, process.argv[2] + "\\n");`,
      `if (process.argv[2] === "--vocabulary") {`,
      `  process.stdout.write(JSON.stringify(${body.join("\n")}) + "\\n");`,
      `  process.exit(1);`,
      `}`,
      `process.stdout.write(JSON.stringify({`,
      `  root: process.cwd(),`,
      `  gate: 'pass',`,
      `  exitCode: 0,`,
      `  checked: 530,`,
      `  survivors: [],`,
      `}) + "\\n");`,
      `process.exit(0);`,
    ].join("\n");

  it("reds the stage on a vocabulary hole and never spawns the sweep", () => {
    rmSync(spawnLog(), { force: true });
    const stub = writeStub(
      "sweep-vocab-hole.mjs",
      vocabularyPayload(
        `{`,
        `  mode: 'vocabulary', root: process.cwd(),`,
        `  unnamed: [{ path: '.freebuff/mutation-guards.mjs', name: 'probe: an entry that stamps the beat kind', kind: 'beat' }],`,
        `  unspoken: ['orphan'],`,
        `  gate: 'fail', exitCode: 1,`,
        `}`,
      ),
    );

    const result = runMutationStageEnv(stub, { STUB_SPAWN_LOG: spawnLog() });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  mutation sweep");
    // The summary names the sequencing, not just the failure: the sweep was not run, and
    // why it would have refused is the reader's repair.
    expect(result.stdout).toContain(
      "vocabulary hole(s) — the mutation sweep would refuse before its first strike; it was not run",
    );
    // Each hole is a detail of its own: the stamp no word covers, and the word nothing stamps.
    expect(result.stdout).toContain("VOCABULARY HOLE  unnamed — .freebuff/mutation-guards.mjs");
    expect(result.stdout).toContain('it stamps kind "beat", which the sweep\'s table does not declare');
    expect(result.stdout).toContain('VOCABULARY HOLE  unspoken — "orphan"');
    expect(result.stdout).toContain('the sweep declares "orphan" and nothing stamps it');

    // The whole point of the pre-pass: the only thing the stub was ever asked to be is the
    // vocabulary report — the run mode never spawned.
    expect(readFileSync(spawnLog(), "utf8").split("\n").filter((line) => line !== "")).toEqual([
      "--vocabulary",
    ]);
  });

  it("hands the stage to the sweep when the table is clean", () => {
    rmSync(spawnLog(), { force: true });
    const stub = writeStub(
      "sweep-vocab-clean.mjs",
      vocabularyPayload(
        `{`,
        `  mode: 'vocabulary', root: process.cwd(),`,
        `  families: [{ kind: 'ratchet', declared: true, count: 1, strikes: [{ path: 'src/test/declared-strikes.ts', name: 'ratchet: the declared-table hold returns before it compares anything' }] }],`,
        `  unnamed: [], unspoken: [],`,
        `  gate: 'pass', exitCode: 0,`,
        `}`,
      ),
    );

    const result = runMutationStageEnv(stub, { STUB_SPAWN_LOG: spawnLog() });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  mutation sweep");
    expect(result.stdout).toContain("530 mutation(s) checked, no survivors");
    // A clean table is not a failure and not a summary either: the run happened.
    expect(result.stdout).not.toContain("vocabulary hole");
    expect(readFileSync(spawnLog(), "utf8")).toContain("--json");
  });

  it("hands the stage to the sweep when --vocabulary answers something else entirely", () => {
    // The stub seam every other case here runs through: a script whose `--vocabulary` output
    // is not a vocabulary report. The pre-pass must stay silent about that — the sweep's own
    // answer is what the stage reports — so this legacy shape passes through untouched.
    rmSync(spawnLog(), { force: true });
    const stub = writeStub(
      "sweep-vocab-legacy.mjs",
      [
      `import fs from "node:fs";`,
      `if (process.argv[2] === "--vocabulary") {`,
      `  process.stdout.write(JSON.stringify({ root: process.cwd(), gate: 'pass', exitCode: 0, checked: 530, survivors: [] }) + "\\n");`,
      `  process.exit(0);`,
      `}`,
      `fs.appendFileSync(process.env.STUB_SPAWN_LOG, process.argv[2] + "\\n");`,
        `process.stdout.write(JSON.stringify({`,
        `  root: process.cwd(),`,
        `  gate: 'pass',`,
        `  exitCode: 0,`,
        `  checked: 530,`,
        `  survivors: [],`,
        `}) + "\\n");`,
        `process.exit(0);`,
      ].join("\n"),
    );

    const result = runMutationStageEnv(stub, { STUB_SPAWN_LOG: spawnLog() });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  mutation sweep");
    expect(readFileSync(spawnLog(), "utf8")).toContain("--json");
  });

  /** Runs the real runner's vocabulary smoke stage against a stub, with extra env beside the defaults. */
  function runSmokeStageEnv(stubPath: string, extraEnv: Record<string, string>) {
    return spawnSync(process.execPath, [ciRunner, "--only=mutation-example"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI_EXAMPLE_SCRIPT: stubPath,
        CI_CACHE_FILE: freshCachePath(),
        ...extraEnv,
      },
    });
  }

  it("smoke-runs the real fourth sweep end to end through its stage", () => {
    // No stub: the real sweep is the cheapest script in the gate — its run mode is one
    // demonstration child — so this is the end-to-end proof that a fifth JSON gate flows
    // through the stage table, the pre-pass (a clean table passes through) and the summarize
    // contract, in that order, in a run that costs milliseconds.
    const result = runSmokeStageEnv(path.join(projectRoot, ".freebuff", "mutation-example.mjs"), {});

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  vocabulary smoke");
    expect(result.stdout).toContain("1 demonstration stamp(s) checked, no survivors");
    expect(result.stdout).not.toContain("VOCABULARY HOLE");
  });

  it("reds the smoke stage on a hole and never spawns its run mode", () => {
    // The pre-pass is a property of `vocabularyFirst`, not of any one stage — proven here on
    // the fifth gate: the stub answers a hole on `--vocabulary` and a run report on anything
    // else, so the only way this stage reds with only a vocabulary spawn on the log is the
    // pre-pass riding a gate that is not one of the three tree-editing stages.
    rmSync(spawnLog(), { force: true });
    const stub = writeStub(
      "example-vocab-hole.mjs",
      vocabularyPayload(
        `{`,
        `  mode: 'vocabulary', root: process.cwd(),`,
        `  unnamed: [], unspoken: ['orphan'],`,
        `  gate: 'fail', exitCode: 1,`,
        `}`,
      ),
    );

    const result = runSmokeStageEnv(stub, { STUB_SPAWN_LOG: spawnLog() });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  vocabulary smoke");
    expect(result.stdout).toContain(
      "vocabulary hole(s) — the mutation-example sweep would refuse before its first strike; it was not run",
    );
    expect(result.stdout).toContain('VOCABULARY HOLE  unspoken — "orphan"');
    expect(readFileSync(spawnLog(), "utf8").split("\n").filter((line) => line !== "")).toEqual([
      "--vocabulary",
    ]);
  });

  it("treats the hole lists as authoritative even when the payload claims pass", () => {
    // A payload that lists holes and gates itself `pass` is a contract bug in the sweep — and
    // the safe reading of a contract bug is the red one: the holes are what the reader can act
    // on, so they are what the stage fails on.
    const stub = writeStub(
      "sweep-vocab-lying.mjs",
      vocabularyPayload(`{`, `  mode: 'vocabulary', root: process.cwd(),`, `  unnamed: [], unspoken: ['orphan'],`, `  gate: 'pass', exitCode: 0,`, `}`),
    );

    const result = runMutationStageEnv(stub, {});

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VOCABULARY HOLE");
    expect(result.stdout).toContain('unspoken — "orphan"');
  });

  it("opts exactly the five vocabulary-first stages into the pre-pass, before the sweep spawn", () => {
    // Source-level, because the wiring is what the runtime cases above prove once: the flag is
    // a stage-by-stage choice, and a stage that is not tree-editing has a script with no
    // `--vocabulary` mode at all — a pre-pass there could only ever pass through, and if it
    // could not, its negative would be a silence this case turns into a red.
    for (const stageName of ["mutation-example", "mutation-fifth", "mutation-coverage", "mutation-preflight", "mutation"]) {
      const begin = ciSource.indexOf(`runJsonGate({\n        name: "${stageName}",`);
      expect(begin, `no runJsonGate declaration found for ${stageName}`).toBeGreaterThan(-1);
      const declaration = ciSource.slice(begin, ciSource.indexOf("}),", begin));
      expect(declaration, `${stageName} is not opted into the vocabulary pre-pass`).toContain(
        "vocabularyFirst: true",
      );
    }
    // And no fifth gate is: exactly the five vocabulary-first stages carry the flag, so a
    // flag copied onto a stage that does not edit the tree or speak the vocabulary reds here
    // rather than spawning `--vocabulary` against a tool that has no such mode.
    expect(ciSource.split("vocabularyFirst: true").length - 1).toBe(5);
    // The pre-pass is sequenced inside runJsonGate before the run spawn: the hole is read and
    // answered before `--json` is ever forwarded.
    const funnel = ciSource.slice(ciSource.indexOf("function runJsonGate"));
    expect(funnel.indexOf("--vocabulary")).toBeGreaterThan(-1);
    expect(funnel.indexOf("--vocabulary")).toBeLessThan(
      funnel.indexOf('spawnSync(process.execPath, [gate.script, "--json"'),
    );
  });
});

/**
 * The fourth sweep's vocabulary holes: the fail-side cases the grown-up sweeps' suites carry,
 * pointed at the demonstration sweep through a copy.
 *
 * The stage-vocabulary describe above holds the clean inheritance — the sweep speaks the table
 * it imports. These hold what happens when the two sides disagree, and they do it the way the
 * preflight and coverage suites do: over a byte-identical copy of the sweep spliced with the
 * break, so no real file is loosened and the demonstration sweep — which takes no lock and
 * runs no mutation — is safe to drive directly. The refusal is the module's `vocabularyHoles`
 * answering through the sweep's own stamps, so a hole must be created in a *stamp*, not in
 * the table: the table is the module's, shared with three real sweeps, and breaking it there
 * would refuse trees nothing broke.
 */
describe("the fourth sweep's vocabulary holes", () => {
  const examplePath = path.join(projectRoot, ".freebuff", "mutation-example.mjs");
  const exampleSource = readFileSync(examplePath, "utf8");

  /** Runs a spliced copy of the fourth sweep over the real tree, cleaning the copy up after. */
  function runExample(source: string, args: string[]) {
    const copy = path.join(projectRoot, ".freebuff", "mutation-example.copy-for-test.mjs");
    writeFileSync(copy, source, "utf8");
    try {
      return spawnSync(process.execPath, [copy, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
      });
    } finally {
      rmSync(copy, { force: true });
    }
  }

  /** The one-stamp swap that opens both holes at once: the stamp left, the word orphaned. */
  const spliced = exampleSource.replace(
    '    ? { kind: "survived", detail: "the demonstration run answered" }',
    '    ? { kind: "answered", detail: "the demonstration run answered" }',
  );

  it("runs clean when the stamps and the declared words agree", () => {
    // The splice must occur exactly once in the pristine source, so the refusal cases below
    // test one break rather than a rewrite.
    expect(exampleSource.split('    ? { kind: "survived", detail:').length - 1).toBe(1);
    expect(spliced).not.toBe(exampleSource);

    const result = runExample(exampleSource, []);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("demonstration run survived");
    expect(result.stderr ?? "").not.toContain("START-UP REFUSAL");
  });

  it("refuses a stamp no declared word covers and a word nothing stamps, in one pass", () => {
    const result = runExample(spliced, []);

    expect(result.status).toBe(1);
    // Both directions named together — the sweep cannot begin, and the reader gets the whole
    // disagreement in one report rather than fixing one hole to find the next.
    expect(result.stderr).toContain("START-UP REFUSAL (2)");
    expect(result.stderr).toContain('it stamps kind "answered", which SURVIVOR_WORDS does not declare');
    expect(result.stderr).toContain('SURVIVOR_WORDS declares it, and no survivor can ever carry it: "survived"');
  });

  it("publishes the refusal as the refusal-shaped payload under --json", () => {
    const result = runExample(spliced, ["--json"]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}") as {
      gate: string;
      exitCode: number;
      checked: number;
      survivors: { path: string; kind: string; detail: string }[];
    };
    // The shape a consumer of any sweep's refusal already reads: fail, nothing checked, and
    // each hole a `broken` survivor carrying the sentence the log prints.
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toHaveLength(2);
    for (const survivor of payload.survivors) {
      expect(survivor.kind).toBe("broken");
      expect(survivor.detail).toContain("SURVIVOR_WORDS");
    }
    expect(payload.survivors.some((s) => s.detail.includes('kind "answered"'))).toBe(true);
  });

  it("reads the hole in the --vocabulary --json table, bucket and list alike", () => {
    const result = runExample(spliced, ["--vocabulary", "--json"]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}") as {
      mode: string;
      gate: string;
      exitCode: number;
      words: { word: string; stamps: unknown[] }[];
      unnamed: string[];
      unspoken: string[];
    };
    expect(payload.mode).toBe("vocabulary");
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    // The empty bucket is readable as a bucket: `survived` is still listed, with nothing
    // under it, beside the stamp the sweep now carries that no word covers.
    expect(payload.words.find((word) => word.word === "survived")?.stamps).toHaveLength(0);
    expect(payload.words.find((word) => word.word === "broken")?.stamps).toHaveLength(1);
    expect(payload.unnamed).toEqual(["answered"]);
    expect(payload.unspoken).toEqual(["survived"]);
  });
});

/**
 * The three `--vocabulary` modes against each other, payload for payload.
 *
 * Each sweep's own suite holds its mode's shape and its human report, and the stage-vocabulary
 * describe above holds the three stage maps to the sweeps' declared tables. What nothing holds
 * yet is the contract *between* the three modes: every sweep now answers the same question — is
 * the vocabulary it declares the vocabulary it stamps? — under the same mode name, and a
 * consumer reading the three payloads together can only rely on that if the fields they share
 * are held equal and the fields they differ on are the differences each sweep's design names,
 * not accidents of whichever sweep was written last.
 *
 * So one case spawns all three `--vocabulary --json` and compares the payloads field for field:
 * the shared envelope — `mode`, `root`, the `gate`/`exitCode` pair, the two hole lists — must be
 * the same fields with the same clean-table values on all three; the two survivor sweeps' word
 * buckets must be structurally one shape, a word with its mark, its why, and the stamped sites
 * (file/line/text) the bucket reads; and the guard sweep's differences are held as its own named
 * claims — strike `families` in place of survivor `words`, strikes that carry path and name in
 * place of stamped sites, no `file` because its families are read from the sweep whole, and hole
 * entries that would be strikes because its stamps are readable off the entries. The fail side
 * of those shapes — a hole in any of the three — is each suite's own vocabulary-hole case; this
 * case holds what the clean tables share, because that is the part a cross-sweep consumer reads
 * without knowing which sweep answered.
 *
 * The spawns point at an isolated lock like every suite's vocabulary case: the modes are
 * report-only and take no lock, so the path is only ever a name the sweep would use — and if a
 * mode ever began taking one, this case would collide with a concurrent session's sweep rather
 * than silently pass.
 */
describe("the three sweeps' --vocabulary payloads against each other", () => {
  const preflightSweep = path.join(projectRoot, ".freebuff", "mutation-preflight.mjs");
  const lock = path.join(projectRoot, ".freebuff", "mutation-vocab-shape-lock.json");

  type VocabularyPayload = {
    root: string;
    mode: string;
    file?: string;
    families?: { kind: string; declared: boolean; count: number; strikes: { path: string; name: string }[] }[];
    words?: { word: string; mark: string; why: string; stamps: { file: string; line: number; word: string; text: string }[] }[];
    unnamed: unknown[];
    unspoken: string[];
    gate: string;
    exitCode: number;
  };

  function runVocabularyJson(script: string): { status: number | null; payload: VocabularyPayload } {
    const result = spawnSync(process.execPath, [script, "--vocabulary", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: lock },
    });
    return {
      status: result.status,
      payload: JSON.parse(result.stdout ?? "{}") as VocabularyPayload,
    };
  }

  /** Every field a payload carries, sorted — the envelope a consumer reads blind. */
  const envelope = (payload: VocabularyPayload, ...drop: string[]): string[] =>
    Object.keys(payload)
      .filter((field) => !drop.includes(field))
      .sort();

  /** `field:type` for every key, sorted — a shape comparison that still catches a type change. */
  const typedKeys = (value: Record<string, unknown>): string[] =>
    Object.keys(value)
      .sort()
      .map((key) => `${key}:${typeof value[key]}`);

  it(
    "compares the three --vocabulary payloads field for field: one shared envelope, each mode's own buckets",
    () => {
      rmSync(lock, { force: true });
      try {
        const [guards, preflight, coverage] = [
          runVocabularyJson(sweep),
          runVocabularyJson(preflightSweep),
          runVocabularyJson(coverageLauncher),
        ];

        // A mode that stopped answering cleanly is the per-sweep suites' business — a hole here
        // would make the comparison below compare a refusal to a clean table — so the clean
        // answer is itself the first shared field: the status, the gate, the exitCode the
        // payload carries beside it, and the mode name all three answer under.
        for (const [name, run] of [
          ["mutation-guards", guards],
          ["mutation-preflight", preflight],
          ["mutation-coverage", coverage],
        ] as const) {
          expect(run.status, `${name} --vocabulary did not answer cleanly`).toBe(0);
          expect(run.payload.gate, `${name} did not gate its clean table pass`).toBe("pass");
          expect(run.payload.exitCode, `${name} gates pass but its payload does not answer 0`).toBe(0);
          expect(run.payload.mode, `${name} does not name the mode "vocabulary"`).toBe("vocabulary");
        }

        // The same tree on all three: `root` is the checkout the sweep answers for, computed
        // the same way in each script, so a consumer can hand one payload's root to another
        // sweep's tooling. Equality, not a literal — the checkout may live anywhere.
        expect(preflight.payload.root, "the survivor sweep's root disagrees with the guard sweep's").toBe(
          guards.payload.root,
        );
        expect(coverage.payload.root, "the coverage launcher's root disagrees with the guard sweep's").toBe(
          guards.payload.root,
        );

        // The envelope, field for field: the two survivor sweeps carry exactly the same fields,
        // and the guard sweep's is the same minus its two deliberate differences — no `file`,
        // and `families` where the survivor sweeps carry `words`. A field added to one payload
        // and not the others reds here rather than only in the consumer that reads it.
        expect(envelope(coverage.payload), "the coverage payload's fields").toEqual(envelope(preflight.payload));
        expect(envelope(guards.payload, "families", "file")).toEqual(envelope(preflight.payload, "words", "file"));

        // The differences themselves, named on the guards side: strike families, not survivor
        // words — a kind with its declared flag and the exact strikes that stamp it, each
        // strike carrying the path and name the sweep would report it under. Their fail-side
        // shapes are the sweep-recovery suite's hole cases; here the clean table's shape is the
        // hold.
        expect(guards.payload, "the guard sweep carries a `file` its families never read").not.toHaveProperty("file");
        const guardsFamilies = guards.payload.families ?? [];
        expect(guardsFamilies.length, "the guard sweep listed no families").toBeGreaterThan(0);
        for (const family of guardsFamilies) {
          expect(typedKeys(family), `the family "${family.kind}" is not kind/declared/count/strikes`).toEqual([
            "count:number",
            "declared:boolean",
            "kind:string",
            "strikes:object",
          ]);
          expect(family.strikes, `the family "${family.kind}" counts strikes it does not list`).toHaveLength(
            family.count,
          );
          for (const strike of family.strikes) {
            expect(typedKeys(strike), `a strike under "${family.kind}" is not path/name`).toEqual([
              "name:string",
              "path:string",
            ]);
          }
        }

        // The other half of the guards' no-`file` difference: the survivor sweeps name the file
        // their table is read against — their own source.
        expect(preflight.payload.file, "the preflight table names no file").toBe(".freebuff/mutation-preflight.mjs");
        expect(coverage.payload.file, "the coverage table names no file").toBe(".freebuff/mutation-coverage.mjs");

        // The two survivor sweeps' word buckets are one shape, field for field: a word with its
        // mark and its why, beside the stamped sites the bucket reads. The marks and whys
        // themselves are each sweep's coin — held by their own suites and the stage-vocabulary
        // describe above — because one repair must not read as another's; here the *shape* is
        // the hold, because a consumer rendering both tables side by side cannot afford one of
        // them missing a column.
        for (const payload of [preflight.payload, coverage.payload]) {
          const buckets = payload.words ?? [];
          expect(buckets.length, "a survivor sweep listed no word buckets").toBeGreaterThan(0);
          for (const bucket of buckets) {
            expect(typedKeys(bucket), `the bucket "${bucket.word}" is not word/mark/why/stamps`).toEqual([
              "mark:string",
              "stamps:object",
              "why:string",
              "word:string",
            ]);
            expect(bucket.stamps.length, `no stamp listed for "${bucket.word}"`).toBeGreaterThan(0);
            for (const stamp of bucket.stamps) {
              expect(typedKeys(stamp), `a stamp under "${bucket.word}" is not file/line/word/text`).toEqual([
                "file:string",
                "line:number",
                "text:string",
                "word:string",
              ]);
            }
          }
        }

        // And the clean table's holes are empty on all three — the same two lists, whatever
        // shape each sweep's entries would take when they are not.
        for (const [name, payload] of [
          ["mutation-guards", guards.payload],
          ["mutation-preflight", preflight.payload],
          ["mutation-coverage", coverage.payload],
        ] as const) {
          expect(payload.unnamed, `${name} names unnamed stamps on a clean table`).toEqual([]);
          expect(payload.unspoken, `${name} names unspoken words on a clean table`).toEqual([]);
        }
      } finally {
        rmSync(lock, { force: true });
      }
    },
  );
});

/**
 * The sweep's own arithmetic: every count it prints or stamps must be the length of the table
 * it names.
 *
 * A family's size reaches a reader twice — the header line a plain run prints, and the counts
 * the `--json` payload carries — and both are written as `<TABLE>.length` in the sweep's own
 * source. Nothing else holds either number to the list behind it: the vocabulary case above
 * checks that a count *field* exists for every family, never that its value is that family's
 * length, so a count edited to a literal — or pointed at a sibling's table — reads plausibly
 * while the table grows past it, which is the silent drift this holds.
 *
 * Both surfaces are read from the real script rather than restated, which is what makes the
 * comparison a hold and not a copy:
 *
 *   - each table's length is `--anchors`, which enumerates every self-mutation with the family
 *     `strikeKind` gives it, one row to a strike — the rows counted by kind *are* the family
 *     lengths, so a number is held against the list rather than against a second copy of it;
 *   - the header is the line a plain `--list` run prints — the header is emitted before
 *     `--list` exits, so nothing is struck;
 *   - the payload is the object the refusal writes before its first strike, read over a
 *     scratch strike root with one anchor rotted (`MUTATION_STRIKE_ROOT`). Its counts come
 *     from the same `jsonPayload` a full run uses, so the values are the full run's without a
 *     strike — the only cheap way to read the counts rather than just the field names, since
 *     the `--file` that makes a probe cheap is exactly what zeroes the tables being counted.
 */
describe("the sweep's strike counts", () => {
  /** The five files the self-mutation families rewrite, relative to the project root. */
  const STRIKE_TARGETS = [
    "src/test/expect-gated.ts",
    "src/test/convention-guards.ts",
    ".freebuff/ci.mjs",
    ".freebuff/mutation-lock.mjs",
    "src/test/declared-strikes.ts",
  ];

  /** An anchor the refusal reads, renamed so the sweep stops before its first strike. */
  const ROTTED = {
    find: "function absorbedStretch(entry, content) {",
    replace: "function absorbedStretchRenamed(entry, content) {",
  };

  /** A scratch copy of the five targets with `ROTTED` applied, for the refusal to read. */
  function rottedStrikeRoot(): string {
    const root = mkdtempSync(path.join(stubDir, "strike-counts-"));
    for (const rel of STRIKE_TARGETS) {
      const dest = path.join(root, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(path.join(projectRoot, rel), "utf8"));
    }
    const lock = path.join(root, ".freebuff", "mutation-lock.mjs");
    writeFileSync(lock, readFileSync(lock, "utf8").replace(ROTTED.find, ROTTED.replace));
    return root;
  }

  /**
   * Each family's length, read from the sweep itself: `--anchors` reports one row per
   * self-mutation, so counting its rows by `kind` is counting the table behind each family.
   */
  function familyLengths(): Record<string, number> {
    const probe = spawnSync(process.execPath, [sweep, "--anchors", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: path.join(stubDir, "lock-counts.json") },
    });
    const payload = JSON.parse(probe.stdout) as { strikes: { kind: string }[] };
    const lengths: Record<string, number> = {};
    for (const row of payload.strikes) lengths[row.kind] = (lengths[row.kind] ?? 0) + 1;
    return lengths;
  }

  /** The sweep's `--list` header line, or a failure if it printed none. */
  function headerLine(): string {
    const stdout = spawnSync(process.execPath, [sweep, "--list"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: path.join(stubDir, "lock-counts.json") },
    }).stdout;
    const line = stdout.split("\n").find((candidate) => candidate.includes("self-mutations:"));
    expect(line, "the sweep printed no self-mutations header line").toBeDefined();
    return line as string;
  }

  /**
   * The header's own words for each family, and the anchor kinds each clause counts. The
   * whole detector and its limbs are two `kind`s but one clause — exactly the split the
   * payload makes the other way, `conventionSelfMutations` + `limbSelfMutations`.
   */
  const HEADER_FAMILIES: { label: string; kinds: string[] }[] = [
    { label: "test helper", kinds: ["self"] },
    { label: "convention detector", kinds: ["convention", "limb"] },
    { label: "runner check", kinds: ["runner"] },
    { label: "shared-lock check", kinds: ["lock"] },
    { label: "declared-table ratchet", kinds: ["ratchet"] },
  ];

  it("sizes each family from the table it names in the header line", () => {
    const lengths = familyLengths();
    // A parse that found nothing would make every comparison below vacuous.
    expect(Object.keys(lengths).length).toBeGreaterThan(0);
    // Every family `--anchors` can stamp is one the header names, so a family added to the
    // sweep turns up here rather than slipping past clauses written against the old list.
    expect([...HEADER_FAMILIES.flatMap((family) => family.kinds)].sort()).toEqual(
      Object.keys(lengths).sort(),
    );

    const header = headerLine();
    const total = Number(header.match(/self-mutations: (\d+)/)?.[1]);

    // Each clause is the length of the table(s) it names, not of a neighbour's: a count
    // pointed at the wrong family, or given a literal, shows up as this mismatch.
    let named = 0;
    for (const { label, kinds } of HEADER_FAMILIES) {
      const shown = Number(header.match(new RegExp(`(\\d+) ${label}(?=[,;)])`))?.[1]);
      const expected = kinds.reduce((sum, kind) => sum + (lengths[kind] ?? 0), 0);
      expect(shown, `the header's "${label}" count`).toBe(expected);
      named += shown;
    }
    // The parenthetical covers the whole total: a family added to the run but left out of the
    // line would leave a total larger than the clauses that explain it.
    expect(named).toBe(total);
    // …and the total is the run's own list, not a number kept beside it.
    expect(total).toBe(Object.values(lengths).reduce((sum, length) => sum + length, 0));

    // The detector's two depths, split the other way: `--anchors` separates a whole detector
    // from a limb, and the header's sub-clause is the limb half of that count.
    const limbs = Number(header.match(/(\d+) of the detector strikes narrow one limb/)?.[1]);
    expect(limbs).toBe(lengths.limb ?? 0);
  });

  it("sizes each family from the table it names in the --json payload", () => {
    const lengths = familyLengths();

    const result = spawnSync(process.execPath, [sweep, "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: path.join(stubDir, "lock-counts.json"),
        MUTATION_STRIKE_ROOT: rottedStrikeRoot(),
      },
    });
    // The refusal is the seam: it writes the payload and stops before the first strike.
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as { checked: number } & Record<string, number>;
    // Nothing was struck, so these are the counts a full run carries and not a struck
    // tree's outcome.
    expect(payload.checked).toBe(0);

    // Every family's count is the length of the table its own field names. Driven from the
    // families the sweep reports, so a family added there is held here without an edit.
    for (const kind of Object.keys(lengths)) {
      const field = selfMutationCountField(kind);
      expect(payload[field], `the payload's ${field}`).toBe(lengths[kind]);
    }
  });
});

describe("the CI runner's coverage-gate mutation stage", () => {
  it("reports a clean run and exits 0 for a passing payload", () => {
    const stub = writeStub(
      "mc-pass.mjs",
      [
        "if (!process.argv.includes('--json')) {",
        "  process.stderr.write('stub: --json was not forwarded\\n');",
        "  process.exit(3);",
        "}",
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'pass',",
        "  exitCode: 0,",
        "  checked: 5,",
        "  files: 1,",
        "  survivors: [],",
        "}) + '\\n');",
        "process.exit(0);",
      ].join("\n"),
    );

    const result = runMutationCoverageStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  coverage gate mutation");
    expect(result.stdout).toContain("5 coverage gate(s) checked, no survivors");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  it("separates a gate that stopped being load-bearing from a check that could not answer", () => {
    const stub = writeStub(
      "mc-fail.mjs",
      [
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  gate: 'fail',",
        "  exitCode: 1,",
        "  checked: 5,",
        "  files: 1,",
        "  survivors: [",
        "    { path: 'src/test/coverage-mutation.test.ts', line: null, kind: 'survived', descriptor: 'fails the floor test when the floor is weakened', detail: '... still passed, so the mutation survived.' },",
        "    { path: 'src/test/coverage-mutation.test.ts', line: null, kind: 'broken', descriptor: 'fails the scopes test when the matcher is unanchored', detail: 'the case did not run' },",
        "  ],",
        "}) + '\\n');",
        "process.exit(1);",
      ].join("\n"),
    );

    const result = runMutationCoverageStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  coverage gate mutation");
    expect(result.stdout).toContain("5 checked, 2 survivor(s)");
    // The two failures are not the same failure, so they do not carry the same
    // mark: one gate stopped being load-bearing, the other was never checked.
    expect(result.stdout).toContain("SURVIVED WEAKENING  src/test/coverage-mutation.test.ts");
    expect(result.stdout).toContain("CHECK BROKEN  src/test/coverage-mutation.test.ts");
    // The case's name and the reason it gave both reach the log, and a survivor
    // with no line is named by path alone.
    expect(result.stdout).toContain("fails the floor test when the floor is weakened");
    expect(result.stdout).toContain("still passed, so the mutation survived");
    expect(result.stdout).not.toContain(":null");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: mutation-coverage");
  });

  it("reports a lock it recovered, and one it would not touch, as warnings on a pass", () => {
    const stub = writeStub("mc-recovered.mjs", RECOVERED_COVERAGE);

    const result = runMutationCoverageStage(stub);

    expect(result.status).toBe(0);
    // Both halves of the recovery are in the summary line, because they ask different
    // things of a reader: one says the run healed itself, the other says a file is not
    // what the lock says it should be.
    expect(result.stdout).toContain(
      "PASS  coverage gate mutation — 5 coverage gate(s) checked, no survivors " +
        "— 1 recovered lock, 1 lock left for a human",
    );
    expect(result.stdout).toContain("WARN RECOVERED  .freebuff/coverage-floor.mjs");
    expect(result.stdout).toContain("WARN LOCK LEFT  .freebuff/coverage-scopes.mjs");
    expect(result.stderr).not.toContain("failed");
  });

  it("fails the job when the gate writes no JSON at all", () => {
    const stub = writeStub(
      "mc-crash.mjs",
      [
        "process.stderr.write('stub launcher: exploded before writing JSON\\n');",
        "process.exit(3);",
      ].join("\n"),
    );

    const result = runMutationCoverageStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("produced no JSON — the gate may have crashed");
    expect(result.stdout).toContain("stub launcher: exploded before writing JSON");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: mutation-coverage");
  });
});

describe("the CI runner's preflight mutation sweep stage", () => {
  it("reports a clean sweep and exits 0 for a passing payload", () => {
    const stub = writeStub(
      "mp-pass.mjs",
      [
        "if (!process.argv.includes('--json')) {",
        "  process.stderr.write('stub: --json was not forwarded\\n');",
        "  process.exit(3);",
        "}",
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(),",
        "  target: '.freebuff/preview-preflight.mjs',",
        "  test: 'src/test/preview-preflight.test.ts',",
        "  gate: 'pass',",
        "  exitCode: 0,",
        "  checked: 19,",
        "  caught: [],",
        "  survivors: [],",
        "}) + '\\n');",
        "process.exit(0);",
      ].join("\n"),
    );

    const result = runMutationPreflightStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  preflight mutation sweep");
    expect(result.stdout).toContain("19 preflight mutation(s) checked, no survivors");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  it("separates a branch the suite stopped noticing from a check that could not answer", () => {
    const stub = writeStub("mp-fail.mjs", FAILING_MUTATION_PREFLIGHT);

    const result = runMutationPreflightStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  preflight mutation sweep");
    expect(result.stdout).toContain("19 checked, 2 survivor(s)");
    // The two failures ask for different repairs — a branch nobody notices any more is a
    // test to add, an anchor that no longer fits is a table to re-fit — so they carry
    // different marks rather than one word for both.
    expect(result.stdout).toContain("SURVIVED MUTATION  .freebuff/preview-preflight.mjs  health/wedged");
    expect(result.stdout).toContain("CHECK BROKEN  .freebuff/preview-preflight.mjs  tab/gone");
    expect(result.stdout).toContain(
      "a live lock pid that answers nothing on its port is not reported as wedged",
    );
    expect(result.stdout).toContain("its anchor occurs 0 time(s), expected exactly 1");
    // A survivor with no line is named by its id alone — this sweep's mutations are
    // branches in one file, so the id is what distinguishes them, not a line number.
    expect(result.stdout).not.toContain(":null");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: mutation-preflight");
  });

  it("forwards --limit to this sweep, and not the flags only the route sweep reads", () => {
    const stub = writeStub(
      "mp-limit.mjs",
      [
        "if (!process.argv.includes('--json')) process.exit(3);",
        "if (!process.argv.includes('--limit=2')) {",
        "  process.stderr.write('stub: --limit was not forwarded\\n');",
        "  process.exit(3);",
        "}",
        // `--file` filters the route table and `--no-fail-open` suppresses a pass this
        // sweep does not make, so neither belongs on this command line: a slice asked
        // for by count must not bring another stage's flags with it.
        "if (process.argv.some((a) => a.startsWith('--file=')) || process.argv.includes('--no-fail-open')) {",
        "  process.stderr.write('stub: a flag of the route sweep was forwarded\\n');",
        "  process.exit(3);",
        "}",
        "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 2, survivors: [] }) + '\\n');",
      ].join("\n"),
    );

    const result = runMutationPreflightStage(stub, ["--limit=2", "--file=admin", "--no-fail-open"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 preflight mutation(s) checked, no survivors");
  });

  it("reports a lock it recovered as a warning on a stage that still passes", () => {
    const stub = writeStub(
      "mp-recovered.mjs",
      [
        "if (!process.argv.includes('--json')) process.exit(3);",
        "process.stdout.write(JSON.stringify({",
        "  root: process.cwd(), gate: 'pass', exitCode: 0, checked: 19, survivors: [],",
        "  recovered: [{",
        "    action: 'restored',",
        "    path: '.freebuff/preview-preflight.mjs',",
        "    check: 'preflight sweep',",
        "    kind: 'mutation',",
        "    where: 'health/wedged',",
        "    message: 'RESTORED .freebuff/preview-preflight.mjs from an interrupted preflight sweep (mutation: health/wedged).',",
        "  }],",
        "}) + '\\n');",
      ].join("\n"),
    );

    const result = runMutationPreflightStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  preflight mutation sweep — 19 preflight mutation(s) checked, no survivors " +
        "— 1 recovered lock",
    );
    expect(result.stdout).toContain("WARN RECOVERED  .freebuff/preview-preflight.mjs");
    expect(result.stderr).not.toContain("failed");
  });

  it("renders the stage and its two marks on the run page the nightly job publishes", () => {
    const stub = writeStub("mp-page.mjs", FAILING_MUTATION_PREFLIGHT);

    // The payload the runner itself emits on a failing run, pushed through the real
    // renderer the nightly job uses, so the page's row and its marks are the runner's
    // own rather than a fixture kept in step by hand — a stage the page dropped or a
    // mark it renamed reads here as a disagreement.
    const payload = JSON.parse(runMutationPreflightStage(stub, ["--json"]).stdout);
    const summary = renderReport(payload);

    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain(
      "| preflight mutation sweep | ❌ fail | 19 checked, 2 survivor(s) |",
    );
    expect(summary.stdout).toContain(
      "- **SURVIVED MUTATION** `.freebuff/preview-preflight.mjs  health/wedged` — " +
        "a live lock pid that answers nothing on its port is not reported as wedged",
    );
    expect(summary.stdout).toContain(
      "- **CHECK BROKEN** `.freebuff/preview-preflight.mjs  tab/gone` — " +
        "a tab that is gone is reported as gone — its anchor occurs 0 time(s), expected exactly 1",
    );
    // Two real processes: the runner and the renderer.
  }, 20_000);
});

describe("the CI runner's drift stage", () => {
  it("passes a check that finds nothing, and says what it compared", () => {
    const stub = writeStub("drift-pass.mjs", PASSING_DRIFT);
    const result = runDriftStage(stub);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  gate drift");
    expect(result.stdout).toContain("7 gate file(s) pinned, all match");
  });

  it("reports a changed script and an unpinned one, and fails the stage", () => {
    const stub = writeStub("drift-fail.mjs", FAILING_DRIFT);
    const result = runDriftStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  gate drift");
    expect(result.stdout).toContain("2 gate file(s) no longer match the pin");
    // Both findings sit in one watch family, so the count is followed by the family that moved:
    // the rule to re-check, which a list of paths does not say.
    expect(result.stdout).toContain(
      "2 gate file(s) no longer match the pin — 1 watch family moved: " +
        ".freebuff/^coverage-.*\\.mjs$ (2)",
    );
    // …and the rows fold under a heading naming that family, counted the way the summary counts
    // it, so the two files read as one family rather than two unrelated rows.
    expect(result.stdout).toContain("      FAMILY  .freebuff/^coverage-");
    expect(result.stdout).toContain("CHANGED  .freebuff/coverage-floor.mjs");
    expect(result.stdout).toContain("on disk 11111111, pinned 22222222");
    expect(result.stdout).toContain("UNPINNED  .freebuff/coverage-perfile.mjs");
    expect(result.stdout).toContain("npm run gates:pin");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: drift");
  });

  it("carries the alarm's refusal into the summary, so a job reads why a re-pin is not the whole repair", () => {
    // The alarm refuses when a moved family is behind no stage's key: re-pinning records the new hash
    // and leaves the family measured by nothing, so the raw line's advice is incomplete for exactly
    // those families. The summary is the one string the log, the `--json` report, the run page and
    // the nightly comment all carry, and the sentence is the alarm's own rather than a paraphrase
    // cut here — the two surfaces cannot say two different things about which families nothing
    // measures.
    const stub = writeStub("drift-refused.mjs", REFUSED_DRIFT);
    const result = runDriftStage(stub);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  gate drift");
    expect(result.stdout).toContain(`no longer match the pin — 1 watch family moved: .github/workflows/^.*\\.ya?ml$ (1). ${REFUSAL_SENTENCE}`);
    // The findings are untouched: the refusal qualifies the repair, it does not replace the report.
    expect(result.stdout).toContain("CHANGED  .github/workflows/nightly.yml");

    const payload = JSON.parse(runDriftStage(stub, ["--json"]).stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    expect(drift.summary).toContain(REFUSAL_SENTENCE);
    expect(drift.pass).toBe(false);
  });

  it("leads a red run with the families nothing below measures, then folds every file under its family", () => {
    const stub = writeStub("drift-families.mjs", MIXED_DRIFT);
    const result = runDriftStage(stub);

    // The families lead by *exposure*, not by volume: `.github/workflows/…` moved once and
    // `.freebuff/^coverage-…` twice, yet the workflows family leads because no stage but the pin's
    // own re-key holds it whole while a stage measures the coverage one. The order is read off the
    // same `--status` `families` view the runner orders by, so it cannot pass against a hardcoded
    // string — and the two shapes this test is about are stated rather than assumed, because a tree
    // without them would leave the assertion below vacuous.
    expect(result.status).toBe(1);
    const coverageRule = ".freebuff/^coverage-.*\\.mjs$";
    const workflowsRule = ".github/workflows/^.*\\.ya?ml$";
    const status = JSON.parse(runCi(["--status", "--json"]).stdout) as {
      families: { rule: string; unkeyed: number; exposed: boolean }[];
      coverage: { file: string; rule: string; keys: string[] }[];
    };
    const riskOf = (rule: string) => status.families.find((family) => family.rule === rule);
    expect(riskOf(workflowsRule)?.exposed).toBe(true);
    expect(riskOf(coverageRule)?.exposed).toBe(false);
    expect(result.stdout).toContain(
      `4 gate file(s) no longer match the pin — 2 watch families moved: ` +
        `${workflowsRule} (1), ${coverageRule} (2), 1 file(s) no watch rule names`,
    );
    // …and the files are still named one row each: the summary says where they came from, the
    // details are where the diffs live, so neither half has to carry the other's job.
    expect(result.stdout).toContain("CHANGED  .github/workflows/nightly.yml");
    expect(result.stdout).toContain("GONE  .freebuff/gate-removed.mjs");
    // The rows fold under a heading per family — the same order, labels and counts as the sentence
    // above — so a whole-tree re-pin reads as a handful of families rather than forty
    // interchangeable paths, and a pinned path no rule names gets its own heading rather than
    // floating between the families. The file rows keep their marks: the fold groups them, it does
    // not hide them.
    const rows = result.stdout.split("\n");
    const rowAt = (needle: string) => rows.findIndex((line) => line.trim().startsWith(needle));
    const workflowsHeading = rowAt("FAMILY  .github/workflows/^");
    const coverageHeading = rowAt("FAMILY  .freebuff/^coverage-");
    const unnamedHeading = rowAt("UNNAMED  1 file(s)");
    expect(workflowsHeading).toBeGreaterThan(-1);
    expect(coverageHeading).toBeGreaterThan(workflowsHeading);
    expect(unnamedHeading).toBeGreaterThan(coverageHeading);
    expect(rowAt("CHANGED  .github/workflows/nightly.yml")).toBeGreaterThan(workflowsHeading);
    expect(rowAt("CHANGED  .github/workflows/nightly.yml")).toBeLessThan(coverageHeading);
    expect(rowAt("UNPINNED  .freebuff/coverage-headroom.mjs")).toBeLessThan(unnamedHeading);
    expect(rowAt("GONE  .freebuff/gate-removed.mjs")).toBeGreaterThan(unnamedHeading);

    // The same sentence in the `--json` report, so a job reads the family off the stage's own
    // summary rather than re-deriving it from the findings.
    const payload = JSON.parse(runDriftStage(stub, ["--json"]).stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    expect(drift.summary).toContain("2 watch families moved");
    // The fold reaches the report a *job* reads, not only the log: the headings are published as
    // their own rows — `heading: true`, no path — in the same order, with the file rows keeping
    // their paths and detail.
    const headings = drift.details.filter(
      (detail: { heading?: boolean }) => detail.heading === true,
    );
    expect(headings.map((detail: { mark: string }) => detail.mark)).toEqual([
      "FAMILY",
      "FAMILY",
      "UNNAMED",
    ]);
    expect(headings.every((detail: { name?: string }) => detail.name === undefined)).toBe(true);
    // Each heading carries the repair beside the grouping. The leading family — nothing below
    // measures it — is told to be named in a stage's `inputs`; the precondition that nothing but
    // the pin's own re-key names the workflows is stated, so the assertion is about the family it
    // claims to be. The measured family names the stage that holds it whole, and that stage is
    // checked against the pin's own rows rather than hardcoded, so the clause can never name a
    // stage that does not hold what it says it holds.
    expect(
      status.coverage
        .filter((row) => row.rule === workflowsRule)
        .every((row) => row.keys.every((name) => name === "drift")),
    ).toBe(true);
    expect(headings[0].detail).toBe(
      workflowsRule + " (1) — no stage keys it; name it in a stage's `inputs`",
    );
    const holder = / — held by the ([\w-]+) stage$/.exec(
      headings[1].detail.slice(`${coverageRule} (2)`.length),
    );
    expect(holder).not.toBeNull();
    expect(
      status.coverage
        .filter((row) => row.rule === coverageRule)
        .every((row) => row.keys.includes(holder![1])),
    ).toBe(true);
    expect(headings[2].detail).toBe("1 file(s) no watch rule names");
    const nightly = drift.details.find(
      (detail: { name?: string }) => detail.name === ".github/workflows/nightly.yml",
    );
    expect(nightly.detail).toBe("on disk 33333333, pinned 44444444");
    // One annotation per file, and none for a heading: a heading names no file, so annotating one
    // would put a fileless error in the run's annotations for every family.
    expect(payload.annotations.map((annotation: { file: string }) => annotation.file)).toEqual([
      ".github/workflows/nightly.yml",
      ".freebuff/coverage-floor.mjs",
      ".freebuff/coverage-headroom.mjs",
      ".freebuff/gate-removed.mjs",
    ]);
    // And the run page folds them the same way, the headings leading their members.
    const page = renderReport(payload);
    expect(page.status).toBe(0);
    expect(page.stdout).toContain(`- **FAMILY** — ${headings[0].detail}`);
    expect(page.stdout).toContain(`- **FAMILY** — ${headings[1].detail}`);
    expect(page.stdout).toContain("- **UNNAMED** — 1 file(s) no watch rule names");
    expect(page.stdout.indexOf("- **FAMILY** — .github/workflows/^")).toBeLessThan(
      page.stdout.indexOf("- **CHANGED** `.github/workflows/nightly.yml`"),
    );
    expect(page.stdout.indexOf("- **CHANGED** `.github/workflows/nightly.yml`")).toBeLessThan(
      page.stdout.indexOf("- **FAMILY** — .freebuff/^coverage-"),
    );
  });

  it("prints the loosening itself under the finding that names the file", () => {
    const stub = writeStub("drift-diff.mjs", FAILING_DRIFT);
    const result = runDriftStage(stub);

    expect(result.status).toBe(1);
    // The `-`/`+` lines sit one indent step past the finding they explain, so the
    // reader sees *what moved* without resolving a hash, and folded into the `--json`
    // report so a machine reading the run gets the same evidence.
    expect(result.stdout).toContain("            --- pinned  .freebuff/coverage-floor.mjs");
    expect(result.stdout).toContain("            -    if (pct < threshold) {");
    expect(result.stdout).toContain("            +    if (pct <= threshold) {");

    const payload = JSON.parse(runDriftStage(stub, ["--json"]).stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    const changed = drift.details.find(
      (detail: { name: string }) => detail.name === ".freebuff/coverage-floor.mjs",
    );
    expect(changed.diff).toContain("-    if (pct < threshold) {");
    expect(changed.diff).toContain("+    if (pct <= threshold) {");
    // An unpinned file has no pinned text to diff against, so it carries no diff.
    const unpinned = drift.details.find(
      (detail: { name: string }) => detail.name === ".freebuff/coverage-perfile.mjs",
    );
    expect(unpinned.diff).toBeUndefined();
  });

  it("carries a degraded diff cache and its cause as a warning on a stage that passed", () => {
    const stub = writeStub("drift-stash-lost.mjs", STASH_LOST_DRIFT);
    const result = runDriftStage(stub);

    // Not a failure — the pin matches — but not a silent pass either: the reading the
    // alarm promises for the next drift is unavailable, and the stage says so…
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  gate drift");
    expect(result.stdout).toContain("7 gate file(s) pinned, all match");
    // …and says *why*, joined into the one string the run page has room for, because
    // "could not be stashed" on its own leaves a reader with nowhere to go.
    expect(result.stdout).toContain(
      "WARN  the matched text could not be stashed — the next drift will show hashes only; " +
        "ENOSPC: no space left on device, write — writing to .ci/gate-content",
    );

    const payload = JSON.parse(runDriftStage(stub, ["--json"]).stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    expect(drift.pass).toBe(true);
    expect(drift.details).toEqual([
      expect.objectContaining({
        mark: "WARN",
        detail: expect.stringContaining(
          "ENOSPC: no space left on device, write — writing to .ci/gate-content",
        ),
      }),
    ]);
    // A warning, not an error: the diff gets told without the build going red for a cache —
    // and the reason reaches the annotation too, which is the only place a reader of the
    // run's own page meets it.
    expect(payload.annotations).toEqual([
      expect.objectContaining({
        level: "warning",
        title: "gate drift",
        message: expect.stringContaining("writing to .ci/gate-content"),
      }),
    ]);

    // And it lands on the run page, which is the whole point of naming it: the nightly
    // summary lists the stage as passed *and* the loss, with its cause, under Warnings.
    const summary = renderReport(payload);
    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain("| gate drift | ✅ pass | 7 gate file(s) pinned, all match |");
    expect(summary.stdout).toContain("1 warning(s) on a stage that passed.");
    expect(summary.stdout).toContain("### Warnings");
    expect(summary.stdout).toContain(
      "- **WARN** (gate drift) — the matched text could not be stashed — the next drift will " +
        "show hashes only; ENOSPC: no space left on device, write — writing to .ci/gate-content",
    );
    expect(summary.stdout).not.toContain("### Failures");
  });

  it("says a stash kept elsewhere is degraded, even though the stash key is there", () => {
    const stub = writeStub("drift-stash-moved.mjs", STASH_MOVED_DRIFT);
    const result = runDriftStage(stub);

    // A green stage: the pin matches, and unlike the total loss this run still has the text
    // for the next diff. Which is exactly why the warning has to be said *anyway* — the
    // convenience is intact but on borrowed time, and a run page that only spoke up when
    // the diff was already gone would report the fallback the first time it failed instead
    // of the first time it was used.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  gate drift");
    expect(result.stdout).toContain("WARN  the matched text could not be stashed in the usual place");
    expect(result.stdout).toContain("EEXIST: file already exists");

    const payload = JSON.parse(runDriftStage(stub, ["--json"]).stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    expect(drift.pass).toBe(true);
    expect(drift.details).toEqual([
      expect.objectContaining({
        mark: "WARN",
        detail: expect.stringContaining("kept at /tmp/gate-content-fixture-1f2e3d4c instead"),
      }),
    ]);
    expect(payload.annotations).toEqual([
      expect.objectContaining({ level: "warning", title: "gate drift" }),
    ]);

    const summary = renderReport(payload);
    expect(summary.stdout).toContain("| gate drift | ✅ pass | 7 gate file(s) pinned, all match |");
    expect(summary.stdout).toContain("1 warning(s) on a stage that passed.");
    expect(summary.stdout).toContain(
      "- **WARN** (gate drift) — the matched text could not be stashed in the usual place",
    );
    expect(summary.stdout).not.toContain("### Failures");
  });

  it("publishes a warning whose payload carries no cause, rather than inventing one", () => {
    const stub = writeStub("drift-stash-lost-bare.mjs", STASH_LOST_WITHOUT_CAUSE);

    const payload = JSON.parse(runDriftStage(stub, ["--json"]).stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");

    // The alarm always sends a cause today; a payload shaped by a gate that did not must not
    // come out as `…; undefined` or lose the warning it *did* send.
    expect(drift.details).toEqual([
      expect.objectContaining({
        mark: "WARN",
        detail: "the matched text could not be stashed — the next drift will show hashes only",
      }),
    ]);
  });

  it("fails a check that could not read the pin, not only one that found drift", () => {
    const stub = writeStub("drift-unreadable.mjs", UNREADABLE_DRIFT);
    const result = runDriftStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  gate drift");
    expect(result.stdout).toContain("the pin could not be applied");
    expect(result.stdout).toContain("npm run gates:pin");
  });

  it("prints the alarm's own family heading, off a scratch pin drifted on purpose", () => {
    // The two surfaces name a family's owner from one declaration, and each is pinned to the table
    // already — this is the case that holds them to *each other*, which is the claim a red run and a
    // red `gates:drift` both make to a reader: the heading the run prints is the alarm's own line, in
    // the alarm's own order, read off the *printed* report on both sides rather than a field beside
    // it. A scratch pin rather than the committed one, because the committed pin cannot be drifted
    // from a test — the files it holds are the tree.
    //
    // The fixture has to survive the run's own coverage refusal, which the alarm has no counterpart
    // of: every file the pin holds *and* still has on disk must be behind a stage's key (a `.mjs` in
    // a throwaway directory is behind the lint stage's whole-tree sweep) or behind `GLOBAL_FORCE`, or
    // the run refuses before the drift stage and there is no fold to compare. So the two shapes here
    // are the two a covered pin can produce — one the sweep holds *whole*, and one the pin no longer
    // holds a member of, whose rule names no stage because there is nothing left to key — beside a
    // pinned path no rule names at all, which closes the report under `UNNAMED`.
    //
    // The rules are the fixture's own and are in no `DEFAULT_WATCHES`: a fold that grouped the paths
    // against the committed rules instead of the pin in force would print three `UNNAMED` rows here,
    // so the equality below is the reading — which rules a family is named by — and not a wording.
    const dir = mkdtempSync(path.join(stubDir, "family-"));
    const swept = path.join(dir, "coverage-alpha.mjs");
    const sibling = path.join(dir, "coverage-beta.mjs");
    const ghost = path.join(dir, "ghost-one.mjs");
    const stray = path.join(dir, "stray.mjs");
    for (const file of [swept, sibling, ghost, stray]) {
      writeFileSync(file, `export const ${path.basename(file, ".mjs")} = 1;\n`, "utf8");
    }
    const fixture = path.join(dir, "gate-hashes.mjs");
    writeFileSync(
      fixture,
      renderManifest({
        algorithm: "sha1",
        watches: [
          { dir, pattern: "^coverage-.*\\.mjs$" },
          { dir, pattern: "^ghost-.*\\.mjs$" },
        ],
        files: {
          [keyOf(swept)]: hashFile(swept),
          [keyOf(ghost)]: hashFile(ghost),
          // Pinned by the manifest and named by no rule: the one path whose family is not a family.
          [keyOf(stray)]: hashFile(stray),
        },
      }),
      "utf8",
    );
    // Then the drift, in every shape the fold groups: one member of the swept family changes, its
    // sibling is left unpinned, the ghost family loses its only member, and the unnamed path is gone.
    writeFileSync(swept, "export const alpha = 9;\n", "utf8");
    rmSync(ghost, { force: true });
    rmSync(stray, { force: true });

    /** The grouped heading lines a report prints: `FAMILY`/`UNNAMED`, under their own indent. */
    const headingsIn = (stdout: string, indent: string): string[] =>
      stdout
        .split("\n")
        .filter(
          (line) => line.startsWith(indent) && /^(FAMILY|UNNAMED)  /.test(line.slice(indent.length)),
        )
        .map((line) => line.slice(indent.length));

    const env = {
      GATE_HASHES_FILE: fixture,
      GATE_CONTENT_DIR: path.join(dir, "stash"),
      GATE_CONTENT_FALLBACK_DIR: path.join(dir, "stash-fallback"),
    };
    const alarmRun = spawnSync(process.execPath, [alarmScript], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    expect(alarmRun.status).toBe(1);
    // The alarm's own report: one heading per family, the rule, the count and the clause — read off
    // the human output, so this is the string a person reads and not a field beside it.
    const sweptRule = `${dir}/^coverage-.*\\.mjs$`;
    const ghostRule = `${dir}/^ghost-.*\\.mjs$`;
    const alarmHeadings = headingsIn(alarmRun.stdout, "  ");
    expect(alarmHeadings).toEqual([
      `FAMILY  ${sweptRule} (2) — held by the lint stage`,
      `FAMILY  ${ghostRule} (1)`,
      "UNNAMED  1 file(s) no watch rule names",
    ]);

    // The run's fold, off the same pin, printed: the heading lines of its human report, and the
    // flagged rows of its `--json` report (the same text, so a machine consumer and a reader are told
    // the same thing).
    const human = runCi(["--only=drift"], env);
    expect(human.status).toBe(1);
    const json = runCi(["--only=drift", "--json"], env);
    const payload = JSON.parse(json.stdout) as {
      stages: {
        name: string;
        pass: boolean;
        details: { mark: string; detail: string; heading?: boolean }[];
      }[];
    };
    const drift = payload.stages.find((stage) => stage.name === "drift");
    expect(drift?.pass).toBe(false);
    const runHeadings = (drift?.details ?? [])
      .filter((detail) => detail.heading === true)
      .map((detail) => `${detail.mark}  ${detail.detail}`);

    // Same lines, same order, on both surfaces: the run's fold is the alarm's, not a second rendering
    // that happens to agree on the wording.
    expect(runHeadings).toEqual(alarmHeadings);
    expect(headingsIn(human.stdout, "      ")).toEqual(alarmHeadings);
    // …and the comparison is worth making: one heading names the stage holding the family whole, the
    // other names no stage at all, so a run that printed one clause for both — or that resolved the
    // families against the committed rules — would fail above rather than pass on a shared sentence.
    expect(alarmHeadings[0]).toContain(" — held by the lint stage");
    expect(alarmHeadings[1]).not.toContain(" — ");
  });
});

describe("the CI runner's read of the real coverage-mutation payload", () => {
  it("fits the launcher's own fields, so neither side can be renamed without this failing", () => {
    // The real `.freebuff/mutation-coverage.mjs`, with a stub in Vitest's place: the
    // launcher maps the report this test wrote, and the runner reads the launcher's
    // own JSON. Nothing in the tree is weakened, so unlike the guard sweep's
    // counterpart this needs no opt-in flag.
    const report = {
      numTotalTests: 3,
      testResults: [
        {
          name: path.join(projectRoot, "src/test/coverage-mutation.test.ts"),
          status: "failed",
          assertionResults: [
            {
              fullName:
                "the coverage gates are load-bearing > fails src/test/coverage-scopes.test.ts " +
                "when .freebuff/coverage-scopes.mjs is weakened",
              status: "passed",
            },
            {
              fullName:
                "the coverage gates are load-bearing > fails src/test/coverage-floor.test.ts " +
                "when .freebuff/coverage-floor.mjs is weakened",
              status: "failed",
              failureMessages: [
                "Error: Running src/test/coverage-floor.test.ts against the weakened " +
                  ".freebuff/coverage-floor.mjs still passed, so the mutation survived.",
              ],
            },
          ],
        },
        {
          name: path.join(projectRoot, "src/test/coverage-report.test.ts"),
          status: "failed",
          message: "Error: the anchor drifted",
        },
      ],
    };
    const stub = writeStub(
      "mc-real-vitest.mjs",
      [
        "import { writeFileSync } from 'node:fs';",
        "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
        `writeFileSync(out, ${JSON.stringify(JSON.stringify(report))});`,
        "process.exit(1);",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [ciRunner, "--only=mutation-coverage"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI_MUTATION_COVERAGE_SCRIPT: coverageLauncher,
        MUTATION_COVERAGE_VITEST: stub,
        CI_CACHE_FILE: freshCachePath(),
      },
    });

    // If the two sides disagreed about a key, the runner would fall back to
    // "produced no JSON" or print a survivor count it could not have derived.
    expect(result.stdout).not.toContain("produced no JSON");
    expect(result.stdout).toContain("FAIL  coverage gate mutation");
    expect(result.stdout).toContain("3 checked, 2 survivor(s)");
    expect(result.stdout).toContain("SURVIVED WEAKENING  src/test/coverage-mutation.test.ts");
    expect(result.stdout).toContain("CHECK BROKEN  src/test/coverage-report.test.ts");
    expect(result.stdout).toContain("still passed, so the mutation survived");
    expect(result.status).toBe(1);
  });
});

describe("the CI runner's read of the real preflight payload", () => {
  it("fits the preflight's own fields, so neither can be renamed without this failing", () => {
    // The real preflight, for real. It always writes the `--json` object, even
    // when the gate fails, so an unused port is enough to exercise the contract.
    const probe = spawnSync(
      process.execPath,
      [preflight, "--json", "--port", UNUSED_PORT, "--timeout", "800"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    const payload = JSON.parse(probe.stdout) as PreflightPayload;

    // --- The shape the runner reads, asserted directly. ---------------------
    // ci.mjs reads exactly these: the top-level `gate` and `checks`, and on each
    // check its `status`, `name` and `detail` (plus `fix` when a check fails).
    expect(payload.gate).toMatch(/^(pass|fail)$/);
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks.length).toBeGreaterThan(0);
    for (const check of payload.checks) {
      expect(typeof check.name).toBe("string");
      expect(["ok", "warn", "info", "fail"]).toContain(check.status);
      expect(typeof check.detail).toBe("string");
    }

    const failed = payload.checks.filter((check) => check.status === "fail");
    const warnings = payload.checks.filter((check) => check.status === "warn");
    // A gate that passes on this unused port would make the assertions below
    // vacuous, so pin the case under test.
    expect(payload.gate).toBe("fail");
    expect(failed.length).toBeGreaterThan(0);
    // Every failing check tells the caller how to fix it; the runner prints it.
    for (const check of failed) expect(typeof check.fix).toBe("string");

    // --- The runner, reading that same payload. -----------------------------
    const result = spawnSync(
      process.execPath,
      [ciRunner, "--only=preflight", "--port", UNUSED_PORT, "--timeout", "800"],
      { cwd: projectRoot, encoding: "utf8", env: { ...process.env, CI_CACHE_FILE: freshCachePath() } },
    );

    // If the two sides disagreed about a key, the runner would fall back to
    // "produced no JSON" or print a zero it could not have derived.
    expect(result.stdout).not.toContain("produced no JSON");
    expect(result.stdout).toContain("FAIL  preview preflight");
    expect(result.status).toBe(1);

    // The derived counts: the runner's summary must equal what the payload itself
    // says. This is the drift guard — a renamed field breaks the arithmetic.
    const expected =
      payload.gate === "pass"
        ? `${payload.checks.length} check(s), ${warnings.length} warning(s)`
        : `gate "fail", ${failed.length} check(s) failed`;
    expect(result.stdout).toContain(expected);

    // And every failed check reaches the log by name and with its fix — except a check
    // whose *name* is one the redactor hides: a clean checkout has no `.env.local`, so
    // that check fails on a hosted runner, and its name never reaches the log by design
    // (the cache-explanation cases pin the redaction itself).
    for (const check of failed.filter((check) => !check.name.startsWith(".env"))) {
      expect(result.stdout).toContain(`${check.name}  ${check.detail}`);
      expect(result.stdout).toContain(`fix: ${check.fix}`);
    }
  }, 20_000);
});

describe("the CI runner's stage selection", () => {
  it("runs only the stage --only names", () => {
    const stub = writeStub("sel-preflight.mjs", PASSING_PREFLIGHT);

    const result = runCi(["--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("running 1 stage(s): preflight");
    expect(result.stdout).toContain("── preview preflight ──");
    // The stages it did not name never ran.
    expect(result.stdout).not.toContain("── typecheck ──");
    expect(result.stdout).not.toContain("── runbook contents ──");
    expect(result.stdout).not.toContain("── lint baseline ──");
    expect(result.stdout).not.toContain("── vitest suite ──");
    expect(result.stdout).not.toContain("── mutation sweep ──");
  });

  it("runs several named stages in canonical order, however they are written", () => {
    const preflightStub = writeStub("sel2-preflight.mjs", PASSING_PREFLIGHT);
    const mutationStub = writeStub("sel2-mutation.mjs", PASSING_MUTATION);

    const result = runCi(["--only=mutation,preflight"], {
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    expect(result.status).toBe(0);
    // Named last, but the sweep is the later stage, so it still runs last.
    expect(result.stdout).toContain("running 2 stage(s): preflight, mutation");
    expect(result.stdout).toContain("── preview preflight ──");
    expect(result.stdout).toContain("── mutation sweep ──");
    expect(result.stdout).not.toContain("── typecheck ──");
    expect(result.stdout).not.toContain("── vitest suite ──");
  });

  it("rejects an unknown stage name instead of quietly narrowing the gate", () => {
    const result = runCi(["--only=preflight,nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown stage(s): nope");
    expect(result.stderr).toContain("have: typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation");
    // Nothing was selected, so nothing ran: no banner, no summary line.
    expect(result.stdout).not.toContain("── ");
    expect(result.stdout).not.toContain("running ");
  });

  it("selects every stage when --only is absent", () => {
    // `--dry-run` makes the selection observable without paying for the suite
    // and the sweep.
    const result = runCi(["--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "would run 11 stage(s): typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation",
    );
    // It reported; it did not execute.
    expect(result.stdout).not.toContain("── ");
  });

  it("orders a --only selection and reports it under --dry-run", () => {
    const result = runCi(["--only=test,typecheck", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would run 2 stage(s): typecheck, test");
  });
});

describe("the CI runner's --from resume", () => {
  it("starts at the named stage and runs the rest of the canonical order", () => {
    // The resume path: a fixed failure should not replay the cheap stages that
    // already passed. From `preflight` on, only the tail is selected.
    const preflightStub = writeStub("from-preflight.mjs", PASSING_PREFLIGHT);
    const driftStub = writeStub("from-drift.mjs", PASSING_DRIFT);
    const coverageStub = writeStub("from-coverage.mjs", PASSING_MUTATION_COVERAGE);
    const mutationStub = writeStub("from-mutation.mjs", PASSING_MUTATION);
    const sweepStub = writeStub("from-sweep.mjs", PASSING_MUTATION_PREFLIGHT);

    const result = runCi(["--from=preflight"], {
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_DRIFT_SCRIPT: driftStub,
      CI_MUTATION_COVERAGE_SCRIPT: coverageStub,
      CI_MUTATION_PREFLIGHT_SCRIPT: sweepStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("running 7 stage(s): preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation");
    expect(result.stdout).toContain("── preview preflight ──");
    // The pinned hashes are re-read before the scripts are weakened.
    expect(result.stdout).toContain("── gate drift ──");
    // The tree-editing group resumes together, cheapest first: coverage gates, then the
    // preflight sweep, then the route sweep.
    expect(result.stdout).toContain("── coverage gate mutation ──");
    expect(result.stdout).toContain("── preflight mutation sweep ──");
    expect(result.stdout).toContain("── mutation sweep ──");
    // The stages before the resume point are not replayed.
    expect(result.stdout).not.toContain("── typecheck ──");
    expect(result.stdout).not.toContain("── runbook contents ──");
    expect(result.stdout).not.toContain("── lint baseline ──");
    expect(result.stdout).not.toContain("── vitest suite ──");
  }, 20_000);

  it("runs a later stage and the ones after it, in canonical order", () => {
    const testStub = writeStub("from-test.mjs", RECORDING_TEST);
    const preflightStub = writeStub("from-test-preflight.mjs", PASSING_PREFLIGHT);
    const driftStub = writeStub("from-test-drift.mjs", PASSING_DRIFT);
    const coverageStub = writeStub("from-test-coverage.mjs", PASSING_MUTATION_COVERAGE);
    const mutationStub = writeStub("from-test-mutation.mjs", PASSING_MUTATION);
    const sweepStub = writeStub("from-test-sweep.mjs", PASSING_MUTATION_PREFLIGHT);
    const marker = path.join(stubDir, "from-ran.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--from=test"], {
      CI_TEST_SCRIPT: testStub,
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_DRIFT_SCRIPT: driftStub,
      CI_MUTATION_COVERAGE_SCRIPT: coverageStub,
      CI_MUTATION_PREFLIGHT_SCRIPT: sweepStub,
      CI_MUTATION_SCRIPT: mutationStub,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("running 8 stage(s): test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation");
    // The suite really ran (the marker is the proof, not the banner).
    expect(existsSync(marker)).toBe(true);
    expect(result.stdout).toContain("── vitest suite ──");
    expect(result.stdout).not.toContain("── typecheck ──");
    expect(result.stdout).not.toContain("── lint baseline ──");
  }, 20_000);

  it("resumes at the first stage when --from names typecheck", () => {
    // `--from` cannot be *absent* and resume the whole job by accident when it
    // names the first stage: the selection is still the full canonical order.
    const result = runCi(["--from=typecheck", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "would run 11 stage(s): typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation",
    );
  });

  it("reflects the resume point under --dry-run", () => {
    const result = runCi(["--from=test", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would run 8 stage(s): test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation");
    // It reported; it did not execute.
    expect(result.stdout).not.toContain("── ");
  });

  it("reports the selected tail in the --dry-run JSON", () => {
    const result = runCi(["--from=lint", "--dry-run", "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.dryRun).toBe(true);
    expect(payload.stages).toEqual(["lint", "test", "preflight", "drift", "mutation-example", "mutation-fifth", "mutation-coverage", "mutation-preflight", "mutation"]);
  });

  it("rejects an unknown --from instead of quietly running the whole job", () => {
    const result = runCi(["--from=nope"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--from names unknown stage: nope");
    expect(result.stderr).toContain("have: typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation");
    // A narrowed resume must not silently widen: nothing ran.
    expect(result.stdout).not.toContain("running ");
  });

  it("refuses to combine --from and --only rather than ignore one", () => {
    const result = runCi(["--from=test", "--only=preflight"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--from and --only select stages two different ways");
    expect(result.stdout).not.toContain("running ");
  });
});

describe("the CI runner's --skip", () => {
  it("leaves a skipped stage out of the run and names the exclusion", () => {
    const lintStub = writeStub("skip-lint.mjs", PASSING_LINT);

    const result = runCi(["--only=lint,preflight", "--skip=preflight"], {
      CI_LINT_SCRIPT: lintStub,
      // No preflight stub: if the runner wrongly ran the stage, the real script's
      // banner would give the `not.toContain` below something to catch.
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("running 1 stage(s): lint");
    expect(result.stdout).toContain("── lint baseline ──");
    expect(result.stdout).toContain("ci: --skip excludes: preflight");
    // The skipped stage never ran.
    expect(result.stdout).not.toContain("── preview preflight ──");
  });

  it("reports the excluded stages in the --json report", () => {
    const lintStub = writeStub("skip-json-lint.mjs", PASSING_LINT);

    const result = runCi(["--json", "--only=lint,preflight", "--skip=preflight"], {
      CI_LINT_SCRIPT: lintStub,
    });

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("pass");
    expect(payload.stages.map((stage: { name: string }) => stage.name)).toEqual(["lint"]);
    // The omission is reported, not silent.
    expect(payload.excluded).toEqual(["preflight"]);
  });

  it("reflects the exclusion under --dry-run without running anything", () => {
    const result = runCi(["--skip=preflight", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "would run 10 stage(s): typecheck, runbook, lint, test, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation",
    );
    expect(result.stdout).toContain("ci: --skip excludes: preflight");
    expect(result.stdout).not.toContain("── ");
  });

  it("carries the exclusion into the --dry-run JSON", () => {
    const result = runCi(["--skip=preflight", "--dry-run", "--json"]);

    const payload = JSON.parse(result.stdout);
    expect(payload.stages).toEqual([
      "typecheck",
      "runbook",
      "lint",
      "test",
      "drift",
      "mutation-example",
      "mutation-fifth",
      "mutation-coverage",
      "mutation-preflight",
      "mutation",
    ]);
    expect(payload.excluded).toEqual(["preflight"]);
  });

  it("composes with --from, subtracting from the resumed tail", () => {
    const result = runCi(["--from=test", "--skip=mutation", "--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would run 7 stage(s): test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight");
    expect(result.stdout).toContain("ci: --skip excludes: mutation");
  });

  it("rejects an unknown stage name instead of widening the gate", () => {
    const result = runCi(["--skip=nope", "--dry-run"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--skip names unknown stage(s): nope");
    expect(result.stderr).toContain("have: typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation");
    expect(result.stdout).not.toContain("would run");
  });

  it("refuses an empty --skip rather than run a gate that looks narrowed", () => {
    const result = runCi(["--skip=", "--dry-run"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--skip needs at least one stage name");
    expect(result.stdout).not.toContain("would run");
  });

  it("refuses a --skip that would leave nothing to run", () => {
    const result = runCi([
      "--skip=typecheck,runbook,lint,test,preflight,drift,mutation-example,mutation-fifth,mutation-coverage,mutation-preflight,mutation",
      "--dry-run",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--skip excludes every selected stage");
    expect(result.stdout).not.toContain("would run");
  });
});

describe("the CI runner's lint stage", () => {
  it("reports a clean project and exits 0 for a passing payload", () => {
    const stub = writeStub("lint-pass.mjs", PASSING_LINT);

    const result = runLintStage(stub);

    // The stub exits 3 unless `--json` was forwarded.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  lint baseline");
    expect(result.stdout).toContain("346 file(s), no findings");
    expect(result.stdout).toContain("ci: all 1 stage(s) passed.");
  });

  it("names each finding by file and line, with its rule, and exits 1", () => {
    const stub = writeStub("lint-fail.mjs", FAILING_LINT);

    const result = runLintStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  lint baseline — 2 lint finding(s)");
    // Each finding is named by project-relative path, line and column, then its
    // rule and message — the line a developer needs to fix it.
    expect(result.stdout).toContain("ERR  src/app/api/foo/route.ts:12:7");
    expect(result.stdout).toContain("@typescript-eslint/no-unused-vars: x is assigned a value but never used");
    expect(result.stdout).toContain("WARN  src/lib/bar.ts:3:1");
    expect(result.stdout).toContain("react-hooks/exhaustive-deps: missing dependency: y");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: lint");
  });

  it("folds the findings under a counted heading per file, on the report and in --json", () => {
    const stub = writeStub("lint-multi.mjs", MULTI_FILE_LINT);

    const result = runLintStage(stub);

    // The file leads its findings, counted, so two rows in one file read as that file's rather
    // than as two unrelated findings — the same fold the drift stage uses (`foldedDetails`), with
    // the file as the group instead of the watch rule.
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FILE  src/app/api/foo/route.ts (2)");
    expect(result.stdout).toContain("FILE  src/lib/bar.ts (1)");
    // The findings are still named one row each, with their mark, line and rule.
    expect(result.stdout).toContain("ERR  src/app/api/foo/route.ts:12:7");
    expect(result.stdout).toContain("WARN  src/app/api/foo/route.ts:20:3");
    expect(result.stdout).toContain("WARN  src/lib/bar.ts:3:1");
    // A heading sits over its own rows, not merely somewhere above them.
    const rows = result.stdout.split("\n");
    const rowAt = (needle: string) => rows.findIndex((line) => line.trim().startsWith(needle));
    expect(rowAt("ERR  src/app/api/foo/route.ts:12:7")).toBeGreaterThan(
      rowAt("FILE  src/app/api/foo/route.ts (2)"),
    );
    expect(rowAt("WARN  src/app/api/foo/route.ts:20:3")).toBeLessThan(
      rowAt("FILE  src/lib/bar.ts (1)"),
    );

    const payload = JSON.parse(runLintStage(stub, ["--json"]).stdout);
    const lint = payload.stages.find((stage: { name: string }) => stage.name === "lint");
    const headings = lint.details.filter(
      (detail: { heading?: boolean }) => detail.heading === true,
    );
    expect(headings.map((detail: { detail: string }) => detail.detail)).toEqual([
      "src/app/api/foo/route.ts (2)",
      "src/lib/bar.ts (1)",
    ]);
    // A heading names no file, so it cannot be mistaken for a locatable finding.
    expect(headings.every((detail: { name?: string }) => detail.name === undefined)).toBe(true);
    // One annotation per finding, none for a heading: the fold costs no finding its mark.
    expect(payload.annotations.map((annotation: { file: string }) => annotation.file)).toEqual([
      "src/app/api/foo/route.ts",
      "src/app/api/foo/route.ts",
      "src/lib/bar.ts",
    ]);
  });

  it("fails a stage that writes no JSON rather than reading it as a pass", () => {
    const stub = writeStub(
      "lint-crash.mjs",
      "process.stderr.write('stub lint: exploded before writing JSON\\n');\nprocess.exit(2);\n",
    );

    const result = runLintStage(stub);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("produced no JSON — the gate may have crashed");
    expect(result.stdout).toContain("stub lint: exploded before writing JSON");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: lint");
  });
});

describe("the CI runner's typecheck and test stages", () => {
  it("names the type errors from a stubbed typecheck", () => {
    const stub = writeStub("tsc-fail.mjs", FAILING_TYPECHECK);

    const result = runCi(["--only=typecheck"], { CI_TYPECHECK_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  typecheck — 2 type error(s)");
    // Each error line is surfaced, not the whole tsc output.
    expect(result.stdout).toContain("src/app/api/foo/route.ts(1,2): error TS2322: bad assignment");
    expect(result.stdout).toContain("src/lib/bar.ts(9,9): error TS2345: bad argument");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: typecheck");
  });

  it("names the failing test when the suite fails", () => {
    const stub = writeStub("vitest-fail.mjs", FAILING_TEST_REPORT);

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  vitest suite — 1 of 3 test(s) failed");
    // The failing test is named by project-relative path and title.
    expect(result.stdout).toContain("src/test/stub.test.ts  renders the thing");
    // The one that passed is not printed.
    expect(result.stdout).not.toContain("passes one");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: test");
  });

  it("says the tests passed but the run failed when only a reporter failed it", () => {
    // The collect-time budget is a reporter: every test can pass and the run
    // still fail. The summary must not claim a test failed when none did.
    const stub = writeStub("vitest-budget.mjs", PASSED_TESTS_FAILED_RUN_REPORT);

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("every test passed, but the run failed");
    // The reporter's own words are surfaced, not swallowed.
    expect(result.stdout).toContain("collect-budget: 1 breach(es)");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: test");
  });

  it("names the file when a suite fails with every one of its tests passing", () => {
    // A file-level hook that throws — an `afterAll` clearing a scratch tree — fails the
    // *suite*, not any test. With `--reporter=json` in place of the default one, nothing
    // else printed it either, so the reason has to be read out of the report: a summary
    // that only says the run failed leaves a reader nothing to look at, and the report it
    // came from is deleted on the way out.
    const stub = writeStub("vitest-broken-suite.mjs", BROKEN_SUITE_REPORT);

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "every test passed, but the run failed — 1 file(s) failed without a failing test",
    );
    // The file and its own words are named, not swallowed behind the summary.
    expect(result.stdout).toContain("src/test/stub.test.ts");
    expect(result.stdout).toContain("EBUSY");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: test");
  });

  it("names an unhandled error that failed the run with every test passing", () => {
    const stub = writeStub("vitest-unhandled.mjs", UNHANDLED_ERROR_REPORT);

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("every test passed, but the run failed — 1 unhandled error(s)");
    expect(result.stdout).toContain("stub rejection: nobody awaited this");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: test");
  });

  it("fails loudly when the suite writes no report", () => {
    const stub = writeStub(
      "vitest-crash.mjs",
      "process.stderr.write('stub vitest: exploded before writing a report\\n');\nprocess.exit(1);\n",
    );

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("the suite wrote no report — it may have crashed");
    expect(result.stdout).toContain("stub vitest: exploded before writing a report");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: test");
  });

  it("runs the suite once more when the wrapper dies over a healthy report", () => {
    // The flake that turned a green suite red: every test passed, the JSON report
    // carries no failure of any kind, and the wrapper exited 1 anyway — the shape the
    // vitest worker's RPC (`Timeout calling "onTaskUpdate"`) produced on a loaded
    // machine. One bounded retry is the whole indulgence: rare flake, expensive suite.
    const stub = writeStub(
      "vitest-rpc-flake.mjs",
      [
        "import { writeFileSync, readFileSync, existsSync } from 'node:fs';",
        "const marker = process.env.CI_RETRY_COUNTER;",
        "const attempt = existsSync(marker) ? Number(readFileSync(marker, 'utf8')) + 1 : 1;",
        "writeFileSync(marker, String(attempt));",
        "process.stderr.write('stderr: Timeout calling \"onTaskUpdate\"\\n');",
        "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
        "writeFileSync(out, JSON.stringify({ numTotalTests: 1, numFailedTests: 0, testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }] }));",
        "if (attempt === 1) process.exit(1);",
      ].join("\n"),
    );
    const counter = path.join(stubDir, "retry-green.counter");
    rmSync(counter, { force: true });

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub, CI_RETRY_COUNTER: counter });

    // The suite ran twice (the counter is the proof), the second attempt was healthy,
    // and the stage is green — a healthy suite cannot fail its wrapper.
    expect(readFileSync(counter, "utf8")).toBe("2");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "ci: vitest wrapper failed with every test passing (the known RPC flake) — running the suite once more",
    );
    // The green summary says the close came after a retry, so the record of the run
    // does not read as if nothing had happened.
    expect(result.stdout).toContain("1 test(s) passed in 1 file(s) — after one retry for a wrapper-only failure");
  }, 20_000);

  it("names the wrapper when a retry fails the same way", () => {
    // A genuinely broken wrapper fails twice: the run stays red, but the summary says
    // the tests passed and the flake's own words are surfaced from the wrapper's
    // stderr — never again a `see below` with nothing under it.
    const stub = writeStub(
      "vitest-rpc-dead.mjs",
      [
        "import { writeFileSync, readFileSync, existsSync } from 'node:fs';",
        "const marker = process.env.CI_RETRY_COUNTER;",
        "const attempt = existsSync(marker) ? Number(readFileSync(marker, 'utf8')) + 1 : 1;",
        "writeFileSync(marker, String(attempt));",
        "process.stderr.write('stderr: Timeout calling \"onTaskUpdate\"\\n');",
        "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
        "writeFileSync(out, JSON.stringify({ numTotalTests: 1, numFailedTests: 0, testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }] }));",
        "process.exit(1);",
      ].join("\n"),
    );
    const counter = path.join(stubDir, "retry-red.counter");
    rmSync(counter, { force: true });

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub, CI_RETRY_COUNTER: counter });

    expect(result.status).toBe(1);
    expect(readFileSync(counter, "utf8")).toBe("2");
    expect(result.stdout).toContain(
      "every test passed, but the run failed — see below (a retry failed the same way: the wrapper, not the tests)",
    );
    // The flake's own words, from the wrapper's stderr, under the summary.
    expect(result.stdout).toContain("onTaskUpdate");
  }, 20_000);

  it("does not spend a retry when a test actually failed", () => {
    // The retry is for a wrapper dying over a *healthy* report. A real red is
    // answered once, by the failure itself.
    const stub = writeStub("vitest-real-fail.mjs", FAILING_TEST_REPORT);
    const counter = path.join(stubDir, "retry-real-fail.counter");
    rmSync(counter, { force: true });

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub, CI_RETRY_COUNTER: counter });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("1 of 3 test(s) failed");
    expect(result.stdout).not.toContain("running the suite once more");
  });

  it("does not retry a suite that failed outside its tests", () => {
    // A broken suite is a real finding about the tree — the retry exists so a
    // healthy suite cannot fail its wrapper, not so any wrapper exit gets a
    // second bite.
    const stub = writeStub("vitest-broken-suite-retry.mjs", BROKEN_SUITE_REPORT);

    const result = runCi(["--only=test"], { CI_TEST_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("every test passed, but the run failed — 1 file(s) failed without a failing test");
    expect(result.stdout).not.toContain("running the suite once more");
  });
});

describe("the CI runner's fail-fast", () => {
  it("stops at the first failing stage by default and names what it did not run", () => {
    const tscStub = writeStub("ff-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("ff-test.mjs", RECORDING_TEST);
    const marker = path.join(stubDir, "ff-ran.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--only=typecheck,test"], {
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  typecheck");
    // The suite stage really never ran (the marker is the proof, not the banner).
    expect(existsSync(marker)).toBe(false);
    expect(result.stdout).not.toContain("── vitest suite ──");
    // The stages not reached are named, and the escape hatches are offered:
    // run them anyway, or resume at the first one once the failure is fixed.
    expect(result.stderr).toContain("stopped early");
    expect(result.stderr).toContain("1 stage(s) not run: test");
    expect(result.stderr).toContain("--keep-going");
    expect(result.stderr).toContain("--from=test");
  });

  it("runs every stage by default when a CI environment is detected", () => {
    const tscStub = writeStub("ci-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("ci-test.mjs", RECORDING_TEST);
    const marker = path.join(stubDir, "ci-ran.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--only=typecheck,test"], {
      CI: "true",
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(1);
    // The failing typecheck did not stop the suite: CI wants the whole list.
    expect(existsSync(marker)).toBe(true);
    expect(result.stdout).toContain("PASS  vitest suite");
    expect(result.stderr).not.toContain("stopped early");
    expect(result.stderr).toContain("1 of 2 stage(s) failed: typecheck");
    // And it says why it kept going.
    expect(result.stdout).toContain("CI environment detected");
  });

  it("stays fail-fast inside CI when --fail-fast is passed", () => {
    const tscStub = writeStub("ciff-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("ciff-test.mjs", RECORDING_TEST);
    const marker = path.join(stubDir, "ciff-ran.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--only=typecheck,test", "--fail-fast"], {
      CI: "true",
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(result.stderr).toContain("stopped early");
  });

  it("treats a falsey CI value as a local, fail-fast run", () => {
    const tscStub = writeStub("cifalse-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("cifalse-test.mjs", RECORDING_TEST);
    const marker = path.join(stubDir, "cifalse-ran.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--only=typecheck,test"], {
      CI: "false",
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
      CI_STUB_MARKER: marker,
    });

    expect(existsSync(marker)).toBe(false);
    expect(result.stderr).toContain("stopped early");
  });

  it("refuses --keep-going together with --fail-fast rather than guess", () => {
    const result = runCi(["--keep-going", "--fail-fast", "--dry-run"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("opposite things");
  });

  it("runs every stage with --keep-going and reports each failure", () => {
    const tscStub = writeStub("kg-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("kg-test.mjs", RECORDING_TEST);
    const marker = path.join(stubDir, "kg-ran.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--only=typecheck,test", "--keep-going"], {
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  typecheck");
    // The suite did run, and its result is reported alongside the failure.
    expect(existsSync(marker)).toBe(true);
    expect(result.stdout).toContain("PASS  vitest suite");
    expect(result.stderr).not.toContain("stopped early");
    expect(result.stderr).toContain("1 of 2 stage(s) failed: typecheck");
  });

  it("records the stages it never reached in the --json report", () => {
    const tscStub = writeStub("ffjson-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("ffjson-test.mjs", RECORDING_TEST);
    const marker = path.join(stubDir, "ffjson.marker");
    rmSync(marker, { force: true });

    const result = runCi(["--json", "--only=typecheck,test"], {
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
      CI_STUB_MARKER: marker,
    });

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("fail");
    expect(payload.failed).toEqual(["typecheck"]);
    expect(payload.stages.map((stage: { name: string }) => stage.name)).toEqual(["typecheck"]);
    // The unreached stage is reported, not silently absent from the report.
    expect(payload.skipped).toEqual(["test"]);
    expect(payload.stoppedEarly).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(result.status).toBe(1);
  });
});

describe("the CI runner's --max-failures", () => {
  it("stops once the cap is reached and names the stages it did not run", () => {
    const lintStub = writeStub("mf2-lint.mjs", FAILING_LINT);
    const preflightStub = writeStub("mf2-preflight.mjs", FAILING_PREFLIGHT);
    const mutationStub = writeStub("mf2-mutation.mjs", PASSING_MUTATION);

    const result = runCi(["--only=lint,preflight,mutation", "--max-failures=2"], {
      CI_LINT_SCRIPT: lintStub,
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    expect(result.status).toBe(1);
    // Both failing stages up to the cap are reported.
    expect(result.stdout).toContain("FAIL  lint baseline");
    expect(result.stdout).toContain("FAIL  preview preflight");
    // The third stage is past the budget, so it never ran.
    expect(result.stdout).not.toContain("── mutation sweep ──");
    expect(result.stdout).toContain("stopping after 2 failing stage(s)");
    // The stage not reached is named, with the cap's own escape hatch.
    expect(result.stderr).toContain("stopped early");
    expect(result.stderr).toContain("1 stage(s) not run: mutation");
    expect(result.stderr).toContain("raise --max-failures above 2");
  });

  it("keeps going when the failures are under the cap", () => {
    const lintStub = writeStub("mf3-lint.mjs", FAILING_LINT);
    const preflightStub = writeStub("mf3-preflight.mjs", FAILING_PREFLIGHT);
    const mutationStub = writeStub("mf3-mutation.mjs", PASSING_MUTATION);

    const result = runCi(["--only=lint,preflight,mutation", "--max-failures=3"], {
      CI_LINT_SCRIPT: lintStub,
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    expect(result.status).toBe(1);
    // Two failures are below the budget of three, so the sweep still ran.
    expect(result.stdout).toContain("── mutation sweep ──");
    expect(result.stdout).toContain("PASS  mutation sweep");
    expect(result.stderr).not.toContain("stopped early");
    expect(result.stderr).toContain("2 of 3 stage(s) failed");
  });

  it("caps a CI run instead of letting the CI default widen it to unlimited", () => {
    const lintStub = writeStub("mfci-lint.mjs", FAILING_LINT);
    const preflightStub = writeStub("mfci-preflight.mjs", FAILING_PREFLIGHT);
    const mutationStub = writeStub("mfci-mutation.mjs", PASSING_MUTATION);

    const result = runCi(["--only=lint,preflight,mutation", "--max-failures=1"], {
      CI: "true",
      CI_LINT_SCRIPT: lintStub,
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    expect(result.status).toBe(1);
    // `--max-failures=1` is fail-fast even inside CI, where keep-going is the
    // default; the CI notice must not claim the run is unlimited.
    expect(result.stdout).not.toContain("── preview preflight ──");
    expect(result.stdout).not.toContain("CI environment detected");
    expect(result.stderr).toContain("stopped early");
  });

  it("reports the cap and that it is not a keep-going run in the --json report", () => {
    const lintStub = writeStub("mfjson-lint.mjs", FAILING_LINT);
    const preflightStub = writeStub("mfjson-preflight.mjs", FAILING_PREFLIGHT);
    const mutationStub = writeStub("mfjson-mutation.mjs", PASSING_MUTATION);

    const result = runCi(["--json", "--only=lint,preflight,mutation", "--max-failures=2"], {
      CI_LINT_SCRIPT: lintStub,
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("fail");
    expect(payload.maxFailures).toBe(2);
    expect(payload.keepGoing).toBe(false);
    expect(payload.failed).toEqual(["lint", "preflight"]);
    expect(payload.skipped).toEqual(["mutation"]);
    expect(payload.stoppedEarly).toBe(true);
  });

  it("reflects the cap under --dry-run without running anything", () => {
    const result = runCi(["--max-failures=2", "--dry-run", "--json"]);

    const payload = JSON.parse(result.stdout);
    expect(payload.maxFailures).toBe(2);
    expect(payload.keepGoing).toBe(false);
    expect(payload.stages).toHaveLength(11);
  });

  it("refuses a cap that is not a positive integer", () => {
    for (const value of ["0", "abc", "-1"]) {
      const result = runCi([`--max-failures=${value}`, "--dry-run"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--max-failures needs a positive integer");
    }
  });

  it("refuses the cap alongside --keep-going or --fail-fast rather than guess", () => {
    const withKeep = runCi(["--max-failures=2", "--keep-going", "--dry-run"]);
    expect(withKeep.status).toBe(1);
    expect(withKeep.stderr).toContain("--max-failures and --keep-going");

    const withFast = runCi(["--max-failures=2", "--fail-fast", "--dry-run"]);
    expect(withFast.status).toBe(1);
    expect(withFast.stderr).toContain("--max-failures and --fail-fast");
  });
});

describe("the CI runner's verdict line", () => {
  it("closes a green run with the counts", () => {
    const stub = writeStub("verdict-pass.mjs", PASSING_PREFLIGHT);

    const result = runCi(["--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
    );
  });

  it("counts a stopped run's failure and the stage it never reached", () => {
    const tscStub = writeStub("verdict-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("verdict-test.mjs", RECORDING_TEST);

    const result = runCi(["--only=typecheck,test"], {
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "ci: verdict — 0 passed, 1 failed, 1 skipped, 0 unchanged, 0 reused, 0 excluded (2 selected)",
    );
  });

  it("counts the --skip exclusions apart from the stages that ran", () => {
    const lintStub = writeStub("verdict-lint.mjs", PASSING_LINT);

    const result = runCi(["--only=lint,preflight", "--skip=preflight"], {
      CI_LINT_SCRIPT: lintStub,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 1 excluded (2 selected)",
    );
  });

  it("counts a change-based skip as unchanged, not passed", () => {
    const lintStub = writeStub("verdict-changed-lint.mjs", PASSING_LINT);

    const result = runCi(["--only=lint,preflight", "--changed-only"], {
      CI_LINT_SCRIPT: lintStub,
      // Feeds the lint globs and nothing the preflight reads.
      CI_CHANGED_FILES: "src/lib/foo.ts",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 1 unchanged, 0 reused, 0 excluded (2 selected)",
    );
  });

  it("prints the verdict to stderr under --json, keeping stdout the report alone", () => {
    const stub = writeStub("verdict-json.mjs", PASSING_PREFLIGHT);

    const result = runCi(["--json", "--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    // stdout stayed parseable JSON for the consumer.
    expect(JSON.parse(result.stdout).gate).toBe("pass");
    // …and the verdict still closed the log on stderr.
    expect(result.stderr).toContain("ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded");
  });

  it("opens the log with the counts, before the per-stage evidence", () => {
    const stub = writeStub("verdict-open.mjs", PASSING_PREFLIGHT);

    const result = runCi(["--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    expect(result.status).toBe(0);
    const opening = result.stdout.indexOf(
      "ci: verdict — 0 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
    );
    const evidence = result.stdout.indexOf("── preview preflight ──");
    const closing = result.stdout.indexOf(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
    );

    // The same line brackets the log: the projection opens it, the result closes
    // it, and the evidence sits between the two.
    expect(opening).toBeGreaterThanOrEqual(0);
    expect(evidence).toBeGreaterThan(opening);
    expect(closing).toBeGreaterThan(evidence);
  });

  it("projects the change-based skips into the opening counts", () => {
    const lintStub = writeStub("verdict-open-changed-lint.mjs", PASSING_LINT);

    const result = runCi(["--only=lint,preflight", "--changed-only"], {
      CI_LINT_SCRIPT: lintStub,
      // Feeds the lint globs and nothing the preflight reads.
      CI_CHANGED_FILES: "src/lib/foo.ts",
    });

    expect(result.status).toBe(0);
    // The opener states what it can already know it will skip — and leaves the
    // count it cannot know (whether a stage fails) at zero rather than guessing.
    const opening = result.stdout.indexOf(
      "ci: verdict — 0 passed, 0 failed, 0 skipped, 1 unchanged, 0 reused, 0 excluded (2 selected)",
    );
    const evidence = result.stdout.indexOf("── lint baseline ──");

    expect(opening).toBeGreaterThanOrEqual(0);
    expect(evidence).toBeGreaterThan(opening);
    // …and change detection reaches the same count it promised up front.
    expect(result.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 1 unchanged, 0 reused, 0 excluded (2 selected)",
    );
  });

  it("opens a run it cannot finish with the projection, not the result", () => {
    const tscStub = writeStub("verdict-open-tsc.mjs", FAILING_TYPECHECK);
    const testStub = writeStub("verdict-open-test.mjs", RECORDING_TEST);

    const result = runCi(["--only=typecheck,test"], {
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_TEST_SCRIPT: testStub,
    });

    expect(result.status).toBe(1);
    const opening = result.stdout.indexOf(
      "ci: verdict — 0 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (2 selected)",
    );
    const evidence = result.stdout.indexOf("── typecheck ──");
    const closing = result.stdout.indexOf(
      "ci: verdict — 0 passed, 1 failed, 1 skipped, 0 unchanged, 0 reused, 0 excluded (2 selected)",
    );

    // The opener can only state what is true before a stage runs; the stop the run
    // actually took is the closing line's to report.
    expect(opening).toBeGreaterThanOrEqual(0);
    expect(evidence).toBeGreaterThan(opening);
    expect(closing).toBeGreaterThan(evidence);
  });

  it("keeps both verdict lines on stderr under --json, leaving stdout the report", () => {
    const stub = writeStub("verdict-json-both.mjs", PASSING_PREFLIGHT);

    const result = runCi(["--json", "--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    // stdout stayed a single parseable report, with no verdict line in it…
    expect(JSON.parse(result.stdout).gate).toBe("pass");
    expect(result.stdout).not.toContain("ci: verdict");
    // …and the counts bracket the progress on stderr, opening and closing.
    const opening = result.stderr.indexOf("ci: verdict — 0 passed");
    const closing = result.stderr.indexOf("ci: verdict — 1 passed");
    expect(opening).toBeGreaterThanOrEqual(0);
    expect(closing).toBeGreaterThan(opening);
  });
});

describe("the CI runner's result cache", () => {
  /**
   * The cache turns a second run over an unchanged tree into one that pays only
   * for what actually changed. These tests pair it with a stub that records
   * whether it ran, so "reused" is proved by the stage not executing again rather
   * than by a banner alone — and they check the two directions that make a cache
   * safe: an unchanged tree reuses, anything else runs.
   */

  it("reuses a passing stage on a second run over unchanged inputs", () => {
    const firstMarker = path.join(stubDir, "cache-first.marker");
    const secondMarker = path.join(stubDir, "cache-second.marker");
    const stub = writeStub("cache-preflight.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    const cold = runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: firstMarker });
    const warm = runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: secondMarker });

    // The first run had nothing to reuse and paid for the stage…
    expect(cold.status).toBe(0);
    expect(existsSync(firstMarker)).toBe(true);
    expect(cold.stdout).toContain("PASS  preview preflight");
    expect(cold.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
    );

    // …the second answered from the cache: the stage never ran again, and the
    // verdict counts a reuse rather than a pass the run never made.
    expect(warm.status).toBe(0);
    expect(existsSync(secondMarker)).toBe(false);
    expect(warm.stdout).toContain("REUSE preview preflight");
    expect(warm.stdout).not.toContain("PASS  preview preflight");
    expect(warm.stdout).toContain(
      "ci: verdict — 0 passed, 0 failed, 0 skipped, 0 unchanged, 1 reused, 0 excluded (1 selected)",
    );
    // A run with nothing left to pay for says so, rather than borrowing the
    // "nothing reads the change set" line meant for `--changed-only`.
    expect(warm.stdout).toContain("ci: nothing ran — 1 stage(s) reused from a recorded pass.");
    expect(warm.stdout).not.toContain("nothing to run");
  });

  it("re-runs a stage whose recorded digest no longer matches", () => {
    const marker = path.join(stubDir, "cache-stale.marker");
    const stub = writeStub("cache-stale.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    // An entry for a different tree: its digest cannot match this one, so reusing
    // it would be a pass this run never earned. The stage must run.
    writeFileSync(
      cacheFile,
      JSON.stringify({
        version: 1,
        stages: { preflight: { hash: "0".repeat(64), pass: true, summary: "a past pass" } },
      }),
      "utf8",
    );

    const result = runCi(["--only=preflight"], {
      CI_PREFLIGHT_SCRIPT: stub,
      CI_CACHE_FILE: cacheFile,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(result.stdout).toContain("PASS  preview preflight");
    expect(result.stdout).not.toContain("REUSE");
  });

  it("never reuses a failure — a red stage always runs again", () => {
    const stub = writeStub("cache-failing.mjs", FAILING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    const first = runCi(["--only=preflight"], env);
    const second = runCi(["--only=preflight"], env);

    for (const run of [first, second]) {
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("FAIL  preview preflight");
      expect(run.stdout).not.toContain("REUSE");
      expect(run.stdout).toContain(
        "ci: verdict — 0 passed, 1 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
      );
    }
  });

  it("treats a cache written by an older shape as cold", () => {
    const marker = path.join(stubDir, "cache-version.marker");
    const stub = writeStub("cache-version.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    writeFileSync(
      cacheFile,
      JSON.stringify({ version: 0, stages: { preflight: { hash: "ancient", pass: true } } }),
      "utf8",
    );

    const result = runCi(["--only=preflight"], {
      CI_PREFLIGHT_SCRIPT: stub,
      CI_CACHE_FILE: cacheFile,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(result.stdout).not.toContain("REUSE");
  });

  it("--no-cache neither reads nor writes the cache", () => {
    const firstMarker = path.join(stubDir, "cache-off-first.marker");
    const secondMarker = path.join(stubDir, "cache-off-second.marker");
    const stub = writeStub("cache-off.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    const cold = runCi(["--only=preflight", "--no-cache"], { ...env, CI_STUB_MARKER: firstMarker });
    const warm = runCi(["--only=preflight", "--no-cache"], { ...env, CI_STUB_MARKER: secondMarker });

    // Both runs paid for the stage…
    expect(cold.status).toBe(0);
    expect(warm.status).toBe(0);
    expect(existsSync(firstMarker)).toBe(true);
    expect(existsSync(secondMarker)).toBe(true);
    expect(warm.stdout).not.toContain("REUSE");
    // …and neither left an entry for a third run to pick up.
    expect(existsSync(cacheFile)).toBe(false);
  });

  it("names a reused stage in the report and already on the opening verdict", () => {
    const stub = writeStub("cache-json.mjs", RECORDING_PREFLIGHT);
    const marker = path.join(stubDir, "cache-json.marker");
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile, CI_STUB_MARKER: marker };

    runCi(["--only=preflight"], env);
    const warm = runCi(["--json", "--only=preflight"], env);

    const payload = JSON.parse(warm.stdout);
    expect(payload.gate).toBe("pass");
    expect(payload.reused).toEqual(["preflight"]);
    // Nothing ran, so no stage result is reported — the reuse is the whole story.
    expect(payload.stages).toEqual([]);
    // The projection was already right before the log scrolled: the opener names
    // the reuse ahead of the `running` line.
    const opening = warm.stderr.indexOf(
      "ci: verdict — 0 passed, 0 failed, 0 skipped, 0 unchanged, 1 reused, 0 excluded (1 selected)",
    );
    expect(opening).toBeGreaterThanOrEqual(0);
    expect(opening).toBeLessThan(warm.stderr.indexOf("ci: running 1 stage(s)"));
    expect(warm.stderr).toContain("ci: preflight reused —");
  });

  it("counts a reuse apart from the stage --changed-only already skipped", () => {
    const lintStub = writeStub("cache-changed-lint.mjs", PASSING_LINT);
    const cacheFile = freshCachePath();
    const env = {
      CI_LINT_SCRIPT: lintStub,
      CI_CACHE_FILE: cacheFile,
      // Feeds the lint globs and nothing the preflight reads.
      CI_CHANGED_FILES: "src/lib/foo.ts",
    };
    const args = ["--only=lint,preflight", "--changed-only"];

    const cold = runCi(args, env);
    const warm = runCi(args, env);

    // Cold: lint ran, the preflight was skipped because nothing it reads moved.
    expect(cold.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 1 unchanged, 0 reused, 0 excluded (2 selected)",
    );
    // Warm: lint is now a reuse, and it stays apart from the unchanged preflight
    // rather than being folded into the same bucket.
    expect(warm.stdout).toContain("REUSE lint baseline");
    expect(warm.stdout).toContain(
      "ci: verdict — 0 passed, 0 failed, 0 skipped, 1 unchanged, 1 reused, 0 excluded (2 selected)",
    );
    // Nothing ran that time — one stage was reused and the other skipped — and
    // the line says so rather than reporting a stage count that did not happen.
    expect(warm.stdout).toContain("ci: nothing ran — 1 stage(s) reused from a recorded pass.");
  });

  it("says how many stages ran beside the ones answered from the cache", () => {
    const runbookStub = writeStub("cache-mix-runbook.mjs", PASSING_RUNBOOK);
    const preflightStub = writeStub("cache-mix-preflight.mjs", RECORDING_PREFLIGHT);
    const marker = path.join(stubDir, "cache-mix.marker");
    const cacheFile = freshCachePath();

    // Record a runbook pass first, so the second run has exactly one stage to
    // answer from the cache and one left to actually run.
    runCi(["--only=runbook"], { CI_RUNBOOK_SCRIPT: runbookStub, CI_CACHE_FILE: cacheFile });

    const mixed = runCi(["--only=runbook,preflight"], {
      CI_RUNBOOK_SCRIPT: runbookStub,
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_CACHE_FILE: cacheFile,
      CI_STUB_MARKER: marker,
    });

    expect(mixed.status).toBe(0);
    expect(mixed.stdout).toContain("REUSE runbook contents");
    expect(existsSync(marker)).toBe(true);
    expect(mixed.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 1 reused, 0 excluded (2 selected)",
    );
    // The one stage that ran passed, and the one that did not is named beside it.
    expect(mixed.stdout).toContain("ci: all 1 stage(s) that ran passed (1 reused).");
  });

  it("re-runs and names a stage whose recorded pass has aged out", () => {
    const firstMarker = path.join(stubDir, "cache-ttl-first.marker");
    const secondMarker = path.join(stubDir, "cache-ttl-second.marker");
    const stub = writeStub("cache-ttl.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: firstMarker });
    // A month past the default week, with the digest left exactly as recorded: the
    // inputs still match, but the entry is too old to be vouched for.
    ageOut(cacheFile, "preflight", 30);

    const warm = runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: secondMarker });

    expect(warm.status).toBe(0);
    // It really ran again — a stale entry is never answered from.
    expect(existsSync(secondMarker)).toBe(true);
    expect(warm.stdout).not.toContain("REUSE");
    // …and the expiry is named, up front and on the stage's own line.
    expect(warm.stdout).toContain(
      "ci: re-running 1 stage(s) — recorded pass expired (cap 7d): preflight",
    );
    expect(warm.stdout).toContain("PASS  preview preflight");
    expect(warm.stdout).toContain("(its recorded pass expired)");
    expect(warm.stdout).toContain(
      "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
    );
  });

  it("--cache-ttl=0 removes the cap, so an old pass is reused anyway", () => {
    const marker = path.join(stubDir, "cache-ttl-off.marker");
    const stub = writeStub("cache-ttl-off.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: path.join(stubDir, "cache-ttl-off-cold.marker") });
    ageOut(cacheFile, "preflight", 365);

    const warm = runCi(["--only=preflight", "--cache-ttl=0"], {
      ...env,
      CI_STUB_MARKER: marker,
    });

    expect(warm.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(warm.stdout).toContain("REUSE preview preflight");
    expect(warm.stdout).not.toContain("expired");
  });

  it("expires an entry it cannot date rather than trusting it", () => {
    const marker = path.join(stubDir, "cache-undated.marker");
    const stub = writeStub("cache-undated.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: path.join(stubDir, "cache-undated-cold.marker") });
    const cache = readCache(cacheFile);
    delete cache.stages.preflight.at;
    writeFileSync(cacheFile, JSON.stringify(cache), "utf8");

    const warm = runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: marker });

    expect(warm.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(warm.stdout).not.toContain("REUSE");
    expect(warm.stdout).toContain("recorded pass expired");
  });

  it("reports the aged-out stages and the cap in force", () => {
    const marker = path.join(stubDir, "cache-ttl-json.marker");
    const stub = writeStub("cache-ttl-json.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile, CI_STUB_MARKER: marker };

    runCi(["--only=preflight"], env);
    ageOut(cacheFile, "preflight", 30);

    const warm = runCi(["--json", "--only=preflight"], {
      ...env,
      CI_CACHE_FILE: cacheFile,
      CI_STUB_MARKER: marker,
    });
    const payload = JSON.parse(warm.stdout);

    expect(payload.expired).toEqual(["preflight"]);
    expect(payload.reused).toEqual([]);
    expect(payload.cacheTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("refuses a --cache-ttl it cannot read rather than dropping the cap", () => {
    const result = runCi(["--only=preflight", "--cache-ttl=soon"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--cache-ttl needs a duration like 30m, 12h or 7d (or 0 for no cap), got soon",
    );
  });

  it("survives an input that vanishes while its stage runs, and reports it", () => {
    // The file list behind every key is taken at the start of the run, and each stage's key
    // is read once before its pass and once after it. A stage that removes a file it reads
    // — scratch output it cleans up — leaves that second reading pointed at a path that is
    // no longer there, and it has to land as a *change*: the key moves, the row names the
    // input that went, and the pass is recorded against the tree that is left. What it must
    // never do is throw out of the runner, which is what an unguarded `readFileSync` does.
    //
    // The probe is a `.txt` under `worker/`: the test stage's `worker/**` input covers it,
    // and the extensions the suite's own drift watch fingerprints (`ts|tsx|mjs|js`) do not,
    // so creating it and deleting it here cannot read as the checkout moving under a
    // sibling test.
    const probe = path.join(projectRoot, "worker", ".ci-vanish-probe.txt");
    writeFileSync(probe, "an input that will be gone by the time the key is re-read\n");
    const cacheFile = freshCachePath();

    try {
      const result = runCi(["--only=test"], {
        CI_TEST_SCRIPT: writeStub("vanish-test.mjs", VANISHING_TEST),
        CI_STUB_VANISH: probe,
        CI_CACHE_FILE: cacheFile,
      });

      // A run, not a stack trace: the stage passed and the runner reported it.
      expect(result.stderr).not.toContain("ENOENT");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PASS  vitest suite");
      // The stub really removed the file, so the reading below is about a real absence.
      expect(existsSync(probe)).toBe(false);
      // …and the stage's row says which input went, rather than leaving it to two hashes.
      expect(result.stdout).toContain("WARN INPUT GONE");
      expect(result.stdout).toContain(".ci-vanish-probe.txt");
      // The recorded pass is the tree that is *left* — the absent file is in that key — so
      // the change is recorded rather than swallowed.
      const entry = readCache(cacheFile).stages.test;
      expect(entry.pass).toBe(true);
      expect(entry.startedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.hash).not.toBe(entry.startedHash);
    } finally {
      rmSync(probe, { force: true });
    }
  });
});

describe("the CI runner's cache explanation", () => {
  /**
   * `--explain-cache` answers "why did that stage not get reused?" without running
   * anything. These tests check that it reports the decision the run itself would
   * take — read from the same record the run reads — names the files behind the key,
   * and pays for nothing: no stage runs and nothing is written to the cache.
   */

  it("explains a cold run as having no recorded pass, and runs nothing", () => {
    const marker = path.join(stubDir, "explain-cold.marker");
    const stub = writeStub("explain-cold.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();

    const result = runCi(["--explain-cache", "--only=preflight"], {
      CI_PREFLIGHT_SCRIPT: stub,
      CI_CACHE_FILE: cacheFile,
      CI_STUB_MARKER: marker,
    });

    expect(result.status).toBe(0);
    // A diagnostic is not a run: the stage never executed and nothing was recorded.
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(cacheFile)).toBe(false);
    expect(result.stdout).toContain("ci: cache — 1 selected stage(s), cap 7d, ");
    expect(result.stdout).toContain("run       — no recorded pass for these inputs");
    expect(result.stdout).not.toContain("ci: running");
  });

  it("explains a reuse with the recorded age and the files behind the key", () => {
    const stub = writeStub("explain-warm.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], {
      ...env,
      CI_STUB_MARKER: path.join(stubDir, "explain-warm.marker"),
    });
    const result = runCi(["--explain-cache", "--only=preflight"], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reuse     — inputs unchanged since a passing run");
    // The age is whatever wall-clock age the recorded pass has, so match the shape.
    expect(result.stdout).toMatch(/recorded \d+[smhd] ago/);
    expect(result.stdout).toContain("file(s) behind the key");
  });

  it("explains an expired pass with the cap that expired it", () => {
    const stub = writeStub("explain-ttl.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], {
      ...env,
      CI_STUB_MARKER: path.join(stubDir, "explain-ttl.marker"),
    });
    ageOut(cacheFile, "preflight", 30);

    const result = runCi(["--explain-cache", "--only=preflight"], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("expired   — its recorded pass is 30d old (cap 7d)");
  });

  it("explains a digest that moved rather than calling it a miss", () => {
    const stub = writeStub("explain-moved.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], {
      ...env,
      CI_STUB_MARKER: path.join(stubDir, "explain-moved.marker"),
    });
    const cache = readCache(cacheFile);
    cache.stages.preflight.hash = "0".repeat(64);
    writeFileSync(cacheFile, JSON.stringify(cache), "utf8");

    const result = runCi(["--explain-cache", "--only=preflight"], env);

    expect(result.stdout).toContain("run       — its recorded digest differs — an input changed");
  });

  it("explains a run, an unchanged skip and an exclusion apart", () => {
    const result = runCi([
      "--explain-cache",
      "--only=lint,preflight,mutation",
      "--skip=mutation",
      "--changed-only",
    ], {
      CI_LINT_SCRIPT: writeStub("explain-changed-lint.mjs", PASSING_LINT),
      CI_CACHE_FILE: freshCachePath(),
      // Feeds the lint globs and nothing the preflight reads.
      CI_CHANGED_FILES: "src/lib/foo.ts",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ci: cache — 2 selected stage(s), cap 7d, ");
    expect(result.stdout).toContain("run       — no recorded pass for these inputs");
    expect(result.stdout).toContain("unchanged — no changed file feeds it");
    expect(result.stdout).toContain("excluded  — --skip asked for it");
  });

  it("redacts secret-looking inputs so the explanation is safe to publish", () => {
    const result = runCi(["--explain-cache", "--only=preflight"], {
      CI_CACHE_FILE: freshCachePath(),
    });

    expect(result.status).toBe(0);
    // The names a `.gitignore` keeps out of the repo never reach the log…
    expect(result.stdout).not.toContain(".env.local");
    expect(result.stdout).not.toContain(".env.example");
    // …but the `<redacted>` marker and the honest file count still tell the truth: the
    // stage's own script as machinery, the six files it reads about the environment and
    // the worker config its `wrangler.*` entry names — an entry that resolved to nothing
    // at all while it read `wrangler.toml`, a spelling this checkout has never had — plus
    // one entry per `.env*` file on disk, read from the tree so a clean checkout (which
    // lacks the developer's `.env.local`) asserts its own honest count.
    expect(result.stdout).toContain("<redacted>");
    expect(result.stdout).toContain(`${6 + envFileCount()} file(s) behind the key`);
    // The header says how much of every key the per-stage lists cannot show.
    expect(result.stdout).toContain("file(s) behind every key");
    // A non-secret input is named exactly as it always was, with the glob that swept it up
    // beside it when the two differ.
    expect(result.stdout).toContain("next.config.mjs ← next.config.*");
  });

  it("reports the same decisions as JSON, with the inputs behind each key", () => {
    const result = runCi(["--explain-cache", "--json", "--only=runbook"]);

    const payload = JSON.parse(result.stdout);
    expect(payload.explainCache).toBe(true);
    expect(payload.gate).toBe("pass");
    expect(payload.cacheTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    const [stage] = payload.stages;
    expect(stage.name).toBe("runbook");
    expect(stage.decision).toBe("run");
    // Every file behind the key, paired with the input that put it there. This stage's inputs
    // are three literal paths, so the pairing hands the same name back — the arrow is for the
    // inputs that are patterns.
    const names = stage.matchedBy.map((pair: { name: string }) => pair.name);
    expect(names).toContain(".freebuff/run.md");
    expect(stage.matchedBy).toHaveLength(3);
    expect(stage.matchedBy.map((pair: { input: string }) => pair.input)).toContain(
      ".freebuff/run.md",
    );
    expect(typeof stage.newestInputMs).toBe("number");
    // The human report stays off stdout when the report is JSON.
    expect(result.stdout).not.toContain("ci: cache —");
  });

  it("re-keys the drift stage on exactly what the pin holds", () => {
    // The stage takes its inputs from the alarm's watch rules, and the property that makes
    // that worth doing is not the shape of a list but a coverage: every file the rules
    // resolve to is behind this stage's key, so a family newly watched — and pinned — cannot
    // have its drift answered from a recorded pass. The check runs against the rules'
    // resolution rather than against a copy of a glob list here, so it cannot be satisfied
    // by editing both sides.
    const result = runCi(["--explain-cache", "--json", "--only=drift"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    const watched = Object.keys(pin([manifestPath()]));

    expect(watched.length).toBeGreaterThan(0);
    const behind = drift.matchedBy.map((pair: { name: string }) => pair.name);
    for (const file of watched) {
      expect(behind, `${file} is pinned but the drift stage does not read it`).toContain(file);
    }
    // And not one file more: the stage reads the pin, not the directories the pin lives in.
    // A `<dir>/*` reading would sweep up the artifacts a run writes and deletes in
    // `.freebuff`, which this stage's key is re-read after its pass to hash. The one file
    // beyond the pin is the pin's own manifest, which the stage loads by path and must
    // therefore be keyed on like any other module it reads.
    expect([...behind].sort()).toEqual([...watched, MANIFEST_FILE].sort());
    expect(drift.inputCount).toBe(watched.length + 1);
  });

  it("keys each stage on the alarm's stage list, in the runner's own order", () => {
    // The whole declaration lives in `.freebuff/gate-drift.mjs` — the `inputs` every stage is cached
    // under, the label it is reported by, the gate script it runs and whether its pass edits the
    // tree — because the alarm reads the same table to name the stage that owns a family in its own
    // report. One declaration is the point, so what has to be held is that the alarm's table *is*
    // this runner's stage list: every stage the runner runs, in the runner's order, and nothing
    // else. The runner maps the table, so a stage it forgot or a reordered list is a load-time
    // refusal rather than a silence; what this holds is the order the *audit* reads and the pass
    // actually takes, which is the one thing the map cannot state on its own.
    const reported = JSON.parse(runCi(["--stages=json"]).stdout) as { stages: string[] };
    expect(STAGE_TABLE.map((stage) => stage.name)).toEqual(reported.stages);
    expect(STAGE_NAMES).toEqual(reported.stages);
    // And every entry is a non-empty list: an emptied one would read as a key that covers nothing
    // while the stage itself, and its report, carried on as before.
    for (const stage of STAGE_TABLE) expect(stage.inputs.length).toBeGreaterThan(0);
  });

  it(
    "spawns the gate script each stage's declaration names, and no other",
    () => {
      // The script a stage runs is declared beside the stage now, in the table — `script: { env, path }`
      // — rather than built inside the run that spawns it, and the env name is the override seam this
      // file's tests drive a stage through. What has to be held is that the two are the same entry: the
      // path a run actually spawns is the declared one, resolved beside `.freebuff`, so a stage can
      // neither grow a second script beside its declaration nor keep one the table does not name. The
      // two stages that run a published tool declare none, which is the other half of the claim.
      for (const stage of STAGE_TABLE) {
        const reported = JSON.parse(
          runCi(["--explain-cache", "--json", `--only=${stage.name}`]).stdout,
        ).stages[0];
        expect(reported.name).toBe(stage.name);
        expect(reported.script).toBe(
          stage.script === undefined
            ? undefined
            : `.freebuff/${stage.script.path.replace(/^\.\//, "")}`,
        );
      }
    },
    // Nine sequential spawns of the real runner — one per stage — at ~3s of node
    // start-up each. The default 5s test timeout assumes a quiet box; this checkout is
    // routinely shared, and a concurrent sweep's load was pushing the ninth spawn past
    // it. The case holds a fact per stage, not a speed, so the budget is the spawn
    // count, not the machine's best day.
    120_000,
  );

  it("keeps the redaction in the JSON report as well as the human line", () => {
    const result = runCi(["--explain-cache", "--json", "--only=preflight"], {
      CI_CACHE_FILE: freshCachePath(),
    });

    const payload = JSON.parse(result.stdout);
    const [stage] = payload.stages;
    expect(stage.name).toBe("preflight");
    const names = stage.matchedBy.map((pair: { name: string }) => pair.name);
    // No secret-looking name survives into the machine-readable report…
    expect(names.some((name: string) => name.startsWith(".env"))).toBe(false);
    expect(names).toContain("<redacted>");
    // …but the count is the honest one — the six the check reads about the environment, the
    // script it runs, and the worker config its `wrangler.*` entry names — plus one entry per
    // `.env*` file on disk, read here because a clean checkout has one fewer — and the rest of
    // the names are intact.
    expect(stage.inputCount).toBe(6 + envFileCount());
    expect(names).toContain("next.config.mjs");
    expect(names).toContain("package.json");
    expect(names).toContain(".freebuff/preview-preflight.mjs");
    // And a name redacted *per entry* still carries the input it matched, which is the half a
    // collapsed marker would have thrown away.
    expect(stage.matchedBy).toContainEqual({ name: "next.config.mjs", input: "next.config.*" });
  });

  it("says which watch rule put each file behind the drift stage's key", () => {
    // A list of names behind one key answers "which files?" and leaves "which family?"
    // unanswered — and for this stage the names do not even fit on the line. So every file is
    // paired with the rule that matched it, and where the names will not fit the human line
    // counts the rules instead: the answer to "what re-keyed this stage?" rather than a
    // roster of thirty-six files. Both the rule and its file count come from the declaration
    // and from the pin's own resolution of it, so a rule that changed shape fails here rather
    // than agreeing with a copy of itself in this test.
    const label = (rule: { dir: string; pattern: string }) =>
      rule.dir === "." ? rule.pattern : `${rule.dir}/${rule.pattern}`;
    const claiming = DEFAULT_WATCHES.find(
      (candidate: { dir: string; pattern: string }) =>
        candidate.dir === ".freebuff" && new RegExp(candidate.pattern).test("ci.mjs"),
    ) as { dir: string; pattern: string } | undefined;
    expect(claiming, "no watch rule claims .freebuff/ci.mjs").toBeDefined();
    const rule = claiming as { dir: string; pattern: string };

    const json = runCi(["--explain-cache", "--json", "--only=drift"]);
    const drift = JSON.parse(json.stdout).stages.find(
      (stage: { name: string }) => stage.name === "drift",
    );

    // Every file is attributed, and every attribution is one of the stage's declared inputs:
    // the watch rules, plus the pin's manifest, which is named as a path because no rule covers
    // it and the stage nonetheless reads it.
    const rules = new Set([
      ...DEFAULT_WATCHES.map((candidate: { dir: string; pattern: string }) => label(candidate)),
      MANIFEST_FILE,
    ]);
    expect(drift.matchedBy.length).toBeGreaterThan(0);
    for (const pair of drift.matchedBy as { name: string; input: string }[]) {
      expect(rules, `${pair.name} is behind the key with no rule to blame`).toContain(pair.input);
    }
    // The one file whose family is not in doubt, named.
    const pair = (drift.matchedBy as { name: string; input: string }[]).find(
      (entry) => entry.name === ".freebuff/ci.mjs",
    );
    expect(pair?.input).toBe(label(rule));

    const human = runCi(["--explain-cache", "--only=drift"]);
    const line =
      human.stdout.split("\n").find((row) => row.includes("file(s) behind the key")) ?? "";
    const expected = Object.keys(pin([manifestPath()], [rule])).length;
    expect(expected).toBeGreaterThan(0);
    expect(line).toContain(`${label(rule)} ×${expected}`);
    expect(line, "the names do not fit, so the line gives the families").not.toContain(
      ".freebuff/apply-collect-baselines.mjs",
    );
  });

  it("names the family member behind a named stage's key, the sibling the refusal would offer", () => {
    // The refusal names a stage and a file only when a rule has lost a member; this is the same
    // pairing asked of a *stage*, on a tree where nothing is uncovered — which family does this
    // key already hold, and which member of it earned the pairing? Recomputed from the rules'
    // own resolution and the stage's own report, so the two cannot agree by sharing a copy: the
    // rules are `DEFAULT_WATCHES`, the members come from `pin`, the files behind the key come
    // from the stage's `matchedBy`, and a file two rules match belongs to the first that claims
    // it — the first-match-wins `ruleOwners` uses, which is what stops this from passing on a
    // reading the runner does not hold. `row.keys` counts a stage's own `inputs` and not
    // `GLOBAL_FORCE`, so the same is true here: a family is what the stage itself names.
    const label = (rule: { dir: string; pattern: string }) =>
      rule.dir === "." ? rule.pattern : `${rule.dir}/${rule.pattern}`;
    const membersByRule = DEFAULT_WATCHES.map((rule: { dir: string; pattern: string }) => ({
      label: label(rule),
      members: new Set(Object.keys(pin([manifestPath()], [rule]))),
    }));

    const payload = JSON.parse(runCi(["--explain-cache", "--json"]).stdout);
    const stages = payload.stages as {
      name: string;
      matchedBy?: { name: string }[];
      families?: { rule: string; via: string }[];
    }[];

    let familiesSeen = 0;
    for (const stage of stages) {
      const owned = new Map<string, string>();
      for (const { name } of stage.matchedBy ?? []) {
        const claim = membersByRule.find((rule) => rule.members.has(name));
        if (claim) owned.set(name, claim.label);
      }
      const grouped = new Map<string, string[]>();
      for (const [file, rule] of owned) {
        grouped.set(rule, [...(grouped.get(rule) ?? []), file]);
      }
      const expected = [...grouped]
        .map(([rule, files]) => ({
          rule,
          via: [...files].sort((left, right) => left.localeCompare(right))[0],
        }))
        .sort((left, right) => left.rule.localeCompare(right.rule));
      expect(
        stage.families ?? [],
        `${stage.name}'s families are not the rules its key already holds`,
      ).toEqual(expected);
      familiesSeen += (stage.families ?? []).length;
    }
    // Not vacuous: the live tree keys stages onto the families its rules resolve to.
    expect(familiesSeen).toBeGreaterThan(0);

    // And the `via` is the sibling itself — a file behind that stage's own key, not merely one
    // in the family. This is the half the refusal's sentence rests on, printed on its own line
    // for a stage the reader names rather than waits to see fail.
    const runbook = stages.find((stage) => stage.name === "runbook") as {
      matchedBy: { name: string }[];
      families: { rule: string; via: string }[];
    };
    const family = runbook.families.find((entry) => entry.rule.includes("runbook-contents"));
    expect(family, "the runbook stage keys no family").toBeDefined();
    expect(runbook.matchedBy.map((pair) => pair.name)).toContain(family?.via);

    const human = runCi(["--explain-cache", "--only=runbook"]);
    const line = human.stdout.split("\n").find((row) => row.includes("↳")) ?? "";
    expect(line).toContain(`↳ ${family?.rule} via ${family?.via}`);
  });

  it("carries each gate's import closure beside its key, on the line and in the JSON", () => {
    // The key folds the gate's modules in by construction (`stageKeyFiles`); this is the
    // reporting half of that fold — a reader of `--explain-cache` sees the machinery a key
    // is made of without opening the script. The list is recomputed here from the same
    // walker the runner uses, so the report cannot name a set the key does not hold, and
    // the stage's own script is excluded: it is the row the stage already declares.
    const payload = JSON.parse(runCi(["--explain-cache", "--json"]).stdout);
    const stages = payload.stages as {
      name: string;
      script?: string;
      imports?: string[];
      matchedBy?: { name: string; input?: string }[];
    }[];
    const runbook = stages.find((stage) => stage.name === "runbook");
    expect(runbook?.script).toBe(".freebuff/build-contents.mjs");
    const read = (name: string) => {
      try {
        return readFileSync(path.join(projectRoot, name), "utf8");
      } catch {
        return undefined;
      }
    };
    const closure = [...importClosure(".freebuff/build-contents.mjs", read)]
      .filter((name) => name !== ".freebuff/build-contents.mjs")
      .sort((left, right) => left.localeCompare(right));
    // The real runbook gate is a two-module chain — nothing deeper — so the report has
    // exactly one module to name, and it names exactly that.
    expect(closure).toEqual([".freebuff/runbook-contents.mjs"]);
    expect(runbook?.imports).toEqual(closure);

    // The pairs and the whole-list field are two renderings of one key: every module the
    // `imports` field names must also sit behind the key the pairs describe. (The `imports
    // of …` label is the fallback for a closure module no input names — on this tree the
    // family rule sweeps the runbook helper, so the pair carries the rule's label.)
    const pairNames = new Set((runbook?.matchedBy ?? []).map((pair) => pair.name));
    for (const name of runbook?.imports ?? []) {
      expect(pairNames.has(name), `${name} is named as imports but behind no key`).toBe(true);
    }

    // The human line says it on a continuation of the stage's own row, under the family
    // pairing the `↳` line carries — indented past the name column like every other
    // continuation of that row, which is the shape this regex pins rather than one width.
    const printed = runCi(["--explain-cache", "--only=runbook"]);
    const importsLine = printed.stdout.split("\n").find((row) => row.includes("⤷ imports"));
    expect(importsLine).toMatch(/^ci:\s+⤷ imports \.freebuff\/runbook-contents\.mjs$/);

    // And a single-script stage names no modules: the field is absent, not empty — "nothing
    // to say" stays distinct from "the gate imports nothing".
    expect(stages.find((stage) => stage.name === "preflight")?.imports).toBeUndefined();
  });

  it("keys every script-backed stage on the import closure its gate loads", () => {
    // A stage reused on the strength of a recorded pass is a claim about the machinery that
    // produced that pass. So the gate a stage runs, and every module that gate loads, has to be
    // behind that stage's own key — and since the runner folds the closure in itself, this
    // case now pins the derivation rather than detecting violations: for each declared script,
    // every module the shared walker reaches must be reported behind that stage's key by the
    // runner's own account (`--explain-cache --json`), declared inputs and closure files
    // alike. A closure file the declaration does not name reports the derivation as its
    // input, so the pairing stays honest about what put the file behind the key.
    const result = runCi(["--explain-cache", "--json"]);
    const payload = JSON.parse(result.stdout);
    const global = new Set<string>(payload.globalForce ?? []);
    const behind = (stage: { matchedBy?: { name: string }[] }) =>
      new Set<string>([...global, ...(stage.matchedBy ?? []).map((pair) => pair.name)]);

    const declared = payload.stages.filter(
      (stage: { script?: string }) => typeof stage.script === "string",
    );
    // Every gate-backed stage declares one, and these are they: the two that do not run a
    // published tool (`tsc`, `vitest`) whose machinery the lockfile in `GLOBAL_FORCE` pins, and
    // a stage that stopped declaring its script would otherwise pass this by being absent.
    expect(declared.map((stage: { name: string }) => stage.name)).toEqual([
      "runbook",
      "lint",
      "preflight",
      "drift",
      "mutation-example",
      "mutation-fifth",
      "mutation-coverage",
      "mutation-preflight",
      "mutation",
    ]);

    const read = (name: string) => {
      try {
        return readFileSync(path.join(projectRoot, name), "utf8");
      } catch {
        return undefined;
      }
    };
    for (const stage of declared) {
      const own = behind(stage);
      const modules = [...importClosure(stage.script, read)];
      // The walk always reaches the script it started from, so this cannot pass on an empty set.
      expect(modules, `${stage.name} declares a script that is not on disk`).toContain(
        stage.script,
      );
      for (const loaded of modules) {
        expect(
          own,
          `${loaded} is read by the ${stage.name} stage and behind none of its key`,
        ).toContain(loaded);
      }
    }

    // The pin's manifest is loaded by path (`import(pathToFileURL(manifest))`), so no walk from
    // the script that loads it can see it — and it is the one file here that no watch rule
    // names either, because a manifest that pinned itself could never be rewritten. Checked by
    // name for exactly that reason: a hand-edited pin has to re-key the check that reads it.
    const drift = payload.stages.find((stage: { name: string }) => stage.name === "drift");
    expect(behind(drift)).toContain(MANIFEST_FILE);
  });

  it("holds every pinned gate file behind some stage's key, or records it as exempt", () => {
    // The hole this closes is the one the cache cannot report on its own: a gate file no
    // stage's inputs name is behind no key, so a change to it would leave every stage
    // reusable and the cache would vouch for a tree nothing measured. Both halves of a key
    // are counted — the files each stage's own `inputs` match, and the `GLOBAL_FORCE` files
    // that sit behind every key — and both are read from the runner's own report rather than
    // re-derived here, so a change to how a file is matched cannot leave this test asserting
    // a rule the runner has stopped following.
    const result = runCi(["--explain-cache", "--json"]);
    const payload = JSON.parse(result.stdout);

    const behind = new Set<string>(payload.globalForce ?? []);
    const declared = new Set<string>();
    for (const stage of payload.stages) {
      for (const pair of stage.matchedBy ?? []) {
        behind.add(pair.name);
        declared.add(pair.name);
      }
    }
    // Neither half is empty, so the check below is not passing on a set built from nothing.
    // The pin is covered today by the stage that follows it, which is why the declaration
    // above is empty; the global half is what would cover a file no stage named.
    expect(payload.globalForce.length).toBeGreaterThan(0);
    expect(declared.size).toBeGreaterThan(payload.globalForce.length);

    const pinned = Object.keys(pin([manifestPath()]));
    expect(pinned.length).toBeGreaterThan(0);

    // The exemptions are the runner's own declaration, read from its report rather than kept
    // here: the run refuses to start on a pinned file no key covers *unless* the file is in
    // that map, so a copy in the test could disagree with the gate about what is excused — and
    // asking the runner is what makes the agreement checkable, since the case below holds the
    // run to exactly this map.
    const status = JSON.parse(runCi(["--status", "--json"]).stdout) as {
      exempt: Record<string, string>;
    };
    for (const file of pinned) {
      if (file in status.exempt) continue;
      expect(behind, `${file} is pinned and behind no stage's key`).toContain(file);
    }
    // An exemption is a decision rather than a backlog: it has to be about a file the pin
    // still holds, it has to be doing something, and it has to say what it is for.
    for (const [file, reason] of Object.entries(status.exempt)) {
      expect(pinned, `${file} is exempt but the pin no longer holds it`).toContain(file);
      expect(behind, `${file} is exempt and behind a key anyway`).not.toContain(file);
      expect(reason.trim(), `${file} is exempt without a reason`).not.toBe("");
    }
  });

  it("reports the GLOBAL_FORCE entries that match no file, and only the ones declared contingent", () => {
    // A glob that matches nothing re-keys nothing, and nothing about it says so — which is how
    // the entry for the worker's own config sat behind `wrangler.toml`, a file this repo has
    // never had, for as long as it has had `wrangler.jsonc`. Both halves are read from the
    // runner's own report rather than re-derived here: the entries that resolved to no file, and
    // the declaration of the ones allowed not to. The declaration is the whole point — an entry
    // may be dead only if somebody wrote down why — so this fails on a dead entry that is not
    // declared, on a declared entry that has started resolving (an exemption that outlived its
    // reason is exactly where the next stale spelling hides), and on a reason that is not one.
    const payload = JSON.parse(runCi(["--explain-cache", "--json"]).stdout) as {
      globalForce: string[];
      globalForceAbsent: string[];
      globalForceContingent: Record<string, string>;
    };
    const human = runCi(["--explain-cache", "--only=runbook"]);

    // The resolved half is not empty, so the equality below is not two empty sets agreeing.
    expect(payload.globalForce.length).toBeGreaterThan(0);
    expect(payload.globalForceAbsent).toEqual(Object.keys(payload.globalForceContingent));
    // Named, so the declaration cannot be emptied to make that equality true — and the human form
    // says the same thing, which is where a reader looking up "what is behind every key?" sees it.
    expect(Object.keys(payload.globalForceContingent)).toEqual(["npm-shrinkwrap.json"]);
    for (const [pattern, reason] of Object.entries(payload.globalForceContingent)) {
      expect(reason.trim(), `${pattern} is declared contingent without a reason`).not.toBe("");
    }
    expect(human.stdout).toContain("npm-shrinkwrap.json matches no file here — declared contingent");
    // And the fix for an undeclared one is not the same sentence, so a reader is never told a dead
    // entry is fine: the two forms are told apart by the decision, not by the count.
    expect(human.stdout).not.toContain("is not declared contingent");
  });

  it("reports the stage inputs that match no file, and only the ones declared contingent", () => {
    // The same lie as a dead `GLOBAL_FORCE` entry, one scope down: a stage `inputs` entry that
    // matches no file keys nothing, so the stage goes on being reusable across a change to the
    // very spelling the entry was written to catch — and nothing on the row says so. The
    // distinction the declaration draws is contingency versus leftover: an extension family the
    // stage's tool would read the moment such a file appears is declared, while `wrangler.toml`
    // (a spelling this checkout stopped having when it moved to `wrangler.jsonc`) and `**/*.jsx`
    // (an extension this `eslint.config.mjs` does not lint at all) left the lists they were in
    // rather than being excused in place. Read from the runner's own report in both directions,
    // so a dead entry that is not declared is red, an exemption that has started resolving is red
    // for the same reason, and the stage that keyed nothing through it is named.
    const payload = JSON.parse(runCi(["--explain-cache", "--json"]).stdout) as {
      stages: { name: string; deadInputs?: string[] }[];
      inputContingent: Record<string, string>;
    };

    const dead = new Map<string, string[]>();
    for (const stage of payload.stages) {
      for (const label of stage.deadInputs ?? []) {
        dead.set(label, [...(dead.get(label) ?? []), stage.name]);
      }
    }
    const declared = Object.keys(payload.inputContingent);

    // Neither half is empty, so the equality below is not two empty sets agreeing — and the stage
    // travels with the entry, because "which stage is keying nothing through this" is the half a
    // reader can act on: the fix is a stage's `inputs`, not a list somewhere.
    expect(declared.length).toBeGreaterThan(0);
    expect(dead.size).toBeGreaterThan(0);
    expect([...dead.keys()].sort()).toEqual([...declared].sort());
    // Named, so the declaration cannot be emptied to make that equality true.
    expect([...dead.keys()].sort()).toEqual([
      "**/*.cjs",
      "**/*.cts",
      "**/*.mts",
      "npm-shrinkwrap.json",
    ]);
    expect(dead.get("npm-shrinkwrap.json")).toEqual(["preflight"]);
    for (const [label, reason] of Object.entries(payload.inputContingent)) {
      expect(reason.trim(), `${label} is declared contingent without a reason`).not.toBe("");
    }

    // The human form says the same on the stage's own row, which the head's global-force line
    // cannot: `--only=typecheck` selects a stage whose dead entries are *not* that one, and the
    // `✗` mark is what makes the line the stage's rather than the head's.
    const human = runCi(["--explain-cache", "--only=typecheck"]);
    expect(human.stdout).toContain("✗ **/*.mts matches no file here — declared contingent");
    // And the fix for an undeclared one is not the same sentence, so a reader is never told a dead
    // entry is fine: the two forms are told apart by the decision, not by the count.
    expect(human.stdout).not.toContain("is not declared contingent");
  });

  it("explains that the cache is off under --no-cache", () => {
    const result = runCi(["--explain-cache", "--no-cache", "--only=runbook"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("cap 7d, cache off");
    expect(result.stdout).toContain("run       — the cache is off (--no-cache)");
    // There is no key for `GLOBAL_FORCE` to be behind, so the header does not claim one —
    // and no stage is reported as having files behind a key either.
    expect(result.stdout).not.toContain("behind every key");
  });

  it("refuses --explain-cache together with --dry-run", () => {
    const result = runCi(["--explain-cache", "--dry-run"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--explain-cache and --dry-run both report and exit — pass only one",
    );
  });
});

/**
 * The refusal a truncated stage script earns. A script cut off mid-expression is a file node
 * refuses, and every stage that touches it reports a *different* failure for it — the lint stage a
 * finding in a file it never linted, the gate that runs it a killed process with no JSON, the
 * suite whose subject never loaded a wall of assertion failures, the drift alarm a pin that moved —
 * so the run asks node itself, before any stage, and names the file and the parser's own line
 * instead of the four consequences.
 *
 * Driven through the stage's own `CI_PREFLIGHT_SCRIPT` stub, which is also what scopes the guard:
 * it reads the script the selected stage is about to spawn, so the stub stands in for the guard
 * exactly as it stands in for the stage, and a real run with no stub is the one that reads
 * `.freebuff/preview-preflight.mjs`. That is the property worth holding: a narrowed run, and a
 * suite that stubs the stage it exercises, are not refused over a file they will never run.
 */
describe("the CI runner's read of a stage script it cannot parse", () => {
  let fixtureDir = "";
  let broken = "";

  beforeAll(() => {
    fixtureDir = makeScratchDir("ci-parse-guard-");
    broken = path.join(fixtureDir, "broken.mjs");
    writeFileSync(
      broken,
      [
        "const warnings = [];",
        "console.log(",
        "  `value ${warnings.length > 0 ? `, ${warnings.length} warning(s)` : \"\"",
        ");",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterAll(() => {
    removeScratchDir(fixtureDir);
  });

  it("refuses before any stage, naming the file node refuses and the parser's line", () => {
    const result = runPreflightStage(broken);
    expect(result.status).toBe(1);
    // One sentence and the one file, rather than a lint finding in it and three other stages
    // reporting the same truncated write as four unrelated regressions.
    expect(result.stderr).toContain("1 stage script(s) cannot be parsed");
    expect(result.stderr).toContain("broken.mjs:3 (SyntaxError: Missing } in template expression)");
    expect(result.stderr).toContain("last copy is under `.ci/gate-content`");
    // Before any stage: the refusal replaces the run rather than sitting beside one that ran.
    expect(result.stdout).not.toContain("── preview preflight ──");
  });

  it("carries the file, the line and the parser's message on the refusal's payload", () => {
    const result = runPreflightStage(broken, ["--json"]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      gate: string;
      unparsable: { file: string; line: number; message: string }[];
    };
    expect(report.gate).toBe("fail");
    expect(report.unparsable).toHaveLength(1);
    expect(report.unparsable[0].line).toBe(3);
    expect(report.unparsable[0].message).toBe("SyntaxError: Missing } in template expression");
    // The name is the run's own spelling — project-relative, so a stub outside the checkout
    // reads as the relative path it is rather than as a path a test may write down.
    expect(report.unparsable[0].file.endsWith("broken.mjs")).toBe(true);
  });
});

describe("the CI runner's pinned-file coverage gate", () => {
  /**
   * The invariant the suite states and the run now enforces: a pinned gate file no stage's key
   * covers can be answered from a pass recorded before it changed, so the run refuses to start
   * rather than hand back a verdict it cannot stand behind. Driven through the alarm's own
   * `GATE_HASHES_FILE` seam, which names a whole other pin — rules and all — so the fixture can
   * watch two families nothing else covers: a `.json` under `.freebuff`, an extension no stage's
   * `inputs` match and `GLOBAL_FORCE` does not carry, and a family that is only half a gap on
   * purpose — a rule pinning `.freebuff/run.md`, which the runbook stage keys, beside a `.md` it
   * does not — so the refusal has to name the stage that should take the lost file *and* the file
   * already behind that stage's key that earned it, and decline to name either for the family
   * nothing keys.
   */
  it("refuses to start on a pinned gate file that is behind no stage's key", () => {
    const probe = path.join(projectRoot, ".freebuff", "ci-coverage-probe.json");
    const sibling = path.join(projectRoot, ".freebuff", "run-probe.md");
    const fixture = path.join(stubDir, "coverage-gap-fixture.mjs");
    // No stub and no marker: the refusal fires before any stage runs, so the run proves
    // nothing ran by refusing — and the runbook stage keeps its real gate, whose import
    // closure (build-contents.mjs → runbook-contents.mjs) is what the refusal's sentence
    // and rows now name beside the sibling.

    try {
      writeFileSync(probe, "{}\n", "utf8");
      writeFileSync(sibling, "# a probe\n", "utf8");
      const watches = [
        ...DEFAULT_WATCHES,
        { dir: ".freebuff", pattern: "^ci-coverage-probe\\.json$" },
        // The half-gap family: `run.md` is behind the runbook stage's `inputs`, so this rule
        // loses exactly one of the two files it pins and the stage that keeps the other is the
        // stage the lost one should have been named in.
        { dir: ".freebuff", pattern: "^run(-probe)?\\.md$" },
      ];
      writeFileSync(
        fixture,
        renderManifest({ algorithm: "sha1", watches, files: pin([], watches) }),
        "utf8",
      );

      // The two reporting paths still answer, and they are where a reader finds this: the map
      // names the file it could not place, which is what makes the refusal actionable.
      const dry = runCi(["--dry-run", "--only=runbook"], { GATE_HASHES_FILE: fixture });
      expect(dry.status).toBe(0);
      const human = runCi(["--status"], { GATE_HASHES_FILE: fixture });
      expect(human.stdout).toContain("NO KEY");
      // The row says which rule pinned the file, in the shape a reader can hold against
      // `watches` — the fix is written against the family, and the pin is what knows it. The
      // columns are padded to the longest label, so the row is matched rather than counted out.
      // This family is behind no stage at all, so no stage is named beside it.
      expect(human.stdout).toMatch(
        /NO KEY\s+\.freebuff\/ci-coverage-probe\.json\s+← \.freebuff\/\^ci-coverage-probe\\\.json\$/,
      );
      // The other family lost a file a stage keys, so the stage to edit is on the row too, with
      // the file of that family that earned it: the runbook stage already names `run.md`, and
      // the file the rule lost belongs beside it — the same pairing the refusal makes. The rule
      // label ends in `$`, so the row is matched through it rather than anchored at it.
      expect(human.stdout).toMatch(
        /NO KEY\s+\.freebuff\/run-probe\.md\s+← \.freebuff\/\^run\(-probe\)\?\\\.md\$ → runbook \(via \.freebuff\/run\.md\)/,
      );
      const status = JSON.parse(
        runCi(["--status", "--json"], { GATE_HASHES_FILE: fixture }).stdout,
      );
      const row = status.coverage.find(
        (entry: { file: string }) => entry.file === ".freebuff/ci-coverage-probe.json",
      );
      expect(row).toEqual({
        file: ".freebuff/ci-coverage-probe.json",
        rule: ".freebuff/^ci-coverage-probe\\.json$",
        keys: [],
        everyKey: false,
        exempt: null,
        suggested: null,
        suggestedBy: null,
      });
      // …and the family that lost one file points at the stage keeping the rest — and at the
      // file keeping it, which is the half that turns "add it to the runbook stage" into a
      // stage and a sibling to put it beside.
      const mate = status.coverage.find(
        (entry: { file: string }) => entry.file === ".freebuff/run-probe.md",
      );
      expect(mate.suggested).toBe("runbook");
      expect(mate.suggestedBy).toBe(".freebuff/run.md");

      // The same rows grouped by the rule that pinned them, which is where the *shape* of this
      // pin shows rather than its rows: both probe families are half held, so they lead the
      // block, and the one no stage keys carries no stages at all rather than a stage that does
      // not hold it.
      const probed = (
        status.families as {
          rule: string;
          members: number;
          stages: { name: string; count: number }[];
          unkeyed: number;
          exposed: boolean;
          owner: { stage: string; via: string; whole: boolean } | null;
        }[]
      ).filter(
        (family) =>
          family.rule.includes("ci-coverage-probe") || family.rule.includes("run(-probe)"),
      );
      // Both are also *exposed*: no stage but the pin's own `drift` re-key holds either whole —
      // the `.json` family nothing keys at all, and the half-held `.md` family whose other member
      // sits alone behind `runbook` — so a new member of either would be read by nothing but the
      // check that already watches the pin. That is the marker this block exists for, and it is
      // true here even though neither family has a *stage* that holds all of it.
      // …and the repair each of them now carries, which is the same clause a red drift's family
      // headings print: the `.json` family no stage keys is honestly ownerless — a stage to name it
      // in does not exist to be named — while the half-held `.md` family points at the stage
      // keeping its other member, and at that member, so the fix reads as a stage to extend and a
      // sibling to extend it with. Both come from the same rows as the counts above, so the
      // family, its members and its owner cannot be read apart.
      expect(probed).toEqual([
        {
          rule: ".freebuff/^ci-coverage-probe\\.json$",
          members: 1,
          stages: [],
          unkeyed: 1,
          exposed: true,
          owner: null,
        },
        {
          rule: ".freebuff/^run(-probe)?\\.md$",
          members: 2,
          stages: [{ name: "runbook", count: 1 }],
          unkeyed: 1,
          exposed: true,
          owner: { stage: "runbook", via: ".freebuff/run.md", whole: false },
        },
      ]);
      // Unkeyed first is what makes that shape visible before the rows are read.
      expect(
        (status.families as { unkeyed: number }[])
          .slice(0, 2)
          .every((family) => family.unkeyed > 0),
      ).toBe(true);
      // And the human form says it in words rather than leaving an empty stage list to interpret,
      // with the exposure named on the row rather than left for a reader to work out from the
      // counts.
      expect(human.stdout).toContain("family coverage — ");
      expect(human.stdout).toContain("no stage holds any of them");
      expect(human.stdout).toContain("1 behind no stage's key");
      expect(human.stdout).toContain("; a new member would be held by drift alone");
      // …and the repair is on the row in the same words a red drift's headings use, so the green
      // tree names the stage to widen rather than leaving the reader to infer one from the counts —
      // or to discover it only once a member has already fallen out of every key.
      expect(human.stdout).toContain("no stage keys it; name it in a stage's `inputs`");
      expect(human.stdout).toContain(
        "extend the runbook stage, which already keys .freebuff/run.md",
      );

      // The run refuses before any stage, naming the file and the fix rather than running
      // anyway: nothing was measured for it, and the refusal replaces the run rather than
      // sitting beside one that ran.
      const refused = runCi(["--only=runbook"], { GATE_HASHES_FILE: fixture });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("2 pinned gate file(s) are behind no stage's key");
      // The file, the rule that pinned it, the stage to edit *and* the sibling that earned the
      // stage, in one clause: "name it in a stage's inputs" is only actionable once all of those
      // are on the line, and the rule alone leaves the reader to work out which stage reads that
      // family. Where the family points at no stage, the refusal says that rather than guessing
      // one, and names no sibling either.
      expect(refused.stderr).toContain(
        ".freebuff/ci-coverage-probe.json (pinned by .freebuff/^ci-coverage-probe\\.json$; no stage keys anything this rule pins)",
      );
      // …and the gate's own machinery rides on the sentence: the modules the import closure
      // folds into the runbook key are the half the pasted `inputs` line will not carry, so
      // the reader sees the full key the stage keeps without opening the script. The script
      // itself is not on the list — it is a declared `input` the paste already carries — so
      // the imports are exactly the one helper beside it.
      expect(refused.stderr).toContain(
        ".freebuff/run-probe.md (pinned by .freebuff/^run(-probe)?\\.md$; add it to the runbook stage, which already keys .freebuff/run.md and imports .freebuff/runbook-contents.mjs)",
      );
      expect(refused.stderr).toContain("KEY_EXEMPT_PINNED");
      // And the edit itself, not only the stage to make it in: the alarm's own stage-table entry —
      // the whole entry, every field it declares, with the file appended to its `inputs` in the
      // order the declaration holds them — so the repair is a line to paste rather than a stage to
      // go find, and pasting it cannot drop the label or the script the entry carries: in
      // `.freebuff/gate-drift.mjs`, where the stage is declared and the alarm reads the same table
      // to name a family's owner. Only the row with a stage gets one — the family nothing keys has
      // no line to edit, and is absent here rather than sent to an invented stage.
      expect(refused.stderr).toContain(
        "repair — the stage's entry in .freebuff/gate-drift.mjs with the file appended:",
      );
      expect(refused.stderr).toContain(
        '{ name: "runbook", label: "runbook contents", script: { env: "CI_RUNBOOK_SCRIPT", path: "./build-contents.mjs" }, inputs: [".freebuff/run.md", ".freebuff/build-contents.mjs", ".freebuff/runbook-contents.mjs", ".freebuff/run-probe.md"] },',
      );
      // Exactly one line, so the family nothing keys is left to the sentence above rather than
      // sent to some invented stage: a second line here is the refusal guessing.
      const repairSection = refused.stderr.split("repair — ")[1] ?? "";
      expect(repairSection.split("\n").filter((row) => row.includes("inputs: ["))).toHaveLength(1);
      // The appended declaration stays the whole paste: the stage's declared `inputs` with the
      // file appended and nothing else — the machinery the sentence names is never folded into
      // the array, which is what would turn this repair back into the hand-maintained list the
      // import closure exists to retire. Four entries: the three the stage already declared,
      // plus the file the rule lost.
      const declarationLine =
        repairSection.split("\n").find((row) => row.includes("inputs: [")) ?? "";
      expect(declarationLine.match(/"\.freebuff\//g) ?? []).toHaveLength(4);

      // …and the `--json` report carries the file and the stage's machinery, so a job does
      // not have to parse a sentence: `imports` is the same module list the sentence names,
      // null with no stage, matching the sibling and the paste in kind.
      const json = JSON.parse(
        runCi(["--only=runbook", "--json"], { GATE_HASHES_FILE: fixture }).stdout,
      );
      expect(json.gate).toBe("fail");
      expect(json.uncovered).toEqual([
        {
          file: ".freebuff/ci-coverage-probe.json",
          rule: ".freebuff/^ci-coverage-probe\\.json$",
          stage: null,
          via: null,
          repair: null,
          imports: null,
        },
        {
          file: ".freebuff/run-probe.md",
          rule: ".freebuff/^run(-probe)?\\.md$",
          stage: "runbook",
          via: ".freebuff/run.md",
          repair:
            '{ name: "runbook", label: "runbook contents", script: { env: "CI_RUNBOOK_SCRIPT", path: "./build-contents.mjs" }, inputs: [".freebuff/run.md", ".freebuff/build-contents.mjs", ".freebuff/runbook-contents.mjs", ".freebuff/run-probe.md"] },',
          // Beside the script, which the paste's own `inputs` already carry.
          imports: [".freebuff/runbook-contents.mjs"],
        },
      ]);
    } finally {
      rmSync(probe, { force: true });
      rmSync(sibling, { force: true });
    }
  });
});

describe("the CI runner's --status report", () => {
  /**
   * `npm run gates:status` answers "where am I" for a pin: the alarm's own one-line state of
   * it, followed by the half only the runner can answer — which stage's key is behind each
   * pinned file. The line is passed through rather than rebuilt (the alarm writes it, and a
   * second rendering here could disagree with the one that also stands in for `gates:drift`),
   * and the coverage is asked of the declarations, so it describes the *pin* rather than the
   * tree a run happened to see.
   */
  it("prints the alarm's own line, and answers with the alarm's exit code", () => {
    const passing = writeStub(
      "status-alarm-ok.mjs",
      [
        "if (!process.argv.includes('--status')) process.exit(3);",
        "process.stdout.write('gate-status: a sentence only the alarm writes\\n');",
      ].join("\n"),
    );
    const failing = writeStub(
      "status-alarm-bad.mjs",
      [
        "process.stdout.write('gate-status: 2 do not match\\n');",
        "process.exit(1);",
      ].join("\n"),
    );

    const ok = runCi(["--status"], { CI_DRIFT_SCRIPT: passing });
    const bad = runCi(["--status"], { CI_DRIFT_SCRIPT: failing });

    // Whatever the alarm printed is the first thing this command prints, to the byte.
    expect(ok.stdout.split("\n")[0]).toBe("gate-status: a sentence only the alarm writes");
    expect(ok.status).toBe(0);
    // …and its status is this command's status, which is what lets it stand in for `gates:drift`.
    expect(bad.status).toBe(1);
    for (const result of [ok, bad]) {
      // The map is the runner's own addition, so the stub alarm does not remove it…
      expect(result.stdout).toContain("key coverage — which stage's key is behind each pinned file");
      // …and nothing ran: a reading is not a run with a different head.
      expect(result.stdout).not.toContain("── ");
    }
  });

  it("maps each pinned file to the stage keys behind it, and agrees with the keys themselves", () => {
    // Two reports of one fact down two code paths: this one asks the declarations
    // (`pinnedCoverage`), `--explain-cache` asks the keys a run would build (`matchedInputs`).
    // Where every pinned file is present on disk they have to agree, so a stage list that moved
    // — or a map computed from something other than the inputs — fails one of them.
    const human = runCi(["--status"]);
    const status = JSON.parse(runCi(["--status", "--json"]).stdout);
    const explain = JSON.parse(runCi(["--explain-cache", "--json"]).stdout);

    const pinned = Object.keys(pin([manifestPath()]));
    expect(pinned.length).toBeGreaterThan(0);

    // The human form is the alarm's line, a count, and a row per pinned file.
    const [line] = human.stdout.split("\n");
    expect(line.startsWith("gate-status: ")).toBe(true);
    expect(human.stdout).toContain(`(${pinned.length}, fewest keys first`);
    for (const file of pinned) {
      expect(human.stdout, `${file} is pinned and absent from the coverage map`).toContain(file);
    }

    const behind = new Map<string, string[]>();
    for (const stage of explain.stages) {
      for (const pair of stage.matchedBy ?? []) {
        behind.set(pair.name, [...(behind.get(pair.name) ?? []), stage.name]);
      }
    }
    expect(status.coverage).toHaveLength(pinned.length);
    for (const row of status.coverage) {
      expect(
        [...row.keys].sort(),
        `${row.file} is behind a different set of keys in each report`,
      ).toEqual([...(behind.get(row.file) ?? [])].sort());
    }
    // Fewest keys first, so the thinnest coverage — the file whose change re-runs the least —
    // is read first.
    const counts = status.coverage.map((row: { keys: string[] }) => row.keys.length);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));

    // The two shapes a reader acts on. A file behind one key and behind no stage's `inputs` at
    // all: the pin's compiler config, which is covered only because `GLOBAL_FORCE` re-keys every
    // stage. And a file the gate that runs it names, which is what the machinery invariant asks
    // for — `preview-preflight.mjs` was behind no part of the preflight's key until it was.
    const alone = status.coverage.find((row: { file: string }) => row.file === "tsconfig.json");
    expect(alone.keys).toEqual(["drift"]);
    expect(alone.everyKey).toBe(true);
    // The same shape one family over, and this is the half that was *not* true until the
    // `GLOBAL_FORCE` entry was corrected: it named `wrangler.toml`, a file this repo has never
    // had, so the config that decides what the worker deploys as was behind no stage's inputs
    // and behind no global key — invisible to every cache key at once. The pin is what reports
    // a loosening in it now, and the global entry is what re-runs the other stages when the
    // worker's own bindings move. Asserted positively so the entry cannot go stale again in
    // silence, which is exactly how the old spelling survived — and the same stale spelling sat
    // in the preflight's `inputs`, where nothing compared it to the tree either, so this row has
    // two keys rather than one: the drift stage's watch rule, and the preflight, which judges a
    // dev server whose startup vinext decides partly on a wrangler config *existing*.
    const worker = status.coverage.find(
      (row: { file: string }) => row.file === "wrangler.jsonc",
    );
    expect(worker.keys).toEqual(["preflight", "drift"]);
    expect(worker.everyKey).toBe(true);
    const own = status.coverage.find(
      (row: { file: string }) => row.file === ".freebuff/preview-preflight.mjs",
    );
    expect(own.keys).toContain("preflight");
  });

  it("groups the pin by watch rule, so a family a stage only half holds is visible", () => {
    // The file map answers "is this file watched?" one row at a time. A *family* can be partly
    // held — a stage's inputs name some of the rule's files and not the rest — and that is the
    // shape a new member falls out of, which is why it is worth reading while the tree is green
    // rather than only when the refusal fires — and it is *marked* when no stage but the pin's
    // own `drift` re-key holds the family whole, so the family a widened rule would leave behind
    // nothing but the re-key is a row to act on before a member is left behind every key. It is
    // the same rows grouped, so the case recomputes the grouping from them instead of walking the
    // pin a second time: the aggregation, the per-stage counts, the mark and the order are what
    // this view adds, and the sibling case above already holds `keys` to the keys a run would
    // build.
    const status = JSON.parse(runCi(["--status", "--json"]).stdout);

    const expected = new Map<
      string,
      { members: number; stages: Map<string, number>; unkeyed: number }
    >();
    for (const row of status.coverage as {
      rule: string | null;
      keys: string[];
      everyKey: boolean;
      exempt: string | null;
    }[]) {
      if (row.rule === null) continue;
      const family = expected.get(row.rule) ?? { members: 0, stages: new Map(), unkeyed: 0 };
      family.members += 1;
      for (const key of row.keys) family.stages.set(key, (family.stages.get(key) ?? 0) + 1);
      if (row.keys.length === 0 && !row.everyKey && row.exempt === null) family.unkeyed += 1;
      expected.set(row.rule, family);
    }
    const recomputed = [...expected]
      .map(([rule, family]) => {
        const stages = [...family.stages]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
        return {
          rule,
          members: family.members,
          stages,
          unkeyed: family.unkeyed,
          // The marker's own definition, recomputed from the rows: the pin's `drift` re-key does
          // not count as a stage that *reads* the family, so a family it alone holds whole is the
          // one a new member would join behind nothing else.
          exposed: !stages.some(
            (stage) => stage.name !== "drift" && stage.count === family.members,
          ),
        };
      })
      .sort(
        (left, right) =>
          right.unkeyed - left.unkeyed ||
          Number(right.exposed) - Number(left.exposed) ||
          left.rule.localeCompare(right.rule),
      );
    // The owner — the repair each family now carries — is checked on its own terms below, because a
    // tie between two stages for the most members is broken by declaration order in the runner and
    // cannot be reproduced from the JSON alone. The strict comparison here stays exact for
    // everything else, so the two blocks together pin the whole row.
    expect(
      (status.families as Record<string, unknown>[]).map(({ owner: _owner, ...family }) => family),
    ).toEqual(recomputed);

    // Not vacuous, and the point of the view: on this tree a rule's family is held in part by at
    // least one stage — fewer members behind its key than the rule pins — which is the family a
    // new sibling would land outside of.
    const partial = (status.families as { members: number; stages: { count: number }[] }[]).filter(
      (family) => family.stages.some((stage) => stage.count < family.members),
    );
    expect(partial.length).toBeGreaterThan(0);
    // Every family here is behind some stage's key, so no family is counted whole as missing:
    // the `unkeyed` count is what the refusal names, and it is zero on a tree that runs.
    for (const family of status.families as { members: number; unkeyed: number }[]) {
      expect(family.members - family.unkeyed).toBeGreaterThan(0);
    }

    // …and the mark that fires *before* any of that, the half the refusal can never name: at
    // least one family whose only whole holder is the pin's own re-key, and at least one a stage
    // really does hold whole, so the field is a distinction rather than a constant. The
    // workflows and `tsconfig.json` are the shapes here — no stage measures either, so a new
    // member lands behind `drift` alone — while the coverage-gate family is held whole by a stage
    // that names its members. Asserted both ways on purpose: a marker that never fires would read
    // as a clean tree, and one that always fires would read as no tree worth trusting.
    const exposed = (status.families as { rule: string; exposed: boolean }[]).filter(
      (family) => family.exposed,
    );
    expect(exposed.length).toBeGreaterThan(0);
    expect(exposed.length).toBeLessThan(status.families.length);

    // The human form is the same facts in the same order, family by family.
    const block = runCi(["--status"]).stdout.split("family coverage — ")[1] ?? "";
    expect(block).toContain(`${status.families.length}, `);
    // The mark is on the row in words, so it does not have to be worked out from the counts —
    // and it is *only* on the marked rows, or it would be furniture rather than a warning.
    const rowFor = (rule: string) => block.split("\n").find((row) => row.includes(rule)) ?? "";
    for (const family of exposed) {
      expect(
        rowFor(family.rule),
        `${family.rule} is marked in the JSON but not on its human row`,
      ).toContain("; a new member would be held by drift alone");
    }
    expect(rowFor(".freebuff/^coverage-.*\\.mjs$")).not.toContain(
      "; a new member would be held by drift alone",
    );
    for (const family of status.families as { rule: string; members: number }[]) {
      expect(block, `${family.rule} is missing from the family block`).toContain(family.rule);
      expect(block).toContain(`${family.members} member(s)`);
    }

    // …and the repair each row now carries, in the words a red drift's headings already use —
    // asked of the coverage rows rather than read off the view being checked, so the two cannot be
    // wrong together. What is recomputed here is the invariant every owner satisfies whichever
    // ranking chose it: a stage has to key the family, its `via` has to be a member it keys, and
    // `whole` has to be whether it keys all of them. The ranking itself is the runner's — the stage
    // that *names* the most members with an input scoped to a place, ahead of one that only sweeps
    // the family up with a whole-tree extension glob — and an input's shape is not in the rows the
    // JSON carries, so it is pinned where it is observable instead: the table below, rule by rule.
    const coverageRows = status.coverage as { file: string; rule: string | null; keys: string[] }[];
    const membersByRule = new Map<string, number>();
    const keyedByRule = new Map<string, Map<string, string[]>>();
    for (const row of coverageRows) {
      if (row.rule === null) continue;
      membersByRule.set(row.rule, (membersByRule.get(row.rule) ?? 0) + 1);
      const byStage = keyedByRule.get(row.rule) ?? new Map<string, string[]>();
      for (const name of row.keys) {
        if (name === "drift") continue;
        byStage.set(name, [...(byStage.get(name) ?? []), row.file]);
      }
      keyedByRule.set(row.rule, byStage);
    }
    for (const family of status.families as {
      rule: string;
      owner: { stage: string; via: string; whole: boolean } | null;
    }[]) {
      const byStage = keyedByRule.get(family.rule) ?? new Map<string, string[]>();
      // The row is where a reader acts, so the clause is read off the row rather than off the JSON
      // it was derived from.
      const row = rowFor(family.rule);
      if (family.owner === null) {
        expect(byStage.size, `${family.rule} is ownerless, but a stage keys it`).toBe(0);
        expect(row, `${family.rule} says nothing about who should own it`).toContain(
          "no stage keys it; name it in a stage's `inputs`",
        );
        continue;
      }
      const keyed = byStage.get(family.owner.stage);
      expect(keyed, `${family.rule}'s owner keys none of its members`).toBeDefined();
      expect(keyed).toContain(family.owner.via);
      expect(family.owner.whole).toBe(keyed!.length === membersByRule.get(family.rule));
      expect(row).toContain(
        family.owner.whole
          ? `held by the ${family.owner.stage} stage`
          : `extend the ${family.owner.stage} stage, which already keys ${family.owner.via}`,
      );
    }
    // The specificity rule, pinned on the tree it was written for: a family whose members a scoped
    // stage names is owned by that stage, and the lint stage — whose whole-tree extension sweep
    // holds every `.mjs` file — is named the owner of a `.mjs` family only where nothing else names
    // a member of it at all. The `collect-*` scripts are that fallback: no stage declares them, so
    // the sweep keeps the family it holds, `whole`, rather than the family being called ownerless
    // while the coverage map above says it is covered. `whole` is the difference between "check
    // that stage" and "extend it", so it is part of the pinned answer.
    // Every rule this tree watches today has to keep the owner below; a rule a peer adds is a new
    // family the invariant above still checks, and not this table's business.
    const expectedOwners: Record<string, { stage: string; whole: boolean } | null> = {
      ".github/workflows/^.*\\.ya?ml$": null,
      "^(postcss\\.config\\.mjs|wrangler\\.jsonc)$": { stage: "preflight", whole: false },
      "^(tsconfig.*\\.json|eslint\\.config\\..*)$": { stage: "lint", whole: false },
      ".freebuff/^(build-contents|runbook-contents|lint-baseline|preview-preflight)\\.mjs$": {
        stage: "runbook",
        whole: false,
      },
      ".freebuff/^(ci|comment-gate|gate-drift|redact|nightly-report|pr-comment|import-closure)\\.mjs$": {
        stage: "mutation",
        whole: false,
      },
      // The guard family is held whole by the preflight sweep, whose `inputs` name the file —
      // and the manifest it reads — since the machinery-key pass named both in `STAGE_TABLE`.
      ".freebuff/^whole-write\\.mjs$": { stage: "mutation-preflight", whole: true },
      ".freebuff/^(collect-.*|.*-collect-baselines)\\.mjs$": { stage: "lint", whole: true },
      ".freebuff/^coverage-.*\\.mjs$": { stage: "mutation-coverage", whole: true },
      ".freebuff/^mutation-.*\\.mjs$": { stage: "mutation-coverage", whole: false },
      "^(next|vite)\\.config\\.(mjs|ts)$": { stage: "preflight", whole: true },
      "^vitest(\\..+)?\\.config\\.ts$": { stage: "mutation-coverage", whole: true },
    };
    expect(
      Object.fromEntries(
        (status.families as {
          rule: string;
          owner: { stage: string; whole: boolean } | null;
        }[]).map(({ rule, owner }) => [
          rule,
          owner === null ? null : { stage: owner.stage, whole: owner.whole },
        ]),
      ),
    ).toMatchObject(expectedOwners);
    // Not vacuous either way, or the clause would be furniture: this tree has a family behind no
    // stage's key at all — the workflows, held by the pin's own re-key alone — beside families a
    // stage holds whole, so both repairs are really said here.
    const owned = status.families as { owner: { whole: boolean } | null }[];
    expect(owned.filter((family) => family.owner === null).length).toBeGreaterThan(0);
    expect(owned.some((family) => family.owner?.whole === true)).toBe(true);
  });

  it("reads a proposed input without applying it, and names the half-held family it would close", () => {
    // `--watch` is the family mark asked about one concrete edit — "is *this* file, named in a
    // stage's `inputs`, enough?" — and it is answered from the same rows the map prints, so the
    // answer cannot come from a second walk over the tree. Nothing is written: the pin is a
    // question here, not a change, and the manifest is read either side of the run to hold that.
    const before = readFileSync(manifestPath(), "utf8");
    const status = JSON.parse(runCi(["--status", "--json", "--watch=tsconfig.json"]).stdout);
    expect(readFileSync(manifestPath(), "utf8")).toBe(before);

    const family = (
      status.coverage as { file: string; rule: string }[]
    ).find((row) => row.file === "tsconfig.json")!.rule;
    expect(status.watch.kind).toBe("path");
    expect(status.watch.label).toBe("tsconfig.json");
    expect(status.watch.rule).toBe(family);
    expect(status.watch.files).toEqual(["tsconfig.json"]);
    expect(status.watch.pinned).toEqual(["tsconfig.json"]);
    expect(status.watch.fresh).toEqual([]);
    expect(status.watch.problem).toBeNull();

    // The whole answer: the family `tsconfig.json` belongs to is held in part by `lint` and whole
    // by nothing else, so naming the file in `lint`'s own `inputs` is what closes it — the same
    // stage-and-sibling reading the refusal makes, asked before anything has gone red.
    expect(status.watch.closes).toEqual([
      { rule: family, members: 2, covered: 1, stages: ["lint"], anyStage: false },
    ]);
    // …and every family the view marks is accounted for exactly once, closed or left open, so a
    // candidate that closes one family out of three cannot read as a fix for all of them.
    const marked = (status.families as { rule: string; exposed: boolean }[])
      .filter((entry) => entry.exposed)
      .map((entry) => entry.rule)
      .sort();
    expect(
      [...status.watch.closes, ...status.watch.open]
        .map((entry: { rule: string }) => entry.rule)
        .sort(),
    ).toEqual(marked);
    expect(status.watch.open.length).toBe(marked.length - 1);

    // The human form is the same answer in words, one line per family it closes and a verdict that
    // says how much of the risk it covers rather than leaving it to be counted.
    const human = runCi(["--status", "--watch=tsconfig.json"]).stdout;
    expect(human).toContain(`watch — tsconfig.json (a pinned file; in ${family})`);
    expect(human).toContain(
      `closes  ${family} — lint would hold all 2 members with it in \`inputs\``,
    );
    expect(human).toContain(
      `verdict — closes 1 of the ${marked.length} families a new member would leave behind drift alone.`,
    );
  });

  it("answers a proposed rule by the family it would close, and says when no stage holds one", () => {
    // A rule candidate is resolved through the *alarm's own scan*, so the files it would watch are
    // the files the pin would hold rather than this test's guess at a pattern. When it covers a
    // family no stage holds at all, the answer is not "edit this stage" but "any stage naming it
    // would do" — there is no part-holder to extend, and the report says which of the two it is.
    const status = JSON.parse(runCi(["--status", "--json"]).stdout);
    const rule = (status.coverage as { rule: string }[])
      .map((row) => row.rule)
      .find((label) => label.startsWith(".github/workflows/"))!;
    const members = (status.coverage as { file: string; rule: string }[])
      .filter((row) => row.rule === rule)
      .map((row) => row.file)
      .sort();

    const watch = JSON.parse(runCi(["--status", "--json", `--watch=${rule}`]).stdout).watch;
    expect(watch.kind).toBe("rule");
    expect(watch.label).toBe(rule);
    expect(watch.rule).toBe(rule);
    expect([...watch.files].sort()).toEqual(members);
    expect([...watch.pinned].sort()).toEqual(members);
    expect(watch.fresh).toEqual([]);
    expect(watch.closes).toEqual([
      { rule, members: members.length, covered: members.length, stages: [], anyStage: true },
    ]);

    const human = runCi(["--status", `--watch=${rule}`]).stdout;
    expect(human).toContain("any stage naming it would hold the family whole");

    // A spec that is neither a path the pin holds nor a rule that compiles is named for what it
    // is — the alarm's own two refusals, surfaced — rather than reported as matching nothing.
    const unreadable = JSON.parse(
      runCi(["--status", "--json", "--watch=.freebuff/*.ts"]).stdout,
    ).watch;
    expect(unreadable.problem).toContain("Nothing to repeat");
    expect(unreadable.files).toEqual([]);
    expect(unreadable.closes).toEqual([]);
    expect(unreadable.pinned).toEqual([]);

    // …and the third way a spec can answer nothing: a rule that compiles and resolves no file (a
    // path nobody pinned and no rule of the pin claims). It is *read* rather than refused, and the
    // human line says which reading failed so a typo in a path is not mistaken for a bad pattern.
    const empty = runCi(["--status", "--json", "--watch=.freebuff/^nothing-names-this$"]);
    expect(JSON.parse(empty.stdout).watch.problem).toBeNull();
    expect(JSON.parse(empty.stdout).watch.files).toEqual([]);
    expect(runCi(["--status", "--watch=.freebuff/^nothing-names-this$"]).stdout).toContain(
      "nothing the pin holds matches it as a path, and as a watch rule it resolves no file",
    );
  });

  it("refuses a --watch that is not a question about the pin", () => {
    // The candidate belongs to `--status`'s family view, and every other way of spelling it is a
    // run that would silently answer a different question — so each one is refused by name rather
    // than ignored.
    const alone = runCi(["--watch=tsconfig.json", "--dry-run"]);
    expect(alone.status).toBe(1);
    expect(alone.stderr).toContain("--watch reads the pin's family view, so it needs --status");

    for (const args of [["--status", "--watch"], ["--status", "--watch="]]) {
      const refused = runCi(args);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(
        "--watch needs a file path or a watch rule (dir/pattern), got (nothing)",
      );
      // …and nothing ran: a usage error is not a reading with a different head.
      expect(refused.stdout).not.toContain("key coverage —");
    }
  });

  it("refuses a stage selection, or another report mode, rather than answer a narrower question", () => {
    const only = runCi(["--status", "--only=lint"]);
    expect(only.status).toBe(1);
    expect(only.stderr).toContain(
      "--status reports the pin and its key coverage, so it takes no stage selection (--only)",
    );

    const both = runCi(["--status", "--dry-run"]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain(
      "--status, --dry-run and --explain-cache each report and exit — pass only one",
    );
  });
});

describe("the CI runner's read of the real mutation payload", () => {
  // A slice, not a stub: the real sweep runs a couple of real mutations and
  // emits its own payload, and the real runner reads it. This is the mutation
  // counterpart to the preflight shape contract — rename `checked` or a survivor
  // field and the derived counts (and named lines) stop matching.
  //
  // It is opt-in (`CI_SHAPE_CONTRACT=1`), unlike the preflight contract, because
  // the sweep *rewrites source* while it runs: sharing the tree with the rest of
  // this suite would let a route test observe a half-mutated guard. Run it on its
  // own — `CI_SHAPE_CONTRACT=1 npx vitest run src/test/ci-runner.test.ts` — where
  // nothing else is reading the mutated files. The always-on real sweep is the
  // CI runner's own `mutation` stage.
  it.runIf(process.env.CI_SHAPE_CONTRACT === "1")("fits the sweep's own fields, so neither can be renamed without this failing", () => {
    const probe = spawnSync(process.execPath, [sweep, "--json", ...REAL_SWEEP_SLICE], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    const payload = JSON.parse(probe.stdout) as MutationPayload;

    // --- The shape the runner reads, asserted directly. ---------------------
    expect(payload.gate).toMatch(/^(pass|fail)$/);
    expect(typeof payload.checked).toBe("number");
    // A non-empty slice, so the count assertions below are not vacuous.
    expect(payload.checked).toBeGreaterThan(0);
    expect(Array.isArray(payload.survivors)).toBe(true);
    // The strikes that ran, counted by depth: a detector struck whole and a detector
    // struck at one limb are separate fields, so a consumer never has to guess which of
    // the two a single "self-mutation" count was covering. This slice names no file in
    // `src/test`, so the sweep's own `--file` filter has dropped every one of them —
    // which is itself the tie: the new counts answer to the same filter the old ones do.
    expect(typeof payload.helperSelfMutations).toBe("number");
    expect(payload.runnerSelfMutations).toBe(0);
    expect(payload.conventionSelfMutations).toBe(0);
    expect(payload.limbSelfMutations).toBe(0);
    expect(payload.lockSelfMutations).toBe(0);
    expect(payload.ratchetSelfMutations).toBe(0);
    // The per-strike record answers to the same filter, and here the tie *is* the
    // emptiness: this slice names no `src/test` file, so nothing was struck at one of the
    // detectors and neither the record nor the thin-margin count has anything in it. A
    // consumer reading which case caught a limb reads exactly the slice a consumer reading
    // the counts does.
    expect(payload.strikes).toEqual([]);
    expect(payload.thinMargin).toBe(0);
    // The audit is *not* filtered by `--file` — it is a fact about the detector file and the
    // whole strike list, so a slice that ran none of the family still reports it, and the
    // count must equal the list it is the length of.
    expect(payload.decisionSites).toBeGreaterThan(payload.unstruck);
    expect(payload.unstruckRules).toHaveLength(payload.unstruck);
    for (const rule of payload.unstruckRules) {
      expect(typeof rule.where).toBe("string");
      expect(typeof rule.line).toBe("number");
    }
    for (const survivor of payload.survivors) {
      expect(typeof survivor.path).toBe("string");
      expect(survivor.line === null || typeof survivor.line === "number").toBe(true);
      // `convention` (a detector that reported nothing), `limb` (one limb of one that went
      // dark) and `runner` (a check inside the runner itself) cannot appear in this slice —
      // its `--file` filter excludes them, since it names neither a `src/test` nor a runner
      // file — but they are the kinds this path can emit, so the set is asserted rather than
      // the slice merely happening to fit it.
      expect(["guard", "failopen", "catch", "self", "runner", "convention", "limb"]).toContain(
        survivor.kind,
      );
      expect(typeof survivor.descriptor).toBe("string");
    }

    // --- The runner, reading that same payload. -----------------------------
    const result = spawnSync(
      process.execPath,
      [ciRunner, "--only=mutation", ...REAL_SWEEP_SLICE],
      { cwd: projectRoot, encoding: "utf8", env: { ...process.env, CI_CACHE_FILE: freshCachePath() } },
    );

    expect(result.stdout).not.toContain("produced no JSON");
    // The runner's exit matches the gate the sweep itself reported.
    expect(result.status).toBe(payload.exitCode);

    // The derived count: the runner's summary must equal what the payload says. The
    // failing form is a prefix of what the runner prints — the per-kind breakdown follows
    // it, and cannot be derived from `checked` and a length — so the exact line, breakdown
    // included, is pinned where a fixture can state the mix and assert it whole (the stub
    // cases above), and this ties the two counts it *can* derive.
    const expected =
      payload.gate === "pass"
        ? `${payload.checked} mutation(s) checked, no survivors`
        : `${payload.checked} checked, ${payload.survivors.length} survivor(s)`;
    expect(result.stdout).toContain(expected);

    // One survivor line per survivor in the sweep's array, named the same way:
    // file and line, grouped by kind (a line-less helper by path alone). This is
    // the count tie — a payload field the runner could not read would print
    // fewer or malformed lines here.
    const survivorLines = result.stdout
      .split("\n")
      .filter((line) => /SURVIVED|UNDRIVEN/.test(line));
    expect(survivorLines).toHaveLength(payload.survivors.length);
    for (const survivor of payload.survivors) {
      const name = survivor.line === null ? survivor.path : `${survivor.path}:${survivor.line}`;
      expect(result.stdout).toContain(name);
      expect(result.stdout).toContain(survivor.descriptor);
    }
    if (payload.survivors.length === 0) {
      // A healthy tree: the pass line, and no survivor lines at all.
      expect(result.stdout).toContain("PASS  mutation sweep");
    } else {
      expect(result.stdout).toContain("FAIL  mutation sweep");
    }
  }, 120_000);
});

describe("the CI runner's own --json report", () => {
  it("emits one JSON object naming the stages, with progress on stderr", () => {
    const preflightStub = writeStub("runjson-pass-pf.mjs", PASSING_PREFLIGHT);
    const mutationStub = writeStub("runjson-pass-mut.mjs", PASSING_MUTATION);

    const result = runCi(["--json", "--only=preflight,mutation"], {
      CI_PREFLIGHT_SCRIPT: preflightStub,
      CI_MUTATION_SCRIPT: mutationStub,
    });

    // stdout is exactly the report — nothing else to trip a parser.
    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("pass");
    expect(payload.exitCode).toBe(0);
    expect(payload.failed).toEqual([]);
    expect(payload.stages.map((stage: { name: string }) => stage.name)).toEqual([
      "preflight",
      "mutation",
    ]);
    for (const stage of payload.stages) {
      expect(stage.pass).toBe(true);
      expect(typeof stage.summary).toBe("string");
      expect(Array.isArray(stage.details)).toBe(true);
      expect(Array.isArray(stage.raw)).toBe(true);
    }
    // The human progress moved to stderr where it cannot corrupt the report.
    expect(result.stderr).toContain("ci: preflight pass");
    expect(result.status).toBe(0);
  });

  it("redacts a secret-looking name in the report and the annotation it publishes", () => {
    const stub = writeStub("runjson-secret.mjs", SECRET_SURVIVOR_SWEEP);

    const result = runCi(["--json", "--only=mutation"], { CI_MUTATION_SCRIPT: stub });

    const payload = JSON.parse(result.stdout);
    // The survivor keeps its line and the count, but not the name of the file it
    // names — the report is uploaded and pasted where a reader cannot un-see it.
    expect(payload.stages[0].details[0].name).toBe("<redacted>:5");
    expect(payload.annotations[0].file).toBe("<redacted>");
    // The summary keeps its counts — the per-kind breakdown names a kind, never a file.
    expect(payload.stages[0].summary).toBe("1 checked, 1 survivor(s): 1 guard");
    expect(result.stdout).not.toContain(".env.local");
    expect(result.status).toBe(1);
  });

  it("reports the failing stage and its detail with the fix", () => {
    const stub = writeStub("runjson-fail-pf.mjs", FAILING_PREFLIGHT);

    const result = runCi(["--json", "--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.failed).toEqual(["preflight"]);
    expect(payload.stages[0].details[0]).toMatchObject({
      mark: "FAIL",
      name: "dev server pid",
      detail: "process 1 is gone",
      fix: "npm run dev",
    });
    expect(result.status).toBe(1);
  });

  it("reports a selection error as JSON too", () => {
    const result = runCi(["--json", "--only=nope"]);

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.error).toContain("unknown stage(s): nope");
    expect(payload.stages).toEqual([]);
    expect(result.status).toBe(1);
  });

  it("reports the dry-run selection as JSON", () => {
    const result = runCi(["--json", "--dry-run"]);

    const payload = JSON.parse(result.stdout);
    expect(payload.dryRun).toBe(true);
    expect(payload.stages).toEqual([
      "typecheck",
      "runbook",
      "lint",
      "test",
      "preflight",
      "drift",
      "mutation-example",
      "mutation-fifth",
      "mutation-coverage",
      "mutation-preflight",
      "mutation",
    ]);
    expect(result.status).toBe(0);
  });

  it("keeps the human report as the default when --json is absent", () => {
    const stub = writeStub("runjson-human.mjs", PASSING_PREFLIGHT);

    const result = runCi(["--only=preflight"], { CI_PREFLIGHT_SCRIPT: stub });

    expect(result.stdout).toContain("PASS  preview preflight");
    // The default output is not JSON.
    expect(() => JSON.parse(result.stdout)).toThrow();
    expect(result.status).toBe(0);
  });
});

describe("the CI runner's GitHub annotations", () => {
  it("emits a workflow command per failing detail, with its file and line", () => {
    const stub = writeStub("gha-lint.mjs", FAILING_LINT);

    const result = runCi(["--github-annotations", "--only=lint"], { CI_LINT_SCRIPT: stub });

    expect(result.status).toBe(1);
    // The findings GitHub should show inline on the diff, one command each.
    expect(result.stdout).toContain(
      "::error file=src/app/api/foo/route.ts,line=12,col=7,title=lint baseline::@typescript-eslint/no-unused-vars: x is assigned a value but never used",
    );
    // A warning-level finding annotates as a warning, not an error.
    expect(result.stdout).toContain(
      "::warning file=src/lib/bar.ts,line=3,col=1,title=lint baseline::react-hooks/exhaustive-deps: missing dependency: y",
    );
  });

  it("escapes the path separator and the message a workflow command cannot carry raw", () => {
    const stub = writeStub("gha-escaping.mjs", ESCAPING_LINT);

    const result = runCi(["--github-annotations", "--only=lint"], { CI_LINT_SCRIPT: stub });

    // `,` in the file becomes %2C, `%` becomes %25, and the newline becomes %0A.
    expect(result.stdout).toContain(
      "::error file=src/lib/a%2Cb.ts,line=5,col=2,title=lint baseline::rule: 50%25 off%0Aand a: colon",
    );
  });

  it("points a type error at the line tsc named", () => {
    const stub = writeStub("gha-tsc.mjs", FAILING_TYPECHECK);

    const result = runCi(["--github-annotations", "--only=typecheck"], { CI_TYPECHECK_SCRIPT: stub });

    expect(result.stdout).toContain(
      "::error file=src/app/api/foo/route.ts,line=1,col=2,title=typecheck::src/app/api/foo/route.ts(1,2): error TS2322: bad assignment",
    );
  });

  it("annotates a failed test by its file, and a survivor by its line", () => {
    const testStub = writeStub("gha-test.mjs", FAILING_TEST_REPORT);
    const mutationStub = writeStub("gha-mutation.mjs", FAILING_MUTATION);

    const testResult = runCi(["--github-annotations", "--only=test"], { CI_TEST_SCRIPT: testStub });
    expect(testResult.stdout).toContain(
      "::error file=src/test/stub.test.ts,title=vitest suite::renders the thing",
    );

    const mutationResult = runCi(["--github-annotations", "--only=mutation"], {
      CI_MUTATION_SCRIPT: mutationStub,
    });
    expect(mutationResult.stdout).toContain(
      "::error file=src/app/api/admin/moderate/route.ts,line=42,title=mutation sweep::guard removed (reports gate)",
    );
    // A survivor with no line still annotates — against the file, without a line.
    expect(mutationResult.stdout).toContain(
      "::error file=src/app/api/admin/reports/route.ts,title=mutation sweep::helper self-mutation",
    );
  });

  it("annotates a recovered lock as a warning rather than an error", () => {
    const stub = writeStub("gha-recovered.mjs", RECOVERED_COVERAGE);

    const result = runCi(["--github-annotations", "--only=mutation-coverage"], {
      CI_MUTATION_COVERAGE_SCRIPT: stub,
    });

    // A green stage still speaks: the file a killed run was in the middle of, as a
    // warning, so the run page points at it without failing the build.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "::warning file=.freebuff/coverage-floor.mjs,title=coverage gate mutation::RESTORED .freebuff/coverage-floor.mjs",
    );
    expect(result.stdout).toContain("::warning file=.freebuff/coverage-scopes.mjs,title=coverage gate mutation::WARNING: .freebuff/coverage-scopes.mjs differs from both");
    expect(result.stdout).not.toContain("::error file=.freebuff/coverage-floor.mjs");
  });

  it("carries the same annotations in the --json report", () => {
    const stub = writeStub("gha-json.mjs", FAILING_LINT);

    const result = runCi(["--json", "--only=lint"], { CI_LINT_SCRIPT: stub });

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("fail");
    expect(payload.annotations[0]).toMatchObject({
      level: "error",
      file: "src/app/api/foo/route.ts",
      line: 12,
      column: 7,
      title: "lint baseline",
    });
    expect(payload.annotations[0].message).toContain("@typescript-eslint/no-unused-vars");
    expect(payload.annotations[1]).toMatchObject({ level: "warning", file: "src/lib/bar.ts" });
  });

  it("orders the first failure first across stages", () => {
    const tscStub = writeStub("gha-order-tsc.mjs", FAILING_TYPECHECK);
    const lintStub = writeStub("gha-order-lint.mjs", FAILING_LINT);

    const result = runCi(["--json", "--keep-going", "--only=typecheck,lint"], {
      CI_TYPECHECK_SCRIPT: tscStub,
      CI_LINT_SCRIPT: lintStub,
    });

    const payload = JSON.parse(result.stdout);
    // The first failure's annotation leads, so a reader sees the earliest break first.
    expect(payload.annotations[0].title).toBe("typecheck");
    expect(payload.annotations.some((a: { title: string }) => a.title === "lint baseline")).toBe(
      true,
    );
  });

  it("emits nothing when the run is green", () => {
    const stub = writeStub("gha-clean.mjs", PASSING_LINT);

    const result = runCi(["--github-annotations", "--only=lint"], { CI_LINT_SCRIPT: stub });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("::error");
    expect(result.stdout).not.toContain("::warning");
  });

  it("refuses to combine --github-annotations with --json rather than corrupt one", () => {
    const result = runCi(["--json", "--github-annotations", "--dry-run"]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.error).toContain("both write stdout");
    expect(result.stderr).toContain("both write stdout");
  });
});

describe("the CI runner's change-based skipping", () => {
  it("keeps the mutation sweep only when a route or route test changed", () => {
    const libChange = runCi(["--changed-only", "--dry-run"], { CI_CHANGED_FILES: "src/lib/foo.ts" });
    expect(libChange.stdout).toContain("would run 3 stage(s): typecheck, lint, test");
    expect(libChange.stdout).toContain(
      "not run (nothing they read changed): runbook, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation",
    );

    const routeChange = runCi(["--changed-only", "--dry-run"], {
      CI_CHANGED_FILES: "src/app/api/posts/route.ts",
    });
    expect(routeChange.stdout).toContain("would run 4 stage(s): typecheck, lint, test, mutation");

    const routeTestChange = runCi(["--changed-only", "--dry-run"], {
      CI_CHANGED_FILES: "src/app/api/posts/route.test.ts",
    });
    expect(routeTestChange.stdout).toContain("would run 4 stage(s): typecheck, lint, test, mutation");

    // A coverage gate script is what the coverage-gate mutation check exists to
    // weaken, and what the drift check exists to pin: the change runs both, and
    // nothing else in the gate reads the script.
    const gateChange = runCi(["--changed-only", "--dry-run"], {
      CI_CHANGED_FILES: ".freebuff/coverage-floor.mjs",
    });
    expect(gateChange.stdout).toContain("would run 3 stage(s): lint, drift, mutation-coverage");
    expect(gateChange.stdout).toContain(
      "not run (nothing they read changed): typecheck, runbook, test, preflight, mutation-example, mutation-fifth, mutation",
    );

    // The pin covers the rest of the gate machinery too, so a change to any of those
    // files reaches the drift stage even though no coverage gate moved. The lint stage
    // reads every `.mjs`; the mutation check reads only the coverage scripts, so it is
    // *not* kept here — which is the difference the two input sets are supposed to make.
    const runnerChange = runCi(["--changed-only", "--dry-run"], {
      CI_CHANGED_FILES: ".freebuff/lint-baseline.mjs",
    });
    expect(runnerChange.stdout).toContain("would run 2 stage(s): lint, drift");

    // The preflight sweep is the third tree-editor, and its key is its own script plus
    // the preflight it mutates: a change to the sweep keeps the lint stage (every `.mjs`),
    // the drift stage (whose inputs *are* the pin's rules) and the sweep itself — and
    // neither of the other two mutation checks, which read the routes or the coverage
    // scripts and nothing here.
    const sweepChange = runCi(["--changed-only", "--dry-run"], {
      CI_CHANGED_FILES: ".freebuff/mutation-preflight.mjs",
    });
    expect(sweepChange.stdout).toContain("would run 3 stage(s): lint, drift, mutation-preflight");
    expect(sweepChange.stdout).toContain(
      "not run (nothing they read changed): typecheck, runbook, test, preflight, mutation-example, mutation-fifth, mutation-coverage, mutation",
    );
  });

  it("runs every stage when a build or config file changed", () => {
    const result = runCi(["--changed-only", "--dry-run"], { CI_CHANGED_FILES: "package.json" });

    expect(result.stdout).toContain(
      "would run 11 stage(s): typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation",
    );
    expect(result.stdout).toContain("running every stage anyway");
  });

  it("runs every stage when the change set is empty, rather than skipping the gate", () => {
    const result = runCi(["--changed-only", "--dry-run"], { CI_CHANGED_FILES: "" });

    expect(result.stdout).toContain(
      "would run 11 stage(s): typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-fifth, mutation-coverage, mutation-preflight, mutation",
    );
    expect(result.stdout).toContain("the change set is empty");
  });

  it("runs every stage when the diff cannot be read", () => {
    // With no `CI_CHANGED_FILES` and a ref that cannot resolve, the git read
    // fails and the safe direction is to run everything, not to skip.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CI_CHANGED_FILES;
    env.CI_CACHE_FILE = freshCachePath();
    const result = spawnSync(
      process.execPath,
      [ciRunner, "--changed-only", "--dry-run", "--diff-base=__definitely_missing__"],
      { cwd: projectRoot, encoding: "utf8", env },
    );

    expect(result.stdout).toContain("would run 11 stage(s)");
    expect(result.stdout).toContain("could not read the working-tree diff");
  });

  it("really skips an unchanged stage, and really runs a touched one", () => {
    const mutationStub = writeStub("chg-mutation.mjs", RECORDING_MUTATION);
    const marker = path.join(stubDir, "chg-ran.marker");

    rmSync(marker, { force: true });
    const skipped = runCi(["--changed-only", "--only=mutation"], {
      CI_MUTATION_SCRIPT: mutationStub,
      CI_CHANGED_FILES: "src/lib/foo.ts",
      CI_STUB_MARKER: marker,
    });
    expect(skipped.status).toBe(0);
    // The sweep really never ran (the marker is the proof, not the SKIP banner).
    expect(existsSync(marker)).toBe(false);
    expect(skipped.stdout).toContain("SKIP  mutation sweep — nothing it reads changed");
    expect(skipped.stdout).toContain("nothing to run");
    expect(skipped.stderr).toContain("skipped 1 unchanged stage(s): mutation");

    rmSync(marker, { force: true });
    const ran = runCi(["--changed-only", "--only=mutation"], {
      CI_MUTATION_SCRIPT: mutationStub,
      CI_CHANGED_FILES: "src/app/api/posts/route.test.ts",
      CI_STUB_MARKER: marker,
    });
    expect(ran.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(ran.stdout).toContain("PASS  mutation sweep");
  });

  it("reports the unchanged stages in the --json report", () => {
    const result = runCi(["--changed-only", "--json", "--only=runbook,mutation"], {
      CI_CHANGED_FILES: "src/lib/foo.ts",
    });

    const payload = JSON.parse(result.stdout);
    expect(payload.gate).toBe("pass");
    expect(payload.stages).toEqual([]);
    expect(payload.unchanged).toEqual(["runbook", "mutation"]);
  });

  it("does nothing when --changed-only is absent", () => {
    const result = runCi(["--dry-run", "--json"]);

    const payload = JSON.parse(result.stdout);
    expect(payload.unchanged).toEqual([]);
    expect(payload.stages).toContain("mutation");
  });
});

describe("the CI runner's runbook stage", () => {
  it("passes when the Contents is up to date, asked for --check --json", () => {
    const stub = writeStub("runbook-pass.mjs", PASSING_RUNBOOK);

    const result = runCi(["--only=runbook"], { CI_RUNBOOK_SCRIPT: stub });

    // The stub exits 3 unless both `--check` and `--json` were forwarded.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  runbook contents");
    expect(result.stdout).toContain("60 section(s), Contents up to date");
  });

  it("fails the job when the Contents is stale, naming the fix", () => {
    const stub = writeStub("runbook-stale.mjs", STALE_RUNBOOK);

    const result = runCi(["--only=runbook"], { CI_RUNBOOK_SCRIPT: stub });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  runbook contents");
    expect(result.stdout).toContain("Contents is stale (61 section(s))");
    expect(result.stdout).toContain("fix: npm run runbook:contents, then commit the result");
    expect(result.stderr).toContain("1 of 1 stage(s) failed: runbook");
  });
});

describe("the runner's concurrent-edit suspects", () => {
  // The shared-tree red, produced on demand: a scratch pin (the `GATE_HASHES_FILE` seam) holds
  // one real `.mjs` file in `.freebuff` — in that directory, and only there, so the run's own
  // coverage refusal lets the run start: the lint stage's whole-tree sweep keys the probe the
  // way it keys every gate script the committed pin holds. The stub runbook standing in for
  // the gate appends to the probe *while the run is between its opening snapshot and its
  // close*, which is the shape every shared-tree red takes: the tree the run measured is not
  // the tree it left.
  const probeName = "ci-suspect-probe.mjs";
  const probe = path.join(projectRoot, ".freebuff", probeName);
  const fixture = path.join(stubDir, "ci-suspect-pin.mjs");
  const watches = [
    ...DEFAULT_WATCHES,
    { dir: ".freebuff", pattern: `^${probeName.replace(/\./g, "\\.")}$` },
  ];

  it("marks failed stages with the pinned files that moved underneath the run", () => {
    const stub = writeStub(
      "suspect-runbook.mjs",
      [
        "import { appendFileSync } from 'node:fs';",
        "appendFileSync(process.env.CI_SUSPECT_PROBE, '\\nexport const touched = 1;\\n');",
        "process.stdout.write(JSON.stringify({",
        "  gate: 'fail', exitCode: 1, sections: 60,",
        "  message: 'run.md: Contents is stale (61 section(s)).',",
        "}));",
      ].join("\n"),
    );
    writeFileSync(probe, "export const seeded = 1;\n", "utf8");
    writeFileSync(
      fixture,
      renderManifest({ algorithm: "sha1", watches, files: pin([], watches) }),
      "utf8",
    );
    try {
      const result = runCi(["--only=runbook", "--json"], {
        CI_RUNBOOK_SCRIPT: stub,
        GATE_HASHES_FILE: fixture,
        CI_SUSPECT_PROBE: probe,
        CI_PIN_SNAPSHOT_FILE: path.join(stubDir, "pin-snapshot-suspects.json"),
      });

      expect(result.status).toBe(1);
      // The stderr banner, where a log reader finds it: the file, how it moved, and what
      // to do about the reds beside it.
      expect(result.stderr).toContain(
        "concurrent-edit suspects — 1 pinned gate file(s) moved during this run: .freebuff/ci-suspect-probe.mjs (changed)",
      );
      const payload = JSON.parse(result.stdout) as {
        suspects: { path: string; how: string }[];
        stages: {
          name: string;
          pass: boolean;
          details: { mark: string; name: string; detail: string; suspect?: boolean }[];
        }[];
        annotations: { level: string; file?: string; message: string }[];
      };
      expect(payload.suspects).toEqual([{ path: `.freebuff/${probeName}`, how: "changed" }]);
      const runbook = payload.stages.find((stage) => stage.name === "runbook");
      expect(runbook?.pass).toBe(false);
      // The suspect rides the failed stage's details as a WARN, marked `suspect` so a
      // machine consumer can tell attribution from findings.
      const suspect = runbook?.details.find((detail) => detail.suspect);
      expect(suspect).toMatchObject({ mark: "WARN", name: `.freebuff/${probeName}` });
      expect(suspect?.detail).toContain("moved during this run (changed since the run opened)");
      expect(suspect?.detail).toContain("this failure may be theirs, not this checkout's");
      // …and the annotation the detail becomes points at the moved file, at warning level.
      const annotation = payload.annotations.find((entry) =>
        entry.message.includes("moved during this run"),
      );
      expect(annotation).toMatchObject({
        level: "warning",
        file: `.freebuff/${probeName}`,
      });
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("names no suspect on a run the tree did not move under", () => {
    const stub = writeStub("suspect-clean-runbook.mjs", PASSING_RUNBOOK);
    writeFileSync(probe, "export const seeded = 1;\n", "utf8");
    writeFileSync(
      fixture,
      renderManifest({ algorithm: "sha1", watches, files: pin([], watches) }),
      "utf8",
    );
    try {
      const result = runCi(["--only=runbook", "--json"], {
        CI_RUNBOOK_SCRIPT: stub,
        GATE_HASHES_FILE: fixture,
        CI_PIN_SNAPSHOT_FILE: path.join(stubDir, "pin-snapshot-clean.json"),
      });

      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        suspects: unknown[];
        annotations: { message: string }[];
      };
      // The probe sat exactly as pinned for the whole run, so the close reads no
      // difference: no banner, no payload row, no annotation.
      expect(payload.suspects).toEqual([]);
      expect(result.stderr).not.toContain("concurrent-edit");
      expect(
        payload.annotations.some((entry) => entry.message.includes("moved during this run")),
      ).toBe(false);
    } finally {
      rmSync(probe, { force: true });
    }
  });
});

/** A stub typecheck that passes: the runner reads its exit code, not a payload. */
const PASSING_TYPECHECK = ["process.exit(0);"].join("\n");

/** A stub test run that writes a passing vitest report, honoring `--outputFile=`. */
const PASSING_TEST_REPORT = [
  "import { writeFileSync } from 'node:fs';",
  "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
  "writeFileSync(out, JSON.stringify({",
  "  numTotalTests: 1, numFailedTests: 0,",
  "  testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }],",
  "}));",
].join("\n");

describe("the runner's dated runbook bullet", () => {
  // Every case here runs the *whole* gate against stubs, because the record is the whole
  // gate's close: a selection slice answers `slice` and writes nothing (its own case
  // below), so a partial run is the only honest way to test the write path. The record
  // file is a fresh scratch path per case — the project's own runbook is never a test's
  // write target.
  let recordSeq = 0;
  const freshRecord = () => path.join(stubDir, `run-record-${(recordSeq += 1)}.md`);

  // The seams name stub *paths*, so the whole-gate stub set is written once and
  // reused; a case that needs a different script overrides it with its own stub.
  let fullGate: Record<string, string> | null = null;
  const fullGateStubs = (extra: Record<string, string> = {}): Record<string, string> => {
    if (fullGate === null) {
      fullGate = {
        // The coverage-stamp seam, pointed at scratch for every case here: the
        // real suite runs beside these tests, and its rendered-links close-out
        // writes the tree's real stamp — a close that read it would fold a
        // reading from a sibling test file into this test's bullet. Cases that
        // exercise the stamp override this with their own scratch path.
        CI_COVERAGE_STAMP_FILE: path.join(stubDir, "coverage-stamp-default.txt"),
        CI_TYPECHECK_SCRIPT: writeStub("record-typecheck.mjs", PASSING_TYPECHECK),
        CI_RUNBOOK_SCRIPT: writeStub("record-runbook.mjs", PASSING_RUNBOOK),
        CI_LINT_SCRIPT: writeStub("record-lint.mjs", PASSING_LINT),
        CI_TEST_SCRIPT: writeStub("record-test.mjs", PASSING_TEST_REPORT),
        CI_PREFLIGHT_SCRIPT: writeStub("record-preflight.mjs", PASSING_PREFLIGHT),
        CI_DRIFT_SCRIPT: writeStub("record-drift.mjs", PASSING_DRIFT),
        CI_MUTATION_COVERAGE_SCRIPT: writeStub("record-coverage.mjs", PASSING_MUTATION_COVERAGE),
        CI_MUTATION_PREFLIGHT_SCRIPT: writeStub("record-preflight-sweep.mjs", PASSING_MUTATION_PREFLIGHT),
        CI_MUTATION_SCRIPT: writeStub("record-mutation.mjs", PASSING_MUTATION),
      };
    }
    return { ...fullGate, ...extra };
  };

  // A test-stage stub that leaves a rendered-links stamp in the path the stamp
  // seam names — the same close-out the real rendered-links guard performs,
  // shrunk to one line, shared by every case whose bullet turns on the stamp.
  const stampingGate = (name: string, stampPath: string): Record<string, string> => ({
    CI_COVERAGE_STAMP_FILE: stampPath,
    CI_TEST_SCRIPT: writeStub(name, [
      "import { writeFileSync } from 'node:fs';",
      "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
      "writeFileSync(out, JSON.stringify({",
      "  numTotalTests: 1, numFailedTests: 0,",
      "  testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }],",
      "}));",
      "writeFileSync(process.env.CI_COVERAGE_STAMP_FILE, 'rendered-links coverage: chrome — the stub 2 (2 unique destinations)\\n');",
    ].join("\n")),
  });

  it("appends one dated bullet when the whole gate passes", () => {
    const record = freshRecord();
    const result = runCi(["--no-cache", "--json"], fullGateStubs({ CI_RECORD_RUNBOOK_FILE: record }));

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).recorded).toBe("written");
    const text = readFileSync(record, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    // The bullet carries the date, the closing verdict's counts, and the per-stage
    // marks in canonical order — the same numbers the verdict line prints.
    expect(text).toContain(
      `- **${today} — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.**`,
    );
    expect(text).toContain("typecheck PASS");
    expect(text).toContain("mutation sweep PASS");
    // The append sits as its own paragraph, and only one bullet was written.
    expect(text.startsWith("\n")).toBe(true);
    expect(text.match(/ci verdict:/g)).toHaveLength(1);
    // And no coverage stamp: the stubbed test stage leaves none, so the close
    // omits the line rather than quoting a reading it never measured.
    expect(text).not.toContain("rendered-links coverage:");
  }, 20_000);

  it("the rendered-links guard's coverage stamp rides the bullet", () => {
    // The guard's close-out leaves the stamp where the test stage ran, and the
    // close folds it into the bullet verbatim — the reading of what the guard
    // audited, riding the same record as the verdict that measured it. The
    // stub stands in for the vitest stage that would have run the guard,
    // writing the same sidecar to the scratch path the stamp seam names.
    const stampPath = path.join(stubDir, "coverage-stamp.txt");
    const stampingTest = [
      "import { writeFileSync } from 'node:fs';",
      "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
      "writeFileSync(out, JSON.stringify({",
      "  numTotalTests: 1, numFailedTests: 0,",
      "  testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }],",
      "}));",
      "writeFileSync(process.env.CI_COVERAGE_STAMP_FILE, 'rendered-links coverage: chrome — the stub 2 (2 unique destinations)\\n');",
    ].join("\n");
    const record = freshRecord();
    const result = runCi(["--no-cache", "--json"], fullGateStubs({
      CI_RECORD_RUNBOOK_FILE: record,
      CI_COVERAGE_STAMP_FILE: stampPath,
      CI_TEST_SCRIPT: writeStub("record-test-stamp.mjs", stampingTest),
    }));

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.recorded).toBe("written");
    // The same reading rides the report, so a consumer sees the guard's coverage
    // without reading the runbook — and it is the line the bullet quotes, not a
    // second reading of it.
    expect(payload.coverageStamp).toBe(
      "rendered-links coverage: chrome — the stub 2 (2 unique destinations)",
    );
    const text = readFileSync(record, "utf8");
    // The stamp rides verbatim, as the bullet's own line between the per-stage
    // marks and the day's suspects.
    expect(text).toContain("  rendered-links coverage: chrome — the stub 2 (2 unique destinations).");
  }, 20_000);

  it("the report carries no coverage stamp when the suite left none", () => {
    // The base stub set signs no stamp: the payload's field reads `null` rather
    // than an empty string or a zero — an omission the consumer can distinguish
    // from a reading, never a fabricated number.
    const record = freshRecord();
    const result = runCi(["--no-cache", "--json"], fullGateStubs({ CI_RECORD_RUNBOOK_FILE: record }));

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).coverageStamp).toBeNull();
  }, 20_000);

  it("a stray file at the stamp's path rides nothing", () => {
    // The close reads a path the suite owns; a file there that is not the
    // stamp is not a reading the close would quote. The prefix check is what
    // keeps a scratch file's contents out of the runbook's prose.
    const junkPath = path.join(stubDir, "coverage-junk.txt");
    const junkTest = [
      "import { writeFileSync } from 'node:fs';",
      "const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);",
      "writeFileSync(out, JSON.stringify({",
      "  numTotalTests: 1, numFailedTests: 0,",
      "  testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }],",
      "}));",
      "writeFileSync(process.env.CI_COVERAGE_STAMP_FILE, 'scratch file at the stamp path\\n');",
    ].join("\n");
    const record = freshRecord();
    const result = runCi(["--no-cache", "--json"], fullGateStubs({
      CI_RECORD_RUNBOOK_FILE: record,
      CI_COVERAGE_STAMP_FILE: junkPath,
      CI_TEST_SCRIPT: writeStub("record-test-junk.mjs", junkTest),
    }));

    expect(result.status).toBe(0);
    const text = readFileSync(record, "utf8");
    expect(text).toContain("ci verdict:");
    expect(text).not.toContain("scratch file at the stamp path");
    expect(text).not.toContain("rendered-links coverage:");
  }, 20_000);

  it("appends nothing the second time the same run closes", () => {
    const record = freshRecord();
    const env = fullGateStubs({ CI_RECORD_RUNBOOK_FILE: record });
    const first = runCi(["--no-cache", "--json"], env);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).recorded).toBe("written");

    const second = runCi(["--no-cache", "--json"], env);
    expect(second.status).toBe(0);
    // The file already holds this run's bullet, so the close says so rather than
    // writing a second copy of the same run.
    expect(JSON.parse(second.stdout).recorded).toBe("deduped");
    expect(readFileSync(record, "utf8").match(/ci verdict:/g)).toHaveLength(1);
    // And the dedupe is logged — a note on the close, so a reader of the log
    // tells "the record already sat there" from "nothing was recorded at all".
    expect(second.stderr).toContain("already holds this run's bullet");
  }, 20_000);

  it("a stamped rerun dedupes on the whole bullet, stamp line included", () => {
    // The stamp is part of the record now, so two closes of the same stamped run
    // dedupe on the bullet *with* its stamp line: one bullet, one reading — and
    // the dedupe logged, the payload's `deduped` echoed where a reader looks.
    const record = freshRecord();
    const env = fullGateStubs({
      CI_RECORD_RUNBOOK_FILE: record,
      ...stampingGate("record-test-stamp-rerun.mjs", path.join(stubDir, "coverage-stamp-rerun.txt")),
    });
    const first = runCi(["--no-cache", "--json"], env);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).recorded).toBe("written");

    const second = runCi(["--no-cache", "--json"], env);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).recorded).toBe("deduped");
    expect(second.stderr).toContain("already holds this run's bullet");
    const text = readFileSync(record, "utf8");
    expect(text.match(/ci verdict:/g)).toHaveLength(1);
    expect(text.match(/rendered-links coverage:/g)).toHaveLength(1);
  }, 20_000);

  it("a genuine run's record is not swallowed by an identical-looking earlier bullet", () => {
    // The incident: an earlier bullet — a hand-written record, here — shared the
    // run's date, verdict counts, and outcome, and a heading-only dedupe swallowed
    // the genuine close for the resemblance, so the run's own record never landed.
    // The stand-in below is the genuine bullet minus its stamp line: identical to
    // the eye, different as a record — and only the difference that exists earns
    // the append.
    const record = freshRecord();
    const stamping = stampingGate("record-test-stamp-genuine.mjs", path.join(stubDir, "coverage-stamp-genuine.txt"));
    // A first close writes the genuine bullet; the stand-in is that bullet with
    // the stamp line lifted out, so the two differ by the stamp and nothing else.
    const probe = freshRecord();
    const first = runCi(["--no-cache", "--json"], fullGateStubs({ ...stamping, CI_RECORD_RUNBOOK_FILE: probe }));
    expect(first.status).toBe(0);
    const standIn = readFileSync(probe, "utf8").replace(
      /\n  rendered-links coverage: chrome — the stub 2 \(2 unique destinations\)\.\n/,
      "",
    );
    writeFileSync(record, standIn, "utf8");

    const result = runCi(["--no-cache", "--json"], fullGateStubs({ ...stamping, CI_RECORD_RUNBOOK_FILE: record }));
    expect(result.status).toBe(0);
    // Written, not deduped: the earlier bullet only looks like this run's.
    expect(JSON.parse(result.stdout).recorded).toBe("written");
    const text = readFileSync(record, "utf8");
    // Both records sit in the file — the stand-in, and the genuine close under it.
    expect(text.match(/ci verdict:/g)).toHaveLength(2);
    // The stamp line is the fact the old heading-only dedupe would have erased.
    expect(text).toContain("  rendered-links coverage: chrome — the stub 2 (2 unique destinations).");
  }, 20_000);

  it("--no-record leaves the runbook unwritten", () => {
    const record = freshRecord();
    const result = runCi(["--no-cache", "--json", "--no-record"], fullGateStubs({ CI_RECORD_RUNBOOK_FILE: record }));

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).recorded).toBe("declined");
    expect(existsSync(record)).toBe(false);
  }, 20_000);

  it("records nothing for a selection slice", () => {
    const record = freshRecord();
    const result = runCi(["--only=runbook", "--no-cache", "--json"], {
      CI_RUNBOOK_SCRIPT: writeStub("record-slice-runbook.mjs", PASSING_RUNBOOK),
      CI_RECORD_RUNBOOK_FILE: record,
    });

    expect(result.status).toBe(0);
    // One bullet per full-gate run is the runbook's own convention: a `--only` probe
    // is a diagnostic, not a measured gate, and recording it would fill the file with
    // one bullet per development step.
    expect(JSON.parse(result.stdout).recorded).toBe("slice");
    expect(existsSync(record)).toBe(false);
  }, 20_000);

  it("a failed run marks the failure `failed` and names its stages", () => {
    const record = freshRecord();
    const result = runCi(["--no-cache", "--json", "--keep-going"], fullGateStubs({
      CI_RECORD_RUNBOOK_FILE: record,
      CI_LINT_SCRIPT: FAILING_LINT,
    }));

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).recorded).toBe("written");
    const text = readFileSync(record, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    // A red recorded as a red, with the failing stage named — the shape every
    // hand-written run bullet in the runbook takes.
    expect(text).toContain(
      `- **${today} — ci verdict: 10 passed, 1 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); failed: lint.**`,
    );
    expect(text).toContain("lint baseline FAIL");
    expect(text).not.toContain("all stages passed");
  }, 20_000);

  it("the day's concurrent-edit suspects ride the bullet", () => {
    // The shared-tree red, produced as the suspects describe produces it: a scratch pin
    // holding one real `.mjs` probe in `.freebuff`, and a stub runbook that appends to
    // the probe while the run is between its opening snapshot and its close — and fails,
    // so the run is red, which is when a suspect is worth recording beside.
    const probeName = "ci-record-probe.mjs";
    const probe = path.join(projectRoot, ".freebuff", probeName);
    const fixture = path.join(stubDir, "ci-record-pin.mjs");
    const record = freshRecord();
    const watches = [
      ...DEFAULT_WATCHES,
      { dir: ".freebuff", pattern: `^${probeName.replace(/\./g, "\\.")}$` },
    ];
    const stub = writeStub(
      "record-suspect-runbook.mjs",
      [
        "import { appendFileSync } from 'node:fs';",
        "appendFileSync(process.env.CI_RECORD_PROBE, '\\nexport const touched = 1;\\n');",
        "process.stdout.write(JSON.stringify({",
        "  gate: 'fail', exitCode: 1, sections: 60,",
        "  message: 'run.md: Contents is stale (61 section(s)).',",
        "}));",
      ].join("\n"),
    );
    writeFileSync(probe, "export const seeded = 1;\n", "utf8");
    writeFileSync(fixture, renderManifest({ algorithm: "sha1", watches, files: pin([], watches) }), "utf8");
    try {
      const result = runCi(["--no-cache", "--json", "--keep-going"], fullGateStubs({
        CI_RECORD_RUNBOOK_FILE: record,
        CI_RUNBOOK_SCRIPT: stub,
        CI_RECORD_PROBE: probe,
        GATE_HASHES_FILE: fixture,
        CI_PIN_SNAPSHOT_FILE: path.join(stubDir, "pin-snapshot-record.json"),
      }));

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).recorded).toBe("written");
      const text = readFileSync(record, "utf8");
      // The attribution line, indented under the bullet it belongs to.
      expect(text).toContain("  Suspects: .freebuff/ci-record-probe.mjs (changed).");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 20_000);

  it("an unwritable runbook is a warning, never a verdict", () => {
    const record = path.join(stubDir, "record-blocker", "run.md");
    writeFileSync(path.join(stubDir, "record-blocker"), "a file, not a directory", "utf8");
    const result = runCi(["--no-cache", "--json"], fullGateStubs({ CI_RECORD_RUNBOOK_FILE: record }));

    // The gate is green and stays green: an unwritable record target is a stderr
    // note, not a failure — a recording aid cannot be the thing that flips a verdict.
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).recorded).toBe("failed");
    expect(result.stderr).toContain("could not record the run in");
  }, 20_000);
});
