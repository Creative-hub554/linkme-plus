import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The ways a field can be named, of which at least one is required: its own
 * `aria-label`, a reference to text elsewhere, or an `id` a `<Label htmlFor>`
 * points at. A field with no way to be named is the trap this closes — a bare
 * `<Input />` announces nothing, and a placeholder is not a name a reader can
 * rely on.
 */
export type FieldNaming =
  | { "aria-label": string; "aria-labelledby"?: never; id?: string }
  | { "aria-labelledby": string; "aria-label"?: never; id?: string }
  | { id: string; "aria-label"?: never; "aria-labelledby"?: never };

export type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "aria-label" | "aria-labelledby" | "id"
> &
  FieldNaming;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
