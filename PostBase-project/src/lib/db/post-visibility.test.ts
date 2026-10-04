import { describe, expect, test } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { audienceRule } from "@/lib/post-audiences";
import { posts, users } from "@/lib/db/schema";

/**
 * A query builder with no driver behind it. Only `toSQL()` is used, so nothing
 * ever connects — what is being measured is how drizzle *renders* the predicate
 * inside a real query, which is a different question from what the predicate
 * says on its own (see the qualifier tests below).
 */
const builder = drizzle({} as never);

/**
 * Renders the predicate exactly as the query builder would embed it, without a
 * database: `PgDialect` turns drizzle's SQL object into text plus bindings.
 *
 * The audiences themselves are defined and tested in `@/lib/post-audiences`;
 * what is pinned here is the SQL this file renders them into, which no test can
 * evaluate.
 */
function compile(viewerId: string) {
  return new PgDialect().sqlToQuery(visiblePostsCondition(viewerId));
}

describe("visiblePostsCondition", () => {
  test("admits public posts to any reader", () => {
    expect(compile("viewer-1").sql).toMatch(/"visibility" = 'public'/);
  });

  test("admits followers-only posts, gated on a follow edge to the author", () => {
    const { sql } = compile("viewer-1");
    expect(sql).toMatch(/"visibility" = 'followers'/);
    expect(sql).toContain("exists");
    // The edge has to be the *reader* following the *post's author*; matching on
    // the wrong side would either leak or hide every followers-only post.
    expect(sql).toMatch(
      /f\.follower_id = \$2\s+and\s+f\.following_id = "posts"\."author_id"/,
    );
  });

  test("gates a member's post on the author edge only, never on a Page edge", () => {
    const { sql } = compile("viewer-1");
    // The author arm has to be inapplicable to a Page's post rather than merely
    // less specific: without this the admin's followers would be let into the
    // followers-only posts of a Page they are not following.
    expect(sql).toMatch(/f\.following_id = "posts"\."author_id"\s+and "posts"\."page_id" is null/i);
  });

  test("gates a Page's post on following the Page, not the member who posted it", () => {
    const { sql } = compile("viewer-1");
    expect(sql).toMatch(/from "page_follows" as pf/);
    expect(sql).toMatch(/pf\.user_id = \$3\s+and\s+pf\.page_id = "posts"\."page_id"/);
  });

  test("admits a group post to the group's members, and to nobody else", () => {
    const { sql } = compile("viewer-1");
    expect(sql).toMatch(/"visibility" = 'group'/);
    expect(sql).toMatch(/from "group_members" as gm/);
    // The membership has to be a row in *this post's* group. An unqualified
    // `group_id` here would resolve to `group_members`'s own column and turn the
    // arm into `gm.group_id = gm.group_id`, which every row satisfies — the same
    // trap the Page arm is qualified against.
    expect(sql).toMatch(/gm\.group_id = "posts"\."group_id"\s+and\s+gm\.user_id = \$4/);
  });

  test("admits a group post to its author whatever the group's membership", () => {
    // Authorship is the clause outside the audience arms, so a `group` post is
    // still its writer's even if they have since left the group.
    expect(compile("viewer-1").sql).toMatch(/"author_id" = \$1/);
  });

  test("admits a post to its author whatever its audience", () => {
    expect(compile("viewer-1").sql).toMatch(/"author_id" = \$1/);
  });

  test("never admits a private post to anyone but its author", () => {
    // Author-only is expressed by exclusion: there is deliberately no `private`
    // branch, so the only way a private row qualifies is the authorship check.
    expect(compile("viewer-1").sql).not.toContain("'private'");
  });

  test("binds the reader to the authorship, both follow edges and the membership", () => {
    // Authorship, the edge to the author, the edge to the Page, the membership
    // of the group — every one of them is *this* reader, and nothing else is
    // bound.
    expect(compile("viewer-1").params).toEqual([
      "viewer-1",
      "viewer-1",
      "viewer-1",
      "viewer-1",
    ]);
  });

  test("binds each reader's own id rather than a shared value", () => {
    expect(compile("reader-a").params).toEqual(["reader-a", "reader-a", "reader-a", "reader-a"]);
    expect(compile("reader-b").params).toEqual(["reader-b", "reader-b", "reader-b", "reader-b"]);
  });

  test("asks each edge of the reader and of the post, never of one another", () => {
    const { sql } = compile("viewer-1");
    // Every `exists` compares a reader-bound column to an outer post column.
    // A subquery whose correlation ran the other way would answer about
    // somebody else's follow graph entirely.
    expect(sql.match(/f\.follower_id = \$/g)).toHaveLength(1);
    expect(sql.match(/pf\.user_id = \$/g)).toHaveLength(1);
    expect(sql.match(/gm\.user_id = \$/g)).toHaveLength(1);
    // Once as the authorship check, once as the arm's correlation.
    expect(sql.match(/"posts"\."author_id"/g)).toHaveLength(2);
    expect(sql.match(/"posts"\."page_id"/g)).toHaveLength(2);
    expect(sql.match(/"posts"\."group_id"/g)).toHaveLength(1);
  });
});

