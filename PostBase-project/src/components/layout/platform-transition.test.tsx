// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { reachableControls } from "@/test/a11y";
import { cleanupSurfaces, mountSurface, withSurfaceProviders, type MountedSurface } from "@/test/render";
import { PlatformTransition } from "@/components/layout/platform-transition";

/**
 * The veil that covers a move between sections, driven by the address changing
 * underneath it — which is the only thing that ever does drive it, so the
 * address is a mutable stub the case re-renders against rather than a prop.
 *
 * The subject is the two halves of the claim: that a *section* change raises it
 * and a move inside one does not (the veil is the seam between modules, and a
 * curtain over every click would cover navigation that already reads as one
 * continuous page), and that it leaves again — a veil that stayed up would be
 * the app covered by its own transition, which is the failure a snapshot taken
 * at mount could never show.
 *
 * The two durations the timings below pin are the two in `globals.css`: the
 * sweep runs for 620ms, which is 360 raised plus 260 leaving, so the bar lands
 * as the veil finishes fading. They are asserted to the millisecond for that
 * reason — a change to one that does not change the other is a veil that
 * finishes after the bar it is carrying, and this is where it would be seen.
 */
const mocks = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

/** The veil itself: the one thing this component renders that hides itself. */
function veil(ui: MountedSurface) {
  const element = ui.container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!element) throw new Error("the transition rendered no veil to cover the change with");
  return element;
}

/** Moves the address and re-renders, as a navigation would. */
async function navigate(ui: MountedSurface, to: string) {
  mocks.pathname = to;
  await ui.render(withSurfaceProviders(<PlatformTransition />, "none"));
}

/** Moves time forward inside `act`, so what the timers did is rendered. */
async function pass(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.pathname = "/feed";
  setReducedMotion(false);
});

afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
});

describe("PlatformTransition", () => {
  test("rests over the section the reader is already on rather than covering it", async () => {
    const ui = mountSurface(<PlatformTransition />, { providers: "none" });
    const veilEl = veil(ui);

    // Mounted, and transparent: the veil is on the page but not over it, which
    // is the whole of what the first render does. Both halves are asserted
    // because either alone would pass on a veil that was either invisible by
    // accident (`opacity-0` on a painted wash) or painted over the reader.
    expect(veilEl.className).toContain("opacity-0");
    expect(veilEl.className).not.toContain("bg-card");
    expect(veilEl.className).toContain("pointer-events-none");
    expect(veilEl.className).not.toContain("platform-transition-raise");
    // It still names the section it would cover — the name is what a surface
    // with nothing shown has to say for itself.
    expect(veilEl.textContent).toBe("Feed");
    // Decorative by construction: hidden from a reader and holding nothing
    // they could reach, so covering the page never takes it away from them.
    expect(reachableControls(veilEl)).toEqual([]);
  });

  test("covers the move into another section, naming where it landed", async () => {
    const ui = mountSurface(<PlatformTransition />, { providers: "none" });

    await navigate(ui, "/marketplace");

    const veilEl = veil(ui);
    expect(veilEl.className).toContain("platform-transition-raise");
    expect(veilEl.className).toContain("bg-card/70");
    expect(veilEl.className).not.toContain("opacity-0");
    expect(veilEl.textContent).toBe("Marketplace");
  });

  test("holds for the sweep, leaves, and is gone again", async () => {
    const ui = mountSurface(<PlatformTransition />, { providers: "none" });
    await navigate(ui, "/jobs");
    expect(veil(ui).className).toContain("platform-transition-raise");

    await pass(359);
    expect(veil(ui).className, "the veil left before the sweep had crossed").toContain(
      "platform-transition-raise",
    );

    await pass(1);
    expect(veil(ui).className).toContain("platform-transition-leave");

    await pass(259);
    expect(veil(ui).className, "the veil lifted while it was still leaving").toContain(
      "platform-transition-leave",
    );

    await pass(1);
    // Back to exactly what the first render produced: transparent, unpainted,
    // naming the section the reader stopped on.
    const atRest = veil(ui);
    expect(atRest.className).toContain("opacity-0");
    expect(atRest.className).not.toContain("bg-card");
    expect(atRest.className).not.toContain("platform-transition");
    expect(atRest.textContent).toBe("Jobs");
  });

  test("leaves a move inside one section alone", async () => {
    const ui = mountSurface(<PlatformTransition />, { providers: "none" });
    await navigate(ui, "/marketplace");
    // Two advances rather than one: the second leg's timer does not exist
    // until the first has rendered the veil into its leaving phase.
    await pass(360);
    await pass(260);
    expect(veil(ui).className, "the section change never settled").toContain("opacity-0");

    // Saved listings are a page of the marketplace, not another section: the
    // veil is the seam between modules, and this is within one. The change
    // above is what makes the absence here mean something — asserted while the
    // veil was still up, this would only be reporting the move it was covering.
    await navigate(ui, "/marketplace/saved");

    expect(veil(ui).className).not.toContain("platform-transition-raise");
    expect(veil(ui).className).toContain("opacity-0");
  });

  test("keeps covering a reader who moves on again underneath it", async () => {
    const ui = mountSurface(<PlatformTransition />, { providers: "none" });
    await navigate(ui, "/groups");
    await pass(120);

    // A second change while the veil is up: it stays up, and it says where the
    // reader is going now rather than what the first move named.
    await navigate(ui, "/messages");

    const veilEl = veil(ui);
    expect(veilEl.className).toContain("platform-transition-raise");
    expect(veilEl.textContent).toBe("Messages");

    // And it still leaves, from the second move.
    await pass(360);
    expect(veil(ui).className).toContain("platform-transition-leave");
    await pass(260);
    expect(veil(ui).className).toContain("opacity-0");
  });

  test("stays out of the way for a reader who asked for less motion", async () => {
    setReducedMotion(true);
    const ui = mountSurface(<PlatformTransition />, { providers: "none" });

    await navigate(ui, "/groups");

    // The sections still switch, and the veil still names where the reader is
    // — it simply never appears over the switch.
    const veilEl = veil(ui);
    expect(veilEl.textContent).toBe("Groups");
    expect(veilEl.className).not.toContain("platform-transition-raise");
    expect(veilEl.className).toContain("opacity-0");
    expect(veilEl.className).not.toContain("bg-card");
  });
});
