import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import {
  assertStorageConfigured,
  generateKey,
  getPublicUrl,
  putObject,
  validateFile,
  getFolderForPurpose,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_DOCUMENT_SIZE,
} from "@/lib/r2";

/**
 * POST /api/uploads — the general-purpose upload door.
 *
 * The request is a multipart form: one `file` and an optional `purpose` naming
 * which folder the object belongs to (`getFolderForPurpose`'s list). The bytes
 * are stored in the same request that carries them — there is no presigned URL
 * to mint and no follow-up browser-to-R2 hop. The old two-step contract died
 * twice over: its only use was a presigned PUT the browser can never perform
 * (the media bucket sends no CORS headers, so the preflight was refused), and
 * its signing path needed S3-API credentials the platform binding has replaced.
 * What the shape does keep is every other route's guarantees: the type/size
 * limits run on the actual `File` the form carries — the body's own length, not
 * a number the client could have declared and then broken.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const purposeValue = formData.get("purpose");
    const purpose = typeof purposeValue === "string" && purposeValue.length > 0 ? purposeValue : "post";

    if (!(file instanceof File)) {
      return errorResponse("A file is required");
    }

    // Validate against the bytes the form actually carried.
    if (!file.type) {
      return errorResponse("Content type is required");
    }
    const validation = validateFile({ type: file.type, size: file.size }, purpose);
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured", 503);
    }

    const key = generateKey(getFolderForPurpose(purpose), session.user.id, file.name || "upload");
    await putObject(key, file, file.type);

    return successResponse({
      url: getPublicUrl(key),
      key,
      contentType: file.type,
      purpose,
    }, 201);
  } catch (err) {
    console.error("Upload error:", err);
    return errorResponse("Failed to upload that file", 500);
  }
}

// Get upload limits info
export async function GET() {
  return successResponse({
    allowedTypes: {
      images: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      videos: ["video/mp4", "video/webm", "video/quicktime"],
      documents: ["application/pdf"],
    },
    maxSizes: {
      image: MAX_IMAGE_SIZE,
      video: MAX_VIDEO_SIZE,
      document: MAX_DOCUMENT_SIZE,
    },
    purposes: ["avatar", "cover", "cover-video", "post", "listing", "document"],
  });
}
