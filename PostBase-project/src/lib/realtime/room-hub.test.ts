import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomHub, type HubSocket } from "./room-hub";

/**
 * The protocol both `/ws` servers speak, tested where it lives: the shared
 * hub the Durable Object and the dev plugin are both built from.
 *
 * A socket here is the least thing the hub asks for — something to send to —
 * so every claim is about routing rather than about either runtime: who is
 * told someone arrived, whose *last* socket makes a user offline, which of a
 * user's tabs hears a message. The Durable Object's own suite judges its
 * doors; this judges the rules both of them obey.
 */
class FakeSocket implements HubSocket {
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }

  /** Every type this socket has been sent, in order. */
  types(): string[] {
    return this.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
  }

  last(): { type: string } & Record<string, unknown> {
    return JSON.parse(this.sent.at(-1)!) as { type: string } & Record<string, unknown>;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RoomHub welcomes", () => {
  it("answers a socket with its ack and the snapshot of who is already here", () => {
    const hub = new RoomHub();
    const first = new FakeSocket();
    const second = new FakeSocket();

    hub.connect(first, "u1", "presence");
    hub.connect(second, "u2", "global");

    // The ack names the room the socket dialled…
    expect(first.types()[0]).toBe("connected");
    expect(JSON.parse(first.sent[0])).toMatchObject({ userId: "u1", room: "presence" });
    // …and the snapshot is what makes a first paint honest: everyone already
    // present, across every room, is named to the arrival.
    expect(JSON.parse(first.sent[1])).toMatchObject({ type: "presence:snapshot" });
    expect((JSON.parse(first.sent[1]) as { userIds: string[] }).userIds).toEqual(["u1"]);
    expect((JSON.parse(second.sent[1]) as { userIds: string[] }).userIds).toEqual(["u1", "u2"]);
  });

  it("tells the world a user arrived, whatever room each socket dialled", () => {
    const hub = new RoomHub();
    const strip = new FakeSocket();
    const chat = new FakeSocket();

    // The strip watches "presence"; a chat socket sits in "global". Presence
    // is a property of the reader, not of a room, so the arrival crosses.
    hub.connect(strip, "u1", "presence");
    hub.connect(chat, "u2", "global");

    expect(strip.types()).toContain("user:online");
    expect(strip.last()).toMatchObject({ type: "user:online", userId: "u2" });
    // The arrival hears nothing about itself…
    expect(chat.types()).not.toContain("user:online");
    // …but its own other tab does, which is harmless and idempotent.
    const secondTab = new FakeSocket();
    hub.connect(secondTab, "u2", "presence");
    expect(strip.last()).toMatchObject({ type: "user:online", userId: "u2" });
  });
});

describe("RoomHub presence transitions", () => {
  it("goes offline only when a user's *last* socket leaves", () => {
    const hub = new RoomHub();
    const presence = vi.fn();
    const withPresence = new RoomHub({ onPresence: presence });

    const tab1 = new FakeSocket();
    const tab2 = new FakeSocket();
    withPresence.connect(tab1, "u1", "global");
    withPresence.connect(tab2, "u1", "presence");

    // One user, two sockets: one transition in, not two.
    expect(presence).toHaveBeenCalledTimes(1);
    expect(presence).toHaveBeenCalledWith("u1", true);

    withPresence.connect(new FakeSocket(), "u2", "global");
    presence.mockClear();

    withPresence.close(tab1);
    // Still a socket open — not offline, and the room is told nothing.
    expect(presence).not.toHaveBeenCalled();
    expect(hub.isOnline("u1")).toBe(false);

    withPresence.close(tab2);
    expect(presence).toHaveBeenCalledTimes(1);
    expect(presence).toHaveBeenCalledWith("u1", false);
  });

  it("announces user:offline exactly once, to everyone still connected", () => {
    const hub = new RoomHub();
    const watcher = new FakeSocket();
    const leaver = new FakeSocket();
    const leaversSecondTab = new FakeSocket();

    hub.connect(watcher, "u1", "presence");
    hub.connect(leaver, "u2", "global");
    hub.connect(leaversSecondTab, "u2", "presence");

    hub.close(leaver);
    expect(watcher.types()).not.toContain("user:offline");
    hub.close(leaversSecondTab);

    const offline = watcher.sent.filter(
      (raw) => (JSON.parse(raw) as { type: string }).type === "user:offline",
    );
    expect(offline).toHaveLength(1);
    expect(JSON.parse(offline[0])).toMatchObject({ userId: "u2" });
    expect(hub.onlineUserIds()).toEqual(["u1"]);
  });
});

