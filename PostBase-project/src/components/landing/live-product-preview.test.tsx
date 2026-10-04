// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { LiveProductPreview } from "@/components/landing/live-product-preview";
import { shortVideoTemplates } from "@/components/cover-studio/short-video-templates";

/**
 * The landing page's live preview is an autoplaying carousel with a pause button
 * and a strip of slide dots, and until this file it had no test at all — the
 * one place its three controls meet is the clock, which is exactly what a
 * render-to-a-string test cannot see.
 *
 * The clock is the subject. The preview advances on a single `setInterval`, so
 * the interesting question is not "does it advance?" but "whose cadence is it
 * on?" — and the bug this pins is that a slide a viewer clicked could be
 * replaced a fraction of a second later, because picking a dot left the interval
 * counting down towards something the viewer had not asked for. It is answered by
 * stopping rather than by re-arming: a pick is the viewer taking control, so the
 * rotation stops where they put it and the play control is the way back.
 * `vi.useFakeTimers` is what makes that measurable — the test can stop time half
 * way to a tick, click a dot, and then step past the tick the old cadence would
 * have fired on, to see that nothing fires at all.
 *
 * The surface is mounted through the real harness (`mountSurface`), so the
 * assertions read the name a viewer sees and the dot that announces itself as
 * current rather than the component's internal state. The motion preference is
 * stubbed (it is what picks the opening state), including a change *during* a
 * visit, which is the branch nothing else in the app could exercise.
 */

/** The slide the preview is showing, as it is drawn on the card. */
function showing(ui: MountedSurface) {
  const strip = ui.container.querySelector('[role="group"][aria-label="Live preview slides"]');
  if (!strip) throw new Error("the slide strip was not rendered");
  const card = strip.previousElementSibling as HTMLElement | null;
  return card?.querySelector("p")?.textContent?.trim() ?? null;
}

/** The dot that announces itself as the current slide, by the name it answers to. */
function currentDot(ui: MountedSurface) {
  return (
    ui.container.querySelector('[role="group"] [aria-current="true"]')?.getAttribute("aria-label") ??
    null
  );
}

/**
 * What the carousel speaks when the preview moves, read off the live region.
 *
 * A live region is the whole of what a screen reader hears here — the card's
 * text is swapped in place, which is silent — so this is the assertion that the
 * change is announced at all, and that it is announced without being drawn.
 */
function announcement(ui: MountedSurface) {
  const region = ui.container.querySelector('[role="status"]');
  if (!region) throw new Error("the carousel rendered no live region");
  return {
    live: region.getAttribute("aria-live"),
    hidden: region.className.includes("sr-only"),
    text: region.textContent?.trim() ?? "",
  };
}

/**
 * The "Style NN / NN · id" readout for the template drawn beside the slide.
 *
 * The style cycle is the second thing on the preview's beat: it is derived from
 * the shared clock's `beats`, and until this it was the one part of the cadence a
 * consumer test could not see advance. Read from the drawn line rather than from
 * any state, so it is the number a viewer watches go round.
 */
function styleLine(ui: MountedSurface) {
  const line = [...ui.container.querySelectorAll("div")]
    .map((element) => element.textContent?.trim() ?? "")
    .find((text) => /^Style \d\d \/ \d+ ·/.test(text));
  return line ?? null;
}

/** How that line reads for the template at `index`, so a beat can be spelled exactly. */
function styleLineAt(index: number) {
  return `Style ${String(index + 1).padStart(2, "0")} / ${shortVideoTemplates.length} · ${
    shortVideoTemplates[index].id
  }`;
}

