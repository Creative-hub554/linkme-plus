import { db } from "@/lib/db";
import { profiles, shortVideoCovers } from "@/lib/db/schema";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";
import {
  assertStorageConfigured,
  generateKey,
  getFolderForPurpose,
  getPublicUrl,
  putObject,
} from "@/lib/r2";

/**
 * The rendered cover clip, not its source material: a banner-sized WebM/MP4 is
 * a few megabytes, so anything far past that is a client bug or an abuse.
 */
const MAX_COVER_VIDEO_SIZE = 25 * 1024 * 1024;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const MAX_PHOTOS = 12;
const allowedSpeeds = new Set(["slow", "normal", "fast"]);
const allowedAspectRatios = new Set(["9:16", "2.7:1"]);

function validateTemplateId(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !/^[a-z0-9-]{1,30}$/.test(value)) {
    throw new Error("A valid template is required");
  }
  return value;
}

function validateSpeed(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !allowedSpeeds.has(value)) {
    throw new Error("Speed must be slow, normal, or fast");
  }
  return value;
}

function validateAspectRatio(value: FormDataEntryValue | null): string {
  const aspectRatio = typeof value === "string" ? value : "";
  if (!allowedAspectRatios.has(aspectRatio)) {
    throw new Error("Aspect ratio must be 9:16 or 2.7:1");
  }
  return aspectRatio;
}

function clampInt(value: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function extensionForType(type: string): string {
  if (type.includes("mp4")) return "mp4";
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const formData = await request.formData();

    // The rendered clip is the point of the request. Without it there is nothing
    // to publish, so the old flow — which accepted only the profile photo and
    // made up a video URL — no longer has a way in.
    const video = formData.get("video");
    if (!(video instanceof File) || !video.type.startsWith("video/")) {
      return errorResponse("A rendered cover video is required");
    }
    if (video.size === 0 || video.size > MAX_COVER_VIDEO_SIZE) {
      return errorResponse("The cover video must be under 25 MB");
    }

    const profilePhoto = formData.get("profilePhoto");
    if (!(profilePhoto instanceof File) || !profilePhoto.type.startsWith("image/")) {
      return errorResponse("A profile photo is required");
    }
    if (profilePhoto.size === 0 || profilePhoto.size > MAX_PHOTO_SIZE) {
      return errorResponse("Profile photo must be under 10 MB");
    }

    const backgroundVideo = formData.get("backgroundVideo");
    if (backgroundVideo instanceof File && backgroundVideo.size > 0 && !backgroundVideo.type.startsWith("video/")) {
      return errorResponse("Background video must be a valid video");
    }

    const photos = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);
    if (photos.length > MAX_PHOTOS) {
      return errorResponse(`You can use up to ${MAX_PHOTOS} pictures`);
    }
    if (photos.some((photo) => !photo.type.startsWith("image/") || photo.size > MAX_PHOTO_SIZE)) {
      return errorResponse("Pictures must be images under 10 MB");
    }

    const templateId = validateTemplateId(formData.get("templateId"));
    const speed = validateSpeed(formData.get("speed"));
    const aspectRatio = validateAspectRatio(formData.get("aspectRatio"));
    const duration = clampInt(formData.get("duration"), 8, 5, 15);
    const subtitle = (formData.get("subtitle") as string | null)?.slice(0, 120) ?? "";
    const productLabel = (formData.get("productLabel") as string | null)?.slice(0, 60) ?? "";
    const productUrl = (formData.get("productUrl") as string | null)?.slice(0, 2048) ?? "";
    const profileOffsetX = clampInt(formData.get("profileOffsetX"), 0, -2000, 2000);
    const profileOffsetY = clampInt(formData.get("profileOffsetY"), 0, -2000, 2000);
    const profileRadius = clampInt(formData.get("profileRadius"), 180, 24, 480);

    assertStorageConfigured();

    const folder = getFolderForPurpose("short-video-cover");

    const videoKey = generateKey(folder, session.user.id, `cover-video.${extensionForType(video.type)}`);
    await putObject(videoKey, video, video.type || "video/webm");
    const videoUrl = getPublicUrl(videoKey);

    const profileKey = generateKey(folder, session.user.id, `profile.${extensionForType(profilePhoto.type)}`);
    await putObject(profileKey, profilePhoto, profilePhoto.type || "image/jpeg");
    const profilePhotoUrl = getPublicUrl(profileKey);

    const photoUrls: string[] = [];
    for (const [index, photo] of photos.entries()) {
      const key = generateKey(folder, session.user.id, `picture-${index}.${extensionForType(photo.type)}`);
      await putObject(key, photo, photo.type || "image/jpeg");
      photoUrls.push(getPublicUrl(key));
    }

    let backgroundVideoUrl: string | null = null;
    if (backgroundVideo instanceof File && backgroundVideo.size > 0) {
      const key = generateKey(folder, session.user.id, `background.${extensionForType(backgroundVideo.type)}`);
      await putObject(key, backgroundVideo, backgroundVideo.type || "video/mp4");
      backgroundVideoUrl = getPublicUrl(key);
    }

    // The profile cover is the whole point of the request, so a failure here is
    // a failure of the request rather than something to log and swallow.
    // Clearing `coverConfig` is what makes the banner play this video instead of
    // the legacy animated cover.
    await ensureLocalUserProfile(session.user);
    await db
      .update(profiles)
      .set({
        coverVideoUrl: videoUrl,
        coverConfig: null,
        shortVideoCoverConfig: {
          templateId,
          aspectRatio,
          speed,
          duration,
          photoUrls,
          videoUrl,
          updatedAt: new Date().toISOString(),
        },
      })
      .where(eq(profiles.userId, session.user.id));

    // The covers table is history, so a schema that has not caught up with the
    // migration must not take an otherwise-published cover down with it.
    let coverId: string | null = null;
    try {
      const [cover] = await db
        .insert(shortVideoCovers)
        .values({
          userId: session.user.id,
          templateId,
          speed,
          duration,
          aspectRatio,
          subtitle,
          productLabel,
          productUrl,
          profilePhotoUrl,
          backgroundVideoUrl,
          photoUrls,
          videoUrl,
          profileOffsetX,
          profileOffsetY,
          profileRadius,
          status: "ready",
        })
        .returning();
      coverId = cover?.id ?? null;
    } catch (dbError) {
      console.error("Failed to persist short video cover record:", dbError);
    }

    return successResponse(
      { coverId, videoUrl, photoUrls, templateId, duration, aspectRatio },
      201,
    );
  } catch (err) {
    console.error("Short video cover publish error:", err);
    return errorResponse(err instanceof Error ? err.message : "Unable to publish the cover video");
  }
}
