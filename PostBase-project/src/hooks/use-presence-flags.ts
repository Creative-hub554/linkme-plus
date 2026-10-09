"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useWebSocket } from "@/hooks/use-websocket";

/** How often the roster is re-read while no socket carries the answers. */
const HEARTBEAT_MS = 30_000;

/** One member as the roster answers them: who they are, and whether they are here. */
export interface RosterMember {
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  online: boolean;
}

/**
 * One read of the roster: the heartbeat that counts the reader in *and*
 * answers with every member flagged online or not, in a single round trip —
 * the one request every presence surface sends, since they all read this hook. `null` when it cannot be answered, so a
 * failed read never becomes a verdict of "offline": not knowing and knowing
 * someone is away are different answers, and only the second may be drawn.
 */
async function readRoster(): Promise<RosterMember[] | null> {
  try {
    const response = await fetch("/api/presence", { method: "POST", cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { users?: unknown };
    if (!Array.isArray(payload.users)) return null;
    const members = payload.users
      .filter(
        (entry): entry is RosterMember =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RosterMember).userId === "string" &&
          typeof (entry as RosterMember).online === "boolean",
      )
      .map((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName ?? null,
        avatarUrl: entry.avatarUrl ?? null,
        online: entry.online,
      }));
    // An empty roster is not "everyone is away" — it is an answer that could
    // not be about this list, so it is treated the same as no answer at all.
    return members.length > 0 ? members : null;
  } catch {
    return null;
  }
}

/**
 * Who is here, for a listing that names its members: one read for the whole
 * list, handed to each row as a verdict it can draw.
 *
 * `OnlineNow` asked one narrow question — who is here — and drew nobody who
 * was not. A followers list asks a different one: of *these* members, who is
 * here? The answer is the same two halves the strip settled on, for the same
 * reasons:
 *
 * - **The socket decides while it answers.** `/ws` sends a snapshot of everyone
 *   connected the moment this hook connects, then `user:online` /
 *   `user:offline` as it changes — so a row flips the moment somebody arrives
 *   rather than whenever the next beat comes round, and a connection that closed
 *   a second ago is away whatever the last beat said.
 * - **The heartbeat roster stands in while no socket answers** — the server's
 *   registry, refreshed on its slow interval, is the honest picture a
 *   disconnected client can still get.
 * - **`null` is its own answer**: nothing has been asked yet (or the ask
 *   failed), and a caller renders that as *no status at all* rather than
 *   claiming somebody is away before anything was known.
 *
 * `active` is how a surface that exists while closed — a dialog mounted on the
 * page before anyone opens it — dials only while open. It is handed to the
 * socket as its `enabled` flag, so an inactive hook neither fetches nor
 * connects, and closing the surface lets go of the connection it held.
 *
 * One hook, one socket: a twenty-row listing asks once above and reads per row,
 * rather than each row opening a presence connection of its own.
 *
 * This channel is also **the one answer** every surface reads. The strip, a
 * listing, the conversation column and a lone indicator used to each keep a
 * partial copy of these halves — and a lone one that heard only incremental
 * frames disagreed with the strip that read the roster, which is how the same
 * member could be green in one place and grey in the other. They all read
 * here now, so there is one roster, one socket, and one set of rules to be
 * right about; a surface that asks once above and passes verdicts down (the
 * conversation column) is the same answer, taken once.
 *
 * Which channel runs is `usePresenceFlags`'s call: a page whose layout mounts
 * a `PresenceProvider` runs *one* of these for the whole page — strip,
 * conversation column and dialog together, one socket and one read between
 * them — and a surface no provider wraps runs its own, exactly as here.
 */
