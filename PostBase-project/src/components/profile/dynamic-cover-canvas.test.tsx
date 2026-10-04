// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { installCanvas } from "@/test/canvas";
import { DynamicCoverCanvas, type DynamicCoverConfig } from "@/components/profile/dynamic-cover-canvas";

/**
 * The animated profile cover, rendered with a real 2D context behind it.
 *
 * The geometry inside `draw` is chosen from the frame's width — a phone shows a
 * narrower, differently placed portrait than a desktop — so the two layouts are
 * separate cases, each mounting under a different measured box. The rest of the
 * branches are the config's: the palette default, the photos present or absent,
 * the motion direction and animation, the neon effect, and the identity copy.
 */
let uninstall: () => void;

beforeAll(() => {
  uninstall = installCanvas();
});

afterAll(() => {
  uninstall();
});

afterEach(() => {
  cleanupSurfaces();
  vi.restoreAllMocks();
});

const fullConfig: DynamicCoverConfig = {
  templateId: "motion-wall",
  mode: "group",
  title: "Creative Builders",
  subtitle: "Make things",
  photos: ["https://cdn.example/1.png", "https://cdn.example/2.png", "https://cdn.example/3.png"],
  colorPalette: ["#071426", "#163b68", "#2563eb"],
  profile: { enabled: true, position: "center", shape: "circle" },
  motion: { rows: 8, speed: 3, direction: "left", transition: "fade", animation: "wave" },
  effect: "neon",
  backgroundPhoto: "https://cdn.example/bg.png",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

/** Measures the canvas as a browser would, per layout. */
function measure(width: number, height: number, run: () => void) {
  const original = HTMLCanvasElement.prototype.getBoundingClientRect;
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  try {
    run();
  } finally {
    HTMLCanvasElement.prototype.getBoundingClientRect = original;
  }
}

function label(container: HTMLElement): string | null {
  return container.querySelector("canvas")?.getAttribute("aria-label") ?? null;
}

describe("DynamicCoverCanvas", () => {
  test("draws the desktop layout with a full config", () => {
    measure(1200, 450, () => {
      const ui = mountSurface(
        <DynamicCoverCanvas
          config={fullConfig}
          label="Creative Builders"
          username="@maya"
          bio="Designer and maker of small delightful things"
          avatarUrl="https://cdn.example/me.png"
        />,
        { providers: "none" },
      );
      expect(label(ui.container)).toBe("Creative Builders animated cover");
    });
  });

  test("draws the phone layout with a full config", () => {
    measure(390, 320, () => {
      const ui = mountSurface(
        <DynamicCoverCanvas
          config={fullConfig}
          label="Creative Builders"
          username="maya"
          bio="Designer"
          avatarUrl={null}
        />,
        { providers: "none" },
      );
      expect(ui.container.querySelector("canvas")).not.toBeNull();
    });
  });

  test("draws with every field absent", () => {
    measure(800, 400, () => {
      const ui = mountSurface(<DynamicCoverCanvas config={{}} label="A stranger" />, { providers: "none" });
      expect(label(ui.container)).toBe("A stranger animated cover");
    });
  });

  test("draws a non-neon effect with an alternate direction", () => {
    measure(900, 420, () => {
      const ui = mountSurface(
        <DynamicCoverCanvas
          config={{
            ...fullConfig,
            effect: "plain",
            motion: { rows: 1, direction: "alternate", animation: "smooth", speed: 0 },
          }}
          label="One row"
        />,
        { providers: "none" },
      );
      expect(ui.container.querySelector("canvas")).not.toBeNull();
    });
  });

  test("honours a reduced-motion preference", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      ((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia,
    );
    measure(800, 400, () => {
      const ui = mountSurface(
        <DynamicCoverCanvas config={fullConfig} label="Still" username="maya" bio="Hi" />,
        { providers: "none" },
      );
      expect(ui.container.querySelector("canvas")).not.toBeNull();
    });
  });

  test("draws a single-photo config", () => {
    measure(800, 400, () => {
      const ui = mountSurface(
        <DynamicCoverCanvas
          config={{ ...fullConfig, photos: ["https://cdn.example/only.png"], colorPalette: [] }}
          label="Solo"
          username="@maya"
        />,
        { providers: "none" },
      );
      expect(ui.container.querySelector("canvas")).not.toBeNull();
    });
  });
});
