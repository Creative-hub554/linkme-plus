import { db } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import {
  assertStorageConfigured,
  deleteStoredObjects,
  generateKey,
  putObject,
  getPublicUrl,
  getFolderForPurpose,
  replacedObjectUrl,
  validateFile,
} from "@/lib/r2";
import { coverConfigPhotoUrls } from "@/lib/cover-config";

/**
 * POST /api/profile/cover
 * Accepts a multipart form with a single `file` image, stores it in R2
 * under the "cover" purpose, persists the public URL on the profile and
 * returns it.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return errorResponse("A cover image file is required");
    }

    if (!file.type.startsWith("image/")) {
      return errorResponse("Cover must be an image (JPG, PNG, GIF or WebP)");
    }

    const validation = validateFile({ type: file.type, size: file.size }, "cover");
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(storageError instanceof Error ? storageError.message : "Photo storage is not configured", 503);
    }

    const key = generateKey(getFolderForPurpose("cover"), session.user.id, file.name);
    await putObject(key, file, file.type);
    const coverUrl = getPublicUrl(key);

    await ensureLocalUserProfile(session.user);
    // Read the cover this upload replaces before writing it: after the update
    // the previous URL is recorded nowhere and its object could never be found.
    const [current] = await db
      .select({ coverUrl: profiles.coverUrl })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id));
    await db
      .update(profiles)
      .set({ coverUrl })
      .where(eq(profiles.userId, session.user.id));

    const removed = await deleteStoredObjects([
      replacedObjectUrl(current?.coverUrl, coverUrl),
    ]);
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} replaced cover object(s) for ${session.user.id}`);
    }

    return successResponse({ coverUrl });
  } catch (err) {
    console.error("Upload cover error:", err);
    return errorResponse("Failed to upload cover", 500);
  }
}

/**
 * Removes the whole cover: the photo, a published Cover Studio video, and the
 * animated-cover config together.
 *
 * All three go because they are three ways of filling the same slot, and the
 * editor's one "Remove cover" button means all of it. Removing only the video
 * has its own endpoint, `/api/profile/cover-video`.
 *
 * This lives here rather than on the general profile update because that route
 * falls back to auth metadata when the database is unavailable, and a removal
 * that reports success without persisting is worse than one that fails.
 */
export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    await ensureLocalUserProfile(session.user);
    // The photo and the animated config's photos are read before the columns are
    // cleared: afterwards nothing records which objects they were.
    const [current] = await db
      .select({ coverUrl: profiles.coverUrl, coverConfig: profiles.coverConfig })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id));
    const [updated] = await db
      .update(profiles)
      .set({ coverUrl: null, coverVideoUrl: null, coverConfig: null, shortVideoCoverConfig: null })
      .where(eq(profiles.userId, session.user.id))
      .returning({ id: profiles.id });

    if (!updated) {
      return errorResponse("Profile not found", 404);
    }

    // The still cover and every photo the animated config held are unreferenced
    // now. The published video's *object* is deliberately kept: it has its own
    // removal route, and that route keeps the clip as the record of what was
    // published — deleting it here would make "Remove cover" destroy history
    // that "Remove video" preserves.
    const removed = await deleteStoredObjects([
      replacedObjectUrl(current?.coverUrl, null),
      ...coverConfigPhotoUrls(current?.coverConfig),
    ]);
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} cover object(s) for ${session.user.id}`);
    }

    return successResponse({ coverUrl: null, coverVideoUrl: null });
  } catch (err) {
    console.error("Remove cover error:", err);
    return errorResponse("Unable to remove the cover", 500);
  }
}