export function usePresenceChannel(active: boolean) {
  const { session } = useSession();
  // The id, not the session object: a client may hand back a fresh reference
  // per render, and an effect keyed on that would read the roster again on
  // every one of them.
  const userId = session?.user?.id;

  /** The roster's flags — every member, either verdict — until a socket supersedes them. */
  const [flags, setFlags] = useState<Map<string, boolean> | null>(null);
  /**
   * The roster's entries themselves, in the order the route answered — the
   * flags above say *whether*; a surface that draws faces and names (the strip)
   * needs the *who*, and reading it from here is what keeps the listing and
   * its rows on the same roster rather than two reads of it.
   */
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  /**
   * When each member was last *heard* moving — stamped by the socket's own
   * frames, the only thing that dates a member rather than flagging them.
   * Kept here because the frames land here: one place hears them for every
   * surface, so "last seen" cannot drift from "online".
   */
  const [lastSeen, setLastSeen] = useState<Map<string, number>>(new Map());
  /**
   * The socket's verdict while there is one: everyone connected, and so — by
   * omission — who is not. `null` while no socket has answered, which is when
   * the roster's own flags are the best there is.
   */
  const [live, setLive] = useState<Map<string, boolean> | null>(null);

  const { isConnected, lastMessage, send } = useWebSocket({ room: "presence", enabled: active });

  const applyRoster = useCallback((users: RosterMember[] | null) => {
    if (!users) return;
    setRoster(users);
    setFlags(new Map(users.map((member) => [member.userId, member.online])));
  }, []);

  // The roster: read the moment this hook starts asking — *regardless of the
  // socket's state*. The snapshot that arrives when a socket connects is the
  // moment's verdict, but it carries no names and nothing about the members
  // who were already here before this hook existed, so the roster is not a
  // fallback for a silent socket — it is the list the verdicts are read
  // against, and the only source of the faces the strip draws. Keying this
  // read on `isConnected`, as it used to be, let the connection win the race
  // two ways: a socket that connected first skipped the read outright, and one
  // that connected while it was in flight cancelled it — so the strip, the
  // conversation column and the dialog each lost the same roster the same way,
  // and a member the server flagged here was drawn grey everywhere.
  useEffect(() => {
    if (!active || !userId) return;
    let cancelled = false;
    void readRoster().then((users) => {
      if (!cancelled) applyRoster(users);
    });
    return () => {
      cancelled = true;
    };
  }, [active, userId, applyRoster]);

  // …and the socket's two edges, while it is down: a drop re-reads at once —
  // its verdicts are frozen history the moment it hangs up, so the roster is
  // the live answer again without waiting a beat — and the interval refreshes
  // it and retries a read that failed. The drop is *detected* rather than
  // assumed: an activation that has never been connected does not read here
  // (the effect above already did, and one arrival is one beat), which is why
  // the connection's arrival marks rather than asks.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (!active || !userId) {
      wasConnected.current = false;
      return;
    }
    if (isConnected) {
      wasConnected.current = true;
      return;
    }
    let cancelled = false;
    if (wasConnected.current) {
      wasConnected.current = false;
      void readRoster().then((users) => {
        if (!cancelled) applyRoster(users);
      });
    }
    const timer = setInterval(() => {
      void readRoster().then(applyRoster);
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, userId, isConnected, applyRoster]);

  // Down means the socket's verdict is frozen history; the roster's flags are
  // the live answer again until a snapshot replaces them on the way back up.
  useEffect(() => {
    if (!isConnected) setLive(null);
  }, [isConnected]);

  // The realtime half: everything the socket says about who is here.
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case "presence:snapshot": {
        const ids = lastMessage.userIds;
        if (!Array.isArray(ids)) break;
        // Built complete on purpose: a member *absent* from the snapshot is
        // offline, rather than unlisted and therefore keeping an old flag.
        const next = new Map<string, boolean>();
        for (const id of ids) {
          if (typeof id === "string") next.set(id, true);
        }
        setLive(next);
        break;
      }

      case "user:online":
      case "user:offline": {
        const target = lastMessage.userId;
        if (typeof target !== "string") break;
        const online = lastMessage.type === "user:online";
        setLive((prev) => {
          const next = new Map(prev ?? []);
          next.set(target, online);
          return next;
        });
        // The frame both moves the verdict and dates it: whoever last connected
        // or closed their tab is known *now*, which is the only clock a
        // "last seen" sentence may be written against.
        setLastSeen((prev) => {
          const next = new Map(prev);
          next.set(target, Date.now());
          return next;
        });
        break;
      }
    }
  }, [lastMessage]);

  /**
   * The verdict for one member: the socket's while there is one, the roster's
   * flags while there is not, and `null` until either has spoken — which is
   * what keeps a row from drawing "away" for someone whose status was simply
   * never asked about.
   */
  const isOnline = useCallback(
    (memberId: string): boolean | null => {
      if (live) return live.get(memberId) ?? false;
      if (flags) return flags.get(memberId) ?? false;
      return null;
    },
    [live, flags],
  );

  /** When this member's frame was last heard — `null` if never, which is not "a while ago". */
  const lastSeenAt = useCallback(
    (memberId: string): number | null => lastSeen.get(memberId) ?? null,
    [lastSeen],
  );

  // One object, held still while its halves are. A provider handing a fresh
  // answer over on every render would re-render every surface reading it
  // whether or not a verdict had moved; the halves are all stable — two
  // callbacks, a stable `send`, a boolean, state that changes by replacement —
  // so this is a hit until something genuinely is answered differently.
  return useMemo(
    () => ({
      isOnline,
      /** The roster in the route's order, or `null` while nothing has answered. */
      roster,
      lastSeenAt,
      isConnected,
      /** This channel's socket, for the one message a caller sends through it. */
      send,
    }),
    [isOnline, roster, lastSeenAt, isConnected, send],
  );
}

