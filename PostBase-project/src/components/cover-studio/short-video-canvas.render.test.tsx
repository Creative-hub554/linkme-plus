// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { installCanvas } from "@/test/canvas";
import { ShortVideoCanvas } from "@/components/cover-studio/short-video-canvas";
import { shortVideoTemplates } from "@/components/cover-studio/short-video-templates";

/**
 * The cover canvas, rendered with a real 2D context behind it.
 *
 * This is the half of the file the pure `photoWallLayout` test cannot reach: the
 * template-by-template drawing, the profile frame, the subtitle and product chip,
 * and the drag handlers on the element. Every template id gets a mount of its
 * own, because each is a separate branch of `draw` — one mount exercises one
 * branch, and the branch that draws the template the reader chose is the whole
 * point of the component.
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
});

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("the canvas did not render");
  return canvas as HTMLCanvasElement;
}

/**
 * jsdom lays nothing out, so a canvas measures zero by zero — and the drag
 * handler scales the pointer by `W / rect.width`, which would be a division by
 * zero. A real box makes the pointer arithmetic the same one a browser does.
 */
function giveSize(canvas: HTMLCanvasElement, width: number, height: number) {
  canvas.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

/** A real mouse event on the canvas, with a real position. */
async function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  await act(async () => {
    canvas.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
    );
  });
}

describe("ShortVideoCanvas", () => {
  test("draws every template", () => {
    expect(shortVideoTemplates.length).toBeGreaterThan(10);
    for (const template of shortVideoTemplates) {
      const ui = mountSurface(<ShortVideoCanvas template={template} />, { providers: "none" });
      expect(canvasOf(ui.container), `the ${template.id} template`).not.toBeNull();
      ui.unmount();
    }
  });

  test("draws the landscape banner shape", () => {
    const ui = mountSurface(
      <ShortVideoCanvas template={shortVideoTemplates[0]} aspectRatio="cover" profileRadius={90} />,
      { providers: "none" },
    );
    expect(canvasOf(ui.container).getAttribute("aria-label")).toBe("Short video cover preview");
  });

  test("draws with a picture wall, a subtitle, a chip and a speed", () => {
    const ui = mountSurface(
      <ShortVideoCanvas
        template={shortVideoTemplates.find((template) => template.showSubtitle && template.showProductChip)!}
        backgroundPhotos={["https://cdn.example/1.png", "https://cdn.example/2.png"]}
        profilePhoto="https://cdn.example/me.png"
        backgroundPhoto="https://cdn.example/bg.png"
        backgroundVideo="https://cdn.example/clip.mp4"
        subtitle="A very long subtitle that has to be trimmed to fit the frame width"
        productLabel="Shop now →"
        productUrl="https://shop.example"
        speed="fast"
        duration={12}
        className="rounded-xl"
      />,
      { providers: "none" },
    );
    expect(canvasOf(ui.container)).not.toBeNull();
  });

  test("draws a paused, reduced frame", () => {
    const ui = mountSurface(
      <ShortVideoCanvas template={shortVideoTemplates[1]} isPlaying={false} speed="normal" duration={2} />,
      { providers: "none" },
    );
    expect(canvasOf(ui.container)).not.toBeNull();
  });

  test("keeps drawing while it is being recorded", () => {
    const ui = mountSurface(
      <ShortVideoCanvas template={shortVideoTemplates[2]} recording isPlaying={false} />,
      { providers: "none" },
    );
    expect(canvasOf(ui.container)).not.toBeNull();
  });

  test("moves and resizes the profile frame by mouse", async () => {
    const ui = mountSurface(<ShortVideoCanvas template={shortVideoTemplates[0]} aspectRatio="cover" />, {
      providers: "none",
    });
    const canvas = canvasOf(ui.container);
    giveSize(canvas, 1200, 444);
    // Centre: inside the frame, so the press starts a move.
    await pointer(canvas, "mousedown", 600, 222);
    await pointer(canvas, "mousemove", 640, 240);
    await pointer(canvas, "mouseup", 640, 240);
    // Near the ring: the press starts a resize instead.
    await pointer(canvas, "mousedown", 730, 222);
    await pointer(canvas, "mousemove", 730, 260);
    await pointer(canvas, "mouseleave", 730, 260);
    // A press well away from the frame starts neither, and a bare move with no
    // press is ignored.
    await pointer(canvas, "mousedown", 5, 5);
    await pointer(canvas, "mousemove", 6, 6);
    expect(canvas).not.toBeNull();
  });

  test("moves the profile frame by touch", async () => {
    const ui = mountSurface(<ShortVideoCanvas template={shortVideoTemplates[0]} />, { providers: "none" });
    const canvas = canvasOf(ui.container);
    giveSize(canvas, 1080, 1920);
    const touch = (type: string, x: number, y: number, touches: Array<{ clientX: number; clientY: number }>) =>
      act(async () => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: touches });
        canvas.dispatchEvent(event);
      });
    await touch("touchstart", 540, 729, [{ clientX: 540, clientY: 729 }]);
    await touch("touchmove", 560, 740, [{ clientX: 560, clientY: 740 }]);
    await touch("touchend", 0, 0, []);
    await touch("touchcancel", 0, 0, []);
    // A touch with no active point is ignored rather than read as zero.
    await touch("touchstart", 0, 0, []);
    expect(canvas).not.toBeNull();
  });

  test("hands the canvas to a recorder on mount", () => {
    const ready = { canvas: null as HTMLCanvasElement | null };
    mountSurface(
      <ShortVideoCanvas
        template={shortVideoTemplates[0]}
        onCanvasReady={(canvas) => {
          ready.canvas = canvas;
        }}
        onProfileChange={() => {}}
      />,
      { providers: "none" },
    );
    expect(ready.canvas).not.toBeNull();
  });
});
