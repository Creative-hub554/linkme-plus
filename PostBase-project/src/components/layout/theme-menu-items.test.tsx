// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { useTheme } from "@/components/providers/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeMenuItems } from "@/components/layout/theme-menu-items";
import { THEMES, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * The nav's theme switcher, judged where it cannot be judged from the nav.
 *
 * `main-nav.test.tsx` renders the nav to static markup, so it can only see the
 * markup the nav *always* writes — and these items are inside a menu's content,
 * which Radix mounts only while the menu is open. It also cannot open that menu:
 * Radix opens a dropdown on `pointerdown`, which a jsdom click does not produce.
 * So the surface is mounted here the way a test can mount it — the menu
 * controlled open, its content `forceMount`ed — and what is asserted is the
 * wiring and the semantics, not the gesture.
 *
 * That distinction is worth keeping straight: what this file proves is that the
 * three items exist, are named, say which one is chosen, and switch the theme
 * when selected. What it cannot prove is that a real pointer opens the menu, and
 * that is checked in the browser instead.
 */
function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme();
  return (
    <span data-testid="theme">{`${theme}:${resolvedTheme}`}</span>
  );
}

function surface() {
  return (
    <>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent forceMount>
          <ThemeMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeProbe />
    </>
  );
}

/** The items are portalled onto the body, so the document is what to search. */
const radioItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));

const probe = () => document.querySelector('[data-testid="theme"]')?.textContent ?? null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanupSurfaces();
  window.localStorage.clear();
});

describe("ThemeMenuItems", () => {
  test("offers the app's own themes, in the app's own order and words", async () => {
    const ui = mountSurface(surface(), { providers: "theme" });
    await ui.waitFor(() => radioItems().length === THEMES.length, {
      description: "the theme items to mount",
    });
    // Read off `THEMES` rather than restated, so a theme added there has to
    // answer here too.
    expect(radioItems().map((item) => item.textContent)).toEqual(THEMES.map((theme) => theme.label));
  });

  test("names the group and says which theme is chosen", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const ui = mountSurface(surface(), { providers: "theme" });
    await ui.waitFor(() => radioItems().length === THEMES.length, {
      description: "the theme items to mount",
    });

    // A name, because Radix renders the group as a bare `role="group"` — the
    // audit's "a group of options must have a name" rule is satisfied by this,
    // and its "...must state which one is chosen" half by the `aria-checked`
    // below.
    const group = document.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Theme");

    const checked = radioItems().filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked.map((item) => item.textContent)).toEqual(["Dark"]);
    expect(radioItems().every((item) => item.getAttribute("aria-checked") !== null)).toBe(true);

    // And the same fact is *drawn*: exactly one item carries the tick, and it
    // is the announced one. A picker that only announces the current choice
    // leaves the reader looking at three identical rows, and one that only
    // draws it says nothing to anyone not looking.
    const ticks = radioItems().filter((item) => item.querySelector("svg.lucide-check"));
    expect(ticks.map((item) => item.textContent)).toEqual(["Dark"]);
  });

  test("switches the theme on one click, and persists it", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const ui = mountSurface(surface(), { providers: "theme" });
    await ui.waitFor(() => radioItems().length === THEMES.length, {
      description: "the theme items to mount",
    });
    expect(probe()).toBe("light:light");

    const dark = radioItems().find((item) => item.textContent === "Dark");
    if (!dark) throw new Error("no Dark item was rendered");
    await ui.click(dark);

    expect(probe()).toBe("dark:dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    const light = radioItems().find((item) => item.textContent === "Light");
    if (!light) throw new Error("no Light item was rendered");
    await ui.click(light);
    expect(probe()).toBe("light:light");
  });

  test("offers System, which follows the device rather than a fixed theme", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const ui = mountSurface(surface(), { providers: "theme" });
    await ui.waitFor(() => radioItems().length === THEMES.length, {
      description: "the theme items to mount",
    });
    const system = radioItems().find((item) => item.textContent === "System");
    if (!system) throw new Error("no System item was rendered");
    await ui.click(system);
    // `setup.ts` stubs `matchMedia` with `matches: false`, so System resolves
    // to light here — the point is that the choice is stored as `system` and
    // resolved, not stored as a fixed colour.
    expect(probe()).toBe("system:light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });
});
