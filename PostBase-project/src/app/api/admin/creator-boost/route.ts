import { and, desc, eq } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { db } from "@/lib/db";
import { getCreatorBoostEligibility } from "@/lib/db/creator-boost";
import { auditLogs, creatorBoostMemberships, profiles, users } from "@/lib/db/schema";
import { CREATOR_BOOST_REQUIREMENTS } from "@/lib/creator-boost";

async function isPlatformOwner(userId: string) {
  const [owner] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return owner?.role === "admin";
}

/** Platform-owner queue. Moderators cannot award a paid platform benefit. */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    if (!(await isPlatformOwner(session.user.id))) return errorResponse("Unauthorized", 403);
    const applications = await db
      .select({
        id: creatorBoostMemberships.id,
        userId: creatorBoostMemberships.userId,
        tier: creatorBoostMemberships.tier,
        eligibilitySnapshot: creatorBoostMemberships.eligibilitySnapshot,
        createdAt: creatorBoostMemberships.createdAt,
        username: users.username,
        displayName: profiles.displayName,
      })
      .from(creatorBoostMemberships)
      .innerJoin(users, eq(creatorBoostMemberships.userId, users.id))
      .leftJoin(profiles, eq(creatorBoostMemberships.userId, profiles.userId))
      .where(eq(creatorBoostMemberships.status, "pending"))
      .orderBy(desc(creatorBoostMemberships.createdAt));
    return successResponse({ applications });
  } catch (creatorBoostError) {
    console.error("List Creator Boost applications error:", creatorBoostError);
    return errorResponse("Unable to load Creator Boost applications", 500);
  }
}

/** The platform owner decides after a fresh server-side eligibility check. */
export async function PATCH(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  let body: { applicationId?: unknown; decision?: unknown; reviewNote?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("An application id and decision are required", 400);
  }
  const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
  const decision = body.decision;
  if (!isUuid(applicationId) || (decision !== "approved" && decision !== "rejected")) {
    return errorResponse("A valid application id and approved/rejected decision are required", 400);
  }
  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim().slice(0, 1_000) || null : null;

  try {
    if (!(await isPlatformOwner(session.user.id))) return errorResponse("Unauthorized", 403);
    const [application] = await db
      .select({ id: creatorBoostMemberships.id, userId: creatorBoostMemberships.userId })
      .from(creatorBoostMemberships)
      .where(and(eq(creatorBoostMemberships.id, applicationId), eq(creatorBoostMemberships.status, "pending")));
    if (!application) return errorResponse("Pending Creator Boost application not found", 404);

    const now = new Date();
    const eligibility = decision === "approved" ? await getCreatorBoostEligibility(application.userId, now) : null;
    if (decision === "approved" && (!eligibility?.eligible || !eligibility.tier)) {
      return errorResponse("This account no longer meets the Creator Boost requirements", 409);
    }
    const expiry = new Date(now.getTime() + CREATOR_BOOST_REQUIREMENTS.reviewPeriodDays * 24 * 60 * 60 * 1000);
    const [reviewed] = await db
      .update(creatorBoostMemberships)
      .set({
        status: decision,
        tier: decision === "approved" ? eligibility?.tier ?? null : null,
        eligibilitySnapshot: eligibility ?? { decision, reviewedAt: now.toISOString() },
        reviewNote,
        reviewedBy: session.user.id,
        reviewedAt: now,
        approvedAt: decision === "approved" ? now : null,
        expiresAt: decision === "approved" ? expiry : null,
        updatedAt: now,
      })
      .where(and(eq(creatorBoostMemberships.id, applicationId), eq(creatorBoostMemberships.status, "pending")))
      .returning({ id: creatorBoostMemberships.id, status: creatorBoostMemberships.status, tier: creatorBoostMemberships.tier, expiresAt: creatorBoostMemberships.expiresAt });
    if (!reviewed) return errorResponse("This application has already been reviewed", 409);

    await db.insert(auditLogs).values({
      actorId: session.user.id,
      action: `creator_boost.${decision}`,
      targetType: "user",
      targetId: application.userId,
      metadata: { applicationId, reviewNote, tier: reviewed.tier, expiresAt: reviewed.expiresAt },
    });
    return successResponse({ application: reviewed });
  } catch (creatorBoostError) {
    console.error("Review Creator Boost application error:", creatorBoostError);
    return errorResponse("Unable to review Creator Boost application", 500);
  }
}
