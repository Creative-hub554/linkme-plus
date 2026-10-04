import { db } from "@/lib/db";
import { pages, pageRoles, pageFollows, postMedia, posts, users, categories } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { deleteStoredObjects, replacedObjectUrl } from "@/lib/r2";
import { and, count, desc, eq, exists, or, sql } from "drizzle-orm";

/**
 * A Page: a public account that is not a person.
 *
 * The shape this route had before was dormant and wrong in one specific way —
 * it counted followers with `follows.following_id = page.id`, but that column
 * references `users.id`, so the number could only ever be zero. Following a Page
 * is a row in `page_follows` now (see `0010_pages_public.sql`), and the roles
 * that decide who may edit the Page are `page_roles`, which the create path
 * already wrote and nothing read.
 *
 * "Public" here means *not a person*, not *not signed in*: the page view sits
 * behind the same gate as the rest of the app, and every request still requires
 * a session. What a reader sees is a Page with its followers, its category and
 * its posts rather than a member profile.
 *
 * The directory is scoped to the viewer: the Pages they run and the Pages they
 * follow, and no others. A Page is discoverable through search and through the
 * people who link to it; what is listed here is the set the viewer already has
 * a relationship with. The single-Page branch is deliberately not scoped — the
 * gated view needs to describe a Page it is about to refuse, which it cannot do
 * from a 404.
 */

/** 30 characters of `[a-z0-9_]`, the same rule member usernames follow. */
const PAGE_USERNAME = /^[a-z0-9_]{3,30}$/;

