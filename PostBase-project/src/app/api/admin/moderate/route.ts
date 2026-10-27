import { db } from "@/lib/db";
import {
  reports,
  moderationActions,
  auditLogs,
  users,
  posts,
  comments,
  marketplaceListings,
  jobs,
  moderationActionEnum,
  adCampaigns,
} from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id));
    if (!user || (user.role !== "admin" && user.role !== "moderator"))
      return errorResponse("Unauthorized", 403);
    const { reportId, action, reason } = await request.json();
    if (!reportId || !action)
      return errorResponse("Report ID and action are required");
    if (typeof reportId !== "string" || !isUuid(reportId))
      return errorResponse("Invalid report ID");
    if (
      action !== "dismiss" &&
      !moderationActionEnum.enumValues.includes(action)
    )
      return errorResponse("Invalid moderation action");
    if (action === "suspension" || action === "ban")
      return errorResponse(
        "Account restrictions are not supported by this endpoint",
      );
    if (
      reason !== undefined &&
      (typeof reason !== "string" || reason.length > 2000)
    )
      return errorResponse("Invalid decision reason");

    // Lock the report and commit its decision, content change, and audit together.
    return await db.transaction(async (tx) => {
      const [report] = await tx
        .select()
        .from(reports)
        .where(eq(reports.id, reportId))
        .for("update");
      if (!report) return errorResponse("Report not found", 404);
      if (report.status !== "pending")
        return errorResponse("Report is not pending", 409);
      if (action === "removal") {
        switch (report.targetType) {
          case "post":
            await tx
              .update(posts)
              .set({ deletedAt: new Date() })
              .where(eq(posts.id, report.targetId));
            break;
          case "comment":
            await tx
              .update(comments)
              .set({ deletedAt: new Date() })
              .where(eq(comments.id, report.targetId));
            break;
          case "listing":
            await tx
              .update(marketplaceListings)
              .set({ status: "removed", deletedAt: new Date() })
              .where(eq(marketplaceListings.id, report.targetId));
            break;
          case "job":
            await tx
              .update(jobs)
              .set({ status: "archived" })
              .where(eq(jobs.id, report.targetId));
            break;
          case "campaign":
            await tx.update(adCampaigns).set({ status: "paused" }).where(eq(adCampaigns.id, report.targetId));
            break;
          default:
            return errorResponse("Removal is not supported for this target");
        }
      }
      const [modAction] =
        action === "dismiss"
          ? []
          : await tx
              .insert(moderationActions)
              .values({
                targetType: report.targetType,
                targetId: report.targetId,
                actorId: session.user.id,
                action,
                reason,
              })
              .returning();
      await tx
        .update(reports)
        .set({ status: action === "dismiss" ? "dismissed" : "resolved" })
        .where(eq(reports.id, reportId));
      await tx
        .insert(auditLogs)
        .values({
          actorId: session.user.id,
          action: `moderation.${action}`,
          targetType: report.targetType,
          targetId: report.targetId,
          metadata: { reportId, reason },
        });
      return successResponse({ action: modAction ?? null }, 201);
    });
  } catch (err) {
    console.error("Moderate error:", err);
    return errorResponse("Failed to moderate", 500);
  }
}
