/// <reference types="vite/client" />
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The preflight sweep, driven for real — without paying for a sweep.
 *
 * `npm run mutation:preflight` applies twenty-eight mutations to the preflight one at a
 * time and requires the preflight's test file to fail under each, which is twenty-eight
 * Vitest processes and cannot share the always-on suite. What *can* be pinned cheaply is the
 * half that rots first: the table's own fit. An anchor that no longer occurs exactly once
 * means a mutation silently stops being applied (the branch goes unchecked), and an
 * `expect` no test title carries any more means the table's claim about which test holds a
 * branch has quietly become a claim about nothing. Both are `--list`, which runs nothing.
 *
 * The recovery half is here too, because the sweep rewrites a real file: a lock left by a
 * killed run must put the source back, and one held by a live run must stop this sweep
 * rather than let two checks fight over one tree. Every spawn is kept off the lock a real
 * run reads (`MUTATION_LOCK_FILE`), because a test must never hold — or heal — the tree a
 * mutation check is using.
 */
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sweep = path.join(projectRoot, ".freebuff", "mutation-preflight.mjs");
// The sweep's vocabulary module: the table under test is declared there now, so a copy of the
// sweep carries it along — written beside sibling copies, spliced when a case declares a word
// the table must lack.
const vocabulary = path.join(projectRoot, ".freebuff", "mutation-vocabulary.mjs");
const preflight = path.join(projectRoot, ".freebuff", "preview-preflight.mjs");
const preflightTest = path.join(projectRoot, "src", "test", "preview-preflight.test.ts");

/** The slice of `--list --json` these cases read. */
interface ListPayload {
  target: string;
  test: string;
  cases: number;
  gate: "pass" | "fail";
  exitCode: number;
  anchors: {
    id: string;
    what: string;
    status: string;
    occurrences: number;
    expect: string;
    expectPresent: boolean;
  }[];
  drifted: string[];
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

const scratch = mkdtempSync(path.join(tmpdir(), "mutation-preflight-sweep-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lockFile = path.join(scratch, ".mutation-lock.json");

/** Runs the real sweep in the project, with the lock pointed away from the project's own. */
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [sweep, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, MUTATION_LOCK_FILE: lockFile, ...env },
  });
}

/** A pid that is genuinely gone: a process spawned and already reaped. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid ?? 0;
}

/**
 * The lock the two tree-editing checks share, written by hand because a kill is the one
 * thing a test cannot stage. `pid` decides which of the two callers' branches runs: a dead
 * one is recoverable, a live one makes the run stand down.
 */
