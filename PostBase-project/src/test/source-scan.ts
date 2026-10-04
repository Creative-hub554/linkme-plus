/**
 * Reading source text for the guards that check a *convention* rather than a
 * behaviour.
 *
 * Several tests assert things no rendered test can see — that a test file cleans
 * up its surfaces, that a stylesheet keeps its layering, that a sleep is not
 * followed straight by an assertion. Each reads a file's *source* and scans it,
 * and each needs the same two things:
 *
 * 1. the code with its strings and comments blanked, so a `//` inside a string
 *    is not read as a comment and a `)` inside one cannot unbalance a scan;
 * 2. a call or block found by balanced delimiters rather than by a regex, which
 *    cannot count nesting.
 *
 * Those were written inside `render.test.ts` and re-derived elsewhere. Kept
 * here once so a guard states the convention it enforces, not the scanner.
 *
 * Files are read from disk on demand, not through Vite's `?raw`: an eager
 * `import.meta.glob` over the whole tree makes Vite read and register every
 * file for each module that imports it, and a scan needs only the files it
 * actually inspects.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `fileURLToPath(import.meta.url)` — a string, not `new URL(…)`. These guards
// are imported by jsdom test files, and jsdom replaces the global `URL`, so a
// URL built here is jsdom's own class and Node's `fileURLToPath` rejects it
// with "The URL must be of scheme file". The string form sidesteps that, and
// the path arithmetic stays identical.
const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

/** A file a convention guard scans: a test, in either extension. */
const TEST_FILE = /\.test\.tsx?$/;

/** A shared hook: `src/hooks/use-*.ts`, and not a hook's own test. */
const HOOK_FILE = /^use-.*\.ts$/;

/** The directory the shared hooks live in — the set the beat-seam guard reads. */
const hooksRoot = path.join(srcRoot, "hooks");

/**
 * A component module: a `.ts`/`.tsx` under `src/components`, its own test
 * excluded. The tests are `.test.tsx` beside the component, and a test is not a
 * surface to scan.
 */
const COMPONENT_FILE = /(?:\.ts|\.tsx)$/;

/** The directory the surfaces live in — the set the beat-clock guard reads. */
const componentsRoot = path.join(srcRoot, "components");

/** Every file under `dir` that `match` accepts, depth first, skipping `node_modules`. */
function walkFiles(dir: string, match: (name: string) => boolean, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, match, out);
    else if (match(entry.name)) out.push(full);
  }
}

/** The key a scanned file is known by: relative to this module, forward-slashed. */
function sourceKey(file: string): string {
  return `../${path.relative(srcRoot, file).split(path.sep).join("/")}`;
}

/** The source of every file a walk reached, keyed, with unreadable files skipped. */
function readSources(files: string[]): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const file of files) {
    try {
      sources[sourceKey(file)] = readFileSync(file, "utf8");
    } catch {
      // A file that vanished between the walk and the read is simply not scanned.
    }
  }
  return sources;
}

/**
 * Every `*.test.ts` / `*.test.tsx` file in the suite, its source text keyed by
 * path.
 *
 * The one place the test-source set is written, so each scan reads exactly the
 * same files and none can drift to a different one. The files are read from
 * disk on demand and remembered afterwards: a set this size, read once and
 * cached, costs far less than an eager `import.meta.glob` with `?raw`, which
 * makes Vite read and register *every* test file for each test file that imports
 * this module.
 *
 * Keys keep the shape that glob produced — relative to this module's directory
 * (`../test/render.test.ts`, `../app/feed/route.test.ts`) — so the paths callers
 * match and print read exactly as before.
 */
let testSourceCache: Record<string, string> | undefined;

export function readTestSources(): Record<string, string> {
  if (testSourceCache !== undefined) return testSourceCache;

  const files: string[] = [];
  walkFiles(srcRoot, (name) => TEST_FILE.test(name), files);
  testSourceCache = readSources(files);
  return testSourceCache;
}

/**
 * Every shared hook under `src/hooks`, its source text keyed by path.
 *
 * The hook counterpart of `readTestSources`, and the same rule: the source is
 * read from disk on demand rather than through an eager `?raw` glob, so a guard
 * that reads it costs one `readFileSync` per file instead of registering every
 * hook into the module graph of every test file that imports this module. The
 * set is the same one the beat-seam guard applies to — the shared hooks the
 * surfaces mount — so it is written here once (`src/hooks/use-*.ts`, a hook's own
 * test excluded) rather than spelled out at the guard that reads it.
 *
 * Keys keep this module's convention — `../hooks/use-ambient-carousel.ts` — so a
 * scan that reaches both sets names its files in one space.
 */
