import { describe, expect, it } from "vitest";
import { detectFileType } from "./file-signature";

/** A header padded to the 64 bytes the upload route reads, without lying about its type. */
function header(...bytes: number[]): Uint8Array {
  const padded = new Uint8Array(Math.max(64, bytes.length));
  padded.set(bytes);
  return padded;
}

function text(value: string): Uint8Array {
  return header(...Array.from(value, (character) => character.charCodeAt(0)));
}

describe("detectFileType", () => {
  it("recognises the image formats the app stores", () => {
    expect(detectFileType(header(0xff, 0xd8, 0xff, 0xe0))).toEqual({ mime: "image/jpeg", extension: "jpg" });
    expect(detectFileType(header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({
      mime: "image/png",
      extension: "png",
    });
    expect(detectFileType(text("GIF89a"))).toEqual({ mime: "image/gif", extension: "gif" });

    const webp = text("RIFF");
    webp.set(Array.from("WEBP", (character) => character.charCodeAt(0)), 8);
    expect(detectFileType(webp)).toEqual({ mime: "image/webp", extension: "webp" });
  });

  it("recognises PDFs", () => {
    expect(detectFileType(text("%PDF-1.7"))).toEqual({ mime: "application/pdf", extension: "pdf" });
  });

  it("separates the MP4 family from QuickTime, and WebM from Matroska", () => {
    const mp4 = header();
    mp4.set(Array.from("ftypisom", (character) => character.charCodeAt(0)), 4);
    expect(detectFileType(mp4)).toEqual({ mime: "video/mp4", extension: "mp4" });

    const quicktime = header();
    quicktime.set(Array.from("ftypqt  ", (character) => character.charCodeAt(0)), 4);
    expect(detectFileType(quicktime)).toEqual({ mime: "video/quicktime", extension: "mov" });

    const webm = header(0x1a, 0x45, 0xdf, 0xa3);
    webm.set(Array.from("webm", (character) => character.charCodeAt(0)), 24);
    expect(detectFileType(webm)).toEqual({ mime: "video/webm", extension: "webm" });

    const matroska = header(0x1a, 0x45, 0xdf, 0xa3);
    matroska.set(Array.from("matroska", (character) => character.charCodeAt(0)), 24);
    expect(detectFileType(matroska)).toBeNull();
  });

  it("refuses to name what it cannot read, whatever the file is called", () => {
    expect(detectFileType(text("#!/bin/sh\necho hi"))).toBeNull();
    expect(detectFileType(text("<svg xmlns=\"http://www.w3.org/2000/svg\">"))).toBeNull();
    expect(detectFileType(text("<!DOCTYPE html>"))).toBeNull();
    expect(detectFileType(text(""))).toBeNull();
  });

  it("does not read a truncated header as a format it cannot hold", () => {
    // Four bytes of a PNG is not a PNG: `bytesEqual` has to check the whole
    // signature, or the shortest prefix would satisfy it.
    expect(detectFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectFileType(Uint8Array.from([]))).toBeNull();
  });
});
