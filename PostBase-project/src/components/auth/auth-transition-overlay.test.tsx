// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import {
  AuthTransitionOverlay,
  type AuthTransitionMode,
} from "@/components/auth/auth-transition-overlay";

/**
 * The panel that covers the moment between a credential being accepted and the
 * destination page being ready — three of them, since account creation became
 * the third.
 *
 * The contract that matters is the one a screen reader gets: this is a `status`
 * region, `aria-live="polite"`, and its label names the mode so that signing
 * in, signing up and signing out are announced as the different things they
 * are. A dialog would be wrong here — there is nothing to act on — so the file
 * pins the role as firmly as the copy.
 *
 * The copy itself is pinned per mode rather than asserted once for "some
 * headline", because the three lines are what a returning member reads to tell
 * which of the three moments they are in.
 */

/** The status region, read the way assistive technology reads it. */
function status(ui: MountedSurface) {
  const region = ui.container.querySelector('[role="status"]');
  if (!region) throw new Error("the overlay rendered no status region");
  return {
    live: region.getAttribute("aria-live"),
    label: region.getAttribute("aria-label"),
    text: region.textContent ?? "",
  };
}

afterEach(() => {
  cleanupSurfaces();
});

describe("AuthTransitionOverlay", () => {
  const cases: Array<{ mode: AuthTransitionMode; label: string; headline: string }> = [
    { mode: "login", label: "Signing in", headline: "Welcome back." },
    { mode: "register", label: "Creating your account", headline: "You're on your way." },
    { mode: "logout", label: "Signing out", headline: "See you soon." },
  ];

  for (const { mode, label, headline } of cases) {
    test(`${mode} is a polite status region named for its own moment`, () => {
      const ui = mountSurface(<AuthTransitionOverlay mode={mode} />, { providers: "none" });
      const region = status(ui);

      expect(region.live).toBe("polite");
      expect(region.label).toBe(label);
      // The headline a viewer reads sits inside the region, so it is announced
      // rather than merely drawn.
      expect(region.text).toContain(headline);
    });
  }

  test("the three modes say three different things, not one phrase", () => {
    const labels = new Set(
      cases.map(({ mode }) => status(mountSurface(<AuthTransitionOverlay mode={mode} />, { providers: "none" })).label),
    );
    expect(labels.size).toBe(cases.length);
  });

  test("the panel covers the viewport so the page beneath it cannot be reached", () => {
    const ui = mountSurface(<AuthTransitionOverlay mode="register" />, { providers: "none" });
    const region = ui.container.querySelector('[role="status"]') as HTMLElement;
    expect(region.className).toContain("fixed");
    expect(region.className).toContain("inset-0");
    // The highest layer in the app's own z scale: nothing may paint over it.
    expect(region.className).toContain("z-[100]");
  });

  test("the progress bar is decorative and the copy is not inside it", () => {
    const ui = mountSurface(<AuthTransitionOverlay mode="register" />, { providers: "none" });
    const region = ui.container.querySelector('[role="status"]');
    // The bar carries no accessible name of its own — it is a spinner by
    // another spelling, and a nameless one is the correct reading.
    const bar = region?.querySelector(".auth-transition-progress");
    expect(bar).not.toBeNull();
    expect(bar?.closest("button")).toBeNull();
    expect(region?.getAttribute("aria-busy")).toBeNull();
  });
});
