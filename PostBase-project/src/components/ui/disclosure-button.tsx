"use client";

import * as React from "react";
import { IconButton, type IconButtonProps } from "@/components/ui/icon-button";

/**
 * `href` is missing because a disclosure is not a destination, and the two
 * attributes it owns are missing because they are the whole reason it exists.
 */
export interface DisclosureButtonProps
  extends Omit<IconButtonProps, "aria-expanded" | "aria-controls" | "href"> {
  /** Whether the region this control owns is open. It *is* `aria-expanded`. */
  open: boolean;
  /** The `id` of the region. It *is* `aria-controls`. */
  controls: string;
}

/**
 * A control that opens and closes a region, and says which way it is.
 *
 * The defect this exists to end: the nav's mobile menu button was a hamburger
 * that became an ×, with no `aria-expanded` and no name, so nothing about it
 * announced that there was a panel or that one had just opened. Whether that was
 * open lived in a `useState` the button rendered and never reported.
 *
 * Here there is one boolean. `open` sets `aria-expanded`, names the region
 * through `aria-controls`, and the caller cannot pass either attribute — so a
 * disclosure drawn with this component always reports its own state, and the
 * only way to write one that does not is to stop using the component, which the
 * rendered audit catches.
 *
 * The region is usually mounted only while open, so `aria-controls` names an id
 * that is absent when closed. That is what the app did by hand before this
 * component existed and it is what most React popovers do; `aria-expanded` is
 * the attribute assistive technology actually reads, and it is always present
 * and always right.
 */
export const DisclosureButton = React.forwardRef<HTMLButtonElement, DisclosureButtonProps>(
  function DisclosureButton({ open, controls, ...props }, ref) {
    return (
      <IconButton
        ref={ref}
        {...props}
        // Derived after the spread, so the state the caller passed is the one
        // that reaches the DOM.
        aria-expanded={open}
        aria-controls={controls}
      />
    );
  },
);
