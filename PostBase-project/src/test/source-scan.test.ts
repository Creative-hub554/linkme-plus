/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  continuesExpression,
  exportedHttpMethods,
  importSpecifiers,
  isIdentifier,
  matchingBracket,
  moduleExports,
  readTestSources,
  reExportSpecifiers,
  statementEnd,
  stringLiteral,
  tokenize,
  type ModuleResolver,
  type ModuleSource,
  type Token,
} from "@/test/source-scan";
// The scanner as *source*, so the decision to read the test files on demand
// rather than eagerly glob them can be asserted without re-measuring collect time.
import sourceScanSource from "./source-scan.ts?raw";

/**
 * The tests for the tokenizer the convention guards are built on.
 *
 * `render.test.ts` and `dom-test-waits.test.ts` read a file's *structure* — where
 * a statement ends, which call a block belongs to — and they do it through the
 * tokenizer in `@/test/source-scan`. That makes the tokenizer load-bearing: a
 * change to how it splits strings, comments or template literals, or to how the
 * ASI walk decides a line break is a boundary, would change what those guards
 * quietly accept, and nothing in their own fixtures would necessarily notice.
 *
 * So the tokenizer's rules are pinned here, against the shapes that trip a naive
 * scanner: a `;` or a bracket inside a string, a template literal or a comment; a
 * chained call that opens the next line with a `.`; a binary operator carried to
 * the next line; a brace-less loop body; a closer whose opener lies before the
 * statement. Each fixture states the boundary the guards rely on, so loosening
 * one fails here rather than silently widening a guard.
 */

/** The tokens' text, for asserting a whole token stream on one line. */
function texts(tokens: Token[]): string[] {
  return tokens.map((token) => token.text);
}

/**
 * The text of the statement starting at token `from`, by the same ASI walk the
 * guards use — the one-line view of `statementEnd` for the fixtures below.
 */
function statement(source: string, from = 0, bodyFollows = false): string[] {
  const tokens = tokenize(source);
  return texts(tokens.slice(from, statementEnd(tokens, from, bodyFollows)));
}

