import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineNoticeProps {
  /** The message itself, or a control that carries one. */
  children: ReactNode;
  /** Required: every notice is dismissible, so none can get stuck on screen. */
  onDismiss: () => void;
  className?: string;
}

/**
 * A transient status line that sits above a page's main content.
 *
 * It owns only what the notices share — the polite live region, the spacing and
 * the dismiss button — so a caller supplies just its own message. `role="status"`
 * with `aria-live="polite"` is deliberate: a screen reader announces it without
 * interrupting, which is what a courtesy notice wants. Anything that must
 * interrupt belongs in the page's own `role="alert"` banner instead, not here.
 */
export function InlineNotice({ children, onDismiss, className }: InlineNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border border-surface-border bg-surface-light-blue px-4 py-3 text-sm text-navy-700",
        className,
      )}
    >
      <div className="min-w-0">{children}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="shrink-0 rounded-md p-1 text-navy-600 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
