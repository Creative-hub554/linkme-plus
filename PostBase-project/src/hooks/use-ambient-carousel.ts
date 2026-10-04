"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAmbientPlayback } from "./use-ambient-playback";
import { useCarouselRotation } from "./use-carousel-rotation";

/**
 * What a surface tells the carousel that only the surface knows.
 *
 * `cadenceMs` is the beat it moves on — 3s on the landing preview, 4.2s on the
 * sign-in visual. It is the whole of what a surface decides: it states its content
 * and its beat, and nothing about how a timer is taken down.
 */
export interface AmbientCarouselOptions {
  /** How long each item is shown before the rotation moves on, in milliseconds. */
  cadenceMs: number;
}

/**
 * A carousel that moves on its own until a viewer says otherwise.
 *
 * This is the two halves the surfaces used to wire up themselves —
 * `useAmbientPlayback` (may it move, given the system's motion preference and
 * the viewer's own control) and `useCarouselRotation` (which item is showing) —
 * joined by the two things that need both of them: **a pick stops the
 * rotation**, and the **clock that moves it lives here**.
 *
 * The first rule is the honest version of what a re-arm counter used to
 * approximate. The defect was that a viewer could pick an item and watch the
 * standing cadence replace it a moment later; the old answer was to restart the
 * timer from the pick, which is a race you win by re-running the thing you are
 * racing. The answer now is that touching the dots is the viewer taking control,
 * and the rotation stops where they put it — exactly as it does when they press
 * pause, because that is what this is. Nothing races the choice because nothing
 * else is running, and the play control beside the dots is how they start it
 * again. It lives here, once, so the two surfaces cannot drift into stopping
 * differently.
 *
 * The beat's own step deliberately stops nothing: the interval calling it is the
 * rotation itself, not a viewer. Only `select` — what `SceneStrip` calls on a
 * click or an arrow key — is a person. That walk is no longer among the things
 * this hands back, either: with the clock here, the only caller left is the
 * interval, and leaving it public is the seam a surface would use to start
 * wiring its own timer again.
 *
 * **The clock, then.** Both surfaces used to write the same effect — bail out
 * while paused, open a `setInterval`, clear it on teardown, list `[playing,
 * advance]` so a pause rebuilds it — and the only thing that ever differed was
 * the number in the middle, 3s against 4.2s. A cadence each surface spelled
 * itself is a cadence each surface can spell differently, and the teardown that
 * has to be right or a pause leaves both intervals running is the part with no
 * rule in it at all. So the interval is owned here and the caller passes
 * `cadenceMs`.
 *
 * **The second thing on the beat.** The landing preview draws a template style
 * beside the slide, and that style cycles on the same beat over its own, longer
 * list — 30 styles against 3 slides. It is therefore not a second copy of the
 * position and cannot be derived from the slide: after three beats the slide is
 * back at the start while the style has barely moved. What such a surface needs
 * from the clock is not a way to run on each beat but the beat itself, so this
 * returns `beats` — how many beats have elapsed while playing — and the surface
 * derives from it (`beats % styles.length` on the preview, wrapping its whole
 * list). A pick stops the clock, so it stops this count where it stands, and the
 * style holds exactly where the slide does.
 *
 * A count, and not an `onTick` callback, because a callback handed to the hook is
 * the same shape of leak as the `advance` that is no longer returned: it lets a
 * surface run anything at all on the beat — open its own timer, write to the DOM
 * — and the hook cannot reason about any of it, while the inline arrow a caller
 * naturally passes has to be held by reference or it tears the interval down and
 * resets the cadence mid-beat. A value has no identity to stabilise and no
 * interval to protect, and it can do nothing but be read. Everything a callback
 * could have done, a surface can still do with an effect on `beats`; the reverse
 * is not true, and the narrower seam is the one that stays honest.
 */
export interface AmbientCarousel {
  /** Which item is showing. */
  index: number;
  /**
   * How many beats the clock has counted while playing — `0` at mount, `+1` per
   * `cadenceMs` beat, and not advancing while paused or stopped by a pick. It is
   * what a surface with a second thing on the same beat derives that thing from.
   */
  beats: number;
  /** Show the item at `picked`, and stop the rotation — a pick is the viewer taking control. */
  select: (picked: number) => void;
  /** Whether it is moving right now. */
  playing: boolean;
  /** The viewer's control over {@link playing} — the pause/play button, and the reduced-motion policy's opening state. */
  setPlaying: Dispatch<SetStateAction<boolean>>;
}

export function useAmbientCarousel(
  count: number,
  { cadenceMs }: AmbientCarouselOptions,
): AmbientCarousel {
  const [playing, setPlaying] = useAmbientPlayback();
  const { index, advance, select: moveTo } = useCarouselRotation(count);
  const [beats, setBeats] = useState(0);

  const select = useCallback(
    (picked: number) => {
      moveTo(picked);
      setPlaying(false);
    },
    [moveTo, setPlaying],
  );

  // The clock, and the beat count it keeps: one advance and one beat, on the same
  // step, so a style derived from `beats` moves exactly when the slide does. The
  // setter is stable, so it is not a dependency; a value the caller reads is not
  // one either, which is why nothing here can restart the cadence mid-beat.
  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      advance();
      setBeats((value) => value + 1);
    }, cadenceMs);
    return () => window.clearInterval(interval);
  }, [playing, advance, cadenceMs]);

  return { index, beats, select, playing, setPlaying };
}
