/// <reference types="vite/client" />
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sweep = path.join(projectRoot, ".freebuff", "mutation-guards.mjs");
// The sweep's vocabulary module: a copy of the sweep that leaves it behind reads its table
// from nowhere, so the copy helpers below carry it along — re-pointed at the real module for
// copies in temp directories, written out beside sibling copies, and deleted with the copy.
const vocabulary = path.join(projectRoot, ".freebuff", "mutation-vocabulary.mjs");

/**
 * The lock this suite seeds, in the test's own temp directory: the sweep is pointed at
 * it with `MUTATION_LOCK_FILE` (see `.freebuff/mutation-lock.mjs`), so nothing here
 * touches the lock a real run holds — and the check that shares that lock file, whose
 * crash-safety suite runs in another worker, cannot race this one for it.
 */
let lockPath = "";

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

/**
 * The mutation sweep edits the working tree and restores each file in place. A
 * signal it can catch is handled — SIGINT/SIGTERM put the active file back before
 * exiting — but a SIGKILL, a closed terminal or a power cut runs no handler, and
 * a route left rewritten (`if ( false )`, or a refusal body replaced with a
 * success return) is served that way until someone notices. That is not
 * hypothetical: an interrupted sweep in this repo once left
 * `src/app/api/admin/moderate/route.ts` fail-open.
 *
 * The fix is a lock the sweep writes *before* it mutates and removes once the
 * file is back — `.freebuff/mutation-lock.mjs`, shared with the coverage gate
 * mutation check, which holds the same one file for the same reason. A lock that
 * outlives the process is the record the next start reads to put the file back.
 * These tests drive the real script (on `--list`, so no route test runs and no real
 * source is touched) against a lock this test writes by hand, which is the exact
 * state a killed sweep leaves behind:
 *
 *   - the file still matches the mutation → restore it and clear the lock;
 *   - the file is already whole → clear the lock, change nothing;
 *   - the file matches neither (a human edited it in between) → refuse to
 *     clobber, warn, and keep the lock;
 *   - …and it *still contains the mutation* — the later edit absorbed it rather
 *     than replacing it, which the lock can tell from the splice it records —
 *     the recorded source goes back over both, taking the mutation and the
 *     edit it sat on out together, because no sweep may measure the weakened
 *     source and the holder is dead; only a restore that does not verify is
 *     still refused (exit 2). Detection keeps its tiers — the window is compared
 *     with its whitespace flattened, and past a threshold the mutation's own
 *     inserted text is looked for on its own — while a short insertion loose in
 *     a stranger's file stays a warning;
 *   - the lock's owner is still running → refuse to start at all, so two sweeps
 *     never fight over the same file.
 *
 * The mutated file is a temp file, not a route: recovery keys on the path the
 * lock names, so the test never risks a live source file, and the `--list` mode
 * keeps the run to milliseconds.
 *
 * The other half of that claim lives in the sweep: `.freebuff/mutation-guards.mjs` carries two
 * strikes (`LOCK_MUTATIONS`, kind `lock`) — one quiets the whole leak check by making
 * `absorbedStretch` answer `null`, and one quiets only its last, weakest answer, the mutation's
 * own inserted text looked for once the region around it is gone — and the last case here pins
 * both halves of each: the name as `--list` enumerates it, and the line it rewrites in the
 * module. So the refusal cannot lose the strike that holds it, and the strike cannot lose the
 * code it fits. A strike with no case behind it is a refusal that reads healthy, which is the
 * failure this whole pass is about.
 *
 * The last suite in this file is the other direction of the same worry: a strike that loses
 * the *code* it fits — a renamed anchor — is not silently skipped any more, it stops the
 * sweep. Those cases drive the real script through the `MUTATION_STRIKE_ROOT` seam against a
 * scratch copy of the targets, so an anchor can be rotted without touching a real file.
 */
const NO_MATCHES = "--file=__mutation_recovery_no_such_route__";

let workdir: string;

function runSweep(args: string[]) {
  return spawnSync(process.execPath, [sweep, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, MUTATION_LOCK_FILE: lockPath },
  });
}

/**
 * Runs the sweep with its self-mutation targets read from a scratch tree, through the
 * `MUTATION_STRIKE_ROOT` seam. That is how the anchor-drift cases below rot an anchor without
 * touching a real file: the sweep resolves `<root>/<relative path>` for each strike target,
 * so a copy of the four target files is a tree it can refuse — and it refuses before it
 * writes anything, so the scratch tree is left exactly as the test built it.
 */
function runSweepOver(args: string[], strikeRoot: string) {
  return spawnSync(process.execPath, [sweep, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, MUTATION_LOCK_FILE: lockPath, MUTATION_STRIKE_ROOT: strikeRoot },
  });
}

/**
 * The lock a run writes mid-mutation: one file, its source, both hashes, and — when the
 * caller names one — the splice the mutation made. `splice` is what the real writer derives
 * for itself (`writeLock`); a lock seeded without it is the shape an older run, or a
 * hand-written one, leaves, and recovery has nothing it can trust to look for.
 */
