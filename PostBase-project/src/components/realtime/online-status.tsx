"use client";

import { StatusIndicator } from "@/components/ui/status-indicator";
import { usePresence } from "@/hooks/use-presence";

interface OnlineStatusProps {
  userId: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function OnlineStatus({
  userId,
  showText = false,
  size = "md",
  className,
}: OnlineStatusProps) {
  const { isUserOnline, formatLastSeen } = usePresence();
  const isOnline = isUserOnline(userId);
  const lastSeen = formatLastSeen(userId);
  // "Last seen Unknown" is what a straight interpolation produced the moment
  // this sentence started being read aloud; with nothing known, the honest
  // answer is the one the dot was already giving.
  const status = isOnline ? "Online" : lastSeen ? `Last seen ${lastSeen}` : "Offline";

  // The dot and the words are one component now, so this can no longer be
  // written as a coloured dot with nothing behind it: `StatusIndicator` has no
  // spelling without a label, and it hides the mark from a reader rather than
  // the sentence. Green against grey is also the pair a red-green reader is most
  // likely to lose, which is why the words are not allowed to be decoration.
  return (
    <StatusIndicator
      label={status}
      tone={isOnline ? "success" : "neutral"}
      size={size}
      showText={showText}
      className={className}
    />
  );
}
