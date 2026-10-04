/// <reference types="vite/client" />
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WholeScriptError,
  assertWholeScript,
  isScriptPath,
  pinnedGateScripts,
  saveWholeScript,
  toRel,
  unbalancedIssues,
} from "../../.freebuff/whole-write.mjs";

/**
 * The save that refuses to leave a pinned gate script unreadable.
 *
 * `whole-write.mjs` is the stub four writers now route their *introducing* write through: the
 * preflight sweep, the guard sweep, the coverage mutator and the baseline applier. Its job is
 * narrow and its failure modes are both expensive, so it is pinned from four directions here.
 *
 * The scanner is pinned by **shape**: every way a write can stop early (an open delimiter, an
 * open string, an open template, an open block comment, a closer with nothing to close) has a
 * case, and so does every way a delimiter can be *text rather than code* — inside a string,
 * inside a template, inside a comment, inside a regex, or as part of a `${}` — because a
 * counter that miscounts those would refuse a good file, and a guard that refuses good saves
 * gets turned off. The tolerance cases matter as much as the refusals, so both lists are read
 * against the same function.
 *
 * The tree is pinned by **reading**: every pinned gate script on disk is scanned, so this file
 * is also the always-on half of `--check` — the part that runs in the default suite rather
 * than only when somebody runs the command. And the wiring is pinned as source, the way the
 * applier's own `git add`/`repin` coupling already is, so a writer that quietly goes back to
 * a bare `writeFileSync` is a red case rather than a silent opt-out.
 */
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const guard = path.join(projectRoot, ".freebuff", "whole-write.mjs");
const pinned: string[] = pinnedGateScripts();

const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);

