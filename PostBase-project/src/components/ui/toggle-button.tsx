"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * `variant`, `type` and `aria-pressed` are all missing from the props on
 * purpose. Each one is a thing a caller can get *half* right — a fill without
 * the announcement, or a bare button that submits the form it sits in — and
 * omitting them is what makes the half-right version unrepresentable rather
 * than merely discouraged.
 */
export interface ToggleButtonProps
  extends Omit<ButtonProps, "variant" | "type" | "aria-pressed"> {
  /**
   * Whether this control is currently on. It picks the variant *and* sets
   * `aria-pressed`, so the two cannot disagree.
   */
  pressed: boolean;
  /**
   * What the control is sitting on. "light" gets the outlined look; "dark" gets
   * the outlined-on-a-dark-card look, which is the same shape with a translucent
   * fill and white contents.
   *
   * A *surface* rather than the two variants, and that distinction is the whole
   * reason this prop exists. A caller that could choose the off-look could also
   * destroy the on-look: `cn` runs through `tailwind-merge`, so a caller's
   * `bg-*` class replaces the variant's fill — measured, not assumed, and it is
   * how `FollowButton` and the chips could each have been written to disappear
   * when pressed. Here the only thing a caller says is where the control *is*;
   * both looks stay the component's to derive, and `pressed` still always means
   * the filled one.
   */
  surface?: "light" | "dark";
}

/**
 * A button that is on or off, where "on" is drawn as a fill.
 *
 * The fill and the announcement are one fact with two renderings, and a control
 * that keeps them in separate props can be written half right. That is not
 * hypothetical here: four filter rows in this app shipped as the filled chip
 * that announced nothing, because the fill was a `variant` and the announcement
 * would have been a second, easily-forgotten prop. One boolean removes the
 * question — a caller has nothing to remember.
 *
 * `FilterChip` is this component wearing a chip row's clothes and `FollowButton`
 * is the same pairing doing a different job; both decide their *words* ("Follow"
 * / "Following") in one place as well, so there is no second boolean to drift.
 *
 * Not every button that changes should be one of these. A control whose state is
 * entirely in its words — the post card's bookmark, which becomes "Remove
 * bookmark" — says so in its name and needs no `aria-pressed` beside it.
 */
export const ToggleButton = React.forwardRef<HTMLButtonElement, ToggleButtonProps>(
  function ToggleButton({ pressed, surface = "light", className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        // Spread first, derived after: a value that reaches this component
        // through a cast still cannot win over the one the state produced.
        {...props}
        className={className}
        // Forced rather than defaulted. Every toggle in this app sits inside
        // page markup where the button's own default would be `submit`.
        type="button"
        variant={pressed ? "default" : surface === "dark" ? "onDark" : "outline"}
        aria-pressed={pressed}
      />
    );
  },
);
