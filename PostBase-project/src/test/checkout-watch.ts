import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Watching the checkout, so a whole-project check is judged on a tree that held
 * still.
 *
 * `lint-baseline.test.ts` runs `tsc` and ESLint over every file, and this checkout
 * is shared — another writer can land between the first file a tool reads and the
 * last. A diagnostic taken then describes a tree that no longer exists: a type
 * error in a file that has since been fixed, a finding in code that has since
 * moved. That is not a flaky *test*; it is a result about a moving tree, and no
 * edit to the test can make it go away.
 *
 * What can be made deterministic is the *answer*: take the check again while the
 * tree is moving, and report the first run that saw the same fingerprint twice.
 * The fingerprint is size and mtime, not content — it only has to *notice* a
 * rewrite across a thousand files, not prove one.
 */

/** A file's cheap identity: enough to tell that it was rewritten. */
export type FileFingerprint = Map<string, string>;

/**
 * Every file under `roots` whose name `isWatched` accepts, keyed by absolute
 * path. `node_modules` is skipped; a directory or file that vanishes mid-walk is
 * simply left out, since the next snapshot is what notices it.
 */
export function snapshotTree(
  roots: string[],
  isWatched: (name: string) => boolean,
): FileFingerprint {
  const snapshot: FileFingerprint = new Map();

  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!isWatched(entry.name)) continue;
      try {
        const stats = statSync(full);
        snapshot.set(full, `${stats.size}:${stats.mtimeMs}`);
      } catch {
        // Vanished between listing and stating: not this snapshot's to report.
      }
    }
  };

  for (const root of roots) visit(root);
  return snapshot;
}

/** The paths whose fingerprint differs between two snapshots, added and removed ones included. */
export function changedFiles(before: FileFingerprint, after: FileFingerprint): string[] {
  const changed: string[] = [];
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(file) !== after.get(file)) changed.push(file);
  }
  return changed.sort();
}

export interface QuietResult<T> {
  /** The value from the first run that saw the tree hold still — or the last, if none did. */
  value: T;
  /** The files that moved under the last run; empty when it held still. */
  drift: string[];
}

/**
 * Runs `check` on a tree that is not being written to.
 *
 * The tree is fingerprinted either side of each run, and a run whose tree moved
 * is thrown away and taken again — up to `attempts`. The returned `drift` is what
 * moved under the final run, so a caller can tell a real finding from a tree that
 * never held still: a failure with `drift` set is not a failure of the code.
 *
 * `snapshot` is a parameter rather than the filesystem directly so the retry
 * itself can be exercised on a still tree.
 */
export async function runOnQuietTree<T>(
  check: () => T | Promise<T>,
  options: { snapshot: () => FileFingerprint; attempts?: number },
): Promise<QuietResult<T>> {
  const attempts = Math.max(1, options.attempts ?? 3);

  let before = options.snapshot();
  let value = await check();
  let drift = changedFiles(before, options.snapshot());

  for (let attempt = 2; attempt <= attempts && drift.length > 0; attempt += 1) {
    before = options.snapshot();
    value = await check();
    drift = changedFiles(before, options.snapshot());
  }

  return { value, drift };
}

/**
 * Source the project owns; generated `*.d.ts` and build output are excluded.
 *
 * Shared by every whole-project check — the lint and typecheck baselines and the
 * suite-level drift watch — so they all agree on what "the source tree" is and a
 * change to one cannot silently leave the other watching a different set.
 */
export const SOURCE_ROOTS = ["src", "worker"];
export const SOURCE_FILE = /\.(?:ts|tsx|mjs|js)$/;

/**
 * A fingerprint of the project's own source, rooted at `projectRoot`.
 *
 * Composed here rather than at each call site so a whole-project check and the
 * suite-level watch fingerprint the same files in the same way.
 */
export function projectSourceSnapshot(projectRoot: string): FileFingerprint {
  return snapshotTree(
    SOURCE_ROOTS.map((root) => path.join(projectRoot, root)),
    (name) => SOURCE_FILE.test(name),
  );
}

/** How many moved paths a warning spells out before it summarizes the rest. */
export const DRIFT_SAMPLE_LIMIT = 20;

/**
 * The warning a suite prints when the checkout moved under it.
 *
 * It exists so a source-reading failure can be told apart from a real one: when
 * the tree changed mid-run, a guard that reads files may be describing a checkout
 * that is already gone. The message says that up front, next to the files that
 * moved, rather than leaving the reader to guess. `changed` is a `changedFiles`
 * result; the paths are sampled when there are more than `DRIFT_SAMPLE_LIMIT`.
 */
export function driftWarning(changed: string[], label = "The checkout"): string {
  const shown = changed.slice(0, DRIFT_SAMPLE_LIMIT).map((file) => `    ${file}`);
  if (changed.length > DRIFT_SAMPLE_LIMIT) {
    shown.push(`    …and ${changed.length - DRIFT_SAMPLE_LIMIT} more`);
  }
  return [
    "",
    `[checkout-drift] ${label} changed while the suite was running — ${changed.length} source file(s) moved.`,
    ...shown,
    "  A source-reading test that failed in this run may be describing a tree that is already gone.",
    "  Re-run on a checkout no one else is writing before treating the failure as real.",
    "",
  ].join("\n");
}

/**
 * Reports drift between two snapshots and returns the files that moved.
 *
 * `write` is a parameter rather than `console.warn` directly so the branch that
 * decides whether to warn can be exercised without touching the console — the
 * same reason `runOnQuietTree` takes its snapshot.
 */
export function reportDrift(
  before: FileFingerprint,
  after: FileFingerprint,
  write: (message: string) => void = (message) => console.warn(message),
): string[] {
  const changed = changedFiles(before, after);
  if (changed.length > 0) write(driftWarning(changed));
  return changed;
}
