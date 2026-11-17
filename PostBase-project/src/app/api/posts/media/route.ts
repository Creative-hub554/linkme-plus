import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import {
  assertStorageConfigured,
  generateKey,
  putObject,
  getPublicUrl,
  getFolderForPurpose,
  validateFile,
} from "@/lib/r2";

/**
 * POST /api/posts/media
 * Accepts a multipart form with a single `file`, stores it in R2 under the
 * "post" purpose and answers with the public URL the post should record.
 *
 * The bytes are proxied through the server rather than PUT straight to R2.
 * A browser PUT to the bucket is refused — the media bucket sends no
 * `Access-Control-Allow-Origin`, so the preflight never leaves the page — and
 * a server that receives the bytes is also the only place their type and size
 * can be checked instead of trusted. `/api/uploads` now works the same way.
 *
 * Ceiling: the file passes through this Worker, so it is bounded by the
 * platform's request-body limit. Today's composer attaches images (10MB max),
 * which sits well inside it; a much larger video would want the direct-to-R2
 * path back once the bucket sends CORS headers.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return errorResponse("A file is required");
    }

    const validation = validateFile({ type: file.type, size: file.size }, "post");
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(
        storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured",
        503,
      );
    }

    const key = generateKey(getFolderForPurpose("post"), session.user.id, file.name || "upload");
    await putObject(key, file, file.type);

    return successResponse({ url: getPublicUrl(key), key, type: file.type }, 201);
  } catch (err) {
    console.error("Upload post media error:", err);
    return errorResponse("Failed to upload that file", 500);
  }
}
