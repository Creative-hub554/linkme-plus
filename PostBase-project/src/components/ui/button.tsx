import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand-blue text-white hover:bg-brand-blue-dark",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-card hover:bg-accent hover:text-accent-foreground",
        // The same outlined shape for a card that is not white. The cover
        // studio's panels are dark, and an `outline` there is a solid white
        // pill whose white contents vanish into it.
        //
        // Note the border colour does not currently take effect anywhere in
        // this app: `globals.css` sets `* { border-color: hsl(var(--border)) }`
        // outside any `@layer`, and unlayered CSS beats every Tailwind utility
        // in `@layer utilities`, so all `border-<colour>` classes render as that
        // one slate. It is written here because it is the intent, and because it
        // starts working the day that rule moves into `@layer base`.
        onDark: "border border-white/20 bg-white/5 text-white hover:bg-white/10",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-brand-blue underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * What the control says, and why it is required: a button's name is its own
   * content, so a `<Button />` with nothing inside renders a control that
   * announces "button" and nothing else. A control that is *only* a glyph says
   * its name through `IconButton`, which cannot be written without a `label`.
   *
   * Required rather than merely expected, so the nameless button is a type error
   * where it is written instead of a finding the rendered audit has to catch
   * later — the same construction `StatusIndicator` uses for its `label`.
   */
  children: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
