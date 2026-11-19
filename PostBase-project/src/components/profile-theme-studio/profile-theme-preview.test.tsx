// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { ProfileThemePreview, type ProfileThemePreviewIdentity } from "@/components/profile-theme-studio/profile-theme-preview";
import {
  defaultProfileThemeBlocks,
  profileThemeLayouts,
  profileThemeStyles,
  standardProfileThemeConfig,
  type ProfileThemeConfig,
  type ProfileThemeDecoration,
} from "@/lib/profile-theme";

/**
 * The themed preview, rendered into a real document.
 *
 * The preview is what the member judges the theme with, so these are the facts
 * about it that picking depends on: the Standard view is a genuinely different
 * render, identity sits in the layout's own slot in every arrangement, blocks
 * read in position order with excluded blocks gone entirely, decorations pin
 * to their recorded zone, and ambient motion is answered off by the viewer's
 * reduced-motion preference even when the config asks for it.
 */
const identity: ProfileThemePreviewIdentity = {
  name: "Ada Writer",
  username: "ada",
  bio: "Draws panels, writes code.",
  avatarUrl: null,
  location: "Kyoka Metro",
  website: "https://ada.example",
};

const themedConfig: ProfileThemeConfig = {
  layoutId: "classic-spotlight",
  styleId: "sakura-blossom",
  standard: false,
  motion: true,
  blocks: defaultProfileThemeBlocks,
  decorations: [],
};

function themedOf(overrides: Partial<ProfileThemeConfig> = {}): ProfileThemeConfig {
  return { ...themedConfig, ...overrides };
}

function viewOf(container: HTMLElement): HTMLElement {
  const view = container.querySelector<HTMLElement>("[data-theme-view]");
  if (!view) throw new Error("the preview did not render a themed view");
  return view;
}

function mountPreview(config: ProfileThemeConfig, reducedMotion = false) {
  const surface = mountSurface(
    <ProfileThemePreview config={config} identity={identity} reducedMotion={reducedMotion} />,
  );
  return { ...surface, view: viewOf(surface.container) };
}

/** jsdom's rgb form of a `#rrggbb` style value, so style comparisons survive serializing. */
function rgbOf(hex: string): string {
  const raw = /^#([0-9a-f]{6})$/i.exec(hex)![1]!;
  return [0, 2, 4]
    .map((offset) => parseInt(raw.slice(offset, offset + 2), 16))
    .join(", ");
}

afterEach(() => {
  cleanupSurfaces();
});

describe("the Standard view", () => {
  test("is a different render: the plain card, with the safety row it always had", () => {
    const { view } = mountPreview({ ...standardProfileThemeConfig, standard: true });

    expect(view.getAttribute("data-theme-view")).toBe("standard");
    // Standard content is identity as the profile defines it — no palette, no
    // motif, no block tiles.
    expect(view.textContent).toContain("Ada Writer");
    expect(view.querySelector("[data-standard-banner]")).not.toBeNull();
    expect(view.querySelector("[data-theme-fixed='safety']")).not.toBeNull();
  });
});

describe("every layout keeps identity and safety fixed", () => {
  for (const layout of profileThemeLayouts) {
    test(`${layout.name} renders an identity zone and the safety controls`, () => {
      const { view } = mountPreview(themedOf({ layoutId: layout.id }));

      expect(view.getAttribute("data-theme-view")).toBe("themed");
      const identityZone = view.querySelector<HTMLElement>("[data-theme-fixed='identity']");
      expect(identityZone, `${layout.id} has the fixed identity zone`).not.toBeNull();
      expect(identityZone!.textContent).toContain("Ada Writer");
      expect(identityZone!.textContent).toContain("@ada");
      // The safety row is drawn after everything the member arranged: at the
      // edge of the card, not inside a block.
      expect(view.lastElementChild!.getAttribute("data-theme-fixed")).toBe("safety");
    });
  }
});

