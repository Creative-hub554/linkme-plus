import { db } from "@/lib/db";
import { reports, users, reportStatusEnum } from "@/lib/db/schema";
import { requireAuth, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { eq, sql, count, desc } from "drizzle-orm";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  // Check admin role
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user || user.role !== "admin") {
    return errorResponse("Unauthorized", 403);
  }

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") || "pending";
  // "all" means "do not filter"; anything else is narrowed to a real enum
  // member, so the value handed to Drizzle is one the column can accept.
  const status: (typeof reportStatusEnum.enumValues)[number] | "all" =
    requestedStatus === "all"
      ? "all"
      : reportStatusEnum.enumValues.find((value) => value === requestedStatus) ?? "pending";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  try {
    const result = await db
      .select()
      .from(reports)
      .where(status !== "all" ? eq(reports.status, status) : sql`1 = 1`)
      .orderBy(desc(reports.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(reports)
      .where(status !== "all" ? eq(reports.status, status) : sql`1 = 1`);

    return paginatedResponse(result, total, page, limit);
  } catch (err) {
    console.error("Get reports error:", err);
    return errorResponse("Failed to fetch reports", 500);
  }
}
