import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

/** Newest notifications handed to the bell; the list is a window, not the total. */
const LIST_LIMIT = 50;

/**
 * The viewer's notifications, newest first, with the authoritative unread total.
 *
 * `createdAt` is Postgres' own text rather than a JS Date: the column is
 * `timestamp without time zone` holding UTC wall-clock, and postgres.js reads
 * that back as *local* time, so serialising the Date would shift every
 * timestamp by the machine's UTC offset.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const rows = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        message: notifications.message,
        userId: notifications.userId,
        sourceUserId: notifications.sourceUserId,
        targetType: notifications.targetType,
        targetId: notifications.targetId,
        read: sql<boolean>`(${notifications.readAt} is not null)`,
        createdAt: sql<string>`to_char(${notifications.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(notifications)
      .where(eq(notifications.userId, session.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(LIST_LIMIT);

    const [{ unread }] = await db
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));

    return successResponse({ notifications: rows, unreadCount: unread });
  } catch (err) {
    console.error("Get notifications error:", err);
    return errorResponse("Failed to fetch notifications", 500);
  }
}

/**
 * Marks notifications read — one, or all of them.
 *
 * The response carries the recomputed unread total so the badge settles on the
 * server's number instead of trusting its own optimistic decrement.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const markAll = body?.all === true;
    const id = typeof body?.id === "string" ? body.id : null;

    if (!markAll && !id) {
      return errorResponse("Provide an id, or all: true");
    }
    if (id && !isUuid(id)) {
      return errorResponse("Invalid id");
    }

    // Scoped to the viewer AND to still-unread rows, so marking is idempotent
    // and cannot touch somebody else's notification.
    const unreadForViewer = and(
      eq(notifications.userId, session.user.id),
      isNull(notifications.readAt),
    );

    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(markAll || !id ? unreadForViewer : and(unreadForViewer, eq(notifications.id, id)))
      .returning({ id: notifications.id });

    const [{ unread }] = await db
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));

    return successResponse({ updated: updated.length, unreadCount: unread });
  } catch (err) {
    console.error("Mark notifications read error:", err);
    return errorResponse("Failed to update notifications", 500);
  }
}
