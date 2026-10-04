import { db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { eq, inArray, sql } from "drizzle-orm";

/**
 * Member summaries by id, for hydrating a row that arrived over Realtime.
 *
 * Realtime carries ids, not profiles, so a list showing "somebody just followed
 * you" needs the member behind the id. `GET /api/users?id=` can do that, but it
 * answers a different question — it resolves a profile page, which means
 * ensuring the *viewer's* local profile exists and counting that member's
 * followers and following. None of that is needed for a row, and on a pooled
 * connection the extra queries are most of the response time.
 *
 * Same shape as the feed's `GET /api/posts?ids=` hydration, and deliberately no
 * more than a summary.
 */
const MAX_IDS = 25;

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return errorResponse("`ids` is required");
  }
  if (ids.length > MAX_IDS) {
    return errorResponse(`At most ${MAX_IDS} ids per request`);
  }
  if (!ids.every(isUuid)) {
    return errorResponse("Invalid user ID");
  }

  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        // Falls back to the username so a member without a profile row is still
        // nameable rather than an anonymous blank in a list.
        displayName: sql<string>`coalesce(${profiles.displayName}, ${users.username})`,
        avatarUrl: profiles.avatarUrl,
        bio: profiles.bio,
        // Whether the viewer follows them, so a rendered row can offer the right
        // action. The outer id keeps its table qualifier: drizzle drops it in a
        // single-table query, which would make the subquery compare a column
        // against itself and always answer false.
        isFollowing: sql<boolean>`exists (
          select 1 from "follows" as viewer_follow
          where viewer_follow."follower_id" = ${session.user.id}
            and viewer_follow."following_id" = "users"."id"
        )`,
      })
      .from(users)
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(inArray(users.id, ids));

    return successResponse({ data: rows });
  } catch (err) {
    console.error("Brief users error:", err);
    return errorResponse("Failed to load those members", 500);
  }
}