function seedLock(entry: { pid: number; path: string; original: string; mutated: string }) {
  writeFileSync(
    lockFile,
    `${JSON.stringify(
      {
        pid: entry.pid,
        startedAt: new Date().toISOString(),
        check: "preflight sweep",
        file: {
          path: entry.path,
          kind: "mutation",
          where: "loopback/parses",
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

function scratchFile(name: string, content: string): string {
  const file = path.join(scratch, name);
  writeFileSync(file, content);
  return file;
}


describe("the preflight sweep's table against the tree it mutates", () => {
  it("finds every committed mutation anchored exactly once, naming a test that exists", () => {
    const result = run(["--list", "--json"]);
    const payload = JSON.parse(result.stdout) as ListPayload;

    expect(result.status).toBe(0);
    expect(payload.gate).toBe("pass");
    expect(payload.exitCode).toBe(0);
    expect(payload.cases).toBe(payload.anchors.length);
    expect(payload.drifted).toEqual([]);
    // Every anchor is present exactly once, and the test each one names is really there.
    for (const anchor of payload.anchors) {
      expect(anchor.occurrences, anchor.id).toBe(1);
      expect(anchor.status, anchor.id).toBe("unique");
      expect(anchor.expectPresent, anchor.id).toBe(true);
    }
    // The table covers every check this sweep exists for, not one of them: a family that
    // emptied out is how a whole check stops being swept without anything going red.
    for (const family of ["health/", "reach/", "owner/", "tab/", "loopback/", "report/"]) {
      expect(
        payload.anchors.some((anchor) => anchor.id.startsWith(family)),
        family,
      ).toBe(true);
    }
  });

  it("reports an anchor the source no longer holds, rather than skipping it", () => {
    // A copy of the preflight with one anchor rewritten — the shape a source edit leaves.
    const drifted = scratchFile(
      "preview-preflight.mjs",
      readFileSync(preflight, "utf8").replace(
        "if (!lockPidAlive) {",
        "if (lockPidAlive === false) {",
      ),
    );
    const result = run(["--list", "--json"], { MUTATION_PREFLIGHT_TARGET: drifted });
    const payload = JSON.parse(result.stdout) as ListPayload;

    expect(result.status).toBe(1);
    expect(payload.gate).toBe("fail");
    expect(payload.drifted).toEqual(["health/no-live-pid"]);
    const anchor = payload.anchors.find((entry) => entry.id === "health/no-live-pid");
    expect(anchor?.status).toBe("missing");
    expect(anchor?.occurrences).toBe(0);
    // One anchor drifted, not the table: the alarm is per entry, so the other
    // twenty-six still read as usable rather than the whole sweep being reported stale.
    expect(payload.anchors.filter((entry) => entry.status === "unique")).toHaveLength(
      payload.anchors.length - 1,
    );
  });

  it("reports a mutation whose test title has been renamed under it", () => {
    const renamed = scratchFile(
      "preview-preflight.test.ts",
      readFileSync(preflightTest, "utf8").replace(
        "keeps the stale-lock advice for a dead pid, so the two cases are told apart",
        "keeps the stale-lock wording for a dead pid",
      ),
    );
    const result = run(["--list", "--json"], { MUTATION_PREFLIGHT_TEST: renamed });
    const payload = JSON.parse(result.stdout) as ListPayload;

    expect(result.status).toBe(1);
    expect(payload.drifted).toEqual(["health/no-live-pid"]);
    const anchor = payload.anchors.find((entry) => entry.id === "health/no-live-pid");
    expect(anchor?.status).toBe("unique");
    expect(anchor?.expectPresent).toBe(false);
  });

  it("refuses a real sweep from inside a test run, naming the opt-out", () => {
    const result = run(["--only=health/no-live-pid"], { VITEST: "true" });

    // Started from a suite, a real sweep would outlive the case that started it and leave
    // the preflight rewritten with no lock behind it — which is exactly what happened once,
    // and is what this refusal exists to prevent. A test that needs a stage sweeps a stub.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refusing to sweep from inside a Vitest run");
    expect(result.stderr).toContain("MUTATION_PREFLIGHT_ALLOW_NESTED=1");
  });

  it("still checks the table and recovers from inside a test run", () => {
    // The refusal is about *sweeping*, not about the read-only half: `--list` is how an
    // edit finds out its table drifted, and it must work wherever it is run.
    expect(run(["--list", "--json"], { VITEST: "true" }).status).toBe(0);
  });

  it("refuses a selector that matches no mutation instead of sweeping nothing", () => {
    const result = run(["--list", "--json", "--only=nope"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--only=nope matched no mutation");
    // The refusal names what was available, so the fix is a read rather than a search.
    expect(result.stderr).toContain("health/no-live-pid");
  });

  it("refuses a real sweep before its first mutation when an anchor has left the source", () => {
    // The `--list` case above reports a drifted anchor, but a real sweep is the half that
    // *mutates*: it must refuse before it applies anything, not report the drift after the
    // cases ahead of it have already rewritten the tree for minutes. The rot is made
    // guaranteed rather than left to one line's exact text — every loopback anchor is built
    // on `"localhost"`, so renaming that token rots them whatever else the file says.
    const drifted = scratchFile(
      "sweep-drifted.mjs",
      readFileSync(preflight, "utf8").split('"localhost"').join('"not-this-machine"'),
    );
    const before = readFileSync(drifted, "utf8");

    const result = run([], {
      MUTATION_PREFLIGHT_TARGET: drifted,
      // The refusal that keeps a real sweep out of a suite is not what is under test here;
      // the anchor refusal is, and it fires first — so no case is ever started.
      MUTATION_PREFLIGHT_ALLOW_NESTED: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("refusing before the first mutation");
    expect(result.stdout).toContain("loopback/is-loopback");
    // No case started: a run that reached the loop would print `[1/28]` and spawn a Vitest.
    expect(result.stdout).not.toContain("[1/");
    expect(result.stdout).not.toContain("Checked");
    // Nothing was written, and no lock was taken.
    expect(readFileSync(drifted, "utf8")).toBe(before);
    expect(existsSync(lockFile)).toBe(false);
  });

  it("reads the whole table, refusing a rot its own slice would never have reached", () => {
    const drifted = scratchFile(
      "sweep-drifted-slice.mjs",
      readFileSync(preflight, "utf8").split('"localhost"').join('"not-this-machine"'),
    );

    // `--limit=0` leaves the sweep nothing to run, so a check that lived inside the loop
    // would report a clean pass over zero cases. It refuses instead, and the `--json` report
    // says nothing was checked — the whole-set read, like the guard sweep's.
    const result = run(["--limit=0", "--json"], {
      MUTATION_PREFLIGHT_TARGET: drifted,
      MUTATION_PREFLIGHT_ALLOW_NESTED: "1",
    });
    const payload = JSON.parse(result.stdout) as {
      gate: string;
      exitCode: number;
      checked: number;
      selected: number;
      survivors: { id: string; kind: string; detail: string }[];
    };

    expect(result.status).toBe(1);
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.checked).toBe(0);
    expect(payload.selected).toBe(0);
    const broken = payload.survivors.filter((item) => item.kind === "broken");
    expect(broken.map((item) => item.id)).toContain("loopback/is-loopback");
    expect(broken.every((item) => item.detail.includes("occurs 0 time(s)"))).toBe(true);
  });
});

describe("the preflight sweep's recovery of a tree a killed run left mutated", () => {
  it("puts the file back from the lock, and clears the lock", () => {
    const original = "const wedged = lockPidAlive;\n";
    const mutated = "const wedged = lockPidAlive && !anyReachable;\n";
    const file = scratchFile("left-mutated.mjs", mutated);
    seedLock({ pid: deadPid(), path: file, original, mutated });

    const result = run(["--recover"]);

    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(existsSync(lockFile)).toBe(false);
  });

  it("leaves a file someone else edited alone, keeping the lock", () => {
    const original = "const wedged = lockPidAlive;\n";
    const mutated = "const wedged = lockPidAlive && !anyReachable;\n";
    const theirs = "const wedged = somebodyElsesEdit;\n";
    const file = scratchFile("edited-since.mjs", theirs);
    seedLock({ pid: deadPid(), path: file, original, mutated });

    const result = run(["--recover"]);

    // Neither side of the recorded edit: the lock's copy is older than that change, so
    // restoring it would lose work. The lock stays as the record for a human.
    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(theirs);
    expect(existsSync(lockFile)).toBe(true);
  });

  it("stands down while another run holds the tree, touching nothing", () => {
    const file = scratchFile("held.mjs", "const wedged = lockPidAlive && !anyReachable;\n");
    seedLock({ pid: process.pid, path: file, original: "const wedged = lockPidAlive;\n", mutated: "x" });

    const result = run(["--list", "--json"]);

    // Two checks must not edit one tree: the sweep refuses before it reads anything.
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("REFUSING TO START");
    expect(readFileSync(file, "utf8")).toBe("const wedged = lockPidAlive && !anyReachable;\n");
    expect(existsSync(lockFile)).toBe(true);
  });
});

/**
 * The survivor vocabulary the sweep refuses over: the words its report can name, held
 * against the kinds its own source stamps. The hole lives in the sweep's own file and in
 * no tree a seam can reach, so these cases run a *copy* of the sweep — spliced with the
 * break under test, byte-identical otherwise — over a real target and a scope that runs
 * no mutation (`--limit=0`), so the copy can never strike anything even if the refusal
 * later stopped firing.
 */
describe("the preflight sweep's survivor vocabulary", () => {
  interface SweepPayload {
    gate: string;
    exitCode: number;
    checked: number;
    survivors: { id?: string; kind: string; descriptor: string; detail: string }[];
  }

  /**
   * A copy of the real sweep with `swap` applied once, run over the real target with the
   * lock pointed away from the project's. The copy sits beside the sweep's own siblings
   * (its relative imports must resolve), which is why the copy is deleted afterwards.
   */
  function runCopy(swap: { from: string; to: string }, args: string[] = ["--limit=0"]) {
    const source = readFileSync(sweep, "utf8");
    // The sweep's table is imported from the vocabulary module, so a copy that is to read a
    // *different* table gets both halves rewritten: a copy of the module — spliced when the
    // swap names table text (`const PREFLIGHT_SURVIVOR_WORDS = {`), verbatim otherwise — and
    // the copy's import re-pointed at that module copy, since a sibling copy cannot take the
    // real module's path and a swap in a file the copy never reads would be a no-op. Every
    // non-table swap stays in the sweep's own source, and must still occur exactly once there.
    const moduleSwaps = new Set(["const PREFLIGHT_SURVIVOR_WORDS = {"]);
    const inModule = moduleSwaps.has(swap.from);
    const moduleSource = readFileSync(vocabulary, "utf8");
    expect((inModule ? moduleSource : source).split(swap.from).length - 1).toBe(1);
    const copy = path.join(projectRoot, ".freebuff", "mutation-preflight.copy-for-test.mjs");
    // Named for this suite: the other sweep suites write their own module copy, and two
    // workers writing one file would hand a copy the wrong table mid-run.
    const moduleCopy = path.join(projectRoot, ".freebuff", "mutation-vocabulary.preflight-copy.mjs");
    // The recovery describe above leaves a live-pid lock standing as its record; these
    // cases read the sweep whole, so they point at their own lock and leave nothing.
    const copyLock = path.join(scratch, "vocabulary-lock.json");
    writeFileSync(
      copy,
      inModule
        ? source.replace(
            'from "./mutation-vocabulary.mjs";',
            'from "./mutation-vocabulary.preflight-copy.mjs";',
          )
        : source.replace(swap.from, swap.to),
    );
    writeFileSync(moduleCopy, inModule ? moduleSource.replace(swap.from, swap.to) : moduleSource);
    try {
      // `MUTATION_PREFLIGHT_ALLOW_NESTED` names the opt-in the sweep itself documents: the
      // refusal that keeps a real sweep out of a suite is not what is under test here, and
      // the scope runs no mutation either way.
      return spawnSync(process.execPath, [copy, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MUTATION_LOCK_FILE: copyLock,
          MUTATION_PREFLIGHT_ALLOW_NESTED: "1",
        },
      });
    } finally {
      rmSync(copy, { force: true });
      rmSync(moduleCopy, { force: true });
      rmSync(copyLock, { force: true });
    }
  }

  it("runs clean when the stamps and the declared words agree, so the refusal is not a blanket one", () => {
    const result = runCopy({ from: "const TIMEOUT_MS", to: "const TIMEOUT_MS" }, ["--limit=0", "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.gate).toBe("pass");
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toEqual([]);
  });

  it("refuses a stamp no declared word covers, before the first mutation", () => {
    // The shape a future entry leaves: a stamp the report has no bucket for. The copy stamps
    // the inconclusive survivor "partial" — a literal, the shape the scan reads — so the
    // scan, not the words, is what catches it.
    const result = runCopy(
      {
        from: '      kind: "broken",\n      descriptor: item.what,\n      detail: outcome.reason,',
        to: '      kind: "partial",\n      descriptor: item.what,\n      detail: outcome.reason,',
      },
      ["--limit=0", "--json"],
    );

    expect(result.status).toBe(1);
    // Under `--json` the refusal is the payload a consumer already reads — the reason a
    // `broken` survivor, `checked: 0` — and the human report above it names the same thing.
    expect(result.stderr).toContain("START-UP REFUSAL (1)");
    expect(result.stderr).toContain('kind "partial"');
    expect(result.stderr).toContain('it stamps a kind SURVIVOR_WORDS does not declare, so the report counts a survivor under it nowhere');
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({ kind: "broken", descriptor: 'a survivor stamped "partial"', detail: 'it stamps kind "partial", which SURVIVOR_WORDS does not declare' });
    // The scope ran no mutation, so no lock was taken: the refusal is before the first save.
    expect(existsSync(path.join(scratch, "vocabulary-lock.json.tmp"))).toBe(false);
  });

  it("refuses a declared word no survivor can ever carry", () => {
    // A word added to the table with nothing stamping it is the quieter side: a bucket the
    // report claims and no survivor can fill.
    // The word goes into the sweep's table where it is declared now — the vocabulary module
    // beside the copy — so the stamp scan and the refusal read it exactly as a word added to
    // the shared table by hand.
    const result = runCopy({
      from: 'const PREFLIGHT_SURVIVOR_WORDS = {',
      to: 'const PREFLIGHT_SURVIVOR_WORDS = {\n  forsaken: { mark: "FORSAKEN", why: "nothing" },',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("START-UP REFUSAL (1)");
    expect(result.stdout).toContain('the "forsaken" word');
    expect(result.stdout).toContain("SURVIVOR_WORDS declares it, and no survivor can ever carry it");
  });

  it("still reports a vocabulary hole when the slice it would run is empty", () => {
    // The same whole-set read the anchor refusal makes: a narrowed sweep may not report a
    // pass while a hole stands in a kind its slice would never have stamped.
    const result = runCopy(
      {
        from: 'const PREFLIGHT_SURVIVOR_WORDS = {',
        to: 'const PREFLIGHT_SURVIVOR_WORDS = {\n  forsaken: { mark: "FORSAKEN", why: "nothing" },',
      },
      ["--limit=0", "--only=health/no-live-pid", "--json"],
    );

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}") as SweepPayload;
    expect(payload.checked).toBe(0);
    expect(payload.survivors[0]).toMatchObject({ descriptor: 'the "forsaken" word' });
  });

  it("spells each reason once, in the survivor object the report and the payload both read", () => {
    // Every reason sentence lives in exactly one place: the survivor object the `--json`
    // payload carries. The refusal, the `--list` table and the mid-run report print through
    // `reasonLines`, so a reason re-worded at any one of them is a red case, not two
    // truthful-sounding sentences.
    const source = readFileSync(sweep, "utf8");
    // The anchor reason — inside `brokenAnchor.detail`, built once.
    const anchor = source.match(/its anchor occurs \$\{[^}]+\} time\(s\), expected exactly 1/g) ?? [];
    expect(anchor, "the anchor reason must be spelled once (inside brokenAnchor)").toHaveLength(1);
    // The survived reasons — the table prints the lines, the payload folds them into one
    // `detail`, so each clause is spelled once beside its twin.
    expect(source.match(/passed with this branch broken/g) ?? []).toHaveLength(2);
    expect(source.match(/is expected to fail here and did not/g) ?? []).toHaveLength(1);
    // The report paths reach the sentence through the builders, not beside their own copy.
    expect(source).toContain("reasonLines(brokenAnchor({ item: row, occurrences: row.occurrences }))");
    expect(source).toContain("reasonLines(survivor)");
    // Runtime: the printed refusal line is the payload's `detail`, byte for byte. The rot
    // is scoped (`--limit=0` leaves nothing to run; the refusal reads the table whole), and
    // the lock is the vocabulary describe's own — the recovery describe above leaves a
    // live-pid lock standing as its record.
    const rotted = scratchFile(
      "reason-drifted.mjs",
      readFileSync(preflight, "utf8").replace("if (!lockPidAlive) {", "if (lockPidAlive === false) {"),
    );
    const reasonLock = path.join(scratch, "vocabulary-lock.json");
    const plain = spawnSync(process.execPath, [sweep, "--limit=0"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: reasonLock,
        MUTATION_PREFLIGHT_TARGET: rotted,
        MUTATION_PREFLIGHT_ALLOW_NESTED: "1",
      },
    });
    const asJson = spawnSync(process.execPath, [sweep, "--limit=0", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: reasonLock,
        MUTATION_PREFLIGHT_TARGET: rotted,
        MUTATION_PREFLIGHT_ALLOW_NESTED: "1",
      },
    });
    rmSync(reasonLock, { force: true });
    const payload = JSON.parse(asJson.stdout ?? "{}");
    expect(payload.survivors.length).toBeGreaterThan(0);
    expect(payload.survivors[0].detail).toEqual(expect.any(String));
    expect(plain.stdout).toContain(payload.survivors[0].detail);
  });

  /**
   * The report-only table, the guard sweep's `--vocabulary` by the same name: every declared
   * word beside the stamps that fill its bucket, and any hole named rather than left for the
   * refusal. It answers before the anchor check and the nested-run guard, reading nothing but
   * the sweep's own source and the shared table, so it is the cheapest way to see whether a
   * run would begin — and the human-readable half of what the refusal would say.
   */
  it("lists each declared word beside the stamps that fill its bucket, report-only", () => {
    const plain = spawnSync(process.execPath, [sweep, "--vocabulary"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: path.join(scratch, "vocabulary-lock.json") },
    });
    const asJson = spawnSync(process.execPath, [sweep, "--vocabulary", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: path.join(scratch, "vocabulary-lock.json") },
    });
    const payload = JSON.parse(asJson.stdout ?? "{}") as {
      mode: string;
      file: string;
      words: { word: string; mark: string; stamps: { file: string; line: number; text: string }[] }[];
      unnamed: string[];
      unspoken: string[];
      gate: string;
      exitCode: number;
    };

    // A clean vocabulary answers 0, names its mode, and carries every declared word with its
    // mark and the exact lines that stamp it — the shape a hole case reads an empty bucket
    // apart from a missing word.
    expect(plain.status).toBe(0);
    expect(asJson.status).toBe(0);
    expect(payload.mode).toBe("vocabulary");
    expect(payload.gate).toBe("pass");
    expect(payload.unnamed).toEqual([]);
    expect(payload.unspoken).toEqual([]);
    expect(payload.words).toHaveLength(2);
    for (const word of payload.words) {
      // A bucket is never only a count: the stamps carry their sites, in the sweep itself.
      expect(word.stamps.length, `no stamp listed for "${word.word}"`).toBeGreaterThan(0);
      for (const stamp of word.stamps) {
        expect(stamp.file).toBe(".freebuff/mutation-preflight.mjs");
        expect(stamp.text).toContain(`kind: "${word.word}"`);
      }
    }
    expect(payload.words.find((word) => word.word === "survived")?.mark).toBe("SURVIVED");
    expect(payload.words.find((word) => word.word === "broken")?.mark).toBe("UNCHECKED");

    // The human report speaks the same table: the words, their marks, and the stamps with
    // their line numbers.
    expect(plain.stdout).toContain('"survived" (SURVIVED): 1 stamp(s) the bucket reads');
    expect(plain.stdout).toContain('"broken" (UNCHECKED): 3 stamp(s) the bucket reads');
    expect(plain.stdout).toContain("every declared word is stamped, and every stamp names a declared word.");

    // Report-only: no lock was taken, and the sweep ran no mutation — a vocabulary table
    // reads the sweep's own source, never the tree.
    expect(existsSync(path.join(scratch, "vocabulary-lock.json"))).toBe(false);
  });

  it("answers --vocabulary before the anchor check, so a drifted target is not its business", () => {
    // The same drifted copy that makes `--list` exit 1: the table mode reads the sweep's own
    // stamps, never the target, so it answers about the vocabulary even while the sweep's
    // own table is a refusal waiting to happen — the two reports answer different questions.
    const drifted = scratchFile(
      "vocabulary-target.mjs",
      readFileSync(preflight, "utf8").replace("if (!lockPidAlive) {", "if (lockPidAlive === false) {"),
    );
    const result = spawnSync(process.execPath, [sweep, "--vocabulary"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: path.join(scratch, "vocabulary-lock.json"),
        MUTATION_PREFLIGHT_TARGET: drifted,
      },
    });
    expect(result.status, `--vocabulary paid for the anchor check:\n${result.stderr ?? ""}`).toBe(0);
    expect(result.stdout).toContain("every declared word is stamped");
  });

  it("names a vocabulary hole in the table before any run would refuse, under --vocabulary", () => {
    // The module copy carries the spliced word; the copy reads it through the re-pointed
    // import, and the table names the word nothing stamps — the refusal's quieter half, in
    // the human-readable shape a reader can act on without a run.
    const result = runCopy(
      {
        from: "const PREFLIGHT_SURVIVOR_WORDS = {",
        to: 'const PREFLIGHT_SURVIVOR_WORDS = {\n  forsaken: { mark: "FORSAKEN", why: "nothing" },',
      },
      ["--vocabulary"],
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"forsaken" (FORSAKEN): 0 stamp(s) the bucket reads');
    expect(result.stdout).toContain('UNSPOKEN  the "forsaken" word');
    expect(result.stderr).toContain("vocabulary hole(s)");
  });
});
