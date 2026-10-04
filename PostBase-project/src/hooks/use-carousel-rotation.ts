"use client";

import { useCallback, useState } from "react";

/**
 * Which item a carousel is showing, and the two ways it moves.
 *
 * `advance` is what the carousel's interval calls: it walks on to the next item
 * and wraps at the end. `select` shows the item a viewer picked, and does nothing
 * else — the hook that owns the clock decides what a pick means for it.
 *
 * There is deliberately no re-arm counter here any more. One used to live here so
 * that a pick could restart an interval that was already counting down; it had to
 * be a counter rather than the index, because a click on the dot that was already
 * current changes no state at all. A pick *stops* the rotation now (see
 * `useAmbientCarousel`), so there is no standing cadence left for the chosen item
 * to be replaced by, and nothing for a counter to do. What replaced it is a
 * stronger rule, not a smaller one.
 *
 * The clock is not this hook's either: it lives one level up, in
 * `useAmbientCarousel`, which takes the caller's cadence (3s on the preview
 * against 4.2s on the visual) and counts the beats it moves on. Position is all
 * this holds, and the interval is not its business.
 */
export interface CarouselRotation {
  /** Which item is showing. */
  index: number;
  /** Move on to the next item, wrapping at the end. What the carousel's interval calls. */
  advance: () => void;
  /** Show the item at `picked`. */
  select: (picked: number) => void;
}

export function useCarouselRotation(count: number): CarouselRotation {
  const [index, setIndex] = useState(0);

  const advance = useCallback(() => setIndex((value) => (value + 1) % count), [count]);

  const select = useCallback((picked: number) => setIndex(picked), []);

  return { index, advance, select };
}
