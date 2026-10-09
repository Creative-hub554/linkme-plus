// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";
import { PresenceProvider } from "@/components/providers/presence-provider";
import { RoomProvider } from "@/components/providers/room-provider";

/**
 * The messages page's conversation column, read against the count the route
 * sends.
 *
 * The column wore a badge it could never show: the count beside each
 * conversation was a hardcoded zero, because the list carried no count. The
 * count is the server's now (`unreadCount` beside each conversation, and the
 * total at the top of the payload), and this file holds the page to being a
 * pipe for it — the number the route sends is the number the column shows,
 * and a conversation with nothing unread renders no badge rather than a zero.
 *
 * What the number *is* — messages from somebody else since the thread was
 * last opened — belongs to the route's own test; here the pipe is fed a
 * number and must deliver it.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ session: { user: { id: "user-1" } }, loading: false }),
  signOut: () => {},
}));

const unreadConversation = {
  id: "conversation-1",
  otherMember: { userId: "user-2", name: "Maya Chen", avatarUrl: null },
  lastMessage: {
    content: "See you then",
    createdAt: "2026-09-20T09:00:00.000Z",
    senderId: "user-2",
  },
  unreadCount: 3,
};

const readConversation = {
  ...unreadConversation,
  id: "conversation-2",
  otherMember: { userId: "user-3", name: "Sam Lee", avatarUrl: null },
  unreadCount: 0,
};

/**
 * The list at rest, and the thread by id — the page opens the first
 * conversation on mount, which is a second request to the same endpoint.
 */
const endpoints: Record<string, StubEndpoint> = {
  "/api/messages": (request) =>
    request.query.get("id")
      ? { conversation: { id: "conversation-1" }, messages: [], otherMember: null }
      : { conversations: [unreadConversation, readConversation], unreadCount: 3 },
};

async function mountMessages(
  endpointsToUse: Record<string, StubEndpoint> = endpoints,
  { layout = false }: { layout?: boolean } = {},
): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch(endpointsToUse);
  const { default: MessagesPage } = await import("@/app/(main)/messages/page");
  // `layout` mounts the page the way the app's layouts do — the root
  // layout's shared room connection above the signed-in layout's shared
  // presence channel — which is the shape the production topology assertions
  // read. Without it the page mounts bare, each presence consumer falling
  // back to a channel of its own, which is what the other tests here want:
  // page behaviour, not wiring.
  const node = layout ? (
    <RoomProvider room="global">
      <PresenceProvider>
        <MessagesPage />
      </PresenceProvider>
    </RoomProvider>
  ) : (
    <MessagesPage />
  );
  const ui = mountSurface(node);
  return { ui, requests };
}

/** The fake socket, with the events the page listens for as real methods. */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  /** A clean teardown's close: silent, or the hook would reconnect into the next test. */
  close() {
    this.readyState = 3;
  }

  // --- what the test drives ---

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /**
   * The page's own socket: the first one opened, at mount — before the list
   * arrives and the column's presence read (and the thread header's indicator)
   * opens sockets of their own. Only this one is in the chat room, so only
   * this one hears a message arrive, which is exactly the split the
   * production hub keeps between rooms.
   */
  static get first(): FakeSocketShape {
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }
}

interface FakeSocketShape {
  open(): void;
  message(payload: unknown): void;
  sent: string[];
}

/** The button a conversation is listed as — the row the badge belongs to. */
function rowNamed(ui: MountedSurface, name: string) {
  return [...ui.container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(name),
  );
}

/**
 * The unread marker and its `sr-only` text — the count's meaning, which the
 * bare digit does not carry. Found by its words rather than by being the
 * first `sr-only` in the row: the presence dot wears one too ("Offline").
 */
