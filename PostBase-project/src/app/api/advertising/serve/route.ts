import { db } from "@/lib/db";
import {
  adCampaigns,
  adCreatives,
  adPlacements,
  adPayments,
} from "@/lib/db/schema";
import { errorResponse, optionalAuth, successResponse } from "@/lib/api-helpers";
import { adLocations, eligibleAdSource } from "@/lib/advertising";
import { and, eq, inArray, lte, gt, sql } from "drizzle-orm";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams,
    location = params.get("location"),
    category = params.get("category");
  if (!adLocations.includes(location as (typeof adLocations)[number]))
    return errorResponse("Invalid advertising location");
  try {
    const { session } = location === "feed"
      ? await optionalAuth(request)
      : { session: null };
    const now = new Date();
    const ads = await db
      .select({
        id: adCampaigns.id,
        headline: adCreatives.headline,
        imageUrl: adCreatives.imageUrl,
        destinationUrl: adCreatives.destinationUrl,
        altText: adCreatives.altText,
      })
      .from(adCampaigns)
      .innerJoin(adPlacements, eq(adPlacements.id, adCampaigns.placementId))
      .innerJoin(adCreatives, eq(adCreatives.campaignId, adCampaigns.id))
      .innerJoin(adPayments, eq(adPayments.campaignId, adCampaigns.id))
      .where(
        and(
          eq(adPlacements.location, location!),
          inArray(adCampaigns.status, ["scheduled", "active", "approved"]),
          eq(adPayments.status, "verified"),
          eq(adCreatives.status, "approved"),
          lte(adCampaigns.startDate, now),
          gt(adCampaigns.endDate, now),
          eligibleAdSource(undefined, session?.user.id),
          category
            ? sql`${category} = any(${adCampaigns.targetCategories})`
            : undefined,
        ),
      )
      .orderBy(sql`random()`)
      .limit(5);
    return successResponse({ ads });
  } catch {
    return errorResponse("Advertising is temporarily unavailable", 503);
  }
}
