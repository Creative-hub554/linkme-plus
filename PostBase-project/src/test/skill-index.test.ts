/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// `?raw` for file sources and `import.meta.glob` to enumerate the rule files —
// the same tools the other doc-contract tests use, since the project has no
// `@types/node` for `fs`. (`import.meta.glob` needs literal patterns.)
import skillSource from "../../.agents/skills/supabase-postgres-best-practices/SKILL.md?raw";
import changelogSource from "../../.agents/skills/supabase-postgres-best-practices/CHANGELOG.md?raw";
import sectionsSource from "../../.agents/skills/supabase-postgres-best-practices/references/_sections.md?raw";

// The same module `npm run skill:index` uses, so the file this test reads and
// the file that script writes cannot disagree about what the index should be.
import {
  buildFileIndex,
  buildIndex,
  headingTitleOf,
  impactOf,
  impactRank,
  parseCategories,
  titleOf,
} from "../../.freebuff/skill-index.mjs";
import supabaseSkillSource from "../../.agents/skills/supabase/SKILL.md?raw";
import supabaseChangelogSource from "../../.agents/skills/supabase/CHANGELOG.md?raw";

const ruleModules = import.meta.glob(
  "../../.agents/skills/supabase-postgres-best-practices/references/*.md",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The `_`-prefixed meta files are not rules; everything else under `references/` is. */
const rules = Object.entries(ruleModules)
  .map(([path, content]) => ({ fileName: path.split("/").pop() ?? path, content }))
  .filter((entry) => !entry.fileName.startsWith("_"))
  .map((entry) => ({
    fileName: entry.fileName,
    title: titleOf(entry.fileName, entry.content),
    impact: impactOf(entry.content),
  }));

const categories = parseCategories(sectionsSource);

/** The text between a pair of index markers, inclusive; `""` when they are gone. */
function indexBlock(source: string, marker = "rule-index"): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`<!-- ${marker}:start`));
  const end = lines.findIndex((line) => line.startsWith(`<!-- ${marker}:end`));
  if (start === -1 || end === -1 || end < start) return "";
  return lines.slice(start, end + 1).join("\n");
}

