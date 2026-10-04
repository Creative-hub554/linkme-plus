import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { assertStorageConfigured, r2Client, BUCKET_NAME, getPublicUrl, IMAGE_SIZES, keyBelongsToUser, putObject, type ImageSize } from "@/lib/r2";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { key, sizes = ["thumbnail", "small", "medium"] } = body;

    if (!key || typeof key !== "string") {
      return errorResponse("File key is required");
    }

    // `key` is a client-supplied object path and this route both reads the
    // object and writes derived assets beside it. Confining it to the caller's
    // own folder is what keeps the route from being a cross-tenant read (fetch
    // any object by guessing its key) and a cross-tenant write (derive files
    // into another member's prefix). Refused before storage is touched.
    if (!keyBelongsToUser(key, session.user.id)) {
      return errorResponse("You can only process your own uploads", 403);
    }

    try {
      assertStorageConfigured();
    } catch (storageError) {
      return errorResponse(storageError instanceof Error ? storageError.message : "Cloudflare R2 storage is not configured", 503);
    }

    // Fetch original from R2
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await r2Client.send(command);

    if (!response.Body) {
      return errorResponse("File not found", 404);
    }

    const fileBuffer = Buffer.from(await response.Body.transformToByteArray());

    // Process each size
    const processedUrls: Record<string, string> = {};

    for (const size of sizes) {
      const dimensions = IMAGE_SIZES[size as ImageSize];
      if (!dimensions) continue;

      const processed = await sharp(fileBuffer)
        .resize(dimensions.width, dimensions.height, {
          fit: "cover",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();

      // Generate key for processed image
      const ext = key.split(".").pop();
      const baseKey = key.replace(`.${ext}`, "");
      const processedKey = `${baseKey}-${size}.webp`;

      // Persist every derived asset in the same Cloudflare R2 bucket.
      await putObject(processedKey, processed, "image/webp");
      processedUrls[size] = getPublicUrl(processedKey);
    }

    return successResponse({
      original: getPublicUrl(key),
      sizes: processedUrls,
    });
  } catch (err) {
    console.error("Process image error:", err);
    return errorResponse("Failed to process image", 500);
  }
}
