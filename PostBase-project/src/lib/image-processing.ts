import sharp from "sharp";
import { IMAGE_SIZES, type ImageSize } from "./r2";

// Image processing utilities
export async function processImage(
  input: Buffer | ArrayBuffer,
  options: {
    size?: ImageSize;
    format?: "jpeg" | "png" | "webp";
    quality?: number;
  } = {}
): Promise<Buffer> {
  const { size = "medium", format = "webp", quality = 85 } = options;

  const dimensions = IMAGE_SIZES[size];

  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  return sharp(buffer)
    .resize(dimensions.width, dimensions.height, {
      fit: "cover",
      withoutEnlargement: true,
    })
    .toFormat(format, { quality })
    .toBuffer();
}

// Generate multiple sizes
export async function generateImageSizes(
  input: Buffer | ArrayBuffer,
  sizes: ImageSize[] = ["thumbnail", "small", "medium", "large"]
): Promise<Record<ImageSize, Buffer>> {
  const results: Partial<Record<ImageSize, Buffer>> = {};

  for (const size of sizes) {
    results[size] = await processImage(input, { size });
  }

  return results as Record<ImageSize, Buffer>;
}

// Generate thumbnail
export async function generateThumbnail(
  input: Buffer | ArrayBuffer
): Promise<Buffer> {
  return processImage(input, { size: "thumbnail", quality: 80 });
}

// Generate avatar
export async function generateAvatar(
  input: Buffer | ArrayBuffer
): Promise<Buffer> {
  return processImage(input, {
    size: "avatar",
    format: "webp",
    quality: 90,
  });
}

// Generate cover image
export async function generateCover(
  input: Buffer | ArrayBuffer
): Promise<Buffer> {
  return processImage(input, {
    size: "cover",
    format: "webp",
    quality: 85,
  });
}

// Extract video thumbnail (placeholder - use ffmpeg in production)
export async function extractVideoThumbnail(
  _input: Buffer | ArrayBuffer
): Promise<Buffer> {
  // In production, use ffmpeg to extract frame
  // For now, return a placeholder
  const placeholder = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  return placeholder;
}

// Validate image dimensions
export async function getImageDimensions(
  input: Buffer | ArrayBuffer
): Promise<{ width: number; height: number }> {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const metadata = await sharp(buffer).metadata();

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}

// Check if image is valid
export async function validateImage(
  input: Buffer | ArrayBuffer,
  options: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    aspectRatio?: number; // width/height
  } = {}
): Promise<{ valid: boolean; error?: string }> {
  const { width, height } = await getImageDimensions(input);

  if (options.minWidth && width < options.minWidth) {
    return { valid: false, error: `Image must be at least ${options.minWidth}px wide` };
  }

  if (options.minHeight && height < options.minHeight) {
    return { valid: false, error: `Image must be at least ${options.minHeight}px tall` };
  }

  if (options.maxWidth && width > options.maxWidth) {
    return { valid: false, error: `Image must be no more than ${options.maxWidth}px wide` };
  }

  if (options.maxHeight && height > options.maxHeight) {
    return { valid: false, error: `Image must be no more than ${options.maxHeight}px tall` };
  }

  if (options.aspectRatio) {
    const actualRatio = width / height;
    const tolerance = 0.1;
    if (Math.abs(actualRatio - options.aspectRatio) > tolerance) {
      return {
        valid: false,
        error: `Image aspect ratio must be approximately ${options.aspectRatio}:1`,
      };
    }
  }

  return { valid: true };
}
