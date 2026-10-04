import { db } from "@/lib/db";
import { blocks, conversations, conversationMembers, messages, users, profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, and, desc, sql } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";
import { blockedEitherWay } from "@/lib/db/blocks";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("id");

  try {
    if (conversationId) {
      // Get conversation messages
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (!conversation) {
        return errorResponse("Conversation not found", 404);
      }

      // Check membership
      const [membership] = await db
        .select()
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, session.user.id)
          )
        );

      if (!membership) {
        return errorResponse("Unauthorized", 403);
      }

      // Get messages
      const msgs = await db
        .select({
          id: messages.id,
          content: messages.content,
          senderId: messages.senderId,
          readAt: messages.readAt,
          createdAt: messages.createdAt,
          sender: {
            name: profiles.displayName,
            avatarUrl: profiles.avatarUrl,
          },
        })
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .innerJoin(profiles, eq(users.id, profiles.userId))
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt);

      // Get other member
      const [otherMember] = await db
        .select({
          userId: conversationMembers.userId,
          name: profiles.displayName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(conversationMembers)
        .innerJoin(profiles, eq(conversationMembers.userId, profiles.userId))
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            sql`${conversationMembers.userId} != ${session.user.id}`
          )
        );

      // Mark as read
      await db
        .update(conversationMembers)
        .set({ lastReadAt: new Date() })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, session.user.id)
          )
        );

      return successResponse({
        conversation,
        messages: msgs,
        otherMember,
      });
    }

    // List conversations
    const userConversations = await db
      .select({
        id: conversations.id,
        createdAt: conversations.createdAt,
        lastReadAt: conversationMembers.lastReadAt,
      })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        eq(conversations.id, conversationMembers.conversationId)
      )
      .where(eq(conversationMembers.userId, session.user.id))
      .orderBy(desc(conversations.createdAt));

    // Get other member and last message for each conversation
    const conversationsWithDetails = await Promise.all(
      userConversations.map(async (conv) => {
        const [other] = await db
          .select({
            userId: conversationMembers.userId,
            name: profiles.displayName,
            avatarUrl: profiles.avatarUrl,
          })
          .from(conversationMembers)
          .innerJoin(profiles, eq(conversationMembers.userId, profiles.userId))
          .where(
            and(
              eq(conversationMembers.conversationId, conv.id),
              sql`${conversationMembers.userId} != ${session.user.id}`
            )
          );

        const [lastMessage] = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        return {
          ...conv,
          otherMember: other,
          lastMessage,
        };
      })
    );

    return successResponse({ conversations: conversationsWithDetails });
  } catch (err) {
    console.error("Get conversations error:", err);
    return errorResponse("Failed to fetch conversations", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { recipientId, content } = body;

    if (!recipientId || !content) {
      return errorResponse("Recipient ID and content are required");
    }

    // The id is bound into the block lookup below, so reject a non-uuid here
    // rather than letting the database raise a type error as a 500.
    if (!isUuid(recipientId)) {
      return errorResponse("Invalid recipient ID");
    }

    // A block is a prohibition on interaction, and it holds in both directions:
    // the recipient may have blocked the sender, or the sender the recipient.
    // Either way the message must not be sent, and must not create a
    // conversation that would leak the pair to each other.
    const [block] = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(blockedEitherWay(session.user.id, recipientId))
      .limit(1);

    if (block) {
      return errorResponse("You cannot message this member", 403);
    }

    // Check if conversation already exists
    const userConversations = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.userId, session.user.id));

    for (const uc of userConversations) {
      const [otherMember] = await db
        .select()
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, uc.conversationId),
            eq(conversationMembers.userId, recipientId)
          )
        );

      if (otherMember) {
        // Conversation exists, send message
        const [newMessage] = await db
          .insert(messages)
          .values({
            conversationId: uc.conversationId,
            senderId: session.user.id,
            content,
          })
          .returning();

        return successResponse({ message: newMessage, conversationId: uc.conversationId }, 201);
      }
    }

    // Create new conversation
    const [newConversation] = await db
      .insert(conversations)
      .values({})
      .returning();

    // Add members
    await db.insert(conversationMembers).values([
      { conversationId: newConversation.id, userId: session.user.id },
      { conversationId: newConversation.id, userId: recipientId },
    ]);

    // Send first message
    const [newMessage] = await db
      .insert(messages)
      .values({
        conversationId: newConversation.id,
        senderId: session.user.id,
        content,
      })
      .returning();

    return successResponse(
      { message: newMessage, conversationId: newConversation.id },
      201
    );
  } catch (err) {
    console.error("Create/send message error:", err);
    return errorResponse("Failed to send message", 500);
  }
}
