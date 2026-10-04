"use client";

import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "@/hooks/use-websocket";

interface PresenceInfo {
  online: boolean;
  lastSeen: number;
}

export function usePresence(_targetUserId?: string) {
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceInfo>>(new Map());
  const { isConnected, send, lastMessage } = useWebSocket({
    room: "presence",
  });

  // Track online users
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case "user:online": {
        const { userId } = lastMessage;
        if (typeof userId !== "string") break;
        setPresenceMap((prev) => {
          const next = new Map(prev);
          next.set(userId, {
            online: true,
            lastSeen: Date.now(),
          });
          return next;
        });
        break;
      }

      case "user:offline": {
        const { userId } = lastMessage;
        if (typeof userId !== "string") break;
        setPresenceMap((prev) => {
          const next = new Map(prev);
          next.set(userId, {
            online: false,
            lastSeen: Date.now(),
          });
          return next;
        });
        break;
      }
    }
  }, [lastMessage]);

  // Check if specific user is online
  const isUserOnline = useCallback(
    (userId: string): boolean => {
      const presence = presenceMap.get(userId);
      return presence?.online ?? false;
    },
    [presenceMap]
  );

  // Get user's last seen time
  const getLastSeen = useCallback(
    (userId: string): number | null => {
      const presence = presenceMap.get(userId);
      return presence?.lastSeen ?? null;
    },
    [presenceMap]
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
    [getLastSeen]
  );

  // Request presence for specific user
  const checkPresence = useCallback(
    (userId: string) => {
      send({ type: "check-presence", userId });
    },
    [send]
  );

  return {
    isUserOnline,
    getLastSeen,
    formatLastSeen,
    checkPresence,
    isConnected,
  };
}
