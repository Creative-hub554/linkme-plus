import { db, withDbRetry } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { posts, postMedia, comments, reactions, users, profiles, pages, pageRoles, groups, groupMembers } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse, cursorPaginatedResponse } from "@/lib/api-helpers";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { authoredByMember } from "@/lib/db/author-timeline";
import { toPostAudience } from "@/lib/post-audiences";
import { deleteStoredObjects } from "@/lib/r2";
import { clampLimit, decodeCursor, encodeCursor, isUuid, type CursorPosition } from "@/lib/cursor-pagination";
import { eq, desc, and, sql, inArray } from "drizzle-orm";

/** Ceiling on `?ids=` lookups, so a crafted request cannot ask for the world. */
const MAX_LOOKUP_IDS = 25;

/** One entry of the `media` array a client posts alongside a new post. */
interface PostMediaInput {
  url: string;
  altText?: string | null;
  type: string;
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const authorId = url.searchParams.get("authorId");
  // The author filter is bound into a `uuid` column, so a value that is not one
  // is a bad request rather than a 500 from the cast.
  if (authorId && !isUuid(authorId)) {
    return errorResponse("Invalid author id", 400);
  }

  // A Page's own feed. Filtered by id rather than username so renaming a Page
  // cannot silently empty it, and validated so a malformed id is a 400 rather
  // than a cast into the uuid column.
  const pageId = url.searchParams.get("pageId");
  if (pageId && !isUuid(pageId)) {
    return errorResponse("Invalid page id", 400);
  }

  // A group's own feed. The membership check is not repeated here: the audience
  // rule below already admits a `group` post to its members and to nobody else,
  // so a non-member asking for a group's posts is answered with none of them.
  const groupId = url.searchParams.get("groupId");
  if (groupId && !isUuid(groupId)) {
    return errorResponse("Invalid group id", 400);
  }

  // Realtime announces a row id; the feed hydrates exactly those posts (with
  // their author and media) rather than refetching a whole page.
  const idsParam = url.searchParams.get("ids");
  const requestedIds = idsParam
    ? [...new Set(idsParam.split(",").map((value) => value.trim()).filter(Boolean))]
    : [];
  if (requestedIds.length > MAX_LOOKUP_IDS) {
    return errorResponse(`At most ${MAX_LOOKUP_IDS} ids can be looked up at once`, 400);
  }
  if (requestedIds.some((id) => !isUuid(id))) {
    return errorResponse("Invalid ids", 400);
  }

  // Offset paging used to be supported here. Reject it loudly rather than
  // silently serving the first page, which would look like an empty feed.
  const legacyPage = url.searchParams.get("page");
  if (legacyPage && legacyPage !== "1") {
    return errorResponse(
      "Offset pagination is no longer supported. Follow pagination.nextCursor instead.",
      400
    );
  }

  const rawCursor = url.searchParams.get("cursor");
  const cursor: CursorPosition | null = decodeCursor(rawCursor);
  if (rawCursor && !cursor) {
    return errorResponse("Invalid cursor", 400);
  }

