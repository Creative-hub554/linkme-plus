"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  /** A read receipt's watermark — how far the reader has caught up. */
  at?: number;
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
  /**
   * Whether this consumer wants a connection at all — `false` keeps the hook
   * idle rather than dialing. A surface that exists in a state nobody is
   * looking at (a dialog mounted closed on the page) still has to call the hook
   * on every render, and this is how it says which of those renders are live:
   * the socket is opened when it flips on and closed when it flips off, so a
   * closed dialog leaves no connection behind.
   */
  enabled?: boolean;
}

/**
 * A connection to a room, raw: no context above it, no claim around it — the
 * channel a provider runs to be *the* connection for its room, and what a
 * consumer falls back to when there is no provider above it. `useWebSocket`
 * is the half that decides; this is the half that connects.
 */
export function useSocketChannel(options: UseWebSocketOptions = {}) {
  const {
    room = "global",
    onMessage,
    onConnect,
    onDisconnect,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    enabled = true,
  } = options;

  const { session } = useSession();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const userId = session?.user?.id;

  const connect = useCallback(() => {
    // Both guards in one place: a disabled hook must not dial, and neither
    // must a reconnect the close handler scheduled just before the hook was
    // disabled — the timeout fires later, into a consumer no longer asking.
    if (!userId || !enabled) return;

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
        // A close event belongs to *this* socket, and by the time it arrives
        // the hook may have moved on: `disconnect` drops the reference before
        // closing, and a re-open has already installed a replacement. Touching
        // shared state from a socket that is no longer current would wipe the
        // live connection's reference and schedule a reconnect nobody asked
        // for — into a hook that was disabled between the close and the event.
        if (wsRef.current !== ws) return;
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
  }, [userId, enabled, room, onMessage, onConnect, onDisconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    if (wsRef.current) {
      // The reference goes first: `close()` reports back — synchronously in a
      // test's fake, a tick later in a browser — and the handler above reads
      // that reference to tell a stale socket from the current one.
      const ws = wsRef.current;
      wsRef.current = null;
      ws.close();
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

  /**
   * "I have read up to here" — sent right after the mark-read request the
   * server has already answered, with the watermark *it* issued, so the other
   * side compares against the same clock that stamped the messages.
   */
  const sendRead = useCallback(
    (conversationId: string, at: number) => {
      send({ type: "read", conversationId, at });
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
    if (userId && enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [userId, enabled, connect, disconnect]);

  // Heartbeat to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      ping();
    }, 30000);

    return () => clearInterval(interval);
  }, [isConnected, ping]);

  // One object held still while its fields are. The states above are the only
  // things that ever change — every method is a `useCallback` and `userId`
  // moves with the session — so a provider handing this channel through
  // context memoised on it re-renders its consumers only when the connection
  // actually says something new, rather than on every render it makes.
  return useMemo(
    () => ({
      isConnected,
      lastMessage,
      /** This socket's verified member — the one things like the typing
       * indicator must not show back to their own author. */
      userId,
      send,
      sendTyping,
      stopTyping,
      sendMessage,
      sendRead,
      sendNotification,
      joinRoom,
      leaveRoom,
      ping,
      connect,
      disconnect,
    }),
    [
      isConnected,
      lastMessage,
      userId,
      send,
      sendTyping,
      stopTyping,
      sendMessage,
      sendRead,
      sendNotification,
      joinRoom,
      leaveRoom,
      ping,
      connect,
      disconnect,
    ],
  );
}

/**
 * One room's connection, shared: the channel every consumer under the
 * provider reads, and the claim that keeps it dialing while any of them is
 * asking for one.
 */
export interface SocketShare {
  /** The room the connection joined — a consumer asking for another room does not read it. */
  room: string;
  /** The room's one connection, in full: everything the raw channel answers. */
  channel: ReturnType<typeof useSocketChannel>;
  /**
   * One consumer starting to ask: increments how many are, and returns the
   * release that decrements it when the consumer stops (its `enabled` flipped)
   * or goes away. The provider runs its channel while the count is above zero
   * — which is what lets a chat bubble, a messages page and a typing indicator
   * share one socket instead of each paying for a connection that carried the
   * same frames.
   */
  claim: () => () => void;
}

/**
 * The room's shared connection, when a page has one: `null` outside a
 * provider — a component test mounting a surface bare, or a surface no layout
 * wraps — and then each caller runs a channel of its own, exactly as before
 * there was one to share.
 */
export const SocketContext = createContext<SocketShare | null>(null);

/**
 * A connection to a room: the one every consumer in the app called this for
 * until now, one socket each — the chat bubble, the messages page and the
 * thread's typing indicator all asked for room `global`, so a reader paid for
 * three connections carrying the same frames. Which channel answers is
 * decided here:
 *
 * - **A provider above means one connection for the room.** The consumer
 *   claims it for exactly as long as it wants one and reads its answer, so
 *   those three are one socket between them — and nothing dials while nobody
 *   is asking, so a page with no consumer on it holds no connection either.
 * - **A consumer that *configured* the connection gets its own.** Callbacks
 *   (`onMessage` and the rest) and reconnect tuning belong to a single
 *   connection; a shared one cannot honor a per-consumer set, so a consumer
 *   bringing them dials its own rather than silently not receiving them.
 *   What this app's consumers want — frames to read, a socket to send on —
 *   is exactly what sharing gives.
 * - **No provider means this hook *is* the channel.** Fallback is not a mode
 *   anyone opts into: a surface mounted without a layout (every component
 *   test) behaves exactly as it did before there was a provider to share,
 *   options and all.
 */
export function useWebSocket(
  options: UseWebSocketOptions = {},
): ReturnType<typeof useSocketChannel> {
  const shared = useContext(SocketContext);
  const enabled = options.enabled ?? true;

  const shareable =
    shared !== null &&
    shared.room === (options.room ?? "global") &&
    options.onMessage === undefined &&
    options.onConnect === undefined &&
    options.onDisconnect === undefined &&
    options.reconnectInterval === undefined &&
    options.maxReconnectAttempts === undefined;

  // Null-checked first so each half of the guard has a path that reaches it:
  // no provider, a provider whose room or configuration this consumer did not
  // ask for, and the shareable case itself.
  const claim = shared !== null && shareable ? shared.claim : undefined;

  // The claim is an effect, not a value: made when this consumer starts
  // wanting a connection and released the moment it stops — an `enabled` flip
  // or an unmount — so the provider's count never holds a consumer that no
  // longer wants anything. `claim` itself is stable (the provider's
  // `useCallback`), so an answering consumer does not re-claim on every frame
  // that arrives through the context it claimed.
  useEffect(() => {
    if (!claim || !enabled) return;
    return claim();
  }, [claim, enabled]);

  // Its own channel only where there is nobody shared to ask through: under a
  // provider this hook dials nothing itself, however many of it are mounted.
  const own = useSocketChannel({ ...options, enabled: shareable ? false : options.enabled });

  // Inactive is the same nothing shared as unshared — a consumer reads its own
  // inert channel rather than a shared answer it is not asking for.
  if (shared !== null && shareable && enabled) return shared.channel;
  return own;
}
