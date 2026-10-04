/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// `?raw` is Vite's own escape hatch for exactly this: the *source* bytes of a
// file. The project has no `@types/node`, so reading it with `fs` is not an
// option here (the same reason `globals-layer.test.ts` imports its stylesheet
// this way).
import runbook from "../../.freebuff/run.md?raw";

// The same module `npm run runbook:contents` uses, so the file this test reads
// and the file that script writes can never disagree about what the Contents
// should be.
import { contentsLinks, githubSlug, sections } from "../../.freebuff/runbook-contents.mjs";
// The drift detector is shared with the meta-test in `convention-guards.test.ts`,
// so the rule this asserts and the shape it fires on cannot drift apart.
import { contentsDrift } from "@/test/convention-guards";

/**
 * A contract test for the runbook's table of contents.
 *
 * `.freebuff/run.md` opens with a `## Contents` list of `- [Heading](#anchor)`
 * links, which is pure duplication: every link restates a heading, and its
 * anchor restates it again in slug form. Rename a section, or edit its
 * punctuation, and the link silently stops resolving — a reader clicks and
 * nothing happens, and a broken index is worse than none because it looks
 * navigable.
 *
 * The list is now generated from the headings by `.freebuff/build-contents.mjs`
 * (via the shared `runbook-contents.mjs`). This test is the backstop that makes
 * "generated" true: it asserts the committed block is *exactly* what the
 * generator produces, so a heading edited without re-running
 * `npm run runbook:contents` fails here instead of shipping a dead link.
 *
 * What it cannot check is the reader's renderer. GitHub, VS Code and the in-app
 * preview agree on the slug rules above; a renderer that invents its own is out
 * of reach, and the runbook's click-through is what covers that.
 */
describe("the runbook's table of contents", () => {
  it("parses the runbook instead of finding nothing", () => {
    // Without this, the comparison below could pass by agreeing on emptiness.
    // The floor is here so that adding a section does not need this line edited.
    expect(sections(runbook).length, "no `## ` sections found — is the `?raw` import wired up?").toBeGreaterThan(30);
    expect(contentsLinks(runbook).length).toBe(sections(runbook).length);
  });

  it("is exactly what the generator produces", () => {
    expect(
      contentsDrift(runbook),
      "The Contents block is out of step with the headings. Run `npm run runbook:contents`.",
    ).toEqual([]);
  });

  it("gives no two sections the same anchor", () => {
    // A collision is the quiet case: GitHub would rename the second heading to
    // `<slug>-1`, so a Contents link written from its text points at the first
    // section instead — the wrong place, not a dead link.
    // The shared module is plain JS, so its returns are `any`; naming the array
    // type keeps the callback parameters inferred rather than implicitly `any`.
    const slugs: string[] = sections(runbook).map(githubSlug);
    const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);

    expect(duplicates, "Two headings share an anchor; give one of them a distinct title.").toEqual([]);
  });
});

/**
 * The slug rule itself, pinned to the headings the runbook actually contains.
 * These are the cases that made the anchors non-obvious — punctuation that looks
 * significant but is dropped, and characters that are kept.
 */
describe("githubSlug", () => {
  it("drops ASCII punctuation and turns spaces into hyphens", () => {
    expect(githubSlug("Live feed updates (Supabase Realtime)")).toBe("live-feed-updates-supabase-realtime");
    expect(githubSlug("Feed/notification dev behaviours")).toBe("feednotification-dev-behaviours");
    expect(githubSlug("The accent follows the account; the theme follows the device")).toBe(
      "the-accent-follows-the-account-the-theme-follows-the-device",
    );
  });

  it("strips a code span's backticks and keeps the word", () => {
    expect(githubSlug("The subject of a `followers` post (a Page's posts belong to the Page)")).toBe(
      "the-subject-of-a-followers-post-a-pages-posts-belong-to-the-page",
    );
  });

  it("keeps hyphens and underscores, the two punctuation characters GitHub allows", () => {
    expect(githubSlug("Auditing for the portal-vs-focus class")).toBe("auditing-for-the-portal-vs-focus-class");
    expect(githubSlug("snake_case name")).toBe("snake_case-name");
  });
});
