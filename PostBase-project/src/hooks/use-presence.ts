"use client";

import { useCallback } from "react";
import { usePresenceFlags } from "@/hooks/use-presence-flags";

/**
 * One indicator's read of who is here — an adapter, not another answer.
 *
 * This hook used to own a socket of its own and listen to `user:online` /
 * `user:offline` frames alone: no roster, no snapshot, nothing that had been
 * true before it connected. The strip read the roster and the snapshot, so the
 * two disagreed about the same member — green in one place, grey in the other
 * — because they were genuinely different questions. It now delegates to
 * {@link usePresenceFlags}, the hook the strip and the listings read, so there
 * is one roster, one socket, and one set of rules; a surface cannot disagree
 * with the strip because there is no second opinion left to hold.
 *
 * `active` is that hook's flag: `false` when the answer is handed in from
 * elsewhere (a conversation column that already asked passes its verdict down),
 * so a list of twenty indicators is one connection rather than twenty. A
 * caller that never passes the flag — a lone indicator — asks for itself,
 * which is the shape the words below were written for.
 *
 * The verdict arrives as `boolean | null`, where `null` is *not yet asked*.
 * The listings draw nothing for that (a row with no answer claims nothing),
 * but a lone indicator has no "unasked" sentence to say: it has always fallen
 * back to "Offline" before an answer, and keeps doing so — the honesty rule
 * lives where the listing draws, because that is where silence is possible.
 */
export function usePresence(active = true) {
  const { isOnline, lastSeenAt, isConnected, send } = usePresenceFlags(active);

  /** A drawn verdict: `null` (never asked) folds to away, as the words below have always done. */
  const isUserOnline = useCallback(
    (userId: string): boolean => isOnline(userId) === true,
    [isOnline],
  );

  // Get user's last seen time
  const getLastSeen = useCallback(
    (userId: string): number | null => lastSeenAt(userId),
    [lastSeenAt],
  );

  // Format last seen time
  /**
   * How long ago the user was last seen, or `null` when there is nothing to
   * say — which is not the same as "a while ago", so it is not spelled out as
   * a word here. The component that shows it decides what to say instead; a
   * hook that returns the sentence "Unknown" puts the wording somewhere the
   * words are not.
   */
  const formatLastSeen = useCallback(
    (userId: string): string | null => {
      const lastSeen = getLastSeen(userId);
      if (!lastSeen) return null;

      const now = Date.now();
      const diff = now - lastSeen;

      if (diff < 60000) return "Just now";
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return `${Math.floor(diff / 86400000)}d ago`;
    },
    [getLastSeen],
  );

  // Request presence for specific user
  const checkPresence = useCallback(
    (userId: string) => {
      send({ type: "check-presence", userId });
    },
    [send],
  );

  return {
    isUserOnline,
    getLastSeen,
    formatLastSeen,
    checkPresence,
    isConnected,
  };
}
