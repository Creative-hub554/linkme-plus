import { db } from "@/lib/db";
import { reports, moderationActions, auditLogs, users, moderationActionEnum } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";

/**
 * Resolve a report with a moderation action.
 *
 * Three things sit before any write. The caller must be an admin or moderator —
 * read inside the `try`, so a database error on that lookup is the `500` below
 * rather than an uncaught rejection escaping the route: authorization cannot
 * answer "allowed" on error. The `action` must be one the enum column accepts,
 * so an unknown one is a `400` here rather than a constraint violation at write
 * time. And the report must still be `pending`: moderating an already-closed
 * report would stack a second action and audit row over the first, so it is a
 * `409` — read before the action is written.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    // Check admin/moderator role
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id));

    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      return errorResponse("Unauthorized", 403);
    }

    const body = await request.json();
    const { reportId, action, reason } = body;

    if (!reportId || !action) {
      return errorResponse("Report ID and action are required");
    }

    // The action is written to an enum column; refuse an unknown one before the
    // report is read, let alone the write attempted.
    if (!moderationActionEnum.enumValues.includes(action)) {
      return errorResponse("Invalid moderation action");
    }

    // Get report
    const [report] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, reportId));

    if (!report) {
      return errorResponse("Report not found", 404);
    }

    // Only a report still awaiting a decision may be resolved.
    if (report.status !== "pending") {
      return errorResponse("Report is not pending", 409);
    }

    // Create moderation action
    const [modAction] = await db
      .insert(moderationActions)
      .values({
        targetType: report.targetType,
        targetId: report.targetId,
        actorId: session.user.id,
        action,
        reason,
      })
      .returning();

    // Update report status
    await db
      .update(reports)
      .set({ status: "resolved" })
      .where(eq(reports.id, reportId));

    // Create audit log
    await db.insert(auditLogs).values({
      actorId: session.user.id,
      action: `moderation.${action}`,
      targetType: report.targetType,
      targetId: report.targetId,
      metadata: { reportId, reason },
    });

    return successResponse({ action: modAction }, 201);
  } catch (err) {
    console.error("Moderate error:", err);
    return errorResponse("Failed to moderate", 500);
  }
}
