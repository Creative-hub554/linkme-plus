"use client";

import * as React from "react";
import Link from "next/link";
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  /**
   * The control's name, and the hint that appears on hover and on focus. It is
   * always the beginning of the accessible name, never a different string.
   */
  label: string;
  /**
   * Extra wording the accessible name carries and the hint does not — state the
   * reader does not need, such as a count the visible badge already shows.
   *
   * Appended to {@link label}, so the name stays a superset of what is on screen
   * and WCAG 2.5.3 ("Label in Name": a control's accessible name has to contain
   * its visible label) holds by construction rather than by care.
   */
  detail?: string;
  /**
   * Where the control goes. Set it and the control is a link rather than a
   * button. A control that navigates should be one: a `<button>` with a route
   * `push` in its handler cannot be middle-clicked or opened in a new tab, keeps
   * no address for a screen reader to announce, and shows up in the tab order as
   * something that will act on the page instead of something that will replace
   * it.
   */
  href?: string;
}

/**
 * A control whose meaning is drawn as a glyph and written nowhere.
 *
 * `label` is deliberately the only way to name one: spelling out `aria-label`
 * and a tooltip separately, as the post card's action row used to, is a pairing
 * that a new control can get half right — and half right means something a
 * screen reader announces but a sighted member cannot identify, or the reverse.
 *
 * Not every icon belongs here. A control with a visible text label, or one whose
 * meaning is carried by what it sits next to (the send button beside a comment
 * box), should stay a plain `Button` with an `aria-label`. A control that opens a
 * menu or a dialog should carry no hint at all: the layer says what it is the
 * moment it opens, and a tooltip would talk over it. So should a player control
 * drawn onto the media it controls — the mute and play buttons over a cover
 * video — where the glyph is universally read and the styling is part of the
 * video's own surface.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, detail, variant = "ghost", size = "icon", href, className, children, ...props },
    ref,
  ) {
    const name = detail ? `${label}, ${detail}` : label;

    // `Button` is `asChild`-capable, but it cannot be borrowed here: its slot
    // would be handed to the glyph *inside* the control, not to a link around it.
    // So the link branch borrows only the button's styling, and the props that
    // reach it are the anchor's — the caller wrote an `href`, so that is what its
    // props are for.
    const control =
      href === undefined ? (
        <Button ref={ref} variant={variant} size={size} className={className} {...props} aria-label={name}>
          {children}
        </Button>
      ) : (
        <Link
          href={href}
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={cn(buttonVariants({ variant, size }), className)}
          {...(props as Omit<
            React.ComponentPropsWithoutRef<typeof Link>,
            "href" | "className" | "children" | "aria-label"
          >)}
          aria-label={name}
        >
          {children}
        </Link>
      );

    return (
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  },
);
