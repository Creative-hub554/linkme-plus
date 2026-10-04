import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { and, eq } from "drizzle-orm";

const allowedReasons = new Set([
  "spam or scam",
  "harassment or bullying",
  "nudity or sexual content",
  "hate or violence",
  "false or misleading information",
  "other",
]);

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const targetId = typeof body.targetId === "string" ? body.targetId : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().toLowerCase() : "";
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : null;

    if (!targetId || !allowedReasons.has(reason)) {
      return errorResponse("A valid post and report reason are required");
    }

    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, session.user.id),
          eq(reports.targetType, "post"),
          eq(reports.targetId, targetId),
          eq(reports.status, "pending")
        )
      );

    if (existing) {
      return successResponse({ reported: true, duplicate: true });
    }

    const [report] = await db
      .insert(reports)
      .values({
        reporterId: session.user.id,
        targetType: "post",
        targetId,
        reason,
        description,
      })
      .returning({ id: reports.id, status: reports.status });

    return successResponse({ reported: true, report }, 201);
  } catch (reportError) {
    console.error("Create post report error:", reportError);
    return errorResponse("Unable to submit this report", 500);
  }
}
