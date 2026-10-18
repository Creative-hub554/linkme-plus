import { db } from "@/lib/db";
import { conversationMembers, messages, reactions } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, and } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";
import { isChatReactionType } from "@/lib/chat-reactions";

/**
 * Chat reactions: the generic reactions row, on a message.
 *
 * The table is the one the post's heart already writes to — `targetType` says
 * what the row is on — so a message reaction is `targetType: "message"` and
 * there is no second table to keep in step. What a message has that a post does
 * not is a **membership rule**: a thread belongs to its two members, so every
 * read and every write here passes the same gate the thread itself does. Naming
 * a message id is not enough — a stranger gets `404` for a message they are not
 * in the thread of, before any reaction row is looked at.
 *
 * The toggle is the posts route's contract by shape: one reaction per member
 * per message, a press that repeats the held type removes it, a press that
 * changes it replaces the row, and the answer is `{ reacted, type }` — the
 * state the screen should draw afterwards.
 */
type GateResult =
  | { response: Response }
  | { message: { id: string; conversationId: string } };

/**
 * The message, then the caller's seat in its conversation — in that order, so
 * a message that is not there is a `404` and one the caller may not reach is a
 * `403`, and neither leaves a reaction row read or written.
 */
async function gateOnMessage(
  targetId: string,
  userId: string,
): Promise<GateResult> {
  const [message] = await db
    .select({ id: messages.id, conversationId: messages.conversationId })
    .from(messages)
    .where(eq(messages.id, targetId));

  if (!message) {
    return { response: errorResponse("Message not found", 404) };
  }

  const [membership] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, message.conversationId),
        eq(conversationMembers.userId, userId),
      ),
    );

  if (!membership) {
    return { response: errorResponse("Unauthorized", 403) };
  }

  return { message };
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { targetId, type } = body;

    if (!targetId || !type) {
      return errorResponse("Message ID and reaction type are required");
    }
    // The id is bound into the message lookup below, and the type is stored in
    // a column the vocabulary draws — each rejected here rather than as a
    // database error the catch reports as a 500.
    if (typeof targetId !== "string" || !isUuid(targetId)) {
      return errorResponse("Invalid message id", 400);
    }
    if (!isChatReactionType(type)) {
      return errorResponse("Unknown reaction type", 400);
    }

    const gated = await gateOnMessage(targetId, session.user.id);
    if ("response" in gated) return gated.response;

    // The existing row is read scoped to the caller: the reaction is theirs
    // even on the other member's message, so the lookup trusts the session and
    // never the body.
    const [existing] = await db
      .select({ id: reactions.id, type: reactions.type })
      .from(reactions)
      .where(
        and(
          eq(reactions.targetType, "message"),
          eq(reactions.targetId, targetId),
          eq(reactions.userId, session.user.id),
        ),
      );

    if (existing) {
      // The same press again takes the reaction off.
      if (existing.type === type) {
        await db.delete(reactions).where(eq(reactions.id, existing.id));
        return successResponse({ reacted: false, type: null });
      }
      // A different press replaces it — one reaction per member per message.
      const [updated] = await db
        .update(reactions)
        .set({ type })
        .where(eq(reactions.id, existing.id))
        .returning();
      return successResponse({ reacted: true, type: updated?.type ?? type });
    }

    const [inserted] = await db
      .insert(reactions)
      .values({
        targetType: "message",
        targetId,
        userId: session.user.id,
        type,
      })
      .returning();

    return successResponse({ reacted: true, type: inserted?.type ?? type }, 201);
  } catch (err) {
    console.error("Toggle message reaction error:", err);
    return errorResponse("Failed to toggle reaction", 500);
  }
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const targetId = url.searchParams.get("targetId");

  if (!targetId) {
    return errorResponse("Message ID is required");
  }
  if (!isUuid(targetId)) {
    return errorResponse("Invalid message id", 400);
  }

  try {
    // The same gate as the write: the counters of a thread are as private as
    // the thread, so a non-member learns only that they may not look.
    const gated = await gateOnMessage(targetId, session.user.id);
    if ("response" in gated) return gated.response;

    const rows = await db
      .select({ userId: reactions.userId, type: reactions.type })
      .from(reactions)
      .where(
        and(
          eq(reactions.targetType, "message"),
          eq(reactions.targetId, targetId),
        ),
      );

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = (counts[row.type] ?? 0) + 1;
    }
    const mine = rows.find((row) => row.userId === session.user.id);

    return successResponse({
      counts,
      total: rows.length,
      userReaction: mine?.type ?? null,
    });
  } catch (err) {
    console.error("Get message reactions error:", err);
    return errorResponse("Failed to fetch reactions", 500);
  }
}
