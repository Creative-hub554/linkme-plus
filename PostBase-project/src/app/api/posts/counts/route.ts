import { db, withDbRetry } from "@/lib/db";
import { posts, comments, reactions } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { and, inArray, sql } from "drizzle-orm";

/** Ceiling on ids per lookup, so a crafted request cannot ask for the world. */
const MAX_LOOKUP_IDS = 100;

/**
 * Engagement counts for specific posts.
 *
 * Realtime pushes absolute counts as they change, so this exists for the one
 * case a push cannot cover: reconnecting. Events that fired while the socket was
 * down are gone, so the feed reconciles against this afterwards.
 *
 * Only posts the reader may still see are returned. That is deliberate — a
 * requested id that is *missing* from a successful response has been deleted,
 * or had its audience narrowed away from the reader, which is how the feed
 * catches either while it was not connected. Callers must therefore treat an
 * absent id as removed, not as an error.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const raw = url.searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];

  if (ids.length === 0) {
    return errorResponse("At least one id is required", 400);
  }
  if (ids.length > MAX_LOOKUP_IDS) {
    return errorResponse(`At most ${MAX_LOOKUP_IDS} ids can be looked up at once`, 400);
  }
  if (ids.some((id) => !isUuid(id))) {
    return errorResponse("Invalid ids", 400);
  }

  try {
    // The outer reference is spelled out as `"posts"."id"` rather than
    // interpolated: drizzle drops the table qualifier in a single-table query, so
    // `${posts.id}` would render as a bare `"id"` — which the subquery resolves
    // to its *own* `comments.id`, making the condition `c.post_id = c.id` and
    // silently counting nothing. The list endpoint escapes this only because its
    // joins force full qualification.
    const rows = await withDbRetry(() =>
      db
        .select({
          id: posts.id,
          commentCount: sql<number>`(
            select count(*)::int from ${comments} as c
            where c.post_id = "posts"."id" and c.deleted_at is null
          )`,
          reactionCount: sql<number>`(
            select count(*)::int from ${reactions} as r
            where r.target_type = 'post' and r.target_id = "posts"."id"
          )`,
        })
        .from(posts)
        // Only posts the reader may still see are returned. An id that drops
        // out because its audience narrowed reads as absent, exactly like a
        // deleted one, which is how the feed sheds a card it can no longer
        // show after a reconnect.
        .where(
          and(
            inArray(posts.id, ids),
            sql`${posts.deletedAt} IS NULL`,
            visiblePostsCondition(session.user.id),
          ),
        ),
    );

    return successResponse({ data: rows });
  } catch (err) {
    console.error("Get post counts error:", err);
    return errorResponse("Failed to fetch post counts", 500);
  }
}
