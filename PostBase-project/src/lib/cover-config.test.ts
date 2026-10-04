import { describe, expect, it } from "vitest";
import { coverConfigPhotoUrls } from "./cover-config";

/**
 * The one thing the cover removal paths ask of an untyped JSONB column: which
 * stored objects does this config point at?
 *
 * It is the record of the photos a replaced or removed animated cover held, so
 * getting it wrong either leaves objects in the bucket or — worse — offers a
 * non-string to `deleteStoredObjects`. Everything that is not an array of
 * strings must read as "no photos" rather than throwing inside a delete that
 * runs after the row is already committed.
 */
describe("coverConfigPhotoUrls", () => {
  it("returns the photo URLs a saved config holds, in order", () => {
    expect(
      coverConfigPhotoUrls({
        templateId: "aurora-waves",
        photos: ["https://test.r2.dev/covers/a/1.png", "https://test.r2.dev/covers/a/2.png"],
        backgroundPhoto: "https://test.r2.dev/covers/a/1.png",
      }),
    ).toEqual(["https://test.r2.dev/covers/a/1.png", "https://test.r2.dev/covers/a/2.png"]);
  });

  it("keeps only the strings when the list is mixed", () => {
    // JSONB is whatever was written, and a hand-edited or older config may hold
    // a null or a number where a URL belongs.
    expect(coverConfigPhotoUrls({ photos: ["https://test.r2.dev/a.png", null, 7, ""] })).toEqual([
      "https://test.r2.dev/a.png",
    ]);
  });

  it("reports no photos for anything that is not a config", () => {
    for (const value of [null, undefined, "photos", 42, ["https://test.r2.dev/a.png"]]) {
      expect(coverConfigPhotoUrls(value)).toEqual([]);
    }
  });

  it("reports no photos when the config has none", () => {
    // The state a text-only config save leaves behind, and the one a fresh cover
    // starts from: nothing to delete, not an error.
    expect(coverConfigPhotoUrls({ templateId: "aurora-waves" })).toEqual([]);
    expect(coverConfigPhotoUrls({ photos: [] })).toEqual([]);
    expect(coverConfigPhotoUrls({ photos: "not-an-array" })).toEqual([]);
  });
});
