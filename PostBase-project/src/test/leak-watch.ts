import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll } from "vitest";

/**
 * The suite's write tripwire: a test that writes into the checkout leaves dirt,
 * and this is what makes that loud.
 *
 * The suite runs on a shared checkout, and the whole reason `src/test/scratch.ts`
 * exists is that a test needing a file — a stub, a fixture, a pin — must build it
 * somewhere that is not the tree under test. That rule broke once in a way nothing
 * noticed: the concurrent-edit suspects built the path of their pin fixture in a
 * describe body, which is evaluated while the file is *collected* — before the
 * suite's `beforeAll` hands out the scratch directory — so the path froze the empty
 * string it started as and `path.join("", "ci-suspect-pin.mjs")` was a *relative*
 * path. Every run wrote that fixture over a tracked file at the checkout's root.
 * The suite stayed green, `git status` did not, and the file was committed by a
 * later sweep of the working tree.
 *
 * The drift watch (`suite-drift.ts`) cannot answer that, on purpose: it fingerprints
 * `src` and `worker`, and it *warns*, because another session editing the checkout is
 * a fact about the environment rather than a defect in this code. This answers the
 * other question — the one that is a defect: a file a test wrote. The writes are
 * recorded inside the test process by `leak-watch-preload.mjs` (see it for why the
 * patch cannot live here), and at the end of each test file this module asks git
 * whether the recorded paths inside the checkout are dirty. Another session's writes
 * are invisible to it, because it only ever asks about paths this process touched; a
 * test's own transient write — a probe created and removed in a `finally` — answers
 * clean, because the question is what the file *left behind*, not what it touched.
 *
 * It is an `afterAll` hook in a setup file rather than a reporter because the answer
 * has to name the file whose test wrote: a reporter runs once, in Vitest's own
 * process, after the workers are gone, and would need a sidecar file to say anything
 * at all. The hook runs in the worker that made the write, with the record in hand,
 * and a throw from it fails that file — the shape `.freebuff/ci.mjs` already names as
 * "a suite whose tests all passed".
 *
 * The checkout is the project directory the suite runs from, one level below the
 * repository that holds it. A write to the repository above (its `.github/`, say) is
 * outside this guard's view and nothing in the suite makes one; the project directory
 * is where a fixture lands.
 */

/**
 * The `globalThis` key the preload leaves its record under.
 *
 * Spelled in both files — the preload cannot be imported from here without running
 * it a second time, after the `node:fs` namespace it has to beat was built — and
 * pinned against each other by `leak-watch.test.ts`, so the two spellings cannot
 * drift apart into a tripwire that records nothing.
 */
export const TRIPWIRE_KEY = Symbol.for("postbase.leak-watch");

/**
 * The checkout this suite runs from: the project directory, not the repo above it.
 *
 * The working directory, read once — not this module's own URL. A path read here
 * sometimes *is* the answer, but the module is loaded three ways: the node
 * environments, the mutation runners, and every `vitest run` share the project
 * directory as their working directory, exactly what this constant is after;
 * and the jsdom workers load the file through Vite's transform, where
 * `import.meta.url` is not the disk path its prefix advertises — a `file:`-
 * shaped URL whose tail Node's `fileURLToPath` will not take. The one
 * environment-independent answer is how the process was launched.
 */
export const CHECKOUT = process.cwd();

/** One path a preload recorded, as the preload reports it. */
export interface RecordedWrite {
  /** The absolute path, resolved against the writing process's directory. */
  path: string;
  /** The operation that first wrote it: `write`, `copy`, `delete`, … */
  op: string;
  /** Whether anything was there before that first write. */
  existed: boolean;
}

/** The record the preload keeps for one worker process. */
interface Tripwire {
  recorded(): RecordedWrite[];
  clear(): void;
}

/** The preload's record in this process, or null when the preload never ran. */
function tripwire(): Tripwire | null {
  const found = (globalThis as unknown as Record<PropertyKey, unknown>)[TRIPWIRE_KEY];
  return found ? (found as Tripwire) : null;
}

/**
 * Directories whose writes are never the checkout's own dirt: `node_modules` is
 * third-party code and build caches, and `.git` is git's own. Dropped before git is
 * asked anything, so a parked cache cannot cost a git call per file.
 */
const NOT_THE_SUITE = new Set(["node_modules", ".git"]);

/**
 * Whether a path is inside the checkout.
 *
 * `path.relative` rather than a string prefix, so a sibling directory whose name
 * merely starts with the checkout's (`…/PostBase-project-copy`) is outside it. The
 * checkout itself is not "inside" it: nothing writes to the directory.
 */
