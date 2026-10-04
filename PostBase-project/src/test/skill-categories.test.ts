/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// `import.meta.glob` is Vite's way to enumerate files at build time, and `?raw`
// is how a file's source is read without `fs` — which the project cannot use,
// having no `@types/node`. Both are the same tools `runbook-contents.test.ts`
// and `globals-layer.test.ts` lean on. (`import.meta.glob` insists on a literal
// pattern, so the path is spelled out rather than built from a constant.)
import sectionsSource from "../../.agents/skills/supabase-postgres-best-practices/references/_sections.md?raw";
import skillSource from "../../.agents/skills/supabase-postgres-best-practices/SKILL.md?raw";

/**
 * A structural test for the Supabase Postgres skill under `.agents/skills/`.
 *
 * That skill is a directory of rule files whose *category* is carried entirely
 * by the filename prefix — `query-missing-indexes.md` is a Query Performance
 * rule, `conn-pooling.md` a Connection Management one. Nothing in the file
 * itself states its category, and no file lists the others, so the prefix is
 * the only link between a rule and the eight categories the skill declares in
 * `references/_sections.md` (and repeats in `SKILL.md`'s priority table).
 *
 * That link is invisible to every other check: a new rule named `foo-…md`, or a
 * typo in an existing prefix, is a rule the skill's own index does not admit
 * exists, and it renders perfectly. This test is the smallest thing that makes
 * the convention load-bearing — it fails when a file's prefix is not a declared
 * category, when a declared category has no file, or when the two places that
 * declare the categories disagree with each other.
 *
 * It deliberately does not test file *contents* (the front-matter `impact`, the
 * required Incorrect/Correct examples). That is the skill's own content
 * contract, described in `references/_contributing.md`, not the project's.
 */

/** Every markdown file under `references/`, excluding the `_`-prefixed meta files. */
const ruleFiles = Object.keys(
  import.meta.glob("../../.agents/skills/supabase-postgres-best-practices/references/*.md"),
)
  .map((path) => path.split("/").pop() ?? path)
  .filter((name) => !name.startsWith("_"));

/** `name.md` → the prefix before the first hyphen, which is its category. */
function prefixOf(fileName: string): string {
  return fileName.replace(/\.md$/, "").split("-")[0];
}

/** The categories declared as `## N. Name (prefix)` in `_sections.md`. */
function declaredCategories(source: string): { name: string; prefix: string }[] {
  return source
    .split(/\r?\n/)
    .map((line) => /^##\s+\d+\.\s+(.+?)\s*\(([a-z]+)\)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[1], prefix: match[2] }));
}

/** The backticked `prefix-` of every row in `SKILL.md`'s priority table. */
function tablePrefixes(source: string): string[] {
  return source
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|"))
    .map((line) => /`([a-z]+)-`/.exec(line)?.[1] ?? null)
    .filter((prefix): prefix is string => prefix !== null);
}

const categories = declaredCategories(sectionsSource);
const declared = new Set(categories.map((category) => category.prefix));

describe("the Postgres skill's rule categories", () => {
  it("finds the rule files and the declared categories", () => {
    // Without this the invariants below could pass by finding nothing.
    expect(ruleFiles.length, "no rule files matched the references glob").toBeGreaterThan(20);
    expect(categories.length, "no `## N. Name (prefix)` sections found in _sections.md").toBe(8);
  });

  it("names every rule file with a declared category prefix", () => {
    const unknown = ruleFiles
      .filter((fileName) => !declared.has(prefixOf(fileName)))
      .map((fileName) => `${fileName} (prefix "${prefixOf(fileName)}")`);

    expect(
      unknown,
      "A rule's category is its filename prefix, so a prefix that is not declared in " +
        "`references/_sections.md` is a rule the skill's structure does not admit exists. " +
        "Rename the file to a declared prefix, or add the category to `_sections.md`.",
    ).toEqual([]);
  });

  it("keeps at least one rule file under every declared category", () => {
    const empty = categories
      .filter((category) => !ruleFiles.some((fileName) => prefixOf(fileName) === category.prefix))
      .map((category) => `${category.name} (${category.prefix}-)`);

    expect(
      empty,
      "Every category the skill declares should have at least one rule under it, or the " +
        "category is advertised in the index and empty in practice.",
    ).toEqual([]);
  });

  it("declares the same categories in SKILL.md's table as in _sections.md", () => {
    // The category list is written down twice — `_sections.md` defines them,
    // `SKILL.md`'s priority table repeats them. Adding a category to one and not
    // the other is the drift this catches.
    const table = new Set(tablePrefixes(skillSource));

    expect(
      tablePrefixes(skillSource).length,
      "no `` `prefix-` `` rows parsed from SKILL.md's priority table",
    ).toBeGreaterThan(0);
    expect([...table].sort(), "SKILL.md and _sections.md declare different categories").toEqual(
      [...declared].sort(),
    );
  });
});
