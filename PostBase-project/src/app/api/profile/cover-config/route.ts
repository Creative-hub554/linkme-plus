import { db } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { assertStorageConfigured, deleteStoredObjects, generateKey, getFolderForPurpose, getPublicUrl, putObject, validateFile } from "@/lib/r2";
import { coverConfigPhotoUrls } from "@/lib/cover-config";
import { eq } from "drizzle-orm";

const MAX_PHOTOS = 24;

type CoverConfig = {
  templateId: string;
  colorPalette: string[];
  mode?: "personal" | "group";
  title?: string;
  subtitle?: string;
  profile?: { enabled?: boolean; position?: "center"; shape?: "circle" };
  duration?: number;
  motion: { rows: number; speed: number; direction: string; transition: string; animation: string };
  effect?: string;
  backgroundPhoto?: string | null;
  backgroundPhotoIndex?: number;
};

function parseConfig(value: FormDataEntryValue | null): CoverConfig {
  if (typeof value !== "string") throw new Error("Cover configuration is required");
  let config: CoverConfig;
  try {
    config = JSON.parse(value) as CoverConfig;
  } catch {
    throw new Error("Cover configuration must be valid JSON");
  }
  if (!config || typeof config !== "object" || !/^[a-z0-9-]{1,50}$/.test(config.templateId)) throw new Error("Invalid cover configuration");
  if (!Array.isArray(config.colorPalette) || config.colorPalette.length < 3 || config.colorPalette.length > 8 || config.colorPalette.some((color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) throw new Error("A valid color palette is required");
  if (!config.motion || !Number.isInteger(config.motion.rows) || config.motion.rows < 1 || config.motion.rows > 8) throw new Error("Rows must be between 1 and 8");
  if (!Number.isFinite(config.motion.speed) || config.motion.speed < 0.25 || config.motion.speed > 2) throw new Error("Speed must be between 0.25 and 2");
  if (config.duration !== undefined && (!Number.isInteger(config.duration) || config.duration < 5 || config.duration > 10)) throw new Error("Duration must be between 5 and 10 seconds");
  if (config.mode !== undefined && config.mode !== "personal" && config.mode !== "group") throw new Error("Invalid cover mode");
  return config;
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const form = await request.formData();
    const config = parseConfig(form.get("config"));
    const files = form.getAll("photos").filter((value): value is File => value instanceof File);
    if (files.length > MAX_PHOTOS) return errorResponse(`You can use up to ${MAX_PHOTOS} photos`);

    const photoUrls: string[] = [];
    if (files.length > 0) {
      try {
        assertStorageConfigured();
      } catch (storageError) {
        return errorResponse(storageError instanceof Error ? storageError.message : "Photo storage is not configured", 503);
      }
    }

    for (const file of files) {
      const validation = validateFile({ type: file.type, size: file.size }, "cover");
      if (!validation.valid || !file.type.startsWith("image/")) return errorResponse(validation.error || "Cover photos must be images");
      const key = generateKey(getFolderForPurpose("cover"), session.user.id, file.name);
      // R2's AWS SDK checksum middleware cannot hash a flowing Web File stream
      // reliably in this runtime, so buffer the upload before sending it.
      const bytes = new Uint8Array(await file.arrayBuffer());
      await putObject(key, bytes, file.type);
      photoUrls.push(getPublicUrl(key));
    }

    const backgroundIndex = Number.isInteger(config.backgroundPhotoIndex) && config.backgroundPhotoIndex !== undefined ? config.backgroundPhotoIndex : 0;
    const coverConfig = { ...config, photos: photoUrls, backgroundPhoto: photoUrls[backgroundIndex] ?? null, updatedAt: new Date().toISOString() };
    await ensureLocalUserProfile(session.user);
    // The config this save replaces is read before the write: the photos it held
    // are the only record of the objects that become unreferenced when it goes.
    const [current] = await db
      .select({ coverConfig: profiles.coverConfig })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id));
    await db.update(profiles).set({ coverConfig, coverVideoUrl: null }).where(eq(profiles.userId, session.user.id));

    // Every photo the replaced config held is now unreferenced, so it comes out
    // of the bucket rather than staying as storage nobody points at but everyone
    // can still fetch. A save with no new photos still replaces the old config,
    // so this is also the path that clears a photo-only animated cover. The
    // published video's object is not touched: `coverVideoUrl: null` above turns
    // the clip off, but the clip itself is history that this route does not own.
    const removed = await deleteStoredObjects(coverConfigPhotoUrls(current?.coverConfig));
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} replaced cover photo(s) for ${session.user.id}`);
    }

    return successResponse({ coverConfig }, 201);
  } catch (err) {
    console.error("Save cover config error:", err);
    return errorResponse(err instanceof Error ? err.message : "Failed to save cover configuration", 500);
  }
}
