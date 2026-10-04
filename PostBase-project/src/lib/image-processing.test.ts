import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  extractVideoThumbnail,
  generateAvatar,
  generateCover,
  generateImageSizes,
  generateThumbnail,
  getImageDimensions,
  processImage,
  validateImage,
} from "./image-processing";

/**
 * These helpers are the only place the app hands a byte buffer to an image
 * encoder, so the tests assert the two things a caller depends on: the output
 * is a real image in the requested format, and the size helpers honour
 * `withoutEnlargement` rather than inventing pixels that were not there.
 *
 * The fixture is drawn with sharp itself, so the test needs no checked-in
 * binary and produces the same bytes every run.
 */
async function solid(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .png()
    .toBuffer();
}

describe("processImage", () => {
  it("re-encodes to webp by default and does not enlarge a small image", async () => {
    const output = await processImage(await solid(50, 50));
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("webp");
    // `withoutEnlargement` keeps a 50px source at 50px rather than scaling it
    // up to the medium size.
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(50);
  });

  it("accepts an ArrayBuffer as well as a Buffer", async () => {
    const source = await solid(300, 200);
    const asArrayBuffer = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer;
    const output = await processImage(asArrayBuffer, { size: "small", format: "png" });
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("png");
    // A 400×400 box would only ever enlarge this 300×200 source, which
    // `withoutEnlargement` refuses — so it comes back at its own size.
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });
});

describe("the size helpers", () => {
  it("generates every requested size", async () => {
    const source = await solid(1000, 1000);
    const sizes = await generateImageSizes(source, ["thumbnail", "small"]);
    expect(Object.keys(sizes).sort()).toEqual(["small", "thumbnail"]);
    for (const buffer of Object.values(sizes)) {
      expect(Buffer.isBuffer(buffer)).toBe(true);
    }
  });

  it("generates a thumbnail, an avatar and a cover in their own shapes", async () => {
    const source = await solid(1200, 1200);

    const thumb = await sharp(await generateThumbnail(source)).metadata();
    expect([thumb.width, thumb.height]).toEqual([150, 150]);

    const avatar = await sharp(await generateAvatar(source)).metadata();
    expect(avatar.format).toBe("webp");
    expect([avatar.width, avatar.height]).toEqual([200, 200]);

    const cover = await sharp(await generateCover(source)).metadata();
    expect([cover.width, cover.height]).toEqual([1200, 480]);
  });
});

describe("extractVideoThumbnail", () => {
  it("returns a jpeg placeholder of the expected shape", async () => {
    // No encoder is available here, so the documented behaviour is a grey
    // placeholder rather than a real frame; that is what the test pins.
    const output = await extractVideoThumbnail(Buffer.from([0, 0, 0, 0]));
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([320, 180]);
  });
});

describe("getImageDimensions and validateImage", () => {
  it("reads the real dimensions", async () => {
    await expect(getImageDimensions(await solid(640, 480))).resolves.toEqual({
      width: 640,
      height: 480,
    });
  });

  it("accepts an image that satisfies every constraint", async () => {
    const image = await solid(800, 600);
    await expect(
      validateImage(image, { minWidth: 400, minHeight: 300, maxWidth: 1000, maxHeight: 1000 }),
    ).resolves.toEqual({ valid: true });
  });

  it("rejects each violated constraint with its own message", async () => {
    const image = await solid(800, 600);

    await expect(validateImage(image, { minWidth: 1000 })).resolves.toEqual({
      valid: false,
      error: "Image must be at least 1000px wide",
    });
    await expect(validateImage(image, { minHeight: 700 })).resolves.toEqual({
      valid: false,
      error: "Image must be at least 700px tall",
    });
    await expect(validateImage(image, { maxWidth: 500 })).resolves.toEqual({
      valid: false,
      error: "Image must be no more than 500px wide",
    });
    await expect(validateImage(image, { maxHeight: 400 })).resolves.toEqual({
      valid: false,
      error: "Image must be no more than 400px tall",
    });
  });

  it("checks the aspect ratio within a tolerance", async () => {
    const image = await solid(800, 600); // 4:3
    await expect(validateImage(image, { aspectRatio: 4 / 3 })).resolves.toEqual({ valid: true });
    // 2:1 is far from 4:3, so it fails with the ratio in the message.
    await expect(validateImage(image, { aspectRatio: 2 })).resolves.toEqual({
      valid: false,
      error: "Image aspect ratio must be approximately 2:1",
    });
  });
});
