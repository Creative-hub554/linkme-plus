import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { eq } from "drizzle-orm";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";

/**
 * Takes down the published Cover Studio video.
 *
 * Clearing `coverVideoUrl` is what stops the banner playing it, and
 * `shortVideoCoverConfig` goes with it so a template and picture list cannot
 * outlive the clip it describes. A photo cover — `coverUrl` — is deliberately
 * left alone: the banner falls back to that photo rather than to the brand
 * gradient, which is what a member who uploaded both would expect.
 *
 * The stored file and its `short_video_covers` row are history and are kept:
 * the row is the record of what was published, and deleting the object would
 * leave that record pointing at nothing.
 */
export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    await ensureLocalUserProfile(session.user);
    const [updated] = await db
      .update(profiles)
      .set({ coverVideoUrl: null, shortVideoCoverConfig: null })
      .where(eq(profiles.userId, session.user.id))
      .returning({ id: profiles.id });

    if (!updated) {
      return errorResponse("Profile not found", 404);
    }

    return successResponse({ coverVideoUrl: null });
  } catch (err) {
    console.error("Remove cover video error:", err);
    return errorResponse("Unable to remove the cover video", 500);
  }
}
