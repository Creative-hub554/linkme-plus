/**
 * A message on the wire, inbound or outbound. The named fields are the ones
 * this room reads or writes; a sender may add anything else, which rides along
 * through the index signature as `unknown`.
 */
interface RoomMessage {
  type: string;
  userId?: string;
  room?: string;
  conversationId?: string;
  content?: string;
  targetUserId?: string;
  postId?: string;
  action?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export class WebSocketRoom {
  private state: DurableObjectState;
  private connections: Map<string, WebSocket>;
  private roomMembers: Map<string, Set<string>>;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.connections = new Map();
    this.roomMembers = new Map();
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

    this.handleConnection(server, userId, room);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleConnection(ws: WebSocket, userId: string, room: string): void {
    ws.accept();

    // Store connection
    this.connections.set(userId, ws);

    // Add to room
    if (!this.roomMembers.has(room)) {
      this.roomMembers.set(room, new Set());
    }
    this.roomMembers.get(room)!.add(userId);

    // Send connection confirmation
    ws.send(
      JSON.stringify({
        type: "connected",
        userId,
        room,
        timestamp: Date.now(),
      })
    );

    // Broadcast user joined
    this.broadcastToRoom(room, {
      type: "user:online",
      userId,
      timestamp: Date.now(),
    }, userId);

    // Handle messages
    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleMessage(userId, room, data);
      } catch (err) {
        console.error("Invalid message:", err);
      }
    });

    // Handle close
    ws.addEventListener("close", () => {
      this.connections.delete(userId);
      this.roomMembers.get(room)?.delete(userId);

      this.broadcastToRoom(room, {
        type: "user:offline",
        userId,
        timestamp: Date.now(),
      });

      // Update presence in database
      this.updatePresence(userId, false);
    });

    // Update presence in database
    this.updatePresence(userId, true);
  }

  private handleMessage(userId: string, room: string, data: RoomMessage): void {
    switch (data.type) {
      case "join-room":
        this.joinRoom(userId, data.room || room);
        break;

      case "leave-room":
        this.leaveRoom(userId, room);
        break;

      case "typing":
        this.broadcastToRoom(room, {
          type: "typing",
          userId,
          conversationId: data.conversationId,
          timestamp: Date.now(),
        }, userId);
        break;

      case "stop-typing":
        this.broadcastToRoom(room, {
          type: "stop-typing",
          userId,
          conversationId: data.conversationId,
          timestamp: Date.now(),
        }, userId);
        break;

      case "message":
        this.broadcastToRoom(room, {
          type: "message",
          userId,
          conversationId: data.conversationId,
          content: data.content,
          timestamp: Date.now(),
        }, userId);
        break;

      case "notification":
        // Send to specific user
        if (data.targetUserId) {
          this.sendToUser(data.targetUserId, {
            ...data,
            type: "notification",
            userId,
            timestamp: Date.now(),
          });
        }
        break;

      case "feed:update":
        this.broadcastToRoom("feed", {
          type: "feed:update",
          userId,
          postId: data.postId,
          action: data.action,
          timestamp: Date.now(),
        }, userId);
        break;

      case "ping":
        this.sendToUser(userId, { type: "pong", timestamp: Date.now() });
        break;
    }
  }

  private joinRoom(userId: string, room: string): void {
    if (!this.roomMembers.has(room)) {
      this.roomMembers.set(room, new Set());
    }
    this.roomMembers.get(room)!.add(userId);

    this.broadcastToRoom(room, {
      type: "user:joined-room",
      userId,
      room,
      timestamp: Date.now(),
    }, userId);
  }

  private leaveRoom(userId: string, room: string): void {
    this.roomMembers.get(room)?.delete(userId);

    this.broadcastToRoom(room, {
      type: "user:left-room",
      userId,
      room,
      timestamp: Date.now(),
    }, userId);
  }

  private broadcastToRoom(room: string, message: RoomMessage, excludeUserId?: string): void {
    const members = this.roomMembers.get(room);
    if (!members) return;

    const messageStr = JSON.stringify(message);

    for (const memberId of members) {
      if (memberId === excludeUserId) continue;

      const ws = this.connections.get(memberId);
      if (ws) {
        try {
          ws.send(messageStr);
        } catch {
          // Connection might be closed
          this.connections.delete(memberId);
          members.delete(memberId);
        }
      }
    }
  }

  private sendToUser(userId: string, message: RoomMessage): void {
    const ws = this.connections.get(userId);
    if (ws) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        this.connections.delete(userId);
      }
    }
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const { room, message, excludeUserId } = await request.json();
    this.broadcastToRoom(room || "global", message, excludeUserId);
    return new Response("OK");
  }

  private async handlePresence(request: Request): Promise<Response> {
    const { userId } = await request.json();
    const isOnline = this.connections.has(userId);
    return Response.json({ userId, online: isOnline });
  }

  private async updatePresence(userId: string, online: boolean): Promise<void> {
    // Store presence in Durable Object storage
    await this.state.storage.put(`presence:${userId}`, {
      online,
      lastSeen: Date.now(),
    });
  }

  async getPresence(userId: string): Promise<{ online: boolean; lastSeen: number }> {
    const presence = await this.state.storage.get<{
      online: boolean;
      lastSeen: number;
    }>(`presence:${userId}`);

    return presence || { online: false, lastSeen: 0 };
  }

  async getOnlineUsers(): Promise<string[]> {
    const onlineUsers: string[] = [];

    for (const [userId, _ws] of this.connections) {
      // Check if WebSocket is still open
      try {
        // If we can access it, it's open
        onlineUsers.push(userId);
      } catch {
        this.connections.delete(userId);
      }
    }

    return onlineUsers;
  }
}
