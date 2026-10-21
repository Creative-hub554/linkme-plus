import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { archivedObjects } from "@/lib/db/schema";
import {
  archivedFileIdFromUrl,
  createDriveClient,
  driveConfigFromEnv,
  type DriveClient,
} from "@/lib/gdrive";
import { workerR2Bucket } from "@/lib/r2-bucket";
import { checkR2Bucket, r2ApiCredentials, signR2Request } from "@/lib/r2-sigv4";

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export const BUCKET_NAME = runtimeEnv.R2_BUCKET_NAME || "linkme-plus-uploads";
export const PUBLIC_URL = (runtimeEnv.R2_PUBLIC_URL || "").replace(/\/$/, "");

/**
 * Every write and read goes through the runtime's own R2 capabilities, in
 * order of preference:
 *
 *   1. The platform's `UPLOADS` binding (worker/index.ts registers it at the
 *      top of the fetch handler) — available in every hosted runtime, needing
 *      no credentials at all.
 *   2. The bucket's S3-compatible API, signed with the WebCrypto signer in
 *      `@/lib/r2-sigv4` — what the Node dev server and the seed scripts use,
 *      which is why `R2_ACCOUNT_ID`-`R2_ACCESS_KEY_ID`-`R2_SECRET_ACCESS_KEY`
 *      remain configuration for those environments while no hosted runtime
 *      carries them.
 *
 * `assertStorageConfigured` names whichever piece is missing, keeping its
 * long-standing message shape so the routes that surface it to their callers
 * keep answering the same way.
 */
export function assertStorageConfigured(): void {
  if (workerR2Bucket()) return;
  const missing = [
    ["R2_ACCOUNT_ID", r2ApiCredentials() === null],
    ["UPLOADS binding", workerR2Bucket() === null],
  ];
  if (missing.every(([, isMissing]) => isMissing)) {
    throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY (no UPLOADS binding either)");
  }
}

/** A caller's body shaped the way both the binding's `put` and the signed API take it. */
async function normalizeBody(body: File | Blob | Uint8Array | ArrayBuffer | string): Promise<Uint8Array> {
  if (body instanceof File || body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (typeof body === "string") return new TextEncoder().encode(body);
  return body;
}

// File type configurations
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
];

export const ALL_ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
];

// Size limits (in bytes)
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024; // 20MB

// Image sizes for processing
export const IMAGE_SIZES = {
  thumbnail: { width: 150, height: 150 },
  small: { width: 400, height: 400 },
  medium: { width: 800, height: 800 },
  large: { width: 1200, height: 1200 },
  cover: { width: 1200, height: 480 },
  avatar: { width: 200, height: 200 },
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

// Generate unique key
export function generateKey(folder: string, userId: string, filename: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  return `${folder}/${userId}/${timestamp}-${random}.${ext}`;
}

/**
 * Whether an object key names the given member's own folder.
 *
 * Every key the app writes is built by {@link generateKey} as
 * `<folder>/<userId>/<file>`, so the member is the second path segment, and a
 * route that acts on a key a client handed in must check it before it fetches or
 * derives anything. Without the check the key is an arbitrary object in the
 * bucket: the caller can name somebody else's file, and a write derived from it
 * lands in that member's folder too.
 *
 * The test is about the *member* segment, not a folder allow-list: a key under
 * the member's own folder is theirs whatever its folder, and a key under anyone
 * else's folder is refused whatever its folder. A key too short to hold a member
 * segment (`photos.png`, or `posts/member-1`) is refused as well.
 */
export function keyBelongsToUser(key: string, userId: string): boolean {
  const segments = key.split("/");
  return segments.length >= 3 && segments[1] === userId;
}

/** The key the health probe heads against: one intentionally absent object. */
const STORAGE_PROBE_KEY = "__storage_probe__";

export interface StorageProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: "unreachable" | "unconfigured";
}

function storageConfigurationError(cause: unknown): boolean {
  // `assertStorageConfigured` names the missing variables its message — safe to
  // reflect as a class, but the class is all a public endpoint needs. Anything
  // else (network, signing, auth) is one failure shape from the outside.
  return cause instanceof Error && cause.message.startsWith("Cloudflare R2 storage is not configured");
}

/**
 * A real round-trip against storage, binding-first.
 *
 * Where the platform's `UPLOADS` binding is registered (every hosted runtime),
 * the probe is a `head` against a key no object occupies: cheap, authenticated
 * by the binding itself, and answered inside the same runtime the uploads land
 * in — no credentials are involved or needed. Where it is not (the Node dev
 * server, the scripts), the check falls back to the signed bucket `HEAD` in
 * `checkR2Bucket`, which proves the S3 credentials actually work rather than
 * merely being set.
 *
 * The answer carries no provenance — `ok`/`unreachable`/`unconfigured` and a
 * latency only — because its caller (`/api/health`) is a public endpoint.
 */
