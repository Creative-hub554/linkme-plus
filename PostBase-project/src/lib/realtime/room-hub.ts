/**
 * The room's whole behaviour, in one runtime-agnostic place.
 *
 * Two servers answer `/ws`: `WebSocketRoom`, a Durable Object, in production,
 * and {@link file://./dev-websocket.ts | the dev plugin}'s hub under `vinext dev`.
 * A protocol that exists twice drifts — the second copy quietly stops sending
 * the snapshot the first one added — so both are this class with a socket
 * adapter around it: the Durable Object wraps Workers' `WebSocket`, the dev
 * server wraps `ws`, and every rule about who hears what lives below.
 *
 * The rules, in short:
 *
 * - **A user is a set of sockets, not a socket.** Two tabs, and any page that
 *   opens more than one hook, mean one user arrives on several connections; a
 *   single-socket map would let the second tab orphan the first and let its
 *   close mark a user offline who is still there.
 * - **Presence is global; everything else is room-scoped.** `user:online`,
 *   `user:offline` and the connect snapshot go to every socket, because the
 *   strip asking "who is here?" is not in the same room as the chat typing in
 *   `global`. Typing, messages and read receipts stay in their room.
 * - **The snapshot is what makes the first paint honest.** A client that
 *   connects after everyone else would otherwise see only the members who
 *   happen to join while it is watching.
 * - **Sends exclude the socket that caused them, not the user.** The sender's
 *   own other tab still hears the message; the sender's own typing does not
 *   come back to it at all.
 */
export interface HubMessage {
  type: string;
  userId?: string;
  room?: string;
  conversationId?: string;
  content?: string;
  targetUserId?: string;
  postId?: string;
  action?: string;
  /**
   * A read receipt's watermark: the instant up to which the reader has read,
   * as the *server* stamped it when the thread was marked — carried through
   * rather than re-stamped, so both ends compare against the same clock that
   * stamped the messages themselves.
   */
  at?: number;
  /** A reaction's target message and the type pressed, on a `reaction` frame. */
  messageId?: string;
  reaction?: string;
  timestamp?: number;
  [key: string]: unknown;
}

/** The least a socket must do to live in a room: answer with bytes. */
export interface HubSocket {
  send(data: string): void;
}

export interface RoomHubHooks {
  /**
   * Fires on a user's *transition*: true when their first socket arrives,
   * false when their last one leaves — not once per socket, so a two-tab
   * reader is not marked offline when one of the tabs closes.
   */
  onPresence?(userId: string, online: boolean): void;
}

interface SocketContext {
  userId: string;
  room: string;
}

export class RoomHub {
  private readonly bySocket = new Map<HubSocket, SocketContext>();
  private readonly byUser = new Map<string, Set<HubSocket>>();
  private readonly byRoom = new Map<string, Set<HubSocket>>();
  private readonly hooks: RoomHubHooks;

  constructor(hooks: RoomHubHooks = {}) {
    this.hooks = hooks;
  }

  /** Welcomes a socket: its ack, the roster of who is already here, and the world told it arrived. */
  connect(socket: HubSocket, userId: string, room: string): void {
    if (this.bySocket.has(socket)) return;
    const now = Date.now();
    this.bySocket.set(socket, { userId, room });
    this.memberSet(this.byUser, userId).add(socket);
    this.memberSet(this.byRoom, room).add(socket);

    const first = this.byUser.get(userId)!.size === 1;

    this.send(socket, JSON.stringify({ type: "connected", userId, room, timestamp: now }));
    this.send(
      socket,
      JSON.stringify({ type: "presence:snapshot", userIds: [...this.byUser.keys()], timestamp: now }),
    );
    // The joining socket has no interest in its own arrival; the rest of the
    // world, including this user's other tabs, does.
    this.broadcastAll({ type: "user:online", userId, timestamp: now }, socket);
    if (first) this.hooks.onPresence?.(userId, true);
  }