export function inCheckout(target: string, checkout: string = CHECKOUT): boolean {
  const relative = path.relative(checkout, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Whether a recorded path is the checkout's own tree rather than third-party or VCS data. */
function theSuiteTree(file: string): boolean {
  return inCheckout(file) && !file.split(path.sep).some((part) => NOT_THE_SUITE.has(part));
}

/**
 * The paths this worker's tests have written inside the checkout, in the order they
 * were first written.
 *
 * The preload records everything and this decides what is the checkout's business,
 * so the policy lives in one place: `src/test/scratch.ts` is where a test's files
 * go, and a path outside the checkout — the scratch directory, the OS temp dir — is
 * not this process's dirt whatever a test did with it.
 */
export function recordedWrites(): RecordedWrite[] {
  return (tripwire()?.recorded() ?? []).filter((entry) => theSuiteTree(entry.path));
}

/**
 * The recorded writes whose result only git can judge.
 *
 * A path that was not there before its write and is not there now cannot have
 * dirtied anything, so it is dropped — which is the whole point: a test that builds
 * a probe in the tree and removes it in a `finally` is invisible here, and a quiet
 * file never pays for a git call. Everything else is asked about: a survivor may be
 * a new file (dirty unless git ignores it) or a rewritten one, and one that existed
 * before and is gone now is a deletion.
 *
 * `exists` is a parameter so the two cases can be driven without leaving a file
 * behind — the same reason `checkout-watch.ts` takes its snapshot as a parameter.
 */
export function needingGit(
  entries: RecordedWrite[],
  exists: (file: string) => boolean = (file) => fs.existsSync(file),
): RecordedWrite[] {
  return entries.filter((entry) => entry.existed || exists(entry.path));
}

/** The worktree the checkout lives in, cached: what git's paths are read from. */
let toplevel: string | null = null;

/** The repository root above the checkout, or a thrown error saying why not. */
function gitToplevel(): string {
  if (toplevel !== null) return toplevel;
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: CHECKOUT,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      "leak-watch: could not ask git for the repository root — a suite write cannot be " +
        `judged without it (${result.error?.message ?? (result.stderr || "no output").trim()})`,
    );
  }
  toplevel = result.stdout.trim();
  return toplevel;
}

/**
 * The paths git still reports as changed, out of the ones asked about.
 *
 * Git decides rather than a list of blessed directories, because "dirty" is git's
 * question: `.ci/`, `.temp/`, the collect-budget sidecars and build output are all
 * ignored, so a test writing them is not dirt — and an ignore rule that changes
 * changes this with it, with no second list to keep in step. One call for the whole
 * file, `-z` because a path is not a line, and paths come back relative to the
 * repository root, which is why they are resolved against it.
 */
export function dirtyWrites(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const root = gitToplevel();
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "status", "--porcelain", "-z", "--", ...paths],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "leak-watch: could not ask git whether this file's writes left the checkout dirty — " +
        `${result.error?.message ?? (result.stderr || "no output").trim()}`,
    );
  }
  const dirty: string[] = [];
  const entries = result.stdout.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    // `XY <path>`, the porcelain vocabulary: staged/unstaged state then a space.
    if (!/^[ MADRCU?!]{2} /.test(entry)) continue;
    dirty.push(path.resolve(root, entry.slice(3)));
    // A rename or copy also prints the path it came from, which is not the entry.
    if ("RC".includes(entry[0])) index += 1;
  }
  return dirty;
}

/** How many paths the failure spells out before it summarizes the rest. */
export const LEAK_SAMPLE_LIMIT = 10;

/**
 * The failure a file throws when its own writes were left in the checkout.
 *
 * It has to say three things, because the run it lands in looks wrong otherwise:
 * which paths are dirty, that the *tests* are not the failure (the hook throws, so
 * the file goes red with every case passing), and what to do instead — build the
 * file where `makeScratchDir` says. Paths are shown relative to the checkout, the
 * form a reader can paste into `git diff` from here.
 */
export function leakMessage(dirty: string[]): string {
  const shown = dirty.slice(0, LEAK_SAMPLE_LIMIT).map((file) => {
    const name = inCheckout(file) ? path.relative(CHECKOUT, file).split(path.sep).join("/") : file;
    return `    ${name}`;
  });
  if (dirty.length > LEAK_SAMPLE_LIMIT) {
    shown.push(`    …and ${dirty.length - LEAK_SAMPLE_LIMIT} more`);
  }
  return [
    "",
    `[leak-watch] this file's tests wrote into the checkout and left it dirty — ` +
      `${dirty.length} path(s) git reports as changed:`,
    ...shown,
    "  The cases themselves passed: the dirt is the failure. A test's files — a stub, a fixture,",
    "  a pin — belong in the scratch directory `makeScratchDir` hands out (`src/test/scratch.ts`),",
    "  which is removed after the file. Anything a test writes in the tree on purpose has to be",
    "  removed before the file ends, because what survives is read by the next run and hashed by",
    "  the gate as though it were part of the tree.",
    "",
  ].join("\n");
}

/** What to say when the recording half is not loaded, and what fixes it. */
const NOT_INSTALLED = [
  "leak-watch: the write tripwire's recording half is not loaded in this worker, so no suite",
  "write into the checkout can be judged. It is a preload, and `vitest.config.ts` has to hand it",
  "to the pool:",
  "",
  '  test: { execArgv: ["--import", new URL("./src/test/leak-watch-preload.mjs", import.meta.url).href] }',
  "",
  "Restore that line — without it the guard is off for every run, in every file.",
].join("\n");

/**
 * Installs the verdict for every test file.
 *
 * Called once from `setup.ts`, which runs in each worker before the file's own
 * modules — so a fixture path built during collection is already being watched. It
 * throws when the preload is missing rather than reporting a quiet tree: a guard
 * that silently is not there is the failure this whole module exists to prevent.
 * The hook consults git only when a recorded path survived or predated its write, so
 * a file that writes nothing — and the many that write only transiently — never
 * spawns anything. The record is cleared afterwards, in a `finally`, so a worker
 * reused for a later file cannot blame it for an earlier one's writes.
 */
export function watchForLeaks(): void {
  if (!tripwire()) throw new Error(NOT_INSTALLED);
  afterAll(() => {
    const record = tripwire();
    try {
      if (!record) throw new Error(NOT_INSTALLED);
      const suspects = needingGit(recordedWrites());
      const dirty = dirtyWrites(suspects.map((entry) => entry.path));
      if (dirty.length > 0) throw new Error(leakMessage(dirty));
    } finally {
      record?.clear();
    }
  });
}
