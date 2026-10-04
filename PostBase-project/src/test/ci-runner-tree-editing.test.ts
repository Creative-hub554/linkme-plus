/// <reference types="vite/client" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeScratchDir, removeScratchDir } from "./scratch";

/**
 * A test for what the CI runner does about the stages whose run rewrites the working
 * tree: the cache policy that refuses to answer one of them from a recorded pass, the
 * lock a killed check leaves behind, what the runner does about it before its stages
 * run, and how it reads on the run page — the last two cases carry a payload the *real*
 * runner wrote through the *real* `.freebuff/nightly-report.mjs`, so the seam between
 * them is covered by evidence rather than by a fixture someone kept in step by hand.
 *
 * It is a file of its own rather than more blocks in `ci-runner.test.ts` for a reason
 * worth recording. That file is ~110 `spawnSync` calls deep, and a handful more runs of
 * the real runner pushed its Vitest worker past the keepalive: `[vitest-worker]: Timeout
 * calling "onTaskUpdate"` with every test passing and the command still exiting 1, and
 * once a real 5s test timeout on a spawn that had simply queued too long. All of that
 * behavior belongs to the runner's tree-editing stages, so it lives here, where it costs
 * one worker a few seconds instead of lengthening the suite's longest file.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const ciRunner = path.join(projectRoot, ".freebuff", "ci.mjs");
const reporter = path.join(projectRoot, ".freebuff", "nightly-report.mjs");

let stubDir: string;

beforeAll(() => {
  stubDir = makeScratchDir("ci-recovery-test-");
});

afterAll(() => {
  removeScratchDir(stubDir);
});

/** Writes a stub script and answers its absolute path. */
function writeStub(name: string, body: string): string {
  const stubPath = path.join(stubDir, name);
  writeFileSync(stubPath, body, "utf8");
  return stubPath;
}

let cacheSeq = 0;
let reportSeq = 0;

/**
 * A cache path nothing has written yet, so a run that does not pass one explicitly
 * starts cold and never reads — or writes — the developer's own `.ci/cache.json`. A
 * test that wants to observe reuse passes the same path twice.
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

/** Reads a cache file a run just wrote, so a test can assert what it recorded. */
function readCache(cacheFile: string): CacheFile {
  return JSON.parse(readFileSync(cacheFile, "utf8")) as CacheFile;
}

/**
 * Runs the real nightly report CLI over a payload, the way the nightly job does: the
 * same `--report` file, the same stdout. Nothing here is imported, so the Markdown and
 * the workflow commands under test are exactly what a run page receives.
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

/**
 * Runs the real CI runner against the stubs above, with a lock path the caller names.
 * `CI` is cleared so the run keeps the *local*, fail-fast behavior even inside a CI
 * environment, and the cache goes to a throwaway so no test reads — or writes — the
 * developer's own `.ci/cache.json`.
 */
function runCi(args: string[], env: Record<string, string> = {}) {
  cacheSeq += 1;
  return spawnSync(process.execPath, [ciRunner, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "",
      CI_CACHE_FILE: path.join(stubDir, `cache-${cacheSeq}.json`),
      ...env,
    },
  });
}

const PASSING_PREFLIGHT = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'pass', exitCode: 0, only: null, registerUrl: null,",
  "  failures: [], warnings: [],",
  "  checks: [{ name: 'node_modules', status: 'ok', detail: 'installed' }],",
  "}) + '\\n');",
].join("\n");
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
 * The coverage-gate counterpart of `RECORDING_MUTATION`: it records that it ran, so a
 * stage that must never be reused is proved to have run twice rather than to have
 * printed a banner.
 */
/**
 * A passing preflight that records that it ran (into `$CI_STUB_MARKER`), so a reuse is
 * proved by the stage *not* executing rather than by a banner the runner could print
 * for any reason.
 */
const RECORDING_PREFLIGHT = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.CI_STUB_MARKER, 'ran');",
  "process.stdout.write(JSON.stringify({",
  "  gate: 'pass', exitCode: 0, failures: [], warnings: [],",
  "  checks: [{ name: 'node_modules', status: 'ok', detail: 'installed' }],",
  "}) + '\\n');",
].join("\n");

