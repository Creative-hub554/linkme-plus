import { db, withDbRetry } from "@/lib/db";
import { pages, pageRoles } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import {
  assertStorageConfigured,
  deleteStoredObjects,
  generateKey,
  getFolderForPurpose,
  getPublicUrl,
  putObject,
  replacedObjectUrl,
  validateFile,
} from "@/lib/r2";

/**
 * A Page's photo or its cover.
 *
 * One route for both rather than the two the member profile has, because
 * nothing about them actually differs except a column and a folder — and the
 * part that must not be written twice is the authorization, which is the same
 * question for either. `kind` is validated against this map, so the two names
 * are declared once and a third would be a compile error where it is read.
 */
const TARGETS = {
  avatar: { purpose: "avatar", label: "A Page photo" },
  cover: { purpose: "cover", label: "A cover photo" },
} as const;

type PageImageKind = keyof typeof TARGETS;

function isPageImageKind(value: unknown): value is PageImageKind {
  return typeof value === "string" && value in TARGETS;
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const pageId = formData.get("pageId");
    const kind = formData.get("kind");

    if (typeof pageId !== "string" || !isUuid(pageId)) {
      return errorResponse("Invalid page id", 400);
    }
    if (!isPageImageKind(kind)) {
      return errorResponse('An image kind of "avatar" or "cover" is required', 400);
    }
    if (!(file instanceof File)) {
      return errorResponse("An image file is required");
    }

    const target = TARGETS[kind];
    if (!file.type.startsWith("image/")) {
      return errorResponse(`${target.label} must be a JPG, PNG, GIF or WebP image`);
    }
    const validation = validateFile({ type: file.type, size: file.size }, target.purpose);
    if (!validation.valid) {
      return errorResponse(validation.error ?? "That image cannot be used");
    }

    // The role is checked *before* the object is written, not after: an upload
    // that is rejected must not leave a file in the bucket, and the check is the
    // same one `PUT /api/pages` makes, from the same table.
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
    if (!admin) return errorResponse("Only a Page admin can change it", 403);

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(
        storageError instanceof Error ? storageError.message : "Image storage is not configured",
        503,
      );
    }

    // Keyed by the *Page*, not by the admin who happened to upload it: the photo
    // belongs to the Page and outlives its admins, and a Page with several
    // admins would otherwise scatter the same photo across their folders.
    const key = generateKey(getFolderForPurpose(target.purpose), pageId, file.name);
    await putObject(key, file, file.type);
    const url = getPublicUrl(key);

    // The URL this upload is about to displace is read *before* the row is
    // written, and only the column for this `kind`: `.returning()` hands back
    // the value just written, so once the update lands the previous one is no
    // longer recorded anywhere and the object behind it could never be found
    // again.
    const [current] = await db
      .select({ url: kind === "avatar" ? pages.avatarUrl : pages.coverUrl })
      .from(pages)
      .where(eq(pages.id, pageId));

    const [updated] = await withDbRetry(() =>
      db
        .update(pages)
        .set(kind === "avatar" ? { avatarUrl: url } : { coverUrl: url })
        .where(eq(pages.id, pageId))
        .returning({ id: pages.id }),
    );
    // The Page could have been deleted between the role check and the write, in
    // which case the object has nowhere to be pointed at from.
    if (!updated) return errorResponse("Page not found", 404);

    // The image this one replaced is now unreferenced, so it comes out of the
    // bucket rather than staying as storage nobody points at but everyone can
    // still fetch. Same shape as a deleted post's media: `deleteStoredObjects`
    // skips a URL that is not ours (a seeded Page can hold one on another host)
    // and swallows per-object failures, so a storage hiccup cannot fail an
    // upload the row already records.
    const removed = await deleteStoredObjects([replacedObjectUrl(current?.url, url)]);
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} replaced object(s) for page ${pageId}`);
    }

    return successResponse({ kind, url });
  } catch (err) {
    console.error("Upload page image error:", err);
    return errorResponse("Failed to upload that image", 500);
  }
}
