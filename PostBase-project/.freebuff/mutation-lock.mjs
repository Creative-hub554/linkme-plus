/**
 * The lock a tree-editing mutation check holds while it has a file mutated.
 *
 * Three checks rewrite this working tree in place and put each file back when they are
 * done: the guard sweep (`.freebuff/mutation-guards.mjs`, which rewrites a route guard
 * or a shared test helper and requires the neighbour test to fail), the coverage gate
 * mutation check (`.freebuff/mutation-coverage.mjs`, which weakens one coverage script at
 * a time and requires that script's own test file to fail), and the preflight sweep
 * (`.freebuff/mutation-preflight.mjs`, which breaks one branch of `preview-preflight.mjs`
 * at a time and requires that file's own tests to fail). A `finally` only
 * runs if the process gets to run it, and a SIGKILL, a closed terminal or a power cut
 * runs no handler at all — leaving a route failing open, a guard removed, or a
 * weakened coverage gate on disk, which is worse than the check it was mutating. So
 * each writes a **lock** before it overwrites a file and clears it once the file is
 * back, and each runs the recovery below before it touches anything.
 *
 * The lock's file name and shape are owned *here*, so the two checks cannot drift
 * apart — the same reason `.freebuff/collect-budget-soft.mjs` owns the soft-gate
 * sidecar that the collect reporter writes and the CI runner reads. It is **one file,
 * not one per check**: a lock says "this working tree is being edited right now", and
 * that is a property of the tree rather than of the check holding it, so a second run
 * of *either* check stands down (exit 3) instead of rewriting files beside the first.
 *
 * What the lock carries is one *active* mutation: the file's path, what it was being
 * mutated for (`kind` and `where`, for a reader), which check wrote it (`check`, so a
 * message can name who held the tree), the file's pre-mutation source, the **splice**
 * the mutation made in it — `at`, `removed`, `inserted` — and the hashes of both sides of
 * the edit: enough for recovery to tell which of the four states it is looking at
 * without guessing, and to recognize the one of them that no longer holds the file's
 * source at all.
 *
 * Recovery's whole discretion is those four states. A file still matching the mutation
 * is restored from the lock's copy; one already whole just has its lock cleared; one
 * matching neither was edited by someone else in the window, and is left alone with the
 * lock in place, because the lock's copy is older than that edit and restoring it would
 * lose it — *unless* the mutation's own text is still in it, in which case the later
 * edit did not replace the mutation but **absorbed** it. That is the state worth naming
 * apart, because the text a leaked mutation leaves behind is the weakened source these
 * checks mutate *with*: the file is neither the source before the edit nor the source
 * after it, and no check may measure it. With the holder dead — a live one was refused
 * above — no run is coming that could undo it either, so recovery does not leave it for
 * a human to find after the next run has already measured it: the lock's pre-mutation
 * source goes back, taking the mutation and the edit it was absorbed into out together
 * (that edit was written on top of a mutated file, so it was built on source no check
 * had measured), the write is verified, and the lock is cleared (`absorbed-restored`).
 * Only a restore that does not verify still refuses (`absorbed`), because a half-written
 * file is worse than the mutated one it came from. A lock whose `pid` is still running
 * means another run holds the tree, and the caller stands down (exit 3) rather than
 * fighting it for the same file.
 *
 * `recoverInterruptedRun` **returns** what it did as well as printing it, so the check
 * that called it can put the recovery in its own `--json` report — a healed tree is a
 * fact about the run, and a run's report is where its facts belong. The event is
 * `{ action, path, check, kind, where, message }`, or `null` when there was no lock to
 * read: `restored` (the file was put back), `cleared` (the lock was stale and the file
 * already whole), `missing` (the lock named a file that is gone), `left` (the file was
 * edited by someone else — the lock stays for a human), `absorbed-restored` (the later
 * edit had absorbed the mutation; the pre-mutation source went back over both and the
 * lock was cleared), `absorbed` (an absorbed mutation whose restore did not verify —
 * nobody may proceed, and the lock stays), `unreadable` (the lock itself
 * could not be read or named no file, and was removed), plus the two below, which only
 * `mode: "report"` can answer with.
 *
 * The two callers want different things from a lock that is *not* recoverable. A check
 * is about to rewrite the file, so a lock held by a live run has to stop it
 * (`mode: "exit"`, the default — the process stands down with exit 3, and a restore
 * that did not verify stops with exit 2 rather than leaving a half state, as does an
 * absorbed mutation whose restore does not verify). A run that
 * only *read* the tree — `.freebuff/ci.mjs`, which heals before its stages measure
 * anything and is not the lock's owner — wants the state described instead, so
 * `mode: "report"` answers `held` (a live check owns this tree right now), `failed`
 * (the bytes written back did not hash to the recorded original) and `absorbed` as
 * events, and never calls `process.exit`. That distinction is why this takes an option
 * at all: an exit from inside a caller that is reporting would take the report with it —
 * so a refusal here is the *caller's* to make, and `absorbed` is the event that tells it
 * to."
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where a run records the file it is mutating right now.
 *
 * `MUTATION_LOCK_FILE` (absolute, or relative to the project) points it elsewhere,
 * which is a **test seam**: the two crash-safety suites drive the real recovery
 * against a lock of their own, and if they shared this path with each other or with a
 * real run, one test's `afterEach` would delete another's lock and a real sweep could
 * be told to stand down by a test. Neither check ever sets it.
 */
