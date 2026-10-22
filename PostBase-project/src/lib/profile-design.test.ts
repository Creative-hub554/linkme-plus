import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_DESIGN, parseProfileDesign } from "./profile-design";

describe("parseProfileDesign", () => {
  it("accepts the small, public theme shape", () => {
    expect(parseProfileDesign({ layout: "anime", palette: "sakura", cardStyle: "glass", reducedMotion: false })).toEqual({ layout: "anime", palette: "sakura", cardStyle: "glass", reducedMotion: false });
  });

  it("rejects CSS-like or incomplete input rather than persisting it", () => {
    expect(parseProfileDesign({ ...DEFAULT_PROFILE_DESIGN, background: "url(javascript:alert(1))" })).toEqual(DEFAULT_PROFILE_DESIGN);
    expect(parseProfileDesign({ layout: "anything", palette: "sakura", cardStyle: "glass", reducedMotion: false })).toBeNull();
    expect(parseProfileDesign({ layout: "anime", palette: "sakura", cardStyle: "glass" })).toBeNull();
  });
});
