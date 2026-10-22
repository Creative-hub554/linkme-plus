import { db } from "@/lib/db";
import { adCampaigns, boostedPostCampaigns, pageRoles, posts } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { occupiesPost, parseBoostRequest, windowFrom } from "@/lib/ads/boosts";
import { creatorBoostPrice } from "@/lib/creator-boost";
import { getActiveCreatorMembership, getCreatorBoostBenefit } from "@/lib/db/creator-boost";
import { and, eq } from "drizzle-orm";

/**
 * Book a boost for a published post of a Page.
 *
 * Four gates stand before the first write, and each is decided here rather than
 * trusted from the body: the request must be one the platform offers, the post
 * must exist and be a public Page post that is still on the site, the caller
 * must be an admin of *that* Page, and the post must not already be carrying a
 * live campaign. The last is the one that keeps a double-click from buying the
 * same post twice — one post, one campaign at a time, and a finished, rejected
 * or cancelled one leaves the post free to be boosted again.
 *
 * The campaign is created at `pending_payment`, which is the PRD's ladder
 * rather than this route's invention: nothing may be approved that has not been
 * paid for, and payment is the next request. The window is booked now so the
 * length the administrator chose is recorded; approval re-anchors it from the
 * moment delivery starts (see `windowFrom`).
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("A boost request is required", 400);
  }

  const postId = typeof body.postId === "string" ? body.postId : "";
  if (!postId || !isUuid(postId)) {
    return errorResponse("A post to boost is required", 400);
  }

  const parsed = parseBoostRequest(body);
  if (!parsed.ok) return errorResponse(parsed.reason, 400);
  const boost = parsed.value;

  try {
    const [post] = await db
      .select({
        id: posts.id,
        pageId: posts.pageId,
        groupId: posts.groupId,
        visibility: posts.visibility,
        deletedAt: posts.deletedAt,
      })
      .from(posts)
      .where(eq(posts.id, postId));

    if (!post) return errorResponse("Post not found", 404);

    // Eligibility is the PRD's own sentence: public, published, owned by a
    // Page. A group post or a member's own post has no Page to bill and no
    // Page audience to reach beyond, and a soft-deleted one is not on the site
    // at all.
    if (post.deletedAt) return errorResponse("This post is no longer on the site", 404);
    if (!post.pageId || post.groupId) {
      return errorResponse("Only a published post of a Page can be boosted", 400);
    }
    if (post.visibility !== "public") {
      return errorResponse("Only a public post can be boosted", 400);
    }

    const [admin] = await db
      .select({ id: pageRoles.id })
      .from(pageRoles)
      .where(
        and(
          eq(pageRoles.pageId, post.pageId),
          eq(pageRoles.userId, session.user.id),
          eq(pageRoles.role, "admin"),
        ),
      );
    if (!admin) return errorResponse("Only a Page admin can boost its posts", 403);

    // One live campaign per post. Read before the insert, so a second press
    // costs nothing but a `409` — the duplicate would otherwise be a second
    // authorisation for the same post.
    const [live] = await db
      .select({ id: adCampaigns.id, status: adCampaigns.status })
      .from(adCampaigns)
      .innerJoin(boostedPostCampaigns, eq(adCampaigns.id, boostedPostCampaigns.campaignId))
      .where(eq(boostedPostCampaigns.postId, postId));
    if (live && occupiesPost(live.status)) {
      return errorResponse("This post already has a campaign running", 409);
    }

    // A Creator Boost price is awarded from the server-side membership record,
    // not selected in the request. The delivery budget is never reduced, only
    // the amount the eligible Page admin is charged.
    const [benefit, activeCreator] = await Promise.all([
      getCreatorBoostBenefit(session.user.id),
      getActiveCreatorMembership(session.user.id),
    ]);
    const pricing = creatorBoostPrice(boost.budget, benefit?.tier ?? null);
    const window = windowFrom(new Date(), boost.durationDays);

    const [campaign] = await db
      .insert(adCampaigns)
      .values({
        advertiserId: session.user.id,
        type: "boosted_post",
        status: "pending_payment",
        budget: boost.budget,
        chargeAmount: pricing.chargeAmount,
        creatorDiscountPercent: pricing.discountPercent,
        creatorDiscountAmount: pricing.discountAmount,
        priorityReview: Boolean(activeCreator),
        startDate: window.startDate,
        endDate: window.endDate,
        targetLocation: boost.targetLocation,
        targetCategories: boost.interests,
      })
      .returning({
        id: adCampaigns.id,
        status: adCampaigns.status,
        budget: adCampaigns.budget,
        chargeAmount: adCampaigns.chargeAmount,
        creatorDiscountPercent: adCampaigns.creatorDiscountPercent,
        creatorDiscountAmount: adCampaigns.creatorDiscountAmount,
        priorityReview: adCampaigns.priorityReview,
        startDate: adCampaigns.startDate,
        endDate: adCampaigns.endDate,
      });

    await db
      .insert(boostedPostCampaigns)
      .values({ campaignId: campaign.id, postId, goal: boost.goal });

    return successResponse(
      {
        campaign: { ...campaign, goal: boost.goal, postId },
        // Said by the response rather than left for the client to infer: the
        // campaign is booked but cannot run, and the next step is the one that
        // authorises it.
        next: "pay",
      },
      201,
    );
  } catch (boostError) {
    console.error("Create boost error:", boostError);
    return errorResponse("Unable to book this boost", 500);
  }
}
