import {
  balancedEnd,
  callSites,
  continuesExpression,
  isIdentifier,
  matchingBracket,
  statementEnd,
  stringLiteral,
  stripStringsAndComments,
  tokenize,
  type Token,
} from "@/test/source-scan";

import { STAGE_NAMES } from "../../.freebuff/gate-drift.mjs";
import { buildContents } from "../../.freebuff/runbook-contents.mjs";

/**
 * The detectors behind the convention guards, and a registry of them.
 *
 * A convention guard is a test that reads a file's *source* and fails when it
 * breaks a rule no rendered test can see: a test that mounts through the raw
 * primitive, a sleep followed straight by an assertion, a teardown that empties
 * `document.body` before React has torn its portals down, an unlayered
 * stylesheet rule that outranks Tailwind, a runbook contents list that no longer
 * matches its headings.
 *
 * Each guard was written where it applies, and each carries its own
 * "fires on the shape it exists to catch" fixture — but a detector that once
 * fired can stop firing as the code around it drifts, and the guard file's own
 * fixture is the one place its author would not think to distrust. Keeping the
 * pure detectors here, apart from the assertions that apply them, is what lets
 * `convention-guards.test.ts` drive *every* guard against a forbidden shape and
 * a clean one in a single pass, so a guard that has silently stopped catching
 * anything fails there rather than passing quietly.
 *
 * This mirrors `source-scan.ts`: the shared tokenizer and source reader live
 * there, the shared detectors live here, and each guard test states the rule it
 * enforces rather than the scanner it uses.
 */

/* -------------------------------------------------------------------------- */
/* The mount guard                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A bare call to the mount primitive.
 *
 * `mount(` and nothing more: the word boundary before it rejects `.unmount()`,
 * and the `(` immediately after `mount` rejects `mountSurface(`. A member call
 * (`ui.mount(`) is a different thing and is not what this flags — the raw
 * helper is imported as a bare name, so a real call is bare too.
 */
const RAW_MOUNT = /(?<![\w$.])mount\s*\(/;

/** The 1-based line numbers of raw `mount()` calls in a test file's text. */
export function rawMountCalls(source: string): number[] {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) => (RAW_MOUNT.test(line) ? [index + 1] : []));
}

/* -------------------------------------------------------------------------- */
/* The settle guard                                                           */
/* -------------------------------------------------------------------------- */

/** The 1-based line `offset` falls on. */
function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

/** The whole line `offset` sits on, without its terminator. */
function lineAt(source: string, offset: number): string {
  const start = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return source.slice(start, end === -1 ? source.length : end);
}

/** Whether the statement at token `from` is an `expect(…)` assertion. */
function startsWithExpect(tokens: Token[], from: number): boolean {
  let index = from;
  const lead = tokens[index]?.text;
  if (lead === "await" || lead === "void" || lead === "return") index += 1;
  if (tokens[index]?.text !== "expect") return false;
  return tokens[index + 1]?.text === "(" || tokens[index + 1]?.text === ".";
}

/**
 * The 1-based line numbers of `settle()` calls whose next statement is an
 * assertion, i.e. an assertion made straight after a sleep. Comments and blank
 * lines between the two do not clear it, since the sleep is still the reason the
 * assertion can pass today. A `settle-on-purpose:` marker on the `settle` line
 * opts that call out.
 */
export function settlesWithoutWait(source: string): number[] {
  const tokens = tokenize(source);
  const offenders: number[] = [];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    // A `.settle(…)` call and nothing else: the dot before, the paren after.
    if (tokens[index].text !== "settle") continue;
    if (tokens[index - 1]?.text !== "." || tokens[index + 1]?.text !== "(") continue;
    if (lineAt(source, tokens[index].start).includes("settle-on-purpose")) continue;
    const next = statementEnd(tokens, index);
    if (next < tokens.length && startsWithExpect(tokens, next)) {
      offenders.push(lineNumberAt(source, tokens[index].start));
    }
  }
  return offenders;
}

/* -------------------------------------------------------------------------- */
/* The body-clear / cleanup guard                                             */
/* -------------------------------------------------------------------------- */

/**
 * The shapes a teardown uses to empty `document.body`.
 *
 * Telling a *write* from a harmless *read* is easy for the direct spellings —
 * `document.body.innerHTML =`, `replaceChildren()`, a `removeChild` — but a
 * sweep is a statement-shaped thing: `document.body.childNodes.forEach(…)`, a
 * `for … of`, or a brace-less `while (…)` whose body sits on the next line.
 * Deciding where such a statement ends is the automatic-semicolon-insertion
 * (ASI) reasoning the shared tokenizer in `@/test/source-scan` owns — `tokenize`,
 * `statementEnd` and the bracket walks. The guard states the body-clear shapes;
 * the tokenizer states the JavaScript grammar they are read against.
 */

/** `document.body` members that empty it by assignment. */
const BODY_ASSIGNMENTS = new Set(["innerHTML", "outerHTML", "textContent"]);

/** `document.body` members that empty it by call. */
const BODY_METHODS = new Set(["replaceChildren", "remove", "removeChild"]);

/** The body's own child collections a sweep might walk. */
const BODY_COLLECTIONS = new Set([
  "childNodes",
  "children",
  "firstChild",
  "lastChild",
  "firstElementChild",
  "lastElementChild",
]);

/**
 * The `(` opening the `for`/`while` head that encloses token `from`, or -1.
 *
 * Walking back over balanced brackets, a `(` at the top is either the head we
 * are after or a call we are merely nested in; in the latter case the walk
 * steps outside it and keeps looking. A line break that ends the statement, a
 * `;`, or a block brace stops the search: the loop head that governs this
 * collection cannot lie behind another statement.
 */
function enclosingLoopHeader(tokens: Token[], from: number): number {
  let depth = 0;
  for (let index = from - 1; index >= 0; index -= 1) {
    const next = tokens[index + 1];
    if (next?.newlineBefore && !continuesExpression(tokens, index + 1)) return -1;
    const { text } = tokens[index];
    if (text === ")" || text === "]" || text === "}") {
      depth += 1;
    } else if (text === "(" || text === "[" || text === "{") {
      if (depth > 0) depth -= 1;
      else if (text === "{") return -1;
      else if (
        text === "(" &&
        (tokens[index - 1]?.text === "for" || tokens[index - 1]?.text === "while")
      ) {
        return index;
      }
    } else if (depth === 0 && text === ";") {
      return -1;
    }
  }
  return -1;
}

/**
 * Where the sweep headed by the collection at `from` ends.
 *
 * When the collection sits in a `for`/`while` head, ASI keeps the statement
 * open through the loop body — braced or brace-less — so the region runs to the
 * end of that body. Otherwise it is the enclosing expression statement.
 */
function sweepRegionEnd(tokens: Token[], from: number): number {
  const header = enclosingLoopHeader(tokens, from);
  if (header === -1) return statementEnd(tokens, from);
  const bodyStart = matchingBracket(tokens, header) + 1;
  if (bodyStart >= tokens.length) return tokens.length;
  if (tokens[bodyStart].text === "{") return matchingBracket(tokens, bodyStart) + 1;
  return statementEnd(tokens, bodyStart, true);
}

/** Whether the sweep ahead of the collection at `from` calls `.remove(`. */
function sweepRemovesBody(tokens: Token[], from: number): boolean {
  const end = sweepRegionEnd(tokens, from);
  for (let index = from; index < end; index += 1) {
    const call = tokens[index];
    if (call.text !== "remove" || tokens[index - 1]?.text !== ".") continue;
    if (tokens[index + 1]?.text === "(") return true;
  }
  return false;
}

/** The member of a `document.body.<member>` reference starting at `index`. */
function bodyMemberAt(tokens: Token[], index: number): string | null {
  if (tokens[index]?.text !== "document") return null;
  if (tokens[index + 1]?.text !== "." || tokens[index + 2]?.text !== "body") return null;
  if (tokens[index + 3]?.text !== ".") return null;
  return tokens[index + 4]?.text ?? null;
}

/** Whether the expression at `from` is built from one of the body's child collections. */
function bindsBodyCollection(tokens: Token[], from: number): boolean {
  const end = statementEnd(tokens, from);
  for (let index = from; index < end; index += 1) {
    const member = bodyMemberAt(tokens, index);
    if (member !== null && BODY_COLLECTIONS.has(member)) return true;
  }
  return false;
}

