/**
 * The recording half of the suite's write tripwire, loaded into every worker
 * *before* Vitest's own module graph exists.
 *
 * It has to be here, and not in `setup.ts` where the rest of the tripwire lives,
 * because of how Node hands out builtins: `import { writeFileSync } from "node:fs"`
 * in an inlined module is bound from the `node:fs` namespace, and that namespace is
 * materialised — with the functions it will keep — the first time anything in the
 * process asks for it, which is long before a setup file runs. Patching the CJS
 * object afterwards still catches `fs.writeFileSync(...)` (the default import and
 * `import * as fs` reach it), but a named import keeps the function that was
 * captured before the patch. The leak this exists for was written through exactly
 * that named import, so the patch has to be in place before the namespace is built:
 * a preload, wired as `test.execArgv` in `vitest.config.ts`.
 *
 * It has no policy. Every mutating call it sees is recorded, with the path resolved
 * to an absolute one — a relative target is resolved against the process's working
 * directory, which is the shape the leak took — and the record is left on
 * `globalThis` for `leak-watch.ts` to judge: what counts as the checkout, what
 * counts as dirt and what to say about it are decided in one place, in the TS
 * module, so this file cannot come to disagree with it about anything but the seam.
 *
 * The key is spelled here and in `leak-watch.ts` (which pins the two against each
 * other) rather than shared by an import: importing this module from the test graph
 * would run it a second time *after* the namespace was built, and a tripwire that
 * silently installs the weaker patch is worse than one that is missing.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `node:fs` through `require`, deliberately, and this line is the whole patch.
 *
 * An ESM `import fs from "node:fs"` — even here — is what *materialises* the
 * builtin's namespace, and Node fills that namespace with the functions the CJS
 * object holds at that moment. Importing it to patch it would therefore capture the
 * originals and hand them to every later `import { writeFileSync } from "node:fs"`:
 * the patch would appear to work (the default import and `import * as fs` reach the
 * patched CJS object) while missing exactly the named imports this exists for. The
 * `require` below takes the CJS object without building that namespace, so the
 * first real import of `node:fs` in the process — by Vitest, or by a test file —
 * captures the patched functions instead.
 */
const fs = createRequire(import.meta.url)("node:fs");

const KEY = Symbol.for("postbase.leak-watch");

/** Every mutating entry point, and the operation it is recorded as. */
const CALLS = [
  ["writeFileSync", "write"],
  ["appendFileSync", "append"],
  ["truncateSync", "truncate"],
  ["renameSync", "rename"],
  ["copyFileSync", "copy"],
  ["unlinkSync", "delete"],
  ["rmSync", "delete"],
  ["rmdirSync", "delete"],
  ["createWriteStream", "write"],
  ["writeFile", "write"],
  ["appendFile", "append"],
  ["truncate", "truncate"],
  ["rename", "rename"],
  ["copyFile", "copy"],
  ["unlink", "delete"],
  ["rm", "delete"],
  ["rmdir", "delete"],
];

/**
 * The one call whose first argument is not the path that changes: a copy rewrites
 * its destination and leaves its source alone.
 */
const DESTINATION_ARG = { copyFileSync: 1, copyFile: 1 };

/** The paths this process has written, in the order it first wrote them. */
const recorded = new Map();

/** Records one target, when it names a path. */
function note(target, op) {
  let value;
  try {
    value = target instanceof URL ? fileURLToPath(target) : target;
  } catch {
    return;
  }
  if (typeof value !== "string") return;
  const resolved = path.resolve(process.cwd(), value);
  if (recorded.has(resolved)) return;
  // Whether the path existed *before* the call is what lets the verdict skip a
  // transient write — a probe a test removes again — without asking git at all.
  let existed = false;
  try {
    existed = fs.existsSync(resolved);
  } catch {
    existed = false;
  }
  recorded.set(resolved, { path: resolved, op, existed });
}

/**
 * Replaces one entry point on one owner, if that owner has it.
 *
 * Both `fs` and `fs.promises` are wrapped, because the names overlap and code under
 * test may use either: `writeFile` exists as the callback API on `fs` and as the
 * promise API on `fs.promises`, and a patch on one says nothing about the other.
 */
function wrap(owner, name, op) {
  const original = owner[name];
  if (typeof original !== "function") return;
  const destination = DESTINATION_ARG[name] ?? 0;
  owner[name] = function recordedCall(...args) {
    note(args[destination], op);
    // A rename also removes its source, which is a change to that path like any
    // other; a copy leaves its source alone and is not recorded twice.
    if (op === "rename") note(args[0], op);
    return original.apply(this, args);
  };
}

if (!globalThis[KEY]) {
  for (const [name, op] of CALLS) {
    wrap(fs, name, op);
    wrap(fs.promises, name, op);
  }
  globalThis[KEY] = {
    recorded: () => [...recorded.values()],
    clear: () => recorded.clear(),
  };
}
