"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Which item in a strip a dot stands for.
 *
 * Three states, not two: `seen` is an item the carousel has already shown and
 * moved past — on the landing preview the dots read as a progress bar, filled
 * and dimmed behind the current one — where `upcoming` is one it has not
 * reached. A dot that only knew "current or not" could not draw either.
 */
export type SceneStripState = "selected" | "seen" | "upcoming";

export interface SceneStripProps {
  /** What the strip is choosing between. Names the group, so the dots are not an anonymous set. */
  label: string;
  /** How many items the strip stands for. */
  count: number;
  /** Which item is showing. */
  selected: number;
  /**
   * The accessible name of the item at `index` — the dots carry no visible text.
   *
   * It says what the dot switches **to**, never where it sits in the row. Both
   * callers name theirs after their content — "Show Marcus Rivera's preview",
   * "Show “Find your people.”" — because "Show scene 2" tells a reader how a dot
   * is numbered, which is not anything they would choose between.
   */
  labelFor: (index: number) => string;
  /** Called with the index a viewer picked. */
  onSelect: (index: number) => void;
  /** The track every dot sits in: its height, resting colour and focus ring. */
  trackClassName: string;
  /** What fills the track, by the state of its dot. */
  fillClassName: (state: SceneStripState) => string;
  /** The strip's own place on the page — margins and the like. */
  className?: string;
}

/**
 * Where an arrow key walks to, wrapping at both ends — or `null` for a key the
 * strip does not answer, which is what keeps Tab, Enter and Space out of this.
 *
 * `from` is the dot the key was pressed on rather than the one showing, because
 * those two come apart: the carousel advances on its own, and a viewer who is
 * standing on a dot with the clock running should move from *their* dot, not from
 * wherever the rotation has got to.
 */
function nextSceneIndex(key: string, from: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * A row of dots that picks which item a carousel is showing.
 *
 * It is drawn as colour alone — a filled dot against outlined ones — which is a
 * perfectly clear signal to anyone looking at the screen and no signal at all to
 * anyone who is not, the shape the WCAG "use of colour" rule warns about. The
 * two attributes that turn it into words are the whole reason this is one
 * component rather than a copied block:
 *
 * - `role="group"` with the `aria-label`: on a plain `div` an `aria-label` is
 *   ignored — it needs the role to have anything to attach to — which is how
 *   both of these strips once had no name at all.
 * - `aria-current` on the dot that is showing, which is the other half: the
 *   chosen scene is otherwise told apart by its colour.
 *
 * **The keyboard, then.** The dots are one control and not three: exactly one of
 * them is in the tab order, and it is the one showing, so tabbing into the strip
 * lands on the item a viewer would be looking at rather than on a fixed first
 * dot. Left and Right walk the selection from there and wrap at the ends, Home
 * and End jump to them, and each keystroke shows the scene it lands on — the same
 * thing a click does, because a pick that moved focus without picking would leave
 * a keyboard user selecting nothing. The strip is left as `role="group"` marked
 * with `aria-current` rather than re-roled into a tablist or a radiogroup: those
 * are the roles whose arrow keys a reader is told to expect, and adopting one is
 * a decision about what these dots *are* (tabs need panels, radios are chosen
 * rather than shown) that this component is not the place to make. What it does
 * instead is give the group the keyboard behaviour of one control and say so
 * here.
 *
 * The stop is the fourth thing it does not restate: `onSelect` is the `select` of
 * `@/hooks/use-ambient-carousel`, so a pick shows the item *and* takes the motion
 * away from the clock — whichever input reached it, click or arrow key — and no
 * caller writes that pairing itself.
 *
 * What stays with the caller is what is actually the caller's: the words
 * (`label`, `labelFor`), the two class recipes that make one strip a progress
 * bar on a card and the other a row of scene dots on glass, and everything
 * around the strip. `count` is passed rather than derived from a list because
 * the strip has no business knowing what the dots stand for.
 */
export function SceneStrip({
  label,
  count,
  selected,
  labelFor,
  onSelect,
  trackClassName,
  fillClassName,
  className,
}: SceneStripProps) {
  const strip = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const dots: HTMLElement[] = Array.from(strip.current?.querySelectorAll("button") ?? []);
    // The dot the key was pressed on, which is the dot that has the focus; a key
    // that somehow arrives from elsewhere moves from the item showing instead.
    const from = dots.indexOf(event.target as HTMLElement);
    const next = nextSceneIndex(event.key, from === -1 ? selected : from, count);
    // Nothing else is this strip's to take: an unhandled key leaves Tab to move
    // the focus on and Enter and Space to the button itself.
    if (next === null) return;

    event.preventDefault();
    onSelect(next);
    // The re-render moves the tab stop; the focus has to be moved by hand, or it
    // would stay on the dot the viewer just walked away from.
    dots[next]?.focus();
  }

  return (
    <div
      ref={strip}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1.5 px-1", className)}
    >
      {Array.from({ length: count }, (_, index) => {
        const state: SceneStripState =
          index === selected ? "selected" : index < selected ? "seen" : "upcoming";
        return (
          <button
            key={index}
            type="button"
            // One dot is tabbable and the rest are reachable with the arrow keys —
            // see the note above on why the strip is one control rather than three.
            tabIndex={index === selected ? 0 : -1}
            aria-label={labelFor(index)}
            aria-current={index === selected ? "true" : undefined}
            onClick={() => onSelect(index)}
            className={cn(
              "flex-1 overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2",
              trackClassName,
            )}
          >
            <span className={cn("block h-full rounded-full", fillClassName(state))} />
          </button>
        );
      })}
    </div>
  );
}