function seedLock(entry: {
  path: string;
  original: string;
  mutatedHash: string;
  pid?: number;
  kind?: string;
  where?: string;
  splice?: { at: number; removed: string; inserted: string };
}) {
  const payload = {
    pid: entry.pid ?? 999999,
    startedAt: new Date().toISOString(),
    file: {
      path: entry.path,
      kind: entry.kind ?? "guard",
      where: entry.where ?? "x:1",
      original: entry.original,
      originalHash: sha1(entry.original),
      mutatedHash: entry.mutatedHash,
      ...(entry.splice ? { splice: entry.splice } : {}),
    },
  };
  writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`);
}

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "mutation-sweep-recovery-"));
  lockPath = path.join(workdir, "lock.json");
});

afterEach(() => {
  // Leave no lock for a later test of this file to find.
  for (const file of [lockPath, `${lockPath}.tmp`]) rmSync(file, { force: true });
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("mutation sweep crash-safety", () => {
  it("restores a file an interrupted sweep left mutated, then clears the lock", () => {
    const target = path.join(workdir, "mutated.ts");
    const original = 'return errorResponse("ID required", 400);\n';
    const mutated = "if ( false ) return errorResponse(\"ID required\", 400);\n";
    writeFileSync(target, mutated);
    seedLock({ path: target, original, mutatedHash: sha1(mutated) });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
    expect(result.stderr).toContain("RESTORED");
  });

  it("clears a stale lock whose file is already back to its original", () => {
    const target = path.join(workdir, "already.ts");
    const original = "export const value = 1;\n";
    writeFileSync(target, original);
    seedLock({ path: target, original, mutatedHash: sha1("export const value = 2;\n") });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refuses to clobber a file changed since the sweep wrote it, and keeps the lock", () => {
    const target = path.join(workdir, "edited.ts");
    const original = "export const value = 1;\n";
    const foreign = "export const value = 42; // a person's edit\n";
    writeFileSync(target, foreign);
    seedLock({ path: target, original, mutatedHash: sha1("export const value = 0;\n") });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(foreign);
    expect(result.stderr).toContain("differs from both");
    expect(existsSync(lockPath)).toBe(true);
  });

  it("stays with the warning when the mutation is gone from the file that replaced it", () => {
    const target = path.join(workdir, "edited-gone.ts");
    const original = "export const value = 1;\n";
    const mutated = "export const value = 0;\n";
    const foreign = "export const value = 42; // a person's edit\n";
    writeFileSync(target, foreign);
    // The same edit as the case above, with the lock carrying the splice a real run records:
    // the check runs, finds none of the mutation in the file, and leaves the warning alone.
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.indexOf("1"), removed: "1", inserted: "0" },
    });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(foreign);
    expect(result.stderr).toContain("differs from both");
    expect(existsSync(lockPath)).toBe(true);
  });

  it("restores a file whose later edit absorbed the mutation instead of replacing it", () => {
    const target = path.join(workdir, "absorbed.ts");
    const original = "export const value = 1;\n";
    const mutation = 'if ( false ) return errorResponse("ID required", 400);\n';
    const mutated = original + mutation;
    // The other writer took the *mutated* file as their base and edited on top of it, so the
    // sweep's own text is still in the file. The holder is dead — nothing is coming that
    // could measure or undo it — so the lock's pre-mutation source goes back over both:
    // the edit was written on top of a mutated file, so it was built on source no check
    // had measured, and it goes out with the mutation rather than staying behind it.
    const absorbed = `${mutated}// and then a person edited this file\n`;
    writeFileSync(target, absorbed);
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    const result = runSweep(["--list", NO_MATCHES]);

    // A heal the run names, in the words that say which state it was — and the tree is
    // whole, so the sweep measures what it came to measure.
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("absorbed the mutation");
    expect(result.stderr).toContain("Re-make that edit");
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("restores a mutation a writer reformatted rather than replaced", () => {
    const target = path.join(workdir, "reformatted.ts");
    const original = "export const value = 1;\n";
    const mutation = 'if (false) return errorResponse("ID required", 400);\n';
    const mutated = original + mutation;
    // The same file as the case above with its spacing moved — a reindent, an editor's
    // whitespace — and not one token changed. The verbatim window the check quotes back is
    // gone, which is why the flattened comparison exists: without it, a weakened statement
    // would sit on disk as a warning and the next run would measure it as the real thing.
    const reformatted = `export const   value = 1;\n\t${mutation}`;
    writeFileSync(target, reformatted);
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("absorbed the mutation");
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("restores when the mutation's own statement survives a rewritten region", () => {
    const target = path.join(workdir, "rewritten.ts");
    const original = "export const value = 1;\n";
    const mutation = 'if (false) return errorResponse("ID required", 400);\n';
    const mutated = original + mutation;
    // Nothing of the lock's context is left — the writer rewrote those lines — but the
    // mutation's own statement is still there, reindented. It is long enough to be evidence
    // without its surroundings, which is what the inserted-text fallback is for.
    const rewritten = `// a person's file\nexport const total = 43;\n    ${mutation}`;
    writeFileSync(target, rewritten);
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("absorbed the mutation");
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("warns, rather than refusing, when only a short insertion survives a rewrite", () => {
    const target = path.join(workdir, "coincidence.ts");
    const original = "export const value = 1;\n";
    const mutation = "return [];\n";
    const mutated = original + mutation;
    // A person's own function that happens to end in the same nine-character statement, with
    // none of the lock's context. That is a coincidence waiting to happen, not evidence the
    // mutation survived, so the window's padding still decides and the old warning stands.
    const foreign = "export function read() {\n  return [];\n}\n";
    writeFileSync(target, foreign);
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("differs from both");
    expect(result.stderr).not.toContain("absorbed");
    expect(readFileSync(target, "utf8")).toBe(foreign);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("refuses on the lock's own mutation, not on any text that happens to be in the file", () => {
    const target = path.join(workdir, "lying.ts");
    const original = "export const value = 1;\n";
    const mutation = "// the sweep's mutation\n";
    writeFileSync(target, `export const value = 42;\n${mutation}`);
    // A splice that does not rebuild the hash the lock recorded — a hand-written lock, or one
    // left by an older shape of the module. Recovery has no mutated source it can trust, so it
    // reports the file as someone else's edit rather than refusing on a string that matches.
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(`${original}// something else entirely\n`),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("differs from both");
    expect(result.stderr).not.toContain("absorbed");
    expect(existsSync(lockPath)).toBe(true);
  });

  it("still refuses an absorbed mutation whose restore does not verify", () => {
    // The one absorbed state the heal leaves standing: the source goes back over the
    // mutation, but the write cannot be verified afterwards — a read-only target, say —
    // and a half-written file is worse than the mutated one it came from.
    const target = path.join(workdir, "failed-restore.ts");
    const original = "export const value = 1;\n";
    const mutation = 'if (false) return errorResponse("ID required", 400);\n';
    const mutated = original + mutation;
    const absorbed = `${mutated}// and then a person edited this file\n`;
    writeFileSync(target, absorbed);
    chmodSync(target, 0o444);
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    try {
      const result = runSweep(["--list", NO_MATCHES]);

      // Not a sweep that measured a mutated tree, and not a mutated file left behind:
      // the stop is named as what it is, the file and the lock stay for a human.
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("could not restore");
      expect(result.stderr).toContain("absorbed the mutation into");
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      chmodSync(target, 0o644);
    }
  });

  it("answers an absorbed heal as a report event, and heals in exit mode", () => {
    // The runner reads the tree in `mode: "report"` — it is not the lock's owner and
    // must not be thrown out of its own report — so the heal has to arrive as an event
    // there, and as an ordinary (non-exiting) return in the checks' own default mode.
    const target = path.join(workdir, "reported.ts");
    const original = "export const value = 1;\n";
    const mutation = 'if (false) return errorResponse("ID required", 400);\n';
    const mutated = original + mutation;
    writeFileSync(target, `${mutated}// a later edit\n`);
    seedLock({
      path: target,
      original,
      mutatedHash: sha1(mutated),
      splice: { at: original.length, removed: "", inserted: mutation },
    });

    for (const mode of ["report", "exit"] as const) {
      writeFileSync(target, `${mutated}// a later edit\n`);
      seedLock({
        path: target,
        original,
        mutatedHash: sha1(mutated),
        splice: { at: original.length, removed: "", inserted: mutation },
      });
      const script =
        `const { recoverInterruptedRun } = await import(${JSON.stringify(
          pathToFileURL(path.join(projectRoot, ".freebuff", "mutation-lock.mjs")).href,
        )});\n` +
        `const event = recoverInterruptedRun({ mode: ${JSON.stringify(mode)} });\n` +
        "console.log(JSON.stringify(event));\n";
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, MUTATION_LOCK_FILE: lockPath },
      });
      expect(result.status, result.stderr).toBe(0);
      const event = JSON.parse(result.stdout);
      expect(event.action).toBe("absorbed-restored");
      expect(event.message).toContain("absorbed the mutation instead of replacing");
      expect(readFileSync(target, "utf8")).toBe(original);
      expect(existsSync(lockPath)).toBe(false);
    }
  });

  it("records the splice of the mutation it holds, without being told one", () => {
    // The refusal above can only tell an absorbed mutation from a replaced one because the
    // writer derives that splice for itself. Nothing else would notice the field going missing
    // — the check would simply stop firing — so the writer is driven here, through the module
    // the sweeps and the coverage check write through.
    const lockFile = path.join(workdir, "writer-lock.json");
    const lockModule = pathToFileURL(path.join(projectRoot, ".freebuff", "mutation-lock.mjs")).href;
    const original = "export const value = 1;\n";
    const mutated = "export const value = 0;\n";
    const script =
      `const { writeLock } = await import(${JSON.stringify(lockModule)});\n` +
      "writeLock({ check: 'guard sweep', path: 'x.ts', kind: 'self', where: 'x:1',\n" +
      `  original: ${JSON.stringify(original)}, mutated: ${JSON.stringify(mutated)} });\n`;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: lockFile },
    });

    expect(result.stderr).toBe("");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    expect(lock.file.splice).toEqual({ at: original.indexOf("1"), removed: "1", inserted: "0" });
  });


  it("refuses to start while a live sweep holds the lock, without touching the file", () => {
    const target = path.join(workdir, "held.ts");
    const original = "export const value = 1;\n";
    writeFileSync(target, original);
    // This test process is a real, running pid, so the sweep must see the lock as
    // owned and stand down rather than recover a lock another sweep still holds.
    seedLock({ path: target, original, mutatedHash: sha1("mutated\n"), pid: process.pid });

    const result = runSweep(["--list", NO_MATCHES]);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("REFUSING TO START");
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(original);
  });
});