  /** One frame from one socket, routed by the rules in this class's doc. */
  receive(socket: HubSocket, raw: string): void {
    const context = this.bySocket.get(socket);
    if (!context) return;

    let data: HubMessage;
    try {
      data = JSON.parse(raw) as HubMessage;
    } catch (err) {
      console.error("Invalid message:", err);
      return;
    }

    const now = Date.now();
    switch (data.type) {
      case "join-room": {
        const room = data.room || context.room;
        this.memberSet(this.byRoom, room).add(socket);
        this.broadcastRoom(
          room,
          { type: "user:joined-room", userId: context.userId, room, timestamp: now },
          socket,
        );
        break;
      }
      case "leave-room": {
        const room = data.room || context.room;
        this.byRoom.get(room)?.delete(socket);
        this.broadcastRoom(
          room,
          { type: "user:left-room", userId: context.userId, room, timestamp: now },
          socket,
        );
        break;
      }
      case "typing":
      case "stop-typing":
        this.broadcastRoom(
          context.room,
          { type: data.type, userId: context.userId, conversationId: data.conversationId, timestamp: now },
          socket,
        );
        break;
      case "message":
        this.broadcastRoom(
          context.room,
          { type: "message", userId: context.userId, conversationId: data.conversationId, content: data.content, timestamp: now },
          socket,
        );
        break;
      case "reaction":
        // A reaction on a message, announced by the member who pressed it —
        // the same room-scoped whisper the message itself is, carrying the
        // message it is on so a reader in that thread re-reads in the moment.
        // `userId` is the socket's identity, never the payload's say-so.
        this.broadcastRoom(
          context.room,
          {
            type: "reaction",
            userId: context.userId,
            conversationId: data.conversationId,
            messageId: data.messageId,
            reaction: data.reaction,
            timestamp: now,
          },
          socket,
        );
        break;
      case "read":
        // The reader announcing how far it has caught up. `userId` is the
        // socket's verified identity — not the payload's say-so — so a receipt
        // can only ever arrive as the member whose session opened the door.
        this.broadcastRoom(
          context.room,
          {
            type: "read",
            userId: context.userId,
            conversationId: data.conversationId,
            at: typeof data.at === "number" ? data.at : now,
            timestamp: now,
          },
          socket,
        );
        break;
      case "notification":
        if (data.targetUserId) {
          this.sendToUser(data.targetUserId, {
            ...data,
            type: "notification",
            userId: context.userId,
            timestamp: now,
          });
        }
        break;
      case "feed:update":
        this.broadcastRoom(
          "feed",
          { type: "feed:update", userId: context.userId, postId: data.postId, action: data.action, timestamp: now },
          socket,
        );
        break;
      case "ping":
        this.send(socket, JSON.stringify({ type: "pong", timestamp: now }));
        break;
    }
  }

  /** A socket went away. The user is offline only when this was their last. */
  close(socket: HubSocket): void {
    const context = this.bySocket.get(socket);
    if (!context) return;
    this.bySocket.delete(socket);
    this.byUser.get(context.userId)?.delete(socket);
    // A socket may have joined rooms beyond the one it dialled, so every room
    // is swept rather than only the one on its context.
    for (const members of this.byRoom.values()) members.delete(socket);

    if ((this.byUser.get(context.userId)?.size ?? 0) === 0) {
      this.byUser.delete(context.userId);
      this.broadcastAll({ type: "user:offline", userId: context.userId, timestamp: Date.now() });
      this.hooks.onPresence?.(context.userId, false);
    }
  }

  /** Server-sent message into a room — the HTTP `/broadcast` door. */
  broadcastRoom(room: string, message: HubMessage, excludeSocket?: HubSocket): void {
    const members = this.byRoom.get(room);
    if (!members) return;
    const payload = JSON.stringify(message);
    for (const socket of [...members]) {
      if (socket === excludeSocket) continue;
      this.send(socket, payload);
    }
  }

  /** The same door, excluding every socket a *user* holds — the API's `excludeUserId`. */
  broadcastRoomForUser(room: string, message: HubMessage, excludeUserId?: string): void {
    const members = this.byRoom.get(room);
    if (!members) return;
    const payload = JSON.stringify(message);
    for (const socket of [...members]) {
      if (excludeUserId && this.bySocket.get(socket)?.userId === excludeUserId) continue;
      this.send(socket, payload);
    }
  }

  broadcastAll(message: HubMessage, excludeSocket?: HubSocket): void {
    const payload = JSON.stringify(message);
    for (const socket of [...this.bySocket.keys()]) {
      if (socket === excludeSocket) continue;
      this.send(socket, payload);
    }
  }

  /** To every socket the target user holds — a notification reaches both tabs. */
  sendToUser(userId: string, message: HubMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of [...(this.byUser.get(userId) ?? [])]) this.send(socket, payload);
  }

  /**
   * One payload, to one socket, with the failure mode a fan-out must have: a
   * socket that cannot be written to is a socket that has gone away, and it is
   * retired through {@link close} — the same path a clean exit takes — so its
   * user's last-socket offline fires rather than the connection limping in the
   * maps forever.
   */
  private send(socket: HubSocket, payload: string): void {
    try {
      socket.send(payload);
    } catch {
      this.close(socket);
    }
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  onlineUserIds(): string[] {
    return [...this.byUser.keys()];
  }

  private memberSet(index: Map<string, Set<HubSocket>>, key: string): Set<HubSocket> {
    const existing = index.get(key);
    if (existing) return existing;
    const created = new Set<HubSocket>();
    index.set(key, created);
    return created;
  }
}
