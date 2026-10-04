import { describe, expect, test } from "vitest";
import {
  audienceLabel,
  audienceRule,
  canReadPost,
  composerAudiences,
  isPostAudience,
  postAudiences,
  toPostAudience,
} from "@/lib/post-audiences";
import { visibilityEnum } from "@/lib/db/schema";

/**
 * `postAudiences` is the one list every other place derives from, so these pin
 * the list itself and the ties that make it the only one: the database column,
 * the rule, the names, and the narrowing the API and the UI both use.
 */
describe("postAudiences", () => {
  test("is the list the database column is built from", () => {
    expect([...visibilityEnum.enumValues]).toEqual([...postAudiences]);
  });

  test("leads with the audience an unrecognised value falls back to", () => {
    // `toPostAudience` and the picker both fall back to the first audience, so
    // the fallback and the list have to agree on which one that is.
    expect(toPostAudience("nobody knows this one")).toBe(postAudiences[0]);
  });
});

describe("audienceLabel", () => {
  test("names every audience, and names each one differently", () => {
    // Two audiences sharing a name would be indistinguishable in the picker.
    const labels = postAudiences.map((audience) => audienceLabel[audience]);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(postAudiences.length);
  });
});

describe("isPostAudience", () => {
  test("accepts exactly the declared audiences", () => {
    for (const audience of postAudiences) {
      expect(isPostAudience(audience)).toBe(true);
    }
    // Anything else, including the near-misses a client could send: an
    // unrecognised value has to be caught before it reaches the enum column.
    const rejects = ["", "Public", "followers ", " close-friends", null, undefined, 7, {}, ["public"]];
    expect(rejects.filter(isPostAudience)).toEqual([]);
  });

  test("narrows to an audience, falling back to the most public one", () => {
    for (const audience of postAudiences) {
      expect(toPostAudience(audience)).toBe(audience);
    }
    // The fallback is `public`, which is why an unrecognised value must be
    // rejected on the write paths rather than passed through.
    expect(toPostAudience("close-friends")).toBe("public");
    expect(toPostAudience(null)).toBe("public");
    expect(toPostAudience(undefined)).toBe("public");
  });
});

/**
 * `audienceRule` is the one definition the SQL predicate and the in-process
 * evaluator are both built from, so these pin the definition itself. The keys
 * are already checked against the list by the type; the assertions here fail
 * loudly where a type cannot reach.
 */
describe("audienceRule", () => {
  test("describes exactly the declared audiences", () => {
    expect(Object.keys(audienceRule).sort()).toEqual([...postAudiences].sort());
  });

  test("gives each audience at most one kind of admittance", () => {
    // Both renderers read the flags in order, so a row setting two would quietly
    // render only the first of them — and the SQL and the in-process evaluator
    // would then disagree about who may read the post.
    const flags = (["admitsAnyone", "requiresFollow", "requiresGroupMembership"] as const).flatMap(
      (flag) =>
        Object.entries(audienceRule)
          .filter(([, rule]) => rule[flag])
          .map(([audience]) => audience),
    );
    // Every audience that admits somebody beyond its author appears exactly
    // once; `private` appears not at all, which is what its absence means.
    const admitted = Object.values(audienceRule).filter(
      (rule) => rule.admitsAnyone || rule.requiresFollow || rule.requiresGroupMembership,
    );
    expect(new Set(flags).size).toBe(admitted.length);
  });

  test("keeps every kind of admittance represented", () => {
    // The shape of the rule, not a restatement of it: one audience open to
    // anybody, one gated on a follow edge, one gated on a group membership, and
    // one admitting only the author. A rule that collapsed these would make a
    // whole clause unreachable.
    expect(Object.values(audienceRule).some((rule) => rule.admitsAnyone)).toBe(true);
    expect(Object.values(audienceRule).some((rule) => rule.requiresFollow)).toBe(true);
    expect(Object.values(audienceRule).some((rule) => rule.requiresGroupMembership)).toBe(true);
    expect(
      Object.values(audienceRule).some(
        (rule) => !rule.admitsAnyone && !rule.requiresFollow && !rule.requiresGroupMembership,
      ),
    ).toBe(true);
  });
});

/**
 * The one subset of the list: what a picker may offer.
 *
 * It exists because an audience can be real without being a choice, and the two
 * ways they can drift are both silent — an option with nothing behind it, or an
 * audience enforced by the rule that no surface can select.
 */
describe("composerAudiences", () => {
  test("is drawn from the declared audiences, in their order", () => {
    expect(composerAudiences.length).toBeGreaterThan(0);
    expect([...composerAudiences].sort()).toEqual([...new Set(composerAudiences)].sort());
    const declared = postAudiences.filter((audience) => composerAudiences.includes(audience));
    expect(composerAudiences).toEqual([...declared]);
  });

  test("leaves out the group audience", () => {
    // The one audience a member cannot pick: a post belongs to a group because
    // of where it was written, not because of what the form said.
    expect(composerAudiences).not.toContain("group");
    expect(postAudiences).toContain("group");
  });

  test("leaves out nothing else", () => {
    // The other three are all choices a member makes on an ordinary post, so a
    // list that quietly dropped one would remove an audience nobody could use.
    const missing = postAudiences.filter(
      (audience) => audience !== "group" && !composerAudiences.includes(audience),
    );
    expect(missing).toEqual([]);
  });
});