/**
 * The sweep's own strikes, and what happens when one stops fitting.
 *
 * A strike splices an exact `find`/`replace` pair into a file. When the line it anchors on
 * is renamed, its `find` no longer occurs and its `replace` never lands: the sweep runs on,
 * every test passes, and the check the strike existed to hold is held by nothing — a gate
 * that disappears without anyone lowering a number. It used to be a printed `?` line and
 * exit 0; it is a refusal now, and it comes before the first strike.
 *
 * These cases drive the real script through its `MUTATION_STRIKE_ROOT` seam, so the refusal
 * is exercised end to end against a scratch copy of the five self-mutation targets and no
 * real file is put at risk. The scope is deliberately `NO_MATCHES`: the anchor check reads
 * the families whole, so a run that would rewrite *nothing* still refuses a rot in a family
 * it skipped — which is the difference between checking the anchors this run happens to use
 * and checking the sweep's own fit against the tree. The last two cases drive `--anchors`,
 * the same question asked on its own: a healthy tree reports every anchor fitting and runs
 * nothing, and the one renamed anchor is named and exits 1 — the code the sweep's own refusal
 * uses, so the two cannot disagree about what is red.
 */
/** The five files the self-mutation families rewrite, relative to the project root. */
const STRIKE_TARGETS = [
  "src/test/expect-gated.ts",
  "src/test/convention-guards.ts",
  ".freebuff/ci.mjs",
  ".freebuff/mutation-lock.mjs",
  "src/test/declared-strikes.ts",
];
const ABSORBED = "function absorbedStretch(entry, content) {";
const ABSORBED_INSERTED = "  const inserted = flatten(splice.inserted);";