// The sibling `supabase` skill has no categories: its index is a flat listing of
// the files under `references/` and `assets/`.
const supabaseReferences = import.meta.glob("../../.agents/skills/supabase/references/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const supabaseAssets = import.meta.glob("../../.agents/skills/supabase/assets/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** One index group per directory, mirroring how the CLI builds them. */
function fileGroup(directory: string, modules: Record<string, string>) {
  const entries = Object.entries(modules)
    .map(([path, content]) => ({ fileName: path.split("/").pop() ?? path, content }))
    .filter((entry) => !entry.fileName.startsWith("_"))
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
    .map((entry) => ({ title: headingTitleOf(entry.fileName, entry.content), path: `${directory}/${entry.fileName}` }));
  return { heading: directory.charAt(0).toUpperCase() + directory.slice(1), entries };
}

const supabaseGroups = [
  fileGroup("references", supabaseReferences),
  fileGroup("assets", supabaseAssets),
];

/**
 * A contract test for the Postgres skill's generated rule index.
 *
 * `SKILL.md` used to name three example rule files in a fenced block while the
 * other twenty-eight sat unlisted, so a new rule was invisible until someone
 * remembered to add it. The index is now generated from the files on disk by
 * `npm run skill:index` (via the shared `skill-index.mjs`); this test is the
 * backstop that keeps "generated" true — it compares the committed block to the
 * generator's output, so a rule added, renamed or retitled without regenerating
 * fails here instead of shipping an index that cannot find it.
 *
 * The sibling `skill-categories.test.ts` checks the *classification* (every
 * prefix is a declared category); this one checks the *enumeration* (every file
 * is listed). Together they mean the skill cannot quietly grow a rule nobody
 * can reach.
 */
describe("the Postgres skill's rule index", () => {
  it("parses the rule files and categories instead of finding nothing", () => {
    expect(rules.length, "no rule files matched the references glob").toBeGreaterThan(20);
    expect(categories.length, "no categories parsed from _sections.md").toBe(8);
    const block = indexBlock(skillSource);
    expect(block, "SKILL.md has no `rule-index` markers").toContain("<!-- rule-index:start");
    expect(block).toContain("<!-- rule-index:end -->");
  });

  it("is exactly what the generator produces", () => {
    const generated = buildIndex(skillSource, categories, rules);
    expect(
      indexBlock(skillSource),
      "The rule index is out of step with the files in references/. Run `npm run skill:index`.",
    ).toBe(indexBlock(generated));
  });

  it("leads each category with its most impactful rules", () => {
    // The categories are already priority-ordered; within one, an agent should
    // hit the CRITICAL rules first. This reads the emitted `— LEVEL` notes back
    // out of the committed block and checks they never step down the ladder.
    const groups: { heading: string; ranks: number[] }[] = [];
    for (const line of indexBlock(skillSource).split("\n")) {
      if (line.startsWith("### ")) groups.push({ heading: line.slice(4), ranks: [] });
      const note = /—\s+([A-Z-]+)\s*$/.exec(line);
      if (note && groups.length > 0) groups[groups.length - 1].ranks.push(impactRank(note[1]));
    }

    expect(groups.length, "no `### category` groups parsed out of the index").toBe(8);
    expect(
      groups.every((group) => group.ranks.length > 0),
      "a category has no impact notes, so its order cannot be checked",
    ).toBe(true);
    const outOfOrder = groups
      .filter((group) => group.ranks.some((rank, i) => i > 0 && group.ranks[i - 1] > rank))
      .map((group) => group.heading);
    expect(
      outOfOrder,
      "These categories are not ordered by impact (CRITICAL first). Run `npm run skill:index`.",
    ).toEqual([]);
  });

  it("records the index as a local modification, so a refresh cannot drop it quietly", () => {
    // The skill is vendored, so an upstream refresh replaces these files whole.
    // Both the metadata and the changelog now say the index is local, and this
    // is what makes that a guarded claim rather than a comment: a refresh that
    // reverts either one fails here with a message that says exactly what was
    // lost, instead of the index/CHANGELOG note disappearing unnoticed.
    expect(
      skillSource,
      "SKILL.md front-matter no longer records the local rule index (`localModifications:`)",
    ).toContain("localModifications:");
    expect(
      changelogSource,
      "CHANGELOG.md no longer records the local rule index",
    ).toContain("Local modifications (not upstream)");
  });

  it("links every rule file from SKILL.md", () => {
    // Independent of the markers: a rule that exists on disk and is named
    // nowhere in SKILL.md is the failure the index exists to prevent.
    const missing = rules
      .filter((rule) => !skillSource.includes(`references/${rule.fileName}`))
      .map((rule) => rule.fileName);

    expect(
      missing,
      "These rule files are never referenced from SKILL.md, so an agent reading the skill " +
        "cannot find them. Run `npm run skill:index` to list them.",
    ).toEqual([]);
  });
});

/**
 * The same contract for the sibling `supabase` skill, which has no categories.
 *
 * Its `## Reference Guides` section named `references/skill-feedback.md` by hand
 * and said *nothing* about `assets/feedback-issue-template.md` — a real file,
 * linked only from inside the reference it belonged beside. The generated flat
 * index lists both, under `References` and `Assets`, while the curated "MUST
 * read when" note stays as hand-written prose below the block.
 */
describe("the supabase skill's file index", () => {
  it("finds the files and the index block", () => {
    expect(supabaseGroups.flatMap((group) => group.entries).length).toBeGreaterThanOrEqual(2);
    expect(indexBlock(supabaseSkillSource, "file-index"), "SKILL.md has no `file-index` markers").toContain(
      "<!-- file-index:start",
    );
  });

  it("is exactly what the generator produces", () => {
    const generated = buildFileIndex(supabaseSkillSource, supabaseGroups);
    expect(
      indexBlock(supabaseSkillSource, "file-index"),
      "The file index is out of step with the files under references/ and assets/. Run `npm run skill:index`.",
    ).toBe(indexBlock(generated, "file-index"));
  });

  it("records the index as a local modification, so a refresh cannot drop it quietly", () => {
    // Same guard as the Postgres skill's index: the skills are vendored, so an
    // upstream refresh replaces these files whole. Both the metadata and the
    // changelog now say the index is local, and this is what makes that a
    // guarded claim — a refresh that reverts either one fails here with a
    // message that says exactly what was lost.
    expect(
      supabaseSkillSource,
      "SKILL.md front-matter no longer records the local file index (`localModifications:`)",
    ).toContain("localModifications:");
    expect(
      supabaseChangelogSource,
      "CHANGELOG.md no longer records the local file index",
    ).toContain("Local modifications (not upstream)");
  });

  it("names every reference and asset file", () => {
    const missing = supabaseGroups
      .flatMap((group) => group.entries)
      .filter((entry) => !supabaseSkillSource.includes(entry.path))
      .map((entry) => entry.path);

    expect(
      missing,
      "These files are in the skill but named nowhere in SKILL.md, so an agent reading it " +
        "cannot find them. Run `npm run skill:index` to list them.",
    ).toEqual([]);
  });
});