/**
 * The names a declaration binds to one of the body's child collections.
 *
 * A teardown often copies the children out first and sweeps the copy in a later
 * statement:
 *
 *     const cards = [...document.body.childNodes];
 *     cards.forEach((card) => card.remove());
 *
 * That sweep names `cards`, not the body, so the direct scan cannot see it.
 * This finds the declaration whose right-hand side is built from the body's
 * children — `document.body.children`, a spread of it, an `Array.from` of it —
 * and records the name. A list built anywhere else, even one swept the same
 * way, is never bound, which is what keeps an unrelated loop out of the report.
 */
function boundCollectionNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "=") continue;
    const keyword = tokens[index - 2]?.text;
    if (keyword !== "const" && keyword !== "let" && keyword !== "var") continue;
    const name = tokens[index - 1]?.text;
    if (name === undefined || !isIdentifier(name)) continue;
    if (!bindsBodyCollection(tokens, index + 1)) continue;
    names.add(name);
  }
  return names;
}

/** Where `source` first empties the body, or -1 when it never mutates it. */
export function bodyClearIndex(source: string): number {
  const tokens = tokenize(source);
  let earliest = -1;
  const note = (at: number): void => {
    if (earliest === -1 || at < earliest) earliest = at;
  };

  // A direct write: an assignment, a method call, or a sweep that names a
  // collection on the body itself.
  for (let index = 0; index + 4 < tokens.length; index += 1) {
    const member = bodyMemberAt(tokens, index);
    if (member === null) continue;
    const after = tokens[index + 5]?.text;
    let clears = false;
    if (BODY_ASSIGNMENTS.has(member)) {
      // `=` but not the `=` of `==`/`===`, which is only a comparison.
      clears = after === "=" && tokens[index + 6]?.text !== "=";
    } else if (BODY_METHODS.has(member)) {
      clears = after === "(";
    } else if (BODY_COLLECTIONS.has(member)) {
      clears = sweepRemovesBody(tokens, index + 5);
    }
    if (clears) note(tokens[index].start);
  }

  // A write through a copy: a name bound to the body's children, swept later.
  const bound = boundCollectionNames(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!bound.has(tokens[index].text)) continue;
    if (tokens[index - 1]?.text === "." || tokens[index + 1]?.text === "=") continue;
    if (sweepRemovesBody(tokens, index + 1)) {
      note(tokens[index].start);
      break;
    }
  }
  return earliest;
}

/**
 * Whether a single `afterEach` hook empties the body before it unmounts.
 *
 * Correct order is cleanup first: a Radix portal is a child of the body, so
 * clearing before the unmount makes React's own teardown throw.
 */
function clearsBodyBeforeCleanup(hook: string): boolean {
  const cleanupAt = hook.indexOf("cleanupSurfaces(");
  if (cleanupAt === -1) return false;
  const clearAt = bodyClearIndex(hook);
  return clearAt !== -1 && clearAt < cleanupAt;
}

/** Why a mounting file's teardown is wrong, or `null` when it is right. */
export type CleanupProblem = "never cleans up" | "clears the body before cleaning up";

/**
 * Whether the file unmounts its surfaces in an `afterEach`, and in what order.
 *
 * Both halves are checked: a file that never calls `cleanupSurfaces()` leaks,
 * and one that empties the body before React has torn the portals down throws
 * during that teardown. `afterEach` hooks run in reverse order of registration
 * — the last one declared runs first — so a clear is "before" the cleanup not
 * only when it is written earlier in the same hook, but also whenever it lives
 * in a hook declared *later* than the one that cleans up.
 */
