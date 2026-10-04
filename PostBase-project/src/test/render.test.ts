/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { mountSurface } from "@/test/render";
import { bodyClearIndex, cleanupProblem, rawMountCalls } from "@/test/convention-guards";
import { readTestSources } from "@/test/source-scan";

/**
 * There is one way a test mounts a surface, enforced three times.
 *
 * `mountSurface` wraps a private `mount` and owns the two things every
 * direct-mount test was otherwise repeating by hand: the provider tree the app
 * mounts the surface in, and the teardown. A test that reaches for the
 * primitive instead re-opens the gap this file exists to close — a surface
 * mounted outside the providers the app uses, or an unmount that leaks when the
 * test throws.
 *
 * Three guards, deliberately overlapping, because any one alone can be worked
 * around:
 *
 * 1. The type test keeps `mount` out of the module's exports. It fails the
 *    typecheck the moment the primitive is exported again — but a test could
 *    still declare its own `mount` helper, which is the boilerplate this whole
 *    convention replaced.
 * 2. The text scan reads every test file and fails on a direct `mount()` call,
 *    whatever it resolves to. It is the one that keeps the *call shape* from
 *    creeping back in a new test, in the same spirit as the settle and runbook
 *    drift tests — the convention is checked by a test rather than trusted to
 *    review.
 * 3. A second text scan reads every file that mounts a surface and fails one
 *    whose `afterEach` never calls `cleanupSurfaces()`, or empties
 *    `document.body` before it does — whether the two statements share a hook
 *    or sit in separate ones. `mountSurface` makes the teardown the file's to
 *    own; a file that mounts without it is a leak the end-of-test check would
 *    have to catch, and this says so where the file is written rather than only
 *    when it runs. The ordering half matters because a Radix portal is a child
 *    of the body — clearing first makes React's own teardown throw, so the
 *    mistake is worth naming before it has to be diagnosed. The scan follows
 *    run order for that: `afterEach` hooks run in reverse registration order,
 *    so a clear in a *later* declared hook runs before an earlier one's
 *    cleanup, which is exactly the throw this catches.
 *
 * The reading comes from `@/test/source-scan` and the detectors from
 * `@/test/convention-guards`, shared with the other convention guards (the
 * settle scan, the stylesheet scan) so each states the rule it enforces rather
 * than re-deriving the detector.
 */
const testSources = readTestSources();

/** This file names the forbidden shape to describe it; it is not scanned. */
const SELF = "render.test.ts";

/*
 * The detectors these guards run live in `@/test/convention-guards`, alongside
 * the other convention guards, so one meta-test can drive them all. This file
 * keeps the assertions: which files are scanned and what the rule means.
 */

/** Test files that mount a surface, so their teardown is worth checking. */
const mountingFiles = Object.entries(testSources).filter(
  ([path, source]) => !path.includes(SELF) && source.includes("mountSurface("),
);