let hookSourceCache: Record<string, string> | undefined;

export function readHookSources(): Record<string, string> {
  if (hookSourceCache !== undefined) return hookSourceCache;

  const files: string[] = [];
  walkFiles(hooksRoot, (name) => HOOK_FILE.test(name), files);
  hookSourceCache = readSources(files);
  return hookSourceCache;
}

/**
 * Every component under `src/components`, its source keyed by path.
 *
 * The surface counterpart of the two readers above, and the set the beat-clock
 * guard applies to: a component that mounts the shared carousel may not open a
 * repeating clock of its own. Read from disk on demand for the same reason — a
 * `?raw` glob over the whole components tree registers every module into the
 * graph of whatever test imports this one — and keyed in the same space
 * (`../components/landing/live-product-preview.tsx`), so all three sets name
 * their files alike.
 */
let componentSourceCache: Record<string, string> | undefined;

export function readComponentSources(): Record<string, string> {
  if (componentSourceCache !== undefined) return componentSourceCache;

  const files: string[] = [];
  walkFiles(
    componentsRoot,
    (name) => COMPONENT_FILE.test(name) && !name.includes(".test."),
    files,
  );
  componentSourceCache = readSources(files);
  return componentSourceCache;
}

/** Which pieces of non-code `stripStringsAndComments` blanks. All on by default. */
export interface StripOptions {
  /** Blank the bodies of `'…'`, `"…"` and `` `…` `` strings. */
  strings?: boolean;
  /** Blank `/* … *​/` block comments. */
  blockComments?: boolean;
  /** Blank `// …` line comments. A language without them can turn this off. */
  lineComments?: boolean;
}

/**
 * The source with string literals and comments blanked, newlines kept.
 *
 * Blanking rather than deleting keeps the output the same length as the input,
 * so a caller can still report a line number, and every option blanks with a
 * space (or a newline) for the same reason. Newlines survive so a line-by-line
 * scan of the result still lines up with the original.
 *
 * It is deliberately approximate — a regex literal, for one, is treated as
 * division — because it only has to be right for the code the suite actually
 * writes, and the runtime guard still catches the failure a missed shape would
 * hide.
 */
export function stripStringsAndComments(
  source: string,
  { strings = true, blockComments = true, lineComments = true }: StripOptions = {},
): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComments && ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (blockComments && ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (strings && (ch === '"' || ch === "'" || ch === "`")) {
      out += " ";
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < source.length) {
        out += " ";
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The index just past the delimiter that closes the one at `openIndex`.
 *
 * `source[openIndex]` is expected to be `open`. A scan that never balances
 * returns `source.length`, so a caller slicing to it gets the rest of the source
 * rather than an error. The pair is a parameter because the guards match more
 * than parentheses — a stylesheet rule is matched on `{`/`}`.
 */
export function balancedEnd(
  source: string,
  openIndex: number,
  open = "(",
  close = ")",
): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/** One `callee(…)` call site found by `callSites`. */
export interface CallSite {
  /** The whole `callee(…)` text, delimiters included. */
  text: string;
  /** Where it starts in the source. */
  start: number;
  /** Where it ends — just past the closing `)`. */
  end: number;
}

/**
 * Every `callee(…)` call site in the source, in order, matched by balanced
 * parentheses.
 *
 * Pass the output of `stripStringsAndComments` so a `(` inside a string cannot
 * unbalance a call. The offset in each site lets a caller reason about order —
 * `afterEach` hooks run in reverse registration order, so which call comes last
 * is load-bearing.
 */
export function callSites(source: string, callee: string): CallSite[] {
  const sites: CallSite[] = [];
  const needle = `${callee}(`;
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) return sites;
    const end = balancedEnd(source, start + callee.length);
    sites.push({ text: source.slice(start, end), start, end });
    from = Math.max(end, start + needle.length);
  }
}

