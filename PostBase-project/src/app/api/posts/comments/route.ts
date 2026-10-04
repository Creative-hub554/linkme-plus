import { db } from "@/lib/db";
import { comments, posts, users, profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { eq, desc, and, inArray, sql, count } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";
import { visiblePostsCondition } from "@/lib/db/post-visibility";

/** Ceiling on ids per lookup, so a crafted request cannot ask for the world. */
const MAX_LOOKUP_IDS = 25;

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const postId = url.searchParams.get("postId");
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  // Realtime names the comment that was just published; the feed hydrates that
  // one by id so it can join an open thread with its author attached.
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam
    ? [...new Set(idsParam.split(",").map((value) => value.trim()).filter(Boolean))]
    : [];
  if (ids.length > MAX_LOOKUP_IDS) {
    return errorResponse(`At most ${MAX_LOOKUP_IDS} ids can be looked up at once`, 400);
  }
  if (ids.some((id) => !isUuid(id))) {
    return errorResponse("Invalid ids", 400);
  }
  if (ids.length === 0 && !postId) {
    return errorResponse("A post ID or comment ids are required");
  }
  // Bound into a `uuid` column below, so a value that is not one is a 400 rather
  // than a cast failure the catch reports as a 500.
  if (postId && !isUuid(postId)) {
    return errorResponse("Invalid post id", 400);
  }

  // A missing profile row must never hide a comment: the author falls back to
  // the account username. Without this the list dropped comments that the
  // total still counted, so the number could never match what was shown.
  const selectComment = {
    id: comments.id,
    content: comments.content,
    parentId: comments.parentId,
    createdAt: comments.createdAt,
    author: {
      id: users.id,
      name: sql<string | null>`coalesce(${profiles.displayName}, ${users.username})`,
      username: users.username,
      avatarUrl: profiles.avatarUrl,
    },
  };

  try {
    if (ids.length > 0) {
      // A comment is only readable through the post it belongs to, so the post
      // is joined and the audience rule applied: naming a comment id must not
      // reveal a comment on a private or followers-only post.
      const commentsById = await db
        .select(selectComment)
        .from(comments)
        .innerJoin(users, eq(comments.authorId, users.id))
        .leftJoin(profiles, eq(users.id, profiles.userId))
        .innerJoin(posts, eq(comments.postId, posts.id))
        .where(
          and(
            inArray(comments.id, ids),
            sql`${comments.deletedAt} IS NULL`,
            visiblePostsCondition(session.user.id)
          )
        )
        .orderBy(desc(comments.createdAt));

      return successResponse({ data: commentsById });
    }

    // The post must be one the viewer may read before its thread is served: a
    // private or followers-only post's comments are exactly as private as the
    // post. A post that is not there, or not visible, is the same non-answer.
    const [visiblePost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId as string), visiblePostsCondition(session.user.id)));
    if (!visiblePost) {
      return errorResponse("Post not found", 404);
    }

    const result = await db
      .select(selectComment)
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(and(eq(comments.postId, postId as string), sql`${comments.deletedAt} IS NULL`))
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(comments)
      .where(and(eq(comments.postId, postId as string), sql`${comments.deletedAt} IS NULL`));

    return paginatedResponse(result, total, page, limit);
  } catch (err) {
    console.error("Get comments error:", err);
    return errorResponse("Failed to fetch comments", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { postId, content, parentId } = body;

    if (!postId || !content) {
      return errorResponse("Post ID and content are required");
    }

    // The id is bound into the visibility read below, so reject a non-uuid here
    // rather than letting the database raise a type error as a 500.
    if (typeof postId !== "string" || !isUuid(postId)) {
      return errorResponse("Invalid post ID");
    }

    // A comment is only written onto a post the viewer may read: naming a
    // private or followers-only post's id must not be a way to comment on it.
    // The same audience rule the thread reads apply is consulted first, and a
    // post that is not there, or not visible, is the same non-answer.
    const [visiblePost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), visiblePostsCondition(session.user.id)));
    if (!visiblePost) {
      return errorResponse("Post not found", 404);
    }

    const [newComment] = await db
      .insert(comments)
      .values({
        postId,
        authorId: session.user.id,
        content,
        parentId: parentId || null,
      })
      .returning();

    return successResponse({ comment: newComment }, 201);
  } catch (err) {
    console.error("Create comment error:", err);
    return errorResponse("Failed to create comment", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return errorResponse("Comment ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid comment id", 400);
    }

    const [deleted] = await db
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(and(eq(comments.id, id), eq(comments.authorId, session.user.id)))
      .returning();

    if (!deleted) {
      return errorResponse("Comment not found or unauthorized", 404);
    }

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete comment error:", err);
    return errorResponse("Failed to delete comment", 500);
  }
}
