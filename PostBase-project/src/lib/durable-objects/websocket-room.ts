import { RoomHub, type HubSocket } from "../realtime/room-hub";

/**
 * `/ws` in production: a Durable Object that owns the sockets and hands every
 * decision about them to {@link RoomHub}.
 *
 * The class is deliberately thin. What is Workers-specific here is only the
 * pair and the event target — how a socket arrives, and how a byte from it is
 * read — while who hears what lives in the shared hub the dev server also
 * runs, so the two runtimes cannot drift into speaking different protocols.
 *
 * Its three doors: `/ws` is the upgrade; `/broadcast` and `/presence` are the
 * HTTP side of the same hub, reachable through the binding (a Worker fetch to
 * `env.WEBSOCKET_ROOM`) and never routed to the public internet, because a
 * broadcast door anyone could knock on would be a message-forging endpoint.
 */
export class WebSocketRoom {
  private state: DurableObjectState;
  private hub: RoomHub;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.hub = new RoomHub({
      // The room's own memory of who is here is in-process and dies with the
      // object; storage is the record that outlives it, written on each
      // transition exactly as before.
      onPresence: (userId, online) => {
        void this.state.storage.put(`presence:${userId}`, {
          online,
          lastSeen: Date.now(),
        });
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }

    if (url.pathname === "/presence" && request.method === "POST") {
      return this.handlePresence(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const room = url.searchParams.get("room") || "global";

    if (!userId) {
      return new Response("userId required", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // The adapter, and the whole of it: the hub wants a value it can call,
    // the Workers socket is an event target that can be called.
    const socket: HubSocket = {
      send: (data) => server.send(data),
    };
    server.addEventListener("message", (event) => {
      this.hub.receive(socket, event.data as string);
    });
    server.addEventListener("close", () => {
      this.hub.close(socket);
    });
    this.hub.connect(socket, userId, room);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const { room, message, excludeUserId } = await request.json();
    this.hub.broadcastRoomForUser(room || "global", message, excludeUserId);
    return new Response("OK");
  }

  private async handlePresence(request: Request): Promise<Response> {
    const { userId } = await request.json();
    return Response.json({ userId, online: this.hub.isOnline(userId) });
  }

  async getPresence(userId: string): Promise<{ online: boolean; lastSeen: number }> {
    const presence = await this.state.storage.get<{
      online: boolean;
      lastSeen: number;
    }>(`presence:${userId}`);

    return presence || { online: false, lastSeen: 0 };
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.hub.onlineUserIds();
  }
}
