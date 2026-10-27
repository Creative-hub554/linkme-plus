import { describe, expect, it } from "vitest";

/**
 * The shared theme model.
 *
 * What these tests pin is the contract the editor and the save route both sit
 * on: the id lists are disjoint and looked up uniformly, every shipped style
 * passes the contrast floors the safeguard enforces (so the editor never has to
 * hide one), decorations cannot exceed a cap, and a config that came from
 * outside the compiler is either the exact shape the renderers consume or
 * `null` — never a half-validated object with an id the pickers cannot find.
 */
import {
  contrastRatio,
  defaultProfileThemeBlocks,
  isProfileThemeStyleAvailable,
  normalizeProfileThemeConfig,
  orderedProfileThemeBlocks,
  PROFILE_THEME_CONTRAST_FLOOR_LARGE,
  PROFILE_THEME_CONTRAST_FLOOR_TEXT,
  profileThemeBlockById,
  profileThemeBlocks,
  profileThemeDecorationZoneById,
  profileThemeDecorationZones,
  profileThemeLayoutById,
  profileThemeLayouts,
  profileThemeStyleById,
  profileThemeStyles,
  profileThemeStyleContrast,
  relativeLuminance,
  standardProfileThemeConfig,
} from "@/lib/profile-theme";

describe("the model's id lists", () => {
  it("give every layout, style, block and zone one id, with a uniform lookup", () => {
    const everyId = [
      ...profileThemeLayouts.map((entry) => entry.id),
      ...profileThemeStyles.map((entry) => entry.id),
      ...profileThemeBlocks.map((entry) => entry.id),
      ...profileThemeDecorationZones.map((entry) => entry.id),
    ];

    expect(new Set(everyId).size).toBe(
      profileThemeLayouts.length + profileThemeStyles.length + profileThemeBlocks.length + profileThemeDecorationZones.length,
    );
  });

  it("looks a layout up by id, and nothing for an id no layout ships", () => {
    expect(profileThemeLayoutById("gallery-fan")?.name).toBe("Gallery Fan");
    expect(profileThemeLayoutById("no-such-layout")).toBeUndefined();
  });

  it("looks a style up by id, and nothing for an id no style ships", () => {
    expect(profileThemeStyleById("sakura-blossom")?.motif).toBe("petals");
    expect(profileThemeStyleById("licensed-character-pack")).toBeUndefined();
  });

  it("looks a block up by id", () => {
    expect(profileThemeBlockById("quote")?.name).toBe("Quote");
    expect(profileThemeBlockById("timeline")).toBeUndefined();
  });

  it("looks a decoration zone up by id, and nothing outside the safe zones", () => {
    expect(profileThemeDecorationZoneById("corner-top-left")).toBe("corner-top-left");
    expect(profileThemeDecorationZoneById("over-identity")).toBeUndefined();
  });
});

describe("the contrast safeguard", () => {
  it("computes the same ratio WCAG does for known pairs", () => {
    // Black on white is the textbook maximum.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("answers null for a color that is not a hex triplet, rather than guessing", () => {
    expect(contrastRatio("#ff0", "#000000")).toBeNull();
    expect(contrastRatio("#000000", "steelblue")).toBeNull();
    expect(relativeLuminance("#12345")).toBeNull();
  });

  it("computes all four ratios for every shipped style", () => {
    for (const style of profileThemeStyles) {
      const contrast = profileThemeStyleContrast(style);
      expect(contrast, `${style.id} has four usable ratios`).not.toBeNull();
      expect(contrast!.textOnBg).toBeGreaterThan(0);
      expect(contrast!.textOnSurface).toBeGreaterThan(0);
      expect(contrast!.mutedOnSurface).toBeGreaterThan(0);
      expect(contrast!.accentOnSurface).toBeGreaterThan(0);
    }
  });

  it("every shipped style passes its floors, so the editor offers all of them", () => {
    for (const style of profileThemeStyles) {
      expect(isProfileThemeStyleAvailable(style), `${style.name} is readable on its own colors`).toBe(true);
    }
  });

  it("refuses a style whose body text cannot reach the AA floor", () => {
    const failing = {
      ...profileThemeStyles[0]!,
      name: "Halfway Red",
      // Mid-grey text on a mid-grey surface: no pair here reaches 4.5:1.
      colors: { bg: "#808080", surface: "#808080", text: "#909090", muted: "#ffffff", accent: "#ffffff" },
    };
    expect(isProfileThemeStyleAvailable(failing)).toBe(false);
  });

  it("the floors are the WCAG pairs the feature promises", () => {
    expect(PROFILE_THEME_CONTRAST_FLOOR_TEXT).toBe(4.5);
    expect(PROFILE_THEME_CONTRAST_FLOOR_LARGE).toBe(3);
  });
});

