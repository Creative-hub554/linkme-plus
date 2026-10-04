import * as React from "react";
import { cn } from "@/lib/utils";
import type { FieldNaming } from "@/components/ui/input";

/**
 * A textarea is a field like any other, so it carries the same requirement: a
 * name of its own, a reference to one, or an `id` a label can point at.
 */
export type TextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "aria-label" | "aria-labelledby" | "id"
> &
  FieldNaming;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
