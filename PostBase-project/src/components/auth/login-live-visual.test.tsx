// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { LoginLiveVisual } from "@/components/auth/login-live-visual";

/**
 * The sign-in page's live visual cycles three scenes on a timer behind a play/pause
 * control. `login-page.test.tsx` stubs it out — it is the page's routing that file
 * is about — so until this file the control itself was untested, and the defect this
 * pins was invisible from the page: the cycle's reduced-motion guard sat inside the
 * interval, so a viewer whose system asks for reduced motion got a motionless card
 * under a button reading *"Pause live visual"*, and pressing it did nothing at all,
 * because the interval refused to run regardless of the control. Picking a scene is
 * the other half of taking control: it stops the cycle where the viewer put it, so
 * the standing cadence cannot replace the scene a moment later — and the play button,
 * not the dots, is how the cycle starts again.
 *
 * The clock is what this needs, so the tests drive a fake one: the scenes advance on
 * a 4.2s interval, and the assertions read the scene title a viewer sees rather than
 * the component's state. The motion preference is stubbed, including a change
 * *during* a visit, which is the branch nothing else in the app can reach.
 *
 * The card's copy is swapped in place, which a screen reader cannot hear, so the
 * file also pins the live region that says *where* the cycle moved to — the same
 * shape the landing preview uses — including that it falls silent while the cycle
 * is paused.
 */

/** The scene the visual is showing, as it is drawn on the card. */
function scene(ui: MountedSurface) {
  return ui.container.querySelector("p")?.textContent?.trim() ?? null;
}

/**
 * The name the strip gives a scene's dot: the scene it switches to, not where it
 * sits in the row.
 *
 * Spelled as the rule rather than as three literals, so the assertions read as
 * "this dot is named for that scene" — and so a dot that went back to a positional
 * name fails out of `byName` rather than passing against a rewritten literal. The
 * quotes are typographic because a straight one would not survive being built into
 * the attribute selector `byName` uses.
 */
function sceneDot(title: string) {
  return `Show “${title}”`;
}

/**
 * What the visual speaks when the cycle moves, read off the live region.
 *
 * A live region is the whole of what a screen reader hears here — the card's copy
 * is swapped in place, which is silent — so this is the assertion that the change
 * is announced at all, and that it is announced without being drawn.
 */
function announcement(ui: MountedSurface) {
  const region = ui.container.querySelector('[role="status"]');
  if (!region) throw new Error("the visual rendered no live region");
  return {
    live: region.getAttribute("aria-live"),
    hidden: region.className.includes("sr-only"),
    text: region.textContent?.trim() ?? "",
  };
}

