import { db } from "@/lib/db";
import {
  adCampaigns,
  adPayments,
  adEvents,
  adMetrics,
  reports,
} from "@/lib/db/schema";
import { requireAuth, errorResponse, successResponse } from "@/lib/api-helpers";
import { eligibleAdSource } from "@/lib/advertising";
import { isUuid } from "@/lib/cursor-pagination";
import { and, eq, inArray, lte, gt, sql } from "drizzle-orm";
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const { campaignId, event, reason } = await request.json();
    if (
      typeof campaignId !== "string" ||
      !isUuid(campaignId) ||
      !["impression", "click", "report"].includes(event)
    )
      return errorResponse("Invalid advertising event");
    const now = new Date();
    const [campaign] = await db
      .select({ id: adCampaigns.id })
      .from(adCampaigns)
      .innerJoin(adPayments, eq(adPayments.campaignId, adCampaigns.id))
      .where(
        and(
          eq(adCampaigns.id, campaignId),
          inArray(adCampaigns.status, ["active", "scheduled", "approved"]),
          eq(adPayments.status, "verified"),
          lte(adCampaigns.startDate, now),
          gt(adCampaigns.endDate, now),
          eligibleAdSource(),
        ),
      );
    if (!campaign) return errorResponse("Campaign is unavailable", 404);
    if (event === "report") {
      if (
        typeof reason !== "string" ||
        !["spam", "scam", "misleading", "inappropriate"].includes(reason)
      )
        return errorResponse("Select a report reason");
      const [existing] = await db
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.targetId, campaignId),
            eq(reports.targetType, "campaign"),
            eq(reports.reporterId, session.user.id),
            eq(reports.status, "pending"),
          ),
        );
      if (!existing)
        await db
          .insert(reports)
          .values({
            reporterId: session.user.id,
            targetType: "campaign",
            targetId: campaignId,
            reason,
          });
      return successResponse({ reported: true });
    }
    return await db.transaction(async (tx) => {
      const day = now.toISOString().slice(0, 10);
      const [created] = await tx
        .insert(adEvents)
        .values({ campaignId, viewerId: session.user.id, day, event })
        .onConflictDoNothing()
        .returning();
      if (!created) return successResponse({ recorded: false });
      const impressions = event === "impression" ? 1 : 0,
        clicks = event === "click" ? 1 : 0;
      await tx
        .insert(adMetrics)
        .values({
          campaignId,
          date: new Date(`${day}T00:00:00Z`),
          impressions,
          clicks,
          uniqueReach: impressions,
        })
        .onConflictDoUpdate({
          target: [adMetrics.campaignId, adMetrics.date],
          set: {
            impressions: sql`coalesce(${adMetrics.impressions}, 0) + ${impressions}`,
            clicks: sql`coalesce(${adMetrics.clicks}, 0) + ${clicks}`,
            uniqueReach: sql`coalesce(${adMetrics.uniqueReach}, 0) + ${impressions}`,
          },
        });
      return successResponse({ recorded: true });
    });
  } catch {
    return errorResponse("Unable to record advertising event", 500);
  }
}