const RECORDING_MUTATION_COVERAGE = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.CI_STUB_MARKER, 'ran');",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 5, files: 1, survivors: [] }) + '\\n');",
].join("\n");

/** A stub coverage-gate mutation run that passes. */
const PASSING_MUTATION_COVERAGE = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 5, files: 1, survivors: [] }) + '\\n');",
].join("\n");

/**
 * A stub sweep that records it was reached (`$CI_STUB_MARKER`) and passes, so "the stage
 * ran again" is proved by the marker rather than by a banner the runner could print for
 * any reason.
 */
const RECORDING_MUTATION = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.CI_STUB_MARKER, 'ran');",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 1, survivors: [] }) + '\\n');",
].join("\n");

/** The guard sweep's stub, for a run that reaches it beside the skipped coverage check. */
const PASSING_MUTATION = [
  "if (!process.argv.includes('--json')) process.exit(3);",
  "process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 1, survivors: [] }) + '\\n');",
].join("\n");

/** A project-relative, forward-slashed path, the form the lock module reports in. */
function rel(pathname: string): string {
  return path.relative(projectRoot, pathname).split(path.sep).join("/");
}

/**
 * A lock file in the shape `.freebuff/mutation-lock.mjs` writes, naming one file a
 * killed check had mutated. The runner reads it through `MUTATION_LOCK_FILE` — the same
 * seam the crash-safety suites use — so no test points it at the lock a real run reads.
 */