export async function probeStorage(): Promise<StorageProbeResult> {
  const started = performance.now();
  const bucket = workerR2Bucket();
  if (bucket) {
    try {
      await bucket.head(STORAGE_PROBE_KEY);
      return { ok: true, latencyMs: Math.round(performance.now() - started) };
    } catch {
      return { ok: false, latencyMs: Math.round(performance.now() - started), error: "unreachable" };
    }
  }
  try {
    assertStorageConfigured();
    const probe = await checkR2Bucket(BUCKET_NAME);
    if (probe.ok) return { ok: true, latencyMs: probe.latencyMs };
    return { ok: false, latencyMs: probe.latencyMs, error: "unreachable" };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: storageConfigurationError(error) ? "unconfigured" : "unreachable",
    };
  }
}

// Upload a file directly from the server (e.g. cover uploads proxied through the API)
export async function putObject(
  key: string,
  body: File | Blob | Uint8Array | ArrayBuffer | string,
  contentType: string
): Promise<void> {
  assertStorageConfigured();
  // Both transports take the same normalized body: the SDK-shaped callers hand
  // files, blobs and arrays over, and a view covers `binding.put` as a value
  // option in workerd.
  const normalizedBody = await normalizeBody(body);
  const bucket = workerR2Bucket();
  if (bucket) {
    await bucket.put(key, normalizedBody, { httpMetadata: { contentType } });
    return;
  }
  const credentials = r2ApiCredentials();
  if (!credentials) {
    throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY (no UPLOADS binding either)");
  }
  const request = await signR2Request({ method: "PUT", bucket: BUCKET_NAME, key, contentType, body: normalizedBody });
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: normalizedBody as unknown as BodyInit });
  if (!response.ok) {
    throw new Error(`R2 upload failed with HTTP ${response.status}`);
  }
}

// Get public URL for a file
export function getPublicUrl(key: string): string {
  if (!PUBLIC_URL) {
    throw new Error("R2_PUBLIC_URL is required for public media URLs");
  }
  return `${PUBLIC_URL}/${key}`;
}

// Get processed image URL
export function getProcessedImageUrl(key: string, _size: ImageSize): string {
  const url = getPublicUrl(key);
  // In production, use Cloudflare Images or a worker for on-the-fly processing
  // For now, return the original URL
  return url;
}

