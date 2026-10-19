/// <reference types="vite/client" />
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const sweep = path.join(projectRoot, ".freebuff", "mutation-guards.mjs");
// The shared race module — the wedge, the gate and the one spelling of every race sentence —
// which the sweeps' shared-wall cases pin by content rather than by re-stating the words.
const lockModule = path.join(projectRoot, ".freebuff", "mutation-lock.mjs");
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
    // …and the refusal carries the same run-wide reading a plain run's payload carries:
    // the recorded baseline's un-struck count. This payload is emitted before the section
    // that once declared `baselinePath` as a `const`, so a reordering that put the read
    // back there would throw in the refusal's own `try` and silently drop the key — the
    // run page would then never warn on a refusal night while warning on a plain one.
    const recorded = JSON.parse(
      readFileSync(path.join(projectRoot, ".freebuff", "mutation-baseline.json"), "utf8"),
    ) as { unstruck?: unknown[] };
    expect(payload.unstruckBaseline).toEqual(
      Array.isArray(recorded.unstruck) ? recorded.unstruck.length : undefined,
    );
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

/**
 * The route walk's race windows, driven against a scratch tree.
 *
 * The sweep says everything it says about a file against the bytes it read while building
 * the plan. A session that edits a route (or its neighbour test) inside the run's window
 * breaks that premise twice over: a splice taken by index out of the plan's source would
 * be written over the editor's edit, and a verdict recorded before the edit would live on
 * as an answer about bytes nobody can read back. So the sweep hashes both halves of every
 * route while it plans, re-reads them before each strike and once more before the report;
 * a file that no longer matches its wedge is not measured, its verdicts are voided, and
 * one `broken` row names it — refusing is better than striking garbage and calling the
 * result a measurement.
 *
 * These cases drive the real script through its `MUTATION_ROUTE_ROOT` seam, which re-roots
 * the route walk at a scratch tree the same way `MUTATION_STRIKE_ROOT` re-roots the
 * self-mutation targets — so an outside edit can land inside a run without a real file
 * ever being at risk. `MUTATION_RACE_AT`/`MUTATION_RACE_FILE` are the sweep's own edit
 * seam: before plan item `n`'s gate runs (or, when the slice never reaches it, just before
 * the end-of-run sweep), the sweep appends a comment to the named file, which is exactly
 * an outside edit arriving between two of the sweep's own reads.
 *
 * The neighbour test the fixture carries is deliberately one vitest cannot find: `runTest`
 * still gets a JSON report — zero files, zero failures — so every measured strike records
 * a *survived* verdict, which is what makes the voiding in the mid-run and end-of-run
 * cases a recorded verdict being taken back rather than nothing ever having been said.
 */
