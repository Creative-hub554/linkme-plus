/**
 * Regenerates the generated indexes in the skills under `.agents/skills/`.
 *
 * Run it after adding, renaming or retitling a rule or reference file:
 *
 *   npm run skill:index
 *
 * Two skills, two shapes:
 *   - `supabase-postgres-best-practices` — a per-category rule index built from
 *     its `references/*.md` and the categories in `references/_sections.md`.
 *   - `supabase` — a flat index of every file under `references/` and `assets/`,
 *     which have no categories (and one of which, until now, was named nowhere).
 *
 * Idempotent: run when nothing changed, it reports "up to date" and leaves each
 * SKILL.md byte-identical. `src/test/skill-index.test.ts` asserts that.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFileIndex,
  buildIndex,
  headingTitleOf,
  impactOf,
  parseCategories,
  prefixOf,
  titleOf,
} from "./skill-index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", ".agents", "skills");

/** Markdown files in a directory, excluding the `_`-prefixed meta files. */
function markdownFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort();
}

function report(name, before, after, summary) {
  if (after === before) {
    console.log(`${name}/SKILL.md: index already up to date (${summary}).`);
  } else {
    writeFileSync(join(skillsDir, name, "SKILL.md"), after);
    console.log(`${name}/SKILL.md: rewrote index (${summary}).`);
  }
}

/** The per-category rule index. */
function buildPostgresSkill(name) {
  const skillPath = join(skillsDir, name, "SKILL.md");
  const referencesDir = join(skillsDir, name, "references");
  const before = readFileSync(skillPath, "utf8");
  const categories = parseCategories(readFileSync(join(referencesDir, "_sections.md"), "utf8"));
  const rules = markdownFiles(referencesDir).map((fileName) => {
    const content = readFileSync(join(referencesDir, fileName), "utf8");
    return {
      fileName,
      title: titleOf(fileName, content),
      impact: impactOf(content),
    };
  });

  const uncategorised = rules.filter(
    (rule) => !categories.some((category) => category.prefix === prefixOf(rule.fileName)),
  );
  if (uncategorised.length > 0) {
    console.warn(
      `  Warning: ${uncategorised.length} rule(s) have no declared category: ` +
        uncategorised.map((rule) => rule.fileName).join(", "),
    );
  }

  report(name, before, buildIndex(before, categories, rules), `${rules.length} rules, ${categories.length} categories`);
}

/** The flat index over the skill's content directories. */
function buildFlatSkill(name, directories) {
  const skillPath = join(skillsDir, name, "SKILL.md");
  const before = readFileSync(skillPath, "utf8");

  let total = 0;
  const groups = directories.map((directory) => {
    const files = markdownFiles(join(skillsDir, name, directory));
    total += files.length;
    const heading = directory.charAt(0).toUpperCase() + directory.slice(1);
    return {
      heading,
      entries: files.map((fileName) => ({
        title: headingTitleOf(fileName, readFileSync(join(skillsDir, name, directory, fileName), "utf8")),
        path: `${directory}/${fileName}`,
      })),
    };
  });

  report(name, before, buildFileIndex(before, groups), `${total} files in ${directories.join(", ")}`);
}

buildPostgresSkill("supabase-postgres-best-practices");
buildFlatSkill("supabase", ["references", "assets"]);
