import { db } from "@/lib/db";
import { moderationActions, users } from "@/lib/db/schema";
import { requireAuth, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { count, desc, eq } from "drizzle-orm";

/**
 * The moderation record, read back.
 *
 * Every decision the moderate route writes — a warning, a removal, a
 * suspension, a ban — lands in `moderation_actions` here it is listed again,
 * newest first, with the actor's handle joined beside each row. An action is
 * a matter of record precisely so it can be shown to whoever audits the
 * platform later; hiding it under an id would defeat the audit.
 *
 * Admin-gated the same as the reports route: the caller's role is read
 * before anything is fetched. The list read joins `users` for the actor's
 * username — `actor_id` is a cascade-deleting foreign key, so the actor is
 * always there and an inner join loses nothing. The `total` is a separate
 * count, which is the number the pagination shows beside the list.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));

  if (!user || user.role !== "admin") {
    return errorResponse("Unauthorized", 403);
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  try {
    const result = await db
      .select({
        id: moderationActions.id,
        action: moderationActions.action,
        targetType: moderationActions.targetType,
        targetId: moderationActions.targetId,
        reason: moderationActions.reason,
        createdAt: moderationActions.createdAt,
        actorUsername: users.username,
      })
      .from(moderationActions)
      .innerJoin(users, eq(moderationActions.actorId, users.id))
      .orderBy(desc(moderationActions.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(moderationActions);

    return paginatedResponse(result, total, page, limit);
  } catch (err) {
    console.error("Get moderation actions error:", err);
    return errorResponse("Failed to fetch moderation history", 500);
  }
}
