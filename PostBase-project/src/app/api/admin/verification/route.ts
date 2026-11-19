import { db } from "@/lib/db";
import { verificationRequests, privateEvidence, users, auditLogs } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { offsetPagination } from "@/lib/offset-pagination";
import { isUuid } from "@/lib/cursor-pagination";
import { and, eq, desc, inArray } from "drizzle-orm";
import { lockSeller } from "@/lib/seller-entitlements";
async function actor(request: Request) {
  const auth = await requireAuth(request); if (auth.error) return auth;
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, auth.session.user.id));
  return user?.role === "admin" ? auth : { session: null, error: errorResponse("Administrator access required", 403) };
}
export async function GET(request: Request) {
  try {
    const auth = await actor(request); if (auth.error) return auth.error;
    const { limit, offset } = offsetPagination(new URL(request.url).searchParams);
    const rows = await db.select({ id: verificationRequests.id, userId: verificationRequests.userId, email: users.email, status: verificationRequests.status, evidenceIds: verificationRequests.privateEvidenceIds, reviewNote: verificationRequests.reviewNote, revokedAt: verificationRequests.revokedAt, createdAt: verificationRequests.createdAt }).from(verificationRequests).innerJoin(users, eq(users.id, verificationRequests.userId)).where(eq(verificationRequests.verificationKind, "national_id")).orderBy(desc(verificationRequests.createdAt)).limit(limit + 1).offset(offset);
    const response = successResponse({ requests: rows.slice(0, limit), hasMore: rows.length > limit }); response.headers.set("Cache-Control", "private, no-store"); return response;
  } catch { return errorResponse("Verification review is temporarily unavailable", 503); }
}
export async function POST(request: Request) {
  try {
    const auth = await actor(request); if (auth.error) return auth.error;
    let body; try { body = await request.json(); } catch { return errorResponse("Expected a JSON body"); }
    if (!body || typeof body.id !== "string" || !isUuid(body.id) || !["approve", "reject", "revoke"].includes(body.action) || typeof body.note !== "string" || !body.note.trim() || body.note.length > 2000) return errorResponse("A request, decision, and review reason are required");
    const [target] = await db.select().from(verificationRequests).where(and(eq(verificationRequests.id, body.id), eq(verificationRequests.verificationKind, "national_id")));
    if (!target) return errorResponse("Verification request not found", 404);
    if (target.userId === auth.session.user.id) return errorResponse("Another administrator must review your identity", 403);
    return await db.transaction(async tx => {
      await lockSeller(tx, target.userId);
      const [current] = await tx.select().from(verificationRequests).where(eq(verificationRequests.id, target.id)).for("update");
      if (!current) return errorResponse("Verification request not found", 404);
      if (body.action !== "revoke" && current.status !== "pending") return errorResponse("This request has already been reviewed", 409);
      if (body.action === "approve") {
        const evidence = await tx.select().from(privateEvidence).where(and(inArray(privateEvidence.id, current.privateEvidenceIds), eq(privateEvidence.ownerId, current.userId), eq(privateEvidence.purpose, "national_id")));
        if (!evidence.length || evidence.length !== current.privateEvidenceIds.length || evidence.some(item => item.deletedAt || (item.deleteAfter && item.deleteAfter < new Date()))) return errorResponse("ID evidence is unavailable; request new documents", 409);
      }
      const now = new Date();
      await tx.update(verificationRequests).set({ status: body.action === "revoke" ? current.status : body.action === "approve" ? "approved" : "rejected", revokedAt: body.action === "revoke" ? now : null, reviewNote: body.note.trim(), reviewedAt: now, reviewedBy: auth.session.user.id }).where(eq(verificationRequests.id, current.id));
      if (current.privateEvidenceIds.length) await tx.update(privateEvidence).set({ deleteAfter: new Date(now.getTime() + 30 * 86400000) }).where(and(inArray(privateEvidence.id, current.privateEvidenceIds), eq(privateEvidence.ownerId, current.userId)));
      await tx.insert(auditLogs).values({ actorId: auth.session.user.id, action: `identity.${body.action}`, targetType: "user", targetId: current.userId, metadata: { requestId: current.id, reason: body.note.trim() } });
      return successResponse({ success: true });
    });
  } catch { return errorResponse("Unable to review identity verification", 503); }
}