describe("mutation sweep race windows", () => {
  /** A fixture route: one refusal-shaped guard, with whatever name the caller asks for. */
  const GUARD = (name: string) =>
    [
      "export async function " + name + "() {\n",
      "  if (!id) return errorResponse(\"ID required\", 400);\n",
      "  return successResponse({ id });\n",
      "}\n",
    ].join("");

  /** A scratch route root: the route(s) under `src/app`, a neighbour test beside them. */
  function makeRouteRoot(...bodies: string[]): { root: string; route: string; test: string; source: string } {
    const root = mkdtempSync(path.join(workdir, "route-root-"));
    const route = path.join(root, "src", "app", "api", "race", "route.ts");
    const test = path.join(root, "src", "app", "api", "race", "route.test.ts");
    mkdirSync(path.dirname(route), { recursive: true });
    const source = bodies.join("");
    writeFileSync(route, source);
    writeFileSync(test, `import { it } from "vitest";\n\nit("neighbour", () => {});\n`);
    return { root, route, test, source };
  }

  /** Runs the sweep against a scratch route root. The race seams stand together or not at all. */
  function runRace(args: string[], routeRoot: string, race?: { at: number; file: string }) {
    return spawnSync(process.execPath, [sweep, "--no-fail-open", "--file=race", ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: lockPath,
        MUTATION_ROUTE_ROOT: routeRoot,
        ...(race ? { MUTATION_RACE_AT: String(race.at), MUTATION_RACE_FILE: race.file } : {}),
      },
    });
  }

  it("refuses the seam's other half rather than editing the checkout it would measure", () => {
    // The seam writes a file by name — into the checkout it would otherwise measure, if the
    // route walk was not re-rooted first. So it asks to be re-rooted, and the two env vars
    // stand together or not at all: any half set is the same refusal.
    const tree = makeRouteRoot(GUARD("GET"));
    const halfSeam = spawnSync(process.execPath, [sweep, "--file=race"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: lockPath,
        MUTATION_RACE_AT: "1",
        MUTATION_RACE_FILE: tree.test,
      },
    });
    expect(halfSeam.status).toBe(1);
    expect(halfSeam.stderr).toContain("re-root one of the walks first");

    const halfEnv = runRace([], tree.root, { at: 1, file: "" });
    expect(halfEnv.status).toBe(1);
    expect(halfEnv.stderr).toContain("stand together");
  });

  it("skips a strike whose file an outside edit moved since the plan, and measures nothing in it", () => {
    // One guard, and the edit lands before even its gate: no strike at all, no splice in
    // the file, one raced row, exit 1 — the run says what it could not measure rather
    // than splicing the plan's bytes over the editor's.
    const tree = makeRouteRoot(GUARD("GET"));

    const result = runRace(["--json"], tree.root, { at: 1, file: tree.test });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.checked).toBe(0);
    expect(payload.gate).toBe("fail");
    expect(payload.racedStrikes).toBe(1);
    expect(payload.racedFiles).toHaveLength(1);
    expect(payload.racedFiles[0]).toMatch(/route\.ts$/);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({
      kind: "broken",
      reason: "race",
      detail: expect.stringContaining("landed inside the sweep's window"),
    });
    // Nothing was measured and nothing was written: the file is exactly the bytes the
    // plan spliced from, with no mutation applied and no lock left behind.
    expect(readFileSync(tree.route, "utf8")).toBe(tree.source);
    expect(existsSync(lockPath)).toBe(false);
    // The log names the file and the half that moved, without measuring either.
    expect(result.stderr).toContain("RACED");
    expect(result.stderr).toContain("its neighbour test was edited while the sweep ran");
  });

  it("voids a verdict it already recorded, when an outside edit follows it inside the window", () => {
    // Two guards, one strike measured before the edit, one gate that catches it. Strike 1
    // recorded a survivor for a file nobody can read back the same way it was read; strike
    // 2's gate refuses, voids that verdict (and refunds its check), and carries one row
    // for the whole file. A run that said "survived" here would leave a reader an answer
    // whose subject no longer exists.
    const tree = makeRouteRoot(GUARD("GET"), GUARD("DELETE"));

    const result = runRace(["--limit=2", "--json"], tree.root, { at: 2, file: tree.test });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    // One strike measured, one verdict recorded, then both taken back: the count refunds
    // to zero, and no `guard` survivor rode with the raced row.
    expect(payload.checked).toBe(0);
    expect(payload.racedStrikes).toBe(1);
    expect(payload.survivors.filter((row: { kind: string }) => row.kind === "guard")).toEqual([]);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject(
      { kind: "broken", reason: "race", detail: expect.stringContaining("landed inside the sweep's window") },
    );
    // The file is whole: the skipped strike left it as the plan's bytes, the way the
    // in-strike guard leaves it when a foreign edit arrives mid-strike.
    expect(readFileSync(tree.route, "utf8")).toBe(tree.source);
    expect(existsSync(lockPath)).toBe(false);
    expect(result.stderr).toContain("verdict(s) recorded earlier for it are void");
  });

  it("catches a late edit that follows a route's last strike out the door", () => {
    // One guard, one strike measured, then the seam's edit lands past the slice — which
    // a per-strike gate never sees, because no gate runs after the last strike. The run's
    // last check over the wedge is what catches it, voiding the same verdict the
    // mid-run case voids.
    const tree = makeRouteRoot(GUARD("GET"));

    const result = runRace(["--limit=1", "--json"], tree.root, { at: 2, file: tree.test });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.checked).toBe(0);
    expect(payload.racedStrikes).toBe(0);
    expect(payload.racedFiles).toHaveLength(1);
    expect(payload.survivors.filter((row: { kind: string }) => row.kind === "guard")).toEqual([]);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({ kind: "broken", reason: "race" });
    expect(readFileSync(tree.route, "utf8")).toBe(tree.source);
    expect(result.stderr).toContain("changed after its last strike");
  });

  it("reports a run with no race as it always did, so the check is not a blanket refusal", () => {
    // One guard, measured whole, no edit anywhere: the verdict stands, `checked` counts it,
    // and no raced row is carried at all. The control says what the cases above red when
    // the tree moves — and that nothing about the check fires when it does not.
    const tree = makeRouteRoot(GUARD("GET"));

    const result = runRace(["--json"], tree.root);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.racedStrikes).toBe(0);
    expect(payload.racedFiles).toEqual([]);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({ kind: "guard", masked: true });
    expect(readFileSync(tree.route, "utf8")).toBe(tree.source);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("spells the race reason once, printing the payload's own detail lines", () => {
    // The race rows share the one-sentence discipline: whatever the report prints about an
    // outside edit is the `detail` the survivor object carries, not a second copy a later
    // edit could drift apart. The sentence now lives in the shared race module — beside the
    // wedge it describes — because three tree-editing sweeps read it, so the pin reads that
    // source and requires the builder to be referenced here rather than re-spelled.
    const shared = readFileSync(lockModule, "utf8");
    const spelled =
      shared.match(/an edit to \$\{which\} \(\$\{subjectLabel\}\) landed inside the sweep's window/g) ?? [];
    expect(spelled, "the race reason must be spelled once (inside raceRowDetail)").toHaveLength(1);
    expect(readFileSync(sweep, "utf8")).toContain("detail: raceRowDetail(which, label(subject))");
  });
});

