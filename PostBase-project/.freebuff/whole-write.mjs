#!/usr/bin/env node
/**
 * The save a pinned gate script is allowed to take: whole text, or nothing.
 *
 * ## Why this exists
 *
 * `.freebuff/preview-preflight.mjs` was found on disk cut off mid-template at its line 970,
 * its last three lines gone. Nothing *parsed* it after that write, so the next run reported
 * one truncation as four unrelated failures — a lint finding in a file it never linted, a
 * killed process with no JSON, a suite whose subject never loaded, and a pin that moved. A
 * parse guard in the runner now names that shape before a stage runs, and a pin in
 * `src/test/preview-preflight.test.ts` holds the one truncation a parse check cannot see.
 * Both read a file that is already broken. This is the other half: the write that would
 * break it is refused.
 *
 * ## What it refuses
 *
 * A save of a **pinned gate script** — the manifest's own list, filtered to the extensions
 * whose text is a program — is refused when the text about to be written is not whole: a
 * delimiter, a string, a template or a block comment left open, a closer with nothing to
 * close, or nothing but whitespace. The check is textual on purpose. It runs on the text
 * *to be written* rather than on a file that has landed, it needs no subprocess and no
 * parser dependency, and it is the same reading a person makes by eye: what I am about to
 * save, does it still hold together?
 *
 * It is a **stub for `writeFileSync`**, not a replacement for one: `saveWholeScript` verifies
 * and then writes, and a caller that writes a pinned script without it has simply opted out.
 * Every writer that rewrites a pinned script in place — the preflight sweep, the guard sweep,
 * the coverage mutator and the baseline applier — calls it for the content it *introduces*.
 * Restores do not: a restore puts back bytes that were already on disk, and a guard that
 * could refuse one would be able to leave a mutation behind, which is strictly worse than
 * the file it was trying to protect.
 *
 * ## What it is careful about
 *
 * Counting brackets would be useless on files like these, which are full of `}` inside
 * strings, `${...}` inside templates, delimiters inside regular expressions and brace-heavy
 * comments. So the scan tracks the states that make a delimiter not a delimiter, and the
 * states that make a `/` a regex rather than a division — the one call it cannot make from
 * the character alone, so it reads the token before it, and treats the words that expect a
 * value (`return`, `typeof`, `case`, …) as opening one. A `/` mis-read here is not a
 * correctness risk: a regex counted as code contributes balanced delimiters or none at all,
 * and the false refusals it could cause are exactly what the scanner's own cases watch for.
 *
 * `--check [paths…]` reads the tree instead and answers whether every pinned script on disk
 * is whole right now (exit 1 and the findings when one is not); `--list` prints the pinned
 * set. Neither writes anything.
 *
 * This file is **not pinned yet**: `DEFAULT_WATCHES` in `.freebuff/gate-drift.mjs` names the
 * families the manifest covers, and a one-line rule naming `.freebuff/whole-write.mjs` is
 * what makes `npm run gates:pin` record it. Until then the guard is held by its own cases in
 * `src/test/whole-write.test.ts`, which also run it over every pinned script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { files } from "./gate-hashes.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The extensions whose text is a program, and so has to balance. */
export const SCRIPT_EXTENSIONS = [".mjs", ".js", ".cjs", ".mts", ".cts", ".ts"];

/** Whether a path's text is a script this guard can read. */
export const isScriptPath = (path) => SCRIPT_EXTENSIONS.some((ext) => path.endsWith(ext));

/** Every pinned path whose text is a script, project-relative and sorted. */
export const pinnedGateScripts = () => Object.keys(files).filter(isScriptPath).sort();

/** The project-relative, forward-slashed path a finding names. */
export const toRel = (path) => relative(ROOT, isAbsolute(path) ? path : resolve(path)).split("\\").join("/");

/** The delimiter each opener needs, and the only characters this scan counts. */
const OPENERS = { "(": ")", "[": "]", "{": "}" };

/** The characters a `/` cannot follow and still open a regex: a value just ended there. */
const VALUE_ENDS = new Set([")", "]", "}"]);

/** The words that expect a value next, so a `/` after one opens a regex rather than divides. */
const VALUE_WORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do", "else",
  "case", "yield", "await", "throw", "default", "extends", "keyof", "infer", "satisfies",
]);

