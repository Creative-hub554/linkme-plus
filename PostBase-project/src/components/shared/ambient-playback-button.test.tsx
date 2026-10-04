// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { AmbientPlaybackButton } from "@/components/shared/ambient-playback-button";

/**
 * The one control both carousels carry, tested once here instead of twice
 * through them.
 *
 * What is pinned is the pairing a viewer cannot see and a test can: the glyph is
 * the same either way, so the state has to be said in words — a control reading
 * "Play" while the thing is already playing is a button that appears to do
 * nothing, and pressing it is the only way to start a carousel that a
 * reduced-motion preference opened stopped.
 *
 * `onClick` is asserted through the setter rather than through a rendered flag,
 * because the flip is the component's job: `setPlaying((value) => !value)` is
 * exactly the line it exists to hold once, so the updater it hands over is what
 * makes the button work at all.
 */

/** The control, whatever state it is in. */
function control(ui: MountedSurface) {
  const element = ui.container.querySelector("button");
  if (!element) throw new Error("the button rendered no control");
  return element;
}

/** The component as a caller mounts it, with the switch the test can flip. */
function surface(playing: boolean, setPlaying: (value: boolean) => void) {
  return (
    <AmbientPlaybackButton
      playing={playing}
      setPlaying={setPlaying as unknown as Parameters<typeof AmbientPlaybackButton>[0]["setPlaying"]}
      label="live preview"
    />
  );
}

afterEach(() => {
  cleanupSurfaces();
});

describe("AmbientPlaybackButton", () => {
  test("names the control for what it will do next", async () => {
    const ui = mountSurface(surface(true, () => {}), { providers: "none" });
    expect(control(ui).getAttribute("aria-label")).toBe("Pause live preview");

    // The state it is in is the name's subject: same control, opposite verb.
    await ui.render(surface(false, () => {}));
    expect(control(ui).getAttribute("aria-label")).toBe("Play live preview");
  });

  test("hands the setter an updater that flips whatever the state was", async () => {
    const setPlaying = vi.fn();
    const ui = mountSurface(surface(true, setPlaying), { providers: "none" });

    await ui.click(control(ui));

    // Called with a function, not a value: the control does not know the state
    // it is flipping beyond the one it was handed to render.
    expect(setPlaying).toHaveBeenCalledTimes(1);
    const flip = setPlaying.mock.calls[0][0] as (value: boolean) => boolean;
    expect(flip(true)).toBe(false);
    expect(flip(false)).toBe(true);
  });

  test("hides the glyph, so the name is the words and not the mark", () => {
    const ui = mountSurface(surface(true, () => {}), { providers: "none" });

    // A reader gets "Pause live preview"; the `Ⅱ` beside it would otherwise be
    // read out as well, which is the same sentence twice.
    const glyph = control(ui).querySelector("span");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(control(ui).getAttribute("aria-label")).toBe("Pause live preview");
  });

  test("is never a form's submit button", () => {
    const ui = mountSurface(surface(false, () => {}), { providers: "none" });

    expect(control(ui).getAttribute("type")).toBe("button");
  });
});
