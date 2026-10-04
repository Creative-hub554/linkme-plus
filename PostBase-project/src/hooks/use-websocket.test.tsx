// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { useWebSocket } from "./use-websocket";

/**
 * The websocket hook owns a connection: it builds the URL from the signed-in
 * user, opens it, routes messages both ways, heartbeats, and reconnects after a
 * drop.
 *
 * The browser's `WebSocket` is replaced with a fake the test drives by hand, so
 * nothing here depends on a server and every lifecycle event — open, message,
 * close, error — can be fired exactly when the assertion needs it. A real
 * `WebSocket` would attempt a connection the suite never serves and report its
 * failure asynchronously, some time after the test has finished.
 *
 * Timers are faked for the whole file, and that is load-bearing rather than
 * tidy. Tearing a surface down calls the hook's cleanup, which closes the
 * socket; the fake's `close()` fires `onclose`, and the hook answers a close by
 * scheduling a reconnect. On real timers that reconnect lands a few
 * milliseconds later — inside the *next* test — and opens a socket nobody asked
 * for, which reads as the hook connecting on its own. Fake timers keep every
 * pending reconnect inside the test that scheduled it, where only an explicit
 * `advanceTimersByTime` can fire it.
 *
 * The session is stubbed because the hook's only input is the current user id;
 * whether Supabase is signed in is not what this file is about.
 */
type Api = ReturnType<typeof useWebSocket>;

const auth = vi.hoisted(() => ({ userId: "u1" as string | undefined }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: auth.userId ? { user: { id: auth.userId } } : null,
    loading: false,
  }),
}));

/** The fake socket the hook is handed, with the events exposed as real methods. */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  static throwOnConstruct = false;

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(url: string) {
    if (FakeWebSocket.throwOnConstruct) throw new Error("no socket for you");
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  // --- what the test drives ---
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  deliver(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }

  fail(error: unknown = new Error("boom")) {
    this.onerror?.(error);
  }
}

const onMessage = vi.fn();
const onConnect = vi.fn();
const onDisconnect = vi.fn();
const OPTIONS = {
  room: "test-room",
  onMessage,
  onConnect,
  onDisconnect,
  reconnectInterval: 10,
  maxReconnectAttempts: 2,
};

let latest: Api | null = null;

function Harness() {
  latest = useWebSocket(OPTIONS);
  return null;
}

function mountHook() {
  return mountSurface(<Harness />, { providers: "none" });
}

function lastSocket() {
  return FakeWebSocket.instances.at(-1) as FakeWebSocket;
}

beforeEach(() => {
  vi.useFakeTimers();
  auth.userId = "u1";
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnConstruct = false;
  onMessage.mockClear();
  onConnect.mockClear();
  onDisconnect.mockClear();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  // Untrack before restoring the clock: cleanup closes the socket, and the
  // reconnect that schedules is only harmless while the timers are still fake.
  cleanupSurfaces();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useWebSocket connection", () => {
  it("opens a socket addressed to the signed-in user and the room", () => {
    mountHook();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toContain("/ws?userId=u1&room=test-room");
    expect(lastSocket().url.startsWith("ws://")).toBe(true);
  });

  it("opens no socket while nobody is signed in", () => {
    auth.userId = undefined;
    mountHook();
    // The effect already guards on the user, so this drives the guard inside
    // `connect` itself: asking to connect without a user is a no-op.
    latest?.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(latest?.isConnected).toBe(false);
  });

  it("reports the connection once the socket opens", async () => {
    mountHook();
    await act(async () => {
      lastSocket().open();
    });

    expect(latest?.isConnected).toBe(true);
    expect(onConnect).toHaveBeenCalled();
  });

  it("uses a secure socket when the page is secure", () => {
    const location = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "https:", host: "app.example" },
    });
    try {
      mountHook();
      expect(lastSocket().url.startsWith("wss://app.example")).toBe(true);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: location });
    }
  });

  it("reports an error rather than throwing when the socket cannot be created", () => {
    FakeWebSocket.throwOnConstruct = true;
    expect(() => mountHook()).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("useWebSocket sending", () => {
  it("stays silent until the socket is open", async () => {
    mountHook();
    latest?.send({ type: "ping" });
    expect(lastSocket().sent).toHaveLength(0);

    await act(async () => {
      lastSocket().open();
    });
    latest?.send({ type: "ping" });
    expect(lastSocket().sent).toHaveLength(1);
  });

  it("sends each kind of message as JSON", async () => {
    mountHook();
    await act(async () => {
      lastSocket().open();
    });

    latest?.sendTyping("c1");
    latest?.stopTyping("c1");
    latest?.sendMessage("c1", "hello");
    latest?.sendNotification("u2", { title: "hi" });
    latest?.joinRoom("r2");
    latest?.leaveRoom("r1");
    latest?.ping();

    expect(lastSocket().sent.map((raw) => JSON.parse(raw))).toEqual([
      { type: "typing", conversationId: "c1" },
      { type: "stop-typing", conversationId: "c1" },
      { type: "message", conversationId: "c1", content: "hello" },
      { type: "notification", targetUserId: "u2", title: "hi" },
      { type: "join-room", room: "r2" },
      { type: "leave-room", room: "r1" },
      { type: "ping" },
    ]);
  });

  it("heartbeats while connected", async () => {
    mountHook();
    await act(async () => {
      lastSocket().open();
    });
    const before = lastSocket().sent.length;

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(lastSocket().sent.length).toBe(before + 1);
    expect(JSON.parse(lastSocket().sent.at(-1) as string)).toEqual({ type: "ping" });
  });

  it("closes the socket on request", async () => {
    mountHook();
    await act(async () => {
      lastSocket().open();
    });
    const socket = lastSocket();
    await act(async () => {
      latest?.disconnect();
    });

    expect(socket.readyState).toBe(3);
    expect(latest?.isConnected).toBe(false);
  });
});

describe("useWebSocket receiving", () => {
  it("hands an incoming message to the caller", async () => {
    mountHook();
    const message = { type: "hello", userId: "u2" };
    await act(async () => {
      lastSocket().deliver(message);
    });

    expect(latest?.lastMessage).toEqual(message);
    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it("reports a message that is not JSON instead of throwing", async () => {
    mountHook();
    await act(async () => {
      lastSocket().deliver("not json at all");
    });

    expect(latest?.lastMessage).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("reports a socket error", async () => {
    mountHook();
    await act(async () => {
      lastSocket().fail();
    });

    expect(console.error).toHaveBeenCalled();
  });
});

describe("useWebSocket reconnecting", () => {
  it("tries again after a drop, and gives up at the limit", async () => {
    mountHook();
    await act(async () => {
      lastSocket().open();
    });

    // First drop: one reconnect is scheduled.
    await act(async () => {
      lastSocket().close();
    });
    expect(latest?.isConnected).toBe(false);
    expect(onDisconnect).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second drop: closing the replacement schedules the last reconnect. It is
    // not opened first, because opening resets the attempt counter — the drop
    // being modelled is one that never made it back up.
    await act(async () => {
      lastSocket().close();
    });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(FakeWebSocket.instances).toHaveLength(3);

    // Third drop: the limit is reached, so nothing new is opened.
    await act(async () => {
      lastSocket().close();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("cancels a pending reconnect when the hook is asked to disconnect", async () => {
    mountHook();
    await act(async () => {
      lastSocket().open();
    });
    await act(async () => {
      lastSocket().close();
    });
    await act(async () => {
      latest?.disconnect();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