/**
 * Every way `text` fails to be whole, in file order.
 *
 * Empty when the text balances — which is the only answer that lets a save through — and a
 * list of `{ line, column, message }` otherwise, each one pointing at the delimiter that was
 * opened or closed there, so the refusal reads as a place rather than a verdict.
 */
export function unbalancedIssues(text) {
  const issues = [];
  const stack = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let column = 1;
  // What the last significant code token was, so a `/` can be read as a regex or a division:
  // the character itself, or one of the sentinels `word`, `number`, `string`.
  let last = null;
  let lastWord = null;
  let mode = "code";

  const step = () => {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    i += 1;
  };

  const issue = (message, at) => issues.push({ line: at.line, column: at.column, message });

  const closeDelimiter = (open, at) => {
    const closer = OPENERS[open];
    const top = stack[stack.length - 1];
    if (!top || top.kind !== "delim" || top.open !== open) {
      issue(`a '${closer}' here closes no '${open}'`, at);
    } else {
      stack.pop();
    }
    last = closer;
    lastWord = null;
    step();
  };

  const regexAllowed = () => {
    if (lastWord !== null) return VALUE_WORDS.has(lastWord);
    if (last === null) return true;
    if (last === "word" || last === "number" || last === "string") return false;
    return !VALUE_ENDS.has(last);
  };

  // A shebang is a line rather than code: `/usr/bin/env node` must not read as a regex.
  if (text.startsWith("#!")) {
    while (i < n && text[i] !== "\n") step();
  }

  while (i < n) {
    // Inside a template literal's raw text, a backtick ends it and `${` opens an expression.
    if (mode === "template") {
      if (text[i] === "\\") {
        step();
        step();
        continue;
      }
      if (text[i] === "`") {
        stack.pop();
        step();
        mode = "code";
        last = "string";
        lastWord = null;
        continue;
      }
      if (text[i] === "$" && text[i + 1] === "{") {
        const at = { line, column };
        step();
        step();
        stack.push({ kind: "expr", line: at.line, column: at.column });
        mode = "code";
        continue;
      }
      step();
      continue;
    }

    const at = { line, column };
    const ch = text[i];

    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") step();
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      step();
      step();
      let closed = false;
      while (i < n) {
        if (text[i] === "*" && text[i + 1] === "/") {
          step();
          step();
          closed = true;
          break;
        }
        step();
      }
      if (!closed) issue("a block comment is never closed", at);
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      step();
      let closed = false;
      while (i < n) {
        if (text[i] === "\\") {
          step();
          step();
          continue;
        }
        if (text[i] === quote) {
          step();
          closed = true;
          break;
        }
        if (text[i] === "\n") break;
        step();
      }
      if (!closed) issue(`a ${quote}-quoted string is never closed`, at);
      last = "string";
      lastWord = null;
      continue;
    }

    if (ch === "`") {
      stack.push({ kind: "template", line: at.line, column: at.column });
      step();
      mode = "template";
      continue;
    }

    if (ch === "/" && regexAllowed()) {
      step();
      let inClass = false;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === "\\") {
          step();
          step();
          continue;
        }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          step();
          closed = true;
          break;
        }
        step();
      }
      if (!closed) issue("a regular expression is never closed", at);
      while (i < n && /[A-Za-z]/.test(text[i])) step();
      last = "string";
      lastWord = null;
      continue;
    }

    if (OPENERS[ch]) {
      stack.push({ kind: "delim", open: ch, line: at.line, column: at.column });
      step();
      last = ch;
      lastWord = null;
      continue;
    }

    if (ch === ")" || ch === "]") {
      closeDelimiter(ch === ")" ? "(" : "[", at);
      continue;
    }

    if (ch === "}") {
      const top = stack[stack.length - 1];
      if (top && top.kind === "expr") {
        stack.pop();
        step();
        mode = "template";
        last = "}";
        lastWord = null;
        continue;
      }
      closeDelimiter("{", at);
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let word = "";
      while (i < n && /[A-Za-z0-9_$]/.test(text[i])) {
        word += text[i];
        step();
      }
      last = "word";
      lastWord = word;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9A-Za-z_.]/.test(text[i])) step();
      last = "number";
      lastWord = null;
      continue;
    }

    if (/\s/.test(ch)) {
      step();
      continue;
    }

    step();
    last = ch;
    lastWord = null;
  }

  for (const entry of stack) {
    if (entry.kind === "template") issue("a `-quoted template is never closed", entry);
    else if (entry.kind === "expr") issue("a '${' is never closed", entry);
    else issue(`a '${entry.open}' opened here is never closed`, entry);
  }

  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * The refusal itself, so every caller reports one thing: the path, the first place the text
 * fails to hold together, and how many places there are.
 */
