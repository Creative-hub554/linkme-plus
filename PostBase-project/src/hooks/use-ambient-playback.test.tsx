// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { useAmbientPlayback } from "./use-ambient-playback";

/**
 * The rule the landing preview and the sign-in visual both depend on, tested once
 * here instead of twice through them.
 *
 * What it settles is the *division of authority*: the system's motion preference
 * decides the opening state, and the viewer's own play control overrules it. Both
 * surfaces had this backwards — the preference was checked inside their interval, so
 * a viewer who had asked for reduced motion got a motionless card under a button
 * reading "Pause …", and pressing it did nothing. A copy of that rule is a place for
 * the two to drift apart again, so it is pinned at its one definition.
 *
 * The hook is mounted through a probe rather than called directly: it holds state and
 * reads the preference in an effect, so a direct call would read the value from
 * before the effect ran. There is no clock here — the hook owns no timer; the cadence
 * belongs to whoever is animating.
 */

/** A surface that shows the flag and offers the viewer the same toggle the app does. */
function Probe() {
  const [playing, setPlaying] = useAmbientPlayback();
  return (
    <>
      <span data-testid="playing">{String(playing)}</span>
      <button type="button" aria-label="toggle playback" onClick={() => setPlaying(!playing)}>
        toggle
      </button>
    </>
  );
}

/** The flag the probe is rendering. */
function playing(ui: ReturnType<typeof mountSurface>) {
  return ui.container.querySelector('[data-testid="playing"]')?.textContent ?? null;
}

/**
 * A `matchMedia` the test can flip, so a preference that changes *during* a visit is
 * drivable rather than only the one a mount happens to see. `setup.ts` stubs
 * `matchMedia` with `matches: false`, which is the no-preference case.
 */
function stubReducedMotion(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  vi.spyOn(window, "matchMedia").mockImplementation(
    ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia,
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  cleanupSurfaces();
  vi.restoreAllMocks();
});

describe("useAmbientPlayback", () => {
  test("starts moving when the system asks for nothing in particular", () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    expect(playing(ui)).toBe("true");
  });

  test("starts stopped when the system asks for reduced motion", () => {
    stubReducedMotion(true);
    const ui = mountSurface(<Probe />, { providers: "none" });

    expect(playing(ui)).toBe("false");
  });

  test("stops what is already moving when the preference is turned on", async () => {
    const motion = stubReducedMotion(false);
    const ui = mountSurface(<Probe />, { providers: "none" });
    expect(playing(ui)).toBe("true");

    // A real browser event, so it arrives outside React's event system; `act` is
    // what lets the committed flag be read.
    await act(async () => {
      motion.set(true);
    });

    expect(playing(ui)).toBe("false");
  });

  test("lets the viewer start it under a preference that would keep it still", async () => {
    stubReducedMotion(true);
    const ui = mountSurface(<Probe />, { providers: "none" });
    expect(playing(ui)).toBe("false");

    // The whole point: the preference picks the opening state and then yields. An
    // earlier version refused this, which made the play control a lie.
    await ui.click(ui.byName("toggle playback"));

    expect(playing(ui)).toBe("true");
  });
});
