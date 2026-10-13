import { db } from "@/lib/db";
import { comments, commentMedia, posts, reactions, users, profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { eq, desc, and, inArray, sql, count } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { deleteStoredObjects, keyBelongsToUser, keyFromPublicUrl } from "@/lib/r2";

/** Ceiling on ids per lookup, so a crafted request cannot ask for the world. */
const MAX_LOOKUP_IDS = 25;

/**
 * Ceiling on photos per comment. A comment is a compact thing in a scrolling
 * thread; four is a gallery's worth at thumbnail size, and the composer stops
 * offering the button at the same number the server refuses past.
 */
const MAX_COMMENT_PHOTOS = 4;

/** A comment's photo as the API hands it to a reader. */
interface CommentPhoto {
  url: string;
  altText: string | null;
  type: string;
}

/**
 * Attaches each comment's photos beside it, in the order they were picked.
 *
 * One batched read for the whole page rather than one per comment, and every
 * comment carries the key even when it holds none — a reader should not have
 * to branch on a field's absence to know the shape it got.
 */
async function withMedia<T extends { id: string }>(
  rows: T[],
): Promise<Array<T & { media: CommentPhoto[] }>> {
  if (rows.length === 0) return [];
  const mediaRows = await db
    .select({
      commentId: commentMedia.commentId,
      url: commentMedia.url,
      altText: commentMedia.altText,
      type: commentMedia.type,
    })
    .from(commentMedia)
    .where(inArray(commentMedia.commentId, rows.map((row) => row.id)))
    .orderBy(commentMedia.order);

  const byComment = new Map<string, CommentPhoto[]>();
  for (const row of mediaRows) {
    const photos = byComment.get(row.commentId) ?? [];
    photos.push({ url: row.url, altText: row.altText, type: row.type });
    byComment.set(row.commentId, photos);
  }
  return rows.map((row) => ({ ...row, media: byComment.get(row.id) ?? [] }));
}

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
    // The viewer's own reaction on this comment — read as the type it is, the
    // same seam the posts read answers — beside the count the thread shows.
    // A thread is served fresh every time it opens, and its reader may have
    // scrolled the owning card out of the window and back: the thread it
    // re-seeds from answered the row, so the heart under a comment survives
    // the remount rather than being re-derived from nothing. The outer
    // reference is spelled out for the same reason the posts counts are — a
    // lone-table select drops the qualifier a bare column name needs to
    // reach the outer row.
    viewerReaction: sql<string | null>`(
      select r.type from ${reactions} as r
      where r.target_type = 'comment' and r.target_id = "comments"."id"
        and r.user_id = ${session.user.id}
    )`,
    reactionCount: sql<number>`(
      select count(*)::int from ${reactions} as r
      where r.target_type = 'comment' and r.target_id = "comments"."id"
    )`,
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

      return successResponse({ data: await withMedia(commentsById) });
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

    return paginatedResponse(await withMedia(result), total, page, limit);
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
    const { postId, content, parentId, media } = body;

    // Text or a photo — a comment with nothing in it is not a comment, and
    // the rule is the one the post composer already states ("content or
    // media is required").
    const hasPhotos = Array.isArray(media) && media.length > 0;
    if (!postId || (!content && !hasPhotos)) {
      return errorResponse("Post ID and content are required");
    }

    // The id is bound into the visibility read below, so reject a non-uuid here
    // rather than letting the database raise a type error as a 500.
    if (typeof postId !== "string" || !isUuid(postId)) {
      return errorResponse("Invalid post ID");
    }

    // The photos, validated before anything is read or written. Each URL must
    // parse to *our* public bucket and the key it names must sit under the
    // caller's own folder (the same `keyBelongsToUser` rule every route that
    // acts on a client-supplied key follows). Without it a client could pin
    // somebody else's object to a comment and then delete the comment to take
    // the object down — the delete path below reclaims exactly these URLs.
    const storedPhotos: Array<CommentPhoto & { order: number }> = [];
    if (media !== undefined && media !== null && !Array.isArray(media)) {
      return errorResponse("Photos must be a list", 400);
    }
    if (Array.isArray(media) && media.length > MAX_COMMENT_PHOTOS) {
      return errorResponse(`At most ${MAX_COMMENT_PHOTOS} photos can be attached to a comment`, 400);
    }
    for (const [position, item] of (Array.isArray(media) ? media : []).entries()) {
      if (!item || typeof item !== "object") {
        return errorResponse("Each photo must be an object with a URL", 400);
      }
      const { url, type, altText } = item as { url?: unknown; type?: unknown; altText?: unknown };
      if (typeof url !== "string" || url.length === 0) {
        return errorResponse("Each photo needs a URL", 400);
      }
      const key = keyFromPublicUrl(url);
      if (!key || !keyBelongsToUser(key, session.user.id)) {
        return errorResponse("Photos must be files you uploaded", 400);
      }
      if (type !== undefined && typeof type !== "string") {
        return errorResponse("Each photo's type must be text", 400);
      }
      if (altText !== undefined && altText !== null && typeof altText !== "string") {
        return errorResponse("Each photo's alt text must be text or null", 400);
      }
      if (typeof altText === "string" && altText.length > 255) {
        return errorResponse("Alt text is limited to 255 characters", 400);
      }
      storedPhotos.push({
        url,
        type: typeof type === "string" && type.length > 0 ? type : "image/jpeg",
        altText: typeof altText === "string" && altText.length > 0 ? altText : null,
        order: position,
      });
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

    // The photos, after the comment they belong to. Two writes rather than one
    // transaction, mirroring how a post and its media are created: a failure
    // between them leaves a photo-less comment, which is a comment — never a
    // photo row whose comment is missing (the foreign key rules that out).
    if (storedPhotos.length > 0) {
      await db.insert(commentMedia).values(
        storedPhotos.map((photo) => ({
          ...photo,
          commentId: newComment.id,
        })),
      );
    }

    return successResponse(
      { comment: { ...newComment, media: storedPhotos.map(({ url, altText, type }) => ({ url, altText, type })) } },
      201,
    );
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

    // Take the comment's photos out of storage as well — the same reclaim a
    // deleted post does. Nothing restores a soft-deleted comment, so a photo
    // left behind is paid-for storage still answering at its public URL. The
    // URLs are read *after* the update because the soft delete leaves the rows
    // in place, and `comment_media.url` is the only record of what belonged to
    // this comment. `deleteStoredObjects` swallows storage failures, so the
    // author still sees a successful delete either way.
    const photoUrls = await db
      .select({ url: commentMedia.url })
      .from(commentMedia)
      .where(eq(commentMedia.commentId, deleted.id));
    const removed = await deleteStoredObjects(photoUrls.map((row) => row.url));
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} stored object(s) for comment ${deleted.id}`);
    }

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete comment error:", err);
    return errorResponse("Failed to delete comment", 500);
  }
}