/**
 * A small JavaScript tokenizer, for the guards that check a file's *structure*
 * rather than its text.
 *
 * A regexp over raw source cannot tell a write from a read — `document.body`
 * named in an assertion looks the same as one emptied — and a character walk
 * cannot tell where a statement ends in code written without semicolons. Both
 * need the same two facts, so both are built on this: a stream of tokens, each
 * carrying its text, where it sits, and whether a line break came before it.
 * The last is the whole basis of the automatic-semicolon-insertion (ASI)
 * reasoning in `statementEnd`.
 *
 * Strings, template literals and both comment forms are single tokens, so a `;`
 * or a bracket inside one cannot throw a walk off. A regexp literal is not
 * recognized — it tokenizes as division — the same approximation
 * `stripStringsAndComments` makes; the text is only ever scanned, never run.
 */

/** A JavaScript token, positioned in the source and aware of a leading break. */
export interface Token {
  /** The token's text. Strings, templates and comments are whole tokens. */
  text: string;
  /** Where the token starts in the source. */
  start: number;
  /** Whether a line break came between the previous token and this one. */
  newlineBefore: boolean;
}

/**
 * Tokens that, at the start of a line, carry the previous expression onto it.
 *
 * A line opening with `.` is a chained call, and a line opening with a binary
 * operator continues the expression rather than starting a statement. The
 * unary-only sigils (`!`, `~`) are deliberately absent: ASI does insert a
 * semicolon before them.
 */
const CONTINUES_EXPRESSION = new Set([
  ".", ",", "?", ":", "=", "+", "-", "*", "/", "%", "&", "|", "^", "<", ">",
]);

/** Keywords that cannot end a statement, so a break after one is no boundary. */
const NEEDS_OPERAND = new Set([
  "return", "throw", "typeof", "new", "delete", "void", "await", "yield",
  "instanceof", "in", "of", "case", "do", "else",
]);

/** The closer that matches each opener, for the balanced token walks. */
const BRACKET_PAIRS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

/** Whether `ch` is one of the characters an identifier is spelled from. */
function isWordCharacter(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/** Whether a token's text can name a binding. */
export function isIdentifier(text: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
}

/** Split source into tokens, each knowing whether a line break preceded it. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let newlineBefore = false;
  let index = 0;
  const push = (start: number, end: number): void => {
    tokens.push({ text: source.slice(start, end), start, newlineBefore });
    newlineBefore = false;
  };
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\n") {
      newlineBefore = true;
      index += 1;
    } else if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") {
      index += 1;
    } else if (ch === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (ch === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") newlineBefore = true;
        index += 1;
      }
      index += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== ch) {
        if (source[index] === "\\") index += 1;
        index += 1;
      }
      index += 1;
      push(start, Math.min(index, source.length));
    } else if (isWordCharacter(ch)) {
      const start = index;
      while (index < source.length && isWordCharacter(source[index])) index += 1;
      push(start, index);
    } else {
      push(index, index + 1);
      index += 1;
    }
  }
  return tokens;
}

/** Whether the line break before `index` continues the previous expression. */
export function continuesExpression(tokens: Token[], index: number): boolean {
  if (CONTINUES_EXPRESSION.has(tokens[index].text)) return true;
  const previous = tokens[index - 1];
  if (previous === undefined) return false;
  return CONTINUES_EXPRESSION.has(previous.text) || NEEDS_OPERAND.has(previous.text);
}

/** The index of the closer matching the opener at `open`, or `tokens.length`. */
export function matchingBracket(tokens: Token[], open: number): number {
  const opener = tokens[open].text;
  const closer = BRACKET_PAIRS.get(opener);
  if (closer === undefined) return open;
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index].text === opener) depth += 1;
    else if (tokens[index].text === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return tokens.length;
}

/**
 * Where the statement beginning at token `from` ends, by ASI rules.
 *
 * The walk tracks parentheses, brackets and braces *relative* to `from`, so a
 * closer whose opener lies before the statement — a `for` head, a call the
 * caller is nested in — is crossed rather than treated as the end. At the top
 * of all three the statement ends at a `;` or at a line break that does not
 * continue the expression. `bodyFollows` is for a brace-less loop body: it
 * starts on the next line by construction, so its leading break is no boundary.
 */