// Delete file from R2
export async function deleteFile(key: string): Promise<void> {
  assertStorageConfigured();
  const bucket = workerR2Bucket();
  if (bucket) {
    await bucket.delete(key);
    return;
  }
  const credentials = r2ApiCredentials();
  if (!credentials) {
    throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY (no UPLOADS binding either)");
  }
  const request = await signR2Request({ method: "DELETE", bucket: BUCKET_NAME, key });
  const response = await fetch(request.url, { method: request.method, headers: request.headers });
  // Deleting an absent object is a success for S3-compatible APIs: the caller
  // runs deletes after the referencing row is gone, where a second delete is
  // normal reuse, so 404 answers as nothing to do.
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed with HTTP ${response.status}`);
  }
}

/**
 * The bytes of one stored object, or `null` when the key is not there.
 *
 * The two transports answer differently — the binding yields an `R2ObjectBody`
 * whose body is a stream, the signed API a `Response` — but a caller (the
 * media-processing route is the only one) needs neither, just the bytes.
 * Reading through `arrayBuffer` of the consumed stream for the binding and the
 * response body keeps the helper's answer shape one thing. A non-404 failure
 * is a storage outage and throws for the caller's own try/catch to surface.
 */
export async function readStoredObject(key: string): Promise<Uint8Array | null> {
  assertStorageConfigured();
  const bucket = workerR2Bucket();
  if (bucket) {
    const object = await bucket.get(key);
    if (!object) return null;
    return new Uint8Array(await new Response(object.body).arrayBuffer());
  }
  const credentials = r2ApiCredentials();
  if (!credentials) {
    throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY (no UPLOADS binding either)");
  }
  const request = await signR2Request({ method: "GET", bucket: BUCKET_NAME, key });
  const response = await fetch(request.url, { method: request.method, headers: request.headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`R2 read failed with HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Recovers the object key from a stored public URL, or `null` when the URL is
 * not ours.
 *
 * Media rows keep the whole public URL, so this is the way back to the key a
 * `DeleteObjectCommand` needs. The prefix check is the safety rail, not a
 * nicety: a row may hold any URL at all (seeded demo posts point at external
 * hosts) and a guessed key would delete something entirely unrelated to us.
 */
export function keyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url || !PUBLIC_URL) return null;
  const prefix = `${PUBLIC_URL}/`;
  if (!url.startsWith(prefix)) return null;
  // Stored URLs are written without a query or fragment, but strip either so a
  // URL that gained one still resolves to its key.
  const key = url.slice(prefix.length).replace(/[?#].*$/, "");
  return key.length > 0 ? key : null;
}

/**
 * The object a write has just orphaned: the URL that was there before, unless
 * this write does not touch the field, writes the same URL again, or finds
 * nothing there.
 *
 * `next` carries the three states a partial update's body can hold, the same
 * three `readText` in `PUT /api/pages` understands: a string writes the field, a
 * `null` clears it, and `undefined` means the request never mentioned it. Only
 * the first two displace anything — a body that says nothing about `coverUrl`
 * must not offer the cover up for deletion — where clearing a photo is a real
 * write and the object behind it really is orphaned.
 *
 * The equality check is not redundant with `generateKey`, it is the rail a key
 * generator cannot give: keys are built from a timestamp and a random suffix, so
 * an upload that somehow lands on the key already stored would report the URL it
 * had just overwritten, and deleting that would destroy the file the row is now
 * pointing at. A URL that is not ours is left to `keyFromPublicUrl` to refuse —
 * this only answers whether anything was displaced at all, which is the decision
 * a replacement makes once per image.
 */
export function replacedObjectUrl(
  previous: string | null | undefined,
  next: string | null | undefined
): string | null {
  if (!previous || next === undefined || previous === next) return null;
  return previous;
}

/**
 * The Drive client used for deletes, rebuilt whenever the credentials change.
 *
 * Memoised because one avatar replacement can fire several deletes and a
 * token fetch per delete would be its own traffic — and keyed on the
 * credentials rather than "built once" because a test (and a future config
 * reload) may swap the environment between calls.
 */
let cachedDriveDeletes: { key: string; client: DriveClient | null } | null = null;

function driveClientForDeletes(): DriveClient | null {
  const config = driveConfigFromEnv(runtimeEnv);
  const key = config ? `${config.clientId}:${config.refreshToken}` : "";
  if (!cachedDriveDeletes || cachedDriveDeletes.key !== key) {
    cachedDriveDeletes = {
      key,
      // The transport is resolved per call rather than captured at
      // construction: a caller patching the global `fetch` (a test, or the
      // runtime itself) must not be dodged by a client holding the earlier
      // reference.
      client: config
        ? createDriveClient(config, { fetchImpl: (input, init) => fetch(input, init) })
        : null,
    };
  }
  return cachedDriveDeletes.client;
}

/**
 * The file ids behind a set of archived URLs — the mapping table's vote on
 * which Drive-shaped URLs the app actually put there.
 *
 * Never throws: a database outage leaves the map empty, which fails toward
 * *not* deleting, the direction this whole function errs in.
 */
async function findArchivedDriveIds(driveUrls: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (driveUrls.length === 0) return found;
  try {
    const rows = await db
      .select({ newUrl: archivedObjects.newUrl, driveFileId: archivedObjects.driveFileId })
      .from(archivedObjects)
      .where(inArray(archivedObjects.newUrl, driveUrls));
    for (const row of rows) found.set(row.newUrl, row.driveFileId);
  } catch (error) {
    console.warn("Failed to look up archived media URLs; Drive files left in place:", error);
  }
  return found;
}

/**
 * Deletes the stored objects behind a list of media URLs.
 *
 * Two homes, one contract. A URL that is one of our R2 public URLs is deleted
 * from R2 by key. A URL that is one of the Drive URLs the archive wrote is
 * deleted from Drive — but only when `archived_objects` records it, because
 * the mapping table is the allow-list that keeps a delete inside this app's
 * own files (a row may hold any URL at all; a Drive-shaped URL belonging to a
 * stranger must never be deleted on our credentials).
 *
 * URLs that are neither are skipped, and the function never throws: it runs
 * after the row that referenced the object is already gone, where a storage
 * hiccup must not turn a successful delete into a failed request. A failure is
 * logged and left behind as cleanup rather than surfaced, and retrying is safe
 * because deleting an absent object succeeds. Returns what it removed: R2
 * keys, and `drive:<file id>` for the archived files.
 */
export async function userOwnedStoredObjectUrls(
  urls: Iterable<string | null | undefined>,
  userId: string,
): Promise<string[]> {
  const requested = [
    ...new Set([...urls].filter((url): url is string => typeof url === "string" && url.length > 0)),
  ];
  const owned = new Set<string>();
  const archivedUrls: string[] = [];

  for (const url of requested) {
    const key = keyFromPublicUrl(url);
    if (key) {
      if (keyBelongsToUser(key, userId)) owned.add(url);
      continue;
    }
    if (archivedFileIdFromUrl(url)) archivedUrls.push(url);
  }

  // Archived URLs no longer contain the original member prefix, so consult
  // the archive provenance row before allowing a later delete to reach Drive.
  // A lookup failure fails closed: leave archived objects in storage.
  if (archivedUrls.length > 0) {
    try {
      const rows = await db
        .select({ newUrl: archivedObjects.newUrl, r2Key: archivedObjects.r2Key })
        .from(archivedObjects)
        .where(inArray(archivedObjects.newUrl, archivedUrls));
      for (const row of rows) {
        if (keyBelongsToUser(row.r2Key, userId)) owned.add(row.newUrl);
      }
    } catch (error) {
      console.warn("Failed to verify stored media ownership; archived files left in place:", error);
    }
  }

  return requested.filter((url) => owned.has(url));
}

export async function deleteStoredObjects(
  urls: Iterable<string | null | undefined>
): Promise<string[]> {
  const requested = [
    ...new Set([...urls].filter((url): url is string => typeof url === "string" && url.length > 0)),
  ];
  const keys = [
    ...new Set(requested.map(keyFromPublicUrl).filter((key): key is string => key !== null)),
  ];
  const deleted: string[] = [];

  // Sequential on purpose: one post's media is a handful of objects, and a
  // bounded loop keeps a storage outage from firing off every delete at once.
  for (const key of keys) {
    try {
      await deleteFile(key);
      deleted.push(key);
    } catch (error) {
      console.warn(`Failed to delete stored object "${key}":`, error);
    }
  }

  const driveUrls = requested.filter((url) => archivedFileIdFromUrl(url) !== null);
  if (driveUrls.length > 0) {
    const client = driveClientForDeletes();
    if (!client) {
      console.warn(
        "Archived (Drive) media URLs reached deleteStoredObjects but GDRIVE_* is not configured; leaving the files in place",
      );
    } else {
      const idByUrl = await findArchivedDriveIds(driveUrls);
      for (const url of driveUrls) {
        const fileId = idByUrl.get(url);
        if (!fileId) continue;
        try {
          await client.deleteFile(fileId);
          deleted.push(`drive:${fileId}`);
        } catch (error) {
          console.warn(`Failed to delete archived Drive file "${fileId}":`, error);
        }
      }
    }
  }

  return deleted;
}

// Validate file
export function validateFile(
  file: { type: string; size: number },
  // Accepted for call-site symmetry with `getFolderForPurpose`, but no rule
  // reads it yet: the limits below are chosen from the file's MIME type alone.
  // Named `_`-prefixed so the lint config treats it as deliberately unused.
  _purpose: string = "post"
): { valid: boolean; error?: string } {
  // Check file type and reject missing, zero, fractional, or unsafe sizes.
  if (!ALL_ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: "File type not allowed" };
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { valid: false, error: "File size must be a positive integer" };
  }

  // Check size based on type
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_SIZE) {
      return { valid: false, error: `Image must be less than ${MAX_IMAGE_SIZE / 1024 / 1024}MB` };
    }
  } else if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    if (file.size > MAX_VIDEO_SIZE) {
      return { valid: false, error: `Video must be less than ${MAX_VIDEO_SIZE / 1024 / 1024}MB` };
    }
  } else if (ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    if (file.size > MAX_DOCUMENT_SIZE) {
      return { valid: false, error: `Document must be less than ${MAX_DOCUMENT_SIZE / 1024 / 1024}MB` };
    }
  }

  return { valid: true };
}

// Get folder for purpose
export function getFolderForPurpose(purpose: string): string {
  switch (purpose) {
    case "avatar":
      return "avatars";
    case "cover":
      return "covers";
    case "profile-photo":
      return "profile-photos";
    case "bg-video":
      return "bg-videos";
    case "bg-photo":
      return "bg-photos";
    case "short-video-cover":
      return "short-video-covers";
    case "post":
      return "posts";
    case "seed":
      // The demo seeder's folder: the one putObject caller that is not a
      // route. The seeder's keys and the eviction pass's listing both derive
      // from this rule, so seeded orphans stay reachable by the pass.
      return "seed";
    case "listing":
      return "listings";
    case "document":
      return "documents";
    default:
      return "uploads";
  }
}
