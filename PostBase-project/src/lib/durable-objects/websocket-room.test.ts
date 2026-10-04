import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketRoom } from "./websocket-room";

/**
 * The room is a Durable Object: one process holds every socket in a chat room
 * and fans messages out itself. There is no Cloudflare runtime here, so the two
 * globals it leans on are stood in for.
 *
 * `Response` is replaced rather than used directly because the happy path
 * answers `status: 101` — a WebSocket upgrade — which Node's `Response` refuses
 * to construct. `WebSocketPair` does not exist at all outside the Workers
 * runtime; the fake records the pair so a test can reach the server end and fire
 * the events the component listens for.
 */
class FakeWebSocket {
  accepted = false;
  sent: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();

  accept() {
    this.accepted = true;
  }
  send(data: string) {
    this.sent.push(data);
  }
  addEventListener(type: string, handler: (event: { data?: string }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  emit(type: string, event: { data?: string } = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

const pairs: { client: FakeWebSocket; server: FakeWebSocket }[] = [];

class FakeWebSocketPair {
  0: FakeWebSocket;
  1: FakeWebSocket;
  constructor() {
    this[0] = new FakeWebSocket();
    this[1] = new FakeWebSocket();
    pairs.push({ client: this[0], server: this[1] });
  }
}

class FakeResponse {
  readonly status: number;
  readonly webSocket?: FakeWebSocket;
  private readonly body: unknown;

  constructor(body?: unknown, init?: { status?: number; webSocket?: FakeWebSocket }) {
    this.status = init?.status ?? 200;
    this.body = body;
    this.webSocket = init?.webSocket;
  }
  static json(value: unknown, init?: { status?: number }) {
    return new FakeResponse(value, init);
  }
  async json() {
    return this.body;
  }
  async text() {
    return String(this.body ?? "");
  }
}

const storage = new Map<string, unknown>();
const storagePut = vi.fn(async (key: string, value: unknown) => {
  storage.set(key, value);
});
const storageGet = vi.fn(async (key: string) => storage.get(key));

function makeRoom() {
  const state = {
    storage: { put: storagePut, get: storageGet },
  } as unknown as DurableObjectState;
  return new WebSocketRoom(state, {} as Env);
}

function wsRequest(query = "?userId=u1&room=general") {
  return new Request(`http://do/ws${query}`, { headers: { Upgrade: "websocket" } });
}

function waitForMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  pairs.length = 0;
  storage.clear();
  storagePut.mockClear();
  storageGet.mockClear();
  vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
  vi.stubGlobal("Response", FakeResponse);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSocketRoom.fetch routing", () => {
  it("answers 404 to an unknown path", async () => {
    const room = makeRoom();
    const response = (await room.fetch(new Request("http://do/nope"))) as unknown as FakeResponse;
    expect(response.status).toBe(404);
  });

  it("refuses a /ws request that is not an upgrade", async () => {
    const room = makeRoom();
    const response = (await room.fetch(new Request("http://do/ws?userId=u1"))) as unknown as FakeResponse;
    expect(response.status).toBe(426);
  });

  it("requires a userId on the upgrade", async () => {
    const room = makeRoom();
    const response = (await room.fetch(wsRequest("?room=general"))) as unknown as FakeResponse;
    expect(response.status).toBe(400);
  });

  it("accepts a valid upgrade and announces the arrival", async () => {
    const room = makeRoom();
    const response = (await room.fetch(wsRequest())) as unknown as FakeResponse;

    expect(response.status).toBe(101);
    const { server } = pairs[0];
    expect(response.webSocket).toBe(pairs[0].client);
    expect(server.accepted).toBe(true);
    // The first message back is the confirmation.
    expect(JSON.parse(server.sent[0])).toMatchObject({ type: "connected", userId: "u1", room: "general" });

    await waitForMicrotasks();
    expect(storagePut).toHaveBeenCalledWith("presence:u1", expect.objectContaining({ online: true }));
  });
});

describe("WebSocketRoom presence", () => {
  it("reports whether a user is connected over HTTP", async () => {
    const room = makeRoom();
    await room.fetch(wsRequest());

    const online = (await room.fetch(
      new Request("http://do/presence", { method: "POST", body: JSON.stringify({ userId: "u1" }) }),
    )) as unknown as FakeResponse;
    await expect(online.json()).resolves.toEqual({ userId: "u1", online: true });

    const offline = (await room.fetch(
      new Request("http://do/presence", { method: "POST", body: JSON.stringify({ userId: "nobody" }) }),
    )) as unknown as FakeResponse;
    await expect(offline.json()).resolves.toEqual({ userId: "nobody", online: false });
  });

  it("lists the connected users", async () => {
    const room = makeRoom();
    await room.fetch(wsRequest("?userId=u1&room=general"));
    await room.fetch(wsRequest("?userId=u2&room=general"));
    await expect(room.getOnlineUsers()).resolves.toEqual(["u1", "u2"]);
  });

  it("reads stored presence, defaulting to offline", async () => {
    const room = makeRoom();
    await expect(room.getPresence("ghost")).resolves.toEqual({ online: false, lastSeen: 0 });

    storage.set("presence:u1", { online: true, lastSeen: 123 });
    await expect(room.getPresence("u1")).resolves.toEqual({ online: true, lastSeen: 123 });
  });

  it("marks the user offline when the socket closes", async () => {
    const room = makeRoom();
    await room.fetch(wsRequest());
    pairs[0].server.emit("close");

    await waitForMicrotasks();
    expect(storagePut).toHaveBeenLastCalledWith("presence:u1", expect.objectContaining({ online: false }));
    await expect(room.getOnlineUsers()).resolves.toEqual([]);
  });
});

describe("WebSocketRoom HTTP broadcast", () => {
  it("pushes a message into a room", async () => {
    const room = makeRoom();
    await room.fetch(wsRequest("?userId=u1&room=general"));
    await room.fetch(wsRequest("?userId=u2&room=general"));

    const response = (await room.fetch(
      new Request("http://do/broadcast", {
        method: "POST",
        body: JSON.stringify({ room: "general", message: { type: "hello" }, excludeUserId: "u1" }),
      }),
    )) as unknown as FakeResponse;

    expect(await response.text()).toBe("OK");
    // u1 is excluded; u2 hears it.
    expect(pairs[0].server.sent.some((m) => m.includes("hello"))).toBe(false);
    expect(pairs[1].server.sent.some((m) => m.includes("hello"))).toBe(true);
  });
});

describe("WebSocketRoom message handling", () => {
  async function connectedRoom() {
    const room = makeRoom();
    await room.fetch(wsRequest("?userId=u1&room=general"));
    await room.fetch(wsRequest("?userId=u2&room=general"));
    return room;
  }

  function send(from: number, message: unknown) {
    pairs[from].server.emit("message", { data: JSON.stringify(message) });
  }

  it("relays typing, stop-typing and chat messages to the rest of the room", async () => {
    await connectedRoom();

    send(0, { type: "typing", conversationId: "c1" });
    send(0, { type: "stop-typing", conversationId: "c1" });
    send(0, { type: "message", conversationId: "c1", content: "hi" });

    const heard = pairs[1].server.sent.map((m) => JSON.parse(m).type);
    expect(heard).toContain("typing");
    expect(heard).toContain("stop-typing");
    expect(heard).toContain("message");
    // The sender does not hear its own typing.
    expect(pairs[0].server.sent.some((m) => JSON.parse(m).type === "typing")).toBe(false);
  });

  it("routes a notification to a specific user and a ping back to the sender", async () => {
    await connectedRoom();

    send(0, { type: "notification", targetUserId: "u2", content: "hi" });
    expect(JSON.parse(pairs[1].server.sent.at(-1)!)).toMatchObject({ type: "notification" });

    send(0, { type: "ping" });
    expect(JSON.parse(pairs[0].server.sent.at(-1)!)).toMatchObject({ type: "pong" });
  });

  it("broadcasts feed updates to the feed room's members", async () => {
    const room = makeRoom();
    // Feed updates target the fixed "feed" room, so the members have to be in it.
    await room.fetch(wsRequest("?userId=u1&room=feed"));
    await room.fetch(wsRequest("?userId=u2&room=feed"));

    send(0, { type: "feed:update", postId: "p1", action: "created" });

    expect(pairs[1].server.sent.some((m) => JSON.parse(m).type === "feed:update")).toBe(true);
  });

  it("announces room membership changes to the rest of the room", async () => {
    await connectedRoom();

    send(0, { type: "leave-room" });
    send(0, { type: "join-room", room: "general" });

    const heard = pairs[1].server.sent.map((m) => JSON.parse(m).type);
    expect(heard).toContain("user:left-room");
    expect(heard).toContain("user:joined-room");
  });

  it("ignores a message that is not JSON", async () => {
    await connectedRoom();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    pairs[0].server.emit("message", { data: "not json" });

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
