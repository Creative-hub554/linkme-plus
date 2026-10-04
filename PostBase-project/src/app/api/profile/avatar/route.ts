import { db, withDbRetry } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { createClient } from "@/utils/supabase/server";
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Profile database persistence timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return errorResponse("A profile photo is required");
    }

    const validation = validateFile({ type: file.type, size: file.size }, "avatar");
    if (!validation.valid || !file.type.startsWith("image/")) {
      return errorResponse(validation.error || "Profile photos must be JPG, PNG, GIF, or WebP images");
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured", 503);
    }

    // Upload first. Profile persistence can be retried independently, so a
    // temporary database outage must not prevent the user from receiving a
    // successful R2 upload.
    const key = generateKey(getFolderForPurpose("avatar"), session.user.id, file.name);
    await putObject(key, file, file.type);
    const avatarUrl = getPublicUrl(key);

    // The photo this upload is about to displace is read *before* the write. It
    // is only offered up for deletion once the write has actually landed: the
    // deferred path below leaves the old URL as the one the profile points at,
    // so its object is still in use and must stay.
    let displaced: string | null = null;

    try {
      await withTimeout((async () => {
        await withDbRetry(() => ensureLocalUserProfile(session.user));
        const [current] = await db
          .select({ avatarUrl: profiles.avatarUrl })
          .from(profiles)
          .where(eq(profiles.userId, session.user.id));
        await withDbRetry(() => db
          .update(profiles)
          .set({ avatarUrl })
          .where(eq(profiles.userId, session.user.id)));
        displaced = replacedObjectUrl(current?.avatarUrl, avatarUrl);
      })(), 5000);
    } catch (databaseError) {
      // Keep the uploaded photo usable even while the local Postgres pooler is
      // unreachable. Supabase Auth metadata is available to the client and is
      // synchronized back to the profile on a later successful request.
      console.error("Profile avatar database persistence deferred:", databaseError);
      const supabase = await createClient();
      const { error: metadataError } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl, picture: avatarUrl },
      });
      if (metadataError) {
        throw new Error("Photo uploaded, but it could not be attached to your profile. Please retry shortly.");
      }
    }

    // The replaced photo is unreferenced now, so it comes out of the bucket.
    // `deleteStoredObjects` refuses anything that is not ours and swallows
    // per-object failures, so a storage hiccup cannot fail an upload the row
    // already records. Reached only when the row was written — `displaced` stays
    // null on the deferred path, whose old URL is still in use.
    if (displaced) {
      const removed = await deleteStoredObjects([displaced]);
      if (removed.length > 0) {
        console.log(`Deleted ${removed.length} replaced profile photo(s) for ${session.user.id}`);
      }
    }

    return successResponse({ avatarUrl });
  } catch (uploadError) {
    console.error("Upload profile avatar error:", uploadError);
    return errorResponse(uploadError instanceof Error ? uploadError.message : "Failed to upload profile photo", 500);
  }
}
