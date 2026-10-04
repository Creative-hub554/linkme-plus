"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * A tooltip on Radix.
 *
 * Unlike the rest of this kit, a tooltip needs a **`TooltipProvider` above it**.
 * Radix reads the delay and the open/close bookkeeping from that context and
 * throws `` `Tooltip` must be used within `TooltipProvider` `` without one, so a
 * missing provider is loud rather than a tooltip that quietly never appears.
 * Wrapping the app once — a layout, or a providers component — also gives every
 * tooltip a single delay group: resting on one is enough for the next to open at
 * once.
 *
 * This module used to export four no-ops that rendered their children and
 * nothing else, so `TooltipContent`'s text simply appeared as ordinary text and
 * no tooltip existed. `@radix-ui/react-tooltip` was already a dependency.
 */
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-ink-800 px-2.5 py-1.5 text-xs text-white shadow-md animate-in",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent };
