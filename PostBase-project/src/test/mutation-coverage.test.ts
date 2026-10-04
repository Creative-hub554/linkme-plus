/// <reference types="vite/client" />
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const launcher = path.join(projectRoot, ".freebuff", "mutation-coverage.mjs");
// The launcher's vocabulary module: the tables under test are declared there now, so a copy
// of the launcher carries it along — written beside sibling copies, spliced when a case
// declares a word the table must lack.
const vocabulary = path.join(projectRoot, ".freebuff", "mutation-vocabulary.mjs");

/**
 * The lock these tests seed and read, kept in the test's own temp directory: the
 * launcher is pointed at it with `MUTATION_LOCK_FILE` (see `.freebuff/mutation-lock.mjs`),
 * so the suite never holds the lock a real run would — and the sweep's crash-safety
 * suite, which runs in another worker, never races this one for the same file.
 */
let lockPath = "";
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

/**
 * The coverage-gate mutation launcher's contract.
 *
 * `.freebuff/mutation-coverage.mjs` exists so the gate mutation check is a *gate*:
 * it runs `src/test/coverage-mutation.test.ts` under the isolating config, reads
 * Vitest's JSON report, and answers the shape `.freebuff/mutation-guards.mjs`
 * answers — `gate`, `checked`, one entry per survivor — which is what lets
 * `.freebuff/ci.mjs` report a survived coverage gate the way it reports a survived
 * route guard, and the nightly job carry it without knowing about it.
 *
 * The mapping *is* the launcher, so that is what this file drives. A stub takes
 * Vitest's place through `MUTATION_COVERAGE_VITEST`: it writes the report it was
 * handed to whatever `--outputFile=` it was given and exits with the status it was
 * told to, so each test can put one shape of run in front of the real launcher and
 * assert what it made of it:
 *
 *   - every case passed → `gate: "pass"`, `checked` equal to the cases, no survivors;
 *   - a case whose message says the mutation survived → a `survived` survivor,
 *     which is the finding this whole check exists to produce;
 *   - a file that would not load, a case that was skipped, an empty run, and a run
 *     that wrote no report → `broken` survivors, because a check that cannot answer
 *     is a gate nobody is holding, not a pass.
 *
 * The stub also records the argv it saw, so the flags the launcher promises Vitest
 * — `run --config vitest.mutation.config.ts --reporter=json --outputFile=…` — are
 * pinned rather than assumed: a rename on either side shows up here.
 *
 * The second half of the file is the other thing that makes the check safe to run:
 * its **crash safety**. The check holds a lock while a gate script is weakened (see
 * `.freebuff/mutation-coverage.mjs`), so a process killed in that window leaves a
 * record the next start restores from. `--recover` is that recovery on its own, and
 * these tests drive it against a lock written by hand — the exact state a killed run
 * leaves behind, and the one thing a test cannot stage. The lock names a temp file
 * rather than a real gate script, because recovery keys on the path the lock carries,
 * so no live `.freebuff/coverage-*.mjs` is ever at risk.
 */

let stubDir = "";
let argvFile = "";
let workdir = "";

beforeAll(() => {
  stubDir = mkdtempSync(path.join(tmpdir(), "mutation-coverage-test-"));
  argvFile = path.join(stubDir, "argv.log");
  workdir = mkdtempSync(path.join(tmpdir(), "mutation-lock-"));
  lockPath = path.join(workdir, "lock.json");
});

afterEach(() => {
  // Leave no lock for a later test of this file to find.
  for (const file of [lockPath, `${lockPath}.tmp`]) rmSync(file, { force: true });
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

/** One case in a stubbed Vitest report, as the JSON reporter spells it. */
interface StubCase {
  title: string;
  status: "passed" | "failed" | "pending";
  messages?: string[];
}

/**
 * A Vitest `--reporter=json` report, in the slice the launcher reads: one file per
 * entry, each with its cases. Paths are absolute because Vitest's are.
 */
function stubReport(
  files: { path: string; cases?: StubCase[]; failedToLoad?: string }[],
) {
  return {
    numTotalTests: files.reduce((sum, file) => sum + (file.cases ?? []).length, 0),
    testResults: files.map((file) => ({
      name: path.join(projectRoot, file.path),
      status: file.failedToLoad !== undefined || (file.cases ?? []).some((c) => c.status === "failed")
        ? "failed"
        : "passed",
      message: file.failedToLoad ?? "",
      assertionResults: (file.cases ?? []).map((item) => ({
        ancestorTitles: ["the coverage gates are load-bearing"],
        fullName: `the coverage gates are load-bearing > ${item.title}`,
        title: item.title,
        status: item.status,
        failureMessages: item.messages ?? [],
      })),
    })),
  };
}

/**
 * A stand-in for Vitest: write the report it was handed to the `--outputFile` it
 * was given, record its argv, and exit with the status it was told to. A stub with
 * no report is the crashed run — it says why on stderr and writes nothing.
 */
function writeStub(
  name: string,
  options: { report?: unknown; exitCode?: number; stderr?: string } = {},
): string {
  const stubPath = path.join(stubDir, name);
  writeFileSync(
    stubPath,
    [
      'import { appendFileSync, writeFileSync } from "node:fs";',
      "const flag = process.argv.find((arg) => arg.startsWith('--outputFile='));",
      "if (!flag) process.exit(3);",
      "if (process.env.STUB_ARGV_FILE) {",
      "  appendFileSync(process.env.STUB_ARGV_FILE, `${process.argv.slice(2).join(' ')}\\n`);",
      "}",
      options.report === undefined
        ? ""
        : `writeFileSync(flag.slice('--outputFile='.length), ${JSON.stringify(
            JSON.stringify(options.report),
          )}, "utf8");`,
      options.stderr === undefined ? "" : `process.stderr.write(${JSON.stringify(options.stderr)});`,
      `process.exit(${options.exitCode ?? 0});`,
    ]
      .filter(Boolean)
      .join("\n"),
    "utf8",
  );
  return stubPath;
}

/** Runs the real launcher against a stub Vitest, with the same flags CI passes. */
function runLauncher(stubPath: string, args: string[] = []) {
  return spawnSync(process.execPath, [launcher, "--json", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, MUTATION_LOCK_FILE: lockPath, MUTATION_COVERAGE_VITEST: stubPath, STUB_ARGV_FILE: argvFile },
  });
}

/**
 * The lock an interrupted run leaves: one script, its pre-mutation source and the
 * mutation it was carrying, exactly as `.freebuff/mutation-coverage.mjs` writes it.
 * The tests write it by hand because a SIGKILL — the only thing that leaves one
 * behind — is not something a test can stage.
 */
function seedLock(entry: {
  path: string;
  original: string;
  mutated: string;
  pid?: number;
  check?: string;
  kind?: string;
  where?: string;
}) {
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        pid: entry.pid ?? 999999,
        startedAt: new Date().toISOString(),
        check: entry.check ?? "coverage mutation check",
        file: {
          path: entry.path,
          kind: entry.kind ?? "gate",
          where: entry.where ?? "src/test/coverage-floor.test.ts",
          original: entry.original,
          originalHash: sha1(entry.original),
          mutatedHash: sha1(entry.mutated),
        },
      },
      null,
      2,
    )}\n`,
  );
}

/** Runs the real launcher's recovery-only mode. */
function runRecover() {
  return spawnSync(process.execPath, [launcher, "--recover"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, MUTATION_LOCK_FILE: lockPath },
  });
}

/** The launcher's `--json` report, parsed, with the stderr kept for a failure message. */
function reportOf(result: { stdout: string; stderr: string }) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `The launcher wrote no parsable JSON report.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

describe("the coverage mutation launcher's report", () => {
  it("passes when every gate was caught by its weakening", () => {
    writeFileSync(argvFile, "");
    const stub = writeStub("clean.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          cases: [
            { title: "fails the floor test when the floor is weakened", status: "passed" },
            { title: "fails the headroom test when the headroom is weakened", status: "passed" },
            { title: "fails the scopes test when the matcher is unanchored", status: "passed" },
            { title: "fails the report test when its margin moves", status: "passed" },
            { title: "fails the proposer test when earned widens", status: "passed" },
          ],
        },
      ]),
    });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    expect(result.status).toBe(0);
    expect(payload.gate).toBe("pass");
    expect(payload.checked).toBe(5);
    expect(payload.files).toBe(1);
    expect(payload.survivors).toEqual([]);
    // No lock on the way in is reported as an empty list, so a consumer can read the
    // field unconditionally.
    expect(payload.recovered).toEqual([]);
    // The flags the check's isolation depends on, pinned rather than assumed: it
    // must run the one file the isolated config names, under that config, through
    // the JSON reporter whose report the launcher reads back.
    const argv = readFileSync(argvFile, "utf8").trim();
    expect(argv).toContain("run");
    expect(argv).toContain("--config vitest.mutation.config.ts");
    expect(argv).toContain("--reporter=json");
    expect(argv).toContain("--outputFile=");
  });

  it("refuses when it weakened fewer gates than the declared strike list", () => {
    // The shrink this catches: a strike deleted from `src/test/coverage-mutations.ts` leaves
    // the check walking a shorter table, so every case that remains passes and the run reads
    // clean. The declaration in `.freebuff/coverage-strikes.mjs` says how many there should be,
    // so a four-case run against a five-strike list is a refusal — a `broken` survivor, exit 1
    // — rather than a pass over the gates that are left. (The default suite holds the same
    // declaration against the table both ways; this is the opt-in run's half.)
    const stub = writeStub("short.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          cases: [
            { title: "fails the floor test when the floor is weakened", status: "passed" },
            { title: "fails the headroom test when the headroom is weakened", status: "passed" },
            { title: "fails the scopes test when the matcher is unanchored", status: "passed" },
            { title: "fails the report test when its margin moves", status: "passed" },
          ],
        },
      ]),
    });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    expect(result.status).toBe(1);
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(4);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({
      path: "src/test/coverage-mutation.test.ts",
      line: null,
      kind: "broken",
      descriptor: "the check weakened fewer gates than the declared strike list",
    });
    // Both numbers are in the message, so a reader sees the shrink without opening the report.
    expect(payload.survivors[0].detail).toContain("4 case(s)");
    expect(payload.survivors[0].detail).toContain("5 strike(s)");
    expect(payload.survivors[0].detail).toContain(".freebuff/coverage-strikes.mjs");
  });

  it("reports a survived weakening and a check that could not answer, differently", () => {
    const stub = writeStub("survivors.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          cases: [
            {
              title: "fails src/test/coverage-floor.test.ts when .freebuff/coverage-floor.mjs is weakened",
              status: "failed",
              messages: [
                "Error: Running src/test/coverage-floor.test.ts against the weakened " +
                  ".freebuff/coverage-floor.mjs still passed, so the mutation survived. It weakens: " +
                  "the floor would fail a file sitting exactly on it.",
              ],
            },
          ],
        },
        { path: "src/test/coverage-scopes.test.ts", failedToLoad: "Error: the anchor drifted" },
      ]),
    });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    expect(result.status).toBe(1);
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(2);
    expect(payload.survivors.map((item: { kind: string }) => item.kind)).toEqual([
      "survived",
      "broken",
    ]);
    // The surviving case names the gate it stopped pinning, and carries the reason.
    expect(payload.survivors[0]).toMatchObject({
      path: "src/test/coverage-mutation.test.ts",
      line: null,
      kind: "survived",
      descriptor:
        "the coverage gates are load-bearing > fails src/test/coverage-floor.test.ts when " +
        ".freebuff/coverage-floor.mjs is weakened",
    });
    expect(payload.survivors[0].detail).toContain("the mutation survived");
    // A file that would not load is its own survivor: without it the run would read
    // as a gate that was checked, when it was not.
    expect(payload.survivors[1]).toMatchObject({
      path: "src/test/coverage-scopes.test.ts",
      kind: "broken",
      descriptor: "the check file failed to load",
    });
    expect(payload.survivors[1].detail).toContain("anchor drifted");
  });

  it("reports a drifted anchor as a check that could not answer, never as a weakened gate", () => {
    // The exactly-once anchor assertion lives inside the check (`coverage-mutation.test.ts`),
    // and it runs *before* the script is weakened — so a renamed source line fails the case
    // with the anchor-drift wording and nothing was ever mutated. The launcher has to keep
    // that apart from a survivor: a gate that stopped being pinned is a finding about the
    // gate, while an anchor that no longer fits is a finding about the *check*, and reading
    // one as the other would overstate what was measured.
    const stub = writeStub("drifted-anchor.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          cases: [
            {
              title: "fails .freebuff/coverage-floor.mjs when it is weakened",
              status: "failed",
              messages: [
                'AssertionError: The mutation anchor "if (pct < threshold) {" occurs 0 time(s) ' +
                  "in .freebuff/coverage-floor.mjs, expected exactly once. The script changed " +
                  "shape — update this mutation so the check still weakens a real comparison.: " +
                  "expected 0 to be 1",
              ],
            },
          ],
        },
      ]),
    });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    expect(result.status).toBe(1);
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(1);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0].kind).toBe("broken");
    expect(payload.survivors[0].detail).toContain("occurs 0 time(s)");
    expect(payload.survivors[0].detail).not.toContain("the mutation survived");
  });

  it("treats a case that did not run as broken rather than as caught", () => {
    const stub = writeStub("skipped.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          cases: [
            { title: "fails the floor test when the floor is weakened", status: "passed" },
            { title: "fails the headroom test when the headroom is weakened", status: "pending" },
          ],
        },
      ]),
    });

    const payload = reportOf(runLauncher(stub));

    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(2);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0].kind).toBe("broken");
    expect(payload.survivors[0].detail).toBe("the case did not run");
  });

  it("fails loudly when the run wrote no report at all", () => {
    const stub = writeStub("crashed.mjs", {
      exitCode: 3,
      stderr: "Error: something in the check exploded\n",
    });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    expect(result.status).toBe(2);
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0].kind).toBe("broken");
    expect(payload.survivors[0].detail).toContain("something in the check exploded");
    // The human report carries the reason too — a crash is never silent.
    const human = spawnSync(process.execPath, [launcher], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_COVERAGE_VITEST: stub },
    });
    expect(human.status).toBe(2);
    expect(human.stderr + human.stdout).toContain("the check did not run");
  });

  it("fails loudly when the run collected nothing", () => {
    const stub = writeStub("empty.mjs", { report: { numTotalTests: 0, testResults: [] } });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    expect(result.status).toBe(2);
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(0);
    expect(payload.survivors[0].kind).toBe("broken");
    expect(payload.note).toContain("collected no case");
  });

  it("names a survivor and its reason in the human report", () => {
    const stub = writeStub("human.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          cases: [
            {
              title: "fails the scopes test when the matcher is unanchored",
              status: "failed",
              messages: [
                "AssertionError: Running src/test/coverage-scopes.test.ts against the weakened " +
                  ".freebuff/coverage-scopes.mjs still passed, so the mutation survived.",
              ],
            },
          ],
        },
      ]),
    });

    const result = spawnSync(process.execPath, [launcher], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_COVERAGE_VITEST: stub },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("SURVIVED  the coverage gates are load-bearing > fails the scopes test");
    expect(result.stdout).toContain("SURVIVED WEAKENING (1)");
    expect(result.stdout).toContain("still passed, so the mutation survived");
    // The summary line reads the vocabulary table's own sentences, so the bucket heading
    // and the closing count cannot come to mean different things.
    expect(result.stdout).toContain(
      "1 survivor(s): 1 a gate's own test file did not notice the weakening, " +
        "0 the check could not say whether the gate is load-bearing.",
    );
  });
});

