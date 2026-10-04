import { db } from "@/lib/db";
import { blocks } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { eq, and } from "drizzle-orm";

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return errorResponse("User ID is required");
    }

    if (userId === session.user.id) {
      return errorResponse("Cannot block yourself");
    }

    // The id is bound into the block lookup below, so reject a non-uuid here
    // rather than letting the database raise a type error as a 500.
    if (typeof userId !== "string" || !isUuid(userId)) {
      return errorResponse("Invalid user ID");
    }

    // Check if already blocked
    const [existing] = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.blockerId, session.user.id),
          eq(blocks.blockedId, userId)
        )
      );

    if (existing) {
      // Unblock
      await db.delete(blocks).where(eq(blocks.id, existing.id));
      return successResponse({ blocked: false });
    }

    // Block
    await db.insert(blocks).values({
      blockerId: session.user.id,
      blockedId: userId,
    });

    return successResponse({ blocked: true }, 201);
  } catch (err) {
    console.error("Toggle block error:", err);
    return errorResponse("Failed to toggle block", 500);
  }
}