/**
 * A scratch tree holding the five targets, with any `rot` applied to each in turn — the shape
 * `MUTATION_STRIKE_ROOT` reads, shared by the anchor-drift cases below and the vocabulary cases
 * that need one strike that no longer fits.
 */
function makeStrikeRoot(rot: { find: string; replace: string }[] = []): string {
  const root = mkdtempSync(path.join(workdir, "strike-root-"));
  for (const rel of STRIKE_TARGETS) {
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    let text = readFileSync(path.join(projectRoot, rel), "utf8");
    for (const { find, replace } of rot) text = text.split(find).join(replace);
    writeFileSync(dest, text);
  }
  return root;
}

describe("mutation sweep anchor drift", () => {
  it("passes a tree where every anchor still fits, so the refusal is not a blanket one", () => {
    const root = makeStrikeRoot();

    const result = runSweepOver([NO_MATCHES], root);

    expect(result.status, `a healthy scratch tree was refused:\n${result.stdout ?? ""}`).toBe(0);
    expect(result.stdout).not.toContain("UNCHECKED STRIKES");
  });

  it("refuses before its first strike, naming only the anchor that left the file", () => {
    const root = makeStrikeRoot([
      { find: ABSORBED, replace: "function absorbedStretchRenamed(entry, content) {" },
    ]);
    const target = path.join(root, ".freebuff", "mutation-lock.mjs");
    const before = readFileSync(target, "utf8");

    const result = runSweepOver([NO_MATCHES], root);

    expect(result.status).toBe(1);
    // The refusal names the broken strike with the count behind it…
    expect(result.stdout).toContain("UNCHECKED STRIKES (1)");
    expect(result.stdout).toContain(
      "absorbed: the lock reports no file that still carries the mutation it recorded",
    );
    expect(result.stdout).toContain("its anchor occurs 0 time(s), expected exactly 1");
    // …and only that one: the second strike's anchor is intact, so a check that listed every
    // entry, or that refused on the file rather than on the line, would say so here.
    expect(result.stdout).not.toContain("absorbed-inserted:");
    // Nothing was rewritten, and no lock was left: the refusal is before the first strike.
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(existsSync(lockPath)).toBe(false);
    expect(result.stderr).toContain("no longer fit the tree");
  });

  it("names every broken strike when more than one has left its target", () => {
    const root = makeStrikeRoot([
      { find: ABSORBED, replace: "function absorbedStretchRenamed(entry, content) {" },
      { find: ABSORBED_INSERTED, replace: "  const insertedRenamed = flatten(splice.inserted);" },
    ]);

    const result = runSweepOver([NO_MATCHES], root);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("UNCHECKED STRIKES (2)");
    expect(result.stdout).toContain("absorbed: the lock reports no file");
    expect(result.stdout).toContain("absorbed-inserted: the lock stops finding the mutation");
  });

  it("carries a broken strike as a `broken` survivor under --json, gated fail with nothing checked", () => {
    const root = makeStrikeRoot([
      { find: ABSORBED, replace: "function absorbedStretchRenamed(entry, content) {" },
    ]);

    const result = runSweepOver([NO_MATCHES, "--json"], root);

    expect(result.status).toBe(1);
    // The refusal writes the shape a consumer already reads rather than crashing with no
    // report, so the runner names the reason instead of a parse failure: `gate: "fail"`,
    // `checked: 0`, and the strike among the survivors as `kind: "broken"`.
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.checked).toBe(0);
    expect(payload.strikes).toEqual([]);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({
      path: ".freebuff/mutation-lock.mjs",
      kind: "broken",
      detail: "its anchor occurs 0 time(s), expected exactly 1",
    });
  });

  it("--anchors reads every strike and runs nothing, passing a tree where they all fit", () => {
    const root = makeStrikeRoot();

    const result = runSweepOver(["--anchors", NO_MATCHES], root);

    expect(result.status, `--anchors failed on a healthy tree:\n${result.stdout ?? ""}`).toBe(0);
    expect(result.stdout).toContain("every self-mutation anchor read, no strike run");
    // Every anchor of every family is reported as fitting — counted, not pinned to a literal,
    // since the strike ratchets in `declared-strikes.test.ts`, `convention-guards.test.ts` and
    // `ci-runner.test.ts` are what hold the list itself.
    expect(result.stdout).toMatch(/\d+ strike\(s\): \d+ fit the tree\./);
    expect(result.stdout).not.toContain("DRIFTED");
    // No strike ran: the report carries no per-strike `caught` line and no `Checked N
    // mutation(s).` summary, only the anchor rows.
    expect(result.stdout).not.toContain("caught");
    expect(result.stdout).not.toContain("Checked");

    const payload = JSON.parse(
      runSweepOver(["--anchors", "--json", NO_MATCHES], root).stdout ?? "{}",
    );
    expect(payload.mode).toBe("anchors");
    expect(payload.gate).toBe("pass");
    expect(payload.exitCode).toBe(0);
    expect(payload.drifted).toEqual([]);
    expect(payload.strikes.length).toBeGreaterThan(0);
    expect(payload.strikes.every((row: { status: string }) => row.status === "fits")).toBe(true);
  });

  it("--anchors reports the one anchor that left its file, and exits 1 like the refusal", () => {
    const root = makeStrikeRoot([
      { find: ABSORBED, replace: "function absorbedStretchRenamed(entry, content) {" },
    ]);

    const result = runSweepOver(["--anchors", NO_MATCHES], root);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("DRIFTED");
    expect(result.stdout).toMatch(/fit the tree, 1 no longer fit/);
    expect(result.stderr).toContain("would refuse before its first strike");

    const payload = JSON.parse(
      runSweepOver(["--anchors", "--json", NO_MATCHES], root).stdout ?? "{}",
    );
    expect(payload.mode).toBe("anchors");
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.drifted).toEqual([
      ".freebuff/mutation-lock.mjs  absorbed: the lock reports no file that still carries the mutation it recorded",
    ]);
    expect(payload.strikes.filter((row: { status: string }) => row.status !== "fits")).toHaveLength(1);
    // The row names why, and the intact sibling is left as `fits` — the report is per anchor,
    // not per file.
    expect(
      payload.strikes.find((row: { name: string }) => row.name.startsWith("absorbed: ")),
    ).toMatchObject({ path: ".freebuff/mutation-lock.mjs", status: "missing", occurrences: 0 });
    expect(
      payload.strikes.find((row: { name: string }) => row.name.startsWith("absorbed-inserted")),
    ).toMatchObject({ status: "fits", occurrences: 1 });
  });
});