describe("blocks", () => {
  test("read in position order, not array order", () => {
    const blocks = [
      { id: "links" as const, included: true, position: 2 },
      { id: "highlights" as const, included: false, position: 0 },
      { id: "interests" as const, included: true, position: 1 },
    ];
    const { view } = mountPreview(themedOf({ blocks }));

    // Highlights is excluded, so nothing renders its label at all.
    expect(view.textContent).not.toContain("Highlights");
    // Each included block's sample content appears, with the interests block's
    // chips *before* the links block's website — position 1 before position 2,
    // though the array lists links first.
    expect(view.textContent).toContain("Photography");
    expect(view.textContent).toContain("https://ada.example");
    expect(view.textContent!.indexOf("Photography")).toBeLessThan(
      view.textContent!.indexOf("https://ada.example"),
    );
  });

  test("an excluded block renders nothing, not a placeholder", () => {
    const blocks = defaultProfileThemeBlocks.filter((placement) => placement.id !== "quote");
    const { view } = mountPreview(themedOf({ blocks: blocks.map((placement) => ({ ...placement, position: blocks.indexOf(placement) })) }));

    expect(view.textContent).not.toContain("One line about what you do");
  });

  test("with no blocks included the preview says so instead of going blank", () => {
    const blocks = defaultProfileThemeBlocks.map((placement) => ({ ...placement, included: false }));
    const { view } = mountPreview(themedOf({ blocks }));

    expect(view.textContent).toContain("No blocks selected yet.");
  });

  test("the quote block borrows the member's one line", () => {
    const blocks = defaultProfileThemeBlocks.map((placement) =>
      placement.id === "quote" ? { ...placement, included: true } : placement,
    );
    const { view } = mountPreview(themedOf({ blocks }));

    expect(view.textContent).toContain(identity.bio!);
  });
});

describe("decorations", () => {
  test("render hidden from the reader, pinned to the recorded zone", () => {
    const decorations: ProfileThemeDecoration[] = [
      { id: "deco-a", url: "https://test.r2.dev/petal.png", zone: "corner-bottom-left" },
    ];
    const { container } = mountPreview(themedOf({ decorations }));

    const img = container.querySelector<HTMLImageElement>("[data-decoration-zone]");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("data-decoration-zone")).toBe("corner-bottom-left");
    expect(img!.getAttribute("alt")).toBe("");
    expect(img!.getAttribute("aria-hidden")).toBe("true");
  });

  test("an unknown zone degrades to the default corner rather than off-card", () => {
    const decorations: ProfileThemeDecoration[] = [
      { id: "deco-b", url: "https://test.r2.dev/star.png", zone: "corner-top-left" },
    ];
    const { container } = mountPreview(themedOf({ decorations }));
    const img = container.querySelector<HTMLImageElement>("[data-decoration-zone]");
    expect(img!.className).toContain("left-2");
  });
});

describe("the motion safeguard", () => {
  test("the view answers on only when the config, style and viewer all agree", () => {
    const { view: on } = mountPreview(themedOf({ motion: true }));
    expect(on.getAttribute("data-theme-motion")).toBe("on");
  });

  test("the viewer's reduced-motion preference wins over the config's request", () => {
    const { view } = mountPreview(themedOf({ motion: true }), true);
    expect(view.getAttribute("data-theme-motion")).toBe("off");
  });

  test("a still style ships no motion even with the switch on", () => {
    // manga-ink is motionCapable: false.
    expect(profileThemeStyles.find((style) => style.id === "manga-ink")?.motionCapable).toBe(false);
    const { view } = mountPreview(themedOf({ styleId: "manga-ink", motion: true }));
    expect(view.getAttribute("data-theme-motion")).toBe("off");
  });
});

describe("the style's colors", () => {
  test("reach the card and the block surfaces from the shared palette", () => {
    const { view } = mountPreview(themedOf({ styleId: "manga-ink" }));
    const style = profileThemeStyles.find((candidate) => candidate.id === "manga-ink")!;
    // jsdom serializes a backgroundColor to `rgb(…)`, so compare it that way.
    expect(view.style.backgroundColor).toBe(
      `rgb(${rgbOf(style.colors.bg)})`,
    );
  });

  test("an id nothing ships renders a still-readable fallback rather than crashing", () => {
    // Defense in depth: the config was validated upstream, but the component
    // is the last line — an unbuilt id degrades to the first layout's
    // arrangement instead of taking the tab down.
    const haunted = themedOf({ layoutId: "ghost-layout" as unknown as ProfileThemeConfig["layoutId"] });
    const { view } = mountPreview(haunted);

    expect(view.getAttribute("data-theme-view")).toBe("themed");
    expect(view.getAttribute("data-theme-layout")).toBe("over-banner");
    expect(view.textContent).toContain("Ada Writer");
  });
});