export const LOCK_FILE = ".mutation-lock.json";
export const LOCK_PATH = (() => {
  const override = process.env.MUTATION_LOCK_FILE;
  if (!override) return join(ROOT, ".freebuff", LOCK_FILE);
  return isAbsolute(override) ? override : join(ROOT, override);
})();

/** The project-relative, forward-slashed path a message names. */
const rel = (path) => relative(ROOT, path ?? "").split("\\").join("/");

/** The content hash the lock records, so recovery can tell which side of the edit it is on. */
const hash = (text) => createHash("sha1").update(text).digest("hex");

/**
 * How much of the mutated file either side of the splice recovery quotes back when it looks
 * for a mutation a later edit absorbed.
 *
 * A mutation is a statement — `if ( false ) return …`, a body replaced with an empty answer —
 * and detection needs the *stretch of file* around it rather than the inserted text alone,
 * because a short `return []` is a coincidence waiting to happen while the line it replaced,
 * and the line after it, are not. The padding is what makes the answer a fact about *this*
 * file rather than a string that happens to occur somewhere in the next one.
 */
const LEAK_CONTEXT = 60;

/**
 * The shortest inserted text the check will look for on its own, once the padded window
 * around it has failed to match even with its whitespace flattened.
 *
 * The padding above is what makes a *short* mutation trustworthy, and flattening only removes
 * the reasons a reformat breaks a match — it adds no discrimination of its own. So a writer
 * who rewrote the lines around a 9-character `return []` leaves nothing that tells the
 * mutation from their own code, and recovery says nothing rather than refusing on a
 * coincidence; the fallback declines instead. Past roughly a statement's worth of characters
 * the inserted text stands on its own, and looking for it is the point of the fallback: a
 * reformatted region can lose the context and keep the mutation.
 */
const LEAK_INSERTED_MIN = 24;

/**
 * The text with every run of whitespace flattened to one space and its ends trimmed.
 *
 * A writer who reformats a region rather than replacing it keeps every token and changes only
 * the spacing around them — reindented lines, a rewrapped call, different line endings. Both
 * sides of that comparison are flattened, so the answer is about the tokens on disk and not
 * about the spacing the writer happened to choose.
 */
const flatten = (text) => text.replace(/\s+/g, " ").trim();

