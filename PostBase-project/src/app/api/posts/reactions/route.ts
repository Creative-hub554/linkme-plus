import { db } from "@/lib/db";
import { posts, reactions } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, and } from "drizzle-orm";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { isUuid } from "@/lib/cursor-pagination";

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { targetType, targetId, type } = body;

    if (!targetType || !targetId || !type) {
      return errorResponse("Target type, target ID, and reaction type are required");
    }
    if (typeof targetId !== "string" || !isUuid(targetId)) {
      return errorResponse("Invalid target id", 400);
    }

    // A reaction is only written onto a thing the viewer may reach. For a post,
    // that means the post's audience rule, exactly as in `GET`: a private or
    // followers-only post must not be reachable by naming its id. Any other
    // target type carries no audience and is left ungated.
    if (targetType === "post") {
      const [visiblePost] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, targetId), visiblePostsCondition(session.user.id)));
      if (!visiblePost) {
        return errorResponse("Post not found", 404);
      }
    }

    // Check if already reacted
    const [existing] = await db
      .select()
      .from(reactions)
      .where(
        and(
          eq(reactions.targetType, targetType),
          eq(reactions.targetId, targetId),
          eq(reactions.userId, session.user.id)
        )
      );

    if (existing) {
      // Toggle off if same reaction type
      if (existing.type === type) {
        await db
          .delete(reactions)
          .where(eq(reactions.id, existing.id));
        return successResponse({ reacted: false, type: null });
      }
      // Update reaction type
      const [updated] = await db
        .update(reactions)
        .set({ type })
        .where(eq(reactions.id, existing.id))
        .returning();
      return successResponse({ reacted: true, type: updated.type });
    }

    // New reaction
    const [newReaction] = await db
      .insert(reactions)
      .values({
        targetType,
        targetId,
        userId: session.user.id,
        type,
      })
      .returning();

    return successResponse({ reacted: true, type: newReaction.type }, 201);
  } catch (err) {
    console.error("Toggle reaction error:", err);
    return errorResponse("Failed to toggle reaction", 500);
  }
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");

  if (!targetType || !targetId) {
    return errorResponse("Target type and target ID are required");
  }
  // `reactions.target_id` is a `uuid` column, so a value that is not one is a
  // 400 rather than a cast failure the catch reports as a 500.
  if (!isUuid(targetId)) {
    return errorResponse("Invalid target id", 400);
  }

  try {
    // A reaction is only readable through the thing it is on. For a post, that
    // means the post's audience rule: a private or followers-only post's
    // counters must not be readable by naming its id.
    if (targetType === "post") {
      const [visiblePost] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, targetId), visiblePostsCondition(session.user.id)));
      if (!visiblePost) {
        return errorResponse("Post not found", 404);
      }
    }

    const result = await db
      .select()
      .from(reactions)
      .where(
        and(
          eq(reactions.targetType, targetType),
          eq(reactions.targetId, targetId)
        )
      );

    // Group by type
    const grouped = result.reduce((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Check if current user reacted
    const userReaction = result.find((r) => r.userId === session.user.id);

    return successResponse({
      counts: grouped,
      total: result.length,
      userReaction: userReaction?.type || null,
    });
  } catch (err) {
    console.error("Get reactions error:", err);
    return errorResponse("Failed to fetch reactions", 500);
  }
}