const scratch = mkdtempSync(path.join(tmpdir(), "whole-write-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args: string[]) =>
  spawnSync(process.execPath, [guard, ...args], { cwd: projectRoot, encoding: "utf8" });

/** Text that balances — including the shapes that fool a delimiter counter. */
const WHOLE = [
  "const o = { a: 1, b: [2, 3] };",
  "const o = { a: 1, };",
  'const s = "}";',
  "const s = '}';",
  "const t = " + BT + "a ${x ? " + BT + "b" + BT + ' : "}"} c' + BT + ";",
  "const r = /}/g;",
  "const r = /[)]/;",
  "const r = /a(b/;",
  "return /}/.test(x);",
  "typeof /)/;",
  "if (a) b = c / d;",
  "const n = 1_000 / 2;",
  "// a } and a { here",
  "/* { } ( */",
  "const esc = " + '"' + BS + '"}' + '";',
  "const t = " + BT + "a" + BS + "${notAnExpr}" + BT + ";",
  "f(a)(b);",
  "class A { #x = 1; }",
  "x = y?.z ?? w;",
];

/** Text that stopped early, or closed what it never opened, with the guard's own words. */
const HALF_WRITTEN: { text: string; message: string }[] = [
  { text: "function f() {", message: "a '{' opened here is never closed" },
  { text: "const x = (1 + 2", message: "a '(' opened here is never closed" },
  { text: "const x = [1, 2", message: "a '[' opened here is never closed" },
  { text: "}", message: "a '}' here closes no '{'" },
  { text: 'const s = "abc', message: 'a "-quoted string is never closed' },
  { text: "/* comment", message: "a block comment is never closed" },
  { text: "const t = " + BT + "a${b", message: "a `-quoted template is never closed" },
  { text: "const r = /abc", message: "a regular expression is never closed" },
  { text: "function f() { return 1;", message: "a '{' opened here is never closed" },
];

describe("the whole-write guard's reading of script text", () => {
  it("sees a file as whole however its delimiters are nested", () => {
    for (const text of WHOLE) {
      expect(unbalancedIssues(text), text).toEqual([]);
    }
  });

  it("refuses every way a write can stop early, naming where", () => {
    for (const { text, message } of HALF_WRITTEN) {
      const issues = unbalancedIssues(text);
      expect(issues.length, text).toBeGreaterThan(0);
      expect(issues[0].message, text).toContain(message);
    }
  });

  it("reads a `/` after a value as a division and after a keyword as a regex", () => {
    // The one call a character scanner cannot make alone. Both readings have to be right: a
    // regex read as code can open a delimiter nobody closed, and a division read as a regex
    // can swallow the closer that mattered.
    expect(unbalancedIssues("const half = whole / 2;")).toEqual([]);
    expect(unbalancedIssues("return /}/.test(x);")).toEqual([]);
    expect(unbalancedIssues("const r = /}/g;")).toEqual([]);
  });

  it("counts empty text as not whole, wherever it is asked", () => {
    for (const text of ["", "   ", "\n\n"]) {
      expect(() => assertWholeScript(text, "scratch.mjs")).toThrow(WholeScriptError);
    }
  });
});

describe("the save that refuses", () => {
  it("refuses a pinned script whose text is not whole, and writes nothing", () => {
    const file = path.join(scratch, "gate.mjs");
    writeFileSync(file, "export const good = 1;\n");
    const before = readFileSync(file, "utf8");

    expect(() => saveWholeScript(file, "export const broken = {", { pinned: [toRel(file)] })).toThrow(
      WholeScriptError,
    );
    // The point of the guard: the bad text never landed, so the file still reads.
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("writes a pinned script whose text is whole, and says that it guarded it", () => {
    const file = path.join(scratch, "gate2.mjs");
    const result = saveWholeScript(file, "export const a = 1;\n", { pinned: [toRel(file)] });
    expect(result).toEqual({ guarded: true, path: toRel(file) });
    expect(readFileSync(file, "utf8")).toBe("export const a = 1;\n");
  });

  it("writes a file the manifest does not pin without standing in its way", () => {
    const file = path.join(scratch, "route.ts");
    const result = saveWholeScript(file, "export const half = {", { pinned: [] });
    expect(result.guarded).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("export const half = {");
  });
});

describe("every pinned gate script on disk", () => {
  it("is the manifest's own list, filtered to text a program can be", () => {
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned).toEqual([...pinned].sort());
    for (const rel of pinned) expect(isScriptPath(rel), rel).toBe(true);
  });

  it("balances right now, every one of them", () => {
    // The always-on half of `--check`: this runs in the default suite, so a truncation that
    // lands outside any writer — an editor, a crash, a kill — is a red case here rather than
    // only when somebody remembers the command.
    const unbalanced = pinned
      .map((rel) => ({ rel, issues: unbalancedIssues(readFileSync(path.join(projectRoot, rel), "utf8")) }))
      .filter((row) => row.issues.length > 0);

    expect(
      unbalanced.map((row) => row.rel),
      "a pinned gate script on disk does not balance — an interrupted write landed, or a writer " +
        "bypassed the guard; run `node .freebuff/whole-write.mjs --check`",
    ).toEqual([]);
  });
});

describe("the check as a command", () => {
  it("--list names the pinned set, and --json counts it", () => {
    const result = run(["--list", "--json"]);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { count: number; scripts: string[] };
    expect(payload.count).toBe(pinned.length);
    expect(payload.scripts).toEqual(pinned);
  });

  it("--check refuses a file that does not balance and passes one that does", () => {
    const bad = path.join(scratch, "truncated.mjs");
    writeFileSync(bad, "export function half() {");
    const refused = run(["--check", bad]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("not whole");
    expect(refused.stdout).toContain("is never closed");

    const good = path.join(scratch, "complete.mjs");
    writeFileSync(good, "export function whole() { return 1; }\n");
    const passed = run(["--check", good]);
    expect(passed.status).toBe(0);
  });
});

describe("the writers of a pinned script", () => {
  // Which call each writer uses is a fact about the source, read here rather than assumed: a
  // writer that goes back to a bare `writeFileSync` is the opt-out this guard exists to make
  // visible. The sweeps and the coverage mutator *check* first, because each holds a lock that
  // must go down only once the text is known good; the applier, which holds no lock, saves
  // through the stub itself.
  const WRITERS = [
    { file: ".freebuff/mutation-preflight.mjs", call: "saveWholeScript(" },
    { file: ".freebuff/mutation-guards.mjs", call: "saveWholeScript(" },
    { file: "src/test/coverage-mutation.test.ts", call: "assertWholeScript(" },
    { file: ".freebuff/apply-collect-baselines.mjs", call: "saveWholeScript(" },
    // Not a writer of a pinned script, but the other place a truncated copy could become a
    // pin's reference: the drift alarm stashes every matched file's text as the diff cache,
    // so its stash path must read the guard too — a copy that would not balance must be
    // refused before it lands beside the pin.
    { file: ".freebuff/gate-drift.mjs", call: "assertWholeScript(" },
  ];

  it("each names the guard, and calls it", () => {
    for (const writer of WRITERS) {
      const source = readFileSync(path.join(projectRoot, writer.file), "utf8");
      expect(source, `${writer.file} must import the guard`).toContain("whole-write.mjs");
      expect(source, `${writer.file} must call ${writer.call}`).toContain(writer.call);
    }
  });
});
