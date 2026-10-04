// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useTheme } from "@/components/providers/theme-provider";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { THEMES, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * The theme, reachable on a phone.
 *
 * The desktop nav offers these three choices inside the account menu; the mobile
 * panel has no room for that menu, so it carries them in the open instead. That
 * this happened at all is what is asserted here — the panel is mounted *only*
 * while it is open, so no static-markup test of the nav can see a single one of
 * these controls, and `main-nav.test.tsx` never opens it.
 *
 * The panel is opened the way the reader opens it: a real click on the
 * disclosure the nav already had. That is possible only because it is a plain
 * `<button onClick>` and not a Radix menu — see the note in `render.tsx`. What is
 * then judged is the wiring and the semantics; that the button is reachable with
 * a thumb is the browser's question, not this one.
 *
 * Three modules are stubbed to get the nav to render and none is under test: the
 * pathname, the session (which would otherwise reach for Supabase), and the bell
 * (which would otherwise reach for a Realtime socket). `ThemeProvider` is real,
 * because the theme is what is under test.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/feed",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { email: "theo@example.com", name: "Theo Wu" },
  }),
}));

vi.mock("@/components/realtime/notification-bell", () => ({
  NotificationBell: () => <span data-bell="" />,
}));

import { MainNav } from "@/components/layout/main-nav";

/** What the provider says the theme is, as opposed to what a button looks like. */
function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme();
  return <span data-testid="theme">{`${theme}:${resolvedTheme}`}</span>;
}

function renderNav() {
  return mountSurface(
    <>
      <MainNav />
      <ThemeProbe />
    </>,
    { providers: "theme+tooltip" },
  );
}

/** Opens the panel through its own disclosure, the way a reader does. */
async function openPanel() {
  const ui = renderNav();
  // The nav renders the disclosure, and clicking it mounts the panel: each is
  // waited for rather than slept through, so a slow machine cannot turn the
  // twenty milliseconds into a flake.
  await ui.waitFor(() => ui.container.querySelector('[aria-label="Open menu"]') !== null, {
    description: "the nav to render its menu button",
  });
  await ui.click(ui.byName("Open menu"));
  await ui.waitFor(() => document.getElementById("mobile-nav") !== null, {
    description: "the panel to open",
  });
  return ui;
}

const panel = () => document.getElementById("mobile-nav");
const radios = () => Array.from(panel()?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
const labels = () => radios().map((radio) => radio.textContent);
const checked = () =>
  radios()
    .filter((radio) => radio.getAttribute("aria-checked") === "true")
    .map((radio) => radio.textContent);
const probe = () => document.querySelector('[data-testid="theme"]')?.textContent ?? null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanupSurfaces();
  window.localStorage.clear();
});

describe("the mobile panel's theme switcher", () => {
  test("offers the app's own themes, in the app's own order and words", async () => {
    await openPanel();
    expect(panel(), "the panel opened").not.toBeNull();
    // Read off `THEMES` rather than restated, so a theme added there has to
    // answer here too — this is the same list the settings card draws.
    expect(labels()).toEqual(THEMES.map((theme) => theme.label));
  });

  test("names the group, and says which theme is chosen", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    await openPanel();
    const group = panel()?.querySelector<HTMLElement>('[role="radiogroup"]');
    expect(group, "the panel has a theme group").not.toBeNull();

    // The name is checked by resolving the reference, not by restating the
    // word "Theme": the label this group points at is what a reader hears.
    const labelId = group!.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(labelId)?.textContent).toBe("Theme");

    expect(checked()).toEqual(["Dark"]);
    expect(radios().every((radio) => radio.getAttribute("aria-checked") !== null)).toBe(true);
  });

  test("switches the theme, and leaves the panel up to show it", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const ui = await openPanel();
    expect(probe()).toBe("light:light");

    const dark = radios().find((radio) => radio.textContent === "Dark");
    if (!dark) throw new Error("the panel rendered no Dark choice");
    await ui.click(dark);

    expect(probe()).toBe("dark:dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    // The panel is drawn from the same tokens the page is, so the change is
    // the feedback — a switcher that closed the panel would hide it.
    expect(panel(), "the panel is still open after a choice").not.toBeNull();
  });
});
