// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { useCarouselRotation } from "./use-carousel-rotation";

/**
 * Where a carousel is, and the two ways it moves — tested once here instead of
 * twice through the two surfaces that use it.
 *
 * What this file deliberately no longer pins is a re-arm: a counter used to live
 * in this hook so a pick could restart the interval already counting down. A pick
 * stops the rotation now, which is the same defect answered a different way, so
 * the counter is gone and the rule that replaced it is pinned where it lives —
 * `use-ambient-carousel.test.tsx`. What is left here is the position: `advance`
 * walks and wraps, `select` shows what it was given.
 *
 * The hook is mounted through a probe rather than called directly, because it
 * holds state and the value has to be read after a click.
 */

/** A surface that shows the position and offers the same two moves the app does. */
function Probe() {
  const { index, advance, select } = useCarouselRotation(3);
  return (
    <>
      <span data-testid="index">{index}</span>
      <button type="button" aria-label="advance" onClick={advance}>
        advance
      </button>
      <button type="button" aria-label="pick 1" onClick={() => select(1)}>
        pick 1
      </button>
      <button type="button" aria-label="pick 2" onClick={() => select(2)}>
        pick 2
      </button>
    </>
  );
}

/** The position the probe is rendering. */
function index(ui: MountedSurface) {
  return ui.container.querySelector('[data-testid="index"]')?.textContent ?? null;
}

afterEach(() => {
  cleanupSurfaces();
});

describe("useCarouselRotation", () => {
  test("advances through the items and wraps at the end", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });
    expect(index(ui)).toBe("0");

    await ui.click(ui.byName("advance"));
    expect(index(ui)).toBe("1");

    await ui.click(ui.byName("advance"));
    expect(index(ui)).toBe("2");

    // Past the last item it comes back round rather than running out.
    await ui.click(ui.byName("advance"));
    expect(index(ui)).toBe("0");
  });

  test("shows the item a viewer picks", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    await ui.click(ui.byName("pick 2"));
    expect(index(ui)).toBe("2");

    // And back down again: a pick is not only ever forward.
    await ui.click(ui.byName("pick 1"));
    expect(index(ui)).toBe("1");
  });
});
