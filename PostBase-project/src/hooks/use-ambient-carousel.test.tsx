// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { useAmbientCarousel } from "./use-ambient-carousel";

/**
 * The two rules the shared carousel owns, and the reason it is one hook.
 *
 * **A pick stops the rotation.** It is the honest answer to the defect the pair
 * has carried from the start — a viewer could pick an item and watch the standing
 * cadence replace it a moment later. Restarting the timer from the pick is winning
 * a race by re-running it; stopping is not racing at all. So what is pinned here
 * is the division of authority between the two things that can move a carousel:
 * the beat is the rotation itself and a timer is not a person, so it changes
 * nothing but the position, while `select` is a viewer and takes the motion away
 * from the clock. The other half — that a dot which was already showing still
 * counts as a pick — is here because it is the case the old re-arm counter existed
 * for, and the case a pick wired straight to the index would get wrong.
 *
 * **The clock is this hook's.** Both surfaces used to write the same
 * `setInterval` effect, differing only in the number, so the cadence is now an
 * argument and the interval is tested once here rather than twice through the
 * surfaces. That is why this file drives a fake clock where it used to have none:
 * `cadenceMs` is honoured to the millisecond, each beat both advances the rotation
 * and counts one beat — the number a surface with a second cycle on the same beat
 * derives from — pausing stops the beat, and resuming rebuilds exactly one
 * interval, so a leaked one shows up as two advances on the next beat. That is the
 * assertion the "no doubling" case makes.
 *
 * The hook is mounted through a probe rather than called directly: it holds state,
 * and both halves of what it returns are only observable on the far side of a
 * click.
 */

/** A surface that shows the state and offers the moves the app has. */
function Probe({ cadenceMs = 1000 }: { cadenceMs?: number }) {
  const { index, beats, select, playing, setPlaying } = useAmbientCarousel(3, { cadenceMs });
  return (
    <>
      <span data-testid="index">{index}</span>
      <span data-testid="playing">{String(playing)}</span>
      <span data-testid="beats">{beats}</span>
      <button type="button" aria-label="play" onClick={() => setPlaying(true)}>
        play
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

/** One value the probe is rendering, by its test id. */
function read(ui: MountedSurface, id: "index" | "playing" | "beats") {
  return ui.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
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

describe("useAmbientCarousel", () => {
  test("shows the item a viewer picks, and stops the rotation", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });
    expect(read(ui, "playing")).toBe("true");

    await ui.click(ui.byName("pick 2"));

    // Both halves: the pick is shown, and the clock no longer has it.
    expect(read(ui, "index")).toBe("2");
    expect(read(ui, "playing")).toBe("false");
  });

  test("stops on a pick of the item already showing, which is the click that changes nothing else", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    await advance(1000);
    expect(read(ui, "index")).toBe("1");

    await ui.click(ui.byName("pick 1"));

    // The index is where it already was, so the motion is the only evidence the
    // click landed — which is exactly the case a pick wired to the index alone
    // would drop, and the reason the counter this replaces had to be a counter.
    expect(read(ui, "index")).toBe("1");
    expect(read(ui, "playing")).toBe("false");
  });

  test("moves on the cadence the caller gave it, and not a millisecond before", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    // Short of the beat: nothing has moved, and no beat has been counted.
    await advance(999);
    expect(read(ui, "index")).toBe("0");
    expect(read(ui, "beats")).toBe("0");

    await advance(1);
    expect(read(ui, "index")).toBe("1");
    expect(read(ui, "beats")).toBe("1");

    // And it keeps the beat rather than firing once: the next cadence moves it on.
    await advance(1000);
    expect(read(ui, "index")).toBe("2");
    expect(read(ui, "beats")).toBe("2");
  });

  test("keeps moving when the rotation advances itself, because a timer is not a viewer", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    await advance(2000);

    expect(read(ui, "index")).toBe("2");
    // The interval calling `advance` must never take the motion away from itself.
    expect(read(ui, "playing")).toBe("true");
  });

  test("stops the beat with a pick, and starts exactly one again on play", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    await advance(500);
    await ui.click(ui.byName("pick 2"));
    expect(read(ui, "index")).toBe("2");

    // Three whole cadences with the clock stopped: nothing moves and nothing ticks,
    // which is the pause a pick is.
    await advance(3000);
    expect(read(ui, "index")).toBe("2");
    expect(read(ui, "beats")).toBe("0");

    // Resuming rebuilds one interval, not two: a leak here would land the index on
    // 1 (two advances) rather than 0, and count two beats.
    await ui.click(ui.byName("play"));
    await advance(1000);
    expect(read(ui, "index")).toBe("0");
    expect(read(ui, "beats")).toBe("1");
  });

  test("counts one beat per cadence, and freezes the count while the clock is stopped", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    // Stopped by a pick, the beat is gone and so is its count: it must not go on
    // climbing behind a standing item.
    await ui.click(ui.byName("pick 2"));
    await advance(3000);
    expect(read(ui, "beats")).toBe("0");

    // Playing again, every beat advances the rotation *and* counts one — the two
    // move on the same step, so a cycle derived from the count cannot drift from
    // the item itself.
    await ui.click(ui.byName("play"));
    await advance(1000);
    expect(read(ui, "index")).toBe("0");
    expect(read(ui, "beats")).toBe("1");
    await advance(1000);
    expect(read(ui, "index")).toBe("1");
    expect(read(ui, "beats")).toBe("2");
  });

  test("lets the viewer start it again after a pick", async () => {
    const ui = mountSurface(<Probe />, { providers: "none" });

    await ui.click(ui.byName("pick 2"));
    expect(read(ui, "playing")).toBe("false");

    // Stopping is not a lock: the play control is the way back, which is what
    // keeps a pick from being a decision the viewer cannot undo.
    await ui.click(ui.byName("play"));
    expect(read(ui, "playing")).toBe("true");
    expect(read(ui, "index")).toBe("2");
  });

  test("opens stopped when the system asks for reduced motion, and still lets a pick land", async () => {
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation(
      ((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia,
    );
    const ui = mountSurface(<Probe />, { providers: "none" });
    expect(read(ui, "playing")).toBe("false");

    // No interval was opened at all, so the beat never runs and its count never
    // moves off zero.
    await advance(3000);
    expect(read(ui, "index")).toBe("0");
    expect(read(ui, "beats")).toBe("0");

    // Picking while stopped still shows the item: the strip is a way to *choose*,
    // and only its side effect on the clock is what the preference can refuse.
    await ui.click(ui.byName("pick 2"));
    expect(read(ui, "index")).toBe("2");
    expect(read(ui, "playing")).toBe("false");
  });
});