describe("RoomHub message routing", () => {
  it("relays to the room, sparing the sending socket but reaching the sender's other tab", () => {
    const hub = new RoomHub();
    const senderTab = new FakeSocket();
    const sendersOtherTab = new FakeSocket();
    const receiver = new FakeSocket();
    const elsewhere = new FakeSocket();

    hub.connect(senderTab, "u1", "global");
    hub.connect(sendersOtherTab, "u1", "global");
    hub.connect(receiver, "u2", "global");
    hub.connect(elsewhere, "u3", "presence");

    hub.receive(senderTab, JSON.stringify({ type: "message", conversationId: "c1", content: "hi" }));

    expect(senderTab.types()).not.toContain("message");
    expect(sendersOtherTab.last()).toMatchObject({ type: "message", conversationId: "c1" });
    expect(receiver.last()).toMatchObject({ type: "message", content: "hi" });
    expect(elsewhere.types()).not.toContain("message");
  });

  it("routes a notification to every socket the target user holds", () => {
    const hub = new RoomHub();
    const sender = new FakeSocket();
    const targetTab1 = new FakeSocket();
    const targetTab2 = new FakeSocket();
    const stranger = new FakeSocket();

    hub.connect(sender, "u1", "global");
    hub.connect(targetTab1, "u2", "global");
    hub.connect(targetTab2, "u2", "presence");
    hub.connect(stranger, "u3", "global");

    hub.receive(sender, JSON.stringify({ type: "notification", targetUserId: "u2" }));

    expect(targetTab1.last()).toMatchObject({ type: "notification" });
    expect(targetTab2.last()).toMatchObject({ type: "notification" });
    expect(stranger.types()).not.toContain("notification");
  });

  it("answers a ping on the socket that sent it", () => {
    const hub = new RoomHub();
    const socket = new FakeSocket();
    hub.connect(socket, "u1", "global");

    hub.receive(socket, JSON.stringify({ type: "ping" }));

    expect(socket.last()).toMatchObject({ type: "pong" });
  });

  it("retires a socket whose send throws, through the same path as a close", () => {
    const hub = new RoomHub({ onPresence: vi.fn() });
    const healthy = new FakeSocket();
    const dying = new FakeSocket();
    hub.connect(healthy, "u1", "global");
    hub.connect(dying, "u2", "global");

    dying.send = () => {
      throw new Error("socket gone");
    };
    hub.broadcastAll({ type: "user:online", userId: "u3" });

    // The dead socket is out of the roster rather than stuck in it forever.
    expect(hub.onlineUserIds()).toEqual(["u1"]);
    expect(healthy.types()).toContain("user:online");
  });

  it("complains about a frame that is not JSON, and keeps the socket", () => {
    const hub = new RoomHub();
    const socket = new FakeSocket();
    hub.connect(socket, "u1", "global");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    hub.receive(socket, "not json");

    expect(consoleError).toHaveBeenCalled();
    expect(hub.onlineUserIds()).toEqual(["u1"]);
  });
});

describe("RoomHub read receipts", () => {
  it("relays a receipt to the room under the reader's id, sparing the reader's own socket", () => {
    const hub = new RoomHub();
    const reader = new FakeSocket();
    const readersOtherTab = new FakeSocket();
    const sender = new FakeSocket();
    const elsewhere = new FakeSocket();

    hub.connect(reader, "u1", "global");
    hub.connect(readersOtherTab, "u1", "global");
    hub.connect(sender, "u2", "global");
    hub.connect(elsewhere, "u3", "presence");

    hub.receive(
      reader,
      JSON.stringify({ type: "read", conversationId: "c1", at: 1_750_000_000_000 }),
    );

    // The reader hears nothing about its own receipt; the rest of the room —
    // including the sender who needs it — does.
    expect(reader.types()).not.toContain("read");
    expect(readersOtherTab.last()).toMatchObject({
      type: "read",
      userId: "u1",
      conversationId: "c1",
      at: 1_750_000_000_000,
    });
    expect(sender.last()).toMatchObject({ type: "read", userId: "u1" });
    // Room-scoped like everything that is not presence.
    expect(elsewhere.types()).not.toContain("read");
  });

  it("stamps its own instant when the client sent no watermark", () => {
    const hub = new RoomHub();
    const reader = new FakeSocket();
    const other = new FakeSocket();
    hub.connect(reader, "u1", "global");
    hub.connect(other, "u2", "global");

    hub.receive(reader, JSON.stringify({ type: "read", conversationId: "c1" }));

    const frame = other.last() as { at?: unknown };
    expect(typeof frame.at).toBe("number");
  });

  it("stamps the socket's identity, never the one the payload claims", () => {
    const hub = new RoomHub();
    const reader = new FakeSocket();
    const sender = new FakeSocket();
    hub.connect(reader, "u1", "global");
    hub.connect(sender, "u2", "global");

    hub.receive(
      reader,
      JSON.stringify({ type: "read", conversationId: "c1", userId: "user-9", at: 1 }),
    );

    expect(sender.last()).toMatchObject({ type: "read", userId: "u1" });
  });
});

describe("RoomHub reaction frames", () => {
  it("carries a reaction to the room — which message moved, and who pressed", () => {
    const hub = new RoomHub();
    const presser = new FakeSocket();
    const peer = new FakeSocket();
    hub.connect(presser, "u1", "global");
    hub.connect(peer, "u2", "global");

    hub.receive(
      presser,
      JSON.stringify({
        type: "reaction",
        conversationId: "c1",
        messageId: "m1",
        reaction: "heart",
        userId: "user-9",
      }),
    );

    // The frame names the message so a reader in that thread re-reads in the
    // moment, and the identity is the socket's — never the payload's say-so.
    expect(peer.last()).toMatchObject({
      type: "reaction",
      userId: "u1",
      conversationId: "c1",
      messageId: "m1",
      reaction: "heart",
    });
    // The presser's own socket hears nothing back — its screen already holds
    // the verdict the API answered with.
    expect(presser.types()).not.toContain("reaction");
  });

  it("reaches the presser's own other tab, which is still a different reader", () => {
    const hub = new RoomHub();
    const presser = new FakeSocket();
    const theirOtherTab = new FakeSocket();
    hub.connect(presser, "u1", "global");
    hub.connect(theirOtherTab, "u1", "global");

    hub.receive(presser, JSON.stringify({ type: "reaction", conversationId: "c1", messageId: "m1" }));

    // A user is a set of sockets: the exclusion is the socket that caused the
    // send, not the member behind it.
    expect(theirOtherTab.last()).toMatchObject({ type: "reaction", userId: "u1" });
  });
});
