import { describe, expect, it } from "vitest";

import { expectDocSelfHeld, expectHeld, readSource } from "./doc-freshness";
import { importClosure } from "../../.freebuff/import-closure.mjs";

/**
 * The proposal doc is a review record: it names functions, quotes shapes and states
 * contracts about `.freebuff/ci.mjs`, `.freebuff/import-closure.mjs` and
 * `.freebuff/gate-drift.mjs`, and its revert plan tells a future reader exactly which
 * edits to undo. The moment the code moves on without it, that record lies — quietly,
 * because nothing compiled against it. These cases hold the doc's quoted code shapes
 * against the sources it names, so the record cannot silently age: a rename or a
 * removed helper the doc still asserts is a red test naming the paragraph to refresh,
 * not a stale sentence someone trusts.
 *
 * The rules run through the shared `./doc-freshness` helper and are grep-shaped on
 * purpose — a doc is prose and code is text, so the comparison is textual inclusion,
 * byte-exact, both directions where the doc quotes a whole line. Three kinds of
 * sentence are deliberately not held, and each was a real red in the first draft
 * before the exclusion existed: prose paraphrases that no literal line states (the
 * Problem section's `stageKey = sha256(...)` formula), the doc's shortened signature
 * (it drops `= new Set()`, so the walker's real line is the needle and the paraphrase
 * is held doc-side only), and doc-side anchors in markdown dress (`stageTouched`,
 * `pinnedRows` with their backticks) whose job is to pin the doc's wording, not to
 * grep the source. The doc's worked example is held as code: the walker must still
 * derive exactly the modules the doc renders for mutation-preflight, and the rendered
 * line must still be the line `ci.mjs` prints. When a case goes red after a real
 * change, update the doc in the same commit — it is the review record, and a record
 * that needs archaeology is not one.
 */

const doc = readSource("docs/proposal-derived-import-closure.md");
const ci = readSource(".freebuff/ci.mjs");
const walker = readSource(".freebuff/import-closure.mjs");
const gateDrift = readSource(".freebuff/gate-drift.mjs");
const runnerTest = readSource("src/test/ci-runner.test.ts");

/** Every doc needle the rules quote, so one lookup table answers "where did it go?". */
const DOC_NEEDLES: Record<string, string> = {
  walkerSignature: "export function importClosure(script, read = defaultRead, seen = new Set()) {",
  docWalkerParaphrase: "importClosure(script, read = defaultRead, seen)",
  walkerQuotes: "literal double-quoted relative",
  walkerComments: "Drops comment lines before matching",
  walkerUnreadable: "An unreadable file contributes itself and stops",
  stageClosure: "stageClosure(stage)",
  stageKeyFiles: "stageKeyFiles(stage, files)",
  closureInputLabel: "closureInputLabel(scriptRel)",
  stageTouched: "`stageTouched` also consults the closure",
  pinnedRows: "`pinnedRows` augments each row's `keys`",
  cacheVersion: "bumped 2 → 3",
  stageImportNames: "stageImportNames(stage)",
  absentNotEmpty: "It is *absent*, not empty",
  uncoveredImports: "rows carry the same list as an `imports` field",
  refusalTemplate:
    "add it to the <stage> stage, which already keys <via> and imports <modules>",
  watchFamily: "pr-comment|import-closure",
  slimmedInvariant: "keys every script-backed stage on the import closure its gate loads",
  extensionCase: "carries each gate's import closure beside its key, on the line and in the JSON",
  workedExampleLabel: "mutation-vocabulary.mjs ← imports of .freebuff/mutation-preflight.mjs",
  workedExampleImports:
    "⤷ imports .freebuff/gate-hashes.mjs, .freebuff/mutation-lock.mjs, .freebuff/mutation-vocabulary.mjs, .freebuff/whole-write.mjs",
};

