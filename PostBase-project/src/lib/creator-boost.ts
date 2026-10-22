/**
 * Creator Boost programme rules. This module has no database or request
 * access, so its thresholds and price calculations stay testable and cannot
 * drift between the application, admin review, and checkout paths.
 */
export const CREATOR_BOOST_REQUIREMENTS = {
  minFollowers: 5_000,
  minPublicPosts: 30,
  minShortVideos: 10,
  minAverageOrganicLikes: 200,
  accountAgeDays: 90,
  reviewPeriodDays: 30,
  discountedBoostsPerMonth: 2,
} as const;

export const CREATOR_BOOST_TIERS = ["rising", "established", "star", "icon"] as const;
export type CreatorBoostTier = (typeof CREATOR_BOOST_TIERS)[number];

export const CREATOR_BOOST_BENEFITS: Record<CreatorBoostTier, { label: string; minAverageLikes: number; discountPercent: number }> = {
  rising: { label: "Rising Creator", minAverageLikes: 200, discountPercent: 15 },
  established: { label: "Established Creator", minAverageLikes: 500, discountPercent: 25 },
  star: { label: "Star Creator", minAverageLikes: 1_000, discountPercent: 35 },
  icon: { label: "Icon Creator", minAverageLikes: 3_000, discountPercent: 45 },
};

export interface CreatorBoostMetrics {
  followers: number;
  publicPosts: number;
  shortVideos: number;
  averageOrganicLikes: number;
  accountAgeDays: number;
  goodStanding: boolean;
}

export interface CreatorBoostEligibility {
  eligible: boolean;
  tier: CreatorBoostTier | null;
  reasons: string[];
  metrics: CreatorBoostMetrics;
}

export function tierForAverageOrganicLikes(averageLikes: number): CreatorBoostTier | null {
  if (averageLikes >= CREATOR_BOOST_BENEFITS.icon.minAverageLikes) return "icon";
  if (averageLikes >= CREATOR_BOOST_BENEFITS.star.minAverageLikes) return "star";
  if (averageLikes >= CREATOR_BOOST_BENEFITS.established.minAverageLikes) return "established";
  if (averageLikes >= CREATOR_BOOST_BENEFITS.rising.minAverageLikes) return "rising";
  return null;
}

export function evaluateCreatorBoost(metrics: CreatorBoostMetrics): CreatorBoostEligibility {
  const reasons: string[] = [];
  if (metrics.followers < CREATOR_BOOST_REQUIREMENTS.minFollowers) {
    reasons.push(`At least ${CREATOR_BOOST_REQUIREMENTS.minFollowers.toLocaleString()} followers are required.`);
  }
  if (metrics.publicPosts < CREATOR_BOOST_REQUIREMENTS.minPublicPosts) {
    reasons.push(`At least ${CREATOR_BOOST_REQUIREMENTS.minPublicPosts} public posts in the last 90 days are required.`);
  }
  if (metrics.shortVideos < CREATOR_BOOST_REQUIREMENTS.minShortVideos) {
    reasons.push(`At least ${CREATOR_BOOST_REQUIREMENTS.minShortVideos} short videos in the last 90 days are required.`);
  }
  if (metrics.averageOrganicLikes < CREATOR_BOOST_REQUIREMENTS.minAverageOrganicLikes) {
    reasons.push(`An average of ${CREATOR_BOOST_REQUIREMENTS.minAverageOrganicLikes}+ organic likes across the latest 30 public posts is required.`);
  }
  if (metrics.accountAgeDays < CREATOR_BOOST_REQUIREMENTS.accountAgeDays) {
    reasons.push(`The account must be at least ${CREATOR_BOOST_REQUIREMENTS.accountAgeDays} days old.`);
  }
  if (!metrics.goodStanding) reasons.push("The account must be in good standing.");

  const tier = tierForAverageOrganicLikes(metrics.averageOrganicLikes);
  return { eligible: reasons.length === 0 && tier !== null, tier, reasons, metrics };
}

/** Price to charge for a boost, retaining the whole delivery budget. */
export function creatorBoostPrice(budget: number, tier: CreatorBoostTier | null) {
  const discountPercent = tier ? CREATOR_BOOST_BENEFITS[tier].discountPercent : 0;
  const discountAmount = Math.floor((budget * discountPercent) / 100);
  return { discountPercent, discountAmount, chargeAmount: budget - discountAmount };
}