describe("the shared tokenizer", () => {
  describe("splitting source into tokens", () => {
    it("drops whitespace and records whether a line break came before each token", () => {
      const tokens = tokenize("a\n  b c");
      expect(texts(tokens)).toEqual(["a", "b", "c"]);
      expect(tokens.map((token) => token.newlineBefore)).toEqual([false, true, false]);
    });

    it("reads a string as one token, so a `;` or a bracket inside one cannot throw the walk off", () => {
      // The `)` and the `;` are inside the string: if the string were split, the
      // `)` would close the call early and the walk would end in the wrong place.
      expect(texts(tokenize("takes(')');"))).toEqual(["takes", "(", "')'", ")", ";"]);
      expect(texts(tokenize("const s = 'a; ]b';"))).toEqual([
        "const",
        "s",
        "=",
        "'a; ]b'",
        ";",
      ]);
    });

    it("reads a template literal as one token, interpolation and all", () => {
      // A `${…}` interpolation is not walked into — the whole literal is one
      // token. That is the approximation the guards are written against.
      expect(texts(tokenize("const t = `a; (b) [c]`;"))).toEqual([
        "const",
        "t",
        "=",
        "`a; (b) [c]`",
        ";",
      ]);
      expect(texts(tokenize("`a ${'b'} c`"))).toEqual(["`a ${'b'} c`"]);
    });

    it("keeps a backslash escape from closing a string early", () => {
      expect(texts(tokenize("'a\\'b'; c"))).toEqual(["'a\\'b'", ";", "c"]);
    });

    it("consumes both comment forms without emitting a token, keeping the break they hide", () => {
      const lineComment = tokenize("a // ; }\nb");
      expect(texts(lineComment)).toEqual(["a", "b"]);
      expect(lineComment[1].newlineBefore).toBe(true);

      const blockComment = tokenize("a /* ;\n } */ b");
      expect(texts(blockComment)).toEqual(["a", "b"]);
      // The break inside the block comment still counts, so `b` is not read as a
      // continuation of the line `a` sat on.
      expect(blockComment[1].newlineBefore).toBe(true);
    });

    it("reads identifiers and numbers as units and everything else one character at a time", () => {
      expect(texts(tokenize("const x = 12;"))).toEqual(["const", "x", "=", "12", ";"]);
    });
  });

  describe("deciding where a statement ends", () => {
    it("ends a semicolon-less statement at the line break", () => {
      expect(statement("const a = 1\nconst b = 2")).toEqual(["const", "a", "=", "1"]);
    });

    it("ends at the real `;`, not one inside a string, a template or a comment", () => {
      expect(statement("const s = 'a; b'; const t = 2")).toEqual([
        "const",
        "s",
        "=",
        "'a; b'",
        ";",
      ]);
      expect(statement("const t = `a; (b) [c]`;\nnext")).toEqual([
        "const",
        "t",
        "=",
        "`a; (b) [c]`",
        ";",
      ]);
      expect(statement("const s = 1 // ; not a terminator\nconst t = 2")).toEqual([
        "const",
        "s",
        "=",
        "1",
      ]);
    });

    it("is not unbalanced by a bracket inside a block comment", () => {
      // `) ] }` in the comment would close the call three times over if the
      // comment were walked into; the statement still runs to its real `;`.
      expect(statement("foo(bar /* ) ] } */ , baz);\nnext")).toEqual([
        "foo",
        "(",
        "bar",
        ",",
        "baz",
        ")",
        ";",
      ]);
    });

    it("continues a chained call that opens the next line with a dot", () => {
      expect(statement("promise\n  .then(a)\n  .then(b);\nconst x = 1")).toEqual([
        "promise",
        ".",
        "then",
        "(",
        "a",
        ")",
        ".",
        "then",
        "(",
        "b",
        ")",
        ";",
      ]);
    });

    it("continues an expression carried on by a leading binary operator", () => {
      expect(statement("const total = 1\n  + 2\n  + 3\nconst next = 4")).toEqual([
        "const",
        "total",
        "=",
        "1",
        "+",
        "2",
        "+",
        "3",
      ]);
    });

    it("does not end after `return`, which still needs an operand", () => {
      // `return` is mid-line so the walk starts on it rather than at its own
      // break; the break that follows it must not end the statement.
      expect(statement("function f() { return\n  value\n}", 5)).toEqual(["return", "value"]);
    });

    it("crosses a closer whose opener lies before the statement", () => {
      // `from` sits inside the `[…]`, so the walk begins past its opener and the
      // `]` must be crossed rather than read as the end of the statement.
      const tokens = tokenize("const xs = [a, b].map(f);\nnext");
      expect(texts(tokens.slice(4, statementEnd(tokens, 4)))).toEqual([
        "a",
        ",",
        "b",
        "]",
        ".",
        "map",
        "(",
        "f",
        ")",
        ";",
      ]);
    });

    it("takes a brace-less loop body as part of the loop, not the line after it", () => {
      const source = "for (const n of list)\n  n.remove();\nnext";
      const tokens = tokenize(source);
      const header = tokens.findIndex((token) => token.text === "for");
      const bodyStart = matchingBracket(tokens, header + 1) + 1;

      // `bodyFollows` suppresses the leading break, so the body and its `;` are
      // one statement…
      expect(texts(tokens.slice(bodyStart, statementEnd(tokens, bodyStart, true)))).toEqual([
        "n",
        ".",
        "remove",
        "(",
        ")",
        ";",
      ]);
      // …while without it the same call is read as ending at the body's own line.
      expect(statementEnd(tokens, bodyStart)).toBe(bodyStart);
    });
  });

  describe("continuesExpression", () => {
    it("is true when the token itself opens the line with a continuing sigil", () => {
      const chained = tokenize("a\n.b");
      expect(continuesExpression(chained, 1)).toBe(true);
      const summed = tokenize("a\n+ b");
      expect(continuesExpression(summed, 1)).toBe(true);
    });

    it("is true when the line break comes after a keyword that needs an operand", () => {
      expect(continuesExpression(tokenize("return\nvalue"), 1)).toBe(true);
      expect(continuesExpression(tokenize("for (const n of\nlist)"), 5)).toBe(true);
    });

    it("is false when the previous expression was complete", () => {
      expect(continuesExpression(tokenize("a)\nb"), 2)).toBe(false);
      expect(continuesExpression(tokenize("a\nb"), 1)).toBe(false);
      expect(continuesExpression(tokenize("a"), 0)).toBe(false);
    });
  });

  describe("matchingBracket", () => {
    it("finds the closer that matches an opener across nesting", () => {
      const tokens = tokenize("a(b[c]d)e");
      expect(matchingBracket(tokens, 1)).toBe(7);
      expect(matchingBracket(tokens, 3)).toBe(5);
    });

    it("returns the end of the stream when the bracket never closes", () => {
      const tokens = tokenize("f(a");
      expect(matchingBracket(tokens, 1)).toBe(tokens.length);
    });

    it("returns the index itself when the token is not an opener", () => {
      const tokens = tokenize("a(b)");
      expect(matchingBracket(tokens, 0)).toBe(0);
    });
  });

  describe("isIdentifier", () => {
    it("accepts a name and rejects anything that is not one", () => {
      expect(isIdentifier("foo")).toBe(true);
      expect(isIdentifier("$x")).toBe(true);
      expect(isIdentifier("_")).toBe(true);
      expect(isIdentifier("a.b")).toBe(false);
      expect(isIdentifier("1a")).toBe(false);
      expect(isIdentifier("")).toBe(false);
    });
  });

  describe("moduleExports", () => {
    it("sees a default export in each of its spellings", () => {
      expect(moduleExports("export default function Page() {}").default).toBe(true);
      expect(moduleExports("export default class Page {}").default).toBe(true);
      expect(moduleExports("const Page = () => {}; export default Page;").default).toBe(true);
      expect(moduleExports('export { default } from "./real-page";').default).toBe(true);
      expect(moduleExports("export { Page as default };").default).toBe(true);
      expect(moduleExports("const helper = 1;").default).toBe(false);
    });

    it("reads the name off each declaration form", () => {
      const named = (source: string) => [...moduleExports(source).named].sort();

      expect(named("export const metadata = {};")).toEqual(["metadata"]);
      expect(named("export let count = 0;")).toEqual(["count"]);
      expect(named("export const { a, b } = source;")).toEqual(["a", "b"]);
      expect(named("export function bind() {}")).toEqual(["bind"]);
      expect(named("export async function load() {}")).toEqual(["load"]);
      expect(named("export function* walk() {}")).toEqual(["walk"]);
      expect(named("export class Store {}")).toEqual(["Store"]);
      expect(named("export interface Props {}")).toEqual(["Props"]);
      expect(named("export type Name = string;")).toEqual(["Name"]);
      expect(named("export enum Kind { A }")).toEqual(["Kind"]);
    });

    it("reads the clause, including `as` aliases and a re-exported default", () => {
      expect([...moduleExports("export { A, B as C };").named].sort()).toEqual(["A", "C"]);
      expect([...moduleExports("export type { D };").named]).toEqual(["D"]);
      expect([...moduleExports("export { default as Page };").named]).toEqual(["Page"]);
      expect(moduleExports("export { default as Page };").default).toBe(true);
      expect([...moduleExports('export * as ns from "./x";').named]).toEqual(["ns"]);
      // A bare star re-export is opaque, so it names nothing rather than guessing.
      expect([...moduleExports('export * from "./x";').named]).toEqual([]);
    });

    it("is not fooled by an `export` spelled inside a string or a comment", () => {
      expect(moduleExports('const s = "export async function GET";').named.size).toBe(0);
      expect(moduleExports("// export const POST = 1").named.size).toBe(0);
    });
  });

  describe("exportedHttpMethods", () => {
    it("keeps only the method handlers a route module exports", () => {
      expect(exportedHttpMethods("export async function GET() {}\nexport const POST = 1;")).toEqual([
        "GET",
        "POST",
      ]);
      // Only an exact method name counts: a `GETTERS` constant is not a handler.
      expect(
        exportedHttpMethods("export const GETTERS = 1;\nexport default function Page() {}"),
      ).toEqual([]);
      expect(exportedHttpMethods("export default function Page() {}")).toEqual([]);
    });
  });

  describe("moduleExports through the module graph", () => {
    /** Resolves a relative specifier against a flat path→source map. */
    const resolverFor = (modules: Record<string, string>): ModuleResolver => {
      return (specifier, importer) => {
        const dir = importer.slice(0, importer.lastIndexOf("/"));
        const target = specifier.replace(/^\.\//, "");
        const base = dir === "" ? target : `${dir}/${target}`;
        for (const path of [`${base}.ts`, `${base}.tsx`, base]) {
          const source = modules[path];
          if (source !== undefined) return { path, source };
        }
        return undefined;
      };
    };

    const entry = (source: string): ModuleSource => ({ path: "app/route.ts", source });

    it("reads a handler re-exported by name from another module", () => {
      const resolve = resolverFor({ "app/impl.ts": "export async function GET() {}" });
      expect(exportedHttpMethods(entry('export { GET } from "./impl";'), resolve)).toEqual(["GET"]);
    });

    it("aliases a re-exported handler", () => {
      const resolve = resolverFor({ "app/impl.ts": "export const GET = () => {};" });
      expect(exportedHttpMethods(entry('export { GET as POST } from "./impl";'), resolve)).toEqual([
        "POST",
      ]);
    });

    it("fans in every name `export * from` reaches, but not the target's default", () => {
      const resolve = resolverFor({
        "app/impl.ts":
          "export const GET = () => {};\nexport const POST = () => {};\nexport default function Page() {}",
      });
      const exports = moduleExports(entry('export * from "./impl";'), resolve);
      expect([...exports.named].sort()).toEqual(["GET", "POST"]);
      expect(exports.default).toBe(false);
    });

    it("re-exports a default, whole or aliased", () => {
      const resolve = resolverFor({ "app/impl.ts": "export default function Page() {}" });
      expect(moduleExports(entry('export { default } from "./impl";'), resolve).default).toBe(true);
      const aliased = moduleExports(entry('export { default as Page } from "./impl";'), resolve);
      expect([...aliased.named]).toEqual(["Page"]);
      // An aliased default is a named export here, not a default of this module.
      expect(aliased.default).toBe(false);
    });

    it("only exports a name the target actually has", () => {
      const resolve = resolverFor({ "app/impl.ts": "export const POST = () => {};" });
      expect(moduleExports(entry('export { GET } from "./impl";'), resolve).named.size).toBe(0);
    });

    it("trusts a clause it cannot follow, rather than dropping the name", () => {
      // An unresolved specifier and no resolver behave alike: trust the spelling,
      // since guessing would drop a real handler.
      expect([...moduleExports('export { GET } from "./missing";').named]).toEqual(["GET"]);
      const resolve = resolverFor({});
      expect([...moduleExports(entry('export { GET } from "./missing";'), resolve).named]).toEqual([
        "GET",
      ]);
      // A star with nothing to follow names nothing rather than guessing.
      expect([...moduleExports(entry('export * from "./missing";'), resolve).named]).toEqual([]);
    });

    it("follows a chain of re-exports", () => {
      const resolve = resolverFor({
        "app/handlers.ts": 'export * from "./deep";',
        "app/deep.ts": "export async function GET() {}",
      });
      expect(exportedHttpMethods(entry('export * from "./handlers";'), resolve)).toEqual(["GET"]);
    });

    it("does not hang on a re-export cycle", () => {
      const resolve = resolverFor({
        "app/b.ts": 'export const B = 2;\nexport * from "./a";',
      });
      const exports = moduleExports(
        { path: "app/a.ts", source: 'export const A = 1;\nexport * from "./b";' },
        resolve,
      );
      expect([...exports.named].sort()).toEqual(["A", "B"]);
    });
  });

  describe("importSpecifiers", () => {
    it("reads the specifier off every import spelling", () => {
      expect(importSpecifiers('import x from "./a";')).toEqual(["./a"]);
      expect(importSpecifiers('import { A, B as C } from "./a";')).toEqual(["./a"]);
      expect(importSpecifiers('import * as ns from "./a";')).toEqual(["./a"]);
      expect(importSpecifiers('import type { T } from "./a";')).toEqual(["./a"]);
      expect(importSpecifiers('import "./a";')).toEqual(["./a"]);
      expect(importSpecifiers('const a = await import("./a");')).toEqual(["./a"]);
      expect(importSpecifiers('const a = require("./a");')).toEqual(["./a"]);
    });

    it("keeps every edge in source order, through a multi-line clause", () => {
      const source = [
        'import {\n  A,\n  B,\n} from "./a";',
        'import type { T } from "./b";',
        '\nimport "./c";',
      ].join("\n");
      expect(importSpecifiers(source)).toEqual(["./a", "./b", "./c"]);
    });

    it("reads the `from` of the clause rather than one spelled inside it", () => {
      // `from` is a legal local name: `import { from as x } from "./a"` and
      // `import { a as from } from "./a"` both name the module after the clause,
      // and a walk that stopped at the first `from` would read the wrong string.
      expect(importSpecifiers('import { from as x } from "./a";')).toEqual(["./a"]);
      expect(importSpecifiers('import { a as from } from "./a";')).toEqual(["./a"]);
    });

    it("lists nothing for a spelling that names no module", () => {
      // `import.meta` is a property of the keyword, not an import statement.
      expect(importSpecifiers("const url = import.meta.url;")).toEqual([]);
      expect(importSpecifiers("import { meta } from \"./meta\";")).toEqual(["./meta"]);
      // A template with no substitution is a specifier like any other…
      expect(importSpecifiers("const a = await import(`./a`);")).toEqual(["./a"]);
      // …while one built from an expression is reported exactly as it is written,
      // so it resolves to no module rather than to a guessed path.
      expect(importSpecifiers("const a = await import(`./${name}`);")).toEqual(["./${name}"]);
      expect(importSpecifiers('import x from "./a"')).toEqual(["./a"]);
      // …and a `from` inside a string or a comment is not an import.
      expect(importSpecifiers('const s = "import x from \\"./nope\\"";')).toEqual([]);
      expect(importSpecifiers('// import x from "./nope"\nconst a = 1;')).toEqual([]);
    });

    it("stops the search at the next statement rather than reading its specifier", () => {
      // `import { A }` with no `from` is not legal JavaScript, but a walk that kept
      // going would hand back the specifier of whatever came next — which is the
      // failure a guard would feel as a real edge that is not there.
      expect(importSpecifiers('import { A };\nimport x from "./later";')).toEqual(["./later"]);
    });
  });

  describe("stringLiteral", () => {
    it("strips the quotes from a string or template token and nothing else", () => {
      expect(stringLiteral('"a"')).toBe("a");
      expect(stringLiteral("'a'")).toBe("a");
      expect(stringLiteral("`a`")).toBe("a");
      expect(stringLiteral("a")).toBeUndefined();
      expect(stringLiteral(undefined)).toBeUndefined();
    });
  });

  describe("reExportSpecifiers", () => {
    it("reads the specifier off every re-export spelling", () => {
      expect(reExportSpecifiers('export { GET } from "./impl";')).toEqual(["./impl"]);
      expect(reExportSpecifiers('export { A, B as C } from "./impl";')).toEqual(["./impl"]);
      expect(reExportSpecifiers('export type { Props } from "./types";')).toEqual(["./types"]);
      expect(reExportSpecifiers('export * from "./impl";')).toEqual(["./impl"]);
      expect(reExportSpecifiers('export * as ns from "./impl";')).toEqual(["./impl"]);
      expect(reExportSpecifiers('export { default } from "./impl";')).toEqual(["./impl"]);
    });

    it("keeps every edge in source order, not just the first", () => {
      const source = 'export * from "./a";\nexport { default } from "./b";\nexport const own = 1;';
      expect(reExportSpecifiers(source)).toEqual(["./a", "./b"]);
    });

    it("lists nothing for a spelling that names no module", () => {
      expect(reExportSpecifiers("export { A, B as C };")).toEqual([]);
      expect(reExportSpecifiers("export const X = 1;\nexport default function Page() {}")).toEqual(
        [],
      );
      // A `from` inside a string or a comment is not a re-export.
      expect(reExportSpecifiers('const s = "export { A } from \\"./nope\\"";')).toEqual([]);
      expect(reExportSpecifiers('// export * from "./nope"\nexport const X = 1;')).toEqual([]);
    });
  });
});

describe("readTestSources", () => {
  it("reads the test files on demand instead of eagerly globbing the whole tree", () => {
    // Reading from disk rather than through an eager `?raw` glob is the whole
    // point of this reader: an eager glob makes Vite read and register every test
    // file for each file that imports this module. Assert the decision on the
    // source so an edit that reintroduces the glob fails here rather than only
    // quietly costing collect time.
    expect(sourceScanSource).not.toMatch(/\.\.\/\*\*\/\*\.test\.ts/);
    expect(sourceScanSource).toContain("readFileSync");
  });

  it("reaches the suite's own test files, keyed by their path, and caches them", () => {
    const sources = readTestSources();
    expect(Object.keys(sources).length, "no test sources were read").toBeGreaterThan(20);
    expect(Object.keys(sources).some((path) => path.endsWith("render.test.ts"))).toBe(true);
    // A second call returns the same record rather than walking and reading again.
    expect(readTestSources()).toBe(sources);
  });
});