function unreadLabel(row: HTMLElement) {
  return [...row.querySelectorAll("span.sr-only")].find(
    (span) => span.textContent?.trim() === "unread",
  );
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the messages page's unread column", () => {
  test("shows the count the server sent, in the row it was sent for", async () => {
    const { ui } = await mountMessages();

    await ui.waitFor(() => rowNamed(ui, "Maya Chen") !== undefined, {
      description: "the conversations to arrive",
    });

    const mayaRow = rowNamed(ui, "Maya Chen")!;
    const label = unreadLabel(mayaRow);
    expect(label, "the unread conversation wore no unread marker").toBeDefined();
    // The count and its meaning live in the same badge: 3, said out loud.
    expect(label!.parentElement!.textContent).toContain("3");
  });

  test("renders no badge at all for a conversation with nothing unread", async () => {
    const { ui } = await mountMessages();

    await ui.waitFor(() => rowNamed(ui, "Sam Lee") !== undefined, {
      description: "the conversations to arrive",
    });

    const samRow = rowNamed(ui, "Sam Lee")!;
    expect(unreadLabel(samRow)).toBeUndefined();
    // No zero standing in for "none": the badge is absent, not empty.
    expect(samRow.textContent).not.toContain("unread");
  });

  test("re-reads the column and the open thread when a message arrives over the socket", async () => {
    let listReads = 0;
    let threadReads = 0;
    const { ui } = await mountMessages({
      "/api/messages": (request) => {
        if (request.query.get("id")) {
          threadReads += 1;
          return { conversation: { id: "conversation-1" }, messages: [], otherMember: null };
        }
        listReads += 1;
        return { conversations: [unreadConversation, readConversation], unreadCount: 3 };
      },
    });

    await ui.waitFor(() => rowNamed(ui, "Maya Chen") !== undefined, {
      description: "the conversations to arrive",
    });
    // The first read, and the first conversation opening itself on mount.
    expect(listReads).toBe(1);
    expect(threadReads).toBe(1);

    // This page used to read once and then go stale — no poll, no push — so a
    // conversation that received a message kept its old preview until
    // somebody navigated. Only the socket fetches again here: nothing in this
    // test waits on a clock.
    await act(async () => {
      FakeWebSocket.first.open();
      FakeWebSocket.first.message({ type: "message", conversationId: "conversation-2" });
    });
    await ui.waitFor(() => listReads >= 2, { description: "the column to re-read" });
    // Somebody else's conversation: the open thread is not yanked out from
    // under the reader.
    expect(threadReads).toBe(1);

    // Their own conversation, though, updates where they are reading it.
    await act(async () => {
      FakeWebSocket.first.message({ type: "message", conversationId: "conversation-1" });
    });
    await ui.waitFor(() => threadReads >= 2, { description: "the open thread to re-read" });
  });

  test("shows read receipts from the counterpart's watermark, and announces its own", async () => {
    const THEIR_LAST_OPEN = "2026-09-20T09:30:00.000Z"; // covers the 09:00 message only
    const OUR_MARK = "2026-09-20T09:50:00.000Z"; // this open's server-issued watermark
    const thread = {
      conversation: { id: "conversation-1" },
      messages: [
        {
          id: "m1",
          content: "Hi Maya",
          senderId: "user-1",
          readAt: null,
          createdAt: "2026-09-20T09:00:00.000Z",
          sender: { name: "Theo Wu", avatarUrl: null },
        },
        {
          id: "m2",
          content: "Still writing it up",
          senderId: "user-1",
          readAt: null,
          createdAt: "2026-09-20T09:45:00.000Z",
          sender: { name: "Theo Wu", avatarUrl: null },
        },
        {
          id: "m3",
          content: "Hey!",
          senderId: "user-2",
          readAt: null,
          createdAt: "2026-09-20T09:40:00.000Z",
          sender: { name: "Maya Chen", avatarUrl: null },
        },
      ],
      otherMember: {
        userId: "user-2",
        name: "Maya Chen",
        avatarUrl: null,
        lastReadAt: THEIR_LAST_OPEN,
      },
      lastReadAt: OUR_MARK,
    };
    stubFetch({
      "/api/messages": (request) =>
        request.query.get("id")
          ? thread
          : { conversations: [unreadConversation, readConversation], unreadCount: 3 },
    });

    const { default: MessagesPage } = await import("@/app/(main)/messages/page");
    const ui = mountSurface(<MessagesPage />);
    await act(async () => {
      // The page's own socket, opened before the column's presence read and
      // the thread header's indicator add sockets of their own — this is the
      // one its sends and listens use.
      FakeWebSocket.first.open();
    });

    await ui.waitFor(() => rowNamed(ui, "Maya Chen") !== undefined, {
      description: "the conversations to arrive",
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Hi Maya"), {
      description: "the first conversation's thread to open",
    });

    const bubbleFor = (text: string) => {
      const paragraph = [...ui.container.querySelectorAll("p")].find(
        (node) => node.textContent === text,
      );
      expect(paragraph, `no bubble rendered for ${text}`).not.toBeNull();
      return paragraph!.parentElement!.textContent ?? "";
    };

    // Their watermark covers my 09:00 message and nothing after it — and
    // never one of theirs, however old.
    expect(bubbleFor("Hi Maya")).toContain("· Read");
    expect(bubbleFor("Still writing it up")).not.toContain("Read");
    expect(bubbleFor("Hey!")).not.toContain("Read");

    // This open moved *our* watermark in the database; the frame on the page's
    // socket carries that server instant — not one the browser invented.
    const frames = FakeWebSocket.instances[0].sent.map(
      (raw) => JSON.parse(raw) as Record<string, unknown>,
    );
    expect(frames).toContainEqual({
      type: "read",
      conversationId: "conversation-1",
      at: Date.parse(OUR_MARK),
    });

    // Noise that must not move the watermark: a receipt from somebody who is
    // not the counterpart, and one for a different conversation.
    await act(async () => {
      FakeWebSocket.first.message({
        type: "read",
        conversationId: "conversation-1",
        userId: "user-9",
        at: Date.parse("2026-09-21T00:00:00.000Z"),
      });
      FakeWebSocket.first.message({
        type: "read",
        conversationId: "elsewhere",
        userId: "user-2",
        at: Date.parse("2026-09-21T00:00:00.000Z"),
      });
    });
    expect(bubbleFor("Still writing it up")).not.toContain("Read");

    // …and the counterpart's own receipt for this thread advances it.
    await act(async () => {
      FakeWebSocket.first.message({
        type: "read",
        conversationId: "conversation-1",
        userId: "user-2",
        at: Date.parse("2026-09-20T09:50:00.000Z"),
      });
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("· Read"), {
      description: "the receipt to arrive over the socket",
    });
    expect(bubbleFor("Still writing it up")).toContain("· Read");
  });
});

