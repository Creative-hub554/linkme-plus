"use client";

import * as React from "react";
import { ToggleButton, type ToggleButtonProps } from "@/components/ui/toggle-button";
import { cn } from "@/lib/utils";

/**
 * `size` is omitted as well as the state props `ToggleButton` already refuses: a
 * row of these reads as one control, and a chip that is taller than its
 * neighbours reads as a different kind of thing.
 */
export interface FilterChipProps extends Omit<ToggleButtonProps, "pressed" | "size"> {
  /** Whether this chip is the one filtering what is on screen. */
  selected: boolean;
}

/**
 * One option in a single-select row of chips.
 *
 * In these rows, selection is *drawn* and nothing else: the chosen chip is
 * filled and the rest are outlined. That is a perfectly clear signal to anyone
 * looking at the screen and no signal whatsoever to anyone who is not — the
 * colour is the whole message, which is also the shape the WCAG "use of colour"
 * rule warns about.
 *
 * `aria-pressed` is what turns the fill into something a screen reader says, and
 * the pairing is not this component's care any more: it is the one `ToggleButton`
 * makes, and `selected` is only the name a chip row uses for the same boolean.
 * There is no spelling of this component that draws a chosen chip silently.
 *
 * The row around these should carry `role="group"` and an `aria-label`: a set of
 * pressed buttons says which one is on, and the group says what is being
 * filtered. An `aria-label` on a plain `div` is ignored — it needs the role to
 * have anything to attach to, and the rendered audit fails a group with no name.
 *
 * A row on a dark card passes `surface="dark"` and nothing else about its looks.
 * It must not be given a background of its own: a caller's `bg-*` replaces the
 * variant's fill, so the row would go on looking unpressed while announcing that
 * one of its chips is on. `surface` is the whole of the styling a caller decides.
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  function FilterChip({ selected, className, ...props }, ref) {
    return (
      <ToggleButton
        ref={ref}
        pressed={selected}
        size="sm"
        className={cn("whitespace-nowrap", className)}
        {...props}
      />
    );
  },
);
