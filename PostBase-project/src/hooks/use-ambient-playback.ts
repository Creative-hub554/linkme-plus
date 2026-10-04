"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Whether something that moves on its own — the landing page's live preview, the
 * sign-in page's live visual — should be moving right now.
 *
 * The answer is the system's motion preference read once at mount and again whenever
 * it changes, *and then* whatever the viewer last said. The preference can only ever
 * start it stopped, never start it moving, and the play control overrides a
 * preference that would keep it still. That is the whole reason the preference is
 * read here rather than inside a caller's interval: a guard in the interval can only
 * ever refuse the viewer, which is exactly how both of those surfaces once sat
 * motionless under a button that claimed to be playing, with no way to start them.
 *
 * It lives in one place because there are two of these now, they share this policy
 * exactly, and differ only in their cadence and their content — a copied rule is a
 * place for the two to disagree later.
 *
 * `true` is the initial value rather than a read of `matchMedia`, because the server
 * renders these components too and cannot know the preference: reading it during the
 * first render would make the two disagree about which button to draw. `true` is what
 * the server draws, and the effect below corrects it a frame later on a device that
 * asked for stillness.
 */
export function useAmbientPlayback(
  defaultPlaying = true,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [playing, setPlaying] = useState(defaultPlaying);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const honourPreference = () => {
      // A viewer who turns the preference on mid-visit stops whatever is moving,
      // rather than watching it run to the end of the session.
      if (query.matches) setPlaying(false);
    };
    honourPreference();
    query.addEventListener("change", honourPreference);
    return () => query.removeEventListener("change", honourPreference);
  }, []);

  return [playing, setPlaying];
}