describe("the derived-import-closure proposal doc against the sources it names", () => {
  it("is quoted accurately: the shapes it names exist in the doc itself", () => {
    // The rules below quote fragments *of the doc*; if an edit rewords a quoted
    // paragraph without updating the rule, the failure must be the missing needle and
    // not a silent pass. The shared doc-self hold makes every other rule
    // self-checking. Source-only needles (the walker's real signature, which the
    // doc paraphrases) are held in the walker case below, not here.
    expectDocSelfHeld(DOC_NEEDLES, doc, "doc", ["walkerSignature"]);
  });

  it("names walker helpers that exist in .freebuff/import-closure.mjs", () => {
    // The walker is the doc's own worked example, so the doc's paraphrase of its
    // contract is held against the lines that *are* the contract — the real
    // signature (the doc drops `= new Set()`, so the paraphrase cannot be the
    // literal needle), the unreadable-file stop, the comment filter and the
    // single matchAll loop that makes the walk a walk.
    expectHeld(DOC_NEEDLES.walkerSignature, walker, "import-closure.mjs");
    expectHeld("if (text === undefined) return seen;", walker, "import-closure.mjs");
    expectHeld('startsWith("//")', walker, "import-closure.mjs");
    expectHeld("for (const match of code.matchAll", walker, "import-closure.mjs");
  });

  it("names ci.mjs helpers that exist in .freebuff/ci.mjs", () => {
    // The four helper names whose doc-side form is also source-greppable. The
    // `stageTouched` and `pinnedRows` sentences are held doc-side only (their
    // needles are markdown prose); the ci-side reality of both is held below by
    // the exact lines they stand behind.
    for (const key of ["stageClosure", "stageKeyFiles", "closureInputLabel", "stageImportNames"] as const) {
      expectHeld(DOC_NEEDLES[key], ci, "ci.mjs");
    }
    // The doc's examples, byte-exact, so rewording the code is a doc commit too:
    // the memoized closure map and its stage entry, the union builder, the report
    // helper and its minus-the-script sorted list, the refusal resolver, the redacted
    // derivation label, the key-version bump the doc's checklist asks about, and the
    // stage-touched / pinned-rows closure consultations.
    expectHeld("const stageClosures = new Map();", ci, "ci.mjs");
    expectHeld("function stageClosure(stage) {", ci, "ci.mjs");
    expectHeld("function stageKeyFiles(stage, files) {", ci, "ci.mjs");
    expectHeld("function stageImportNames(stage) {", ci, "ci.mjs");
    expectHeld("function closureOf(name) {", ci, "ci.mjs");
    expectHeld("return redactInput(`imports of ${scriptRel}`);", ci, "ci.mjs");
    expectHeld("const CACHE_VERSION = 3;", ci, "ci.mjs");
    expectHeld("join(ROOT, name)", ci, "ci.mjs");
    expectHeld("stageKeyFiles(stage, [])", ci, "ci.mjs");
    expectHeld("stageClosure(stage)?.has(row.file)", ci, "ci.mjs");
    expectHeld("name !== scriptRel", ci, "ci.mjs");
    expectHeld("sort((a, b) => a.localeCompare(b))", ci, "ci.mjs");
    expectHeld("imports: redactInputs(imports)", ci, "ci.mjs");
    expectHeld("if (entry.imports !== undefined)", ci, "ci.mjs");
    expectHeld("imports: row.suggested === null ? null : closureOf(row.suggested)", ci, "ci.mjs");
    expectHeld(" and imports ${imports.join", ci, "ci.mjs");
  });

  it("quotes the reporting and watch shapes the extension section states", () => {
    // The watch-family regex the doc quotes whole; the extension's case names,
    // which live in the runner test the doc's Tests section describes.
    expectHeld(
      '"^(ci|comment-gate|gate-drift|redact|nightly-report|pr-comment|import-closure)\\\\.mjs$"',
      gateDrift,
      "gate-drift.mjs",
    );
    expectHeld(DOC_NEEDLES.watchFamily, doc, "doc");
    expectHeld(DOC_NEEDLES.slimmedInvariant, runnerTest, "ci-runner.test.ts");
    expectHeld(DOC_NEEDLES.extensionCase, runnerTest, "ci-runner.test.ts");
  });

  it("derives the reported imports from the same closure the key folds in", () => {
    // The doc's central claim — the report cannot name a module the key does not
    // hold — held as code on the doc's own worked example: run the walker the doc
    // documents over the gate the doc quotes, and the derived list must stay
    // exactly the four modules the doc renders, in the report's own sorted order.
    // A new helper under mutation-preflight.mjs is a real report change, so the
    // example — and this rule with it — must be refreshed in the same commit.
    const script = ".freebuff/mutation-preflight.mjs";
    const closure = [...importClosure(script, (name) => {
      try {
        return readSource(name);
      } catch {
        return undefined;
      }
    })].filter((name) => name !== script).sort((a, b) => a.localeCompare(b));
    expect(closure).toEqual([
      ".freebuff/gate-hashes.mjs",
      ".freebuff/mutation-lock.mjs",
      ".freebuff/mutation-vocabulary.mjs",
      ".freebuff/whole-write.mjs",
    ]);
    // The rendered line the doc quotes is the literal template `ci.mjs` prints, so
    // the doc's example ages with the printer and not only with the walker; the
    // derivation-label pairing is held on the doc side, where it is quoted.
    expectHeld('⤷ imports ${entry.imports.join(", ")}', ci, "ci.mjs");
    expectHeld(DOC_NEEDLES.workedExampleImports, doc, "doc");
    expectHeld(DOC_NEEDLES.workedExampleLabel, doc, "doc");
  });
});