function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** A Page's stats, the viewer's relationship to it, and the viewer's role. */
async function describePage(pageId: string, viewerId: string) {
  const [[{ followers }], [{ postCount }], [follow], [role]] = await Promise.all([
    db.select({ followers: count() }).from(pageFollows).where(eq(pageFollows.pageId, pageId)),
    db
      .select({ postCount: count() })
      .from(posts)
      .where(and(eq(posts.pageId, pageId), sql`${posts.deletedAt} IS NULL`)),
    db
      .select({ id: pageFollows.id })
      .from(pageFollows)
      .where(and(eq(pageFollows.pageId, pageId), eq(pageFollows.userId, viewerId))),
    db
      .select({ role: pageRoles.role })
      .from(pageRoles)
      .where(and(eq(pageRoles.pageId, pageId), eq(pageRoles.userId, viewerId))),
  ]);

  return {
    stats: { followers, posts: postCount },
    isFollowing: Boolean(follow),
    // Returned rather than inferred from the viewer's id: a Page can be run by
    // somebody who did not create it, and only the role table knows that.
    role: role?.role ?? null,
  };
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const username = url.searchParams.get("username");

  // Bound into a `uuid` column below, so a value that is not one is a 400 rather
  // than a cast failure the catch reports as a 500.
  if (id && !isUuid(id)) return errorResponse("Invalid page id", 400);

  try {
    if (id || username) {
      const [page] = await db
        .select({
          id: pages.id,
          username: pages.username,
          name: pages.name,
          description: pages.description,
          avatarUrl: pages.avatarUrl,
          coverUrl: pages.coverUrl,
          contactDetails: pages.contactDetails,
          createdAt: pages.createdAt,
          categoryId: pages.categoryId,
          category: categories.name,
        })
        .from(pages)
        .leftJoin(categories, eq(pages.categoryId, categories.id))
        .where(id ? eq(pages.id, id) : eq(pages.username, username as string));

      if (!page) return errorResponse("Page not found", 404);

      const described = await describePage(page.id, session.user.id);
      return successResponse({ page, ...described });
    }

    // Whose Pages are listed. A Page is not a public directory entry: it is
    // listed to the people who run it and the people who chose to follow it, and
    // anyone else meets it through a link and a gate rather than a browse. The
    // filter is on the viewer's own rows in `page_roles` and `page_follows`,
    // which is the same pair of edges the gate on the Page itself reads — so the
    // directory can never offer a Page that then refuses to open.
    const myPages = or(
      exists(
        db
          .select({ id: pageRoles.id })
          .from(pageRoles)
          .where(and(eq(pageRoles.pageId, pages.id), eq(pageRoles.userId, session.user.id))),
      ),
      exists(
        db
          .select({ id: pageFollows.id })
          .from(pageFollows)
          .where(and(eq(pageFollows.pageId, pages.id), eq(pageFollows.userId, session.user.id))),
      ),
    );

    // Counted in a subquery rather than a join so a Page with no followers still
    // appears (an inner join would drop it), and the outer id is spelled with its
    // table qualifier because drizzle drops the qualifier in a single-table query
    // — a bare `"id"` in the subquery would resolve to the subquery's own column
    // and count nothing.
    const list = await db
      .select({
        id: pages.id,
        username: pages.username,
        name: pages.name,
        description: pages.description,
        avatarUrl: pages.avatarUrl,
        coverUrl: pages.coverUrl,
        createdAt: pages.createdAt,
        category: categories.name,
        followers: sql<number>`(
          select count(*)::int from "page_follows" as pf where pf."page_id" = "pages"."id"
        )`,
      })
      .from(pages)
      .leftJoin(categories, eq(pages.categoryId, categories.id))
      .where(myPages)
      .orderBy(desc(pages.createdAt))
      .limit(50);

    return successResponse({ pages: list });
  } catch (err) {
    console.error("Get pages error:", err);
    return errorResponse("Failed to fetch pages", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const name = String(body?.name ?? "").trim();
    const username = normalizeUsername(body?.username);
    const description = body?.description === undefined || body?.description === null
      ? null
      : String(body.description).trim();
    const categoryId = typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;

    if (!name) return errorResponse("A Page name is required");
    if (name.length > 100) return errorResponse("A Page name must be 100 characters or fewer");
    if (!PAGE_USERNAME.test(username)) {
      return errorResponse(
        "A Page username must be 3–30 characters using only letters, numbers, or underscores",
      );
    }
    if (description && description.length > 500) {
      return errorResponse("A Page description must be 500 characters or fewer");
    }
    if (categoryId && !isUuid(categoryId)) return errorResponse("Invalid category id", 400);

    // The username has to be free in *both* namespaces. A Page lives at
    // `/pages/<username>` and a member is looked up by their own username, but
    // search results and mentions mix the two, so a Page that shadowed a member
    // would make `@name` ambiguous.
    const [takenPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.username, username));
    if (takenPage) return errorResponse("That Page username is already taken", 409);

    const [takenUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username));
    if (takenUser) return errorResponse("That username belongs to a member", 409);

    const [created] = await db
      .insert(pages)
      .values({ name, username, description, categoryId })
      .returning();

    // The creator is the Page's first admin. Without this row nobody — not even
    // the person who made it — could ever edit or post as the Page, which is
    // how the previous version of this route left every Page it created.
    await db.insert(pageRoles).values({ pageId: created.id, userId: session.user.id, role: "admin" });

    const described = await describePage(created.id, session.user.id);
    return successResponse({ page: created, ...described }, 201);
  } catch (err) {
    console.error("Create page error:", err);
    return errorResponse("Failed to create page", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return errorResponse("Page ID is required");
    if (!isUuid(id)) return errorResponse("Invalid page id", 400);

    const [role] = await db
      .select({ id: pageRoles.id })
      .from(pageRoles)
      .where(
        and(eq(pageRoles.pageId, id), eq(pageRoles.userId, session.user.id), eq(pageRoles.role, "admin")),
      );
    if (!role) return errorResponse("Only a Page admin can edit it", 403);

    /**
     * One field of an update: absent (`undefined`) leaves it alone, `null`
     * clears it, a string sets it. Anything else is a bad request rather than a
     * value cast into the column, which would either fail the query or store
     * nonsense — and a number or an object is plainly the caller's mistake.
     */
    const readText = (value: unknown): { ok: true; text: string | null | undefined } | { ok: false } =>
      value === undefined || value === null || typeof value === "string"
        ? { ok: true, text: value }
        : { ok: false };

    const nameField = readText(body?.name);
    if (!nameField.ok) return errorResponse("A Page name must be text");
    const name = nameField.text === undefined || nameField.text === null ? nameField.text : nameField.text.trim();
    if (name !== undefined && (!name || name.length > 100)) {
      return errorResponse("A Page name is required and must be 100 characters or fewer");
    }

    // The same limits the create path applies, checked here too: this route is
    // what the Page's own edit form writes through, so a field looser than
    // creation is how a Page ends up in a state it could never be created in.
    const descriptionField = readText(body?.description);
    if (!descriptionField.ok) return errorResponse("A Page description must be text");
    const description =
      descriptionField.text === undefined || descriptionField.text === null
        ? descriptionField.text
        : descriptionField.text.trim();
    if (description && description.length > 500) {
      return errorResponse("A Page description must be 500 characters or fewer");
    }

    const categoryField = readText(body?.categoryId);
    if (!categoryField.ok) return errorResponse("Invalid category id", 400);
    const categoryId = categoryField.text;
    if (categoryId !== undefined && categoryId !== null && !isUuid(categoryId)) {
      // Otherwise the cast into the uuid column fails and the caller gets a 500
      // for what is plainly a bad request.
      return errorResponse("Invalid category id", 400);
    }

    const avatarField = readText(body?.avatarUrl);
    const coverField = readText(body?.coverUrl);
    if (!avatarField.ok || !coverField.ok) {
      return errorResponse("An image url must be a string or null", 400);
    }

    // What the two image columns hold now, read before the write for the same
    // reason the upload route reads them: `.returning()` answers with the row as
    // it now is, so an image this request replaces would otherwise be recorded
    // nowhere and its object could never be found again.
    const [configured] = await db
      .select({ avatarUrl: pages.avatarUrl, coverUrl: pages.coverUrl })
      .from(pages)
      .where(eq(pages.id, id));

    const [updated] = await db
      .update(pages)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(avatarField.text !== undefined ? { avatarUrl: avatarField.text } : {}),
        ...(coverField.text !== undefined ? { coverUrl: coverField.text } : {}),
        ...(body?.contactDetails !== undefined ? { contactDetails: body.contactDetails ?? null } : {}),
      })
      .where(eq(pages.id, id))
      .returning();

    // An image this write replaced or cleared is unreferenced now, so it comes
    // out of the bucket rather than staying as storage nobody points at but
    // everyone can still fetch. A field the body did not mention displaces
    // nothing — its column keeps its value, so its object is still in use —
    // which is why both fields are offered rather than only the ones that
    // changed: `replacedObjectUrl` is what knows the difference. `null` writes
    // are real writes, so clearing a photo does remove it.
    const removed = await deleteStoredObjects([
      replacedObjectUrl(configured?.avatarUrl, avatarField.text),
      replacedObjectUrl(configured?.coverUrl, coverField.text),
    ]);
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} stored object(s) for page ${id}`);
    }

    return successResponse({ page: updated });
  } catch (err) {
    console.error("Update page error:", err);
    return errorResponse("Failed to update page", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("Page ID is required");
    if (!isUuid(id)) return errorResponse("Invalid page id", 400);

    const [role] = await db
      .select({ id: pageRoles.id })
      .from(pageRoles)
      .where(
        and(eq(pageRoles.pageId, id), eq(pageRoles.userId, session.user.id), eq(pageRoles.role, "admin")),
      );
    if (!role) return errorResponse("Only a Page admin can delete it", 403);

    // Everything this Page owns in storage is read *before* anything is
    // deleted: the posts are hard-deleted and `post_media` cascades with them,
    // so afterwards no record would be left that could map a URL back to a key,
    // and the Page's own two images live on the row that is about to go.
    const [owned] = await db
      .select({ avatarUrl: pages.avatarUrl, coverUrl: pages.coverUrl })
      .from(pages)
      .where(eq(pages.id, id));
    const mediaUrls = await db
      .select({ url: postMedia.url })
      .from(postMedia)
      .innerJoin(posts, eq(postMedia.postId, posts.id))
      .where(eq(posts.pageId, id));

    // `page_roles` and `page_follows` cascade with the Page, but `posts.page_id`
    // deliberately has no foreign key (neither does `posts.group_id`), so the
    // Page's posts are removed explicitly first. Leaving them would strand rows
    // pointing at a Page that no longer exists — invisible on the Page and
    // attributed to the admin who happened to publish them in the feed.
    await db.delete(posts).where(eq(posts.pageId, id));
    await db.delete(pages).where(eq(pages.id, id));

    // With the rows gone, the Page's photo, its cover and the media of its posts
    // are all unreferenced, so they come out of the bucket rather than staying as
    // storage nobody points at but everyone can still fetch. The URLs are handed
    // over as they were read; `deleteStoredObjects` refuses anything that is not
    // ours and swallows per-object failures, so a storage hiccup cannot fail a
    // deletion the rows already committed.
    const removed = await deleteStoredObjects([
      owned?.avatarUrl,
      owned?.coverUrl,
      ...mediaUrls.map((row) => row.url),
    ]);
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} stored object(s) for page ${id}`);
    }

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete page error:", err);
    return errorResponse("Failed to delete page", 500);
  }
}
