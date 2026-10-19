import { db } from "@/lib/db";
import { adCampaigns, boostedPostCampaigns, auditLogs, pages, posts, users } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { REVIEW_ACTIONS, windowFrom, type ReviewAction } from "@/lib/ads/boosts";
import { eq } from "drizzle-orm";

/**
 * The platform's side of a boost: the queue an administrator clears, and the
 * two decisions that end it.
 *
 * Approval is the only thing that starts delivery, and it is deliberately not
 * reachable from the advertiser's own route — the PRD asks twice that a page or
 * group administrator cannot approve their own campaign, and the split between
 * `@/api/boosts` and this route is what makes that structural rather than a
 * check someone can forget. Rejection takes a reason, which is written to the
 * audit log beside the decision so a refused boost has a paper trail.
 *
 * Approving re-anchors the booked window from the moment delivery starts. The
 * campaign was booked with a length — seven, fourteen or thirty days — and a
 * campaign approved on a Tuesday must not arrive with three of those days
 * already gone; the booked dates are the *length*, and this is where they
 * become the *run*.
 */
async function requirePlatformAdmin(userId: string) {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return Boolean(user && (user.role === "admin" || user.role === "moderator"));
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    if (!(await requirePlatformAdmin(session.user.id))) {
      return errorResponse("Unauthorized", 403);
    }

    const queue = await db
      .select({
        id: adCampaigns.id,
        status: adCampaigns.status,
        budget: adCampaigns.budget,
        startDate: adCampaigns.startDate,
        endDate: adCampaigns.endDate,
        advertiser: users.username,
        goal: boostedPostCampaigns.goal,
        postId: boostedPostCampaigns.postId,
        excerpt: posts.content,
        pageName: pages.name,
        pageUsername: pages.username,
      })
      .from(adCampaigns)
      .innerJoin(boostedPostCampaigns, eq(adCampaigns.id, boostedPostCampaigns.campaignId))
      .innerJoin(posts, eq(boostedPostCampaigns.postId, posts.id))
      .innerJoin(pages, eq(posts.pageId, pages.id))
      .innerJoin(users, eq(adCampaigns.advertiserId, users.id))
      .where(eq(adCampaigns.status, "pending_review"));

    return successResponse({ campaigns: queue });
  } catch (queueError) {
    console.error("List campaigns for review error:", queueError);
    return errorResponse("Unable to list the review queue", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("A campaign and a decision are required", 400);
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId || !isUuid(campaignId)) {
    return errorResponse("A campaign is required", 400);
  }

  const action = typeof body.action === "string" ? (body.action as ReviewAction) : ("" as ReviewAction);
  if (!(action in REVIEW_ACTIONS)) {
    return errorResponse("A decision of approve or reject is required", 400);
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim().slice(0, 500)
      : null;
  if (action === "reject" && !reason) {
    return errorResponse("A rejection needs a reason to send back", 400);
  }

  try {
    if (!(await requirePlatformAdmin(session.user.id))) {
      return errorResponse("Unauthorized", 403);
    }

    const [campaign] = await db
      .select({
        id: adCampaigns.id,
        status: adCampaigns.status,
        startDate: adCampaigns.startDate,
        endDate: adCampaigns.endDate,
      })
      .from(adCampaigns)
      .where(eq(adCampaigns.id, campaignId));

    if (!campaign) return errorResponse("Campaign not found", 404);

    const step = REVIEW_ACTIONS[action];
    if (!step.from.includes(campaign.status)) {
      return errorResponse(
        `A campaign that is ${campaign.status.replace("_", " ")} has no decision left to make`,
        409,
      );
    }

    // The booked window's *length* is the duration; approval makes it the run.
    const bookedDays =
      campaign.startDate && campaign.endDate
        ? Math.max(1, Math.round((campaign.endDate.getTime() - campaign.startDate.getTime()) / 86_400_000))
        : 7;
    const window = step.to === "active" ? windowFrom(new Date(), bookedDays) : null;

    const [updated] = await db
      .update(adCampaigns)
      .set({
        status: step.to,
        ...(window ? { startDate: window.startDate, endDate: window.endDate } : {}),
      })
      .where(eq(adCampaigns.id, campaignId))
      .returning({
        id: adCampaigns.id,
        status: adCampaigns.status,
        startDate: adCampaigns.startDate,
        endDate: adCampaigns.endDate,
      });

    // The decision is a matter of record: who approved a paid placement, when,
    // and — on a refusal — what was wrong with it.
    await db.insert(auditLogs).values({
      actorId: session.user.id,
      action: `campaign.${action}`,
      targetType: "ad_campaign",
      targetId: campaignId,
      metadata: reason ? { reason } : {},
    });

    return successResponse({ campaign: updated });
  } catch (decisionError) {
    console.error("Campaign review error:", decisionError);
    return errorResponse("Unable to record this decision", 500);
  }
}