describe("block placement order", () => {
  it("renders by position, not by array order", () => {
    const scrambled = [
      { id: "interests" as const, included: true, position: 2 },
      { id: "highlights" as const, included: false, position: 0 },
      { id: "links" as const, included: true, position: 1 },
    ];
    const ordered = orderedProfileThemeBlocks({ ...standardProfileThemeConfig, blocks: scrambled });
    expect(ordered.map((placement) => placement.id)).toEqual(["highlights", "links", "interests"]);
  });

  it("the default list covers every block once, positions 0…n-1", () => {
    expect(defaultProfileThemeBlocks).toHaveLength(profileThemeBlocks.length);
    const ids = new Set(defaultProfileThemeBlocks.map((placement) => placement.id));
    expect(ids.size).toBe(profileThemeBlocks.length);
    expect(defaultProfileThemeBlocks.map((placement) => placement.position)).toEqual(
      profileThemeBlocks.map((_, index) => index),
    );
  });
});

describe("normalizeProfileThemeConfig", () => {
  /** A valid config to perturb from, built from the model's own ids. */
  const valid = {
    layoutId: profileThemeLayouts[0]!.id,
    styleId: profileThemeStyles[0]!.id,
    standard: false,
    motion: true,
    blocks: defaultProfileThemeBlocks,
    decorations: [
      { id: "deco-1", url: "https://test.r2.dev/profiles/member-1/petal.png", zone: "corner-top-right" },
    ],
  };

  it("accepts a well-formed config unchanged", () => {
    expect(normalizeProfileThemeConfig(valid)).toEqual(valid);
  });

  it("accepts the Standard view: the theme off with defaults beneath", () => {
    expect(normalizeProfileThemeConfig(standardProfileThemeConfig)).toEqual(standardProfileThemeConfig);
  });

  it.each([
    ["nothing at all", null],
    ["a string", "theme"],
    ["an unknown layout", { ...valid, layoutId: "floating-layout" }],
    ["an unknown style", { ...valid, styleId: "licensed-pack" }],
    ["a missing standard flag", { ...valid, standard: undefined }],
    ["a motion flag that is not a boolean", { ...valid, motion: "yes" }],
    ["blocks that are not a list", { ...valid, blocks: true }],
    ["a block the model does not ship", { ...valid, blocks: [...defaultProfileThemeBlocks, { id: "calendar", included: true, position: 5 }] }],
    ["a duplicated block", { ...valid, blocks: [{ ...defaultProfileThemeBlocks[0]!, included: false }, { ...defaultProfileThemeBlocks[4]!, id: "highlights" }] }],
    ["positions that are not 0…n-1", { ...valid, blocks: defaultProfileThemeBlocks.map((placement) => ({ ...placement, position: placement.position + 1 })) }],
    ["a missing position", { ...valid, blocks: defaultProfileThemeBlocks.map((placement) => ({ ...placement, position: undefined })) }],
    ["a decoration over the cap", { ...valid, decorations: Array.from({ length: 7 }, (_, index) => ({ id: `deco-${index}`, url: "https://test.r2.dev/a.png", zone: "corner-top-left" })) }],
    ["a decoration with an unlisted zone", { ...valid, decorations: [{ id: "deco-x", url: "https://test.r2.dev/a.png", zone: "over-identity" }] }],
    ["a decoration with a duplicated id", { ...valid, decorations: [{ id: "deco-dup", url: "https://test.r2.dev/a.png", zone: "corner-top-left" }, { id: "deco-dup", url: "https://test.r2.dev/b.png", zone: "corner-top-left" }] }],
    ["a decoration with a protocol-less url", { ...valid, decorations: [{ id: "deco-y", url: "petal.png", zone: "corner-top-left" }] }],
    ["a decoration with an over-long url", { ...valid, decorations: [{ id: "deco-y", url: `https://test.r2.dev/${"a".repeat(3000)}`, zone: "corner-top-left" }] }],
    ["a staged decoration that never became an upload", { ...valid, decorations: [{ id: "deco-z", url: null, zone: "corner-top-left" }] }],
  ])("answers null for %s", (_name, value) => {
    expect(normalizeProfileThemeConfig(value)).toBeNull();
  });

  it("validates without mutating the input", () => {
    const input = { ...valid, decorations: [...valid.decorations, { id: "deco-w", url: "petal.png", zone: "corner-top-left" }] };
    expect(normalizeProfileThemeConfig(input)).toBeNull();
    expect(input.decorations).toHaveLength(2);
  });
});