/**
 * The one splice between two versions of a file: where the mutation landed in the source it
 * replaced, what it took out, and the text it put in.
 *
 * Trimming what the two versions share off both ends leaves exactly the edit, because every
 * mutation these checks apply is one `String.replace` or one slice spliced into the source.
 * The suffix is trimmed no further than the prefix reached, so a pure insertion and a pure
 * deletion come out as empty sides rather than as a splice that overlaps itself. `null` for
 * two identical versions, which no caller passes.
 */
function spliceOf(original, mutated) {
  if (original === mutated) return null;
  const shorter = Math.min(original.length, mutated.length);
  let at = 0;
  while (at < shorter && original[at] === mutated[at]) at += 1;
  let shared = 0;
  while (
    shared < shorter - at &&
    original[original.length - 1 - shared] === mutated[mutated.length - 1 - shared]
  ) {
    shared += 1;
  }
  return {
    at,
    removed: original.slice(at, original.length - shared),
    inserted: mutated.slice(at, mutated.length - shared),
  };
}

/**
 * The mutated source rebuilt from the lock's own copy and its splice, or `null` when those do
 * not rebuild the hash the lock recorded — a lock written by hand, or by an older shape of
 * this module. Recovery then has no mutated text it can trust, and says nothing rather than
 * guessing at one.
 */
function rebuiltMutated(entry) {
  const splice = entry?.splice;
  if (
    typeof entry?.original !== "string" ||
    typeof splice?.at !== "number" ||
    typeof splice.removed !== "string" ||
    typeof splice.inserted !== "string"
  ) {
    return null;
  }
  const mutated = `${entry.original.slice(0, splice.at)}${splice.inserted}${entry.original.slice(
    splice.at + splice.removed.length,
  )}`;
  return hash(mutated) === entry.mutatedHash ? { splice, mutated } : null;
}

/**
 * The stretch of the mutated file that a file matching neither side still contains, or `null`.
 *
 * A writer that edits a file while a check has it mutated can go two ways. It can *replace* the
 * mutation — their version is theirs, and the sweep's text is gone — or it can take the mutated
 * file as its base and edit around the mutation, which **absorbs** it: what is on disk then
 * carries a weakened check that neither of the lock's sides describes, that the sweep's own
 * restore will never undo, and that the next run would otherwise measure as the real thing. The
 * second is the state this exists to tell apart from the first, and the only trace of it is what
 * the two versions share — so the question is exactly that: is the mutated text still there,
 * around where the mutation landed, padded far enough that a short mutation is not a coincidence.
 *
 * Three answers, weakest evidence last, because a reformat is exactly the case the padded window
 * was written to miss: a writer who reindented the region left the mutation in place but moved
 * the spacing the verbatim window was pinned to.
 *
 *   1. the padded window, verbatim — the writer left the region alone;
 *   2. the same window with whitespace flattened — the writer reformatted the region and kept
 *      every token, which is the case this is here to close, and the window is still required in
 *      full and long enough on its own to be evidence;
 *   3. the mutation's own inserted text, flattened — the region was rewritten far enough that the
 *      surrounding lines are gone but the mutation survives, held to a length where an idiomatic
 *      `return []` can no longer be somebody else's code (`LEAK_INSERTED_MIN`).
 */
function absorbedStretch(entry, content) {
  const rebuilt = rebuiltMutated(entry);
  if (rebuilt === null) return null;
  const { splice, mutated } = rebuilt;
  const from = Math.max(0, splice.at - LEAK_CONTEXT);
  const to = Math.min(mutated.length, splice.at + splice.inserted.length + LEAK_CONTEXT);
  const stretch = mutated.slice(from, to);
  if (content.includes(stretch)) return stretch;
  const flattened = flatten(stretch);
  const flatContent = flatten(content);
  if (flattened.length >= LEAK_CONTEXT && flatContent.includes(flattened)) return stretch;
  const inserted = flatten(splice.inserted);
  if (inserted.length >= LEAK_INSERTED_MIN && flatContent.includes(inserted)) {
    return splice.inserted;
  }
  return null;
}

