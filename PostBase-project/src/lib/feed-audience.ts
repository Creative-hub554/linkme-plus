/**
 * The feed's audience rules, kept out of the component so they can be read and
 * tested on their own.
 *
 * All of them follow from one fact: a `followers` post is readable exactly while
 * the reader follows **its subject** — the member who published it, or the Page
 * it was published as (see `canReadPost`). So a follow can bring a member's posts
 * in, an unfollow can take them out, and an edit that narrows an audience can put
 * a post out of the reader's reach — all without the post itself being created or
 * deleted. A `group` post is admitted by a different edge again, a membership of
 * its group, and joining or leaving one moves its cards the same way (see
 * `groupLossEffect`). Following a *Page* is the same story told by the Page's own
 * view, which re-reads its posts; the feed never sees that edge. The server decides
 * *who may read* a post (see `visiblePostsCondition`);
 * these are the client's corresponding reactions, and none of them guesses:
 * anything a card cannot decide is left to `GET /api/posts`.
 */

/** What these rules need from a card. */
export interface AudiencePost {
  id: string;
  createdAt: string;
  visibility?: string | null;
  author: { id?: string | null };
  /**
   * Set when a Page published the post. Its audience is gated on following the
   * Page rather than the member, so a card that carries one cannot be settled by
   * a follow edge to its author alone — see {@link followLossEffect}.
   */
  page?: { id?: string | null } | null;
  /**
   * Set when the post was published into a group. Its audience is gated on
   * membership of that group rather than a follow edge, so a card that carries
   * one is moved by a membership change and nothing else — see
   * {@link groupLossEffect}.
   */
  group?: { id?: string | null } | null;
  /** Set on a post the server has not confirmed yet. */
  pending?: boolean;
}

/** Newest first — the feed's single ordering rule. */
export function newestFirst(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * How an edge that just went away changes the cards on screen: what to remove at
 * once, and what only the API can settle.
 */
export interface AudienceLossEffect {
  /** Cards to remove at once, because the edge was what was showing them. */
  drop: string[];
  /** Cards to ask the API about: an audience a card cannot settle by itself. */
  recheck: string[];
}

/** The shape {@link followLossEffect} reports, kept as its own name for callers. */
export type FollowLossEffect = AudienceLossEffect;

/**
 * What losing a follow edge does to the cards on screen.
 *
 * A `public` post is unaffected, and a `private` one could not have been on
 * screen at all — so a `followers` post by that member **as themselves** goes
 * immediately, and anything else is left to the API rather than guessed at.
 *
 * A `followers` post that belongs to a *Page* is that anything else: the edge
 * that admits a reader to it is the one to the Page, so losing the edge to its
 * author says nothing about it — an admin can run a Page whose followers include
 * people who do not follow the admin at all. It is rechecked rather than kept,
 * because the API's answer is the one that counts and the member may have
 * unfollowed for a reason that does not move this card.
 *
 * Optimistic cards are skipped: they are the reader's own, and no follow edge of
 * theirs is what put them there.
 */
export function followLossEffect(posts: AudiencePost[], authorId: string): AudienceLossEffect {
  const drop: string[] = [];
  const recheck: string[] = [];

  for (const post of posts) {
    if (post.pending || post.author.id !== authorId) continue;
    if (post.visibility === "followers") {
      if (post.page?.id) recheck.push(post.id);
      else drop.push(post.id);
    } else if (post.visibility !== "public") recheck.push(post.id);
  }

  return { drop, recheck };
}

/**
 * What losing a group membership does to the cards on screen.
 *
 * A `group` post is readable exactly while the reader is a member of the group
 * it was published into (see `canReadPost`), so leaving that group takes every
 * one of its cards off the screen. The membership is what put them there and
 * nothing else on the card can hold one up, which is why these are dropped
 * outright: the reader is no longer in the room.
 *
 * A card whose audience the client does not know is left to the API, exactly as
 * an unsettled card on a follow loss is: a card is never the authority on what
 * the reader may see. Optimistic cards are skipped — they are the reader's own,
 * and no membership of theirs is what put them there.
 */
export function groupLossEffect(posts: AudiencePost[], groupId: string): AudienceLossEffect {
  const drop: string[] = [];
  const recheck: string[] = [];

  for (const post of posts) {
    if (post.pending) continue;
    if (post.group?.id !== groupId) continue;
    if (post.visibility === "group") drop.push(post.id);
    else if (post.visibility !== "public") recheck.push(post.id);
  }

  return { drop, recheck };
}

/**
 * Adds the posts a follow has just made readable, newest first.
 *
 * Returns `previous` itself when there is nothing to add, so a caller can hand
 * the result straight to state without provoking a needless re-render. Posts are
 * matched by id, so a list that has since gained one of them cannot end up with
 * two, and an *older* revealed post lands in its own place rather than on top.
 */
export function mergeRevealedPosts<T extends AudiencePost>(previous: T[], fetched: T[]): T[] {
  const known = new Set(previous.map((post) => post.id));
  const additions = fetched.filter((post) => {
    if (known.has(post.id)) return false;
    known.add(post.id);
    return true;
  });

  return additions.length === 0 ? previous : [...previous, ...additions].sort(newestFirst);
}

/**
 * Whether a change to a post's audience needs confirming with the API.
 *
 * The reader's own post is never at risk, an unmounted post has no card to drop,
 * and an unchanged audience needs nothing. Everything else is re-read rather than
 * judged here: in practice only a *narrow* can matter, because a widening happens
 * to a post the reader could not have been shown either way.
 */
export function visibilityChangeNeedsRecheck(params: {
  isViewerOwnPost: boolean;
  /** The post as the feed holds it, or undefined when it holds no such post. */
  mounted?: { visibility?: string | null };
  nextVisibility?: string | null;
}): boolean {
  if (params.isViewerOwnPost) return false;
  if (!params.mounted) return false;
  if (params.nextVisibility == null) return false;
  return params.mounted.visibility !== params.nextVisibility;
}

/** What the feed says after a follow brought posts into the list. */
export function revealNoticeMessage(name: string, count: number): string {
  return count === 1
    ? `Following ${name} added 1 post to your feed.`
    : `Following ${name} added ${count} posts to your feed.`;
}

/** What the feed says after joining a group brought posts into the list. */
export function groupRevealNoticeMessage(name: string, count: number): string {
  return count === 1
    ? `Joining ${name} added 1 post to your feed.`
    : `Joining ${name} added ${count} posts to your feed.`;
}
