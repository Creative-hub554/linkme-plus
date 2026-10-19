import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth, successResponse, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { auditLogs, profiles, users, verificationRequests } from "@/lib/db/schema";
import { isUuid } from "@/lib/cursor-pagination";

/** Private reviewer queue; public links are returned only to trusted reviewers. */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  const page = Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "20", 10) || 20));
  const offset = (page - 1) * limit;
  try {
    const [reviewer] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id));
    if (!reviewer || reviewer.role !== "admin") {
      return errorResponse("Unauthorized", 403);
    }
    const rows = await db.select({
      id: verificationRequests.id,
      userId: verificationRequests.userId,
      username: users.username,
      displayName: profiles.displayName,
      evidenceUrls: verificationRequests.evidenceUrls,
      status: verificationRequests.status,
      createdAt: verificationRequests.createdAt,
    }).from(verificationRequests)
      .innerJoin(users, eq(verificationRequests.userId, users.id))
      .leftJoin(profiles, eq(verificationRequests.userId, profiles.userId))
      .where(eq(verificationRequests.status, "pending"))
      .orderBy(desc(verificationRequests.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await db.select({ total: count() }).from(verificationRequests)
      .where(eq(verificationRequests.status, "pending"));
    return paginatedResponse(rows, Number(total ?? 0), page, limit);
  } catch (err) {
    console.error("List verification requests error:", err);
    return errorResponse("Unable to load verification requests", 500);
  }
}

/** A trusted reviewer makes the final decision; approval also flips the public badge. */
export async function PATCH(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  let body: { requestId?: unknown; decision?: unknown; reviewNote?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("A request id and decision are required", 400);
  }
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const decision = body.decision;
  if (!isUuid(requestId) || (decision !== "approved" && decision !== "rejected")) {
    return errorResponse("A valid request id and approved/rejected decision are required", 400);
  }
  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim().slice(0, 1000) : null;

  try {
    const [reviewer] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id));
    if (!reviewer || reviewer.role !== "admin") {
      return errorResponse("Unauthorized", 403);
    }
    const [application] = await db.select({ id: verificationRequests.id, userId: verificationRequests.userId })
      .from(verificationRequests)
      .where(and(eq(verificationRequests.id, requestId), eq(verificationRequests.status, "pending")));
    if (!application) return errorResponse("Pending verification request not found", 404);

    const updated = await db.transaction(async (tx) => {
      const [reviewed] = await tx.update(verificationRequests).set({
        status: decision,
        reviewNote,
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
      }).where(and(eq(verificationRequests.id, requestId), eq(verificationRequests.status, "pending")))
        .returning({ id: verificationRequests.id, userId: verificationRequests.userId, status: verificationRequests.status });
      if (!reviewed) return null;

      if (decision === "approved") {
        await tx.update(users).set({ verified: true }).where(eq(users.id, application.userId));
      }
      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        action: `verification.${decision}`,
        targetType: "user",
        targetId: application.userId,
        metadata: { requestId, reviewNote },
      });
      return reviewed;
    });
    if (!updated) return errorResponse("This request has already been reviewed", 409);
    return successResponse({ request: updated });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return errorResponse("A verification request is already under review", 409);
    }
    console.error("Review verification request error:", err);
    return errorResponse("Unable to review verification request", 500);
  }
}
