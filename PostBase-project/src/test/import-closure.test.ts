import { describe, expect, it } from "vitest";
import { importClosure } from "../../.freebuff/import-closure.mjs";

/**
 * The import closure the runner folds into each script-backed stage's key, and
 * the invariant case in `ci-runner.test.ts` reads through. The walker is the
 * mechanism, so this file pins *the derivation itself* — what it reaches, what
 * it deliberately cannot see, and what it does at the edges — with fixtures
 * rather than against the real gate scripts, whose import graph changes with
 * every pass. A case here failing means the key derivation shifted, and the
 * runner's keys moved with it.
 */

/** A fixture tree, keyed by repo-relative path. */
type Tree = Record<string, string>;

const read = (tree: Tree) => (name: string) => tree[name];

describe("the gate-script import closure", () => {
  it("reaches the script itself and its transitive imports", () => {
    const closure = importClosure("gate.mjs", read({ "gate.mjs": `import "./helper.mjs";` }));
    expect([...closure]).toEqual(["gate.mjs", "helper.mjs"]);
  });

  it("walks imports of imports, memoizing diamonds to one pass", () => {
    const tree: Tree = {
      "gate.mjs": `import "./a.mjs";\nimport "./b.mjs";`,
      "a.mjs": `import { save } from "./shared.mjs";`,
      "b.mjs": `import { save } from "./shared.mjs";`,
      "shared.mjs": `export const save = 1;`,
    };
    // Discovery order: depth-first from each import in turn, so the diamond's
    // shared module lands where the first leg reached it.
    expect([...importClosure("gate.mjs", read(tree))]).toEqual([
      "gate.mjs",
      "a.mjs",
      "shared.mjs",
      "b.mjs",
    ]);
  });

  it("reads double-quoted static imports and dynamic import() calls", () => {
    const tree: Tree = {
      "gate.mjs": [
        `import "./one.mjs";`,
        `import { x } from "./two.mjs";`,
        `import("./three.mjs");`,
        `export * from "./four.mjs";`,
      ].join("\n"),
      "one.mjs": "",
      "two.mjs": "",
      "three.mjs": "",
      "four.mjs": "",
    };
    // Discovery order: the statements in turn, each specifier joined where the
    // statement stands.
    expect([...importClosure("gate.mjs", read(tree))]).toEqual([
      "gate.mjs",
      "one.mjs",
      "two.mjs",
      "three.mjs",
      "four.mjs",
    ]);
  });

  it("does not read a single-quoted specifier, which lint keeps out of the tree", () => {
    // The walk reads the quote style this repository writes (double, enforced
    // by the lint stage's own config) and no other. A single-quoted import in a
    // gate script would be invisible to the keys — which is why the convention
    // is enforced rather than assumed: an import lint would flag before a key
    // could silently miss it.
    const tree: Tree = {
      "gate.mjs": [`import './single.mjs';`, `import "./double.mjs";`].join("\n"),
      "single.mjs": "",
      "double.mjs": "",
    };
    expect([...importClosure("gate.mjs", read(tree))]).toEqual(["gate.mjs", "double.mjs"]);
  });

  it("does not read prose about a module as an import of one", () => {
    const tree: Tree = {
      "gate.mjs": [
        "// saves through `./whole-write.mjs` — a comment, not an import",
        "/* also mentions ./other.mjs in a block",
        " * and ./another.mjs in its body",
        " */",
        "import { saveWholeScript } from \"./real.mjs\";",
      ].join("\n"),
      "real.mjs": "",
    };
    expect([...importClosure("gate.mjs", read(tree))]).toEqual(["gate.mjs", "real.mjs"]);
  });

  it("does not follow bare, absolute, extensionless or non-.mjs specifiers", () => {
    const tree: Tree = {
      "gate.mjs": [
        `import { createHash } from "node:crypto";`,
        `import react from "react";`,
        `import "/absolute/path.mjs";`,
        `import "./side-effect";`,
        `import "./types.d.ts";`,
        `import { x } from "./real.mjs";`,
      ].join("\n"),
      "real.mjs": "",
    };
    expect([...importClosure("gate.mjs", read(tree))]).toEqual(["gate.mjs", "real.mjs"]);
  });

  it("is blind to a computed import, by contract", () => {
    // The one load this project does this way is the pin manifest, read by the
    // drift alarm as `import(pathToFileURL(manifest))` — named by the drift
    // stage's `inputs` directly, because no walk can see it. Pinning the
    // blindness here is what makes that by-name assertion mean something.
    const tree: Tree = {
      "gate.mjs": [
        `const url = pathToFileURL("./manifest.mjs");`,
        `const mod = await import(url);`,
        `import "./seen.mjs";`,
      ].join("\n"),
      "manifest.mjs": "",
      "seen.mjs": "",
    };
    expect([...importClosure("gate.mjs", read(tree))]).toEqual(["gate.mjs", "seen.mjs"]);
  });

  it("keeps an unreadable script, and stops there", () => {
    // A file that cannot be read still contributes itself — the specifier is
    // the fact the key is about — but nothing further can be known.
    expect([...importClosure("gone.mjs", read({}))]).toEqual(["gone.mjs"]);
  });

  it("resolves nested relative specifiers, including dot-dot", () => {
    const tree: Tree = {
      "gate.mjs": `import "./lib/nested/helper.mjs";`,
      "lib/nested/helper.mjs": `import "../sibling.mjs";`,
      "lib/sibling.mjs": `import "../../root.mjs";`,
      "root.mjs": "",
    };
    expect([...importClosure("gate.mjs", read(tree))]).toEqual([
      "gate.mjs",
      "lib/nested/helper.mjs",
      "lib/sibling.mjs",
      "root.mjs",
    ]);
  });

  it("is deterministic across repeat walks of the same tree", () => {
    const tree: Tree = {
      "gate.mjs": `import "./a.mjs";\nimport "./b.mjs";`,
      "a.mjs": `import "./shared.mjs";`,
      "b.mjs": `import "./shared.mjs";`,
      "shared.mjs": "",
    };
    const first = [...importClosure("gate.mjs", read(tree))];
    const second = [...importClosure("gate.mjs", read(tree))];
    expect(first).toEqual(second);
  });
});