export function cleanupProblem(source: string): CleanupProblem | null {
  const code = stripStringsAndComments(source);
  const afterEachHooks = callSites(code, "afterEach").map(({ text }) => text);
  const cleanupHooks = afterEachHooks
    .map((hook, index) => (hook.includes("cleanupSurfaces(") ? index : -1))
    .filter((index) => index !== -1);
  if (cleanupHooks.length === 0) return "never cleans up";

  // Walk the hooks in the order they actually run — last declared first — and
  // stop once cleanup happens: any body clear reached before that is too early.
  const firstCleanupInRunOrder = Math.max(...cleanupHooks);
  for (let index = afterEachHooks.length - 1; index >= firstCleanupInRunOrder; index -= 1) {
    if (index === firstCleanupInRunOrder) {
      if (clearsBodyBeforeCleanup(afterEachHooks[index])) return "clears the body before cleaning up";
    } else if (bodyClearIndex(afterEachHooks[index]) !== -1) {
      return "clears the body before cleaning up";
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* The stylesheet guard                                                       */
/* -------------------------------------------------------------------------- */

const COLOUR_PROPERTIES = [
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "--tw-ring-color",
];

/** A parsed CSS rule: its selector, the properties it declares, and its layer. */
export type Rule = { selector: string; declarations: string[]; layer: string | null };

/** The property names declared in a rule's body, skipping nested rule bodies. */
function declarations(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  const push = (piece: string) => {
    // Skip nested rule bodies (a rule can contain `@supports`/`@media`).
    if (piece.includes("{") || piece.trimStart().startsWith("@")) return;
    const colon = piece.indexOf(":");
    if (colon === -1) return;
    const property = piece.slice(0, colon).trim();
    if (property) out.push(property);
  };
  for (const ch of body) {
    if (ch === "{" || ch === "(") depth += 1;
    if (ch === "}" || ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  push(current);
  return out;
}

/**
 * Parse a stylesheet into its rules, each tagged with the `@layer` it sits in.
 *
 * Comments are dropped once here rather than skipped at each character. Strings
 * are kept: a selector is compared literally against `:root[data-accent="amber"]`,
 * so blanking them would erase the value the accent test reads. The blanking
 * keeps every offset, so the slices line up with the original byte for byte.
 */
export function parse(css: string): Rule[] {
  const source = stripStringsAndComments(css, { strings: false, lineComments: false });
  const rules: Rule[] = [];
  const stack: (string | null)[] = [];
  let prelude = "";
  let index = 0;

  while (index < source.length) {
    const ch = source[index];

    if (ch === "{") {
      const preludeTrimmed = prelude.trim();
      prelude = "";
      if (preludeTrimmed.startsWith("@")) {
        const layer = /^@layer\b\s*([\w-]*)/.exec(preludeTrimmed);
        // `@media`/`@supports` are transparent to layer membership, so they push
        // `null` and the nearest real layer is still found below.
        stack.push(layer ? layer[1] || "anonymous" : null);
        index += 1;
        continue;
      }
      const end = balancedEnd(source, index, "{", "}");
      if (preludeTrimmed) {
        const layer = [...stack].reverse().find((entry) => entry !== null) ?? null;
        rules.push({
          selector: preludeTrimmed,
          declarations: declarations(source.slice(index + 1, end - 1)),
          layer,
        });
      }
      index = end;
      continue;
    }

    if (ch === "}") {
      stack.pop();
      prelude = "";
      index += 1;
      continue;
    }

    if (ch === ";") {
      prelude = "";
      index += 1;
      continue;
    }

    prelude += ch;
    index += 1;
  }

  return rules;
}

/**
 * The unlayered class rules that set a colour, the shape that outranks Tailwind.
 *
 * CSS gives an unlayered rule precedence over every layer, and Tailwind v4
 * registers its utilities in `@layer utilities` — so a colour rule left outside
 * a layer beats a utility regardless of specificity. Only class selectors are
 * reported: an element default with no class in its selector shadows no utility
 * name, which is why `:focus-visible { outline }` is knowingly left alone.
 */
export function unlayeredColourOffenders(css: string): string[] {
  return parse(css)
    .filter((rule) => rule.layer === null)
    .filter((rule) => rule.selector.includes("."))
    .filter((rule) => rule.declarations.some((property) => COLOUR_PROPERTIES.includes(property)))
    .map((rule) => `${rule.selector} { ${rule.declarations.join(", ")} }`);
}

/* -------------------------------------------------------------------------- */
/* The runbook guard                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The `## Contents` block of a runbook, from its heading to the next `## `.
 *
 * Compared as a block rather than line-by-line over the whole document so a
 * stale entry fails with the list that is wrong, not with a 550-line string.
 */
export function contentsBlock(source: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Contents");
  if (start === -1) return "";
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  return lines.slice(start, end).join("\n");
}

/**
 * The reasons a runbook's committed Contents block is out of step with its
 * headings; empty when it is exactly what the generator produces.
 *
 * The list is pure duplication — every link restates a heading and its slug — so
 * a heading edited without `npm run runbook:contents` leaves a link that
 * silently stops resolving. This is the backstop that makes "generated" true.
 */
export function contentsDrift(source: string): string[] {
  const actual = contentsBlock(source);
  const expected = contentsBlock(buildContents(source));
  if (actual === expected) return [];
  return [
    "The Contents block is out of step with the headings — run `npm run runbook:contents`.",
    `Expected:\n${expected}\n\nFound:\n${actual}`,
  ];
}

/* -------------------------------------------------------------------------- */
/* The beat-seam guard                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The names a per-beat callback is spelled with: `on` + the act it runs on the
 * step.
 *
 * This is the shape the ambient carousel's `onTick` was, and the vocabulary is
 * what makes the rule readable: a hook hands back `onMessage`/`onComplete` when
 * something happened, and takes a step callback when it wants to run the
 * caller's code on its own clock. It is also the name-side of the rule, which
 * matters where there is no clock to inspect — the sibling hook that could
 * reintroduce the seam (`useCarouselRotation`) owns no timer, so only its names
 * can give it away. The structural side of the same rule is the *reference*:
 * a function the hook received, named inside the clock's own step.
 */
const BEAT_CALLBACK_NAMES = new Set([
  "onTick",
  "onBeat",
  "onStep",
  "onAdvance",
  "onInterval",
  "onCadence",
  "onRotate",
  "onPulse",
]);

/**
 * The same seam from the other side: the acts a hook *hands back* so a caller can
 * run the beat itself.
 *
 * `advance` is the one that was returned by `useAmbientCarousel` and is still,
 * deliberately, returned by `useCarouselRotation` — a position primitive with no
 * clock of its own — which is why the return limb is asked only of a hook that
 * owns a clock. The verbs are here rather than the nouns (`beats`, `index`,
 * `select`): a count is the sanctioned shape and a walk is the seam.
 */
const BEAT_RUNNER_NAMES = new Set(["tick", "step", "advance", "rotate", "pulse"]);

/** The clocks that make a step callback a *per-beat* one. */
const CLOCK_METHODS = new Set(["setInterval", "requestAnimationFrame"]);

/**
 * Whether a member is declared with a function type.
 *
 * The declaration shape is `name?: (…) => …` — an optional `?`, the colon, and a
 * `=>` in the type before the member ends. The arrow is read as its two tokens:
 * the tokenizer emits punctuation one character at a time, so `=>` is `=` then
 * `>`, and a `>` that follows an `=` is one (where the `>=` of a comparison is
 * the other order and is not). `name(` or a destructuring shorthand is a call or
 * a binding rather than a declaration, and a member whose type runs to a
 * `,`/`;`/`)`/`}` without an arrow is data. Nested brackets in the type (a
 * parameter list, an object parameter) are walked over, so a handler taking an
 * argument is read the same as one that takes none.
 */
function declaresFunction(tokens: Token[], index: number): boolean {
  let at = index + 1;
  if (tokens[at]?.text === "?") at += 1;
  if (tokens[at]?.text !== ":") return false;
  at += 1;
  let depth = 0;
  for (; at < tokens.length; at += 1) {
    const { text } = tokens[at];
    if (text === "(" || text === "[" || text === "{") depth += 1;
    else if (text === ")" || text === "]" || text === "}") {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth === 0 && (text === "," || text === ";")) return false;
    else if (text === "=" && tokens[at + 1]?.text === ">") return true;
  }
  return false;
}

/**
 * Whether the module installs a clock that repeats a step.
 *
 * `setInterval` and `requestAnimationFrame` — the two ways a hook moves something
 * on its own — and not `setTimeout`, which is how a hook waits for one thing
 * (a reconnect, a debounce) rather than how it counts a beat. A name in a string
 * or a comment is not a token, so the doc comment that explains this very rule
 * does not fire it.
 */
function ownsRepeatingClock(tokens: Token[]): boolean {
  return tokens.some(
    (token, index) => CLOCK_METHODS.has(token.text) && tokens[index + 1]?.text === "(",
  );
}

/**
 * The token range of each repeating clock's *step*: the callback it runs.
 *
 * Only the first argument is read — `setInterval(step, cadenceMs)` — and the walk
 * counts brackets so the `,` that ends it is one at the argument's own depth; a
 * comma inside the step (an argument of a call it makes) does not cut it short.
 * `requestAnimationFrame(step)` takes one argument, so no arity table is needed.
 */
function clockSteps(tokens: Token[]): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (!CLOCK_METHODS.has(tokens[index].text) || tokens[index + 1].text !== "(") continue;
    const open = index + 1;
    const close = matchingBracket(tokens, open);
    let depth = 0;
    let end = close;
    for (let at = open + 1; at < close; at += 1) {
      const text = tokens[at].text;
      if (text === "(" || text === "[" || text === "{") depth += 1;
      else if (text === ")" || text === "]" || text === "}") depth -= 1;
      else if (text === "," && depth === 0) {
        end = at;
        break;
      }
    }
    steps.push([open + 1, end]);
  }
  return steps;
}

/**
 * The names declared anywhere in the module with a function type.
 *
 * Every member whose declaration is `name: (…) => …` — an options interface's
 * callback, the hook's own returned API, a local annotation — collected once so
 * the limbs below can ask "is *this* the caller's function?" by name rather than
 * re-deriving what a function type looks like at each use.
 */
function functionTypedNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index].text;
    if (!isIdentifier(text) || tokens[index - 1]?.text === ".") continue;
    if (declaresFunction(tokens, index)) names.add(text);
  }
  return names;
}

/** One exported hook's body, as the token range inside its braces. */
interface HookBody {
  /** The hook's name, for the failure message. */
  name: string;
  /** The index of the body's opening brace. */
  bodyStart: number;
  /** The index of the body's closing brace, or `tokens.length` if unbalanced. */
  bodyEnd: number;
}

/**
 * The bodies of a module's exported hooks: `export function useX(…) { … }`.
 *
 * Only the `export function` form is read, which is the one this repo writes for
 * a shared hook — and the name has to start with `use`, so a module's own helper
 * is not mistaken for one. The return type annotation between the parameter list
 * and the body (`): AmbientCarousel {`) is stepped over: the walk takes the first
 * `{` that is not preceded by a `;`, which is the body of a function that has one
 * and nothing at all for an overload that does not.
 */
function exportedHookBodies(tokens: Token[]): HookBody[] {
  const bodies: HookBody[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "export") continue;
    let at = index + 1;
    if (tokens[at]?.text === "async") at += 1;
    if (tokens[at]?.text !== "function") continue;
    const name = tokens[at + 1]?.text;
    if (name === undefined || !name.startsWith("use")) continue;
    const params = at + 2;
    if (tokens[params]?.text !== "(") continue;
    let cursor = matchingBracket(tokens, params) + 1;
    while (
      cursor < tokens.length &&
      tokens[cursor].text !== "{" &&
      tokens[cursor].text !== ";"
    ) {
      cursor += 1;
    }
    if (tokens[cursor]?.text !== "{") continue;
    bodies.push({ name, bodyStart: cursor, bodyEnd: matchingBracket(tokens, cursor) });
  }
  return bodies;
}

/**
 * The names a hook hands back in the object literal it returns, in source order.
 *
 * Only the hook's own top-level `return { … }` is read: a `return` inside a
 * callback the hook mounts — the teardown's `return () => window.clearInterval(…)
 * `, an effect's, a `useCallback`'s — sits inside that callback's braces, so the
 * depth walk skips it. Inside the literal, a name at depth 0 preceded by `{` or
 * `,` is a property (a shorthand or a key); one preceded by `:` is a value, and a
 * name inside a nested literal is not this object's member.
 */