/**
 * Advances the mocked clock inside `act`, so React commits whatever the tick
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
 * A `matchMedia` the test can flip, so a preference that changes *during* a visit
 * is drivable rather than only the one a mount happens to see. `setup.ts` stubs
 * `matchMedia` with `matches: false`, which is the no-preference case the rest of
 * the file relies on.
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
  // Unmount first (the harness's own teardown asserts nothing leaked), then put
  // the real clock and the real `matchMedia` back so the next test is unaffected.
  cleanupSurfaces();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LiveProductPreview", () => {
  test("advances on its own once the interval elapses", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });
    expect(showing(ui)).toBe("Sarah Chen");
    expect(currentDot(ui)).toBe("Show Sarah Chen's preview");

    await advance(3000);
    expect(showing(ui)).toBe("Marcus Rivera");
    // The strip moves with it, so the dot does not disagree with the card.
    expect(currentDot(ui)).toBe("Show Marcus Rivera's preview");
  });

  test("walks the style beside the slide on the same beat, and holds both while paused", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });
    expect(styleLine(ui)).toBe(styleLineAt(0));

    // One beat moves the slide *and* the style, which is the pairing the preview
    // derives from the shared clock's `beats` rather than keeping a second timer.
    await advance(3000);
    expect(showing(ui)).toBe("Marcus Rivera");
    expect(styleLine(ui)).toBe(styleLineAt(1));

    // A pick stops the clock, so nothing rides a beat that is not running.
    await ui.click(ui.byName("Show Emma Watson's preview"));
    expect(styleLine(ui)).toBe(styleLineAt(1));
    await advance(9000);
    expect(styleLine(ui)).toBe(styleLineAt(1));

    // Playing again puts the style back on the beat with the slide.
    await ui.click(ui.byName("Play live preview"));
    await advance(3000);
    expect(styleLine(ui)).toBe(styleLineAt(2));
  });

  test("walks the style through its whole longer cycle, wrapping where the slide does not", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    // Twenty-nine beats in: the three slides have wrapped nine times over while
    // the style has walked almost all thirty of its own — which is exactly why the
    // style is the beat's count wrapped and not a copy of the slide, since a copy
    // would have stopped after the third style.
    await advance(3000 * (shortVideoTemplates.length - 1));
    expect(styleLine(ui)).toBe(styleLineAt(shortVideoTemplates.length - 1));

    // The next beat wraps the style back to the first, and the slide wraps too:
    // both are still on the same beat, they are just different lengths.
    await advance(3000);
    expect(styleLine(ui)).toBe(styleLineAt(0));
    expect(showing(ui)).toBe("Sarah Chen");
  });

  test("holds the slide while paused, and picks the cadence up again on play", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    await advance(1500);
    await ui.click(ui.byName("Pause live preview"));
    expect(showing(ui)).toBe("Sarah Chen");

    // Three whole intervals with the clock stopped: nothing moves.
    await advance(9000);
    expect(showing(ui)).toBe("Sarah Chen");

    await ui.click(ui.byName("Play live preview"));
    await advance(3000);
    expect(showing(ui)).toBe("Marcus Rivera");
  });

  test("stops the rotation when a dot is picked, so no cadence is left to replace the choice", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    // Pick half way to the first tick — the moment a standing cadence is most
    // wrong about a slide the viewer has just asked for.
    await advance(1500);
    await ui.click(ui.byName("Show Emma Watson's preview"));
    expect(showing(ui)).toBe("Emma Watson");

    // Three whole intervals with the clock stopped, the first of them well past
    // the tick the old cadence was counting down to. The winner of that race is
    // not the timer that happened to be running — there is no longer one.
    await advance(9000);
    expect(showing(ui)).toBe("Emma Watson");
    expect(currentDot(ui)).toBe("Show Emma Watson's preview");

    // And the control offers the way back, which is how the preview moves on,
    // wrapping 3 -> 1.
    await ui.click(ui.byName("Play live preview"));
    await advance(3000);
    expect(showing(ui)).toBe("Sarah Chen");
  });

  test("stops the rotation when a dot is walked to with the arrow keys, not only clicked", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    await advance(1500);
    // The keyboard reaches the same pick through the same `select`, so it has to
    // stop the rotation the same way a click does.
    await ui.press(ui.byName("Show Sarah Chen's preview"), "ArrowRight");
    expect(showing(ui)).toBe("Marcus Rivera");

    await advance(9000);
    expect(showing(ui)).toBe("Marcus Rivera");
    // `byName` throws when no control answers to the name, which is the assertion:
    // the control now offers to start the preview again.
    ui.byName("Play live preview");
  });

  test("opens paused when the system asks for reduced motion, and plays when asked", async () => {
    stubReducedMotion(true);
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    // The control says what the preview is doing, so a viewer is not left looking
    // at a still card with a button that claims it is already playing. `byName`
    // throws when no control answers to that name, which is the assertion.
    ui.byName("Play live preview");
    expect(showing(ui)).toBe("Sarah Chen");

    await advance(9000);
    expect(showing(ui)).toBe("Sarah Chen");

    // Pressing play is the viewer asking for the motion, and they get it.
    await ui.click(ui.byName("Play live preview"));
    await advance(3000);
    expect(showing(ui)).toBe("Marcus Rivera");
    expect(announcement(ui).text).toBe("Slide 2 of 3: Marcus Rivera");
  });

  test("stops the rotation when the preference is turned on mid-visit", async () => {
    const motion = stubReducedMotion(false);
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    await advance(1500);
    expect(showing(ui)).toBe("Sarah Chen");

    // The listener is a real browser event, so it arrives outside React's event
    // system; wrapping it in `act` is what lets the committed button be read.
    await act(async () => {
      motion.set(true);
    });
    ui.byName("Play live preview");

    // Whatever slide it was on stays put: the preference is honoured from now on,
    // not only at mount.
    await advance(9000);
    expect(showing(ui)).toBe("Sarah Chen");
  });

  test("says where the preview moved to, rather than leaving the change silent", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    const first = announcement(ui);
    expect(first.live).toBe("polite");
    // Spoken, never drawn: a status line on the card would be a design change.
    expect(first.hidden).toBe(true);
    expect(first.text).toBe("Slide 1 of 3: Sarah Chen");

    await advance(3000);
    expect(announcement(ui).text).toBe("Slide 2 of 3: Marcus Rivera");
  });

  test("announces the slide a viewer picks, and goes quiet once the pick stops it", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    await ui.click(ui.byName("Show Emma Watson's preview"));
    expect(announcement(ui).text).toBe("Slide 3 of 3: Emma Watson");

    // The pick stopped the rotation, so nothing changes from here and nothing is
    // said: without that, a reader would keep hearing the same slide read back.
    const held = announcement(ui).text;
    await advance(9000);
    expect(announcement(ui).text).toBe(held);
  });

  test("counts a pick on the dot already showing as taking control", async () => {
    const ui = mountSurface(<LiveProductPreview />, { providers: "none" });

    await advance(1500);
    // The click changes nothing about the slide, so the motion is its only
    // evidence — the case a pick wired straight to the index would drop, and the
    // reason the counter this replaced had to be a counter.
    await ui.click(ui.byName("Show Sarah Chen's preview"));
    expect(showing(ui)).toBe("Sarah Chen");

    await advance(9000);
    expect(showing(ui)).toBe("Sarah Chen");
    ui.byName("Play live preview");
  });
});
