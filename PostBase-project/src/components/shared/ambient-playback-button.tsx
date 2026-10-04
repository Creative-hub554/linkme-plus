"use client";

import type { Dispatch, SetStateAction } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AmbientPlaybackButtonProps {
  /** Whether the thing it controls is moving right now. */
  playing: boolean;
  /**
   * The same state's setter, straight from `useAmbientPlayback`. Handed over
   * rather than a bare `onToggle` so the flip lives here: the button is the only
   * caller and `setPlaying((value) => !value)` written twice is the exact line
   * this component exists to hold once.
   */
  setPlaying: Dispatch<SetStateAction<boolean>>;
  /**
   * What is moving, as a noun the name is built from — `"live preview"` reads as
   * **"Pause live preview"** while it is moving. The verb is the component's,
   * because a control that plays must say *Pause* while it is playing.
   */
  label: string;
  /** The button's own size and skin; see the callers for the two that exist. */
  className?: string;
}

/**
 * The play/pause control for something that moves on its own.
 *
 * The name is the whole point, and it is the half that is easy to get wrong in a
 * way nothing catches: the glyph is the same `▶`/`Ⅱ` either way, so a control
 * whose `aria-label` says "Play" while the thing is already playing reads as a
 * button that will do nothing — and, worse, one that would leave a viewer with
 * reduced motion stuck, since pressing it is the only way past the preference
 * that starts these carousels stopped. So the verb is derived from `playing`
 * here rather than written at the call site, and there is no spelling of this
 * component that draws one state and announces the other.
 *
 * The glyph is `aria-hidden`: the name is `aria-label`'s, and a reader that also
 * got the `Ⅱ` character read out would hear "pause pause". A sighted viewer gets
 * the conventional mark, which is why this is not an `IconButton` — that one
 * adds a tooltip and a `Button` skin, and this control is drawn onto the surface
 * it controls, which is the case its own doc excludes.
 *
 * What stays with the caller is the skin: the two surfaces differ in size, in
 * focus-ring colour and in whether the control sits on a card or on glass, and
 * `className` is the whole of that decision.
 */
export function AmbientPlaybackButton({
  playing,
  setPlaying,
  label,
  className,
}: AmbientPlaybackButtonProps) {
  return (
    <button
      type="button"
      aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      onClick={() => setPlaying((value) => !value)}
      className={cn(
        "flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2",
        className,
      )}
    >
      {playing ? (
        <span aria-hidden="true" className="font-bold">
          Ⅱ
        </span>
      ) : (
        <Play aria-hidden="true" className="h-3 w-3 fill-current" />
      )}
    </button>
  );
}
