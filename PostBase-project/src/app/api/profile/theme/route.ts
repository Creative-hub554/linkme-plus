import { db, withDbRetry } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import {
  assertStorageConfigured,
  deleteStoredObjects,
  generateKey,
  getFolderForPurpose,
  getPublicUrl,
  putObject,
  validateFile,
} from "@/lib/r2";
import { eq } from "drizzle-orm";
import {
  MAX_PROFILE_THEME_DECORATIONS,
  normalizeProfileThemeConfig,
  type ProfileThemeConfig,
} from "@/lib/profile-theme";

/**
 * The signed-in member's Profile Theme Studio configuration.
 *
 * `GET` returns the profile's stored configuration. The column is seeded with
 * the Standard configuration (migration 0014 and the schema default), so the
 * usual answer is the defaults the studio opens with, handed back through the
 * same shape a saved theme uses — the editor does not need a separate
 * "nothing stored yet" case.
 *
 * `POST` takes the config as JSON plus the decoration files, in the same order
 * the config's staged (`url: null`) decorations appear: a null becomes the URL
 * of the file at that position, so the config and its images cannot drift.
 * Decorations the new config no longer lists leave the bucket, matching what
 * the cover-config route does for replaced photos.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    await withDbRetry(() => ensureLocalUserProfile(session.user));

    const [row] = await db
      .select({ themeConfig: profiles.themeConfig })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id));

    return successResponse({ themeConfig: row?.themeConfig ?? null });
  } catch (err) {
    // Covers the database being down and the window before this feature's
    // migration has been applied — the column does not exist yet. The editor
    // keeps the Standard view rather than inventing a stored theme.
    console.error("Read theme config error:", err);
    return errorResponse("Theme configuration is temporarily unavailable", 503);
  }
}

/**
 * The request's decoration list: a config entry with a null url is staged, and
 * consumed in order against the form's `decorations` files. Serialized stubs
 * are what `normalizeProfileThemeConfig` refuses, so the boundary
 * normalization swaps each null for a placeholder the validator accepts,
 * checks the rest of the shape against that, and puts the nulls back — one set
 * of rules, applied at the one place they differ.
 */
interface ConfigWithStubs {
  config: ProfileThemeConfig;
  stagedCount: number;
}

const DECORATION_URL_PLACEHOLDER = "https://placeholder.invalid/decoration";

function parseConfig(raw: FormDataEntryValue | null): ConfigWithStubs {
  if (typeof raw !== "string") throw new Error("Theme configuration is required");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("Theme configuration must be valid JSON");
  }

  if (!body || typeof body !== "object") throw new Error("Invalid theme configuration");
  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.decorations)) throw new Error("Invalid decoration list");
  for (const decoration of candidate.decorations) {
    if (!decoration || typeof decoration !== "object") throw new Error("Invalid decoration list");
    const url = (decoration as Record<string, unknown>).url;
    if (url === null) continue;
    if (typeof url !== "string" || !(url.startsWith("https://") || url.startsWith("/") || url.startsWith("http://"))) {
      throw new Error("Invalid decoration url");
    }
  }

  const withStubs: unknown = {
    ...candidate,
    decorations: candidate.decorations.map((decoration) =>
      decoration && typeof decoration === "object" && (decoration as Record<string, unknown>).url === null
        ? { ...(decoration as Record<string, unknown>), url: DECORATION_URL_PLACEHOLDER }
        : decoration,
    ),
  };
  const normalized = normalizeProfileThemeConfig(withStubs);
  if (!normalized) throw new Error("Invalid theme configuration");

  return {
    config: {
      ...normalized,
      decorations: normalized.decorations.map((decoration, index) => {
        const original = (candidate.decorations as Record<string, unknown>[])[index];
        return original?.url === null ? { ...decoration, url: null } : decoration;
      }),
    } satisfies ProfileThemeConfig,
    // The pairing check the route adds: files are matched by order, so their
    // count is known before anything is uploaded.
    stagedCount: normalized.decorations.filter(
      (decoration, index) => (candidate.decorations as Record<string, unknown>[])[index]?.url === null,
    ).length,
  };
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const form = await request.formData();
    const { config, stagedCount } = parseConfig(form.get("config"));
    const files = form.getAll("decorations").filter((value): value is File => value instanceof File);

    if (files.length !== stagedCount) {
      return errorResponse("Every unsaved decoration needs its file");
    }
    if (files.length > 0) {
      if (files.length > MAX_PROFILE_THEME_DECORATIONS) {
        return errorResponse(`You can pin up to ${MAX_PROFILE_THEME_DECORATIONS} decorations`);
      }
      try {
        assertStorageConfigured();
      } catch (storageError) {
        return errorResponse(
          storageError instanceof Error ? storageError.message : "Decoration storage is not configured",
          503,
        );
      }
    }

    // Upload before any write, so a failing upload is a clean 500 with nothing
    // half-saved — no orphaned config pointing at one of two image sets.
    const uploadedUrls: string[] = [];
    for (const file of files) {
      const validation = validateFile({ type: file.type, size: file.size }, "profile-photo");
      if (!validation.valid || !file.type.startsWith("image/")) {
        return errorResponse(validation.error || "Decorations must be images");
      }
      const key = generateKey(getFolderForPurpose("profile-photo"), session.user.id, file.name);
      // Buffered upload for the same AWS SDK streaming caveat as the cover
      // route.
      const bytes = new Uint8Array(await file.arrayBuffer());
      await putObject(key, bytes, file.type);
      uploadedUrls.push(getPublicUrl(key));
    }

    let uploadedIndex = 0;
    const decorated: ProfileThemeConfig = {
      ...config,
      decorations: config.decorations.map((decoration) =>
        decoration.url === null ? { ...decoration, url: uploadedUrls[uploadedIndex++] ?? "" } : decoration,
      ),
    };

    await withDbRetry(() => ensureLocalUserProfile(session.user));
    // The config this save replaces is read before the write: its decoration
    // URLs are the only record of objects that become unreferenced when it
    // goes — same reasoning as the cover-config route's photo cleanup.
    const [current] = await db
      .select({ themeConfig: profiles.themeConfig })
      .from(profiles)
      .where(eq(profiles.userId, session.user.id));
    await db.update(profiles).set({ themeConfig: decorated }).where(eq(profiles.userId, session.user.id));

    const previousUrls = new Set((current?.themeConfig?.decorations ?? []).map((decoration) => decoration.url));
    const kept = new Set(decorated.decorations.map((decoration) => decoration.url));
    const removed = await deleteStoredObjects([...previousUrls].filter((url) => !kept.has(url)));
    if (removed.length > 0) {
      console.log(`Deleted ${removed.length} replaced decoration(s) for ${session.user.id}`);
    }

    return successResponse({ themeConfig: decorated }, 201);
  } catch (err) {
    console.error("Save theme config error:", err);
    return errorResponse(err instanceof Error ? err.message : "Failed to save theme configuration", 500);
  }
}