/**
 * Advances the mocked clock inside `act`, so React commits whatever the timer
 * changed before the assertion reads it. `settle`/`waitFor` from the harness are
 * real-timer waits and would hang against a fake clock, which is why this is
 * spelled out here rather than reused.
 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * A `matchMedia` the test can flip, so a preference that changes *during* a visit is
 * drivable rather than only the one a mount happens to see. `setup.ts` stubs
 * `matchMedia` with `matches: false`, which is the no-preference case below.
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Unmount first (the harness's own teardown asserts nothing leaked), then put the
  // real clock and the real `matchMedia` back so the next test is unaffected.
  cleanupSurfaces();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LoginLiveVisual", () => {
  test("cycles the scenes on its own, on its own 4.2s beat", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });
    expect(scene(ui)).toBe("New ideas are taking shape.");

    // The beat is the visual's to supply now that the clock is shared, so it is
    // pinned to the millisecond: 4199ms shows the same scene, one more moves it.
    await advance(4199);
    expect(scene(ui)).toBe("New ideas are taking shape.");

    await advance(1);
    expect(scene(ui)).toBe("Find your people.");

    // And it keeps walking them: 2 -> 3 -> 1.
    await advance(4200);
    expect(scene(ui)).toBe("Make something meaningful.");

    // The third scene wraps back to the first rather than running out.
    await advance(4200);
    expect(scene(ui)).toBe("New ideas are taking shape.");
  });

  test("names its scene strip, and says which scene is showing", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    // The label has to sit on something that can carry one: on a plain `div` an
    // `aria-label` is ignored, which is how this strip had no name at all.
    expect(
      ui.container.querySelector('[aria-label="Live visual scenes"]')?.getAttribute("role"),
    ).toBe("group");

    const current = () =>
      ui.container.querySelector('[role="group"] [aria-current="true"]')?.getAttribute("aria-label");
    // Named for the scene it switches to, not its place in the row — the same way
    // the landing page's strip names its dots, so neither reads as "scene 2".
    expect(current()).toBe(sceneDot("New ideas are taking shape."));

    // The chosen scene is drawn as a colour, so the strip has to say it too — and
    // it has to move with the scene rather than staying on the first one.
    await advance(4200);
    expect(current()).toBe(sceneDot("Find your people."));
  });

  test("stops the cycle when a scene is picked, so no cadence is left to replace the choice", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    // Pick half way to the first tick — the moment a standing cadence is most wrong
    // about a scene the viewer has just asked for.
    await advance(2100);
    await ui.click(ui.byName(sceneDot("Make something meaningful.")));
    expect(scene(ui)).toBe("Make something meaningful.");

    // Two whole intervals with the clock stopped, the first of them well past the
    // tick the old cadence was counting down to: what is showing is the viewer's
    // scene, not the one the timer was on its way to.
    await advance(9000);
    expect(scene(ui)).toBe("Make something meaningful.");

    // And the play control is the way back, wrapping 3 -> 1.
    await ui.click(ui.byName("Play live visual"));
    await advance(4200);
    expect(scene(ui)).toBe("New ideas are taking shape.");
  });

  test("stops the cycle when a scene is walked to with the arrow keys, not only clicked", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    await advance(2100);
    // The keyboard reaches the same pick through the same `select`, so it stops the
    // cycle the same way a click does.
    await ui.press(ui.byName(sceneDot("New ideas are taking shape.")), "ArrowRight");
    expect(scene(ui)).toBe("Find your people.");

    await advance(9000);
    expect(scene(ui)).toBe("Find your people.");
    // `byName` throws when no control answers to the name, which is the assertion:
    // the control now offers to start the cycle again.
    ui.byName("Play live visual");
  });

  test("opens paused when the system asks for reduced motion, and plays when asked", async () => {
    stubReducedMotion(true);
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    // The control says what the visual is doing, so a viewer is not left looking at a
    // still card under a button that claims it is already playing. `byName` throws
    // when no control answers to that name, which is the assertion.
    ui.byName("Play live visual");
    expect(scene(ui)).toBe("New ideas are taking shape.");

    await advance(12600);
    expect(scene(ui)).toBe("New ideas are taking shape.");

    // Pressing play is the viewer asking for the motion, and they get it.
    await ui.click(ui.byName("Play live visual"));
    await advance(4200);
    expect(scene(ui)).toBe("Find your people.");
  });

  test("stops the rotation when the preference is turned on mid-visit", async () => {
    const motion = stubReducedMotion(false);
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    await advance(2100);
    expect(scene(ui)).toBe("New ideas are taking shape.");

    // The listener is a real browser event, so it arrives outside React's event
    // system; wrapping it in `act` is what lets the committed button be read.
    await act(async () => {
      motion.set(true);
    });
    ui.byName("Play live visual");

    // Whatever scene it was on stays put: the preference is honoured from now on,
    // not only at mount.
    await advance(12600);
    expect(scene(ui)).toBe("New ideas are taking shape.");
  });

  test("holds the scene while paused, and picks the cadence up again on play", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    await advance(2100);
    await ui.click(ui.byName("Pause live visual"));
    expect(scene(ui)).toBe("New ideas are taking shape.");

    // Three whole intervals with the clock stopped: nothing moves.
    await advance(12600);
    expect(scene(ui)).toBe("New ideas are taking shape.");

    await ui.click(ui.byName("Play live visual"));
    await advance(4200);
    expect(scene(ui)).toBe("Find your people.");
  });

  test("says where the cycle moved to, rather than leaving the change silent", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    const first = announcement(ui);
    expect(first.live).toBe("polite");
    // Spoken, never drawn: a status line on the card would be a design change.
    expect(first.hidden).toBe(true);
    expect(first.text).toBe("Scene 1 of 3: New ideas are taking shape.");

    await advance(4200);
    expect(announcement(ui).text).toBe("Scene 2 of 3: Find your people.");
  });

  test("announces the scene a viewer picks, and goes quiet once the pick stops it", async () => {
    const ui = mountSurface(<LoginLiveVisual />, { providers: "none" });

    await ui.click(ui.byName(sceneDot("Make something meaningful.")));
    expect(announcement(ui).text).toBe("Scene 3 of 3: Make something meaningful.");

    // The pick stopped the cycle, so nothing changes from here and nothing is said:
    // without that, a reader would keep hearing the same scene read back.
    const held = announcement(ui).text;
    await advance(12600);
    expect(announcement(ui).text).toBe(held);
  });
});
