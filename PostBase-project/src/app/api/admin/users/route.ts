import { db } from "@/lib/db";
import { users, accountRestrictions, auditLogs } from "@/lib/db/schema";
import { requireAuth, errorResponse, successResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { and, eq, ilike, isNull, desc } from "drizzle-orm";
import { offsetPagination } from "@/lib/offset-pagination";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const [actor] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (actor?.role !== "admin")
      return errorResponse("Administrator access required", 403);
    const params = new URL(request.url).searchParams,
      { limit, offset } = offsetPagination(params);
    const search = params.get("q")?.trim().slice(0, 100);
    const members = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        restrictionKind: accountRestrictions.kind,
        restrictedUntil: accountRestrictions.until,
      })
      .from(users)
      .leftJoin(accountRestrictions, eq(users.id, accountRestrictions.userId))
      .where(
        and(
          isNull(users.deletedAt),
          search ? ilike(users.username, `%${search}%`) : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit + 1)
      .offset(offset);
    return successResponse({
      data: members.slice(0, limit),
      hasMore: members.length > limit,
    });
  } catch {
    return errorResponse("Unable to load members", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const [actor] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (actor?.role !== "admin")
      return errorResponse("Administrator access required", 403);
    const { userId, action, reason, days } = await request.json();
    if (
      typeof userId !== "string" ||
      !isUuid(userId) ||
      userId === session.user.id
    )
      return errorResponse("Select another valid member");
    if (
      !["suspend", "ban", "restore"].includes(action) ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 2000
    )
      return errorResponse("A valid action and reason are required");
    if (
      action === "suspend" &&
      (!Number.isInteger(days) || days < 1 || days > 365)
    )
      return errorResponse("Suspension must be between 1 and 365 days");
    return await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!target) return errorResponse("Member not found", 404);
      if (target.role === "admin")
        return errorResponse(
          "Administrator accounts cannot be restricted here",
          403,
        );
      await tx
        .delete(accountRestrictions)
        .where(eq(accountRestrictions.userId, userId));
      if (action !== "restore")
        await tx.insert(accountRestrictions).values({
          userId,
          kind: action === "ban" ? "ban" : "suspension",
          until:
            action === "suspend"
              ? new Date(Date.now() + days * 86400000)
              : null,
          reason: reason.trim(),
          actorId: session.user.id,
        });
      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        action: `account.${action}`,
        targetType: "user",
        targetId: userId,
        metadata: {
          reason: reason.trim(),
          days: action === "suspend" ? days : null,
        },
      });
      return successResponse({ success: true });
    });
  } catch {
    return errorResponse("Unable to update account restriction", 500);
  }
}
