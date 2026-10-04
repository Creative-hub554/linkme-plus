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

    // Validate file size if provided
    if (size) {
      const validation = validateFile({ type: contentType, size }, purpose);
      if (!validation.valid) {
        return errorResponse(validation.error!);
      }
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured", 503);
    }

    // Generate key and presigned URL
    const folder = getFolderForPurpose(purpose);
    const key = generateKey(folder, session.user.id, filename);
    const uploadUrl = await getPresignedUploadUrl(key, contentType);

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