export function statementEnd(tokens: Token[], from: number, bodyFollows = false): number {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let index = from; index < tokens.length; index += 1) {
    const { text } = tokens[index];
    const atTop = paren === 0 && bracket === 0 && brace === 0;
    const loopBodyStart = bodyFollows && index === from;
    const broken = tokens[index].newlineBefore && !continuesExpression(tokens, index);
    if (atTop && !loopBodyStart && broken) return index;
    if (text === "(") paren += 1;
    else if (text === ")") paren = Math.max(0, paren - 1);
    else if (text === "[") bracket += 1;
    else if (text === "]") bracket = Math.max(0, bracket - 1);
    else if (text === "{") brace += 1;
    else if (text === "}") brace = Math.max(0, brace - 1);
    else if (text === ";" && atTop) return index + 1;
  }
  return tokens.length;
}

/**
 * The method names a Next.js `route.ts` exports to serve a request. A route
 * module is an api endpoint exactly when it exports one of these.
 */
const HTTP_METHOD_NAMES = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** What a module's `export` statements make available to an importer. */
export interface ModuleExports {
  /** Whether the module has a default export, in any of its spellings. */
  default: boolean;
  /** The names the module exports by name — `export const X`, `export { Y as Z }`, … */
  named: Set<string>;
}

/**
 * A module's raw text, and the path it is known by so a re-export can be
 * followed to the module it names.
 */
export interface ModuleSource {
  /** The path the module is known by — the identity a cycle check compares. */
  path: string;
  /** The module's raw source text. */
  source: string;
}

/**
 * Finds the module a specifier points at, written inside the module at `importer`.
 *
 * Returns `undefined` when the module cannot be found, which leaves that
 * re-export opaque rather than guessed at. A caller that has a path→source map —
 * the app's `?raw` globs, say — closes over it and resolves the relative
 * specifier against the importer's directory.
 */
export type ModuleResolver = (specifier: string, importer: string) => ModuleSource | undefined;

/** The text a string or template token spells, without its quotes, or nothing. */
export function stringLiteral(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const first = text[0];
  if (first !== '"' && first !== "'" && first !== "`") return undefined;
  return text.slice(1, -1);
}

/** The path a specifier string token spells, without its quotes, or nothing. */
function specifierOf(text: string | undefined): string | undefined {
  return stringLiteral(text);
}

/**
 * The module specifiers a module's `export … from` statements name, in source
 * order, without their quotes.
 *
 * A re-export is only as good as the module it names: `export { GET } from
 * "./impl"` is a handler only if `./impl` is really there, and a typo'd path is a
 * route that answers nothing. Reading the specifiers out of the source is what
 * lets a caller check every graph edge against a path→source index without
 * walking the graph.
 *
 * Only the shapes that carry a specifier are read — `export * from "…"`,
 * `export * as ns from "…"`, and any `export { … }` / `export type { … }` clause
 * followed by `from "…"`. A name re-exported without `from` has no specifier.
 */
