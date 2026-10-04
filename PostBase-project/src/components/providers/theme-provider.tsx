"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isAccent,
  isThemeChoice,
  readPreference,
  resolveTheme,
  writePreference,
  type Accent,
  type ResolvedTheme,
  type ThemeChoice,
} from "@/lib/theme";

interface ThemeContextValue {
  /** What the reader chose, which may be `system`. */
  theme: ThemeChoice;
  /** What that choice currently amounts to. */
  resolvedTheme: ResolvedTheme;
  accent: Accent;
  setTheme: (theme: ThemeChoice) => void;
  setAccent: (accent: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Puts the reader's theme and accent on `<html>`, and keeps them there.
 *
 * The work is small: `.dark` and `data-accent` are the entire interface to
 * `globals.css`, so this component never touches a colour. What it owns is
 * *where the choice comes from* — `localStorage`, falling back to `system` —
 * and keeping `system` honest by following the media query while it is the
 * choice. The class is applied from an effect rather than during render because
 * it belongs to a node outside React's tree; the pre-paint script in the layout
 * is what keeps that from being a visible flash.
 *
 * The state starts at the defaults and the stored values are read in the effect,
 * so the server HTML and the first client render agree. The stored value wins a
 * frame later; the *colours* are already right by then, because the script set
 * them before paint.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(DEFAULT_THEME);
  const [accent, setAccentState] = useState<Accent>(DEFAULT_ACCENT);
  const [prefersDark, setPrefersDark] = useState(false);
  /**
   * Whether the stored choice and the media query have been read yet.
   *
   * The apply effect below must not run before they have. On a first visit the
   * state is the default pair (`system` + not-dark), and applying that would
   * *remove* the class the pre-paint script just set — a light frame on a dark
   * page, which is precisely the flash the script exists to prevent. The gate
   * lets the read land and the apply happen once, with real values.
   */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedTheme = readPreference(THEME_STORAGE_KEY);
    if (isThemeChoice(storedTheme)) setThemeState(storedTheme);
    const storedAccent = readPreference(ACCENT_STORAGE_KEY);
    if (isAccent(storedAccent)) setAccentState(storedAccent);

    setReady(true);

    // A renderer without `matchMedia` cannot have a dark preference; `system`
    // resolves to light there, which is what the default already is.
    if (typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);

    // Only the *system* choice follows this, and it is read on every change
    // rather than stored, so a reader who moves from day to night sees the page
    // follow without touching the setting.
    const onPreferenceChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onPreferenceChange);
    return () => query.removeEventListener("change", onPreferenceChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset.accent = accent;
    // Tells the browser which form controls and scrollbars to draw, so a native
    // select or the scroll gutter does not stay light inside a dark page.
    root.style.colorScheme = resolvedTheme;
  }, [ready, resolvedTheme, accent]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    writePreference(THEME_STORAGE_KEY, next);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    writePreference(ACCENT_STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, accent, setTheme, setAccent }),
    [theme, resolvedTheme, accent, setTheme, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