export class WholeScriptError extends Error {
  constructor(label, issues) {
    const first = issues[0];
    super(
      `refusing to save ${label}: the text is not whole — ` +
        `line ${first.line}, column ${first.column}: ${first.message}` +
        (issues.length > 1 ? ` (and ${issues.length - 1} more)` : ""),
    );
    this.name = "WholeScriptError";
    this.label = label;
    this.issues = issues;
  }
}

/**
 * Throw unless `text` is whole.
 *
 * Empty text counts as not whole here, and deliberately: a pinned gate script saved as
 * nothing is not a script that happens to be short, it is a write that got as far as the
 * first byte — the same interruption this guard exists for, at its extreme.
 */
export function assertWholeScript(text, label) {
  const trimmed = text.trim();
  if (trimmed === "") throw new WholeScriptError(label, [{ line: 1, column: 1, message: "the text is empty" }]);
  const issues = unbalancedIssues(text);
  if (issues.length > 0) throw new WholeScriptError(label, issues);
  return true;
}

/**
 * Write `text` to `path`, having refused first if that save would not be whole.
 *
 * The return value says whether the guard applied: `guarded: true` for a pinned gate script
 * (which was verified), `guarded: false` for anything else (written exactly as
 * `writeFileSync` would). A caller that only ever writes a pinned script can ignore the
 * answer; one that writes both — the guard sweep rewrites a route as well as `ci.mjs` —
 * reads it to know the file it just wrote was held to the check.
 *
 * `pinned` is injectable so a case can hold the guard to a scratch file without making the
 * real pinned set lie. No caller but a test passes it.
 */
export function saveWholeScript(path, text, { pinned = pinnedGateScripts() } = {}) {
  const rel = toRel(path);
  if (!pinned.includes(rel)) {
    writeFileSync(path, text);
    return { guarded: false, path: rel };
  }
  assertWholeScript(text, rel);
  writeFileSync(path, text);
  return { guarded: true, path: rel };
}

/* -------------------------------------------------------------------------- */
/* The check, for a person and for a gate                                    */
/* -------------------------------------------------------------------------- */

/** The findings for one file on disk: empty text and open delimiters alike. */
const findingsFor = (text) =>
  text.trim() === "" ? [{ line: 1, column: 1, message: "the text is empty" }] : unbalancedIssues(text);

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const paths = args.filter((arg) => !arg.startsWith("--"));

  if (args.includes("--list")) {
    const pinned = pinnedGateScripts();
    if (json) {
      process.stdout.write(`${JSON.stringify({ count: pinned.length, scripts: pinned }, null, 2)}\n`);
    } else {
      for (const path of pinned) process.stdout.write(`${path}\n`);
    }
    process.exit(0);
  }

  const targets = paths.length > 0 ? paths : pinnedGateScripts();
  const findings = [];
  for (const target of targets) {
    let text;
    try {
      text = readFileSync(target, "utf8");
    } catch (error) {
      process.stderr.write(`whole-write: ${toRel(target)} could not be read: ${error.message}\n`);
      process.exit(2);
    }
    const issues = findingsFor(text);
    if (issues.length > 0) findings.push({ path: toRel(target), issues });
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          gate: findings.length === 0 ? "pass" : "fail",
          exitCode: findings.length === 0 ? 0 : 1,
          checked: targets.length,
          findings,
        },
        null,
        2,
      )}\n`,
    );
  } else if (findings.length === 0) {
    process.stdout.write(`whole-write: ${targets.length} script(s) read, every one whole\n`);
  } else {
    for (const finding of findings) {
      process.stdout.write(`${finding.path}: not whole\n`);
      for (const issue of finding.issues) {
        process.stdout.write(`    line ${issue.line}, column ${issue.column}: ${issue.message}\n`);
      }
    }
    process.stdout.write(
      `\nwhole-write: ${findings.length} of ${targets.length} script(s) are not whole. A write that ` +
        `leaves one here cannot be read by the gate it is part of.\n`,
    );
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