export function reExportSpecifiers(source: string): string[] {
  const tokens = tokenize(source);
  const specifiers: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "export") continue;
    let at = index + 1;

    // `export * from "…"` and `export * as ns from "…"`.
    if (tokens[at]?.text === "*") {
      const from = tokens[at + 1]?.text === "as" ? at + 3 : at + 1;
      if (tokens[from]?.text === "from") {
        const specifier = specifierOf(tokens[from + 1]?.text);
        if (specifier !== undefined) specifiers.push(specifier);
      }
      continue;
    }

    // `export type { … } from "…"` (a clause) vs `export type Name …`.
    if (tokens[at]?.text === "type" && tokens[at + 1]?.text === "{") at += 1;

    if (tokens[at]?.text === "{") {
      const end = matchingBracket(tokens, at);
      if (tokens[end + 1]?.text === "from") {
        const specifier = specifierOf(tokens[end + 2]?.text);
        if (specifier !== undefined) specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

/**
 * The module specifiers a module's `import` statements name, in source order,
 * without their quotes.
 *
 * The other half of `reExportSpecifiers`, and it exists for the same reason: an
 * edge read in one direction is half an edge. `import { db } from "@/lib/db"` is
 * what puts `db` — and every secret `db` reads at module scope — into whatever
 * module that file ends up in, so a caller asking what a *client* bundle can pull
 * in has to read the imports, not only the re-exports.
 *
 * Four shapes carry one: a side-effect import (`import "…"`), a module import with
 * any clause (`import X from`, `import { A as B } from`, `import * as ns from`,
 * and `import type { T } from`), a dynamic `import("…")`, and `require("…")`. All
 * of them are read textually rather than resolved, so the caller decides what a
 * specifier names; a specifier that is not a string literal — a template with an
 * expression in it, a computed path — is returned as written and resolves to
 * nothing, which is the honest answer rather than a guess. `import.meta` is not an
 * import statement and names no module.
 */
export function importSpecifiers(source: string): string[] {
  const tokens = tokenize(source);
  const specifiers: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index].text;

    if (text === "require" && tokens[index + 1]?.text === "(") {
      const specifier = specifierOf(tokens[index + 2]?.text);
      if (specifier !== undefined) specifiers.push(specifier);
      continue;
    }
    if (text !== "import") continue;

    // `import.meta` — a property of the keyword, not a statement.
    if (tokens[index + 1]?.text === ".") continue;

    // The dynamic form, whose argument is a specifier when it is a literal.
    if (tokens[index + 1]?.text === "(") {
      const specifier = specifierOf(tokens[index + 2]?.text);
      if (specifier !== undefined) specifiers.push(specifier);
      continue;
    }

    // `import "…"` — a side-effect import, which has no clause at all.
    const bare = specifierOf(tokens[index + 1]?.text);
    if (bare !== undefined) {
      specifiers.push(bare);
      continue;
    }

    // `import … from "…"` — the specifier is the string after the clause's `from`.
    // A `from` *inside* the clause's braces is a local alias (`import { a as from }`),
    // so only a `from` at the clause's own depth counts, and a `;` or the next
    // statement ends the search rather than running into a later one's specifier.
    let depth = 0;
    for (let at = index + 1; at < tokens.length; at += 1) {
      const token = tokens[at].text;
      if (token === "{" || token === "[" || token === "(") depth += 1;
      else if (token === "}" || token === "]" || token === ")") depth -= 1;
      else if (depth === 0 && token === "from") {
        const specifier = specifierOf(tokens[at + 1]?.text);
        if (specifier !== undefined) specifiers.push(specifier);
        break;
      }
      if (depth === 0 && (token === ";" || token === "import" || token === "export")) break;
    }
  }

  return specifiers;
}

/**
 * A module's exports, its own statements plus the `export … from` re-exports,
 * read with `seen` holding the paths on the current chain to stop a cycle.
 */
