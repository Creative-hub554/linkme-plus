import { db } from "@/lib/db";
import { jobs, users, auditLogs } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { offsetPagination } from "@/lib/offset-pagination";
import { isUuid } from "@/lib/cursor-pagination";
import { approveJob, lockJobPublisher } from "@/lib/job-publication";
import { eq, and, desc, or, isNotNull } from "drizzle-orm";
async function admin(request: Request) {
  const auth = await requireAuth(request); if (auth.error) return auth;
  const [actor] = await db.select({ role: users.role }).from(users).where(eq(users.id, auth.session.user.id));
  return actor?.role === "admin" ? auth : { session: null, error: errorResponse("Administrator access required", 403) };
}
export async function GET(request: Request) {
  try {
    const auth = await admin(request); if (auth.error) return auth.error;
    const { limit, offset } = offsetPagination(new URL(request.url).searchParams);
    const rows = await db.select({ id: jobs.id, title: jobs.title, publisherId: jobs.publisherId, reviewStatus: jobs.reviewStatus, reviewNote: jobs.reviewNote, officeEvidenceIds: jobs.officeEvidenceIds, pendingRevision: jobs.pendingRevision, description: jobs.description, location: jobs.location, deadline: jobs.deadline, createdAt: jobs.createdAt }).from(jobs).where(or(eq(jobs.reviewStatus, "pending_review"), isNotNull(jobs.pendingRevision))).orderBy(desc(jobs.createdAt)).limit(limit + 1).offset(offset);
    const response = successResponse({ jobs: rows.slice(0, limit), hasMore: rows.length > limit }); response.headers.set("Cache-Control", "private, no-store"); return response;
  } catch { return errorResponse("Job review is temporarily unavailable", 503); }
}
export async function POST(request: Request) {
  try {
    const auth = await admin(request); if (auth.error) return auth.error;
    let body; try { body = await request.json(); } catch { return errorResponse("Expected a JSON body"); }
    if (!body || typeof body.id !== "string" || !isUuid(body.id) || !["approve", "reject", "changes", "remove"].includes(body.action) || typeof body.note !== "string" || !body.note.trim() || body.note.length > 2000) return errorResponse("Choose a job, decision, and review reason");
    const [target] = await db.select().from(jobs).where(eq(jobs.id, body.id));
    if (!target) return errorResponse("Job not found", 404);
    if (!target.publisherId) return errorResponse("This legacy job needs its original publishing account assigned before review", 409);
    return await db.transaction(async tx => {
      await lockJobPublisher(tx, target.publisherId!);
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, target.id)).for("update");
      if (!current) return errorResponse("Job not found", 404);
      if (body.action === "approve" && current.reviewStatus === "approved" && !current.pendingRevision) return successResponse({ job: current, alreadyApproved: true });
      let updated;
      if (body.action === "approve") {
        const changes = current.pendingRevision;
        let candidate = current;
        if (changes) {
          // Revisions contain only the server-whitelisted fields submitted by the employer.
          const permitted = ["title", "location", "remoteStatus", "jobType", "salaryMin", "salaryMax", "description", "requirements", "skills", "officeEvidenceIds"];
          const patch = Object.fromEntries(permitted.filter(key => changes[key] !== undefined).map(key => [key, changes[key]]));
          if (changes.deadline) patch.deadline = new Date(String(changes.deadline));
          [candidate] = await tx.update(jobs).set(patch).where(eq(jobs.id, current.id)).returning();
        }
        try { updated = await approveJob(tx, candidate, auth.session.user.id, body.note.trim()); }
        catch (failure) { throw new JobReviewRefusal(failure instanceof Error ? failure.message : "Job cannot be published"); }
      } else {
        const preserveApproved = !!current.firstPublishedAt && !!current.pendingRevision && body.action !== "remove";
        [updated] = await tx.update(jobs).set({ reviewStatus: preserveApproved ? "approved" : body.action === "changes" ? "changes_requested" : "rejected", status: preserveApproved ? current.status : body.action === "remove" ? "archived" : "draft", pendingRevision: null, reviewNote: body.note.trim(), reviewedBy: auth.session.user.id, reviewedAt: new Date() }).where(and(eq(jobs.id, current.id))).returning();
      }
      await tx.insert(auditLogs).values({ actorId: auth.session.user.id, action: `job.${body.action}`, targetType: "job", targetId: current.id, metadata: { reason: body.note.trim(), revision: !!current.pendingRevision } });
      return successResponse({ job: updated });
    });
  } catch (failure) {
    if (failure instanceof JobReviewRefusal) return errorResponse(failure.message, 409);
    return errorResponse("Unable to review job", 503);
  }
}
class JobReviewRefusal extends Error {}
