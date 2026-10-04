"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/providers/theme-provider";
import { fetchAccountAppearance, saveAccountAccent } from "@/lib/theme-preferences";
import { ACCENT_STORAGE_KEY, DEFAULT_ACCENT, appearanceSync, readPreference } from "@/lib/theme";

/**
 * Keeps the accent the member chose and the accent on their profile in step.
 *
 * Renders nothing. It exists because the two halves live in places that cannot
 * see each other: the choice is in the browser (`ThemeProvider`) and the copy
 * that travels is on the account, which only `AuthProvider` knows about — so
 * this is the one component both can be read from, mounted once in the layout.
 *
 * Three jobs, and the first two are the whole feature:
 *
 *   1. **On sign-in, reconcile** — `appearanceSync` decides, and the account
 *      wins. That is what makes the accent follow a member to a machine that has
 *      never seen it, and it is also what seeds the account from the first
 *      device that had a local choice.
 *   2. **On sign-out, let it go.** The stored accent is cleared back to the
 *      default so the next person to sign in on this browser does not inherit
 *      the previous member's choice — and, worse, *publish* it to their own
 *      account on their first visit, which the "no account value yet" branch
 *      would otherwise do. Same reasoning as the notification provider clearing
 *      its inbox on sign-out.
 *   3. Nothing else. The picker writes its own changes (see
 *      `AppearanceSettings`), so there is no need to watch the accent for edits
 *      — watching would also make adopting a value from the account echo back a
 *      write of the value it just adopted.
 *
 * The light/dark choice is deliberately not here: it stays on the device.
 */
export function ThemeSync() {
  const { user } = useAuth();
  const { setAccent } = useTheme();
  const userId = user?.id ?? null;
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (lastUserId.current && !userId) {
      setAccent(DEFAULT_ACCENT);
    }
    lastUserId.current = userId;
  }, [userId, setAccent]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      const appearance = await fetchAccountAppearance();
      // `null` is "could not read" (signed out, offline, the endpoint's own
      // 503); an empty object is a readable account with nothing stored.
      if (cancelled || appearance === null) return;

      const decision = appearanceSync(readPreference(ACCENT_STORAGE_KEY), appearance.accent);
      if (decision.action === "adopt") setAccent(decision.accent);
      else if (decision.action === "publish") void saveAccountAccent(decision.accent);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, setAccent]);

  return null;
}
