import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adCampaigns,
  boostedPostCampaigns,
  creatorBoostMemberships,
  follows,
  moderationActions,
  posts,
  reactions,
  users,
} from "@/lib/db/schema";
import {
  CREATOR_BOOST_REQUIREMENTS,
  evaluateCreatorBoost,
  type CreatorBoostEligibility,
  type CreatorBoostTier,
} from "@/lib/creator-boost";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const PAID_OR_REVIEWED_BOOST_STATUSES = [
  "pending_review",
  "approved",
  "scheduled",
  "active",
  "paused",
  "completed",
] as const;

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * MILLIS_PER_DAY);
}

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Recomputes every criterion from first-party activity. Paid delivery is
 * excluded from likes by excluding reactions on posts with a paid or reviewed
 * boost campaign. The thirty-post denominator remains fixed, so paid reach
 * cannot improve the average by shrinking its denominator either.
 */
export async function getCreatorBoostEligibility(userId: string, now = new Date()): Promise<CreatorBoostEligibility> {
  const periodStart = daysAgo(now, CREATOR_BOOST_REQUIREMENTS.accountAgeDays);
  const [[account], [{ followers }], moderation, recentPosts] = await Promise.all([
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ followers: count() }).from(follows).where(eq(follows.followingId, userId)),
    db
      .select({ id: moderationActions.id })
      .from(moderationActions)
      .where(
        and(
          eq(moderationActions.targetType, "user"),
          eq(moderationActions.targetId, userId),
          inArray(moderationActions.action, ["suspension", "ban"]),
        ),
      )
      .limit(1),
    db
      .select({ id: posts.id, type: posts.type })
      .from(posts)
      .where(
        and(
          eq(posts.authorId, userId),
          eq(posts.visibility, "public"),
          isNull(posts.deletedAt),
          gte(posts.createdAt, periodStart),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(CREATOR_BOOST_REQUIREMENTS.minPublicPosts),
  ]);

  const recentPostIds = recentPosts.map((post) => post.id);
  const [boostedRows, likesByPost] = recentPostIds.length
    ? await Promise.all([
        db
          .select({ postId: boostedPostCampaigns.postId })
          .from(boostedPostCampaigns)
          .innerJoin(adCampaigns, eq(boostedPostCampaigns.campaignId, adCampaigns.id))
          .where(
            and(
              inArray(boostedPostCampaigns.postId, recentPostIds),
              inArray(adCampaigns.status, PAID_OR_REVIEWED_BOOST_STATUSES),
            ),
          ),
        db
          .select({ postId: reactions.targetId, likes: count(reactions.id) })
          .from(reactions)
          .where(
            and(
              eq(reactions.targetType, "post"),
              eq(reactions.type, "like"),
              inArray(reactions.targetId, recentPostIds),
            ),
          )
          .groupBy(reactions.targetId),
      ])
    : [[], []] as const;

  const boostedPostIds = new Set(boostedRows.map((row) => row.postId));
  const likes = new Map(likesByPost.map((row) => [row.postId, Number(row.likes)]));
  const organicLikes = recentPostIds.reduce(
    (total, postId) => total + (boostedPostIds.has(postId) ? 0 : likes.get(postId) ?? 0),
    0,
  );
  const accountAgeDays = account ? Math.floor((now.getTime() - account.createdAt.getTime()) / MILLIS_PER_DAY) : 0;

  return evaluateCreatorBoost({
    followers: Number(followers ?? 0),
    publicPosts: recentPosts.length,
    shortVideos: recentPosts.filter((post) => post.type === "short_video").length,
    averageOrganicLikes: Math.floor(organicLikes / CREATOR_BOOST_REQUIREMENTS.minPublicPosts),
    accountAgeDays,
    goodStanding: moderation.length === 0,
  });
}

export interface CreatorBoostBenefit {
  tier: CreatorBoostTier;
  discountUsesThisMonth: number;
}

/** The programme entitlement, without consuming a discounted-boost allowance. */
export async function getActiveCreatorMembership(userId: string, now = new Date()): Promise<{ tier: CreatorBoostTier } | null> {
  const [membership] = await db
    .select({ tier: creatorBoostMemberships.tier })
    .from(creatorBoostMemberships)
    .where(
      and(
        eq(creatorBoostMemberships.userId, userId),
        eq(creatorBoostMemberships.status, "approved"),
        sql`${creatorBoostMemberships.expiresAt} > ${now}`,
      ),
    )
    .limit(1);
  return membership?.tier ? { tier: membership.tier } : null;
}

/** An approved benefit is usable only until its 30-day review period ends. */
export async function getCreatorBoostBenefit(userId: string, now = new Date()): Promise<CreatorBoostBenefit | null> {
  const membership = await getActiveCreatorMembership(userId, now);
  if (!membership) return null;

  const [{ uses }] = await db
    .select({ uses: count() })
    .from(adCampaigns)
    .where(
      and(
        eq(adCampaigns.advertiserId, userId),
        gte(adCampaigns.createdAt, monthStart(now)),
        sql`${adCampaigns.creatorDiscountPercent} > 0`,
      ),
    );

  const discountUsesThisMonth = Number(uses ?? 0);
  if (discountUsesThisMonth >= CREATOR_BOOST_REQUIREMENTS.discountedBoostsPerMonth) return null;
  return { tier: membership.tier, discountUsesThisMonth };
}