function returnedNames(tokens: Token[], bodyStart: number, bodyEnd: number): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let index = bodyStart; index < bodyEnd; index += 1) {
    const { text } = tokens[index];
    if (text === "{") depth += 1;
    else if (text === "}") depth -= 1;
    if (text !== "return" || depth !== 1 || tokens[index + 1]?.text !== "{") continue;

    const open = index + 1;
    const close = matchingBracket(tokens, open);
    let inner = 0;
    for (let at = open + 1; at < close; at += 1) {
      const token = tokens[at].text;
      if (token === "{" || token === "(" || token === "[") inner += 1;
      else if (token === "}" || token === ")" || token === "]") inner -= 1;
      else if (inner === 0 && isIdentifier(token)) {
        const before = tokens[at - 1]?.text;
        if (before === "{" || before === ",") names.push(token);
      }
    }
    return names;
  }
  return names;
}

/**
 * The per-beat seams a shared hook exposes, each named for the shape it is.
 *
 * Three limbs, because the escape hatch was removed from two places and could
 * come back in two spellings:
 *
 *   - **the callback option, by name.** A module that declares one of the beat
 *     vocabulary names with a function type is taking a step callback. Asked of
 *     every module — not only one that owns a clock — because the seam can be
 *     reintroduced on the sibling hook that owns no clock: `useCarouselRotation`
 *     is where a surface would hand the walk on to something else.
 *   - **the callback the clock actually runs.** Not a name at all: a function the
 *     module declares (an option, or its own API) that is *referenced inside the
 *     clock's own step*. This is the limb a rename cannot dodge, and it is the
 *     exact defect — the step was where `onTick` was called from, so a step that
 *     mentions the caller at all is the seam, whatever it is spelled.
 *   - **the walk handed back.** A hook that owns the clock may not return the
 *     beat's own act either: exposing `advance` again is the seam the surfaces
 *     used to hang their own interval on, which is what moving the clock into
 *     the hook removed. Asked only of a clock-owning hook, so
 *     `useCarouselRotation`'s returned `advance` — a position primitive with no
 *     timer of its own — stays legal, and a returned `beats` (a value) is never
 *     an offender.
 *
 * Every limb reports the member by name so the failure points at the seam rather
 * than at the file, and a name two limbs would report is reported once: the
 * vocabulary reads as the cause, and the step that mentions it is the same fact.
 *
 * The honest limits, stated because the alternative is a guard that reads as
 * stronger than it is: only the `name: (…) => …` spelling of a function type is
 * read, so a callback typed through an alias (`onTick?: BeatHandler`) is missed by
 * the two name-side limbs (the step limb still sees it if it is named inside the
 * step); a hook returning a variable (`const api = {…}; return api;`) is not read
 * by the return limb; and the vocabulary is the vocabulary — a step callback
 * spelled outside it on a hook that owns no clock is not caught by name. What
 * each limb does catch is pinned by the guard's fixtures and the guard test.
 */
export function imperativeBeatSeams(source: string): string[] {
  const tokens = tokenize(source);
  const callbacks = functionTypedNames(tokens);
  const seams = new Map<string, string>();

  // The callback option, by name.
  for (const name of callbacks) {
    if (BEAT_CALLBACK_NAMES.has(name)) seams.set(name, "is a per-beat callback option");
  }

  // The callback the clock runs: a declared function, mentioned anywhere in the
  // clock's own step — called there, or handed on from it. A member access counts
  // too: `options.onTick()` is the same seam as `onTick()`, and both were spelled
  // in the machinery this replaced.
  for (const [start, end] of clockSteps(tokens)) {
    for (let index = start; index < end; index += 1) {
      const text = tokens[index].text;
      if (!callbacks.has(text)) continue;
      if (!seams.has(text)) seams.set(text, "runs on the clock's own step");
    }
  }

  // The walk handed back, which only a clock-owning hook is asked about.
  if (ownsRepeatingClock(tokens)) {
    for (const body of exportedHookBodies(tokens)) {
      for (const name of returnedNames(tokens, body.bodyStart, body.bodyEnd)) {
        if (!BEAT_RUNNER_NAMES.has(name) && !BEAT_CALLBACK_NAMES.has(name)) continue;
        seams.set(name, `${body.name} hands it back`);
      }
    }
  }

  return [...seams].map(([name, reason]) => `${name} ${reason}`);
}

/**
 * The hooks a surface mounts to get the shared carousel.
 *
 * The composition itself, and the two halves it is made of — because the defect
 * this refuses was a surface wiring its own interval around `useAmbientPlayback`
 * and `useCarouselRotation` before `useAmbientCarousel` existed to own the clock,
 * and a surface could still write that shape back with either half.
 */
const AMBIENT_HOOK_NAMES = new Set([
  "useAmbientCarousel",
  "useAmbientPlayback",
  "useCarouselRotation",
]);

/**
 * Every repeating clock a module installs, as `receiver.name() at line n`.
 *
 * The same two methods the hook-side limb counts, read at the call rather than
 * at the declaration: `window.setInterval(` and a bare `setInterval(` both name
 * the clock, and the receiver is kept so the report points at the line a reader
 * would delete. A mention in a string or a comment is not a token and is not a
 * clock.
 */
function installedClocks(tokens: Token[], source: string): string[] {
  const clocks: string[] = [];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (!CLOCK_METHODS.has(tokens[index].text) || tokens[index + 1].text !== "(") continue;
    const member = tokens[index - 1]?.text === ".";
    const receiver = member ? `${tokens[index - 2]?.text ?? ""}.` : "";
    clocks.push(`${receiver}${tokens[index].text}() at line ${lineNumberAt(source, tokens[index].start)}`);
  }
  return clocks;
}

/**
 * The clocks a surface opened for itself while mounting the shared carousel.
 *
 * The other end of the beat's seam. The hook-side guard refuses a *hook* taking
 * a per-beat callback; this refuses the mirror image — a component that mounts
 * the carousel and then drives it from a timer of its own. Both surfaces wrote
 * that code once: bail out while paused, open an interval, list `[playing,
 * advance]` so a pause rebuilt it, clear it on teardown, and the only thing
 * differing between them was 3s against 4.2s. The clock lives in
 * `useAmbientCarousel` now and a surface states its content and its cadence, so
 * the two cannot tear their timers down differently — and a surface that opens
 * one anyway has taken the beat back, however it spells the callback it runs on
 * it (which is why this limb looks for the *clock*: the hook-side vocabulary
 * cannot see a timer a surface never calls a beat).
 *
 * Asked only of a module that mounts the carousel family by name, so the
 * components that legitimately animate — a canvas painting frames, a typing
 * indicator breathing — are left alone. The clock is *allowed* in
 * `src/hooks`, which is the whole point of the extraction; the guard test's
 * application set is what draws that boundary, and says so.
 */
export function surfaceOwnedClocks(source: string): string[] {
  const tokens = tokenize(source);
  if (!tokens.some((token) => AMBIENT_HOOK_NAMES.has(token.text))) return [];
  return installedClocks(tokens, source);
}

/* -------------------------------------------------------------------------- */
/* The client-environment guards                                              */
/* -------------------------------------------------------------------------- */

/**
 * The prefix that makes an environment name part of the client bundle.
 *
 * Next inlines exactly the `NEXT_PUBLIC_`-prefixed names it finds in client code,
 * and this app's build keeps that rule. So the prefix is a promise made to the
 * framework: a name spelled `NEXT_PUBLIC_*` is published to every visitor who
 * loads a page, and every other name belongs to the server. Both directions of
 * that promise are checked below — a server name read from code that ships, and a
 * secret published under a public name.
 */
export const PUBLIC_ENV_PREFIX = "NEXT_PUBLIC_";

/**
 * The names the bundler substitutes into the bundle itself.
 *
 * `process.env.NODE_ENV` is neither a secret nor a server value: the bundler
 * replaces the whole expression with a string literal (`"production"`), which is
 * why `process.env.NODE_ENV === "development"` in a component is ordinary and
 * correct. The allowance is stated here rather than left to be discovered, and a
 * case pins it, because an allowance nothing pins is how a guard rots into a
 * rubber stamp.
 */
const BUNDLER_INLINED_NAMES = new Set(["NODE_ENV"]);

/** Whether an environment name is one code shipped to the browser may read. */
export function isPublicEnvName(name: string): boolean {
  return name.startsWith(PUBLIC_ENV_PREFIX) || BUNDLER_INLINED_NAMES.has(name);
}

