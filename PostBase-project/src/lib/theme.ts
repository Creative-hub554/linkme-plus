/**
 * The theme and accent, as data.
 *
 * These live outside any component because two very different places need the
 * same facts: the `ThemeProvider` in React, and a plain `<script>` that runs
 * before the first paint. That script is the whole reason this file is not just
 * a component state — a theme applied from an effect is applied *after* the
 * server's light HTML has painted, so a reader who chose dark gets a white
 * flash on every navigation. The script reads the same storage keys and writes
 * the same class and attribute the provider does, so the two never disagree.
 *
 * The class and attribute are the contract with `globals.css`: `.dark` holds
 * the dark custom-property overrides and `data-accent` holds the brand ramp.
 */

export const THEME_STORAGE_KEY = "linkme-theme";
export const ACCENT_STORAGE_KEY = "linkme-accent";

export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
] as const;

export const ACCENTS = [
  { id: "blue", label: "Ocean blue", swatch: "#2563eb" },
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "emerald", label: "Emerald", swatch: "#059669" },
  { id: "rose", label: "Rose", swatch: "#e11d48" },
  { id: "amber", label: "Amber", swatch: "#d97706" },
] as const;

export type ThemeChoice = (typeof THEMES)[number]["id"];
export type Accent = (typeof ACCENTS)[number]["id"];
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: ThemeChoice = "system";
export const DEFAULT_ACCENT: Accent = "blue";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEMES.some((theme) => theme.id === value);
}

export function isAccent(value: unknown): value is Accent {
  return ACCENTS.some((accent) => accent.id === value);
}

/**
 * What `system` means, kept pure so it can be tested without a browser. The
 * caller supplies the media-query result; this only decides what a choice plus
 * a preference amounts to.
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/**
 * Reading and writing a stored preference.
 *
 * These belong here beside the keys and the pre-paint script, because the
 * script reads the same two keys — this is the same access from the other side
 * of the boundary. `localStorage` is not merely "sometimes empty": reading it
 * throws outright in some real browsing modes, and a non-browser renderer may
 * not define it at all. Neither function runs at import time, so importing this
 * module where there is no `window` is harmless.
 */
export function readPreference(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    /* the choice still applies for this page view */
  }
}

/** What should happen to the accent now that the account's value has arrived. */
export type AccentSyncDecision =
  | { action: "adopt"; accent: Accent }
  | { action: "publish"; accent: Accent }
  | { action: "none" };

/**
 * The rule for an accent that exists in two places, stated once.
 *
 * **The account wins.** If the profile has an accent, that is the one to show —
 * it is what the reader last chose anywhere, which is the whole point of
 * storing it centrally. The device only *publishes* its own accent when the
 * account has none, which is how the first device to set one seeds the rest and
 * how a member who chose an accent before signing in keeps it.
 *
 * Written as a decision rather than as two `if`s at the call site for the
 * reason the naming is worth anything: the precedence is a product rule, and a
 * rule stated in one place can be read, tested and changed in one place. Both
 * inputs are `unknown` on purpose — the local value comes from storage and the
 * remote one from a response, and neither is trusted until it is checked here.
 */
export function appearanceSync(local: unknown, remote: unknown): AccentSyncDecision {
  if (isAccent(remote)) return { action: "adopt", accent: remote };
  if (isAccent(local)) return { action: "publish", accent: local };
  return { action: "none" };
}

/**
 * Runs before paint, from `<head>`, so `<html>` already carries the right class
 * and attribute when the body appears. Written as one minified expression and
 * wrapped in `try` because storage is unavailable in a few real modes
 * (Safari's blocked-cookie mode throws on access) and a theme is not worth a
 * broken page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var a=localStorage.getItem(${JSON.stringify(
  ACCENT_STORAGE_KEY,
)});var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.accent=a||${JSON.stringify(
  DEFAULT_ACCENT,
)};r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