/** Whether a process with this pid exists (signal 0 probe; EPERM still means alive). */
function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Record the file about to be mutated, before it is. Atomic (tmp + rename) so a kill
 * mid-write is never a half file, and hashed here so the lock's shape is owned by one
 * side: the caller passes the two contents, not their hashes, and names itself in
 * `check` ("guard sweep", "coverage mutation check") so a later message can say whose
 * run it was.
 */
export function writeLock(entry) {
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    check: entry.check ?? "mutation check",
    file: {
      path: entry.path,
      kind: entry.kind ?? "mutation",
      where: entry.where ?? "?",
      original: entry.original,
      originalHash: hash(entry.original),
      mutatedHash: hash(entry.mutated),
      // Derived here rather than passed in, so the shape of a mutation is this module's to
      // keep: the callers hand over the two versions and nothing that could record a splice
      // the file does not have.
      splice: spliceOf(entry.original, entry.mutated),
    },
  };
  const tmp = `${LOCK_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmp, LOCK_PATH);
}

/** Remove the lock (and any half-written temp), best effort. */
export function clearLock() {
  for (const path of [LOCK_PATH, `${LOCK_PATH}.tmp`]) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best effort: a lock that cannot be removed is reported by the next run */
    }
  }
}

/**
 * Put back whatever a killed run left mutated, and stand down if one is still running.
 *
 * This must run before anything reads the files a check mutates — a route still
 * rewritten (`if ( false )`, or a refusal body replaced with a success return), or a
 * coverage script still weakened, would be read as the real thing and the wrong check
 * would be built on it. The cases below are the whole discretion, and they are
 * stated where the lock's shape is, above — including the fourth, the file a later edit
 * left still carrying the mutation, which is refused rather than reported.
 */
export function recoverInterruptedRun({ mode = "exit" } = {}) {
  const tmp = `${LOCK_PATH}.tmp`;
  if (existsSync(tmp)) {
    try {
      unlinkSync(tmp);
    } catch {
      /* a leftover temp from a killed write; nothing references it */
    }
  }
  if (!existsSync(LOCK_PATH)) return null;

  /** The event recovery reports, printed here and returned for the caller's report. */
  const event = (action, path, message, lock, entry) => {
    console.error(message);
    return {
      action,
      path,
      message,
      check: lock?.check ?? null,
      kind: entry?.kind ?? null,
      where: entry?.where ?? null,
    };
  };

  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  } catch {
    clearLock();
    return event(
      "unreadable",
      rel(LOCK_PATH),
      `WARNING: ${rel(LOCK_PATH)} is unreadable; removing it without restoring.`,
      null,
      null,
    );
  }

  if (isRunning(lock.pid)) {
    const holder = `${lock.check ?? "unknown"}, pid ${lock.pid}, started ${lock.startedAt ?? "?"}`;
    if (mode === "report") {
      return event(
        "held",
        rel(lock.file?.path ?? LOCK_PATH),
        `WARNING: ${
          lock.file?.path ? rel(lock.file.path) : rel(LOCK_PATH)
        } is being mutated by a running tree-editing check (${holder}); leaving the lock alone.`,
        lock,
        lock.file ?? null,
      );
    }
    console.error(`REFUSING TO START: another tree-editing check (${holder}) holds ${rel(LOCK_PATH)}.`);
    console.error("Wait for it to finish, or stop it, then run again.");
    process.exit(3);
  }

  const entry = lock.file;
  if (!entry || typeof entry.path !== "string") {
    clearLock();
    return event(
      "unreadable",
      rel(LOCK_PATH),
      `WARNING: ${rel(LOCK_PATH)} names no file; removing it without restoring.`,
      lock,
      null,
    );
  }

  if (!existsSync(entry.path)) {
    clearLock();
    return event(
      "missing",
      rel(entry.path),
      `Recovered lock: ${rel(entry.path)} no longer exists; nothing to restore.`,
      lock,
      entry,
    );
  }

  const content = readFileSync(entry.path, "utf8");
  const current = hash(content);
  if (current === entry.originalHash) {
    // The check restored it before dying (or never got to write); the file is whole and
    // only the lock outlived the run, which is still worth saying: a run died here.
    clearLock();
    return event(
      "cleared",
      rel(entry.path),
      `Cleared a stale lock: ${rel(entry.path)} was already back to its pre-mutation source.`,
      lock,
      entry,
    );
  }
  if (current !== entry.mutatedHash) {
    // The mutation may have survived that edit rather than been replaced by it, which is the
    // difference between a file this lock can no longer describe and a file nobody may measure.
    if (absorbedStretch(entry, content) !== null) {
      // The holder is dead — a live one was refused above — and the mutation is still in the
      // file, under a later edit. Nothing may measure a file in this state, and the sweep that
      // could was killed, so the old "refuse and leave it" answer made every run until a human
      // showed up measure nothing while the weakened source sat on disk. The lock's
      // pre-mutation source goes back instead, taking the mutation and the edit it was absorbed
      // into out together: that edit was written on top of a mutated file, so it was built on
      // source no check had measured, and the event names the loss rather than keeping it
      // silently. The lock goes with it — the record and the state it records are both gone.
      let wrote = true;
      try {
        writeFileSync(entry.path, entry.original);
      } catch {
        wrote = false;
      }
      if (!wrote || hash(readFileSync(entry.path, "utf8")) !== entry.originalHash) {
        // A restore that did not verify is the one absorbed state that still stops the caller:
        // a half-written file is worse than the mutated one it came from.
        const absorbed = event(
          "absorbed",
          rel(entry.path),
          `STOP: could not restore ${rel(entry.path)} from a lock whose file a later edit had ` +
            `absorbed the mutation into (${lock.check ?? "mutation check"}, ${
              entry.kind ?? "mutation"
            }: ${entry.where ?? "?"}) — the write did not verify, so the file is left as it is ` +
            "now, with the lock in place; inspect it by hand.",
          lock,
          entry,
        );
        // In `mode: "report"` the refusal belongs to the caller, which is not the lock's owner
        // and must not have its report taken away from under it — that is what the event above
        // is for. Every other caller is about to rewrite this file itself, and must not.
        if (mode === "report") return absorbed;
        process.exit(2);
      }
      clearLock();
      return event(
        "absorbed-restored",
        rel(entry.path),
        `RESTORED ${rel(entry.path)} from an interrupted ${lock.check ?? "mutation check"} (${
          entry.kind ?? "mutation"
        }: ${entry.where ?? "?"}) — a later edit had absorbed the mutation instead of replacing ` +
          "it, so the file went back to its pre-mutation source, taking the mutation and the " +
          "edit it sat on out together. Re-make that edit against the whole file if it was wanted.",
        lock,
        entry,
      );
    }
    return event(
      "left",
      rel(entry.path),
      `WARNING: ${rel(entry.path)} differs from both the pre- and post-mutation content — ` +
        "someone else edited it. Leaving it as it is now, and the lock in place; inspect it by hand.",
      lock,
      entry,
    );
  }

  writeFileSync(entry.path, entry.original);
  if (hash(readFileSync(entry.path, "utf8")) !== entry.originalHash) {
    if (mode === "report") {
      return event(
        "failed",
        rel(entry.path),
        `WARNING: could not restore ${rel(entry.path)}; leaving the lock in place.`,
        lock,
        entry,
      );
    }
    console.error(`STOP: could not restore ${rel(entry.path)}; leaving the lock in place.`);
    process.exit(2);
  }
  clearLock();
  return event(
    "restored",
    rel(entry.path),
    `RESTORED ${rel(entry.path)} from an interrupted ${lock.check ?? "mutation check"} (${
      entry.kind ?? "mutation"
    }: ${entry.where ?? "?"}).`,
    lock,
    entry,
  );
}