describe("the column's one read of who is here", () => {
  test("one presence connection and one roster beat for the whole page, as the layout mounts it", async () => {
    const { ui, requests } = await mountMessages(
      {
        ...endpoints,
        // The same roster shape the Social strip reads: Maya is here.
        "/api/presence": {
          users: [
            { userId: "user-2", displayName: "Maya Chen", avatarUrl: null, online: true },
            { userId: "user-3", displayName: "Sam Lee", avatarUrl: null, online: false },
          ],
        },
      },
      // Production's shape: the layout's provider wraps the column, the
      // thread header's indicator and every row — the mount the collapse
      // actually happens at.
      { layout: true },
    );

    await ui.waitFor(() => rowNamed(ui, "Maya Chen") !== undefined, {
      description: "the conversations to arrive",
    });

    // The roster the shared channel read flags Maya here, and her row says so
    // in the words beside the dot — the verdict travelling the one channel
    // the strip and the header read too.
    const mayaRow = rowNamed(ui, "Maya Chen")!;
    await ui.waitFor(() => (mayaRow.textContent ?? "").includes("Online"), {
      description: "the column's verdict to reach the row",
    });

    // The verdict's arrival is what makes the counts below stable: every
    // consumer claiming at mount has done so (a claim is an effect, and the
    // read it queued has now answered), so whatever the page is going to dial
    // or fetch it already has.

    // One connection for the page — the column's ask, the header's indicator
    // and the rows between them — where this page used to open two before the
    // provider existed and would open one per consumer if a future one dialed
    // for itself instead of reading the shared answer.
    const presenceSockets = () =>
      FakeWebSocket.instances.filter((socket) => socket.url.includes("room=presence"));
    expect(presenceSockets()).toHaveLength(1);

    // One roster beat to answer all of them: the read the channel sends when
    // the first surface claims it, and no second one for the consumers that
    // claimed beside it. A consumer that fetched its own roster — or dialed
    // its own socket — fails one of these two counts.
    const rosterReads = requests.calls.filter((call) => call.pathname === "/api/presence");
    expect(rosterReads).toHaveLength(1);

    // …and one connection for the room this page's realtime traffic rides:
    // the page's own socket and the thread's typing indicator both ask for
    // `global`, and under the root layout's provider they are one — where a
    // bare mount opens two, and the app used to pay for both on every visit.
    const roomSockets = () =>
      FakeWebSocket.instances.filter((socket) => socket.url.includes("room=global"));
    expect(roomSockets()).toHaveLength(1);
  });
});

