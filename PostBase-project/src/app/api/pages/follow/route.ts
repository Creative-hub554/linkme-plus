import { db } from "@/lib/db";
import { pages, pageFollows } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { and, count, eq } from "drizzle-orm";

/**
 * Follows or unfollows a Page.
 *
 * Deliberately the same contract as the member route next door: `following` may
 * state the intent, so a client holding a stale view lands on the state the
 * person asked for rather than flipping the relationship the wrong way, and the
 * new follower total comes back so the caller never has to guess ±1. The
 * difference is only the table — a Page has no id `follows.following_id` could
 * hold.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const pageId = typeof body?.pageId === "string" ? body.pageId : null;
    const desired = body?.following;

    if (!pageId) return errorResponse("Page ID is required");
    if (!isUuid(pageId)) return errorResponse("Invalid Page ID");
    if (desired !== undefined && typeof desired !== "boolean") {
      return errorResponse("`following` must be true or false when provided");
    }

    const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, pageId));
    if (!page) return errorResponse("Page not found", 404);

    const relationship = and(
      eq(pageFollows.pageId, pageId),
      eq(pageFollows.userId, session.user.id),
    );
    const [existing] = await db
      .select({ id: pageFollows.id })
      .from(pageFollows)
      .where(relationship);

    const shouldFollow = desired ?? !existing;
    let changed = false;

    if (shouldFollow && !existing) {
      // `onConflictDoNothing` against the unique `(page_id, user_id)` index: a
      // second request that interleaved with this one writes the same pair and
      // is dropped, rather than inserting a duplicate the COUNT would report and
      // an unfollow would leave behind.
      const inserted = await db
        .insert(pageFollows)
        .values({ pageId, userId: session.user.id })
        .onConflictDoNothing()
        .returning({ id: pageFollows.id });
      changed = inserted.length > 0;
    } else if (!shouldFollow && existing) {
      const removed = await db.delete(pageFollows).where(relationship).returning({ id: pageFollows.id });
      changed = removed.length > 0;
    }

    const [{ followers }] = await db
      .select({ followers: count() })
      .from(pageFollows)
      .where(eq(pageFollows.pageId, pageId));

    return successResponse({ following: shouldFollow, followers }, changed ? 201 : 200);
  } catch (err) {
    console.error("Toggle page follow error:", err);
    return errorResponse("Failed to toggle follow", 500);
  }
}