/**
 * The answer a presence surface reads: the channel's return, named so the
 * shared context and a hook falling back to its own copy cannot drift apart.
 * The `null`s are part of it — "not yet asked" travels with the answer, so a
 * surface that read a provider before anything answered drew no verdict at all.
 */
export type PresenceAnswer = ReturnType<typeof usePresenceChannel>;

/** A page's shared channel: the answer, and the claim that keeps it asking. */
export interface PresenceShare {
  /** The one channel every surface under the provider reads. */
  answer: PresenceAnswer;
  /**
   * One surface starting to ask: increments how many are asking and hands
   * back the release that decrements it. Called when the surface stops asking
   * (its `active` flag flipped) *or* goes away, so the count is of asks rather
   * than of mounts, and a claim can never outlive the surface that made it.
   * The provider runs its channel while the count is above zero — which is
   * what lets a strip, a conversation column and a dialog share one
   * connection instead of each opening one.
   */
  claim: () => () => void;
}

/**
 * The shared channel, when a page has one: `null` outside a provider — a test
 * mounting a surface bare, or a surface no layout wraps — and then each caller
 * runs a channel of its own, exactly as before there was one to share.
 */
export const PresenceContext = createContext<PresenceShare | null>(null);

/**
 * Who is here — read through the page's shared channel when there is one, and
 * through this hook's own when there is not. The rules above hold either way;
 * what differs is only *which channel* carries them:
 *
 * - **A provider above means one channel for the page.** The surface claims
 *   it for exactly as long as it is `active` (never longer) and reads its
 *   answer, so the strip, a column of twenty rows and a dialog across the page
 *   are one socket and one roster read between them. Its own channel stays
 *   disabled while a shared one exists — the claim is the ask, and a second
 *   one would be the very thing this collapses.
 * - **No provider means this hook *is* the channel.** Fallback is not a mode
 *   anyone opts into: a surface mounted without a layout (a component test,
 *   a future page outside one) behaves exactly as it did before there was a
 *   provider to share, `active` and all.
 * - **Inactive draws nothing, shared or not.** A surface that is not asking
 *   claims nothing and reads nothing — the dialog shut on the page, the
 *   conversation column's rows, which are handed verdicts from above — so the
 *   count falls to zero when the last such surface goes, and the provider
 *   lets go of the connection then rather than holding it for a page with no
 *   presence on it.
 */
export function usePresenceFlags(active: boolean): PresenceAnswer {
  const shared = useContext(PresenceContext);
  const claim = shared?.claim;

  // The claim is an effect, not a value: made when this surface starts asking
  // and released the moment it stops — so a dialog's `active` flipping is the
  // same thing as mounting or unmounting, and the count never holds a claim
  // whose surface no longer wants an answer. `claim` itself is stable (the
  // provider's `useCallback`), so an answering surface does not re-claim on
  // every frame that arrives through the context it claimed.
  useEffect(() => {
    if (!claim || !active) return;
    return claim();
  }, [claim, active]);

  // Its own channel only where there is nobody shared to ask through: under a
  // provider this hook dials nothing itself, however many of it are mounted.
  const own = usePresenceChannel(shared ? false : active);

  // Inactive is the same nothing with a provider as without one, so the shared
  // answer is read only by a surface actually asking for it.
  return shared && active ? shared.answer : own;
}