function readModuleExports(
  module: ModuleSource,
  resolve: ModuleResolver | undefined,
  seen: Set<string>,
): ModuleExports {
  const tokens = tokenize(module.source);
  const named = new Set<string>();
  let hasDefault = false;

  /** The identifier at `index`, or nothing when that token is not one. */
  const nameAt = (index: number): string | undefined => {
    const text = tokens[index]?.text;
    return text !== undefined && isIdentifier(text) ? text : undefined;
  };

  /**
   * The exports of the module a specifier names, or `undefined` when it cannot be
   * followed — no resolver, an unresolved specifier, or a re-export that loops back
   * onto the chain.
   */
  const follow = (specifier: string | undefined): ModuleExports | undefined => {
    if (resolve === undefined || specifier === undefined) return undefined;
    const target = resolve(specifier, module.path);
    if (target === undefined || seen.has(target.path)) return undefined;
    return readModuleExports(target, resolve, new Set(seen).add(target.path));
  };

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "export") continue;
    let at = index + 1;

    if (tokens[at]?.text === "default") {
      hasDefault = true;
      continue;
    }

    if (tokens[at]?.text === "*") {
      // `export * as ns from "…"` names `ns`; `export * from "…"` fans in the
      // target's names, default excluded because a star re-export carries none.
      if (tokens[at + 1]?.text === "as") {
        const ns = nameAt(at + 2);
        if (ns !== undefined) named.add(ns);
      } else if (tokens[at + 1]?.text === "from") {
        const target = follow(specifierOf(tokens[at + 2]?.text));
        if (target !== undefined) for (const name of target.named) named.add(name);
      }
      continue;
    }

    // `export type { … }` (a clause) vs `export type Name = …` (a declaration).
    if (tokens[at]?.text === "type" && tokens[at + 1]?.text === "{") {
      at += 1;
    } else if (tokens[at]?.text === "type") {
      const name = nameAt(at + 1);
      if (name !== undefined) named.add(name);
      continue;
    }

    // The `export { A, B as C }` clause, with or without a `from` that makes it a
    // re-export of another module.
    if (tokens[at]?.text === "{") {
      const end = matchingBracket(tokens, at);
      const isReExport = tokens[end + 1]?.text === "from";
      const target = isReExport ? follow(specifierOf(tokens[end + 2]?.text)) : undefined;

      // Each binding as the name the clause writes and the name it exports.
      const bindings: Array<{ local: string; exported: string }> = [];
      for (let inner = at + 1; inner < end; inner += 1) {
        const local = tokens[inner].text;
        if (local !== "default" && !isIdentifier(local)) continue;
        if (tokens[inner + 1]?.text === "as") {
          const exported = tokens[inner + 2]?.text;
          if (exported === "default" || (exported !== undefined && isIdentifier(exported))) {
            bindings.push({ local, exported });
            inner += 2;
          }
          continue;
        }
        bindings.push({ local, exported: local });
      }

      for (const { local, exported } of bindings) {
        // `default` as the exported name is this module's own default, whether it
        // is re-exported whole or aliased (`export { default }` / `as default`).
        if (exported === "default") {
          hasDefault = true;
          continue;
        }
        if (isReExport) {
          // Followed: the name has to be one the target actually exports. Not
          // followed (no resolver, or an unresolved specifier): trust the clause.
          if (target === undefined) named.add(exported);
          else if (local === "default" ? target.default : target.named.has(local))
            named.add(exported);
          continue;
        }
        // Without a `from`, `default` names this module's own default binding.
        if (local === "default") hasDefault = true;
        named.add(exported);
      }
      continue;
    }

    if (tokens[at]?.text === "async") at += 1;
    const kind = tokens[at]?.text;

    if (kind === "const" || kind === "let" || kind === "var") {
      if (tokens[at + 1]?.text === "{") {
        const end = matchingBracket(tokens, at + 1);
        for (let inner = at + 2; inner < end; inner += 1) {
          if (isIdentifier(tokens[inner].text)) named.add(tokens[inner].text);
        }
      } else {
        const name = nameAt(at + 1);
        if (name !== undefined) named.add(name);
      }
      continue;
    }

    if (kind === "function" || kind === "class" || kind === "interface" || kind === "enum") {
      // A generator function's name follows the `*`.
      const name = tokens[at + 1]?.text === "*" ? nameAt(at + 2) : nameAt(at + 1);
      if (name !== undefined) named.add(name);
      continue;
    }
  }

  return { default: hasDefault, named };
}

/**
 * The names a module exports, read from its own `export` statements — and, when a
 * resolver is given, through the `export … from` re-exports that reach another
 * module.
 *
 * A file's *role* in the app is not its filename: a page is a module whose
 * default export is what renders, and an api route is a module exporting method
 * handlers. Reading the exports with the same tokenizer the other guards use is
 * what lets a caller ask "does this module export what its role needs?" instead
 * of matching `page.tsx` against a path. A route that re-exports its handler or
 * its default from another module is still a route, so the graph is followed:
 * `export { GET } from "./impl"` reads `GET` off `./impl`, and `export * from`
 * fans in every name the target exports.
 *
 * Every spelling is read: `export default`, `export const/let/var` (a plain
 * declaration or a destructuring), `export function/class/interface/enum`, the
 * `export { … }` / `export type { … }` clause with its `as` aliases and
 * `export { default }`, and `export * as ns from`. Without a `resolve`, a
 * re-export cannot be followed, so `export { x } from` is trusted as written and
 * a bare `export * from` names nothing rather than guessing. The entry source is
 * passed bare (no path) or as a `ModuleSource` when a re-export may point back
 * into it.
 */
export function moduleExports(
  module: string | ModuleSource,
  resolve?: ModuleResolver,
): ModuleExports {
  const source = typeof module === "string" ? module : module.source;
  const path = typeof module === "string" ? "" : module.path;
  return readModuleExports({ path, source }, resolve, new Set(path ? [path] : []));
}

/** The method handlers an api route module exports, in a stable order. */
export function exportedHttpMethods(
  module: string | ModuleSource,
  resolve?: ModuleResolver,
): string[] {
  return [...moduleExports(module, resolve).named]
    .filter((name) => HTTP_METHOD_NAMES.has(name))
    .sort();
}
