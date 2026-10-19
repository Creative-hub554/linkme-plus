import { db } from "@/lib/db";
import {
  adCampaigns,
  adMetrics,
  boostedPostCampaigns,
  comments,
  pages,
  postMedia,
  posts,
  profiles,
  reactions,
  users,
} from "@/lib/db/schema";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { DAILY_IMPRESSION_CAP, dayStart } from "@/lib/ads/boosts";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

/** How many campaigns are considered before the caps are applied. */
const CONSIDER_LIMIT = 10;

/**
 * The sponsored posts the home feed carries, in the feed's own shape.
 *
 * A boosted post is served, not inserted: it arrives through the same joins and
 * the same per-post counts the organic feed builds, so the card that renders it
 * is the same card, and a sponsored post that a reader cannot otherwise see
 * (a `followers` post, a post from a Page they do not follow) is filtered by
 * the same audience rule rather than by the campaign that bought it. Money
 * buys placement, not access.
 *
 * Two caps decide who is served, and both are read rather than assumed. A
 * campaign that has already served {@link DAILY_IMPRESSION_CAP} impressions
 * today steps aside — the stand-in for the frequency caps the PRD asks for —
 * and a post already in the reader's page of the feed is dropped rather than
 * shown twice under two names.
 */
export async function sponsoredFeedPosts(options: {
  readerId: string;
  /** Posts already in the page of feed being answered, so none appears twice. */
  excludePostIds: string[];
  /** How many sponsored posts this page of feed may carry. */
  limit: number;
}) {
  const { readerId, excludePostIds, limit } = options;
  if (limit <= 0) return [];

  const now = new Date();

  const candidates = await db
    .select({
      campaignId: adCampaigns.id,
      budget: adCampaigns.budget,
      postId: boostedPostCampaigns.postId,
    })
    .from(adCampaigns)
    .innerJoin(boostedPostCampaigns, eq(adCampaigns.id, boostedPostCampaigns.campaignId))
    .where(
      and(
        eq(adCampaigns.status, "active"),
        lte(adCampaigns.startDate, now),
        gte(adCampaigns.endDate, now),
      ),
    )
    .limit(CONSIDER_LIMIT);

  if (candidates.length === 0) return [];

  const today = dayStart(now).getTime();
  const metrics = await db
    .select()
    .from(adMetrics)
    .where(
      and(
        inArray(
          adMetrics.campaignId,
          candidates.map((candidate) => candidate.campaignId),
        ),
        gte(adMetrics.date, dayStart(now)),
      ),
    );

  const servedToday = new Map<string, number>();
  for (const row of metrics) {
    if (new Date(row.date).getTime() < today) continue;
    servedToday.set(row.campaignId, (servedToday.get(row.campaignId) ?? 0) + (row.impressions ?? 0));
  }

  const eligible = candidates
    .filter(
      (candidate) =>
        (servedToday.get(candidate.campaignId) ?? 0) < DAILY_IMPRESSION_CAP &&
        !excludePostIds.includes(candidate.postId),
    )
    .slice(0, limit);

  if (eligible.length === 0) return [];

  const rows = await db
    .select({
      id: posts.id,
      content: posts.content,
      type: posts.type,
      visibility: posts.visibility,
      createdAt: posts.createdAt,
      editedAt: posts.editedAt,
      commentCount: sql<number>`(
        select count(*)::int from ${comments} as c
        where c.post_id = "posts"."id" and c.deleted_at is null
      )`,
      reactionCount: sql<number>`(
        select count(*)::int from ${reactions} as r
        where r.target_type = 'post' and r.target_id = "posts"."id"
      )`,
      author: {
        id: users.id,
        name: sql<string | null>`coalesce(${profiles.displayName}, ${users.username})`,
        username: users.username,
        avatarUrl: profiles.avatarUrl,
        verified: users.verified,
      },
      page: {
        id: pages.id,
        username: pages.username,
        name: pages.name,
        avatarUrl: pages.avatarUrl,
      },
      campaignId: adCampaigns.id,
      // What the campaign asked to reach, so the card can say why it is there
      // without the reader having to guess. Nothing about the *reader* is
      // exposed: targeting is the advertiser's wish, not a description of
      // whoever it landed on.
      targetLocation: adCampaigns.targetLocation,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .innerJoin(pages, eq(posts.pageId, pages.id))
    .innerJoin(boostedPostCampaigns, eq(boostedPostCampaigns.postId, posts.id))
    .innerJoin(adCampaigns, eq(adCampaigns.id, boostedPostCampaigns.campaignId))
    .where(
      and(
        inArray(
          posts.id,
          eligible.map((candidate) => candidate.postId),
        ),
        sql`${posts.deletedAt} IS NULL`,
        eq(posts.visibility, "public"),
        visiblePostsCondition(readerId),
      ),
    )
    .limit(limit);

  if (rows.length === 0) return [];

  const media = await db
    .select()
    .from(postMedia)
    .where(
      inArray(
        postMedia.postId,
        rows.map((row) => row.id),
      ),
    );

  const mediaByPostId = new Map<string, typeof media>();
  for (const item of media) {
    const forPost = mediaByPostId.get(item.postId) ?? [];
    forPost.push(item);
    mediaByPostId.set(item.postId, forPost);
  }

  return rows.map((row) => ({
    ...row,
    media: mediaByPostId.get(row.id) ?? [],
    sponsored: true as const,
  }));
}

/**
 * Whether the request being answered is a home feed at all.
 *
 * A Page's own timeline, a group's, a member's, a targeted hydration and every
 * page after the first are the reader's own scrolling; a sponsored post belongs
 * to the front page of that scroll and nowhere else, which is what keeps a
 * boost from appearing in a feed the reader asked to be narrow.
 */
export function isHomeFeed(query: URLSearchParams): boolean {
  return (
    !query.get("authorId") &&
    !query.get("pageId") &&
    !query.get("groupId") &&
    !query.get("ids") &&
    !query.get("cursor")
  );
}
