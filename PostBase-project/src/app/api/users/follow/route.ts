import { db } from "@/lib/db";
import { blocks, follows, profiles, users } from "@/lib/db/schema";
import { blockedEitherWay, notBlockedEitherWay } from "@/lib/db/blocks";
import {
  requireAuth,
  successResponse,
  errorResponse,
  cursorPaginatedResponse,
} from "@/lib/api-helpers";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  isUuid,
  type CursorPosition,
} from "@/lib/cursor-pagination";
import { and, count, desc, eq, sql } from "drizzle-orm";

/**
 * A member's followers or the members they follow, newest relationship first.
 *
 * `type=followers` lists the members who follow `userId`; `type=following`
 * lists the members `userId` follows. Paginated by keyset like the feed, so a
 * follow arriving mid-scroll neither repeats nor skips a row.
 *
 * Two things this deliberately does *not* do. It does not hide a member whose
 * `profiles` row is missing (the name falls back to their username): a list that
 * quietly drops a follower makes the count and the list disagree, and it is the
 * count people will believe. Nor does it count the whole relation — a page only
 * needs to know whether it can ask for more.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const type = url.searchParams.get("type") ?? "followers";

  if (!userId || !isUuid(userId)) {
    return errorResponse("A valid user ID is required");
  }
  if (type !== "followers" && type !== "following") {
    return errorResponse("`type` must be `followers` or `following`");
  }

  const rawCursor = url.searchParams.get("cursor");
  const cursor: CursorPosition | null = decodeCursor(rawCursor);
  if (rawCursor && !cursor) {
    return errorResponse("Invalid cursor", 400);
  }
  const limit = clampLimit(url.searchParams.get("limit"), 20);

  try {
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!target) {
      return errorResponse("User not found", 404);
    }

    // Which side of the relationship is *listed*, and which side is the member
    // whose list this is.
    const listedColumn = type === "followers" ? follows.followerId : follows.followingId;
    const ownerColumn = type === "followers" ? follows.followingId : follows.followerId;

    // A block hides the pair from one another in both directions: a member the
    // viewer has blocked, or who has blocked them, must not appear in the list.
    // It is on every list, not just the viewer's own, because the relationship
    // is disclosed to whoever reads either side of it.
    const conditions = [eq(ownerColumn, userId), notBlockedEitherWay(session.user.id, users.id)];
    if (cursor) {
      // Same keyset rule as the feed: strictly older, or the same instant with
      // a smaller id, so rows sharing a timestamp cannot be skipped or repeated.
      conditions.push(
        sql`(${follows.createdAt} < ${cursor.key}::timestamp OR (${follows.createdAt} = ${cursor.key}::timestamp AND ${follows.id} < ${cursor.id}))`
      );
    }

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        // Falls back to the username so a member without a profile row is still
        // listable; see the note above.
        displayName: sql<string>`coalesce(${profiles.displayName}, ${users.username})`,
        avatarUrl: profiles.avatarUrl,
        bio: profiles.bio,
        // Whether the *viewer* follows this member, so a row does not offer to
        // follow somebody they already follow. The outer id is written with its
        // table qualifier: drizzle drops the qualifier in a single-table query,
        // which would make this subquery compare a column against itself.
        isFollowing: sql<boolean>`exists (
          select 1 from "follows" as viewer_follow
          where viewer_follow."follower_id" = ${session.user.id}
            and viewer_follow."following_id" = "users"."id"
        )`,
        followId: follows.id,
        followedAtKey: sql<string>`to_char(${follows.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
      })
      .from(follows)
      .innerJoin(users, eq(listedColumn, users.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(and(...conditions))
      .orderBy(desc(follows.createdAt), desc(follows.id))
      // One extra row reveals whether another page exists without a COUNT.
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor(last.followedAtKey, last.followId) : null;

    return cursorPaginatedResponse(
      page.map(({ followedAtKey: _key, followId: _followId, ...member }) => member),
      limit,
      nextCursor
    );
  } catch (err) {
    console.error("List follows error:", err);
    return errorResponse("Failed to load that list", 500);
  }
}

/**
 * Follows, unfollows, or reports state — as an explicit intent rather than a
 * blind toggle.
 *
 * `following` may be sent to state what the caller wants. That matters because
 * a client can hold a stale view of the relationship: a toggle would silently
 * flip it the wrong way, while an intent is idempotent and always lands on the
 * state the person asked for. Omitting it keeps the original toggle behaviour.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const userId = typeof body?.userId === "string" ? body.userId : null;
    const desired = body?.following;

    if (!userId) {
      return errorResponse("User ID is required");
    }
    if (!isUuid(userId)) {
      return errorResponse("Invalid user ID");
    }
    if (desired !== undefined && typeof desired !== "boolean") {
      return errorResponse("`following` must be true or false when provided");
    }
    if (userId === session.user.id) {
      return errorResponse("Cannot follow yourself");
    }

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!target) {
      return errorResponse("User not found", 404);
    }

    // A block between the two closes the relationship in both directions: the
    // target may have blocked the caller, or the caller the target. Refuse
    // before any write, so a blocked member cannot start following.
    const [block] = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(blockedEitherWay(session.user.id, userId))
      .limit(1);
    if (block) {
      return errorResponse("You cannot follow this member", 403);
    }

    const relationship = and(
      eq(follows.followerId, session.user.id),
      eq(follows.followingId, userId)
    );
    const [existing] = await db.select({ id: follows.id }).from(follows).where(relationship);

    const shouldFollow = desired ?? !existing;
    let changed = false;

    if (shouldFollow && !existing) {
      // `onConflictDoNothing` is what makes the read above safe: a second
      // request that interleaved with this one writes the same pair and is
      // dropped by the unique index instead of creating a duplicate row that
      // unfollow would then leave behind.
      const inserted = await db
        .insert(follows)
        .values({ followerId: session.user.id, followingId: userId })
        .onConflictDoNothing()
        .returning({ id: follows.id });
      changed = inserted.length > 0;
    } else if (!shouldFollow && existing) {
      // Every matching row, not just the one that was read: an unfollow must
      // land on "not following" even if duplicates predate the unique index.
      const removed = await db.delete(follows).where(relationship).returning({ id: follows.id });
      changed = removed.length > 0;
    }

    // The caller's own count would be stale after this, and the target's is what
    // a profile shows, so it is returned rather than left to be guessed at.
    const [{ followers }] = await db
      .select({ followers: count() })
      .from(follows)
      .where(eq(follows.followingId, userId));

    return successResponse({ following: shouldFollow, followers }, changed ? 201 : 200);
  } catch (err) {
    console.error("Toggle follow error:", err);
    return errorResponse("Failed to toggle follow", 500);
  }
}
