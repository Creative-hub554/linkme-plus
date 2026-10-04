"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSession } from "@/lib/auth-client";

interface WebSocketMessage {
  type: string;
  /** Well-known fields, typed so consumers can narrow them; anything else a
   * sender adds rides along through the index signature as `unknown`. */
  userId?: string;
  conversationId?: string;
  content?: string;
  room?: string;
  targetUserId?: string;
  timestamp?: number;
  [key: string]: unknown;
}

interface UseWebSocketOptions {
  room?: string;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    room = "global",
    onMessage,
    onConnect,
    onDisconnect,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const { session } = useSession();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const userId = session?.user?.id;

  const connect = useCallback(() => {
    if (!userId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?userId=${userId}&room=${room}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        reconnectAttempts.current = 0;
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          onMessage?.(message);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        wsRef.current = null;
        onDisconnect?.();

        // Attempt to reconnect
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          reconnectTimeout.current = setTimeout(() => {
            connect();
          }, reconnectInterval * Math.min(reconnectAttempts.current, 5));
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
    }
  }, [userId, room, onMessage, onConnect, onDisconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendTyping = useCallback(
    (conversationId: string) => {
      send({ type: "typing", conversationId });
    },
    [send]
  );

  const stopTyping = useCallback(
    (conversationId: string) => {
      send({ type: "stop-typing", conversationId });
    },
    [send]
  );

  const sendMessage = useCallback(
    (conversationId: string, content: string) => {
      send({ type: "message", conversationId, content });
    },
    [send]
  );

  const sendNotification = useCallback(
    (targetUserId: string, notification: Record<string, unknown>) => {
      send({ type: "notification", targetUserId, ...notification });
    },
    [send]
  );

  const joinRoom = useCallback(
    (newRoom: string) => {
      send({ type: "join-room", room: newRoom });
    },
    [send]
  );

  const leaveRoom = useCallback(
    (oldRoom: string) => {
      send({ type: "leave-room", room: oldRoom });
    },
    [send]
  );

  const ping = useCallback(() => {
    send({ type: "ping" });
  }, [send]);

  useEffect(() => {
    if (userId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [userId, connect, disconnect]);

  // Heartbeat to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      ping();
    }, 30000);

    return () => clearInterval(interval);
  }, [isConnected, ping]);

  return {
    isConnected,
    lastMessage,
    send,
    sendTyping,
    stopTyping,
    sendMessage,
    sendNotification,
    joinRoom,
    leaveRoom,
    ping,
    connect,
    disconnect,
  };
}
