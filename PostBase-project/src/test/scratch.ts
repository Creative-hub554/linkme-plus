import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The throwaway directory a suite builds for itself, and the one place it is taken away.
 *
 * A suite that runs a real process or a real gate needs a scratch tree — a fake checkout, a
 * stub script, a fixture payload — and each one used to hand-roll the same two calls:
 * `mkdtempSync(join(tmpdir(), "<name>-"))` to make it, and a recursive `rmSync` in `afterAll`
 * to remove it. The removal is the half that bites. On Windows a handle the OS, a search
 * indexer or an antivirus has not let go of yet makes `rmSync` throw `EBUSY` or `EPERM`, and a
 * throw out of `afterAll` fails the *suite* while every test in it passed — a red run with
 * nothing red in it, which `.freebuff/ci.mjs`'s `failureOutsideTests` can now name but which
 * still costs a full investigation to find out was a temporary file.
 *
 * None of that is a claim about the code under test, so it is not allowed to fail a run. The
 * removal retries first — `maxRetries`/`retryDelay` are Node's own linear backoff for exactly
 * those errnos, and apply only to a `recursive` removal — and then gives up *loudly*, the same
 * way `src/test/checkout-watch.ts` reports a checkout moving under the suite and gets out of
 * the way. A scratch directory left in the temp dir is an environment fact; a red suite is
 * not.
 */

/**
 * How many times a failed removal is retried before it is reported and abandoned.
 *
 * Ten steps of a linear backoff is under three seconds of waiting at worst, which a
 * `hookTimeout` absorbs and a human never notices — and it is a bound rather than a target:
 * anything still refusing after it is reported rather than waited out, because a suite must
 * not spend seconds of every run covering for a file nobody will let go.
 */
const REMOVE_RETRIES = 10;

/** The first backoff step, in ms; each retry waits one step longer (Node's linear backoff). */
const RETRY_DELAY_MS = 50;

/** A fresh scratch directory under the OS temp dir, named for the suite that asked for it. */
export function makeScratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Removes `dir` and everything under it, and never throws.
 *
 * The retry is for the ordinary case — the handle is released a moment later — and the catch
 * is for everything else, including the reasons no retry can help. A throw here would leave
 * `afterAll` failing a suite whose tests all passed, which is the whole reason this is a
 * function rather than a call. `write` is a parameter rather than `console.warn` directly for
 * the same reason `reportDrift` takes one: the give-up branch can then be driven without
 * capturing the console.
 */
export function removeScratchDir(
  dir: string,
  write: (message: string) => void = (message) => console.warn(message),
): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: REMOVE_RETRIES,
      retryDelay: RETRY_DELAY_MS,
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const reason = code ?? (error instanceof Error ? error.message : String(error));
    write(
      `[scratch] ${dir} could not be removed (${reason}) — left where it is. A temp directory is ` +
        "not the code under test, so this is reported rather than failed.",
    );
  }
}