/**
 * The sweep's own vocabulary, refused before it runs.
 *
 * `strikeKind` resolves every self-mutation to one of the `STRIKE_WORDS` families, and every
 * reader of a survivor assumes that word exists — the report looks it up (`STRIKE_WORDS[kind]`),
 * the `--json` survivor carries it, and `ci.mjs` groups by it. The invariant is that the set the
 * sweep declares and the set its entries stamp are the same set, and each side can break on its
 * own: a stamp with no word throws *mid-sweep*, when the report dereferences `undefined` after
 * the tree was edited and restored for every strike before it, and a declared word no entry
 * stamps is the quieter half — a family the report claims and never speaks, with a mark in
 * `ci.mjs` that no survivor can reach. That hole is in the sweep's own source and in no tree a
 * seam can reach, so the case runs a copy of the real script — one entry added that stamps a
 * kind nothing declares, or one word added to the `STRIKE_WORDS` the sweep imports from the
 * shared vocabulary module, byte-identical otherwise — and holds the refusal it must reach
 * before its first strike. The scope is
 * deliberately one no family carries, so the refusal has to read the families *whole*: a hole in
 * a family the run would not have touched is still a hole in the report it would otherwise
 * write. And because that scope runs none of them, the copy strikes nothing real even if the
 * refusal it is here to prove ever stopped firing — the case can only measure the refusal, never
 * risk the tree.
 */
