"use client";

import { useCallback, useEffect, useRef } from "react";

/** How often a continuing typist refreshes the announcement — comfortably
 * under the indicator's five-second staleness window, without turning every
 * keystroke into a frame. */
const REFRESH_MS = 3000;

/** How long a pause goes before the typist is announced as done. */
const IDLE_MS = 3000;

type SendFrame = (message: { type: string; conversationId: string }) => void;

/**
 * The composer's half of the typing indicator: turning keystrokes into the
 * two frames the other side needs.
 *
 * The protocol has only a start and a stop, so this hook owns the middle: the
 * first keystroke announces `typing`, a continuing typist re-announces on a
 * three-second beat (the listener forgets anyone it has not heard from in
 * five), and three quiet seconds send `stop-typing` — as does releasing the
 * hook for any reason: the message went out, the reader switched conversations,
 * or the composer unmounted. A pause that never got an announcement must not
 * produce a stop for it, so `stop` is only ever sent for an announcement that
 * was actually made.
 *
 * The frame is passed to whatever `send` the surface already owns — the same
 * socket that carries that surface's other relays — rather than opening one of
 * its own.
 */
export function useTypingAnnouncer(
  send: SendFrame,
  conversationId: string | null,
): { onType: () => void; release: () => void } {
  /** The conversation last *announced* — which may be the previous one, if
   * the reader switched threads mid-sentence; the stop must name it. */
  const announcedFor = useRef<string | null>(null);
  const typing = useRef(false);
  const lastSentAt = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (typing.current && announcedFor.current) {
      send({ type: "stop-typing", conversationId: announcedFor.current });
    }
    typing.current = false;
    announcedFor.current = null;
  }, [send]);

  const onType = useCallback(() => {
    if (!conversationId) return;
    // A switch may have committed before the previous announcement's cleanup
    // ran; closing the old one first keeps one announcement per conversation.
    if (announcedFor.current && announcedFor.current !== conversationId) release();
    const now = Date.now();

    if (!typing.current) {
      typing.current = true;
      announcedFor.current = conversationId;
      send({ type: "typing", conversationId });
      lastSentAt.current = now;
    } else if (now - lastSentAt.current >= REFRESH_MS) {
      // The announcement exists already; this only keeps it fresh.
      send({ type: "typing", conversationId });
      lastSentAt.current = now;
    }

    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      if (typing.current && announcedFor.current) {
        send({ type: "stop-typing", conversationId: announcedFor.current });
      }
      typing.current = false;
      announcedFor.current = null;
    }, IDLE_MS);
  }, [send, conversationId, release]);

  // Switching threads (or leaving) ends the announcement for the old one —
  // the listener would otherwise hold a typist who is no longer there.
  useEffect(() => release, [conversationId, release]);

  return { onType, release };
}
