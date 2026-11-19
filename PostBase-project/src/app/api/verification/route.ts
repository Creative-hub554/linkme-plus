import { db } from "@/lib/db";
import { privateEvidence, verificationRequests } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { and, desc, eq, inArray, isNull, or, gt } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";
import { lockSeller } from "@/lib/seller-entitlements";
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  try {
    const requests = await db.select({ id: verificationRequests.id, status: verificationRequests.status, reviewNote: verificationRequests.reviewNote, reviewedAt: verificationRequests.reviewedAt, revokedAt: verificationRequests.revokedAt, createdAt: verificationRequests.createdAt }).from(verificationRequests).where(and(eq(verificationRequests.userId, session.user.id), eq(verificationRequests.verificationKind, "national_id"))).orderBy(desc(verificationRequests.createdAt)).limit(20);
    return successResponse({ requests });
  } catch { return errorResponse("Identity verification is temporarily unavailable", 503); }
}
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  let body; try { body = await request.json(); } catch { return errorResponse("Expected a JSON body"); }
  const ids = body?.evidenceIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 || !ids.every(id => typeof id === "string" && isUuid(id)) || new Set(ids).size !== ids.length) return errorResponse("Upload one or two National ID images first");
  try {
    return await db.transaction(async tx => {
      await lockSeller(tx, session.user.id);
      const [pending] = await tx.select({ id: verificationRequests.id }).from(verificationRequests).where(and(eq(verificationRequests.userId, session.user.id), eq(verificationRequests.verificationKind, "national_id"), inArray(verificationRequests.status, ["pending", "approved"]), isNull(verificationRequests.revokedAt)));
      if (pending) return errorResponse("You already have a pending or approved identity request", 409);
      const evidence = await tx.select({ id: privateEvidence.id }).from(privateEvidence).where(and(inArray(privateEvidence.id, ids), eq(privateEvidence.ownerId, session.user.id), eq(privateEvidence.purpose, "national_id"), isNull(privateEvidence.deletedAt), or(isNull(privateEvidence.deleteAfter), gt(privateEvidence.deleteAfter, new Date()))));
      if (evidence.length !== ids.length) return errorResponse("One or more private ID images are unavailable", 422);
      const [row] = await tx.insert(verificationRequests).values({ userId: session.user.id, evidenceUrls: [], verificationKind: "national_id", privateEvidenceIds: ids, status: "pending" }).returning({ id: verificationRequests.id, status: verificationRequests.status });
      return successResponse({ request: row }, 201);
    });
  } catch { return errorResponse("Unable to submit identity verification", 503); }
}
