/**
 * Who is around right now, kept where every request can see it.
 *
 * The app has no WebSocket server — `useWebSocket` dials a `/ws` endpoint
 * nothing answers — so presence is a heartbeat instead: a signed-in client
 * posts to `/api/presence` every 30 seconds, and a member counts as online
 * while their last beat is inside {@link PRESENCE_WINDOW_MS}. The window is
 * three times the beat, so a single dropped beat does not flicker a member
 * out of the list.
 *
 * The registry is module-scoped: it lives as long as the server process does.
 * That is the right lifetime for one dev server or one deployed isolate, and
 * it is stated here rather than hidden because it is *not* a cluster-wide
 * registry — behind several instances each would keep its own map, and a beat
 * would only ever prove a session is talking to the instance that took it.
 */
export const PRESENCE_WINDOW_MS = 90_000;

/** userId → the time of their last beat. Pruned as it goes stale. */
const lastBeat = new Map<string, number>();

/** Counts a member's heartbeat at `now`, dropping beats that have gone stale. */
export function touchPresence(userId: string, now: number = Date.now()): void {
  prune(now);
  lastBeat.set(userId, now);
}

/** Whether this member's last beat is still inside the window. */
export function isOnline(userId: string, now: number = Date.now()): boolean {
  const beat = lastBeat.get(userId);
  return beat !== undefined && now - beat < PRESENCE_WINDOW_MS;
}

/**
 * A beat is only ever *added*, so without this the map would keep every id
 * that ever posted one. Both public functions prune, which means the registry
 * is clean by the time anything reads it and no sweep of its own is needed.
 */
function prune(now: number): void {
  for (const [userId, beat] of lastBeat) {
    if (now - beat >= PRESENCE_WINDOW_MS) lastBeat.delete(userId);
  }
}

/** A fresh registry, so one test's beats cannot light the next test's roster. */
export function resetPresence(): void {
  lastBeat.clear();
}