/**
 * The self families' race windows, driven against the scratch strike root.
 *
 * The route cases above re-root the walk whose splices are index-anchored; the self families
 * splice by text anchor, so an edit in their window does not put a file at the mercy of a
 * stale offset — but a verdict recorded before the edit is just as dead. The sweep now weds
 * the same plan-time hashing (each target *and the test file that verdict answers to*), the
 * same per-strike gate, and the same end-of-run sweep over every measured pair onto that
 * family list — so a verdict cannot survive its own subject's edit, and a run reports the
 * raced file with the same `broken`/`reason: "race"` row the route walk speaks, with its
 * skipped strikes counted in `racedStrikes` and the check refunded in `checked`.
 *
 * The fixture is the five self targets copied whole — the shape `MUTATION_STRIKE_ROOT`
 * reads — with `--file=<family>` scoping the run to the family whose target is cheap to
 * drive: `--file=expect-gated` (ten strikes whose test is a small suite) for the window
 * between two of its strikes, `--file=declared-strikes` (one) for the late edit that no
 * gate follows. The regime is the same as the route fixture's on purpose: the real test
 * file passes over the scratch-mutated target, so every measured strike records a
 * *survived* verdict — which is what makes the voiding below a verdict being taken back,
 * not nothing ever being said.
 */