/** The predicate has to be a faithful rendering of the rule, audience by audience. */
describe("visiblePostsCondition rendered from the rule", () => {
  test("names every audience that admits somebody, and no other", () => {
    const { sql } = compile("viewer-1");
    for (const [audience, rule] of Object.entries(audienceRule)) {
      if (rule.admitsAnyone || rule.requiresFollow || rule.requiresGroupMembership) {
        expect(sql).toContain(`'${audience}'`);
      } else {
        // Admitting only the author is the absence of a clause — the authorship
        // check is all that may match such a row.
        expect(sql).not.toContain(`'${audience}'`);
      }
    }
  });

  test("gates every audience that needs an edge of its own, on that edge", () => {
    const { sql } = compile("viewer-1");
    const rules = Object.values(audienceRule);
    const gated = rules.filter((rule) => rule.requiresFollow);
    const membershipGated = rules.filter((rule) => rule.requiresGroupMembership);
    expect(gated.length).toBeGreaterThan(0);
    expect(membershipGated.length).toBe(1);
    // Two lookups per follow-gated audience — one for each kind of subject a
    // post can have — and one per group-gated audience, whose subject is not a
    // choice. So none is rendered ungated, and none pays for a lookup it cannot
    // use.
    expect(sql.match(/exists/g)).toHaveLength(gated.length * 2 + membershipGated.length);
  });

  test("gates the group audience on a membership rather than on a follow", () => {
    const { sql } = compile("viewer-1");
    // The two kinds of edge are not interchangeable: a member who is not a
    // follower can read the group's posts, and a follower who never joined
    // cannot. So the group arm must not be built out of the follow clause, and
    // the follow arms must not mention `group_members`.
    expect(sql.match(/group_members/g)).toHaveLength(1);
    expect(sql.match(/from "follows" as f/g)).toHaveLength(1);
    expect(sql.match(/from "page_follows" as pf/g)).toHaveLength(1);
  });
});

/**
 * How the predicate renders *inside a query*, which is where a correlated
 * column can be quietly renamed out from under it.
 *
 * Drizzle drops a table's qualifier when a query has a single table, and it does
 * so in the select list: an interpolated `${posts.id}` there becomes a bare
 * `"id"`. That is a documented trap in `posts/counts`, where the correlated
 * subquery is a *field* and the outer reference has to be spelled out by hand.
 * This predicate is only ever a `where`, and the measurement here is what makes
 * that difference load-bearing: `page_follows` has a `page_id` of its own, so an
 * unqualified `${posts.pageId}` inside `pf.page_id = "page_id"` would compare the
 * subquery's column to itself, and every follower check would pass.
 */
describe("visiblePostsCondition inside a query", () => {
  test("keeps the post's columns qualified in a single-table query", () => {
    const { sql } = builder
      .select({ id: posts.id })
      .from(posts)
      .where(visiblePostsCondition("viewer-1"))
      .toSQL();

    expect(sql).toMatch(/"posts"\."page_id" is null/i);
    expect(sql).toMatch(/pf\.page_id = "posts"\."page_id"/);
    expect(sql).toMatch(/gm\.group_id = "posts"\."group_id"/);
    // The trap this test exists for, stated as the thing that must not appear.
    expect(sql).not.toMatch(/pf\.page_id = "page_id"/);
    expect(sql).not.toMatch(/gm\.group_id = "group_id"/);
  });

  test("keeps them qualified in a joined query too", () => {
    const { sql } = builder
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(visiblePostsCondition("viewer-1"))
      .toSQL();

    expect(sql).toMatch(/pf\.page_id = "posts"\."page_id"/);
    expect(sql).toMatch(/gm\.group_id = "posts"\."group_id"/);
  });
});