  try {
    const loadFeed = async () => {
      // Deleted posts are gone, and an audience the reader is not part of must
      // never be returned — including on a targeted `?ids=` lookup, which is
      // how realtime hydrates a post it was only told the id of.
      const conditions = [
        sql`${posts.deletedAt} IS NULL`,
        visiblePostsCondition(session.user.id),
      ];
      // A member's timeline is what *they* said: posts they published as a Page
      // are the Page's voice and are listed on the Page instead. See
      // `@/lib/db/author-timeline`, which also covers the feed's post-follow
      // reveal — the notice there names the member, so a Page post would have
      // been announced under the wrong name.
      if (authorId) conditions.push(...authoredByMember(authorId));
      if (pageId) conditions.push(eq(posts.pageId, pageId));
      if (groupId) conditions.push(eq(posts.groupId, groupId));
      if (requestedIds.length > 0) conditions.push(inArray(posts.id, requestedIds));
      if (cursor) {
        // Keyset position: strictly older, or the same instant with a smaller
        // id. Comparing the pair keeps posts sharing a timestamp from being
        // skipped or repeated at a page boundary. The key is Postgres' own
        // timestamp text cast back to `timestamp`, so it is compared in the
        // same wall-clock space the column stores.
        conditions.push(
          sql`(${posts.createdAt} < ${cursor.key}::timestamp OR (${posts.createdAt} = ${cursor.key}::timestamp AND ${posts.id} < ${cursor.id}))`
        );
      }

      // One extra row tells us whether another page exists without a COUNT.
      const rows = await db
        .select({
          id: posts.id,
          content: posts.content,
          type: posts.type,
          visibility: posts.visibility,
          createdAt: posts.createdAt,
          // Only ever read as "has this post been edited" — the feed marks it
          // beside the time — so the column's wall-clock zone never shows.
          editedAt: posts.editedAt,
          // Ordering key for the next cursor. Taken from the database so it is
          // byte-identical to what the comparison above casts back.
          createdAtKey: sql<string>`to_char(${posts.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
          // Per-post engagement. The feed shows these, and the live counters
          // patch them, so a card never has to open a thread to know its size.
          // The outer reference is spelled out rather than interpolated on
          // purpose: drizzle drops the table qualifier when a query has a single
          // table, and a bare `"id"` inside these subqueries would resolve to the
          // subquery's own id column — counting nothing. See the same note in
          // `posts/counts/route.ts`.
          commentCount: sql<number>`(
            select count(*)::int from ${comments} as c
            where c.post_id = "posts"."id" and c.deleted_at is null
          )`,
          reactionCount: sql<number>`(
            select count(*)::int from ${reactions} as r
            where r.target_type = 'post' and r.target_id = "posts"."id"
          )`,
          author: {
            id: users.id,
            // A missing profile row must never hide a published post. Fall back
            // to the account username until the profile is provisioned.
            name: sql<string | null>`coalesce(${profiles.displayName}, ${users.username})`,
            username: users.username,
            avatarUrl: profiles.avatarUrl,
          },
          // Present only when a Page published the post; every column is null
          // otherwise. `author` above still resolves to the admin who pressed
          // publish, which is what owns the row and what the edit/delete checks
          // compare against — but the Page is the identity a reader should be
          // shown, and this is how a caller can tell the two apart.
          page: {
            id: pages.id,
            username: pages.username,
            name: pages.name,
            avatarUrl: pages.avatarUrl,
          },
          // Present only when the post was published into a group, and null on
          // every other post. A group post reaching somebody's feed through the
          // `group` audience is the only clue that it was not addressed to them
          // personally, so the card is told which group it belongs to.
          group: {
            id: groups.id,
            name: groups.name,
          },
        })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .leftJoin(profiles, eq(users.id, profiles.userId))
        .leftJoin(pages, eq(posts.pageId, pages.id))
        .leftJoin(groups, eq(posts.groupId, groups.id))
        .where(and(...conditions))
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const result = hasMore ? rows.slice(0, limit) : rows;

      const media = result.length > 0
        ? await db
            .select()
            .from(postMedia)
            .where(inArray(postMedia.postId, result.map((post) => post.id)))
        : [];
      const mediaByPostId = new Map<string, typeof media>();

      for (const item of media) {
        const postMediaItems = mediaByPostId.get(item.postId) || [];
        postMediaItems.push(item);
        mediaByPostId.set(item.postId, postMediaItems);
      }

      const postsWithMedia = result.map(({ createdAtKey: _key, ...post }) => ({
        ...post,
        media: mediaByPostId.get(post.id) || [],
      }));

      const last = result[result.length - 1];
      // A targeted id lookup is not a page, so it has no successor to follow.
      const nextCursor =
        requestedIds.length === 0 && hasMore && last
          ? encodeCursor(last.createdAtKey, last.id)
          : null;

      return { postsWithMedia, nextCursor };
    };

    const { postsWithMedia, nextCursor } = await loadFeed();

    return cursorPaginatedResponse(postsWithMedia, limit, nextCursor);
  } catch (err) {
    console.error("Get posts error:", err);
    return errorResponse("Failed to fetch posts", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { content, type = "text", visibility = "public", hashtags, mentions, media, pageId, groupId } = body;

    if (!content && (!media || media.length === 0)) {
      return errorResponse("Content or media is required");
    }

    // Publishing *as* a Page. The row still records `author_id` as the person
    // who pressed publish, so ownership, edits and deletes keep working; the
    // Page is recorded beside it and is what the post is shown as. Only a Page
    // admin may do it, checked here rather than trusted from the body.
    let pageForPost: string | null = null;
    if (pageId !== undefined && pageId !== null) {
      if (typeof pageId !== "string" || !isUuid(pageId)) {
        return errorResponse("Invalid page id", 400);
      }
      const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, pageId));
      if (!page) return errorResponse("Page not found", 404);

      const [admin] = await db
        .select({ id: pageRoles.id })
        .from(pageRoles)
        .where(
          and(
            eq(pageRoles.pageId, pageId),
            eq(pageRoles.userId, session.user.id),
            eq(pageRoles.role, "admin"),
          ),
        );
      if (!admin) return errorResponse("Only a Page admin can post as it", 403);
      pageForPost = pageId;
    }

    // Publishing *into* a group. Any member may, which is a lower bar than a
    // Page's admin — a group is where members talk to each other — and it is
    // checked here rather than trusted from the body, exactly as the Page's role
    // is. The audience is not taken from the body either: a group post is one
    // its group can read, and a request that says otherwise is refused below
    // rather than quietly honoured.
    let groupForPost: string | null = null;
    if (groupId !== undefined && groupId !== null) {
      if (typeof groupId !== "string" || !isUuid(groupId)) {
        return errorResponse("Invalid group id", 400);
      }
      if (pageForPost) {
        // One post, one subject: the row records a Page or a group, and a body
        // carrying both would make which one is shown depend on reader order.
        return errorResponse("A post is published as a Page or in a group, not both", 400);
      }
      const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
      if (!group) return errorResponse("Group not found", 404);

      const [member] = await db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, session.user.id)),
        );
      if (!member) return errorResponse("Only a member of this group can post in it", 403);
      groupForPost = groupId;
    }

    // A value the audience list does not know reads as public rather than being
    // handed to the enum column, which would fail the insert outright.
    const selectedVisibility = toPostAudience(visibility);

    // `group` is a real audience, so the validator above lets it through — but it
    // only means anything on a post that has a group. Without one the rule admits
    // nobody, so honouring the request would store a post its author cannot share
    // and nobody can find. Refused at the door instead.
    if (selectedVisibility === "group" && !groupForPost) {
      return errorResponse("A post is only visible to group members inside a group", 400);
    }

    // Repair a missing profile before publishing so the author's name and
    // avatar resolve everywhere the post is shown. Best effort: a provisioning
    // failure must not block the post itself.
    try {
      await ensureLocalUserProfile(session.user);
    } catch (profileError) {
      console.warn("Profile provisioning failed before post insert:", profileError);
    }

    // Create post
    const [newPost] = await withDbRetry(() =>
      db
        .insert(posts)
        .values({
          authorId: session.user.id,
          pageId: pageForPost,
          groupId: groupForPost,
          content,
          type,
          visibility: groupForPost ? "group" : selectedVisibility,
          hashtags: hashtags || [],
          mentions: mentions || [],
        })
        .returning()
    );

    // Add media if provided
    if (media && media.length > 0) {
      await withDbRetry(() =>
        db.insert(postMedia).values(
          media.map((m: PostMediaInput, index: number) => ({
            postId: newPost.id,
            url: m.url,
            altText: m.altText,
            type: m.type,
            order: index,
          }))
        )
      );
    }

    return successResponse({ post: newPost }, 201);
  } catch (err) {
    console.error("Create post error:", err);
    return errorResponse("Failed to create post", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { id, content, visibility, hashtags } = body;

    if (!id) {
      return errorResponse("Post ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid post id", 400);
    }

    // Check ownership
    const [existing] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, session.user.id)));

    if (!existing) {
      return errorResponse("Post not found or unauthorized", 404);
    }

    // A group post's audience is the group. Whatever the edit sends, the row
    // keeps it: only the author can reach this line at all, but "my own post" is
    // not the same as "mine to show the world" when somebody else's group is the
    // room it was written in.
    const requestedVisibility = visibility ?? existing.visibility;
    const nextVisibility = existing.groupId ? "group" : requestedVisibility;

    const [updated] = await db
      .update(posts)
      .set({
        content: content ?? existing.content,
        visibility: nextVisibility,
        hashtags: hashtags ?? existing.hashtags,
        editedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    return successResponse({ post: updated });
  } catch (err) {
    console.error("Update post error:", err);
    return errorResponse("Failed to update post", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return errorResponse("Post ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid post id", 400);
    }

    // Soft delete
    const [deleted] = await db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.authorId, session.user.id)))
      .returning({ id: posts.id });

    if (!deleted) {
      return errorResponse("Post not found or unauthorized", 404);
    }

    // Take the post's files out of the bucket as well. Nothing restores a
    // deleted post, so media kept here would only ever be paid-for storage that
    // still answers at its public URL. The rows are read after the update
    // because a soft delete leaves them in place, and `post_media.url` is the
    // only record of which objects belong to this post — a hard delete would
    // need them read first. `deleteStoredObjects` filters to our own public URL
    // and swallows failures, so the author still sees a successful delete.
    const mediaUrls = await db
      .select({ url: postMedia.url })
      .from(postMedia)
      .where(eq(postMedia.postId, deleted.id));
    const removed = await deleteStoredObjects(mediaUrls.map((row) => row.url));
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} stored object(s) for post ${deleted.id}`);
    }

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete post error:", err);
    return errorResponse("Failed to delete post", 500);
  }
}
