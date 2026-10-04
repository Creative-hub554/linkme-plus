import { sql, type SQL } from "drizzle-orm";
import { audienceRule, type PostAudience } from "@/lib/post-audiences";
import { follows, groupMembers, pageFollows, posts } from "@/lib/db/schema";

/**
 * Our own audience names, straight out of {@link audienceRule}, so interpolating
 * them is safe. They are inlined rather than bound so the predicate still reads
 * in an `EXPLAIN`: the audience is part of the query's shape, not a reader's
 * data.
 */
function audienceLiteral(visibility: PostAudience): SQL {
  return sql.raw(`'${visibility}'`);
}

/**
 * The follow edge a `followers` post is gated on: the one to its subject.
 *
 * Two arms, because a post has one of two subjects. One published by a member
 * is gated on following that member; one published as a Page is gated on
 * following the Page. The first arm carries `page_id is null` so it is not
 * merely less specific but *inapplicable* to a Page's post — without it, a
 * member who follows the admin of a Page would be admitted to that Page's
 * followers-only posts, which is the bug this clause exists to prevent. (The
 * second arm needs no such guard: `pf.page_id = null` matches nothing.)
 *
 * Read as a whole: "somebody the viewer follows is the subject of this post".
 */
function followEdgeClause(viewerId: string): SQL {
  return sql`(
        exists (
          select 1 from ${follows} as f
          where f.follower_id = ${viewerId}
            and f.following_id = ${posts.authorId}
            and ${posts.pageId} is null
        )
        or exists (
          select 1 from ${pageFollows} as pf
          where pf.user_id = ${viewerId} and pf.page_id = ${posts.pageId}
        )
      )`;
}

/**
 * The membership a `group` post is gated on: the viewer's row in the group the
 * post was published into.
 *
 * Read as a whole: "the viewer belongs to the group this post is in". A post
 * with no group cannot match — `gm.group_id = null` is never true — which is the
 * right answer for a `group` post that was never given one: nobody is a member
 * of the group it is not in, so it stays with its author alone.
 */
function groupMembershipClause(viewerId: string): SQL {
  return sql`(
        exists (
          select 1 from ${groupMembers} as gm
          where gm.group_id = ${posts.groupId} and gm.user_id = ${viewerId}
        )
      )`;
}

/** One audience's clause, or `null` when it admits only the post's author. */
function audienceClause(visibility: PostAudience, viewerId: string): SQL | null {
  const rule = audienceRule[visibility];
  if (rule.admitsAnyone) {
    return sql`${posts.visibility} = ${audienceLiteral(visibility)}`;
  }
  if (rule.requiresFollow) {
    return sql`(
      ${posts.visibility} = ${audienceLiteral(visibility)}
      and ${followEdgeClause(viewerId)}
    )`;
  }
  if (rule.requiresGroupMembership) {
    return sql`(
      ${posts.visibility} = ${audienceLiteral(visibility)}
      and ${groupMembershipClause(viewerId)}
    )`;
  }
  // Author-only: there is deliberately no clause. Such a row can still qualify
  // on authorship below, which is the only way a private post is ever read.
  return null;
}

/**
 * The rows of `posts` a member is allowed to read.
 *
 * `visibility` is an audience, not a label: a `private` post belongs to its
 * author alone, a `followers` post to the author and anybody following **its
 * subject** — the member, or the Page it was published as — and a `group` post
 * to the author and the members of its group. Every query that returns posts —
 * the feed, a profile's posts, a Page's posts, a group's posts, targeted id
 * lookups, search, engagement counts — has to say so, or a post marked private
 * is served to whoever asks for it.
 *
 * The group arm is what puts a post published in a group into the feed of the
 * people who joined it, and only theirs: the feed asks for no group and gets
 * every post the reader may see, which is exactly the set of groups they are in.
 *
 * Rendered from `audienceRule` in `@/lib/post-audiences`, the same rule
 * `canReadPost` evaluates in process, so the audiences admitted here are exactly
 * the ones that list declares.
 *
 * Spelled out as subqueries against `follows`, `page_follows` and
 * `group_members` rather than joins, so it can be dropped into any of those
 * queries without changing their row shape. The outer columns are referenced
 * through drizzle's table objects.
 * That is safe in the predicate — but it is a measured fact rather than a
 * property of the library, and the measurement is the reason `page_id` may be
 * interpolated at all: an *unqualified* `page_id` inside the second subquery
 * would resolve to `page_follows.page_id`, turning the arm into
 * `pf.page_id = pf.page_id` and admitting every reader. `post-visibility.test.ts`
 * renders this predicate through the query builder, single-table *and* joined,
 * and fails if the qualifier is ever dropped. (Drizzle does drop qualifiers, but
 * in the select list rather than in `where` — which is why `posts/counts`
 * spells its own outer references out; see the note there.)
 */
export function visiblePostsCondition(viewerId: string): SQL {
  const clauses = (Object.keys(audienceRule) as PostAudience[])
    .map((visibility) => audienceClause(visibility, viewerId))
    .filter((clause): clause is SQL => clause !== null);

  return sql`(
    ${posts.authorId} = ${viewerId}
    or ${sql.join(clauses, sql`\n    or `)}
  )`;
}
