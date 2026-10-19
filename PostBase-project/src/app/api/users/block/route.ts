import { db } from "@/lib/db";
import { blocks, follows, users } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { and, count, eq, or } from "drizzle-orm";

function readTarget(request: Request): string | null {
  return new URL(request.url).searchParams.get("userId");
}

function validTarget(userId: unknown, viewerId: string): userId is string {
  return typeof userId === "string" && isUuid(userId) && userId !== viewerId;
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const userId = readTarget(request);
  if (!userId) return errorResponse("User ID is required");
  if (!isUuid(userId)) return errorResponse("Invalid user ID");
  if (userId === session.user.id) return errorResponse("Cannot block yourself");

  try {
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!target) return errorResponse("User not found", 404);

    const [existing] = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.blockerId, session.user.id), eq(blocks.blockedId, userId)))
      .limit(1);

    return successResponse({ blocked: Boolean(existing) });
  } catch (err) {
    console.error("Read block state error:", err);
    return errorResponse("Failed to read block state", 500);
  }
}

/** Toggle a block. Creating one also removes any follow edges between the pair. */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const userId = body?.userId;

    if (!userId) return errorResponse("User ID is required");
    if (userId === session.user.id) return errorResponse("Cannot block yourself");
    if (!validTarget(userId, session.user.id)) return errorResponse("Invalid user ID");

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!target) return errorResponse("User not found", 404);

    const result = await db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: blocks.id })
        .from(blocks)
        .where(and(eq(blocks.blockerId, session.user.id), eq(blocks.blockedId, userId)))
        .limit(1);

      if (existing) {
        await transaction.delete(blocks).where(eq(blocks.id, existing.id));
        const [{ followers }] = await transaction
          .select({ followers: count() })
          .from(follows)
          .where(eq(follows.followingId, userId));
        const [{ following }] = await transaction
          .select({ following: count() })
          .from(follows)
          .where(eq(follows.followerId, userId));
        return { blocked: false, followers, following };
      }

      await transaction.insert(blocks).values({
        blockerId: session.user.id,
        blockedId: userId,
      });
      await transaction
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, session.user.id), eq(follows.followingId, userId)),
            and(eq(follows.followerId, userId), eq(follows.followingId, session.user.id)),
          ),
        );

      const [{ followers }] = await transaction
        .select({ followers: count() })
        .from(follows)
        .where(eq(follows.followingId, userId));
      const [{ following }] = await transaction
        .select({ following: count() })
        .from(follows)
        .where(eq(follows.followerId, userId));
      return { blocked: true, followers, following };
    });

    return successResponse(result, result.blocked ? 201 : 200);
  } catch (err) {
    console.error("Toggle block error:", err);
    return errorResponse("Failed to toggle block", 500);
  }
}