/**
 * The same rule evaluated in process, which is what a test without a database —
 * or the fake endpoint in `feed-audience.integration.test.ts` — answers from. It
 * has to agree with the rule, since that is the only thing holding the fake and
 * the SQL together.
 */
describe("canReadPost", () => {
  const author = "author-1";
  const reader = "reader-1";
  const page = "page-1";
  /** A post published by `author` as themselves, or as `page` when given one. */
  const post = (visibility: string, asPageId?: string) => ({
    authorId: author,
    pageId: asPageId,
    visibility,
  });
  const nobody = { author: false, page: false };
  const followsAuthor = { author: true, page: false };
  const followsPage = { author: false, page: true };

  test("admits a post to its author whatever its audience", () => {
    for (const audience of postAudiences) {
      expect(canReadPost(author, post(audience), nobody)).toBe(true);
      expect(canReadPost(author, post(audience), followsAuthor)).toBe(true);
      // The same is true of a Page's post: the admin who pressed publish owns
      // the row, and "Only me" on a Page means that admin rather than nobody.
      expect(canReadPost(author, post(audience, page), nobody)).toBe(true);
    }
  });

  test("admits a stranger to public posts and nothing else", () => {
    expect(canReadPost(reader, post("public"), nobody)).toBe(true);
    expect(canReadPost(reader, post("followers"), nobody)).toBe(false);
    expect(canReadPost(reader, post("private"), nobody)).toBe(false);
    // A Page's public posts are public like anybody's.
    expect(canReadPost(reader, post("public", page), nobody)).toBe(true);
    expect(canReadPost(reader, post("followers", page), nobody)).toBe(false);
    expect(canReadPost(reader, post("private", page), nobody)).toBe(false);
  });

  test("makes a follow edge the only thing that opens a followers-only post", () => {
    expect(canReadPost(reader, post("followers"), followsAuthor)).toBe(true);
    expect(canReadPost(reader, post("public"), followsAuthor)).toBe(true);
    // Following the author does not open a private post.
    expect(canReadPost(reader, post("private"), followsAuthor)).toBe(false);
  });

  test("gates a Page's post on following the Page, not its admin", () => {
    // The two edges are not interchangeable in either direction.
    expect(canReadPost(reader, post("followers", page), followsPage)).toBe(true);
    expect(canReadPost(reader, post("followers", page), followsAuthor)).toBe(false);
    expect(canReadPost(reader, post("followers"), followsPage)).toBe(false);
  });

  test("does not let the Page edge open a private Page post", () => {
    expect(canReadPost(reader, post("private", page), followsPage)).toBe(false);
    expect(canReadPost(reader, post("private", page), { author: true, page: true })).toBe(false);
  });

  test("answers for every audience exactly as the rule says", () => {
    for (const [audience, rule] of Object.entries(audienceRule)) {
      expect(canReadPost(reader, post(audience), nobody)).toBe(rule.admitsAnyone);
      expect(canReadPost(reader, post(audience), followsAuthor)).toBe(
        rule.admitsAnyone || rule.requiresFollow,
      );
      // A Page's post answers the same way, from the edge to the Page.
      expect(canReadPost(reader, post(audience, page), nobody)).toBe(rule.admitsAnyone);
      expect(canReadPost(reader, post(audience, page), followsPage)).toBe(
        rule.admitsAnyone || rule.requiresFollow,
      );
    }
  });

  test("opens a group post to its members and to nobody else", () => {
    const inGroup = new Set(["group-1"]);
    const grouped = { authorId: author, groupId: "group-1", visibility: "group" };
    expect(canReadPost(reader, grouped, nobody, inGroup)).toBe(true);
    // A member of a different group is a stranger to this post, and so is a
    // member of no group at all: the set is the whole of the evidence.
    expect(canReadPost(reader, grouped, nobody, new Set(["group-2"]))).toBe(false);
    expect(canReadPost(reader, grouped, nobody, new Set())).toBe(false);
  });

  test("does not open a group post through a follow edge", () => {
    // The two edges are not interchangeable: following the author of a group
    // post is not being in the group it was written in.
    expect(
      canReadPost(reader, { authorId: author, groupId: "group-1", visibility: "group" }, followsAuthor),
    ).toBe(false);
    expect(canReadPost(reader, { authorId: author, groupId: "group-1", visibility: "group" }, followsPage)).toBe(
      false,
    );
  });

  test("admits a group post with no group to its author alone", () => {
    // A `group` row whose group is missing matches no membership, so the only
    // reader left is the person who wrote it. Both sides have to say so: the SQL
    // compares a null outer column, and this asks for one.
    const orphan = { authorId: author, groupId: null, visibility: "group" };
    expect(canReadPost(reader, orphan, nobody, new Set(["group-1"]))).toBe(false);
    expect(canReadPost(author, orphan, nobody, new Set())).toBe(true);
  });

  test("does not let a group membership open anything else", () => {
    const inGroup = new Set(["group-1"]);
    for (const audience of ["public", "followers", "private"] as const) {
      expect(canReadPost(reader, { authorId: author, groupId: "group-1", visibility: audience }, nobody, inGroup)).toBe(
        audience === "public",
      );
    }
  });

  test("treats an audience nobody declared as author-only", () => {
    // What the SQL predicate does with an unknown `visibility`: no clause
    // matches, so only the authorship check can, and both sides fail closed.
    expect(canReadPost(reader, post("close-friends"), followsAuthor)).toBe(false);
    expect(canReadPost(author, post("close-friends"), nobody)).toBe(true);
  });
});