function seedLock(options: {
  lockFile: string;
  path: string;
  original: string;
  mutated: string;
  pid?: number;
  splice?: { at: number; removed: string; inserted: string };
}): void {
  const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
  writeFileSync(
    options.lockFile,
    `${JSON.stringify(
      {
        pid: options.pid ?? 999999,
        startedAt: "2026-09-28T00:00:00.000Z",
        check: "coverage mutation check",
        file: {
          path: options.path,
          kind: "gate",
          where: "src/test/coverage-propose.test.ts",
          original: options.original,
          originalHash: sha1(options.original),
          mutatedHash: sha1(options.mutated),
          ...(options.splice ? { splice: options.splice } : {}),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/**
 * The state a killed run leaves behind: a weakened file, and the lock that names it.
 * `pid` defaults to one that cannot be running, which is the kill case — a lock whose
 * pid is alive belongs to a check that is editing the tree right now.
 */
function seedKill(name: string, options: { pid?: number } = {}) {
  const target = path.join(stubDir, `${name}-target.mjs`);
  const lockFile = path.join(stubDir, `${name}-lock.json`);
  const original = "// the pre-mutation source\n";
  const mutated = "// the weakened source\n";
  writeFileSync(target, mutated, "utf8");
  seedLock({ lockFile, path: target, original, mutated, ...options });
  return { target, lockFile, original, mutated };
}

/**
 * The state a *leaked* mutation leaves, which is not the killed-run state above: another
 * writer edited the file on top of the mutated source, so the check's own text is still in
 * it and the lock describes neither version. The holder is dead, so the runner puts the
 * pre-mutation source back over both — the edit was written on top of a mutated file, and
 * it is named in the message rather than kept silently — and what cannot be healed is only
 * the state where that restore does not verify, which still stops the run, because what
 * would be left carries the weakened check the sweep was mutating with.
 */
function seedAbsorbed(name: string) {
  const target = path.join(stubDir, `${name}-target.mjs`);
  const lockFile = path.join(stubDir, `${name}-lock.json`);
  const original = "// the pre-mutation source\n";
  const mutation = "// the weakened source\n";
  const mutated = original + mutation;
  const current = `${mutated}// a later edit by someone else\n`;
  writeFileSync(target, current, "utf8");
  seedLock({
    lockFile,
    path: target,
    original,
    mutated,
    splice: { at: original.length, removed: "", inserted: mutation },
  });
  return { target, lockFile, current };
}

describe("the CI runner's interrupted-run recovery", () => {
  /**
   * A killed tree-editing check leaves a file mutated behind a lock, and the only thing
   * that puts it back is the check that owns it running again — which `--skip`, `--only`
   * and `--changed-only` can all decide not to do, and which the failure budget can stop
   * the run short of. Worse, a file left weakened is what every stage *before* the healer
   * would have measured. So the runner heals the tree itself, ahead of its stages, and
   * these tests pin where that recovery is reported: on the owning stage's own row when
   * that stage runs, and in the run's own voice when it does not.
   */

  it("heals a killed run's lock in place of a stage --skip excludes", () => {
    const kill = seedKill("skip");
    const result = runCi(["--only=preflight", "--skip=mutation-coverage"], {
      CI_PREFLIGHT_SCRIPT: writeStub("recover-skip.mjs", PASSING_PREFLIGHT),
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(result.status).toBe(0);
    // The tree is whole again even though the stage that owns the lock never ran…
    expect(readFileSync(kill.target, "utf8")).toBe(kill.original);
    expect(existsSync(kill.lockFile)).toBe(false);
    // …and the run says so, naming the stage it stood in for. A silent heal would leave
    // a reader of a green run page unable to tell that the gates measured a whole tree.
    expect(result.stdout).toContain(
      "── interrupted run recovery (in place of coverage gate mutation) ──",
    );
    expect(result.stdout).toContain(`WARN RECOVERED  ${rel(kill.target)}`);
    expect(result.stdout).toContain("RESTORED");
  });

  it("heals a lock when --changed-only leaves its stage out, and reports it in the payload", () => {
    const kill = seedKill("unchanged");
    const result = runCi(["--changed-only", "--only=mutation-coverage", "--json"], {
      CI_CHANGED_FILES: "src/lib/foo.ts",
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(kill.target, "utf8")).toBe(kill.original);
    expect(existsSync(kill.lockFile)).toBe(false);

    const payload = JSON.parse(result.stdout);
    expect(payload.unchanged).toContain("mutation-coverage");
    expect(payload.recovered).toHaveLength(1);
    expect(payload.recovered[0]).toMatchObject({
      action: "restored",
      check: "coverage mutation check",
      stage: "mutation-coverage",
      label: "coverage gate mutation",
      mark: "WARN RECOVERED",
    });
    // A heal is a warning on a green run, never a failure: the gate it stands in for was
    // not measured, but nothing was measured against a mutated file either.
    expect(payload.annotations).toEqual([
      expect.objectContaining({ level: "warning", title: "coverage gate mutation" }),
    ]);
  });

  it("reports a lock it healed on the owning stage's own row when that stage runs", () => {
    const kill = seedKill("row");
    const result = runCi(["--only=mutation-coverage"], {
      CI_MUTATION_COVERAGE_SCRIPT: writeStub("recover-row.mjs", PASSING_MUTATION_COVERAGE),
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(kill.target, "utf8")).toBe(kill.original);
    expect(existsSync(kill.lockFile)).toBe(false);
    expect(result.stdout).toContain(
      "PASS  coverage gate mutation — 5 coverage gate(s) checked, no survivors — 1 recovered lock",
    );
    expect(result.stdout).toContain(`WARN RECOVERED  ${rel(kill.target)}`);
    // The row carries it, so the run does not narrate it a second time.
    expect(result.stdout).not.toContain("── interrupted run recovery");
  });

  it("heals a lock whose stage a failure stopped the run short of", () => {
    const kill = seedKill("stopped");
    const result = runCi(["--only=lint,mutation-coverage"], {
      CI_LINT_SCRIPT: writeStub("recover-lint.mjs", FAILING_LINT),
      CI_MUTATION_COVERAGE_SCRIPT: writeStub("recover-never.mjs", PASSING_MUTATION_COVERAGE),
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(result.status).toBe(1);
    // The stage that would have healed it is one the failure budget never reached…
    expect(result.stderr).toContain("ci: stopped early — 1 stage(s) not run: mutation-coverage");
    expect(result.stdout).toContain("0 passed, 1 failed, 1 skipped");
    // …and the tree is whole anyway, because the heal ran before any stage did.
    expect(readFileSync(kill.target, "utf8")).toBe(kill.original);
    expect(existsSync(kill.lockFile)).toBe(false);
    expect(result.stdout).toContain("in place of coverage gate mutation");
  });

  it("describes a lock a live check holds instead of healing it", () => {
    // `process.pid` is this worker, which is alive for as long as the child runs: the
    // lock belongs to a check editing the tree right now, so the file is not ours to
    // put back and the lock is not ours to clear.
    const kill = seedKill("held", { pid: process.pid });
    const result = runCi(["--only=preflight"], {
      CI_PREFLIGHT_SCRIPT: writeStub("recover-held.mjs", PASSING_PREFLIGHT),
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(kill.target, "utf8")).toBe(kill.mutated);
    expect(existsSync(kill.lockFile)).toBe(true);
    expect(result.stdout).toContain("WARN LOCK HELD");
    expect(result.stdout).toContain("is being mutated by a running tree-editing check");
  });

  it("heals an absorbed mutation and carries it as the stage's recovered-lock detail", () => {
    const absorbed = seedAbsorbed("absorbed");
    // The stage that owns the lock (the seed writes `check: "coverage mutation check"`)
    // runs as a stub, so the heal is asserted on the stage's own row — the same shape the
    // plain kill below reports.
    const result = runCi(["--only=mutation-coverage", "--json"], {
      CI_MUTATION_COVERAGE_SCRIPT: writeStub("absorbed-stage.mjs", PASSING_MUTATION_COVERAGE),
      MUTATION_LOCK_FILE: absorbed.lockFile,
    });

    // The holder is dead and nothing was coming that could measure or undo the file, so
    // the run puts the pre-mutation source back — the later edit goes with the mutation,
    // named in the message — and then runs its stages, which is the point.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARN RECOVERED");
    expect(result.stdout).toContain("absorbed the mutation instead of replacing");
    expect(readFileSync(absorbed.target, "utf8")).toBe("// the pre-mutation source\n");
    expect(existsSync(absorbed.lockFile)).toBe(false);

    // The stage that owns the lock carries the heal on its own row — the same shape the
    // plain kill below reports — and the message says which state it was, so a reader
    // never has to wonder whether an edit was lost.
    const payload = JSON.parse(result.stdout);
    expect(payload.stages[0].summary).toContain("— 1 recovered lock");
    expect(payload.stages[0].details[0]).toMatchObject({
      mark: "WARN RECOVERED",
      detail: expect.stringContaining("absorbed the mutation instead of replacing"),
    });
  });

  it("carries a recovered lock from the runner's payload onto the run page", () => {
    const kill = seedKill("page-row");
    const run = runCi(["--only=mutation-coverage", "--json"], {
      CI_MUTATION_COVERAGE_SCRIPT: writeStub("page-row-stage.mjs", PASSING_MUTATION_COVERAGE),
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(run.status).toBe(0);
    expect(readFileSync(kill.target, "utf8")).toBe(kill.original);
    expect(existsSync(kill.lockFile)).toBe(false);

    const payload = JSON.parse(run.stdout);
    // The stage's own summary carries it: the first thing a reader of the job log sees,
    // and the line the run page's table repeats.
    expect(payload.stages[0].summary).toContain("— 1 recovered lock");
    expect(payload.stages[0].details[0]).toMatchObject({
      mark: "WARN RECOVERED",
      detail: expect.stringContaining("RESTORED"),
    });

    const summary = renderReport(payload);
    expect(summary.status).toBe(0);
    expect(summary.stdout).toContain(
      "| coverage gate mutation | ✅ pass | 5 coverage gate(s) checked, no survivors — 1 recovered lock |",
    );
    expect(summary.stdout).toContain("### Warnings");
    expect(summary.stdout).toContain("- **WARN RECOVERED** (coverage gate mutation)");
    expect(summary.stdout).toContain("RESTORED");
    // Still a pass: a healed tree is a warning on a green stage, never a failure.
    expect(summary.stdout).not.toContain("### Failures");

    // And the diff gets told, as a warning rather than an error.
    const annotated = renderReport(payload, ["--annotations"]);
    expect(annotated.stdout).toContain("::warning file=");
    expect(annotated.stdout).not.toContain("::error");
  });

  it("carries a lock healed in place of a skipped stage onto the run page", () => {
    const kill = seedKill("page-skip");
    // `--skip` removes it from the selection rather than leaving it unchanged, so it is
    // named as excluded — and no stage row can carry the recovery it did not do.
    const run = runCi(["--only=mutation-coverage,mutation", "--skip=mutation-coverage", "--json"], {
      CI_MUTATION_SCRIPT: writeStub("page-skip-sweep.mjs", PASSING_MUTATION),
      MUTATION_LOCK_FILE: kill.lockFile,
    });

    expect(run.status).toBe(0);
    expect(readFileSync(kill.target, "utf8")).toBe(kill.original);

    const payload = JSON.parse(run.stdout);
    expect(payload.excluded).toContain("mutation-coverage");
    expect(payload.recovered).toHaveLength(1);
    expect(payload.recovered[0]).toMatchObject({ stage: "mutation-coverage" });

    const summary = renderReport(payload);
    expect(summary.stdout).toContain(
      "Lock(s) an interrupted run left behind, dealt with in place of a stage that did " +
        "not run: 1 healed.",
    );
    expect(summary.stdout).toContain(
      "- **WARN RECOVERED** (in place of coverage gate mutation, which did not run)",
    );
    // The `--skip` disclaimer is still there, and the heal does not soften it.
    expect(summary.stdout).toContain("A stage listed as excluded was **not run** in this job");
    expect(summary.stdout).not.toContain("### Failures");

    const annotated = renderReport(payload, ["--annotations"]);
    expect(annotated.stdout).toContain("::warning file=");
    expect(annotated.stdout).toContain("title=coverage gate mutation");
  });
});

describe("the runner's tree-editing stages and the result cache", () => {
  /**
   * The cache policy that the recovery depends on: a stage whose run edits the tree is
   * never answered from a recorded pass. These two cases drove that from
   * `ci-runner.test.ts` and moved here with the recovery — same subject (a stage whose
   * run rewrites the working tree), and that file is the suite's longest, so runs of the
   * real runner belong anywhere but in it.
   */

  it("never answers a tree-editing stage from the cache", () => {
    const cases: Array<[stage: string, seam: string, stub: string]> = [
      ["mutation-coverage", "CI_MUTATION_COVERAGE_SCRIPT", RECORDING_MUTATION_COVERAGE],
      ["mutation", "CI_MUTATION_SCRIPT", RECORDING_MUTATION],
    ];

    for (const [stage, seam, stubBody] of cases) {
      const stub = writeStub(`${stage}-tree.mjs`, stubBody);
      const cacheFile = freshCachePath();
      const firstMarker = path.join(stubDir, `${stage}-tree-first.marker`);
      const secondMarker = path.join(stubDir, `${stage}-tree-second.marker`);
      const env = { [seam]: stub, CI_CACHE_FILE: cacheFile };

      const cold = runCi([`--only=${stage}`], { ...env, CI_STUB_MARKER: firstMarker });
      const warm = runCi([`--only=${stage}`], { ...env, CI_STUB_MARKER: secondMarker });

      expect(cold.status).toBe(0);
      expect(warm.status).toBe(0);
      // A pass is on record — the pass the cache would have answered with…
      expect(readCache(cacheFile).stages[stage].pass).toBe(true);
      // …and the stage ran anyway, both times.
      expect(existsSync(firstMarker)).toBe(true);
      expect(existsSync(secondMarker)).toBe(true);
      expect(warm.stdout).not.toContain("REUSE");
      expect(warm.stdout).toContain(
        "ci: verdict — 1 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (1 selected)",
      );
    }
  }, 20_000);

  it("explains a tree-editing stage as a run with a matching pass on record", () => {
    const stub = writeStub("explain-tree.mjs", RECORDING_MUTATION_COVERAGE);
    const cacheFile = freshCachePath();
    const env = { CI_MUTATION_COVERAGE_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=mutation-coverage"], {
      ...env,
      CI_STUB_MARKER: path.join(stubDir, "explain-tree.marker"),
    });
    const result = runCi(["--explain-cache", "--only=mutation-coverage"], env);

    expect(result.status).toBe(0);
    // The entry is the one this tree earned — the digest would match — and the stage
    // still runs, because a pass vouches for the tree it leaves behind.
    expect(result.stdout).toContain(
      "run       — its run edits the tree, which a recorded pass cannot vouch for",
    );
    expect(result.stdout).not.toContain("reuse     —");
  });

  it("records the tree a pass leaves behind beside the one it started from", () => {
    const stub = writeStub("record-both.mjs", PASSING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const result = runCi(["--only=preflight"], {
      CI_PREFLIGHT_SCRIPT: stub,
      CI_CACHE_FILE: cacheFile,
    });

    expect(result.status).toBe(0);
    const entry = readCache(cacheFile).stages.preflight;
    expect(entry.pass).toBe(true);
    // Two readings of the same globs, one either side of the pass. They are equal here
    // because passing changed nothing the preflight reads — and both are on record,
    // which is what makes a pass that *did* change them visible in the file.
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.startedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.startedHash).toBe(entry.hash);
  });

  it("reuses a recorded pass only against the tree it left, not the one it started from", () => {
    const firstMarker = path.join(stubDir, "key-rule-first.marker");
    const secondMarker = path.join(stubDir, "key-rule-second.marker");
    const thirdMarker = path.join(stubDir, "key-rule-third.marker");
    const stub = writeStub("key-rule.mjs", RECORDING_PREFLIGHT);
    const cacheFile = freshCachePath();
    const env = { CI_PREFLIGHT_SCRIPT: stub, CI_CACHE_FILE: cacheFile };

    runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: firstMarker });
    const recorded = readCache(cacheFile);
    const entry = recorded.stages.preflight;

    // A pass whose recorded `hash` names a tree it did not leave is not a pass this run
    // may be answered with: `hash` is the field that governs.
    writeFileSync(
      cacheFile,
      JSON.stringify({
        version: recorded.version,
        stages: { preflight: { ...entry, hash: "0".repeat(64) } },
      }),
      "utf8",
    );
    const ran = runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: secondMarker });
    expect(ran.status).toBe(0);
    expect(existsSync(secondMarker)).toBe(true);
    expect(ran.stdout).not.toContain("REUSE");

    // …and `startedHash` is evidence about the pass, not a second key to match.
    writeFileSync(
      cacheFile,
      JSON.stringify({
        version: recorded.version,
        stages: { preflight: { ...entry, startedHash: "0".repeat(64) } },
      }),
      "utf8",
    );
    const reused = runCi(["--only=preflight"], { ...env, CI_STUB_MARKER: thirdMarker });
    expect(reused.status).toBe(0);
    expect(existsSync(thirdMarker)).toBe(false);
    expect(reused.stdout).toContain("REUSE preview preflight");
  }, 20_000);

  it("answers the cache only for the stages that do not edit the tree", () => {
    const cacheFile = freshCachePath();
    const env = {
      CI_PREFLIGHT_SCRIPT: writeStub("policy-preflight.mjs", PASSING_PREFLIGHT),
      CI_MUTATION_COVERAGE_SCRIPT: writeStub("policy-coverage.mjs", PASSING_MUTATION_COVERAGE),
      CI_CACHE_FILE: cacheFile,
    };
    const selection = ["--only=preflight,mutation-coverage"];

    const cold = runCi(selection, env);
    expect(cold.status).toBe(0);
    // Both passed, and both are on record — the policy is about what may be *reused*.
    expect(Object.keys(readCache(cacheFile).stages).sort()).toEqual([
      "mutation-coverage",
      "preflight",
    ]);

    // The second run answers for exactly one of them, and says why for the other.
    const explained = runCi([...selection, "--explain-cache", "--json"], env);
    expect(explained.status).toBe(0);
    const payload = JSON.parse(explained.stdout);
    const decisions: Record<string, { decision: string; reason: string }> = Object.fromEntries(
      payload.stages.map((stage: { name: string }) => [stage.name, stage]),
    );
    expect(decisions.preflight).toMatchObject({
      decision: "reuse",
      reason: "inputs unchanged since a passing run",
    });
    expect(decisions["mutation-coverage"]).toMatchObject({
      decision: "run",
      reason: "its run edits the tree, which a recorded pass cannot vouch for",
    });
    expect(payload.reused).toEqual(["preflight"]);
  });
});

