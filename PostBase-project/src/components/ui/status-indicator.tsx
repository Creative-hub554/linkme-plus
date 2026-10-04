"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusIndicatorProps {
  /**
   * What the state *is*, in words. Required, and that is the entire point: the
   * mark below it is a colour, and a colour has no meaning to a reader who
   * cannot see it.
   */
  label: string;
  tone?: StatusTone;
  size?: "sm" | "md" | "lg";
  /** Draw the words as well as the mark instead of only reading them out. */
  showText?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-2 w-2",
  md: "h-3 w-3",
  lg: "h-4 w-4",
};

const toneClasses: Record<StatusTone, string> = {
  success: "bg-green-500",
  warning: "bg-yellow-500",
  danger: "bg-red-500",
  info: "bg-brand-blue",
  neutral: "bg-gray-400",
};

/**
 * A state drawn as a mark, with the words that say what it is.
 *
 * `OnlineStatus` was a green dot or a grey dot and nothing else — the colour was
 * the entire message, which is also the pair a reader with a red-green
 * deficiency is most likely to lose. It was fixed by pairing the dot with text,
 * and this is that pairing as a component so it does not have to be remembered:
 * `label` is required, the mark is always `aria-hidden`, and the words are
 * always in the markup whether or not the caller wanted them on screen.
 *
 * It renders a `<span>`, because a mark sits inside things — a conversation row,
 * a button, a notification item — and a `<div>` there is invalid markup inside a
 * button. The dot is a span too, so a caller's `className` lands on the wrapper
 * exactly as it would on a hand-written dot's parent.
 *
 * The text stays muted whatever the tone: the colour belongs to the mark, and
 * colouring the sentence as well would be the same signal delivered twice.
 */
export function StatusIndicator({
  label,
  tone = "neutral",
  size = "md",
  showText = false,
  className,
}: StatusIndicatorProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* Decorative: the words below carry the state either way, so exposing a
          span with no text only adds noise. */}
      <span aria-hidden="true" className={cn("rounded-full", sizeClasses[size], toneClasses[tone])} />
      <span className={cn("text-xs text-muted-foreground", !showText && "sr-only")}>{label}</span>
    </span>
  );
}