describe("chat reactions on a message", () => {
  const messageRow = {
    id: "message-1",
    // Deliberately *not* the list's preview text: a wait on the thread has to
    // find words only the open thread can carry.
    content: "Doors open at ten",
    senderId: "user-2",
    createdAt: "2026-09-20T09:00:00.000Z",
    readAt: null,
    reactions: [{ type: "heart", count: 1, mine: false }],
  };

  /** The thread with a reaction on it, and the toggle endpoint beside it. */
  const reactionEndpoints: Record<string, StubEndpoint> = {
    "/api/messages": (request) =>
      request.query.get("id")
        ? {
            conversation: { id: "conversation-1" },
            messages: [messageRow],
            otherMember: { userId: "user-2", name: "Maya Chen", lastReadAt: null },
            lastReadAt: null,
          }
        : { conversations: [unreadConversation, readConversation], unreadCount: 3 },
    "/api/messages/reactions": (request) =>
      request.method === "POST"
        ? { reacted: true, type: request.body?.type ?? null }
        : { counts: {}, total: 0, userReaction: null },
  };

  test("the chip carries the count the read grouped, and a press goes to the API", async () => {
    const { ui, requests } = await mountMessages(reactionEndpoints);

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Doors open at ten"), {
      description: "the thread to open",
    });
    await ui.waitFor(
      () =>
        [...ui.container.querySelectorAll("button")].some((button) =>
          button.getAttribute("aria-label")?.startsWith("heart reaction,"),
        ),
      { description: "the chip to arrive" },
    );
    // The press announces over the page's own socket, so it has to be open.
    await act(async () => {
      FakeWebSocket.first.open();
    });

    const chip = [...ui.container.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === "heart reaction, 1 reaction — add your reaction",
    )!;
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      chip.click();
    });

    // The press reached the API as the message and the type…
    const toggle = requests.calls.find(
      (call) => call.pathname === "/api/messages/reactions" && call.method === "POST",
    );
    expect(toggle?.body).toEqual({ targetId: "message-1", type: "heart" });
    // …and the confirmed verdict is what the chip now draws: mine, counted.
    await ui.waitFor(
      () =>
        [...ui.container.querySelectorAll("button")].some(
          (button) =>
            button.getAttribute("aria-label") ===
            "heart reaction, 2 reactions — remove your reaction",
        ),
      { description: "the confirmed verdict to reach the chip" },
    );

    // The room is told which message moved, so a peer's thread re-reads.
    const frames = FakeWebSocket.first.sent.map(
      (raw) => JSON.parse(raw) as Record<string, unknown>,
    );
    expect(frames).toContainEqual({
      type: "reaction",
      conversationId: "conversation-1",
      messageId: "message-1",
      reaction: "heart",
    });
  });

  test("a reaction frame for the open thread re-reads it, and one elsewhere does not", async () => {
    const { ui, requests } = await mountMessages(reactionEndpoints);

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Doors open at ten"), {
      description: "the thread to open",
    });
    await act(async () => {
      FakeWebSocket.first.open();
    });
    const threadReads = () =>
      requests.calls.filter(
        (call) => call.pathname === "/api/messages" && call.query.get("id") === "conversation-1",
      );
    const before = threadReads().length;

    // Another press, on another conversation: this thread stays put.
    await act(async () => {
      FakeWebSocket.first.message({
        type: "reaction",
        conversationId: "elsewhere",
        messageId: "x",
      });
    });
    expect(threadReads()).toHaveLength(before);

    // …and one for the open thread re-reads it — the counts come from the
    // server's own grouping, never from the frame's say-so.
    await act(async () => {
      FakeWebSocket.first.message({
        type: "reaction",
        conversationId: "conversation-1",
        messageId: "message-1",
      });
    });
    await ui.waitFor(() => threadReads().length === before + 1, {
      description: "the open thread to re-read",
    });
  });

  test("a press the server refuses changes nothing on screen, and says so", async () => {
    const { ui } = await mountMessages({
      ...reactionEndpoints,
      "/api/messages/reactions": (request) =>
        request.method === "POST"
          ? new Response(JSON.stringify({ error: "no" }), {
              status: 403,
              headers: { "content-type": "application/json" },
            })
          : { counts: {}, total: 0, userReaction: null },
    });

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Doors open at ten"), {
      description: "the thread to open",
    });
    const chip = [...ui.container.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === "heart reaction, 1 reaction — add your reaction",
    )!;
    await act(async () => {
      chip.click();
    });

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("couldn't save that reaction"), {
      description: "the refusal to reach the reader",
    });
    // The chip is exactly where it was: nothing was assumed ahead of the API.
    expect(
      [...ui.container.querySelectorAll("button")].some(
        (button) =>
          button.getAttribute("aria-label") === "heart reaction, 1 reaction — add your reaction",
      ),
    ).toBe(true);
  });
});
