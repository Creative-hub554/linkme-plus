/**
 * What a file's bytes say it is.
 *
 * Every upload path used to accept the browser's `File.type` — a string the
 * caller chooses — and hand it to storage as the object's content type. A
 * request could therefore store an HTML document (or anything else) under
 * `image/png`, and a presigned URL could carry any size the caller felt like
 * declaring. This module answers the only question that can be answered
 * honestly before the bytes are written: which formats do the leading bytes
 * actually match?
 *
 * It reads signatures, not the whole file, and it says `null` rather than
 * guessing. Callers treat `null` as a refusal — an unrecognised file is not an
 * allowed image, video, or PDF, whatever its name or declared type says.
 */

export interface DetectedFileType {
  mime: string;
  extension: string;
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const WEBM_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

/**
 * Identifies the formats the app stores, from their leading bytes.
 *
 * The header a caller passes only has to hold the longest signature read here
 * (a `ftyp` brand at offset 8, or the EBML head's doc type within the first
 * few dozen bytes), so 64 bytes is enough and the whole upload never has to be
 * buffered just to classify it.
 */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (bytesEqual(bytes, 0, JPEG_SIGNATURE)) return { mime: "image/jpeg", extension: "jpg" };
  if (bytesEqual(bytes, 0, PNG_SIGNATURE)) return { mime: "image/png", extension: "png" };
  if (ascii(bytes, 0, 4) === "GIF8") return { mime: "image/gif", extension: "gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return { mime: "application/pdf", extension: "pdf" };
  if (ascii(bytes, 4, 4) === "ftyp") {
    // ISO base media files carry a major brand at offset 8. QuickTime uses its
    // own; every other brand the app accepts is an MP4 family container.
    return ascii(bytes, 8, 4) === "qt  "
      ? { mime: "video/quicktime", extension: "mov" }
      : { mime: "video/mp4", extension: "mp4" };
  }
  // Matroska and WebM share the EBML head, so the doc type decides. Matroska
  // is deliberately not treated as WebM: it is a different container and the
  // app does not serve it.
  if (bytesEqual(bytes, 0, WEBM_SIGNATURE) && ascii(bytes, 0, bytes.length).includes("webm")) {
    return { mime: "video/webm", extension: "webm" };
  }
  return null;
}