/** Whether a name is spelled the way this repo spells an environment variable. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * The credential words a `NEXT_PUBLIC_` name may not carry.
 *
 * Every word here names a value that is a secret *because of what it is*: a
 * signing secret, a private key, a password, a bearer token, a service-role key,
 * an object-storage access key, a third-party api key. `KEY` alone is
 * deliberately absent — `NEXT_PUBLIC_SUPABASE_ANON_KEY` is Supabase's
 * browser-side key and is public by design, and flagging it would teach a reader
 * to ignore this guard. The escape hatch for an api key that really is
 * publishable is to name it what it is (a publishable, public or client key),
 * which is one word of edit and makes the claim reviewable.
 */
const PUBLIC_SECRET_WORDS = [
  "SECRET",
  "PRIVATE",
  "PASSWORD",
  "PASSWD",
  "TOKEN",
  "CREDENTIAL",
  "CREDENTIALS",
  "SERVICE_ROLE",
  "ACCESS_KEY",
  "API_KEY",
];

/**
 * A credential word standing alone between underscores, with the word captured.
 *
 * The boundaries are what keep `PRIVATE` from matching `PRIVATEER` and, the other
 * way, what let `ANON_KEY` through: the word has to be a whole segment of the
 * underscored name rather than any three letters inside it. `CREDENTIALS` and
 * `CREDENTIAL` sit in the list together and the lookahead sorts them out — after
 * `CREDENTIAL` the next character is an `S`, which is not an underscore or the
 * end, so the longer word is the one that matches.
 */
const PUBLIC_SECRET_WORD = new RegExp(
  `(?:^|_)(${PUBLIC_SECRET_WORDS.join("|")})(?=_|$)`,
);

/**
 * The build configs a client bundle is built from, and the two files the guard reads.
 *
 * Declared once because two halves of the gate read it: `src/test/client-env.test.ts`
 * asks each file for a value the bundler would inline, and `src/test/gate-drift.test.ts`
 * holds the drift alarm's watch rule to exactly this pair — so a third config the guard
 * starts reading has to be added to the pin in the same edit rather than left outside it.
 */
export const CLIENT_BUILD_CONFIGS = ["vite.config.ts", "next.config.mjs"];

/**
 * The build-config keys that decide what ships inside the client bundle.
 *
 * `define` is Vite's substitution table: every entry is textually replaced
 * wherever the key appears, in *every* environment including the browser, so a
 * `define` that names the environment object republishes the lot. `env` is
 * Next's own list of values to make available to the client. Both are the same
 * hazard from different directions, which is why one detector reads them
 * together.
 */
const CLIENT_BUNDLE_KEYS = new Set(["define", "env"]);

/** The spellings of the environment object itself, as a config key or global. */
const ENVIRONMENT_OBJECT_KEY = /^(?:globalThis\.)?process\??\.env$/;

/** One environment name read out of some source, and where it was read. */
interface EnvRead {
  name: string;
  at: number;
}

/**
 * The index just past an environment-object expression starting at `index`, or -1.
 *
 * The environment object is reachable three ways in the source this repo writes:
 * `process.env`, the optional-chained `process?.env`, and `import.meta.env`. A type
 * annotation is not one of them: in `{ process?: { env?: … } }` the token after
 * `process` is `?` and the token after that is `:`, while only `?` (or nothing)
 * followed by `.` opens the property walk — which is the shape that matters,
 * since those two words appear most often in type positions. `import` counts only
 * when `.meta.env` follows, so an import statement is not an environment object.
 */
function environmentObjectEnd(tokens: Token[], index: number): number {
  const propertyOf = (from: number, property: string): number => {
    let at = from;
    if (tokens[at]?.text === "?") at += 1;
    if (tokens[at]?.text !== ".") return -1;
    return tokens[at + 1]?.text === property ? at + 2 : -1;
  };
  if (tokens[index]?.text === "process") return propertyOf(index + 1, "env");
  if (tokens[index]?.text !== "import") return -1;
  const afterMeta = propertyOf(index + 1, "meta");
  return afterMeta === -1 ? -1 : propertyOf(afterMeta, "env");
}

/**
 * The name the access after `objectIndex` reads off it, or nothing.
 *
 * Both spellings count — `.NAME` and `["NAME"]` — because a name assembled in a
 * bracket is the same read as one written as a property, and a secret does not
 * become safe for being spelled sideways. `?.` before either is read the same
 * way. Anything else (a call, an index by a variable) names no environment
 * variable this guard can know, and guessing one would be worse than missing it.
 */
function memberReadAfter(tokens: Token[], objectIndex: number): string | undefined {
  let at = objectIndex + 1;
  if (tokens[at]?.text === "?") at += 1;
  if (tokens[at]?.text === ".") {
    // `?.NAME` and `.NAME` are one dot and a name — but `?.["NAME"]` arrives as
    // `?` `.` `[`, so a dot whose operand is a bracket falls through to the bracket
    // branch rather than being read as a missing name.
    const name = tokens[at + 1]?.text;
    if (name !== undefined && isIdentifier(name)) return name;
    at += 1;
  }
  if (tokens[at]?.text === "[") {
    const name = stringLiteral(tokens[at + 1]?.text);
    return tokens[at + 2]?.text === "]" ? name : undefined;
  }
  return undefined;
}

/** The name a whole environment object is reported under, when one is handed over. */
const ENVIRONMENT_OBJECT = "the environment object";

/**
 * The environment names an initializer derives from, or `undefined` when it does not
 * touch the environment at all.
 *
 * A list of names rather than a yes-or-no, because a value that hands an alias over
 * hands over *those* names: `const publicUrl = process.env.R2_PUBLIC_URL` followed by
 * `env: { PUBLIC_URL: publicUrl }` publishes `R2_PUBLIC_URL`, and a detector that only
 * knew the alias was environment-derived could not say which name leaked. An empty
 * list is a real answer — `const runtimeEnv = (globalThis as …).process?.env ?? {}`
 * derives from the environment object whole, and reading no member of it is the whole
 * point of the idiom — which is why "nothing at all" is `undefined` instead.
 */
function environmentBindingsIn(
  tokens: Token[],
  from: number,
  aliases: ReadonlyMap<string, string[]>,
): string[] | undefined {
  const end = statementEnd(tokens, from);
  const names: string[] = [];
  let bound = false;
  for (let index = from; index < end; index += 1) {
    const objectEnd = environmentObjectEnd(tokens, index);
    if (objectEnd !== -1) {
      bound = true;
      const read = memberReadAfter(tokens, objectEnd - 1);
      if (read !== undefined) names.push(read);
      continue;
    }
    if (tokens[index - 1]?.text === ".") continue;
    const held = aliases.get(tokens[index].text);
    if (held === undefined) continue;
    bound = true;
    names.push(...(held.length === 0 ? [ENVIRONMENT_OBJECT] : held));
  }
  return bound ? [...new Set(names)] : undefined;
}

/**
 * The local names a module binds to the environment object.
 *
 * This app reads most of its environment through a module-scope alias —
 * `const runtimeEnv = (globalThis as …).process?.env ?? {}` — because a Worker has
 * no `process` at all and the object has to be reached without one. A guard that
 * only knew the spelling `process.env.NAME` would therefore be blind to the way
 * this repo actually reads a secret, which is the shape the whole rule exists
 * for. The alias is followed transitively (an alias of an alias is still the
 * environment), to a fixed point, and anything the initializer mentions is enough
 * — the alias may be reached through `?? {}`, a cast, a helper call.
 */
