import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const R2_ACCOUNT_ID = runtimeEnv.R2_ACCOUNT_ID || "";
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const r2Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: runtimeEnv.R2_ACCESS_KEY_ID || "",
    secretAccessKey: runtimeEnv.R2_SECRET_ACCESS_KEY || "",
  },
});

export const BUCKET_NAME = runtimeEnv.R2_BUCKET_NAME || "linkme-plus-uploads";
export const PUBLIC_URL = (runtimeEnv.R2_PUBLIC_URL || "").replace(/\/$/, "");

export function assertStorageConfigured(): void {
  const missing = [
    ["R2_ACCOUNT_ID", R2_ACCOUNT_ID],
    ["R2_ACCESS_KEY_ID", runtimeEnv.R2_ACCESS_KEY_ID || ""],
    ["R2_SECRET_ACCESS_KEY", runtimeEnv.R2_SECRET_ACCESS_KEY || ""],
    ["R2_BUCKET_NAME", runtimeEnv.R2_BUCKET_NAME || ""],
    ["R2_PUBLIC_URL", PUBLIC_URL],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Cloudflare R2 storage is not configured: missing ${missing.join(", ")}`);
  }
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

// Get presigned upload URL
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  assertStorageConfigured();
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

// Upload a file directly from the server (e.g. cover uploads proxied through the API)
export async function putObject(
  key: string,
  body: File | Blob | Uint8Array | ArrayBuffer | string,
  contentType: string
): Promise<void> {
  assertStorageConfigured();
  // The S3 SDK takes `Uint8Array | string`, not a raw `ArrayBuffer`, so every
  // binary shape is normalised to a view before it is handed over.
  const normalizedBody = body instanceof File || body instanceof Blob
    ? new Uint8Array(await body.arrayBuffer())
    : body instanceof ArrayBuffer
      ? new Uint8Array(body)
      : body;
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: normalizedBody,
    ContentType: contentType,
  });

  await r2Client.send(command);
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
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await r2Client.send(command);
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
 * Deletes the stored objects behind a list of media URLs.
 *
 * URLs that are not ours are skipped, and the function never throws: it runs
 * after the row that referenced the object is already gone, where a storage
 * hiccup must not turn a successful delete into a failed request. A failure is
 * logged and left behind as cleanup rather than surfaced, and retrying is safe
 * because deleting an absent key succeeds. Returns the keys it removed.
 */
export async function deleteStoredObjects(
  urls: Iterable<string | null | undefined>
): Promise<string[]> {
  const keys = [
    ...new Set([...urls].map(keyFromPublicUrl).filter((key): key is string => key !== null)),
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
  // Check file type
  if (!ALL_ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: "File type not allowed" };
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
    case "listing":
      return "listings";
    case "document":
      return "documents";
    default:
      return "uploads";
  }
}
