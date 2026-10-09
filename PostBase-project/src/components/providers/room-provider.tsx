"use client";

import { useCallback, useMemo, useState } from "react";
import { SocketContext, useSocketChannel, type SocketShare } from "@/hooks/use-websocket";

/**
 * One connection for every consumer in a room.
 *
 * The chat bubble, the messages page and the thread's typing indicator each
 * called `useWebSocket({ room: "global" })` — three sockets per signed-in
 * page carrying the same frames, sending on one what the others then heard as
 * if it had arrived fresh. The channel was already the same for all three;
 * what was missing was one place to *run* it for a page. This is that place —
 * the context `useWebSocket` reads when it finds one above it, mounted between
 * the root layout and the chrome that asks.
 *
 * The connection runs only while a consumer wants one. Claiming happens in
 * `useWebSocket`'s effect: a consumer claims while it is mounted and enabled,
 * and its release is what lets go — so a page whose surfaces all unmount (or
 * one that goes signed-out, where nothing dials anyway) holds no connection,
 * and the last release hangs up rather than a provider idling open for its
 * own sake. A layout that stays mounted across navigations keeps the one
 * connection across them, which is why the root layout is where this sits: the
 * bubble is mounted there, and the messages page below it joins the socket
 * that already exists instead of opening a second.
 *
 * A consumer that brought its own configuration — callbacks, reconnect
 * tuning — falls back to its own connection (see `useWebSocket`), so what
 * this collapses is the app's actual consumers: the default-options ones,
 * which are all of them.
 */
export function RoomProvider({ room, children }: { room: string; children: React.ReactNode }) {
  /**
   * How many consumers are asking for a connection right now. A count rather
   * than a set of identities: a claim and its release are one line each, two
   * consumers claiming in the same commit settle into one update, and nothing
   * has to be keyed on *who* wants it — only on whether anyone does.
   */
  const [askers, setAskers] = useState(0);

  /** One ask, one release — stable, so a consumer's claim effect runs once. */
  const claim = useCallback<SocketShare["claim"]>(() => {
    setAskers((count) => count + 1);
    return () => setAskers((count) => count - 1);
  }, []);

  const channel = useSocketChannel({ room, enabled: askers > 0 });
  // Memoised like the theme and presence providers' values: the consumers are
  // a floating bubble, a conversation page and an indicator, and none should
  // re-render because the provider merely did.
  const value = useMemo(() => ({ room, channel, claim }), [room, channel, claim]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