describe("how a test mounts a surface", () => {
  test("the primitive is not exported, so mountSurface is the only way in", () => {
    // @ts-expect-error `mount` is the primitive `mountSurface` wraps, kept out of the exports.
    const primitive: typeof import("@/test/render").mount = null as never;
    expect(primitive).toBeNull();
  });

  test("mountSurface is the exported entry point", () => {
    expect(typeof mountSurface).toBe("function");
  });

  test("the glob reached the test files, so the scan is not silently empty", () => {
    const mounted = Object.entries(testSources).filter(([path, source]) =>
      source.includes("@/test/render") && !path.includes(SELF),
    );
    expect(Object.keys(testSources).length, "no test sources matched the glob").toBeGreaterThan(20);
    expect(mounted.length, "the glob did not reach the mounted DOM tests").toBeGreaterThan(3);
  });

  test("no test file calls the raw mount() directly", () => {
    const offenders = Object.entries(testSources)
      .filter(([path]) => !path.includes(SELF))
      .flatMap(([path, source]) => rawMountCalls(source).map((line) => `${path}:${line}`));

    expect(
      offenders,
      "These tests mount through the raw `mount()` instead of `mountSurface`, which re-opens the " +
        "boilerplate the helper exists to own: the provider tree the app mounts a surface in, and " +
        "the teardown. Mount through `mountSurface` and name only the providers it needs.",
    ).toEqual([]);
  });

  test("fires on the shape it exists to catch", () => {
    // A guard only ever run against a clean tree is a guard never shown to fire.
    const direct = [
      "test('x', async () => {",
      "  const ui = mount(<Foo />);",
      "});",
    ].join("\n");
    expect(rawMountCalls(direct)).toEqual([2]);

    // The legitimate spellings, stated once: the helper, an unmount of a
    // captured handle, a *member* call that happens to be named `mount` — the scan
    // reads the bare name the helper is imported as, so a call reached through an
    // object is a different thing, whatever that object's method does — and the
    // word "mount" on its own are all left alone.
    const throughTheHelper = [
      "  const ui = mountSurface(<MainNav />, { providers: 'theme+tooltip' });",
      "  admin.unmount();",
      "  panel.mount(<PageList />);",
      "  // Mount through mountSurface so the providers and teardown are not repeated.",
    ].join("\n");
    expect(rawMountCalls(throughTheHelper)).toEqual([]);
  });

  test("leaves a member call named mount alone, and still catches the bare one", () => {
    // The member-call exclusion is a decision of its own — the `.` before `mount` is what
    // reads "a different thing entirely" — so it is asked on its own here rather than only
    // among the legitimate spellings in the case above: a scan that lost the exclusion
    // flags `panel.mount(…)` for reaching a method through an object, and this is the case
    // that notices. It is a fixture rather than a patch because the tree holds none: no
    // real test file calls a member named `mount`, and that legality in a real file is the
    // promise this half makes.
    const memberCalls = [
      "  panel.mount(<PageList />);",
      "  harness.mount(<FeedPage />);",
      "  view.mount();",
    ].join("\n");
    expect(rawMountCalls(memberCalls)).toEqual([]);

    // …and the silence is the exclusion rather than a detector gone blind: the bare call
    // beneath them is still reported, on the line it is written.
    const withTheBareOne = `${memberCalls}\n  const ui = mount(<Foo />);`;
    expect(rawMountCalls(withTheBareOne)).toEqual([4]);
  });

  test("every file that mounts a surface cleans up in an afterEach, before it clears the body", () => {
    expect(
      mountingFiles.length,
      "the scan found no mounting files, so it is checking nothing",
    ).toBeGreaterThan(3);

    const offenders = mountingFiles
      .map(([path, source]) => [path, cleanupProblem(source)] as const)
      .filter(([, problem]) => problem !== null)
      .map(([path, problem]) => `${path} — ${problem}`);

    expect(
      offenders,
      "These files mount a surface but get the teardown wrong. Call `cleanupSurfaces()` in an " +
        "`afterEach`, and call it before anything clears `document.body` — a Radix portal is a " +
        "child of the body, so clearing first makes React's own teardown throw. Hooks run in " +
        "reverse registration order, so if the cleanup and the clear are in different hooks, " +
        "declare the cleanup last. A file that mounts without cleaning up is a leak the " +
        "end-of-test check has to catch, which is worse than catching it here.",
    ).toEqual([]);
  });

  test("the body-clear detector matches each spelling in isolation", () => {
    // The detector is exercised one spelling at a time, so a pattern that stops
    // matching names itself rather than hiding behind a cleanup ordering that
    // still trips for another reason.
    const spellings: Array<[string, string]> = [
      ["innerHTML assignment", 'document.body.innerHTML = "";'],
      ["outerHTML assignment", 'document.body.outerHTML = "";'],
      ["textContent assignment", 'document.body.textContent = "";'],
      ["replaceChildren", "document.body.replaceChildren();"],
      ["detaching the body", "document.body.remove();"],
      ["removing a child", "document.body.removeChild(node);"],
      ["childNodes sweep", "document.body.childNodes.forEach((node) => node.remove());"],
      ["children sweep", "document.body.children.forEach((node) => node.remove());"],
      ["firstChild sweep", "while (document.body.firstChild) document.body.firstChild.remove();"],
      ["lastChild sweep", "while (document.body.lastChild) document.body.lastChild.remove();"],
      ["firstElementChild sweep", "document.body.firstElementChild.remove();"],
      ["lastElementChild sweep", "document.body.lastElementChild.remove();"],
    ];

    for (const [name, source] of spellings) {
      expect(bodyClearIndex(source), `${name} should read as a body clear`).toBeGreaterThanOrEqual(0);
    }
  });

  test("the body-clear detector leaves each harmless read alone", () => {
    // Naming the body without emptying it is not the mistake the scan hunts.
    const reads: Array<[string, string]> = [
      ["bare childNodes", "const nodes = document.body.childNodes;"],
      ["spread childNodes", "const nodes = [...document.body.childNodes];"],
      ["textContent fallback", 'const text = document.body.textContent ?? "";'],
      ["strict innerHTML compare", 'expect(document.body.innerHTML === "").toBe(true);'],
      ["loose innerHTML compare", 'expect(document.body.innerHTML == "").toBe(true);'],
      ["strict inequality", 'expect(document.body.textContent !== "").toBe(true);'],
      ["appending to the body", "document.body.append(container);"],
      ["removing from another element", "container.childNodes.forEach((node) => node.remove());"],
      ["reading the body's length", "expect(document.body.children.length).toBe(0);"],
    ];

    for (const [name, source] of reads) {
      expect(bodyClearIndex(source), `${name} should not read as a body clear`).toBe(-1);
    }
  });

  test("the body-clear sweep is bounded by the statement, not the first semicolon", () => {
    // A genuine sweep calls `.remove(` on the collection it just read, in the
    // same statement. That is the boundary: the walk may cross a callback's
    // braces, newlines and inner `;`, but stops at a `;` in the outer statement.
    const sweeps: Array<[string, string]> = [
      ["forEach over childNodes", "document.body.childNodes.forEach((node) => node.remove());"],
      ["forEach with a guarded body", "document.body.children.forEach((node) => { if (node) node.remove(); });"],
      ["for-of over children", "for (const node of document.body.children) node.remove();"],
      ["while over firstChild", "while (document.body.firstChild) document.body.firstChild.remove();"],
      // The callback does real work before it removes — the `;` after that work
      // is inside the callback, so it must not end the sweep.
      [
        "forEach that logs before removing",
        "document.body.childNodes.forEach((node) => {\n  console.log(node.id);\n  node.remove();\n});",
      ],
      [
        "forEach that removes after a check",
        "document.body.children.forEach((node) => {\n  if (node.hidden) return;\n  node.remove();\n});",
      ],
      [
        "for-of that removes in a braced body",
        "for (const node of document.body.childNodes) {\n  account(node);\n  node.remove();\n}",
      ],
      // A sweep of a *copy* still removes the body's children.
      ["sweep of a copied list", "[...document.body.childNodes].forEach((node) => node.remove());"],
    ];
    for (const [name, source] of sweeps) {
      expect(bodyClearIndex(source), `${name} should read as a body clear`).toBeGreaterThanOrEqual(0);
    }

    // A read that ends its statement before an unrelated `.remove(` is the
    // false positive the outermost terminator rules out — whether the read is a
    // bare reference or the collection a callback only reads.
    const reads: Array<[string, string]> = [
      ["read then a later remove", "const nodes = document.body.childNodes;\ncard.remove();"],
      [
        "read then a realistic later remove",
        'const nodes = document.body.childNodes;\nconst card = document.querySelector(".card");\ncard.remove();',
      ],
      [
        "callback that only reads",
        "document.body.childNodes.forEach((node) => {\n  record(node);\n});\ncard.remove();",
      ],
    ];
    for (const [name, source] of reads) {
      expect(bodyClearIndex(source), `${name} should not read as a body clear`).toBe(-1);
    }
  });

  test("the body-clear sweep respects semicolon-less statement boundaries", () => {
    // Without a `;` to lean on, the sweep walk has to treat a newline as the end
    // of a statement — otherwise a bare read on one line and an unrelated
    // `.remove(` on the next would look like a sweep. A genuine sweep written
    // without semicolons has to stay caught all the same.
    const sweeps: Array<[string, string]> = [
      ["one-line forEach, no semicolon", "document.body.childNodes.forEach((node) => node.remove())"],
      [
        "multi-line callback, no semicolons",
        "document.body.childNodes.forEach((node) => {\n  console.log(node.id)\n  node.remove()\n})",
      ],
      [
        "chained call on the next line",
        "document.body.childNodes\n  .forEach((node) => node.remove())",
      ],
      ["while over firstChild, no semicolon", "while (document.body.firstChild) document.body.firstChild.remove()"],
      ["for-of over children, no semicolon", "for (const node of document.body.children) node.remove()"],
    ];
    for (const [name, source] of sweeps) {
      expect(bodyClearIndex(source), `${name} should read as a body clear`).toBeGreaterThanOrEqual(0);
    }

    const reads: Array<[string, string]> = [
      ["read then an unrelated remove", "const nodes = document.body.childNodes\ncard.remove()"],
      ["bare read then an unrelated remove", "document.body.childNodes\ncard.remove()"],
      [
        "callback that only reads, no semicolons",
        "document.body.childNodes.forEach((node) => {\n  record(node)\n})\ncard.remove()",
      ],
      [
        "length read then an unrelated remove",
        "expect(document.body.children.length).toBe(0)\ncard.remove()",
      ],
      ["trailing comment then an unrelated remove", "const nodes = document.body.childNodes // snapshot\ncard.remove()"],
    ];
    for (const [name, source] of reads) {
      expect(bodyClearIndex(source), `${name} should not read as a body clear`).toBe(-1);
    }
  });

  test("the body-clear sweep crosses a brace-less loop body", () => {
    // ASI does not end a `for`/`while` statement at the loop head: the body is a
    // *required* statement, so a brace-less body on the next line is part of the
    // loop. A walk that stopped at that newline read the removal as an unrelated
    // statement and missed the sweep.
    const sweeps: Array<[string, string]> = [
      ["brace-less for-of over children", "for (const node of document.body.children)\n  node.remove()"],
      ["brace-less for-of over childNodes", "for (const node of document.body.childNodes)\n  node.remove()"],
      [
        "brace-less while over firstChild",
        "while (document.body.firstChild)\n  document.body.firstChild.remove()",
      ],
      [
        "brace-less for-of with a braced body",
        "for (const node of document.body.children) {\n  node.remove()\n}",
      ],
      [
        "brace-less body that does more first",
        "for (const node of document.body.childNodes)\n  if (node) node.remove()",
      ],
    ];
    for (const [name, source] of sweeps) {
      expect(bodyClearIndex(source), `${name} should read as a body clear`).toBeGreaterThanOrEqual(0);
    }

    // The loop keyword has to belong to *this* statement. A read that ends
    // before an unrelated loop — even one that removes — is not a sweep.
    const reads: Array<[string, string]> = [
      [
        "read then a loop that removes its own list",
        "const nodes = document.body.childNodes\nfor (const card of cards) card.remove()",
      ],
      [
        "read then a brace-less loop over a list built elsewhere",
        "const nodes = document.body.childNodes\nconst list = cards\nfor (const node of list)\n  node.remove()",
      ],
    ];
    for (const [name, source] of reads) {
      expect(bodyClearIndex(source), `${name} should not read as a body clear`).toBe(-1);
    }
  });

  test("the body-clear sweep reaches a copy of the body's children", () => {
    // A teardown often copies the children out first and sweeps the copy, so the
    // removal names a local list rather than `document.body`. The scan follows
    // one declaration: the list it binds to the body's children is treated as a
    // collection reference wherever it is swept.
    const sweeps: Array<[string, string]> = [
      [
        "copy then forEach",
        "const nodes = document.body.childNodes;\nnodes.forEach((node) => node.remove());",
      ],
      [
        "spread copy then forEach",
        "const nodes = [...document.body.childNodes];\nnodes.forEach((node) => node.remove());",
      ],
      [
        "copy then brace-less for-of",
        "const nodes = document.body.childNodes;\nfor (const node of nodes) node.remove();",
      ],
      [
        "children copy then for-of",
        "const children = document.body.children;\nfor (const child of children) child.remove();",
      ],
      [
        "Array.from copy then forEach",
        "const nodes = Array.from(document.body.childNodes);\nnodes.forEach((node) => node.remove());",
      ],
      [
        "copy removed through an index",
        "const nodes = document.body.childNodes;\nfor (let i = 0; i < nodes.length; i += 1) nodes[i].remove();",
      ],
      [
        "copy swept across lines, no semicolons",
        "const nodes = [...document.body.childNodes]\nfor (const node of nodes)\n  node.remove()",
      ],
    ];
    for (const [name, source] of sweeps) {
      expect(bodyClearIndex(source), `${name} should read as a body clear`).toBeGreaterThanOrEqual(0);
    }

    // Only a list actually built from the body is followed. A list built
    // elsewhere — even one swept the same way — is not a body clear, and a copy
    // that is only read is not either.
    const reads: Array<[string, string]> = [
      ["a list built elsewhere", "const cards = makeCards();\ncards.forEach((card) => card.remove());"],
      [
        "a body copy that is only read",
        "const nodes = [...document.body.childNodes];\nconsole.log(nodes.length);",
      ],
      [
        "a body copy then an unrelated remove",
        'const nodes = document.body.childNodes;\nconst card = document.querySelector(".card");\ncard.remove();',
      ],
      [
        "a copy of a copy is not followed",
        "const nodes = document.body.childNodes;\nconst copy = [...nodes];\ncopy.forEach((node) => node.remove());",
      ],
    ];
    for (const [name, source] of reads) {
      expect(bodyClearIndex(source), `${name} should not read as a body clear`).toBe(-1);
    }
  });

  test("the body-clear scan's known approximations are pinned", () => {
    // The tokenizer is deliberately approximate, so each approximation is
    // stated and asserted here rather than left to drift. The runtime leak
    // check still catches the failure a missed clear would hide.

    // An escaped quote is consumed as part of the string, so neither a string's
    // own punctuation nor a sweep named only in its text leaks out.
    const assignmentWithEscapes = 'document.body.innerHTML = "a \\"quoted\\" word";';
    expect(
      bodyClearIndex(assignmentWithEscapes),
      "an escaped quote in the cleared value should not hide the clear",
    ).toBeGreaterThanOrEqual(0);
    const escapedQuoteThenSweepText =
      'const s = "\\"; document.body.childNodes.forEach((n) => n.remove())";';
    expect(
      bodyClearIndex(escapedQuoteThenSweepText),
      "a sweep named only inside a string should not read as a body clear",
    ).toBe(-1);

    // A template literal is one token, so its literal text is inert — and, the
    // documented gap, so is anything in a `${…}` substitution.
    const templateInAValue = "document.body.innerHTML = `x; { } y`;";
    expect(
      bodyClearIndex(templateInAValue),
      "a template in the cleared value should not hide the clear",
    ).toBeGreaterThanOrEqual(0);
    const templateNamingASweep = "const t = `document.body.childNodes.forEach((n) => n.remove())`;";
    expect(
      bodyClearIndex(templateNamingASweep),
      "a sweep named only inside a template should not read as a body clear",
    ).toBe(-1);

    // A block comment is dropped, so a brace or `;` inside it cannot end the
    // statement, and a `.remove(` inside it is not a call.
    const commentWithBrackets = [
      "document.body.childNodes.forEach((node) => {",
      "  /* } ; { */",
      "  node.remove();",
      "});",
    ].join("\n");
    expect(
      bodyClearIndex(commentWithBrackets),
      "a sweep whose callback carries a bracket-laden comment should still read as a clear",
    ).toBeGreaterThanOrEqual(0);
    const commentNamingASweep =
      "/* document.body.childNodes.forEach((n) => n.remove()) */ const nodes = document.body.childNodes;";
    expect(
      bodyClearIndex(commentNamingASweep),
      "a sweep named only inside a comment should not read as a body clear",
    ).toBe(-1);

    // A regexp literal is not recognized: it tokenizes as `/` and ordinary
    // tokens. That is enough for the shapes the suite writes — a clear whose
    // statement contains one is still caught — but a body reference *inside* a
    // regexp is not an empty document.body.
    const sweepWithRegex =
      "document.body.childNodes.forEach((node) => { if (/[;{}]/.test(node.id)) node.remove(); });";
    expect(
      bodyClearIndex(sweepWithRegex),
      "a sweep whose callback tests a bracket-laden regexp should still read as a clear",
    ).toBeGreaterThanOrEqual(0);
    const regexNamingABody = "const re = /document\\.body\\.childNodes.*remove/;";
    expect(
      bodyClearIndex(regexNamingABody),
      "a body reference only inside a regexp should not read as a body clear",
    ).toBe(-1);

    // The scan keys on the token sequence `document.body`, so a local that
    // shadows `document` still reads as the global — the one false positive
    // worth naming, since the guard cannot see scopes.
    const shadowedDocument = 'const document = fake;\ndocument.body.innerHTML = "";';
    expect(
      bodyClearIndex(shadowedDocument),
      "a shadowed `document` is still read as the real one",
    ).toBeGreaterThanOrEqual(0);
  });

  test("the body-clear scan keeps no state between calls", () => {
    // The scan tokenizes from scratch each call, so nothing carries over from one
    // source to the next — the failure a shared, stateful matcher would
    // introduce. Each call has to stand on its own.
    const sweep = "document.body.childNodes.forEach((node) => node.remove());";
    const read = "const nodes = document.body.childNodes;";

    expect(bodyClearIndex(sweep), "the first sweep").toBeGreaterThanOrEqual(0);
    expect(bodyClearIndex(read), "a read after a sweep").toBe(-1);
    expect(bodyClearIndex(sweep), "a sweep after a read").toBeGreaterThanOrEqual(0);
    expect(bodyClearIndex(`${read}\n${sweep}`), "a read then a sweep").toBeGreaterThanOrEqual(0);
  });

  test("fires on the teardown shapes it exists to catch", () => {
    // A guard only ever run against a clean tree is a guard never shown to fire.
    const forgetful = 'test("x", () => { mountSurface(<Foo />); });';
    expect(cleanupProblem(forgetful)).toBe("never cleans up");

    // Cleanup present, but the body is emptied first — the ordering mistake.
    const reversed = [
      "afterEach(() => {",
      '  document.body.innerHTML = "";',
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(reversed)).toBe("clears the body before cleaning up");

    const reversedReplaceChildren = [
      "afterEach(() => {",
      "  document.body.replaceChildren();",
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(reversedReplaceChildren)).toBe("clears the body before cleaning up");

    // The less common spellings of the same mistake, each caught in turn.
    const reversedRemove = [
      "afterEach(() => {",
      "  document.body.remove();",
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(reversedRemove)).toBe("clears the body before cleaning up");

    const reversedRemoveChild = [
      "afterEach(() => {",
      "  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);",
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(reversedRemoveChild)).toBe("clears the body before cleaning up");

    const reversedChildSweep = [
      "afterEach(() => {",
      "  document.body.childNodes.forEach((node) => node.remove());",
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(reversedChildSweep)).toBe("clears the body before cleaning up");

    // Harmless *reads* of the body must not look like a clear.
    const bodyReads = [
      "afterEach(() => {",
      '  const text = document.body.textContent ?? "";',
      "  const nodes = [...document.body.childNodes];",
      '  expect(document.body.innerHTML === "").toBe(true);',
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(bodyReads)).toBeNull();

    const tidy = [
      "afterEach(() => {",
      "  cleanupSurfaces();",
      '  document.body.innerHTML = "";',
      "});",
    ].join("\n");
    expect(cleanupProblem(tidy)).toBeNull();

    // A parenthesised string in the callback must not unbalance the scan.
    const tidyWithParen = [
      "afterEach(() => {",
      "  cleanupSurfaces();",
      '  expect(")").toBe(")");',
      "});",
    ].join("\n");
    expect(cleanupProblem(tidyWithParen)).toBeNull();

    // Split across hooks, the order hinges on registration: the later hook runs
    // first, so cleanup declared first is torn down after the body is cleared.
    const splitReversed = [
      "afterEach(() => {",
      "  cleanupSurfaces();",
      "});",
      "afterEach(() => {",
      '  document.body.innerHTML = "";',
      "});",
    ].join("\n");
    expect(cleanupProblem(splitReversed)).toBe("clears the body before cleaning up");

    // The same split the other way round is fine: cleanup is declared last, so
    // it runs first and the clear that follows cannot strand a portal.
    const splitTidy = [
      "afterEach(() => {",
      '  document.body.innerHTML = "";',
      "});",
      "afterEach(() => {",
      "  cleanupSurfaces();",
      "});",
    ].join("\n");
    expect(cleanupProblem(splitTidy)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

/**
 * One substitution in a real file's own text, which must land exactly once.
 *
 * These cases patch a file the scan actually reads rather than a shape written for the
 * test, so the anchor is what keeps them honest: a file that has been renamed or
 * refactored out from under the shape fails the case instead of leaving a patch that
 * changed nothing and a detector quietly handed a clean source. The mutation sweep's own
 * entries hold themselves to the same rule, for the same reason.
 */
function replaceOnce(source: string, find: string, replace: string): string {
  expect(
    source.split(find).length - 1,
    `the file no longer contains this anchor exactly once: ${find}`,
  ).toBe(1);
  return source.replace(find, replace);
}

/** The real file a case patches, keyed the way the source scan keys it. */
function scannedSource(path: string): string {
  const source = testSources[path];
  expect(source, `${path} was not read by the source scan`).toBeTruthy();
  return source ?? "";
}

/**
 * The two shapes, brought back in the file this repo would write them in.
 *
 * The fixtures above state each shape in the abstract; these state the shape *this repo*
 * would write, patched into a real test file the scan reads and handed to the same
 * detector. The difference is the one thing a fixture cannot notice — a rename or a
 * refactor in the file it stands in for. If the feed page stopped mounting through the
 * helper, or stopped cleaning up in an `afterEach`, a hand-written shape would keep
 * passing while the real reintroduction walked straight past the guard. So each case
 * patches the file's own text through one anchored substitution, checks the *premise* the
 * shape rests on is still true of that file, and requires the detector to report it.
 */
describe("each mount shape and teardown sweep, reintroduced in the real file", () => {
  /** The real mounted page a raw `mount()` or a body sweep would be written back into. */
  const path = "../app/(main)/feed/feed-page.test.tsx";

  test("catches a raw mount() brought back in a real test file", () => {
    const source = scannedSource(path);
    // The premise, asserted against the file rather than assumed: it mounts through the
    // helper today and the guard leaves it alone, which is what makes it the file a raw
    // call would be reintroduced into. A helper that moved out of this file is a change to
    // this case.
    expect(source, `${path} no longer mounts through the helper`).toContain("mountSurface(");
    expect(rawMountCalls(source), `${path} already trips the guard`).toEqual([]);

    const reintroduced = replaceOnce(
      source,
      '  const ui = mountSurface(<FeedPage />, { providers: "theme+tooltip" });',
      '  const ui = mount(<FeedPage />, { providers: "theme+tooltip" });',
    );

    const flagged = rawMountCalls(reintroduced);
    expect(flagged, `${path}: the raw mount() this file would write was not seen`).toHaveLength(1);
    // …and the line it names is the line the call is on, read back out of the patched
    // source rather than taken on trust from the detector's own report.
    expect(reintroduced.split("\n")[flagged[0] - 1]).toContain("const ui = mount(<FeedPage />");
  });

  test("catches a body sweep brought back into a real teardown", () => {
    const source = scannedSource(path);
    expect(source, `${path} no longer mounts a surface`).toContain("mountSurface(");
    expect(cleanupProblem(source), `${path} already gets its teardown wrong`).toBeNull();

    // The shape a teardown writes to empty the body: a copy of the children, swept. It is
    // the limb the detector's one-declaration walk exists for — the declaration is followed,
    // not the removal's receiver — which is what makes it the shape to bring back rather
    // than a reach for `document.body.innerHTML = ""`.
    const reintroduced = replaceOnce(
      source,
      "afterEach(() => {\n  cleanupSurfaces();\n",
      "afterEach(() => {\n" +
        "  const nodes = [...document.body.childNodes];\n" +
        "  nodes.forEach((node) => node.remove());\n" +
        "  cleanupSurfaces();\n",
    );

    expect(cleanupProblem(reintroduced)).toBe("clears the body before cleaning up");

    // …and the clear it found is the sweep of the copy, not merely some earlier mention of
    // the body: the line read back out of the patched source is the one the removal sits on.
    // With the declaration walk dark the earliest note slides back onto the declaration line,
    // so this half is what makes the reintroduction fail for the reason it was written for.
    const clearAt = bodyClearIndex(reintroduced);
    expect(clearAt, `${path}: the copy sweep this teardown would write was not seen`)
      .toBeGreaterThanOrEqual(0);
    const clearLine = reintroduced.slice(0, clearAt).split("\n").length;
    expect(
      reintroduced.split("\n")[clearLine - 1],
      `${path}: the reported clear is not the sweep`,
    ).toContain("nodes.forEach");
  });
});
