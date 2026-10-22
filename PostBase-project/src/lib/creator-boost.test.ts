import { describe, expect, it } from "vitest";
import {
  CREATOR_BOOST_REQUIREMENTS,
  creatorBoostPrice,
  evaluateCreatorBoost,
  tierForAverageOrganicLikes,
} from "@/lib/creator-boost";

const eligibleMetrics = {
  followers: 5_000,
  publicPosts: 30,
  shortVideos: 10,
  averageOrganicLikes: 200,
  accountAgeDays: 90,
  goodStanding: true,
};

describe("Creator Boost rules", () => {
  it("requires every stated programme threshold", () => {
    expect(evaluateCreatorBoost(eligibleMetrics)).toMatchObject({ eligible: true, tier: "rising", reasons: [] });
    const result = evaluateCreatorBoost({ ...eligibleMetrics, followers: CREATOR_BOOST_REQUIREMENTS.minFollowers - 1, goodStanding: false });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });

  it("awards the increasing tier discount from organic likes", () => {
    expect(tierForAverageOrganicLikes(499)).toBe("rising");
    expect(tierForAverageOrganicLikes(500)).toBe("established");
    expect(tierForAverageOrganicLikes(1_000)).toBe("star");
    expect(tierForAverageOrganicLikes(3_000)).toBe("icon");
    expect(creatorBoostPrice(100, "icon")).toEqual({ discountPercent: 45, discountAmount: 45, chargeAmount: 55 });
  });
});
