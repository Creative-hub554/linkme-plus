/**
 * The audiences a post can be published to, and what each one means.
 *
 * This is the only list in the codebase. Everything that needs to know which
 * audiences exist derives from it: the `visibility` enum in the database, the
 * rule below (and so both its SQL rendering and its in-process evaluation), the
 * post card's pill, and the API's reading of what a client may send. Before this
 * module they were five separate lists, which is how the picker could offer an
 * audience the predicate did not enforce. The composer's picker is the one
 * deliberate subset of the list — see {@link composerAudiences} for why.
 *
 * Deliberately free of drizzle and React, so both the server and the UI can
 * import it.
 */

/**
 * Every audience a post can be published to.
 *
 * `group` is here because a post published into a group is a post whose readers
 * are that group's members, and an audience is exactly what this module is for —
 * so the feed, the group's own page and every other query learns who may read it
 * from the same rule, rather than each growing its own membership check.
 *
 * It is deliberately not offered in a picker: see {@link composerAudiences}.
 */
export const postAudiences = ["public", "followers", "private", "group"] as const;

export type PostAudience = (typeof postAudiences)[number];

/**
 * What each audience is called where a member reads it — the picker's trigger,
 * its menu, and the pill on a post all say the same thing.
 */
export const audienceLabel: Record<PostAudience, string> = {
  public: "Public",
  followers: "Followers",
  private: "Only me",
  group: "Group members",
};

/**
 * The audiences a composer's picker may offer, which is not the same list as
 * {@link postAudiences}.
 *
 * `group` is missing on purpose. It is not a choice a member makes about a post
 * — it is what publishing *into a group* means, and the group is what the
 * composer was opened in. Offering it beside Public and Private would let
 * somebody pick "Group members" for a post with no group on it, which is a post
 * then readable by nobody at all, its author aside. A surface that can honour an
 * audience is a surface that may offer it.
 */
export const composerAudiences: PostAudience[] = ["public", "followers", "private"];

/**
 * Who one audience admits **beyond the post's author**. The author is admitted
 * by every audience, which is why that is not repeated per row.
 */
interface AudienceRule {
  /** Readable by any signed-in member. */
  admitsAnyone: boolean;
  /**
   * Readable by a member following **the post's subject** — the member who
   * published it, or the Page it was published as. Which edge that is is a
   * property of the post rather than of the audience, so it is decided in
   * {@link canReadPost} (and, for SQL, in the renderer) rather than here.
   */
  requiresFollow: boolean;
  /**
   * Readable by a member of **the group the post was published into**, read from
   * the post's `groupId`. Like `requiresFollow`, *which* group is a property of
   * the post rather than of the audience, and is looked up by the caller.
   */
  requiresGroupMembership: boolean;
}

/**
 * The audience rule: what a `visibility` means, in one place.
 *
 * {@link visiblePostsCondition} renders it to SQL for the queries;
 * {@link canReadPost} evaluates it in process, so a test or an in-process fake
 * can answer for the server without restating the rule and drifting from it.
 *
 * Keyed by {@link PostAudience}, so an audience added to the list above fails
 * the build until somebody decides who it admits. Two flags describe the two
 * kinds of admittance, and they are mutually exclusive (asserted in the tests)
 * because the renderers read them in that order.
 *
 * Only *what* an audience admits belongs here. *How* to ask the database about
 * it — the shape of the follow-edge subquery — belongs in the renderer, since
 * no other form can express it.
 */
export const audienceRule = {
  public: { admitsAnyone: true, requiresFollow: false, requiresGroupMembership: false },
  followers: { admitsAnyone: false, requiresFollow: true, requiresGroupMembership: false },
  private: { admitsAnyone: false, requiresFollow: false, requiresGroupMembership: false },
  group: { admitsAnyone: false, requiresFollow: false, requiresGroupMembership: true },
} as const satisfies Record<PostAudience, AudienceRule>;

/** The rule for a stored `visibility`, or `null` for a value we do not know. */
export function audienceRuleFor(visibility: string): AudienceRule | null {
  return (audienceRule as Record<string, AudienceRule | undefined>)[visibility] ?? null;
}

/**
 * Whether a value off the wire is an audience this code knows.
 *
 * Built from the list rather than checking the names one by one, so narrowing
 * and the rule can never disagree about which audiences exist.
 */
export function isPostAudience(value: unknown): value is PostAudience {
  return typeof value === "string" && (postAudiences as readonly string[]).includes(value);
}

/**
 * Narrows whatever a post carries into an audience the UI can show.
 *
 * Posts reach the UI from the API, from Realtime and from the database enum, so
 * the value is only trusted after being checked. Anything unrecognised reads as
 * `public` — the first audience, which is the same fallback the API's create
 * path uses.
 */
export function toPostAudience(value: unknown): PostAudience {
  return isPostAudience(value) ? value : postAudiences[0];
}

/**
 * The follow edges a viewer may hold, for the two kinds of subject a post can
 * have. Both are reported because the caller has to read the post to know which
 * one to look up, and one round trip answers both.
 */
export interface FollowEdges {
  /** The viewer follows the member who published the post. */
  author: boolean;
  /** The viewer follows the Page the post was published as. */
  page: boolean;
}

/**
 * {@link audienceRule} evaluated in process: whether `viewer` may read a post.
 *
 * The author, then whatever the audience admits. The author is admitted by every
 * audience, and on a Page's post that means the admin who pressed publish — the
 * person the row belongs to, which is also what the edit and delete checks
 * compare against.
 *
 * A `followers` post is gated on following **its subject**: the member for a
 * post they published as themselves, the Page for one published as a Page. The
 * two are not interchangeable — a member who follows the admin of a Page cannot
 * read that Page's followers-only posts, and following the Page does not admit
 * the member's own — which is why `pageId` decides the edge rather than either
 * edge being enough.
 *
 * A `group` post is gated on belonging to **its group**, which the viewer says
 * by handing over the ids they are a member of. An empty set is the honest
 * answer for a viewer whose memberships were not looked up, and it fails closed.
 *
 * A `visibility` nobody knows matches no clause of `visiblePostsCondition`
 * either, so both sides fail closed to the author alone.
 */
export function canReadPost(
  viewerId: string,
  post: { authorId: string; pageId?: string | null; groupId?: string | null; visibility: string },
  viewerFollows: FollowEdges,
  viewerGroupIds: ReadonlySet<string> = new Set(),
): boolean {
  if (post.authorId === viewerId) return true;

  const rule = audienceRuleFor(post.visibility);
  if (!rule) return false;
  if (rule.admitsAnyone) return true;
  if (rule.requiresGroupMembership) {
    // A `group` post with no group is readable by nobody but its author: there
    // is no set of members it belongs to. Fail closed rather than fall through.
    return Boolean(post.groupId) && viewerGroupIds.has(post.groupId as string);
  }
  if (!rule.requiresFollow) return false;

  return post.pageId ? viewerFollows.page : viewerFollows.author;
}
