"use client";

import { useCallback, useMemo, useState } from "react";
import { PresenceContext, usePresenceChannel, type PresenceShare } from "@/hooks/use-presence-flags";

/**
 * One presence channel for everything the layout wraps.
 *
 * The strip, a conversation column, a lone indicator in a thread header and a
 * member listing's dialog each used to run `usePresenceFlags` as its own
 * connection: three presence sockets and three roster reads on one messages
 * page, answering the same question with the same data. The channel the hook
 * runs is already written to be *one* answer; what was missing was one place
 * to run it for a page. This is that place — the context the hook reads when
 * it finds one above it, mounted between the layout and its children.
 *
 * The channel runs only while someone is asking. A surface claims it by being
 * `active`, and the claim is released the moment it stops — a dialog closing,
 * a component unmounting — so a page with no presence surface on it (the
 * marketplace, settings) holds no socket at all, and the last release is what
 * lets the connection go rather than a provider idling open for its own sake.
 * A page that keeps a surface asking across navigations keeps the one
 * connection across them, since the layout this mounts in does not remount.
 *
 * A surface outside this provider falls back to running its own channel —
 * what `usePresenceFlags` did before there was a provider, and does still
 * when there is none — so a component mounted bare in a test is unaffected by
 * this having been added above the app.
 */
export function PresenceProvider({ children }: { children: React.ReactNode }) {
  /**
   * How many surfaces are asking right now. A count rather than a set of ids:
   * a claim and its release are one line each, two consumers claiming in the
   * same commit settle into one update, and nothing has to be keyed on a
   * surface's identity — only on whether *someone* wants an answer.
   */
  const [askers, setAskers] = useState(0);

  /** One ask, one release — stable, so a consumer's claim effect runs once. */
  const claim = useCallback<PresenceShare["claim"]>(() => {
    setAskers((count) => count + 1);
    return () => setAskers((count) => count - 1);
  }, []);

  const answer = usePresenceChannel(askers > 0);
  // Memoised like the theme provider's value: the consumers are the strip, a
  // page's rows and a dialog, and none of them should re-render because the
  // provider merely did.
  const value = useMemo(() => ({ answer, claim }), [answer, claim]);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
