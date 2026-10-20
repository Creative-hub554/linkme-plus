import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import {
  assertStorageConfigured,
  generateKey,
  getPresignedUploadUrl,
  getPublicUrl,
  validateFile,
  getFolderForPurpose,
  ALL_ALLOWED_TYPES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_DOCUMENT_SIZE,
} from "@/lib/r2";

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { filename, contentType, purpose = "post", size } = body;

    if (!filename || !contentType) {
      return errorResponse("Filename and content type are required");
    }

    // Validate file type
    if (!ALL_ALLOWED_TYPES.includes(contentType)) {
      return errorResponse(
        `File type not allowed. Allowed: ${ALL_ALLOWED_TYPES.join(", ")}`
      );
    }

    // The size is not optional any more, and this is the gate that makes it so: the presigned
    // URL signs Content-Length, so a PUT with a different body length cannot use it and the
    // limit is enforced by R2 itself — which only holds if the URL is minted *with* an explicit
    // length. A request without one would sign an unbounded URL, so it is refused here, before
    // anything is signed; the size the caller declares is then validated against the purpose's
    // limit exactly as an uploaded file's would be.
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
      return errorResponse("Filename, content type and a positive file size are required");
    }
    const validation = validateFile({ type: contentType, size }, purpose);
    if (!validation.valid) {
      return errorResponse(validation.error!);
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured", 503);
    }

    // Generate key and presigned URL
    const folder = getFolderForPurpose(purpose);
    const key = generateKey(folder, session.user.id, filename);
    // The declared size rides into the signature: R2 refuses a PUT whose body length is not
    // exactly this, so the limit the config holds is enforced at the bucket, not only at this
    // endpoint by a number the client could have lied about.
    const uploadUrl = await getPresignedUploadUrl(key, contentType, size);

    return successResponse({
      uploadUrl,
      key,
      publicUrl: getPublicUrl(key),
      contentType,
      purpose,
    });
  } catch (err) {
    console.error("Generate upload URL error:", err);
    return errorResponse("Failed to generate upload URL", 500);
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