describe("the coverage mutation check's crash safety", () => {
  it("restores a gate script an interrupted run left weakened, then clears the lock", () => {
    const target = path.join(workdir, "left-weakened.mjs");
    const original = "if (pct < threshold) {\n";
    const mutated = "if (pct <= threshold) {\n";
    writeFileSync(target, mutated);
    seedLock({ path: target, original, mutated });

    const result = runRecover();

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
    expect(result.stderr).toContain("RESTORED");
    // The lock names what it was mutating, so the log says which gate was put back.
    expect(result.stderr).toContain("coverage mutation check");
  });

  it("clears a stale lock whose script is already back to its original", () => {
    const target = path.join(workdir, "already-whole.mjs");
    const original = "new RegExp(`^${pattern}$`)\n";
    writeFileSync(target, original);
    seedLock({ path: target, original, mutated: "new RegExp(`${pattern}`)\n" });

    const result = runRecover();

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refuses to clobber a script edited since the lock was written, and keeps the lock", () => {
    const target = path.join(workdir, "edited-since.mjs");
    const original = "headroom < HEADROOM_TARGET\n";
    const foreign = "headroom < HEADROOM_TARGET // a person's edit\n";
    writeFileSync(target, foreign);
    seedLock({ path: target, original, mutated: "headroom <= HEADROOM_TARGET\n" });

    const result = runRecover();

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(foreign);
    expect(result.stderr).toContain("differs from both");
    expect(existsSync(lockPath)).toBe(true);
  });

  it("refuses to start while a live run holds the lock, without touching the script", () => {
    const target = path.join(workdir, "held.mjs");
    const original = "export const HEADROOM_TARGET = 1;\n";
    writeFileSync(target, original);
    // This test process is a real, running pid, so the launcher must see the lock as
    // owned and stand down rather than restore from a run that is still going.
    seedLock({ path: target, original, mutated: "weakened\n", pid: process.pid });

    const result = runRecover();

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("REFUSING TO START");
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  it("recovers before the run, so an ordinary run heals the tree on its way in", () => {
    const target = path.join(workdir, "healed-on-entry.mjs");
    const original = "if (headroom < minimum)\n";
    writeFileSync(target, "if (headroom <= minimum)\n");
    seedLock({ path: target, original, mutated: "if (headroom <= minimum)\n" });
    const stub = writeStub("mc-recovery-report.mjs", {
      report: stubReport([
        {
          path: "src/test/coverage-mutation.test.ts",
          // A clean run of the declared length: five cases, or the launcher's shrink guard would
          // (correctly) read a one-case pass as a strike deleted from the table.
          cases: [
            { title: "fails the floor test when the floor is weakened", status: "passed" },
            { title: "fails the headroom test when the headroom is weakened", status: "passed" },
            { title: "fails the scopes test when the matcher is unanchored", status: "passed" },
            { title: "fails the report test when its margin moves", status: "passed" },
            { title: "fails the proposer test when earned widens", status: "passed" },
          ],
        },
      ]),
    });

    const result = runLauncher(stub);
    const payload = reportOf(result);

    // The recovery ran on the way in, not only under `--recover`, and the check it
    // precedes still reported its own outcome.
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
    expect(result.stderr).toContain("RESTORED");
    expect(payload.gate).toBe("pass");
    expect(payload.checked).toBe(5);
    // …and the report says what it healed, so `.freebuff/ci.mjs` can put it on the run
    // page instead of leaving it in a stderr only a human reading the log would see.
    expect(payload.recovered).toHaveLength(1);
    expect(payload.recovered[0]).toMatchObject({
      action: "restored",
      check: "coverage mutation check",
      kind: "gate",
      where: "src/test/coverage-floor.test.ts",
    });
    expect(payload.recovered[0].message).toContain("RESTORED");
  });
});

/**
 * The survivor vocabulary the launcher refuses over: the words its report can name, held
 * against the kinds its own source stamps. The hole lives in the launcher's own file and
 * in no tree a seam can reach, so these cases run a *copy* of it — spliced with the break
 * under test, byte-identical otherwise — pointed at the stub Vitest, so the copy can never
 * weaken a real gate even if the refusal later stopped firing.
 */
describe("the coverage mutation launcher's survivor vocabulary", () => {
  interface SweepPayload {
    gate: string;
    exitCode: number;
    checked: number;
    survivors: { kind: string; descriptor: string; detail: string }[];
  }

  /**
   * A copy of the real launcher with `swap` applied once, run with a stub Vitest that
   * reports `cases` passed cases (or writes no report when none are given). The copy sits
   * beside the launcher's own siblings, which is why it is deleted afterwards — and because
   * the launcher's table is imported from the vocabulary module, a copy of that module is
   * written beside the copy (spliced when the swap names table text), the copy's import is
   * re-pointed at it, and both are deleted together.
   */
  function runCopy(
    swap: { from: string; to: string },
    cases: StubCase[] = [],
    args: string[] = ["--json"],
  ) {
    const source = readFileSync(launcher, "utf8");
    // The launcher's table is imported from the vocabulary module, so a copy that is to read
    // a *different* table gets both halves rewritten: a copy of the module — spliced when the
    // swap names table text, verbatim otherwise — and the copy's import re-pointed at that
    // module copy, since a sibling copy cannot take the real module's path and a swap in a
    // file the copy never reads would be a no-op. Only the table swap is aimed at the module
    // (the `KIND_*` stamp constants are the launcher's own); every other swap stays in the
    // launcher's own source and must still occur exactly once there.
    const moduleSwaps = new Set(["const COVERAGE_SURVIVOR_WORDS = {"]);
    const inModule = moduleSwaps.has(swap.from);
    const moduleSource = readFileSync(vocabulary, "utf8");
    expect((inModule ? moduleSource : source).split(swap.from).length - 1).toBe(1);
    const copy = path.join(projectRoot, ".freebuff", "mutation-coverage.copy-for-test.mjs");
    // Named for this suite: the other sweep suites write their own module copy, and two
    // workers writing one file would hand a copy the wrong table mid-run.
    const moduleCopy = path.join(projectRoot, ".freebuff", "mutation-vocabulary.coverage-copy.mjs");
    writeFileSync(
      copy,
      inModule
        ? source.replace(
            'from "./mutation-vocabulary.mjs";',
            'from "./mutation-vocabulary.coverage-copy.mjs";',
          )
        : source.replace(swap.from, swap.to),
    );
    writeFileSync(moduleCopy, inModule ? moduleSource.replace(swap.from, swap.to) : moduleSource);
    const stub = writeStub(
      "vocabulary-stub.mjs",
      cases.length === 0
        ? {}
        : {
            report: stubReport([
              {
                path: "src/test/coverage-mutation.test.ts",
                cases,
              },
            ]),
          },
    );
    try {
      return spawnSync(process.execPath, [copy, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MUTATION_LOCK_FILE: lockPath,
          MUTATION_COVERAGE_VITEST: stub,
        },
      });
    } finally {
      rmSync(copy, { force: true });
      rmSync(moduleCopy, { force: true });
    }
  }

  it("runs clean when the stamps and the declared words agree, so the refusal is not a blanket one", () => {
    // The stub carries two cases — one survived, one broken-shaped — so the control proves
    // a *reporting* run with both kinds is green when the vocabulary matches, not just an
    // empty one.
    const result = runCopy({ from: "const ROOT = fileURLToPath", to: "const ROOT = fileURLToPath" }, [
      {
        title: "fails the floor test when the floor is weakened",
        status: "failed",
        messages: ["Error: still passed, so the mutation survived. It weakens: x."],
      },
    ]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.checked).toBe(1);
    expect(payload.survivors.map((item) => item.kind)).toEqual(["survived"]);
  });

  it("refuses a stamp no declared word covers, before the check runs", () => {
    // The shape a future mapping leaves: a stamp the report has no bucket for. The copy
    // renames the word in stamp position, so the scan — which reads the stamps — is what
    // catches it, and the vocabulary hole is reported both ways it now disagrees.
    const result = runCopy({ from: 'const KIND_SURVIVED = "survived";', to: 'const KIND_SURVIVED = "outlived";' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("START-UP REFUSAL (2)");
    expect(result.stderr).toContain('kind "outlived"');
    expect(result.stderr).toContain('the "survived" word');
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(0);
    expect(payload.survivors.map((item) => item.descriptor)).toEqual([
      'a survivor stamped "outlived"',
      'the "survived" word',
    ]);
    // Vitest never ran: the refusal is before the check is spawned.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refuses a declared word no survivor can ever carry", () => {
    // Renaming the stamp constant makes both disagreements at once — the renamed stamp is
    // undeclared, the declared word unspoken — which is exactly how a vocabulary breaks in
    // practice, and the report names both sides in one pass.
    const result = runCopy({ from: 'const KIND_BROKEN = "broken";', to: 'const KIND_BROKEN = "forsaken";' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("START-UP REFUSAL (2)");
    expect(result.stderr).toContain('kind "forsaken"');
    expect(result.stderr).toContain('the "broken" word');
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.survivors.map((item) => item.descriptor)).toEqual([
      'a survivor stamped "forsaken"',
      'the "broken" word',
    ]);
  });

  it("still reports a vocabulary hole when the run behind it wrote no report at all", () => {
    // A hole outranks a crash: the launcher can answer neither question, but the reason it
    // cannot name its own survivors is the one a re-run cannot repair.
    const result = runCopy({ from: 'const KIND_SURVIVED = "survived";', to: 'const KIND_SURVIVED = "outlived";' }, []);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toHaveLength(2);
  });

  it("spells each bucket's reason once, in the table the report and the summary both read", () => {
    // The bucket sub-heading and the closing count read `SURVIVOR_WHY`, so a reason
    // re-worded at one of them is a red case, not two truthful-sounding sentences. Each
    // sentence lives exactly once, in the table — which is the shared vocabulary module now,
    // so the spelling scan reads there, while the readers stay pinned in the launcher.
    const source = readFileSync(launcher, "utf8");
    const table = readFileSync(vocabulary, "utf8");
    expect(table.match(/a gate's own test file did not notice the weakening/g) ?? []).toHaveLength(1);
    expect(table.match(/the check could not say whether the gate is load-bearing/g) ?? []).toHaveLength(1);
    expect(source).toContain("${SURVIVOR_WHY[kind]}");
    expect(source).toContain("${SURVIVOR_WHY.survived}");
    // Runtime: the human report's bucket heading and closing count speak the same sentence.
    // The default args are `--json`, so this one run asks for the human report instead.
    const result = runCopy(
      { from: "const ROOT = fileURLToPath", to: "const ROOT = fileURLToPath" },
      [
        {
          title: "fails the floor test when the floor is weakened",
          status: "failed",
          messages: ["Error: still passed, so the mutation survived. It weakens: x."],
        },
      ],
      [],
    );
    expect(result.stdout).toContain("SURVIVED WEAKENING (1) — a gate's own test file did not notice the weakening:");
    expect(result.stdout).toContain(
      "1 survivor(s): 1 a gate's own test file did not notice the weakening, " +
        "0 the check could not say whether the gate is load-bearing.",
    );
  });

  /**
   * The report-only table, the guard sweep's `--vocabulary` by the same name: every declared
   * word beside the stamps that fill its bucket, and any hole named rather than left for the
   * refusal. It answers before Vitest is spawned, reading nothing but the launcher's own
   * source and the shared table, so it is the cheapest way to see whether a check would begin
   * — and the human-readable half of what the refusal would say.
   */
  it("lists each declared word beside the stamps that fill its bucket, report-only", () => {
    const plain = spawnSync(process.execPath, [launcher, "--vocabulary"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: lockPath },
    });
    const asJson = spawnSync(process.execPath, [launcher, "--vocabulary", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: lockPath },
    });
    const payload = JSON.parse(asJson.stdout ?? "{}") as {
      mode: string;
      file: string;
      words: { word: string; mark: string; why: string; stamps: { file: string; line: number; text: string }[] }[];
      unnamed: string[];
      unspoken: string[];
      gate: string;
    };

    // A clean vocabulary answers 0, names its mode, and carries every declared word with its
    // mark, its why, and the exact lines that stamp it — the `KIND_*` constants the mapping
    // stamps through, not bare literals alone.
    expect(plain.status).toBe(0);
    expect(asJson.status).toBe(0);
    expect(payload.mode).toBe("vocabulary");
    expect(payload.gate).toBe("pass");
    expect(payload.unnamed).toEqual([]);
    expect(payload.unspoken).toEqual([]);
    expect(payload.words).toHaveLength(2);
    const survived = payload.words.find((word) => word.word === "survived");
    const broken = payload.words.find((word) => word.word === "broken");
    expect(survived?.mark).toBe("SURVIVED WEAKENING");
    expect(survived?.why).toBe("a gate's own test file did not notice the weakening");
    expect(survived?.stamps.map((stamp) => stamp.text)).toEqual(['const KIND_SURVIVED = "survived";']);
    expect(broken?.stamps.map((stamp) => stamp.text)).toEqual(['const KIND_BROKEN = "broken";']);

    // The human report speaks the same table, with the reason sentence as the bucket's own.
    expect(plain.stdout).toContain(
      '"survived" (SURVIVED WEAKENING): 1 stamp(s) the bucket reads — a gate\'s own test file did not notice the weakening',
    );
    expect(plain.stdout).toContain("every declared word is stamped, and every stamp names a declared word.");

    // Report-only: Vitest never ran, and no lock was left behind.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("answers --vocabulary before Vitest is spawned, reading no check and writing no report", () => {
    // The argv-pinning stub proves the spawn never happens: a vocabulary table answers about
    // the launcher's own source, so it has no business launching a check to say so. The argv
    // log is cleared first — the flag-pinning cases above leave theirs standing as a record.
    rmSync(argvFile, { force: true });
    const stub = writeStub("vocabulary-no-vitest.mjs", {});
    const result = spawnSync(process.execPath, [launcher, "--vocabulary"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: lockPath,
        MUTATION_COVERAGE_VITEST: stub,
        STUB_ARGV_FILE: argvFile,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("every declared word is stamped");
    expect(existsSync(argvFile)).toBe(false);
  });

  it("names a vocabulary hole in the table before any check would refuse, under --vocabulary", () => {
    // The module copy carries the spliced word; the copy reads it through the re-pointed
    // import, and the table names the word nothing stamps — the refusal's quieter half, in
    // the human-readable shape a reader can act on without a run.
    const result = runCopy(
      {
        from: "const COVERAGE_SURVIVOR_WORDS = {",
        to: 'const COVERAGE_SURVIVOR_WORDS = {\n  forsaken: "FORSAKEN",',
      },
      [],
      ["--vocabulary"],
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"forsaken" (FORSAKEN): 0 stamp(s) the bucket reads');
    expect(result.stdout).toContain('UNSPOKEN  the "forsaken" word');
    expect(result.stderr).toContain("vocabulary hole(s)");
  });
});
