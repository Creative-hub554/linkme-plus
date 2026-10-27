import { db } from "@/lib/db";
import {
  users,
  adCampaigns,
  adCreatives,
  adPlacements,
  adPayments,
  adPaymentSettings,
  auditLogs,
} from "@/lib/db/schema";
import { requireAuth, errorResponse, successResponse } from "@/lib/api-helpers";
import { adLocations, eligibleAdSource, safeAdUrl } from "@/lib/advertising";
import { isUuid } from "@/lib/cursor-pagination";
import { and, eq, ne, count, inArray, lt, gt } from "drizzle-orm";

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const [actor] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (actor?.role !== "admin")
      return errorResponse("Administrator access required", 403);
    const body = await request.json();
    if (body.action === "settings") {
      const image = safeAdUrl(body.qrImageUrl);
      if (
        !image ||
        typeof body.merchantName !== "string" ||
        !body.merchantName.trim() ||
        body.merchantName.length > 100 ||
        !["KHR", "USD"].includes(body.currency)
      )
        return errorResponse(
          "Merchant name, KHQR image URL, and currency are required",
        );
      return await db.transaction(async (tx) => {
        await tx
          .delete(adPaymentSettings)
          .where(eq(adPaymentSettings.id, `khqr_${body.currency}`));
        await tx
          .insert(adPaymentSettings)
          .values({
            id: `khqr_${body.currency}`,
            merchantName: body.merchantName.trim(),
            qrImageUrl: image,
            currency: body.currency,
          });
        await tx
          .insert(auditLogs)
          .values({
            actorId: session.user.id,
            action: "advertising.khqr_settings",
            metadata: {
              merchantName: body.merchantName.trim(),
              currency: body.currency,
            },
          });
        return successResponse({ success: true });
      });
    }
    if (body.action === "placement") {
      if (
        !adLocations.includes(body.location) ||
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100 ||
        !Number.isInteger(body.dailyRate) ||
        body.dailyRate <= 0 ||
        body.dailyRate > 10000000 ||
        !Number.isInteger(body.maxActive) ||
        body.maxActive < 1 ||
        body.maxActive > 20 ||
        !["KHR", "USD"].includes(body.currency)
      )
        return errorResponse(
          "Enter a valid placement, rate, currency and capacity",
        );
      const [placement] = await db
        .insert(adPlacements)
        .values({
          name: body.name.trim(),
          location: body.location,
          format: "image",
          dailyRate: body.dailyRate,
          currency: body.currency,
          maxActive: body.maxActive,
        })
        .returning();
      return successResponse({ placement }, 201);
    }
    if (
      typeof body.id !== "string" ||
      !isUuid(body.id) ||
      !["verify", "approve", "reject", "refund"].includes(body.action) ||
      typeof body.note !== "string" ||
      !body.note.trim() ||
      body.note.length > 2000
    )
      return errorResponse("A campaign, decision and review note are required");
    return await db.transaction(async (tx) => {
      const [campaign] = await tx
        .select()
        .from(adCampaigns)
        .where(eq(adCampaigns.id, body.id))
        .for("update");
      if (!campaign) return errorResponse("Campaign not found", 404);
      if (campaign.advertiserId === session.user.id)
        return errorResponse(
          "Another administrator must review your campaign",
          403,
        );
      const [payment] = await tx
        .select()
        .from(adPayments)
        .where(eq(adPayments.campaignId, campaign.id))
        .for("update");
      if (!payment) return errorResponse("Payment record not found", 404);
      if (body.action === "refund") {
        if (payment.status !== "verified")
          return errorResponse(
            "Only a verified payment can be marked refunded",
            409,
          );
        await tx
          .update(adPayments)
          .set({ status: "refunded", note: body.note })
          .where(eq(adPayments.campaignId, campaign.id));
        await tx
          .update(adCampaigns)
          .set({ status: "refunded" })
          .where(eq(adCampaigns.id, campaign.id));
      } else if (
        ["cancelled", "refunded", "completed"].includes(campaign.status) ||
        !campaign.endDate ||
        campaign.endDate <= new Date()
      )
        return errorResponse("This campaign has ended", 409);
      else if (body.action === "verify") {
        if (payment.status !== "submitted" || !payment.reference)
          return errorResponse(
            "The advertiser must submit a transaction reference first",
            409,
          );
        await tx
          .update(adPayments)
          .set({
            status: "verified",
            verifiedBy: session.user.id,
            verifiedAt: new Date(),
            note: body.note,
          })
          .where(eq(adPayments.campaignId, campaign.id));
      } else if (body.action === "approve") {
        if (payment.status !== "verified")
          return errorResponse(
            "Confirm receipt in your bank before approving this campaign",
            409,
          );
        const [placement] = await tx
          .select()
          .from(adPlacements)
          .where(eq(adPlacements.id, campaign.placementId!))
          .for("update");
        if (!placement || !campaign.startDate)
          return errorResponse("Placement is unavailable", 409);
        const [{ total }] = await tx
          .select({ total: count() })
          .from(adCampaigns)
          .where(
            and(
              eq(adCampaigns.placementId, placement.id),
              ne(adCampaigns.id, campaign.id),
              inArray(adCampaigns.status, ["approved", "scheduled", "active"]),
              lt(adCampaigns.startDate, campaign.endDate),
              gt(adCampaigns.endDate, campaign.startDate),
            ),
          );
        if (total >= (placement.maxActive ?? 1))
          return errorResponse(
            "This placement is fully booked for those dates. Arrange new dates or a manual refund.",
            409,
          );
        const reviewedAt = new Date();
        const [eligible] = await tx
          .select({ id: adCampaigns.id })
          .from(adCampaigns)
          .where(
            and(eq(adCampaigns.id, campaign.id), eligibleAdSource(reviewedAt)),
          );
        if (!eligible)
          return errorResponse(
            "Source content was removed, made private or is out of stock",
            409,
          );
        await tx
          .update(adCampaigns)
          .set({
            status: campaign.startDate > reviewedAt ? "scheduled" : "active",
            reviewedAt,
          })
          .where(eq(adCampaigns.id, campaign.id));
        await tx
          .update(adCreatives)
          .set({ status: "approved" })
          .where(eq(adCreatives.campaignId, campaign.id));
      } else {
        await tx
          .update(adCampaigns)
          .set({ status: "rejected" })
          .where(eq(adCampaigns.id, campaign.id));
        await tx
          .update(adPayments)
          .set({
            note: body.note,
            ...(payment.status !== "verified" ? { status: "rejected" } : {}),
          })
          .where(eq(adPayments.campaignId, campaign.id));
      }
      await tx
        .insert(auditLogs)
        .values({
          actorId: session.user.id,
          action: `advertising.${body.action}`,
          targetType: "campaign",
          targetId: campaign.id,
          metadata: { note: body.note },
        });
      return successResponse({ success: true });
    });
  } catch {
    return errorResponse("Unable to save advertising decision", 500);
  }
}
