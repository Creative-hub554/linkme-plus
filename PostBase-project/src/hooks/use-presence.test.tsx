// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { usePresence } from "./use-presence";

/**
 * The presence hook turns the last websocket message into an answer about
 * whether a user is online and when they were last seen.
 *
 * It is mounted through a harness, not called directly: the hook keeps the
 * presence map in React state and only updates it from an effect, so a direct
 * call would read the map as it was before any message arrived. The harness
 * re-renders on demand, which is exactly what a new message does in the app —
 * `useWebSocket` hands the hook a new `lastMessage` and React re-runs the
 * effect.
 *
 * The socket itself is stubbed. What is under test is the mapping from a
 * message to an answer, not the transport that carried it, and a real
 * `WebSocket` would try to open a connection this suite never serves.
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

let latest: Api | null = null;

function Harness() {
  // Captured on every render so the test always reads the current state.
  latest = usePresence();
  return null;
}

/** Mounts the hook, then re-renders it whenever a message is delivered. */
async function mountPresence() {
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
});
