// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch, type StubPayload } from "@/test/stub-fetch";
import { usePresence } from "./use-presence";

/**
 * The presence hook turns the last websocket message into an answer about
 * whether a user is online and when they were last seen — and, since it became
 * an adapter over `usePresenceFlags`, the roster's answer too: the same two
 * halves the strip reads, which is the point. The disagreement this file pins
 * at the end — a member green in the strip and grey here — existed because
 * this hook used to hear only the frames after it connected.
 *
 * It is mounted through a harness, not called directly: the hook keeps its
 * state in an effect, so a direct call would read it as it was before any
 * message arrived. The harness re-renders on demand, which is exactly what a
 * new message does in the app — the socket hands the hook a new `lastMessage`
 * and React re-runs the effect.
 *
 * The socket itself is stubbed, and so is the roster — answered with nobody,
 * so the cases below stay about frames unless one says otherwise. What is
 * under test is the mapping from an answer to an opinion, not the transport
 * that carried it, and a real `WebSocket` would try to open a connection this
 * suite never serves.
 */
type Api = ReturnType<typeof usePresence>;

const ws = vi.hoisted(() => ({
  lastMessage: null as Record<string, unknown> | null,
  isConnected: false,
  send: vi.fn(),
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    lastMessage: ws.lastMessage,
    isConnected: ws.isConnected,
    send: ws.send,
  }),
}));

// The channel beneath the hook reads the session to know whether it may ask
// at all. The real one reaches Supabase, which this suite has no project for.
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ session: { user: { id: "member-1" } }, loading: false }),
}));

let latest: Api | null = null;

function Harness() {
  // Captured on every render so the test always reads the current state.
  latest = usePresence();
  return null;
}

/** Mounts the hook against a roster, then re-renders it whenever a message is delivered. */
async function mountPresence(roster: StubPayload = { users: [] }) {
  // The empty roster is the default so the frame cases stay about frames: it
  // names nobody, which the channel treats as no answer at all rather than as
  // everyone being away.
  stubFetch({ "/api/presence": roster });
  return mountSurface(<Harness />, { providers: "none" });
}

async function deliver(ui: Awaited<ReturnType<typeof mountPresence>>, message: Record<string, unknown>) {
  ws.lastMessage = message;
  await ui.render(<Harness />);
}

afterEach(() => {
  cleanupSurfaces();
  vi.restoreAllMocks();
});

beforeEach(() => {
  ws.lastMessage = null;
  ws.isConnected = false;
  ws.send.mockClear();
});

describe("usePresence", () => {
  it("knows nothing before any message has arrived", async () => {
    await mountPresence();

    expect(latest?.isUserOnline("u1")).toBe(false);
    expect(latest?.getLastSeen("u1")).toBeNull();
    expect(latest?.formatLastSeen("u1")).toBeNull();
  });

  it("marks a user online and remembers when it heard", async () => {
    const ui = await mountPresence();
    await deliver(ui, { type: "user:online", userId: "u1" });

    expect(latest?.isUserOnline("u1")).toBe(true);
    expect(typeof latest?.getLastSeen("u1")).toBe("number");
    // Seen a moment ago, so the sentence is the one for "just now".
    expect(latest?.formatLastSeen("u1")).toBe("Just now");
  });

  it("keeps the last-seen time when a user goes offline", async () => {
    const ui = await mountPresence();
    await deliver(ui, { type: "user:online", userId: "u1" });
    await deliver(ui, { type: "user:offline", userId: "u1" });

    expect(latest?.isUserOnline("u1")).toBe(false);
    // Offline is not forgotten: the time it was seen is still an answer.
    expect(latest?.getLastSeen("u1")).not.toBeNull();
    expect(latest?.formatLastSeen("u1")).not.toBeNull();
  });

  it("ignores an online message whose user id is not a string", async () => {
    const ui = await mountPresence();
    await deliver(ui, { type: "user:online", userId: 42 });

    expect(latest?.isUserOnline("42")).toBe(false);
    expect(latest?.isUserOnline("u1")).toBe(false);
  });

  it("ignores an offline message whose user id is not a string", async () => {
    const ui = await mountPresence();
    await deliver(ui, { type: "user:offline", userId: 7 });

    expect(latest?.isUserOnline("u1")).toBe(false);
  });

  it("ignores a message about something else entirely", async () => {
    const ui = await mountPresence();
    await deliver(ui, { type: "typing", userId: "u1" });

    expect(latest?.isUserOnline("u1")).toBe(false);
  });

  it("spells out minutes, hours and days since a user was seen", async () => {
    const zero = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(zero);
    const ui = await mountPresence();
    await deliver(ui, { type: "user:online", userId: "u1" });

    now.mockReturnValue(zero + 5 * 60_000);
    expect(latest?.formatLastSeen("u1")).toBe("5m ago");

    now.mockReturnValue(zero + 5 * 3_600_000);
    expect(latest?.formatLastSeen("u1")).toBe("5h ago");

    now.mockReturnValue(zero + 3 * 86_400_000);
    expect(latest?.formatLastSeen("u1")).toBe("3d ago");
  });

  it("asks the socket to check a user's presence", async () => {
    await mountPresence();
    latest?.checkPresence("u9");

    expect(ws.send).toHaveBeenCalledWith({ type: "check-presence", userId: "u9" });
  });

  it("passes the connection state through", async () => {
    ws.isConnected = true;
    await mountPresence();

    expect(latest?.isConnected).toBe(true);
  });

  it("reads the roster the strip reads, so a listed member is here to it too", async () => {
    const ui = await mountPresence({
      users: [{ userId: "u1", displayName: "U1", avatarUrl: null, online: true }],
    });

    // The other half of the disagreement this unification exists for: the
    // strip read the roster and drew a member green while this hook, which
    // kept a map of frames alone, greyed them. It delegates to the same
    // channel now, so the same read answers both.
    await ui.waitFor(() => latest?.isUserOnline("u1") === true, {
      description: "the roster's verdict to arrive",
    });
    // …and the flags are complete rather than partial: the roster named who
    // it knows, and an id it did not name has a verdict as well.
    expect(latest?.isUserOnline("u2")).toBe(false);
  });

  it("hears the snapshot that used to pass it by", async () => {
    const ui = await mountPresence();
    await deliver(ui, { type: "presence:snapshot", userIds: ["u1", "u2"] });

    // The snapshot is the moment's complete answer — everybody connected,
    // and so — by omission — who is not. This hook used to hear only the
    // increments after it connected, so somebody already online stayed grey
    // here while the strip drew them: the same frame, finally shared.
    expect(latest?.isUserOnline("u1")).toBe(true);
    expect(latest?.isUserOnline("u3")).toBe(false);
  });
});
