"use client";

import { StatusIndicator } from "@/components/ui/status-indicator";
import { usePresence } from "@/hooks/use-presence";

interface OnlineStatusProps {
  userId: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  /**
   * A verdict the list above already asked for — the conversation column's
   * single read of {@link usePresenceFlags}, handed to each row. When it is
   * given, this indicator dials nothing of its own: twenty rows are one
   * connection and one roster beat, not twenty of each, and because the verdict
   * comes from the same hook the strip reads, the row and the strip cannot
   * disagree about the same member. `null` is that hook's "not answered yet",
   * which the words below treat as away — the honest fallback for an
   * indicator that may simply not have been told anything yet.
   *
   * When it is omitted the indicator asks for itself — the shape a lone
   * indicator (the thread header) needs, and the only one that can say
   * "last seen", since the column's read dates only the verdicts, not the
   * sentences.
   */
  presence?: boolean | null;
}

export function OnlineStatus({
  userId,
  showText = false,
  size = "md",
  className,
  presence,
}: OnlineStatusProps) {
  // `active` only while this indicator has to ask: a row handed a verdict
  // subscribes to nothing, so the column's one socket stays the column's.
  const { isUserOnline, formatLastSeen } = usePresence(presence === undefined);
  const online = presence !== undefined ? presence === true : isUserOnline(userId);
  const lastSeen = formatLastSeen(userId);
  // "Last seen Unknown" is what a straight interpolation produced the moment
  // this sentence started being read aloud; with nothing known, the honest
  // answer is the one the dot was already giving.
  const status = online ? "Online" : lastSeen ? `Last seen ${lastSeen}` : "Offline";

  // The dot and the words are one component now, so this can no longer be
  // written as a coloured dot with nothing behind it: `StatusIndicator` has no
  // spelling without a label, and it hides the mark from a reader rather than
  // the sentence. Green against grey is also the pair a red-green reader is most
  // likely to lose, which is why the words are not allowed to be decoration.
  return (
    <StatusIndicator
      label={status}
      tone={online ? "success" : "neutral"}
      size={size}
      showText={showText}
      className={className}
    />
  );
}
