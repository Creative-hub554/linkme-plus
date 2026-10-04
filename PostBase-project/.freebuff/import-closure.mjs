/**
 * The `.mjs` import closure of a gate script, read out of the sources.
 *
 * A stage's cache key has to cover the gate it runs *and every module that gate
 * loads*: a helper a gate script imports is machinery of that stage, and a pass
 * recorded before the helper changed would vouch for a gate nobody ran. The
 * runner folds this closure into each script-backed stage's key files, and
 * `src/test/ci-runner.test.ts` pins the derivation itself, so there is exactly
 * one walker and nothing that restates what it finds.
 *
 * The walk is deliberately textual — no parser, no subprocess — because the
 * specifiers it reads are ours: relative, double-quoted, `.mjs`, one per
 * statement. Comment lines are dropped first, so prose *about* a module
 * (`reads \`./redact.mjs\``) is not read as an import of one. Only literal
 * specifiers are visible — a computed `import(pathToFileURL(...))` is not —
 * and the one module that matters and is loaded that way (the pin manifest, by
 * the drift alarm) is named by the drift stage's `inputs` directly. That
 * blindness is part of the contract, not an oversight: a walk that could see
 * every load would need a parser to be honest about it.
 */

import { readFileSync } from "node:fs";

/**
 * The repo-relative `.mjs` modules a script loads: the script itself, everything
 * it imports, and everything they import in turn.
 *
 * Paths are repo-relative with forward slashes — the same form every stage
 * `input`, pin row and report name uses — and `read` turns one of those into
 * text, or `undefined` when the file is gone. The default read resolves against
 * the checkout; a test stands a map in. A file that cannot be read contributes
 * itself and nothing further: the specifier is still the fact the key is about,
 * and hashing it as absent is the notice a key exists to give. The walk is
 * memoized on the specifier set, so a diamond — two stages importing one guard
 * — costs one pass.
 */
export function importClosure(script, read = defaultRead, seen = new Set()) {
  if (seen.has(script)) return seen;
  seen.add(script);
  const text = read(script);
  if (text === undefined) return seen;
  const code = text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    })
    .join("\n");
  for (const match of code.matchAll(/(?:from|import) *\(?\s*"(\.[^"]+\.mjs)"/g)) {
    importClosure(posixJoin(dirname(script), match[1]), read, seen);
  }
  return seen;
}

/** The literal file read, resolving a repo-relative path against the checkout. */
function defaultRead(script) {
  try {
    return readFileSync(script, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * POSIX join for the repo-relative specifiers the walk produces.
 *
 * Own rather than `path.posix` so the walker never sees a host separator: the
 * specifiers are forward-slashed by contract, and keeping the arithmetic inside
 * this module is what lets the runner and the test share one closure.
 */
function posixJoin(from, specifier) {
  const parts = [];
  for (const part of `${from}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** `node:path`'s dirname, inlined to keep this module's imports to `node:fs`. */
function dirname(script) {
  const cut = script.lastIndexOf("/");
  return cut === -1 ? "." : script.slice(0, cut);
}