describe("mutation sweep strike vocabulary", () => {
  /**
   * A probe entry that stamps `kind`, spliced into the copy's unscoped families. It borrows a
   * real anchor so the control — the same entry with a *declared* kind — passes the anchor check
   * and runs to a clean exit, which is what makes the refusal below a refusal and not a blanket.
   */
  function probeEntry(kind: string): string {
    return (
      `{ name: "probe: an entry that stamps the ${kind} kind", file: lockFile, ` +
      `find: ${JSON.stringify(ABSORBED)}, replace: "probe", test: lockFile, kind: ${JSON.stringify(kind)} }`
    );
  }

  /**
   * A copy of the real sweep in the test's temp directory, with the requested hole spliced in:
   * `entry` stamps an undeclared kind, `word` is declared with nothing to stamp it. Four lines
   * move so the copy can run from there: `root` — read from the copy's own location it would be
   * the temp directory — is pointed at the real tree, which the checks that read a file at load
   * (`unstruckRules`) and the route walk then find, and the local imports are pointed back at
   * the modules they name, since the copy is not beside them — the vocabulary module is not
   * re-pointed but written out beside the copy, so a spliced word is a splice in real table
   * text rather than a path pointing somewhere else.
   */
  function sweepCopy({ entry, word }: { entry?: string; word?: string }): string {
    const tree = mkdtempSync(path.join(workdir, "vocabulary-"));
    const real = (name: string) =>
      JSON.stringify(pathToFileURL(path.join(projectRoot, ".freebuff", name)).href);
    let source = readFileSync(sweep, "utf8")
      .replace('from "./mutation-lock.mjs";', `from ${real("mutation-lock.mjs")};`)
      .replace('from "./whole-write.mjs";', `from ${real("whole-write.mjs")};`)
      .replace(
        'const root = fileURLToPath(new URL("..", import.meta.url));',
        `const root = ${JSON.stringify(projectRoot)};`,
      );
    if (entry !== undefined) {
      source = source.replace(
        "const ALL_SELF_MUTATIONS = [\n",
        `const ALL_SELF_MUTATIONS = [\n  ${entry},\n`,
      );
    }
    // The sweep's table is imported now, so every copy carries the vocabulary module beside
    // it — spliced with `word` when the case declares one the table must lack, byte-identical
    // otherwise. Without the module the copy would not even load, which is why the write is
    // unconditional and the splice alone is conditional.
    mkdirSync(tree, { recursive: true });
    const vocabularySource = readFileSync(vocabulary, "utf8");
    writeFileSync(
      path.join(tree, "mutation-vocabulary.mjs"),
      word === undefined
        ? vocabularySource
        : (() => {
            expect(vocabularySource.split(`const STRIKE_WORDS = {\n`).length - 1).toBe(1);
            return vocabularySource.replace(
              "const STRIKE_WORDS = {\n",
              `const STRIKE_WORDS = {\n  ${word}: { what: "the ${word}", pin: "${word}" },\n`,
            );
          })(),
    );
    const copy = path.join(tree, "mutation-guards.mjs");
    writeFileSync(copy, source);
    return copy;
  }

  /**
   * Runs a copy with the shared lock isolated and the caller's scope. `strikeRoot`, when given,
   * points the copy's anchor check at a scratch tree (the `MUTATION_STRIKE_ROOT` seam), which is
   * how a case stages a strike that no longer fits beside a vocabulary hole. The vocabulary
   * module the copy reads its table from travels with the copy, written by `sweepCopy` above.
   */
  function runCopy(copy: string, args: string[], strikeRoot?: string) {
    return spawnSync(process.execPath, [copy, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: lockPath,
        ...(strikeRoot ? { MUTATION_STRIKE_ROOT: strikeRoot } : {}),
      },
    });
  }

  it("refuses before its first strike when an entry stamps a kind no declared word covers", () => {
    const result = runCopy(sweepCopy({ entry: probeEntry("beat") }), [NO_MATCHES]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VOCABULARY HOLES (1)");
    expect(result.stdout).toContain("an entry that stamps the beat kind");
    expect(result.stdout).toContain('it stamps kind "beat", which STRIKE_WORDS does not declare');
    expect(result.stderr).toContain("vocabulary hole(s)");
    // Read whole: the scope runs none of the families, and it refused anyway. No strike ran and
    // no lock was left, so the refusal is before the first save.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refuses a declared word that no entry stamps, the other side of the same set", () => {
    const result = runCopy(sweepCopy({ word: "beat" }), [NO_MATCHES]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VOCABULARY HOLES (1)");
    expect(result.stdout).toContain('the "beat" family');
    expect(result.stdout).toContain("no entry stamps it, so nothing can ever be reported under it");
  });

  it("names both sides of a disagreement in one refusal rather than only the first it finds", () => {
    const result = runCopy(sweepCopy({ entry: probeEntry("beat"), word: "orphan" }), [NO_MATCHES]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VOCABULARY HOLES (2)");
    expect(result.stdout).toContain('it stamps kind "beat", which STRIKE_WORDS does not declare');
    expect(result.stdout).toContain('the "orphan" family');
  });

  it("carries the vocabulary refusal as a `broken` survivor under --json, gated fail with nothing checked", () => {
    const result = runCopy(sweepCopy({ entry: probeEntry("beat") }), [NO_MATCHES, "--json"]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({
      kind: "broken",
      detail: 'it stamps kind "beat", which STRIKE_WORDS does not declare',
    });
  });

  it("runs the same copy when the declared words and the stamped kinds agree, so the refusal is not a blanket one", () => {
    const result = runCopy(sweepCopy({ entry: probeEntry("ratchet") }), [NO_MATCHES]);

    expect(result.status, `a declared kind was refused:\n${result.stderr ?? ""}`).toBe(0);
    expect(result.stdout).not.toContain("VOCABULARY HOLES");
  });

  it("lists each family with the strikes that stamp it, and passes while the sets agree", () => {
    // Scoped to nothing on purpose: the listing reads the families whole, and if the mode ever
    // stopped answering, this would run no strike rather than a full sweep against the real tree.
    const result = runSweep(["--vocabulary", NO_MATCHES]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("strike vocabulary —");
    // A family is never only a count: the ratchet is the smallest, and the one whose kind the
    // refusal was written for, so its heading and the single strike under it are both here.
    expect(result.stdout).toContain('"ratchet" (declared-table ratchet): 1 strike(s)');
    expect(result.stdout).toContain(
      "src/test/declared-strikes.ts  ratchet: the declared-table hold returns before it compares anything",
    );
    // …and that scope — which carries no file — has not narrowed it: a helper strike is here too.
    expect(result.stdout).toContain("src/test/expect-gated.ts  expectGatedNone no-op");
    expect(result.stdout).toContain(
      "every declared word is stamped, and every strike stamps a declared word.",
    );
    // Report-only: no strike ran and no lock was left.
    expect(existsSync(lockPath)).toBe(false);

    const payload = JSON.parse(runSweep(["--vocabulary", "--json", NO_MATCHES]).stdout ?? "{}");
    expect(payload.mode).toBe("vocabulary");
    expect(payload.gate).toBe("pass");
    expect(payload.exitCode).toBe(0);
    expect(payload.unnamed).toEqual([]);
    expect(payload.unspoken).toEqual([]);
    // One row per family, each declared, and each carrying exactly the strikes it counts — the
    // shape the hole case below reads an empty family and an undeclared heading apart from.
    expect(payload.families.length).toBeGreaterThan(0);
    for (const family of payload.families as { declared: boolean; count: number; strikes: unknown[] }[]) {
      expect(family.declared).toBe(true);
      expect(family.strikes).toHaveLength(family.count);
      expect(family.count).toBeGreaterThan(0);
    }
  });

  it("reads a vocabulary hole out rather than leaving it to the refusal", () => {
    // A word nothing stamps: the family is still listed, with no strikes under it. Scoped to
    // nothing throughout, so a vanished mode would run no strike rather than a full sweep.
    const stray = runCopy(sweepCopy({ word: "beat" }), ["--vocabulary", NO_MATCHES]);
    expect(stray.status).toBe(1);
    expect(stray.stdout).toContain('"beat" (beat): 0 strike(s)');
    expect(stray.stdout).toContain('UNSPOKEN  the "beat" family');
    expect(stray.stderr).toContain("vocabulary hole(s)");

    // An entry that stamps a kind nothing declares: the kind is listed under its own heading.
    const stamped = runCopy(sweepCopy({ entry: probeEntry("beat") }), ["--vocabulary", NO_MATCHES]);
    expect(stamped.status).toBe(1);
    expect(stamped.stdout).toContain('"beat" — NO DECLARED WORD: 1 strike(s)');
    expect(stamped.stdout).toContain("UNNAMED");

    // …and both, as data, under `--json`.
    const payload = JSON.parse(
      runCopy(sweepCopy({ entry: probeEntry("beat"), word: "orphan" }), [
        "--vocabulary",
        "--json",
        NO_MATCHES,
      ]).stdout ?? "{}",
    );
    expect(payload.gate).toBe("fail");
    expect(payload.exitCode).toBe(1);
    expect(payload.unspoken).toEqual(["orphan"]);
    expect(payload.unnamed).toEqual([
      {
        path: ".freebuff/mutation-lock.mjs",
        name: "probe: an entry that stamps the beat kind",
        kind: "beat",
      },
    ]);
  });

  it("names every reason a sweep may not begin in one pass rather than exiting on the first", () => {
    // Two reasons at once — a declared word nothing stamps, and a strike whose anchor has left its
    // file — so the refusal has to report both in one pass rather than the first it reaches.
    const root = makeStrikeRoot([
      { find: ABSORBED, replace: "function absorbedStretchRenamed(entry, content) {" },
    ]);

    const result = runCopy(sweepCopy({ word: "beat" }), [NO_MATCHES], root);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("START-UP REFUSAL (2)");
    expect(result.stdout).toContain("VOCABULARY HOLES (1)");
    expect(result.stdout).toContain("UNCHECKED STRIKES (1)");
    // …and the shape a consumer reads carries both, so the payload counts the reasons the same way
    // the report does instead of stopping at the first.
    const payload = JSON.parse(
      runCopy(sweepCopy({ word: "beat" }), [NO_MATCHES, "--json"], root).stdout ?? "{}",
    );
    expect(payload.gate).toBe("fail");
    expect(payload.checked).toBe(0);
    expect(payload.survivors).toHaveLength(2);
  });

  it("spells the anchor reason once, in the source the refusal and the payload both read", () => {
    // The refusal's `its anchor occurs ${n} time(s)…` and the payload's `detail` must be
    // one sentence, not two copies a later edit could drift apart. Both read the survivor
    // object `brokenSelf` builds, so the source is scanned for the builder's template and
    // for any second, hand-written copy of the sentence.
    const source = readFileSync(sweep, "utf8");
    const spelled = source.match(/its anchor occurs \$\{[^}]+\} time\(s\), expected exactly 1/g) ?? [];
    expect(spelled, "the anchor reason must be spelled once (inside brokenSelf)").toHaveLength(1);
    // The refusal and the --anchors report reach the sentence through the survivor, not by
    // interpolating their own copy beside the print.
    expect(source).toContain("for (const line of reasonLines(brokenSelf(entry)))");
    expect(source).toContain("reasonLines(brokenSelf(row))");
    // And the runtime half: the printed refusal line is the payload's `detail`, byte for byte.
    const rotted = makeStrikeRoot([
      { find: ABSORBED, replace: "function absorbedStretchRenamed(entry, content) {" },
    ]);
    const plain = runCopy(sweepCopy({}), [NO_MATCHES], rotted);
    const payload = JSON.parse(
      runCopy(sweepCopy({}), [NO_MATCHES, "--json"], rotted).stdout ?? "{}",
    );
    expect(payload.survivors[0].detail).toEqual(expect.any(String));
    expect(plain.stdout).toContain(payload.survivors[0].detail);
  });

  it("spells the vocabulary reasons once, printing the payload's own detail lines", () => {
    const source = readFileSync(sweep, "utf8");
    const unnamed = source.match(/it stamps kind "\$\{strikeKind\(mutation\)\}", which STRIKE_WORDS does not declare/g) ?? [];
    expect(unnamed, "the unnamed-kind reason must be spelled once (inside unnamedSelf)").toHaveLength(1);
    // The unspoken reason lives in `unspokenSelf.detail`; the refusal prints the survivor's
    // lines rather than a second sentence of its own.
    expect(source).toContain("for (const line of reasonLines(survivor)) log(`      ${line}`);");
    // Runtime: the refusal prints the same sentence the payload carries, for both directions.
    const plain = runCopy(sweepCopy({ entry: probeEntry("beat") }), [NO_MATCHES]);
    const payload = JSON.parse(
      runCopy(sweepCopy({ entry: probeEntry("beat") }), [NO_MATCHES, "--json"]).stdout ?? "{}",
    );
    expect(payload.survivors).toHaveLength(1);
    expect(plain.stdout).toContain(payload.survivors[0].detail);
    const unspoken = runCopy(sweepCopy({ word: "beat" }), [NO_MATCHES]);
    const unspokenPayload = JSON.parse(
      runCopy(sweepCopy({ word: "beat" }), [NO_MATCHES, "--json"]).stdout ?? "{}",
    );
    expect(unspoken.stdout).toContain(unspokenPayload.survivors[0].detail);
  });
});
