import { eq } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { getCreatorBoostEligibility } from "@/lib/db/creator-boost";
import { auditLogs, creatorBoostMemberships } from "@/lib/db/schema";

function membershipResponse(membership: typeof creatorBoostMemberships.$inferSelect | undefined) {
  if (!membership) return null;
  return {
    id: membership.id,
    status: membership.status,
    tier: membership.tier,
    reviewNote: membership.reviewNote,
    reviewedAt: membership.reviewedAt,
    approvedAt: membership.approvedAt,
    expiresAt: membership.expiresAt,
    createdAt: membership.createdAt,
  };
}

/** The signed-in member's live qualification result and current application. */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const [eligibility, membership] = await Promise.all([
      getCreatorBoostEligibility(session.user.id),
      db
        .select()
        .from(creatorBoostMemberships)
        .where(eq(creatorBoostMemberships.userId, session.user.id))
        .limit(1)
        .then(([row]) => row),
    ]);
    return successResponse({ eligibility, membership: membershipResponse(membership) });
  } catch (creatorBoostError) {
    console.error("Get Creator Boost status error:", creatorBoostError);
    return errorResponse("Unable to load Creator Boost status", 500);
  }
}

/**
 * A qualifying creator can request review. Metrics are always recalculated on
 * the server; the client has no field through which it can claim followers or
 * likes it did not earn.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const [eligibility, existing] = await Promise.all([
      getCreatorBoostEligibility(session.user.id),
      db
        .select()
        .from(creatorBoostMemberships)
        .where(eq(creatorBoostMemberships.userId, session.user.id))
        .limit(1)
        .then(([row]) => row),
    ]);
    if (!eligibility.eligible || !eligibility.tier) {
      return errorResponse("This account does not currently meet the Creator Boost requirements", 400);
    }
    if (existing?.status === "pending") return errorResponse("Your Creator Boost application is already under review", 409);
    if (existing?.status === "approved" && existing.expiresAt && existing.expiresAt > new Date()) {
      return errorResponse("Your Creator Boost benefit is already active", 409);
    }

    const now = new Date();
    const [membership] = existing
      ? await db
          .update(creatorBoostMemberships)
          .set({
            status: "pending",
            tier: eligibility.tier,
            eligibilitySnapshot: eligibility,
            reviewNote: null,
            reviewedBy: null,
            reviewedAt: null,
            approvedAt: null,
            expiresAt: null,
            updatedAt: now,
          })
          .where(eq(creatorBoostMemberships.id, existing.id))
          .returning()
      : await db
          .insert(creatorBoostMemberships)
          .values({
            userId: session.user.id,
            status: "pending",
            tier: eligibility.tier,
            eligibilitySnapshot: eligibility,
            updatedAt: now,
          })
          .returning();

    await db.insert(auditLogs).values({
      actorId: session.user.id,
      action: "creator_boost.apply",
      targetType: "user",
      targetId: session.user.id,
      metadata: { membershipId: membership.id, tier: eligibility.tier },
    });
    return successResponse({ membership: membershipResponse(membership), eligibility }, 201);
  } catch (creatorBoostError) {
    console.error("Apply Creator Boost error:", creatorBoostError);
    return errorResponse("Unable to submit Creator Boost application", 500);
  }
}
