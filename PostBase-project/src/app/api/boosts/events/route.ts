import { db } from "@/lib/db";
import { adCampaigns, adMetrics } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import {
  DAILY_IMPRESSION_CAP,
  dayStart,
  impressionsAllowable,
  isDelivering,
} from "@/lib/ads/boosts";
import { eq } from "drizzle-orm";

/** The two events a reader's attention is worth counting. */
const EVENT_TYPES = new Set(["impression", "click"]);

/**
 * Count one impression or click against a campaign.
 *
 * The counters live in `ad_metrics`, a row per campaign per day, which is what
 * makes a day's cap checkable without a ledger of viewers: the same read that
 * finds yesterday's number also says how much of today's allowance is left.
 *
 * Two answers are deliberately *not* errors. A campaign at its daily cap, or at
 * the end of its budget, is a campaign that should stop being counted rather
 * than a request that went wrong — the beacon is fired from a reader's feed,
 * and an answer that reads as a failure would be a console error on every
 * impression for the rest of the day. Both report `recorded: false`, and the
 * budget case settles the campaign on the spot, because a boost that has spent
 * its money is finished whether or not anything asks it to be.
 */
export async function POST(request: Request) {
  const { error } = await requireAuth(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("An event is required", 400);
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId || !isUuid(campaignId)) {
    return errorResponse("A campaign is required", 400);
  }

  const type = typeof body.type === "string" ? body.type : "";
  if (!EVENT_TYPES.has(type)) {
    return errorResponse("An event type of impression or click is required", 400);
  }

  try {
    const [campaign] = await db
      .select({
        id: adCampaigns.id,
        status: adCampaigns.status,
        budget: adCampaigns.budget,
        startDate: adCampaigns.startDate,
        endDate: adCampaigns.endDate,
      })
      .from(adCampaigns)
      .where(eq(adCampaigns.id, campaignId));

    if (!campaign) return errorResponse("Campaign not found", 404);

    const now = new Date();
    if (!isDelivering(campaign, now)) {
      return errorResponse("This campaign is not running", 409);
    }

    const rows = await db
      .select()
      .from(adMetrics)
      .where(eq(adMetrics.campaignId, campaignId));

    const totalImpressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
    const totalClicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
    const today = dayStart(now).getTime();
    const todayRow = rows.find((row) => new Date(row.date).getTime() >= today) ?? null;

    if (type === "impression") {
      const todayImpressions = rows
        .filter((row) => new Date(row.date).getTime() >= today)
        .reduce((sum, row) => sum + (row.impressions ?? 0), 0);

      if (todayImpressions >= DAILY_IMPRESSION_CAP) {
        return successResponse({ recorded: false, reason: "daily cap reached" });
      }

      if (totalImpressions + 1 > impressionsAllowable(campaign.budget)) {
        // Spent. The campaign settles here rather than waiting to be asked:
        // nothing else runs on a timer, and this is the moment the budget is
        // known to be gone.
        await db
          .update(adCampaigns)
          .set({ status: "completed", spent: campaign.budget })
          .where(eq(adCampaigns.id, campaignId));
        return successResponse({ recorded: false, reason: "budget spent", completed: true });
      }

      const impressions = (todayRow?.impressions ?? 0) + 1;
      if (todayRow) {
        await db
          .update(adMetrics)
          .set({ impressions })
          .where(eq(adMetrics.id, todayRow.id));
      } else {
        await db.insert(adMetrics).values({
          campaignId,
          date: now,
          impressions: 1,
          clicks: 0,
          uniqueReach: 0,
        });
      }

      return successResponse({
        recorded: true,
        impressions: totalImpressions + 1,
        clicks: totalClicks,
      });
    }

    const clicks = (todayRow?.clicks ?? 0) + 1;
    if (todayRow) {
      await db.update(adMetrics).set({ clicks }).where(eq(adMetrics.id, todayRow.id));
    } else {
      await db.insert(adMetrics).values({
        campaignId,
        date: now,
        impressions: 0,
        clicks: 1,
        uniqueReach: 0,
      });
    }

    return successResponse({
      recorded: true,
      impressions: totalImpressions,
      clicks: totalClicks + 1,
    });
  } catch (eventError) {
    console.error("Boost event error:", eventError);
    return errorResponse("Unable to record this event", 500);
  }
}