function environmentAliases(tokens: Token[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (let pass = 0; pass < 3; pass += 1) {
    let grew = false;
    for (let index = 0; index + 3 < tokens.length; index += 1) {
      const keyword = tokens[index].text;
      if (keyword !== "const" && keyword !== "let" && keyword !== "var") continue;
      const name = tokens[index + 1]?.text;
      if (name === undefined || !isIdentifier(name) || aliases.has(name)) continue;
      if (tokens[index + 2]?.text !== "=") continue;
      const names = environmentBindingsIn(tokens, index + 3, aliases);
      if (names === undefined) continue;
      aliases.set(name, names);
      grew = true;
    }
    if (!grew) break;
  }
  return aliases;
}

/**
 * The environment names read between token `from` and token `to` that code
 * shipped to a browser may not carry, each with the offset it was read at.
 *
 * Every name is reported once, at its first read: a module that reads the same
 * secret twice has one mistake, and a failure that lists it twice reads as two.
 * A read through an alias is required to be spelled like an environment name —
 * the alias is a plain `Record<string, string | undefined>`, so a lowercase
 * member read off it is a helper rather than a variable, and this repo spells
 * every environment name in capitals.
 */
function environmentReadsIn(
  tokens: Token[],
  from: number,
  to: number,
  aliases: ReadonlyMap<string, string[]>,
): EnvRead[] {
  const reads: EnvRead[] = [];
  const seen = new Set<string>();
  const note = (name: string, at: number): void => {
    if (isPublicEnvName(name) || seen.has(name)) return;
    seen.add(name);
    reads.push({ name, at });
  };

  for (let index = from; index < to; index += 1) {
    const objectEnd = environmentObjectEnd(tokens, index);
    if (objectEnd !== -1) {
      const read = memberReadAfter(tokens, objectEnd - 1);
      if (read !== undefined) note(read, tokens[index].start);
      continue;
    }
    if (tokens[index - 1]?.text === "." || !aliases.has(tokens[index].text)) continue;
    const read = memberReadAfter(tokens, index);
    if (read !== undefined && ENV_NAME.test(read)) note(read, tokens[index].start);
  }

  // A pattern that takes the environment apart: `const { DATABASE_URL } = process.env`.
  // Read separately from the member accesses above, because there is no property
  // access at all in this spelling — the names are the pattern's own keys.
  for (let index = from; index < to; index += 1) {
    if (tokens[index].text !== "=" || tokens[index - 1]?.text !== "}") continue;
    let open = -1;
    let depth = 0;
    for (let at = index - 1; at >= from; at -= 1) {
      if (tokens[at].text === "}") depth += 1;
      else if (tokens[at].text === "{") {
        depth -= 1;
        if (depth === 0) {
          open = at;
          break;
        }
      }
    }
    if (open === -1) continue;
    const keyword = tokens[open - 1]?.text;
    if (keyword !== "const" && keyword !== "let" && keyword !== "var") continue;
    const bound = tokens[index + 1]?.text;
    if (bound === undefined) continue;
    if (environmentObjectEnd(tokens, index + 1) === -1 && !aliases.has(bound)) continue;

    let inner = 0;
    for (let at = open + 1; at < index - 1; at += 1) {
      const text = tokens[at].text;
      if (text === "{" || text === "[") inner += 1;
      else if (text === "}" || text === "]") inner -= 1;
      // Only the pattern's own keys: a nested pattern (`{ a: { b } }`) binds a
      // name of its own shape, which is not one this rule can read.
      else if (inner === 0 && isIdentifier(text)) note(text, tokens[at].start);
    }
  }

  return reads;
}

/**
 * The names a value hands over *whole*: an alias of the environment, or the object
 * itself.
 *
 * The one shape a member read cannot show. `env: { PUBLIC_URL: publicUrl }` publishes
 * everything the alias holds — the name that leaks is the one *behind* it, which only
 * the alias walk knows — and `define: { X: process.env }` hands over the object. Both
 * are read only where the value is the object or the alias *itself*: a property read
 * off either is a single name, which `environmentReadsIn` reports at the line it was
 * read on, and reporting the two together would name every member of an object that
 * was handed over for one of them.
 */
function handedOverNames(
  tokens: Token[],
  from: number,
  to: number,
  aliases: ReadonlyMap<string, string[]>,
): EnvRead[] {
  const reads: EnvRead[] = [];
  const seen = new Set<string>();
  const note = (name: string, at: number): void => {
    if (isPublicEnvName(name) || seen.has(name)) return;
    seen.add(name);
    reads.push({ name, at });
  };

  for (let index = from; index < to; index += 1) {
    const objectEnd = environmentObjectEnd(tokens, index);
    if (objectEnd !== -1) {
      if (memberReadAfter(tokens, objectEnd - 1) === undefined) {
        note(ENVIRONMENT_OBJECT, tokens[index].start);
      }
      continue;
    }
    if (tokens[index - 1]?.text === ".") continue;
    const held = aliases.get(tokens[index].text);
    if (held === undefined || memberReadAfter(tokens, index) !== undefined) continue;
    if (held.length === 0) note(ENVIRONMENT_OBJECT, tokens[index].start);
    for (const name of held) note(name, tokens[index].start);
  }
  return reads;
}

/**
 * The environment names a module reads that code shipped to a browser may not.
 *
 * This is the rule *behind* the client-bundle guard rather than the guard itself:
 * on the server every one of these reads is ordinary, and it is only the module
 * graph that decides whether one is a leak — `src/test/client-env.test.ts` walks
 * that graph and asks this of each module it reaches. Stated as a detector it is
 * also drivable, which is what keeps the walk from being the only evidence.
 *
 * A name that is not `NEXT_PUBLIC_`-prefixed is the offender whatever it looks
 * like, because the client cannot have it: the bundler inlines only the public
 * names, so a component reading `process.env.DATABASE_URL` gets `undefined` — and
 * `process.env` itself does not exist in a browser, so the read throws instead of
 * returning one. Either way it is a bug, and if the value were inlined it would
 * be a leak, which is why the two are refused together rather than told apart.
 */
export function serverEnvReads(source: string): string[] {
  const tokens = tokenize(source);
  const aliases = environmentAliases(tokens);
  return environmentReadsIn(tokens, 0, tokens.length, aliases).map(
    ({ name, at }) => `${name} at line ${lineNumberAt(source, at)}`,
  );
}

/**
 * The `NEXT_PUBLIC_` names that claim a credential is safe to publish.
 *
 * The other direction of the same promise. The prefix is not a comment — it is an
 * instruction to the bundler to inline that value into every visitor's copy of the
 * app — so a name carrying a credential word (`NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`,
 * the classic version of this mistake on a Supabase project) is a secret published
 * by the person who typed the prefix, before any code reads it.
 *
 * The scan reads identifier and string tokens only, never the prose around them: a
 * doc comment that mentions `NEXT_PUBLIC_…_SECRET_KEY` while explaining this rule
 * is not a declaration of one, which is the difference between a token walk and a
 * regexp over the file. A name inside a template literal's text is read too, since
 * this repo composes URLs out of environment names and a template is one token.
 */
export function publicSecretNames(source: string): string[] {
  const offenders: string[] = [];
  for (const name of publicEnvNames(source)) {
    const word = PUBLIC_SECRET_WORD.exec(name.slice(PUBLIC_ENV_PREFIX.length));
    if (word !== null) offenders.push(`${name} — ${word[1]} cannot be published`);
  }
  return offenders;
}

/**
 * Every `NEXT_PUBLIC_` name a piece of source spells, once each, sorted.
 *
 * The vocabulary itself, as opposed to the rule about it: what is *declared* public
 * is worth being able to read back, because the prefix is the whole contract — a
 * name added to it is a value the app now publishes, and that should be a line in a
 * test rather than a line in a pull request nobody read. The same reader backs the
 * credential check above and the ratchet in `src/test/client-env.test.ts`, so what
 * is counted and what is checked cannot be two different sets.
 *
 * Identifiers and the contents of string and template tokens are read; comments are
 * not, because the tokenizer never hands them over — which is the difference that
 * lets this rule be documented in prose that names a bad example.
 */
export function publicEnvNames(source: string): string[] {
  const names = new Set<string>();
  for (const token of tokenize(source)) {
    const first = token.text[0];
    const text =
      first === '"' || first === "'" || first === "`"
        ? (stringLiteral(token.text) ?? "")
        : token.text;
    for (const match of text.matchAll(/\bNEXT_PUBLIC_[A-Z0-9_]*/g)) names.add(match[0]);
  }
  return [...names].sort();
}

/**
 * Whether a module is where a client bundle begins.
 *
 * The `"use client"` directive is the only thing that decides this: the framework
 * reads it and starts a client graph there, so everything the module imports —
 * however deep the chain, and through re-exports as well as imports — ends up in
 * the bundle. A module *without* it is a server module (or a shared one, which is
 * the same thing to this rule: whatever reaches a boundary ships). It is the first
 * token, not the first line, so a file may open with a licence or a comment.
 */
export function clientBoundary(source: string): boolean {
  const [first] = tokenize(source);
  return first !== undefined && stringLiteral(first.text) === "use client";
}

/**
 * The entries of an object literal, as the key it names and its value's token span.
 *
 * One level deep on purpose: the entries of `define` and `env` are flat, and a
 * nested object under one of them is data the entry's own value spans rather than
 * a set of entries to read. A key may be a bare name or a quoted one (`"process.env"`
 * is the spelling Vite's docs use for this exact override). A shorthand entry — a
 * key with no `:` — is reported with an empty span, which is the honest reading: the
 * value is whatever that name holds, which the entry is publishing either way.
 */
function objectEntries(
  tokens: Token[],
  open: number,
  close: number,
): Array<{ key: string; keyAt: number; from: number; to: number }> {
  const entries: Array<{ key: string; keyAt: number; from: number; to: number }> = [];
  let at = open + 1;
  while (at < close) {
    const text = tokens[at].text;
    if (text === ",") {
      at += 1;
      continue;
    }
    const quoted = text[0] === '"' || text[0] === "'";
    const key = quoted ? stringLiteral(text) : isIdentifier(text) ? text : undefined;
    if (key === undefined) {
      at += 1;
      continue;
    }
    if (tokens[at + 1]?.text !== ":") {
      entries.push({ key, keyAt: tokens[at].start, from: at + 1, to: at + 1 });
      at += 1;
      continue;
    }
    let to = at + 2;
    let depth = 0;
    while (to < close) {
      const value = tokens[to].text;
      if (value === "(" || value === "[" || value === "{") depth += 1;
      else if (value === ")" || value === "]" || value === "}") {
        if (depth === 0) break;
        depth -= 1;
      } else if (value === "," && depth === 0) break;
      to += 1;
    }
    entries.push({ key, keyAt: tokens[at].start, from: at + 2, to });
    at = to + 1;
  }
  return entries;
}

/**
 * The build-config entries that put a server value into the client bundle.
 *
 * The module graph is one way a value reaches a bundle; the build config is the
 * other, and it is the faster one — nothing has to import anything, because the
 * bundler is told to substitute the value everywhere it appears, in the browser
 * included. Three shapes, all of them real settings rather than invented ones:
 *
 *   - **the environment object itself, as a `define` key.** `define: { "process.env": … }`
 *     replaces every environment read in every bundle with whatever it is given,
 *     which is the wholesale form of publishing the environment. Any spelling of
 *     the key counts (`process.env`, `process?.env`, `globalThis.process.env`),
 *     since they all resolve to the same object.
 *   - **a value that reads a non-public name.** `define: { SUPABASE_URL: JSON.stringify(process.env.DATABASE_URL) }`
 *     bakes one server value into every bundle; the same entry under `env` is Next's
 *     documented way to make a value available to the client, so both keys are read
 *     the same way. A public name in the value is left alone — inlining
 *     `NEXT_PUBLIC_…` is what the prefix asked for.
 *   - **a published name that is a credential.** An `env` entry is published under
 *     whatever key it is written with, so a key carrying a credential word is the
 *     same mistake as the prefixed spelling, one config file over.
 *
 * The alias walk is what makes the second shape catch the way this repo writes it:
 * `const publicUrl = process.env.R2_PUBLIC_URL` followed by `env: { PUBLIC_URL: publicUrl }`
 * publishes that value, and the guard reads the alias.
 */
export function inlinedClientValues(source: string): string[] {
  const tokens = tokenize(source);
  const aliases = environmentAliases(tokens);
  const offenders: string[] = [];

  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const key = tokens[index].text;
    if (!CLIENT_BUNDLE_KEYS.has(key)) continue;
    if (tokens[index + 1]?.text !== ":" || tokens[index + 2]?.text !== "{") continue;
    const open = index + 2;
    const close = matchingBracket(tokens, open);

    for (const entry of objectEntries(tokens, open, close)) {
      if (ENVIRONMENT_OBJECT_KEY.test(entry.key)) {
        offenders.push(`define "${entry.key}" replaces the environment in every bundle`);
        continue;
      }
      // A shorthand entry has no value expression at all, so the name it publishes
      // is its own key: `env: { DATABASE_URL }` hands that variable to the client.
      const reads =
        entry.from === entry.to
          ? isPublicEnvName(entry.key)
            ? []
            : [{ name: entry.key, at: entry.keyAt }]
          : [
              ...environmentReadsIn(tokens, entry.from, entry.to, aliases),
              ...handedOverNames(tokens, entry.from, entry.to, aliases),
            ];
      for (const { name, at } of reads) {
        offenders.push(`${key} ${entry.key} publishes ${name} at line ${lineNumberAt(source, at)}`);
      }
      if (reads.length > 0) continue;
      const word = PUBLIC_SECRET_WORD.exec(entry.key);
      if (word !== null) {
        offenders.push(`${key} ${entry.key} publishes a value under a ${word[1]} name`);
      }
    }
  }
  return offenders;
}