describe("mutation sweep self-family race windows", () => {
  const RACE_COMMENT = "\n/* an outside edit, injected by the sweep's race seam */\n";

  /** Runs the sweep over a scratch strike root. The race seams stand together or not at all. */
  function runSelfRace(args: string[], strikeRoot: string, race?: { at: number; file: string }) {
    return spawnSync(process.execPath, [sweep, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MUTATION_LOCK_FILE: lockPath,
        MUTATION_STRIKE_ROOT: strikeRoot,
        ...(race ? { MUTATION_RACE_AT: String(race.at), MUTATION_RACE_FILE: race.file } : {}),
      },
    });
  }

  it("takes a strike-root scratch tree as the seam's terrain, refusing only the checkout itself", () => {
    // The seam's rule is containment, not a walk's name: a race file inside the re-rooted
    // strike root is its own terrain, and the edit it lands there arrives exactly where a
    // real session's would — before the first strike's gate, with no `finally` owning the
    // moment. A race file in the checkout refuses even though the strike root is a scratch
    // tree: re-rooting one walk does not make the other writable.
    const root = makeStrikeRoot();
    const target = path.join(root, "src", "test", "expect-gated.ts");
    const pool = readFileSync(target, "utf8");

    const inside = runSelfRace(["--file=expect-gated", "--json"], root, { at: 1, file: target });

    expect(inside.status).toBe(1);
    const payload = JSON.parse(inside.stdout ?? "{}");
    expect(payload.checked).toBe(0);
    expect(payload.gate).toBe("fail");
    // Every strike the family holds reads the moved file at its own gate and skips; the
    // file is named once, under the label its verdicts ride — the declared target, not
    // the scratch copy's relative path.
    expect(payload.racedStrikes).toBe(10);
    expect(payload.racedFiles).toEqual(["src/test/expect-gated.ts"]);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({
      kind: "broken",
      reason: "race",
      detail: expect.stringContaining("an edit to the strike's target"),
    });
    expect(inside.stderr).toContain("the strike's target was edited while the sweep ran");
    // The seam is the whole writer: the pool is the plan's bytes plus the one comment.
    expect(readFileSync(target, "utf8")).toBe(pool + RACE_COMMENT);
    expect(existsSync(lockPath)).toBe(false);

    const outside = runSelfRace(["--file=expect-gated"], root, {
      at: 1,
      file: path.join(projectRoot, "src", "test", "expect-gated.ts"),
    });
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("may not edit the checkout it would otherwise measure");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("voids a self verdict recorded before a mid-run edit, and refunds the checks behind it", () => {
    // Three of the ten helper strikes: the first two measure — their verdicts answer the
    // declared test file, and their survivors are recorded — and the edit lands before the
    // third strike's gate. That strike is refused, the two verdicts before it are voided
    // and their checks refunded (checked returns to zero), and the seven gates after it
    // read the same moved target and skip too: one raced row for the file, whatever number
    // of strikes it held.
    const root = makeStrikeRoot();
    const target = path.join(root, "src", "test", "expect-gated.ts");

    const result = runSelfRace(["--file=expect-gated", "--json"], root, { at: 3, file: target });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.checked).toBe(0);
    expect(payload.racedStrikes).toBe(8);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({ kind: "broken", reason: "race" });
    expect(payload.survivors.filter((row: { kind: string }) => row.kind === "self")).toEqual([]);
    expect(result.stderr).toContain("verdict(s) recorded earlier for it are void");
    // The target is whole again: the skipped strikes wrote nothing and the measured ones
    // restored, so what remains is the pool plus the seam's one comment — the file the
    // outside session edited, not a mutation left behind.
    expect(readFileSync(target, "utf8")).toContain(RACE_COMMENT);
    expect(readFileSync(target, "utf8").split(RACE_COMMENT)).toHaveLength(2);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("catches a late edit that follows a family's last strike out the door", () => {
    // One strike (the declared-table ratchet), measured, its verdict recorded — then the
    // edit lands past it. No gate runs after a family's last strike, so this is what the
    // end-of-run wedge is for: the verdict is voided, the check refunded, and the row
    // names the half that moved after its last strike.
    const root = makeStrikeRoot();

    const result = runSelfRace(["--file=declared-strikes", "--json"], root, {
      at: 2,
      file: path.join(root, "src", "test", "declared-strikes.ts"),
    });

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.checked).toBe(0);
    expect(payload.racedStrikes).toBe(0);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({ kind: "broken", reason: "race" });
    expect(payload.racedFiles).toEqual(["src/test/declared-strikes.ts"]);
    expect(result.stderr).toContain("changed after its last strike");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("runs a race-free self family exactly as before, so the wedge guards nothing when nothing moved", () => {
    // The control: no seam anywhere, one strike measured, its verdict rides — `checked`
    // counts it, no raced row is carried, and the exit is the survivor's. The cases above
    // red precisely what this green does not.
    const root = makeStrikeRoot();

    const result = runSelfRace(["--file=declared-strikes", "--json"], root);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout ?? "{}");
    expect(payload.checked).toBe(1);
    expect(payload.racedStrikes).toBe(0);
    expect(payload.racedFiles).toEqual([]);
    expect(payload.survivors).toHaveLength(1);
    expect(payload.survivors[0]).toMatchObject({ kind: "ratchet" });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("spells the self-family race reasons once, beside the route ones", () => {
    // The same one-sentence discipline as the route walk's row: `which` carries the words —
    // the strike's target, or the test the verdict answers to — and the builder holds the
    // only copy of each.
    const source = readFileSync(sweep, "utf8");
    expect(source.match(/"the strike's target"/g) ?? []).toHaveLength(1);
    expect(source.match(/"the test the strike answers to"/g) ?? []).toHaveLength(1);
  });
});

/**
 * The strip a sweep owes its children.
 *
 * A sweep's child inherits its parent's environ, and a pinned suite that drives another
 * tree-editing sweep from inside itself — the guard sweep's own test run spawns the
 * preflight sweep, for the real case — would read a `MUTATION_RACE_*` pair it was handed
 * and refuse a run that has nothing to do with it. The strip used to be three hand-written
 * copy-and-delete pairs, the shape a fourth sweep omits without noticing, so the copy lives
 * in the shared module (`envWithoutRaceSeam`) and this hold reads the whole `mutation-*.mjs`
 * family rather than a list of names: any member that reads the seam and spawns children
 * must bind the helper, and none may still carry the raw deletes.
 */
describe("the race seam strip is bound where a sweep spawns its children", () => {
  const sweepSource = (name: string) => readFileSync(path.join(projectRoot, ".freebuff", name), "utf8");

  it("binds envWithoutRaceSeam into every member that reads the seam and spawns children", () => {
    // Enumerated from the directory, not from a list: the sweep families are the files the
    // stage keys name (`mutation-*`), and a member the list-giver never heard of is exactly
    // the forgetful fourth sweep this exists for. The condition reads what makes the strip
    // load-bearing — a seam to inherit, children to inherit it — so report-only members and
    // the lock module itself (which owns the helper and spawns nothing) fall outside it.
    const members = readdirSync(path.join(projectRoot, ".freebuff")).filter((name) =>
      /^mutation-.*\.mjs$/.test(name),
    );
    const held: string[] = [];
    for (const name of members) {
      const source = sweepSource(name);
      if (!source.includes("MUTATION_RACE_AT") || !source.includes("spawnSync(")) continue;
      held.push(name);
      expect(
        source.includes("envWithoutRaceSeam(process.env)"),
        `${name} reads the race seam and spawns children but binds no envWithoutRaceSeam — a ` +
          "child inherits the landing pair and would refuse another sweep's run. Bind the strip " +
          "at the spawn site, as the other sweeps do.",
      ).toBe(true);
    }
    // The three tree-editing sweeps are held today; a fourth that binds correctly joins the
    // list rather than moving it, so the reading grows without being re-pinned by name.
    for (const name of ["mutation-coverage.mjs", "mutation-guards.mjs", "mutation-preflight.mjs"]) {
      expect(held, `${name} must be in the enumerated reading`).toContain(name);
    }
  });

  it("holds the raw copy-and-delete spelling out of the family, so the helper stays the one shape", () => {
    // A sweep that copies the pair out by hand is a strip the helper's next fix cannot reach,
    // and a second spelling drifting beside the first is precisely the drift this chassis
    // exists to refuse. The deletion itself appears exactly twice — the two deletes the
    // helper owns — and nowhere else in the family.
    for (const name of ["mutation-coverage.mjs", "mutation-guards.mjs", "mutation-preflight.mjs"]) {
      expect(
        sweepSource(name).includes("delete childEnv.MUTATION_RACE"),
        `${name} copies the landing pair out by hand instead of envWithoutRaceSeam`,
      ).toBe(false);
    }
    const shared = sweepSource("mutation-lock.mjs");
    expect(shared.match(/delete childEnv\.MUTATION_RACE_AT;/g) ?? []).toHaveLength(1);
    expect(shared.match(/delete childEnv\.MUTATION_RACE_FILE;/g) ?? []).toHaveLength(1);
  });
});

/**
 * The spawn strip this chassis answers for, and the peers that witness it.
 *
 * The two describes above are the family-wide half — they walk the whole `mutation-*.mjs`
 * directory, so a forgetful fourth sweep fails here. What they do not do is answer for one
 * sweep by name: a pin and a sweep held by a stranger's test suite can drift apart with
 * nobody holding the pair. So this chassis also pins *its* sweep by the shape the strip
 * actually takes at the spawn site — the binding spelled once, one spawn site, the
 * stripped environ passed there, no raw delete — and all three chassis witness each
 * other: deleting a pin here reads red in the other two files, so a chassis cannot drift
 * from its sweep unnoticed.
 */
describe("the guard sweep's spawn strip is pinned here and held against its peers", () => {
  const source = readFileSync(path.join(projectRoot, ".freebuff", "mutation-guards.mjs"), "utf8");

  it("spawns its one child with the strip the shared module owns", () => {
    // Peer-matched on bytes, so the shape is the pin: the binding the lock module owns,
    // exactly once — the sweep spawns once, so a second binding would be a dead one —
    // the stripped environ passed at that site, and neither the raw environ nor a
    // hand-spelled delete anywhere in the file.
    expect(
      source.match(/const childEnv = envWithoutRaceSeam\(process\.env\)/g) ?? [],
      "mutation-guards.mjs must bind envWithoutRaceSeam(process.env) exactly once",
    ).toHaveLength(1);
    expect(
      source.match(/spawnSync\(/g) ?? [],
      "mutation-guards.mjs is expected to have one child spawn; the pin assumes it",
    ).toHaveLength(1);
    expect(
      source.includes("env: childEnv"),
      "mutation-guards.mjs spawns its child without the stripped environ — the child " +
        "inherits the landing pair and would refuse another sweep's run",
    ).toBe(true);
    expect(
      source.includes("env: process.env"),
      "mutation-guards.mjs passes the raw environ at a spawn — strip it through " +
        "envWithoutRaceSeam, as the other sweeps do",
    ).toBe(false);
    expect(
      source.includes("delete childEnv.MUTATION_RACE"),
      "mutation-guards.mjs copies the landing pair out by hand instead of envWithoutRaceSeam",
    ).toBe(false);
  });

  it("is held against the other sweeps' chassis, which pin their own strips", () => {
    // The mutual witness: a strip pin that vanishes from any of the three chassis files
    // is absent from nowhere. Each peer is read for the marker case name, its sweep by
    // name, and the strip words the pin must speak — the exact bytes this file's own pin
    // carries, matched back onto the file that carries them.
    for (const [peerFile, peerSweep] of [
      ["mutation-preflight.test.ts", "mutation-preflight.mjs"],
      ["mutation-coverage.test.ts", "mutation-coverage.mjs"],
    ] as const) {
      const peer = readFileSync(path.join(projectRoot, "src", "test", peerFile), "utf8");
      expect(
        peer.includes("spawns its one child with the strip the shared module owns"),
        `${peerFile} no longer pins its sweep's spawn strip — name the sweep it answers for ` +
          "and the strip it spawns with, as this chassis does",
      ).toBe(true);
      expect(
        peer.includes(peerSweep),
        `${peerFile} pin's case names no strip-holding sweep (${peerSweep})`,
      ).toBe(true);
      expect(peer.includes("envWithoutRaceSeam(process.env)"), `${peerFile} pin names no strip`).toBe(true);
      expect(peer.includes("env: childEnv"), `${peerFile} pin says nothing about the spawn's environ`).toBe(true);
    }
  });
});
