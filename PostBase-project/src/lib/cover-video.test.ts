import { describe, expect, test } from "vitest";
import { describeCoverVideo, parseCoverVideoConfig } from "@/lib/cover-video";

describe("parseCoverVideoConfig", () => {
  test("reads the config the publish route writes", () => {
    const stored = {
      templateId: "aurora-borealis",
      photoUrls: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
      updatedAt: "2026-09-25T00:00:00.000Z",
    };
    expect(parseCoverVideoConfig(stored)).toEqual(stored);
  });

  test("answers null for anything that is not a config object", () => {
    for (const value of [null, undefined, 0, "", "aurora-borealis", [], true]) {
      expect(parseCoverVideoConfig(value)).toBeNull();
    }
  });

  test("drops fields of the wrong type instead of trusting them", () => {
    expect(parseCoverVideoConfig({ templateId: 7, photoUrls: "a.jpg", updatedAt: {} })).toBeNull();
  });

  test("keeps a config that only recorded some of its fields", () => {
    expect(parseCoverVideoConfig({ templateId: "neon-pulse" })).toEqual({ templateId: "neon-pulse" });
    expect(parseCoverVideoConfig({ photoUrls: ["https://cdn.test/a.jpg"] })).toEqual({
      photoUrls: ["https://cdn.test/a.jpg"],
    });
  });

  test("keeps only the picture URLs that are strings", () => {
    expect(parseCoverVideoConfig({ photoUrls: ["https://cdn.test/a.jpg", 3, null] })).toEqual({
      photoUrls: ["https://cdn.test/a.jpg"],
    });
  });

  test("treats empty strings and empty lists as absent, so nothing blank is shown", () => {
    expect(parseCoverVideoConfig({ photoUrls: [], templateId: "", updatedAt: "" })).toBeNull();
  });
});

describe("describeCoverVideo", () => {
  test("names both the pictures and the template", () => {
    expect(describeCoverVideo("Aurora Borealis", 4)).toBe(
      "Made with 4 pictures and the Aurora Borealis template.",
    );
  });

  test("uses the singular for a single picture", () => {
    expect(describeCoverVideo(null, 1)).toBe("Made with 1 picture.");
  });

  test("falls back to a sentence when nothing else is known", () => {
    // This fallback is the only line in the cover editor that says the banner is
    // a video rather than a photo, so it has to read as a sentence.
    expect(describeCoverVideo(null, null)).toBe("Published from Cover Studio.");
    expect(describeCoverVideo(undefined, 0)).toBe("Published from Cover Studio.");
    expect(describeCoverVideo("Neon Pulse", null)).toBe("Made with the Neon Pulse template.");
  });
});