/* -------------------------------------------------------------------------- */
/* The stage-order guard                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The stage name a comma-delimited item carries, or `null` when it carries none: a name is the
 * item's last word, so an item may carry its own introduction (`have: lint`) without hiding, and
 * a file name is not a stage name (`drift.mjs` has no dotted stage in it).
 *
 * The runner's `--stages=check` audit reads a line the same way (`.freebuff/ci.mjs`,
 * `stageNameIn`) — deliberately the same words, because the fixture this guard is held against is
 * driven through that audit too, and two readings that disagreed could pass one while failing the
 * other.
 */
function stageNameIn(token: string, canonicalOrder: string[]): string | null {
  const word = token.trim().split(/\s+/).pop() ?? "";
  const bare = word.replace(/^[^a-z-]+|[^a-z-]+$/g, "");
  return canonicalOrder.includes(bare) ? bare : null;
}

/** Every maximal comma-run of stage names on a line, in the order they are written. */
function stageNameRuns(line: string, canonicalOrder: string[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const token of line.split(",")) {
    const name = stageNameIn(token, canonicalOrder);
    if (name === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(name);
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** Whether names are written in the canonical order — each one later in the pass than the last. */
function inCanonicalOrder(names: string[], canonicalOrder: string[]): boolean {
  const index = names.map((name) => canonicalOrder.indexOf(name));
  return index.every((value, position) => position === 0 || index[position - 1] < value);
}

/**
 * The commentary of `source`: what the shared lexer did *not* claim as a token, in place.
 *
 * `tokenize` skips `//` and `/* … *​/` comments entirely and emits code, strings and templates
 * as positioned tokens whose text is the exact source slice — so blanking every token's span
 * leaves precisely the file's comments, at their own offsets. Newlines survive the blanking so
 * every line number still points at the file.
 *
 * A stage list a *string* carries is an assertion, a fixture or captured output — the suite is
 * deliberately full of them, out of order on purpose — and code names stages one at a time
 * (`stageDeclaration("lint")`), so neither is a claim this guard may refuse. The claim it holds
 * to the table is the one somebody wrote in prose. The lexer is the suite's own, with its own
 * stated approximation: a regexp literal tokenizes as division, so a stage list inside one is
 * read as the code around it — a shape no comment in this tree wears.
 */
function commentary(source: string): string {
  const chars = source.split("");
  for (const token of tokenize(source)) {
    const end = Math.min(token.start + token.text.length, chars.length);
    for (let at = token.start; at < end; at += 1) {
      if (chars[at] !== "\n") chars[at] = " ";
    }
  }
  return chars.join("");
}

/**
 * The 1-based line numbers of lines whose copy of the stage order the table contradicts: a run of
 * stage names written out of canonical order, or a count stated beside a list that is not its
 * length.
 *
 * The order is stated once — the `STAGE_TABLE` declarations in `.freebuff/gate-drift.mjs` — and
 * every other statement of it is a copy that goes stale the moment a stage is added. The runner's
 * `--stages=check` audit holds the files it watches to that table; this is the same reading, pure
 * and portable to any source a test hands it, so a comment restating the pass in a file the audit
 * never scans is refused at test time too.
 *
 * The reading runs over the file's *commentary* (`commentary` above) rather than its raw bytes,
 * which is what makes it safe to point at every source file in the tree: the runner's audit
 * raw-scans the few files it watches, where every line is a known generated or enumerated claim,
 * while an arbitrary file's raw bytes are mostly data — assertion strings and code, not prose.
 *
 * Both halves mirror `stageOrderLineFindings` in `.freebuff/ci.mjs` deliberately — including the
 * "speaks" gate (a line counts as a claim only when it names a stage or a `--only`/`--skip`/
 * `--from` flag, so incidental comma-separated words never read as one) and the `N of N stage(s)`
 * exception (that spelling counts the run it sits beside rather than the list beside it, so order
 * is the only claim it makes). `convention-guards.test.ts` drives the fixture pair below through
 * the real audit as well, and a reading that drifted from the runner's would fail there.
 *
 * A line wrong both ways is reported once: one stale line is one mistake to fix.
 */
export function staleStageLists(source: string, canonicalOrder: string[]): number[] {
  const offenders: number[] = [];
  const lines = commentary(source).split(/\r?\n/);
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position];
    const speaks = /stage/i.test(line) || /--(only|skip|from)[= ]/.test(line);
    if (!speaks) continue;
    const runs = stageNameRuns(line, canonicalOrder);
    if (runs.every((run) => run.length < 2)) continue;
    const outOfOrder = runs.find((run) => run.length > 1 && !inCanonicalOrder(run, canonicalOrder));
    let miscounted = false;
    if (runs.length === 1 && !/\d+\s+of\s+\d+\s+stage\(s\)/.test(line)) {
      const stated = [...line.matchAll(/(\d+)\s+stage\(s\)/g)].pop();
      miscounted = stated !== undefined && Number(stated[1]) !== runs[0].length;
    }
    if (outOfOrder !== undefined || miscounted) offenders.push(position + 1);
  }
  return offenders;
}

/* -------------------------------------------------------------------------- */
/* The registry                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One convention guard, reduced to what a meta-test can drive: the rule it
 * enforces, the detector that finds it, and a pair of sources it must separate.
 */
export interface ConventionGuard {
  /** Short id, used to name the guard in a failure. */
  id: string;
  /** The convention, stated as what the guard refuses to let back in. */
  failure: string;
  /** The offenders the guard reports for `source`; empty means the source is clean. */
  detect(source: string): string[];
  /** A source the guard must flag — its own forbidden shape. */
  forbidden: string;
  /** A source the guard must leave alone — the fix for that shape. */
  clean: string;
}

/**
 * Every convention guard, each with the forbidden shape it exists to catch and
 * the clean shape that replaces it.
 *
 * `convention-guards.test.ts` walks this list and asserts each `detect` flags
 * its `forbidden` and clears its `clean`, so a detector that stops matching — a
 * regex that no longer fits, a rule narrowed past its own case — fails there
 * rather than leaving the guard silently catching nothing.
 */
export const CONVENTION_GUARDS: ConventionGuard[] = [
  {
    id: "mount",
    failure: "a test mounts through the raw `mount()` instead of `mountSurface`",
    detect: (source) => rawMountCalls(source).map((line) => `line ${line}`),
    forbidden: '  const ui = mount(<Foo />);',
    clean: '  const ui = mountSurface(<Foo />);',
  },
  {
    id: "settle",
    failure: "a test asserts straight after a `settle()` sleep instead of waiting",
    detect: (source) => settlesWithoutWait(source).map((line) => `line ${line}`),
    forbidden: ["  await ui.settle(20);", "  expect(ui.tooltips()).toEqual(['a']);"].join("\n"),
    clean: [
      "  await ui.settle(20);",
      "  await ui.waitFor(() => ui.tooltips().length > 0, { description: 'the tooltip' });",
    ].join("\n"),
  },
  {
    id: "body-clear",
    failure: "a teardown empties `document.body` before it calls `cleanupSurfaces()`",
    detect: (source) => {
      const problem = cleanupProblem(source);
      return problem === null ? [] : [problem];
    },
    forbidden: [
      'test("x", () => { mountSurface(<Foo />); });',
      "afterEach(() => {",
      '  document.body.innerHTML = "";',
      "  cleanupSurfaces();",
      "});",
    ].join("\n"),
    clean: [
      'test("x", () => { mountSurface(<Foo />); });',
      "afterEach(() => {",
      "  cleanupSurfaces();",
      '  document.body.innerHTML = "";',
      "});",
    ].join("\n"),
  },
  {
    id: "stylesheet",
    failure: "a class rule sets a colour outside any `@layer`, so it outranks Tailwind",
    detect: (source) => unlayeredColourOffenders(source),
    forbidden: ".orphan { color: red; }",
    clean: "@layer utilities {\n  .orphan { color: red; }\n}",
  },
  {
    id: "beat-seam",
    failure:
      "a shared hook takes a per-beat callback (or the clock-owning hook hands the walk back) " +
      "instead of publishing the beat as a value",
    detect: (source) => imperativeBeatSeams(source),
    forbidden: [
      "export interface BeatOptions {",
      "  cadenceMs: number;",
      "  onTick?: () => void;",
      "}",
      "export function useBeatThing(options: BeatOptions) {",
      "  const interval = window.setInterval(() => {",
      "    onTick?.();",
      "  }, options.cadenceMs);",
      "  return { interval, advance: () => {} };",
      "}",
    ].join("\n"),
    clean: [
      "export interface BeatOptions {",
      "  cadenceMs: number;",
      "}",
      "export function useBeatThing({ cadenceMs }: BeatOptions) {",
      "  const interval = window.setInterval(() => {",
      "    advance();",
      "  }, cadenceMs);",
      "  return { beats, select }; // the beat as a count, never as a walk",
      "}",
    ].join("\n"),
  },
  {
    id: "beat-clock",
    failure:
      "a surface mounting the shared carousel opens a repeating clock of its own, taking the beat " +
      "back from the hook that owns it",
    detect: (source) => surfaceOwnedClocks(source),
    forbidden: [
      "export function LiveVisual() {",
      "  const { index, playing } = useAmbientCarousel(3, { cadenceMs: 4200 });",
      "  useEffect(() => {",
      "    const id = window.setInterval(() => next(), 4200);",
      "    return () => window.clearInterval(id);",
      "  }, [playing]);",
      "  return <div>{index}</div>;",
      "}",
    ].join("\n"),
    clean: [
      "export function LiveVisual() {",
      "  const { index, playing } = useAmbientCarousel(3, { cadenceMs: 4200 });",
      "  return <div>{index}{playing ? null : 'paused'}</div>;",
      "}",
    ].join("\n"),
  },
  {
    id: "runbook",
    failure: "the runbook's Contents block is out of step with its headings",
    detect: (source) => contentsDrift(source),
    forbidden: [
      "# Title",
      "",
      "## Contents",
      "",
      "- [Old Name](#old-name)",
      "",
      "## Alpha",
      "",
      "text",
    ].join("\n"),
    clean: buildContents(
      [
        "# Title",
        "",
        "## Contents",
        "",
        "- [Old Name](#old-name)",
        "",
        "## Alpha",
        "",
        "text",
      ].join("\n"),
    ),
  },
  {
    id: "client-env",
    failure:
      "a module reads an environment name the client bundle cannot carry, so the value is a " +
      "leak where the client can reach the module and a crash where it cannot",
    detect: (source) => serverEnvReads(source),
    forbidden: [
      "const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};",
      "const connectionString = runtimeEnv.DATABASE_URL;",
    ].join("\n"),
    clean: [
      "const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};",
      "const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;",
    ].join("\n"),
  },
  {
    id: "public-vocabulary",
    failure:
      "a `NEXT_PUBLIC_` name carries a credential word, which publishes that credential to " +
      "every visitor because the prefix is what asks the bundler to inline it",
    detect: (source) => publicSecretNames(source),
    forbidden: "const adminKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;",
    clean: "const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
  },
  {
    id: "client-config",
    failure:
      "a build config inlines a server value into the client bundle — the whole environment " +
      "object, a non-public variable, or a value published under a credential name",
    detect: (source) => inlinedClientValues(source),
    forbidden: [
      "export default defineConfig({",
      "  define: {",
      '    "process.env": JSON.stringify(process.env),',
      "  },",
      "});",
    ].join("\n"),
    clean: [
      "export default defineConfig({",
      "  define: {",
      '    WeakRef: "globalThis.WeakRef ?? null",',
      "  },",
      "});",
    ].join("\n"),
  },
  {
    id: "stale-stage-lists",
    failure:
      "a line restates the stage order differently from the stage table — stage names written out " +
      "of canonical order, or a count beside a list that is not its length",
    detect: (source) => staleStageLists(source, STAGE_NAMES).map((line) => `line ${line}`),
    forbidden: "// stages: 3 stage(s), `lint`, `typecheck`",
    clean: "// stages: 2 stage(s), `typecheck`, `lint`",
  },
];
