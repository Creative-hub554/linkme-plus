import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { detectFileType } from "@/lib/file-signature";
import {
  MAX_DOCUMENT_SIZE,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  UPLOAD_PURPOSES,
  allowedTypesForPurpose,
  assertStorageConfigured,
  generateKey,
  getFolderForPurpose,
  getPublicUrl,
  isUploadPurpose,
  maxSizeForType,
  putObject,
} from "@/lib/r2";

/**
 * POST /api/uploads
 *
 * Stores one upload under the caller's own folder and answers with the URL the
 * rest of the app records.
 *
 * This route used to hand out a presigned R2 URL: the caller sent
 * `{ filename, contentType, size }`, the server signed a PUT for the key, and
 * the bytes went straight to the bucket. Nothing in that exchange could be
 * enforced — the signed PUT had no length bound, and `contentType` was the
 * caller's claim, so a request could store an arbitrary object of arbitrary
 * size under any allowed label, or simply lie about what it was uploading.
 *
 * The bytes now pass through this route, which is the only place the two rules
 * can be applied honestly:
 *
 *   - Size is the length of the body the server received, checked against the
 *     limit for the type it *detected*.
 *   - Type is read from the file's signature (see `detectFileType`), then
 *     checked against the types the purpose allows. The declared `File.type`
 *     is ignored entirely, and the stored object's content type is the detected
 *     one, so the bucket cannot serve a mislabelled file.
 *
 * The key's extension also comes from the detected type rather than the
 * filename, so a `.png` name on PDF bytes is stored as a PDF.
 *
 * Ceiling: the body is read by the Worker, so it is bounded by the platform's
 * request-body limit as well as by the per-type limits below.
 */

/** Enough of the file to read every signature `detectFileType` knows. */
const HEADER_BYTES = 64;

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A JSON body is the shape the retired presign endpoint took. Answering
    // with the new contract's refusal, rather than a 500 from `formData()`,
    // keeps a stale caller's failure legible.
    return errorResponse("Send the file as multipart form data");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return errorResponse("A file is required");
  }

  const requestedPurpose = form.get("purpose") ?? "post";
  if (!isUploadPurpose(requestedPurpose)) {
    return errorResponse(`Unknown upload purpose. Allowed: ${UPLOAD_PURPOSES.join(", ")}`);
  }

  try {
    // The first bytes are all the classifier needs, and reading only those
    // keeps classification independent of how large the file is.
    const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    const detected = detectFileType(header);
    if (!detected) {
      return errorResponse("That file is not an allowed image, video, or PDF");
    }

    const allowed = allowedTypesForPurpose(requestedPurpose);
    if (!allowed.includes(detected.mime)) {
      return errorResponse(
        `${detected.mime} files are not allowed for ${requestedPurpose} uploads. Allowed: ${allowed.join(", ")}`,
      );
    }

    const limit = maxSizeForType(detected.mime);
    if (file.size > limit) {
      return errorResponse(
        `That file is ${megabytes(file.size)}MB. The limit for ${detected.mime} is ${megabytes(limit)}MB`,
      );
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(
        storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured",
        503,
      );
    }

    const key = generateKey(
      getFolderForPurpose(requestedPurpose),
      session.user.id,
      `upload.${detected.extension}`,
    );
    await putObject(key, file, detected.mime);

    return successResponse(
      { url: getPublicUrl(key), key, type: detected.mime, size: file.size },
      201,
    );
  } catch (err) {
    console.error("Store upload error:", err);
    return errorResponse("Failed to store that file", 500);
  }
}

/** The limits this route enforces, so a client can say them before uploading. */
export async function GET() {
  return successResponse({
    purposes: UPLOAD_PURPOSES.map((purpose) => ({
      purpose,
      types: allowedTypesForPurpose(purpose),
    })),
    maxSizes: {
      image: MAX_IMAGE_SIZE,
      video: MAX_VIDEO_SIZE,
      document: MAX_DOCUMENT_SIZE,
    },
  });
}
