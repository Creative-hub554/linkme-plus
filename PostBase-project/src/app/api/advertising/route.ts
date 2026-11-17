import { db } from "@/lib/db";
import {
  adCampaigns,
  adCreatives,
  adPayments,
  adPaymentSettings,
  adPlacements,
  promotedListingCampaigns,
  boostedPostCampaigns,
  marketplaceListings,
  listingMedia,
  inventoryItems,
  categories,
  posts,
  postMedia,
  pageRoles,
  users,
} from "@/lib/db/schema";
import { requireAuth, errorResponse, successResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { offsetPagination } from "@/lib/offset-pagination";
import { safeAdUrl, eligibleAdSource } from "@/lib/advertising";
import { and, eq, desc, sql, inArray } from "drizzle-orm";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const url = new URL(request.url),
      { limit, offset } = offsetPagination(url.searchParams);
    const admin = url.searchParams.get("admin") === "true";
    const [actor] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (admin && actor?.role !== "admin")
      return errorResponse("Administrator access required", 403);
    const campaigns = await db
      .select({
        campaign: adCampaigns,
        creative: adCreatives,
        payment: adPayments,
        sourceEligible: eligibleAdSource().mapWith(Boolean),
        impressions: sql<number>`(select coalesce(sum(impressions), 0)::int from ad_metrics where campaign_id = ${adCampaigns.id})`,
        clicks: sql<number>`(select coalesce(sum(clicks), 0)::int from ad_metrics where campaign_id = ${adCampaigns.id})`,
      })
      .from(adCampaigns)
      .leftJoin(adCreatives, eq(adCreatives.campaignId, adCampaigns.id))
      .leftJoin(adPayments, eq(adPayments.campaignId, adCampaigns.id))
      .where(admin ? sql`true` : eq(adCampaigns.advertiserId, session.user.id))
      .orderBy(desc(adCampaigns.createdAt))
      .limit(limit + 1)
      .offset(offset);
    const placements = await db.select().from(adPlacements);
    const paymentSettings = await db
      .select()
      .from(adPaymentSettings)
      .where(inArray(adPaymentSettings.id, ["khqr", "khqr_KHR", "khqr_USD"]))
      .orderBy(desc(adPaymentSettings.id));
    return successResponse({
      campaigns: campaigns.slice(0, limit),
      hasMore: campaigns.length > limit,
      placements,
      settings: paymentSettings[0] || null,
      paymentSettings,
      isAdmin: actor?.role === "admin",
    });
  } catch {
    return errorResponse("Unable to load campaigns", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const body = await request.json();
    if (
      !["banner", "boost", "promotion"].includes(body.type) ||
      typeof body.placementId !== "string" ||
      !isUuid(body.placementId)
    )
      return errorResponse("Select a valid campaign type and placement");
    const start = new Date(body.startDate),
      end = new Date(body.endDate),
      days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
    if (
      !Number.isFinite(days) ||
      days < 1 ||
      days > 90 ||
      start.getTime() < Date.now() - 86400000 ||
      end <= new Date()
    )
      return errorResponse(
        "Choose future campaign dates covering 1 to 90 days",
      );
    const [placement] = await db
      .select()
      .from(adPlacements)
      .where(eq(adPlacements.id, body.placementId));
    if (!placement || placement.dailyRate <= 0)
      return errorResponse("This placement has no configured rate");
    const [settings] = await db
      .select()
      .from(adPaymentSettings)
      .where(and(
        inArray(adPaymentSettings.id, [`khqr_${placement.currency}`, "khqr"]),
        eq(adPaymentSettings.currency, placement.currency),
      ))
      .orderBy(desc(adPaymentSettings.id));
    if (!settings || settings.currency !== placement.currency)
      return errorResponse(
        "KHQR payment is not configured for this currency",
        503,
      );
    const budget = days * placement.dailyRate;
    if (!Number.isSafeInteger(budget) || budget > 2147483647)
      return errorResponse("Campaign total is too large");
    let headline =
      typeof body.headline === "string"
        ? body.headline.trim().slice(0, 200)
        : "";
    let destinationUrl = safeAdUrl(body.destinationUrl),
      imageUrl = body.imageUrl ? safeAdUrl(body.imageUrl) : null;
    const targetCategories: string[] = [];
    if (
      body.type !== "banner" &&
      (typeof body.sourceId !== "string" || !isUuid(body.sourceId))
    )
      return errorResponse("Select a valid source post or listing");
    if (body.type === "promotion") {
      if (placement.location !== "marketplace")
        return errorResponse(
          "Listing promotions belong in marketplace placements",
        );
      const [listing] = await db
        .select()
        .from(marketplaceListings)
        .where(eq(marketplaceListings.id, body.sourceId));
      if (
        !listing ||
        listing.sellerId !== session.user.id ||
        listing.status !== "active" ||
        listing.deletedAt
      )
        return errorResponse("Only your active listings can be promoted", 403);
      const [stock] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.listingId, listing.id));
      if (stock && (stock.quantity ?? 0) <= 0)
        return errorResponse("Out-of-stock listings cannot be promoted");
      if (listing.categoryId) {
        const [category] = await db
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, listing.categoryId));
        if (category) targetCategories.push(category.name);
      }
      const [media] = await db
        .select()
        .from(listingMedia)
        .where(eq(listingMedia.listingId, listing.id))
        .orderBy(listingMedia.order)
        .limit(1);
      headline = listing.title;
      destinationUrl = `/marketplace/${listing.id}`;
      imageUrl = media?.url || null;
    } else if (body.type === "boost") {
      if (placement.location !== "feed")
        return errorResponse("Boosted posts belong in feed placements");
      const [post] = await db
        .select()
        .from(posts)
        .where(eq(posts.id, body.sourceId));
      if (
        !post ||
        post.groupId ||
        post.visibility !== "public" ||
        post.deletedAt
      )
        return errorResponse("Choose a published public post outside a group");
      if (!post.pageId && post.authorId !== session.user.id)
        return errorResponse("Only the post author can boost this post", 403);
      if (post.pageId) {
        const [role] = await db
          .select()
          .from(pageRoles)
          .where(
            and(
              eq(pageRoles.pageId, post.pageId),
              eq(pageRoles.userId, session.user.id),
              eq(pageRoles.role, "admin"),
            ),
          );
        if (!role)
          return errorResponse(
            "Only the Page administrator can boost this post",
            403,
          );
      }
      const [media] = await db
        .select()
        .from(postMedia)
        .where(eq(postMedia.postId, post.id))
        .orderBy(postMedia.order)
        .limit(1);
      headline = post.content?.slice(0, 200) || "Sponsored post";
      destinationUrl = `/feed?post=${post.id}`;
      imageUrl = media?.type.startsWith("image") ? media.url : null;
    } else if (!headline || !destinationUrl || !imageUrl)
      return errorResponse(
        "Banner headline, HTTPS/HTTP destination and image are required",
      );
    return await db.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(adCampaigns)
        .values({
          advertiserId: session.user.id,
          type: body.type,
          placementId: placement.id,
          status: "pending_payment",
          budget,
          currency: placement.currency,
          startDate: start,
          endDate: end,
          targetCategories,
        })
        .returning();
      await tx
        .insert(adCreatives)
        .values({
          campaignId: campaign.id,
          headline,
          destinationUrl,
          imageUrl,
          altText: headline,
          status: "pending",
        });
      await tx
        .insert(adPayments)
        .values({
          campaignId: campaign.id,
          status: "awaiting",
          merchantName: settings.merchantName,
          qrImageUrl: settings.qrImageUrl,
        });
      if (body.type === "promotion")
        await tx
          .insert(promotedListingCampaigns)
          .values({ campaignId: campaign.id, listingId: body.sourceId });
      if (body.type === "boost")
        await tx
          .insert(boostedPostCampaigns)
          .values({
            campaignId: campaign.id,
            postId: body.sourceId,
            goal: "reach",
          });
      return successResponse({ campaign }, 201);
    });
  } catch {
    return errorResponse("Unable to create campaign", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const { id, action, reference, payerName } = await request.json();
    if (typeof id !== "string" || !isUuid(id))
      return errorResponse("Invalid campaign ID");
    return await db.transaction(async (tx) => {
      const [campaign] = await tx
        .select()
        .from(adCampaigns)
        .where(eq(adCampaigns.id, id))
        .for("update");
      if (!campaign || campaign.advertiserId !== session.user.id)
        return errorResponse("Campaign not found", 404);
      if (
        ["cancelled", "refunded", "completed"].includes(campaign.status) ||
        (campaign.endDate && campaign.endDate <= new Date())
      )
        return errorResponse("This campaign has ended", 409);
      if (action === "payment") {
        if (
          typeof reference !== "string" ||
          reference.trim().length < 4 ||
          reference.length > 100 ||
          typeof payerName !== "string" ||
          !payerName.trim() ||
          payerName.length > 100
        )
          return errorResponse(
            "Enter the bank transaction reference and payer name",
          );
        const [payment] = await tx
          .select()
          .from(adPayments)
          .where(eq(adPayments.campaignId, id));
        if (!payment || payment.status === "verified")
          return errorResponse("Payment cannot be changed", 409);
        await tx
          .update(adPayments)
          .set({
            reference: reference.trim().toUpperCase(),
            payerName: payerName.trim(),
            status: "submitted",
            note: null,
          })
          .where(eq(adPayments.campaignId, id));
        await tx
          .update(adCampaigns)
          .set({ status: "pending_review" })
          .where(eq(adCampaigns.id, id));
      } else if (action === "pause" || action === "cancel") {
        await tx
          .update(adCampaigns)
          .set({ status: action === "pause" ? "paused" : "cancelled" })
          .where(eq(adCampaigns.id, id));
      } else if (action === "resume") {
        const [payment] = await tx
          .select()
          .from(adPayments)
          .where(eq(adPayments.campaignId, id));
        if (payment?.status !== "verified")
          return errorResponse("Payment must be verified first", 409);
        await tx
          .update(adCampaigns)
          .set({ status: "pending_review" })
          .where(eq(adCampaigns.id, id));
      } else return errorResponse("Invalid campaign action");
      return successResponse({ success: true });
    });
  } catch (err) {
    if (
      (err as { code?: string }).code === "23505" ||
      (err as { cause?: { code?: string } }).cause?.code === "23505"
    )
      return errorResponse(
        "This transaction reference is already attached to a campaign",
        409,
      );
    return errorResponse("Unable to update campaign", 500);
  }
}
