/**
 * The runbook's table of contents, derived from its own headings.
 *
 * `.freebuff/run.md` opens with a `## Contents` list of `- [Heading](#anchor)`
 * links. Hand-maintained, that list is a second copy of every heading and of
 * its slug: rename a section, or even just edit its punctuation, and the link
 * stops resolving while still looking navigable.
 *
 * This module is the single source of truth for that list. `build-contents.mjs`
 * uses it to rewrite the file; `src/test/runbook-contents.test.ts` uses it to
 * assert the committed file already matches, so a heading changed without the
 * list being regenerated is a failing test rather than a dead link.
 *
 * Kept as plain ESM with no imports so that the plain-`node` script and the
 * Vite/Vitest test can both use it without a build step or type shims.
 */

export const CONTENTS_HEADING = "Contents";

/**
 * GitHub's heading-anchor algorithm: lower-case, drop ASCII punctuation, turn
 * spaces into hyphens. `-` and `_` are the two punctuation characters GitHub
 * keeps; every other ASCII punctuation mark goes. So
 * `The subject of a `followers` post (a Page's posts belong to the Page)`
 * becomes `the-subject-of-a-followers-post-a-pages-posts-belong-to-the-page`.
 */
export function githubSlug(text) {
  return text
    .replace(/[!"#$%&'()*+,.\/:;<=>?@[\]^`{|}~\\]/g, "")
    .replace(/ /g, "-")
    .toLowerCase();
}

/** Every `## Heading` in the source, in document order. */
export function parseHeadings(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

/** Every section the Contents should list — all of them except Contents itself. */
export function sections(source) {
  return parseHeadings(source).filter((heading) => heading !== CONTENTS_HEADING);
}

/**
 * GitHub disambiguates a repeated heading by suffixing `-1`, `-2`, … on the
 * second and later occurrences. `seen` carries the tallies across one pass so
 * the generated slugs match what a renderer would assign.
 */
function uniqueSlug(heading, seen) {
  const base = githubSlug(heading);
  if (!seen.has(base)) {
    seen.set(base, 0);
    return base;
  }
  let n = seen.get(base) + 1;
  seen.set(base, n);
  let slug = `${base}-${n}`;
  while (seen.has(slug)) {
    n += 1;
    seen.set(base, n);
    slug = `${base}-${n}`;
  }
  seen.set(slug, 0);
  return slug;
}

/** The Contents bullets for the headings in `lines`, in document order. */
export function contentsLinks(source) {
  const seen = new Map();
  const links = [];
  for (const heading of sections(source)) {
    // A `[` or `]` in the heading would end the link label early.
    const label = heading.replace(/[[\]]/g, "\\$&");
    links.push(`- [${label}](#${uniqueSlug(heading, seen)})`);
  }
  return links;
}

/**
 * The whole `## Contents` block, canonical: the heading, a blank line, the
 * links, and a trailing blank line so the next section stays separated.
 */
export function renderContents(source) {
  return [`## ${CONTENTS_HEADING}`, "", ...contentsLinks(source), ""].join("\n");
}

/**
 * The runbook source with its `## Contents` block regenerated in place. Replaces
 * the block from the `## Contents` heading up to the next `## ` heading; if the
 * block is missing, inserts one just below the document's `# ` title. Idempotent:
 * running it on its own output changes nothing.
 */
export function buildContents(source) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${CONTENTS_HEADING}`);

  let from = start;
  let to;
  if (start === -1) {
    const title = lines.findIndex((line) => line.startsWith("# "));
    from = title === -1 ? 0 : title + 1;
    to = from;
  } else {
    to = start + 1;
    while (to < lines.length && !lines[to].startsWith("## ")) to += 1;
  }

  const block = renderContents(source).split("\n");
  const out = [...lines.slice(0, from), ...block, ...lines.slice(to)].join(newline);
  return out.endsWith(newline) ? out : out + newline;
}
