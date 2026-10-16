// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { json, stubFetch, type StubRequest } from "@/test/stub-fetch";

/**
 * The floating chat bubble, read through the panel it opens.
 *
 * The claims a static render cannot see are the ones this file judges: that
 * nothing is shown until the reader is signed in; that the badge and the row
 * dots are the *server's* unread counts — this component derives nothing,
 * because the list endpoint counts what is unread — and that opening a
 * conversation marks it read, the counts come back cleared, and the badge
 * follows; and that a send either lands or hands the text back.
 *
 * The bubble also opens a socket now, so the browser's `WebSocket` is
 * replaced with a fake the test drives: a message arriving over `/ws` is
 * what re-reads the list in the moment, a send tells the room the row exists,
 * and the slow poll is only ever the fallback for a socket that never
 * answers. A real socket would attempt a connection the suite never serves
 * and report its failure asynchronously, after the test that opened it.
 */
const mocks = vi.hoisted(() => {
  const user = { id: "user-1", email: "theo@example.com", name: "Theo Wu" };
  return {
    isAuthenticated: true,
    // The page the bubble floats over — anything but the messages page, which
    // the component hides itself on.
    pathname: "/feed",
    authIn: { isAuthenticated: true, isLoading: false, user, session: null },
    authOut: { isAuthenticated: false, isLoading: false, user: null, session: null },
  };
});

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => (mocks.isAuthenticated ? mocks.authIn : mocks.authOut),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

// The socket's only input is the current user id; whether the auth client has
// one is what decides whether a connection opens at all.
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: mocks.isAuthenticated ? { user: { id: "user-1" } } : null,
    loading: false,
  }),
}));

import { ChatBubble } from "./chat-bubble";

/** The fake socket, with the events the bubble listens for as real methods. */
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

  /** The frames the bubble itself put on the wire, parsed. */
  sentFrames(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  /**
   * The bubble's *own* socket — the first one opened, at mount, before the
   * thread's typing indicator opens one of its own to listen on. Every claim
   * here is about what this component sent or heard, so this is the socket
   * those claims are read from, not merely the newest one in the list.
   */
  static get current(): FakeWebSocket {
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }
}

/** The list as the server answers it: the total, and each conversation's count. */
const listPayload = {
  // The badge's number — the sum of the per-conversation counts below.
  unreadCount: 3,
  conversations: [
    {
      id: "conversation-1",
      unreadCount: 2,
      otherMember: { userId: "user-2", name: "Maya Chen", avatarUrl: null },
      lastMessage: {
        content: "See you then",
        createdAt: "2026-09-20T09:00:00.000Z",
        senderId: "user-2",
      },
    },
    {
      id: "conversation-2",
      unreadCount: 1,
      otherMember: { userId: "user-3", name: "Sam Lee", avatarUrl: null },
      lastMessage: {
        content: "Thanks!",
        createdAt: "2026-09-20T10:00:00.000Z",
        senderId: "user-3",
      },
    },
    {
      // Nothing unread: the reader's own thread, already caught up on.
      id: "conversation-3",
      unreadCount: 0,
      otherMember: { userId: "user-4", name: "Ana Diaz", avatarUrl: null },
      lastMessage: {
        content: "Hi from me",
        createdAt: "2026-09-22T10:00:00.000Z",
        senderId: "user-1",
      },
    },
  ],
};

/** The same list after conversation-1 has been opened and marked read. */
const listAfterReading = {
  unreadCount: 1,
  conversations: [
    { ...listPayload.conversations[0], unreadCount: 0 },
    listPayload.conversations[1],
    listPayload.conversations[2],
  ],
};

const threadPayload = {
  conversation: { id: "conversation-1" },
  messages: [
    {
      id: "m1",
      content: "See you then",
      senderId: "user-2",
      readAt: null,
      createdAt: "2026-09-20T09:00:00.000Z",
      sender: { name: "Maya Chen", avatarUrl: null },
    },
  ],
  otherMember: { userId: "user-2", name: "Maya Chen", avatarUrl: null },
};

/**
 * The endpoint behind every state: the list at rest, the thread by id, and a
 * send that echoes the body back as the server would save it. After the thread
 * is asked for, list reads answer with `listAfterReading` — reading marks the
 * thread read server-side, and the next list carries the cleared counts.
 */
function answerMessages(
  {
    onPost = () => json({ error: "send failed" }, 500),
    listAfterReading: settled = listPayload,
    thread = threadPayload,
  }: {
    onPost?: (request: StubRequest) => unknown;
    listAfterReading?: typeof listPayload;
    thread?: typeof threadPayload;
  } = {},
) {
  let threadOpened = false;
  return (request: StubRequest) => {
    if (request.method === "POST") return onPost(request);
    if (request.query.get("id")) {
      threadOpened = true;
      return thread;
    }
    return threadOpened ? settled : listPayload;
  };
}

/** The toggle, which the panel's own id makes findable however it is named. */
function toggleOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[aria-controls="chat-panel"]');
}

function panelOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>("#chat-panel");
}

/** The unread markers in the panel — the dot and its `sr-only` text pair. */
function unreadDots(panel: HTMLElement) {
  return [...panel.querySelectorAll("span.sr-only")].filter(
    (span) => span.textContent === "unread",
  );
}

async function openPanel(ui: ReturnType<typeof mountSurface>) {
  const toggle = toggleOf(ui.container);
  expect(toggle, "the bubble rendered no control to open the panel").not.toBeNull();
  await ui.click(toggle!);
  await ui.waitFor(() => panelOf(ui.container) !== null, { description: "the panel to open" });
  return panelOf(ui.container)!;
}

describe("the chat bubble", () => {
  beforeEach(() => {
    mocks.isAuthenticated = true;
    mocks.pathname = "/feed";
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    // Unmount first: a Radix portal (the toggle's tooltip) is a body child —
    // and the hook closes its socket on the way out, which needs the fake
    // still in place.
    cleanupSurfaces();
    vi.unstubAllGlobals();
  });

  test("renders nothing at all for a signed-out visitor", async () => {
    const requests = stubFetch({});
    mocks.isAuthenticated = false;

    const ui = mountSurface(<ChatBubble />);

    expect(ui.container.innerHTML).toBe("");
    // Not a hidden bubble with a live poll behind it: a visitor's browser asks
    // the API nothing, because the API would answer with an auth error.
    expect(requests.calls).toEqual([]);
  });

  test("shows the server's unread total rather than deriving one here", async () => {
    stubFetch({ "/api/messages": answerMessages({ onPost: () => json({}, 201) }) });

    const ui = mountSurface(<ChatBubble />);
    const toggle = toggleOf(ui.container);
    expect(toggle).not.toBeNull();

    // Arrived, not slept on: the badge is the list's total, which the bubble
    // has to fetch before it can exist.
    await ui.waitFor(
      () => (toggleOf(ui.container)?.getAttribute("aria-label") ?? "").includes("unread"),
      { description: "the unread badge to arrive" },
    );

    // Exactly the total the endpoint sent — the three conversations' counts
    // (2 + 1 + 0) — announced as what it is on screen.
    expect(toggleOf(ui.container)!.getAttribute("aria-label")).toBe(
      "Chat, 3 unread messages",
    );
    // …and the badge on screen is the same number, not a decorative dot.
    expect(toggleOf(ui.container)!.textContent).toContain("3");
  });

  test("hides itself on the messages page, where the page itself is the chat", async () => {
    const requests = stubFetch({ "/api/messages": answerMessages({ onPost: () => json({}, 201) }) });
    mocks.pathname = "/messages";

    const ui = mountSurface(<ChatBubble />);

    // Not a smaller or disabled bubble — no floating layer at all over a page
    // that already lists every conversation with its own unread badges.
    expect(toggleOf(ui.container)).toBeNull();
    expect(panelOf(ui.container)).toBeNull();
    expect(ui.container.innerHTML).toBe("");
    // …and no hidden poller either. That page reads the same list itself, so
    // the signed-in visitor's browser does not ask a second time for a badge
    // nobody can see.
    expect(requests.calls).toEqual([]);
  });

  test("opens a panel listing the conversations the API returns", async () => {
    stubFetch({ "/api/messages": answerMessages({ onPost: () => json({}, 201) }) });

    const ui = mountSurface(<ChatBubble />);
    const panel = await openPanel(ui);

    expect(toggleOf(ui.container)!.getAttribute("aria-expanded")).toBe("true");
    expect(panel.textContent).toContain("Maya Chen");
    expect(panel.textContent).toContain("See you then");
    expect(panel.textContent).toContain("Sam Lee");
    // Two dots — one for each conversation the server counted unread, so the
    // badge's total can be located in the list it sums.
    expect(unreadDots(panel)).toHaveLength(2);
    expect(unreadDots(panel)[0].closest("button")!.textContent).toContain("Maya Chen");
  });

  test("choosing a conversation loads its thread, then the badge follows the cleared counts", async () => {
    const requests = stubFetch({
      "/api/messages": answerMessages({
        onPost: () => json({}, 201),
        listAfterReading,
      }),
    });

    const ui = mountSurface(<ChatBubble />);
    const panel = await openPanel(ui);

    const maya = [...ui.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Maya Chen"),
    );
    expect(maya, "the panel listed no conversation to choose").toBeTruthy();
    await ui.click(maya!);

    // The thread, by id — not merely the preview carried over from the list.
    await ui.waitFor(() => (panelOf(ui.container)?.textContent ?? "").includes("See you then"), {
      description: "the thread to arrive",
    });
    const threadIndex = requests.calls.findIndex(
      (call) => call.pathname === "/api/messages" && call.query.get("id") === "conversation-1",
    );
    expect(threadIndex, "the panel never asked for the conversation's messages").toBeGreaterThanOrEqual(0);

    // Reading a thread marks it read server-side, so the list is re-read right
    // after — without this the badge would keep counting a conversation the
    // reader is looking at.
    expect(
      requests.calls
        .slice(threadIndex + 1)
        .some((call) => call.pathname === "/api/messages" && !call.query.get("id") && call.method === "GET"),
      "the conversation list was never re-read after the thread was opened",
    ).toBe(true);

    // Reading that thread marked it read server-side, so the re-read counts
    // come back cleared for it — and the badge is that answer, 3 down to 1,
    // with no derivation on this side to keep in step.
    await ui.waitFor(
      () => toggleOf(ui.container)?.getAttribute("aria-label") === "Chat, 1 unread message",
      { description: "the badge to settle on the re-read total" },
    );

    // And the thread is a place with a way out.
    await ui.click(ui.byName("Back to conversations"));
    await ui.waitFor(() => panel.textContent!.includes("Open in Messages"), {
      description: "the conversation list to come back",
    });
  });

  test("sends a message from the panel and keeps the saved copy", async () => {
    const requests = stubFetch({
      "/api/messages": answerMessages({
        onPost: (request) => ({
          message: {
            id: "m-saved",
            content: request.body?.content,
            senderId: "user-1",
            createdAt: "2026-09-22T11:00:00.000Z",
          },
          conversationId: "conversation-1",
        }),
      }),
    });

    const ui = mountSurface(<ChatBubble />);
    await openPanel(ui);
    await ui.click(
      [...ui.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Maya Chen"),
      )!,
    );
    await ui.waitFor(() => ui.container.querySelector('[aria-label="Message text"]') !== null, {
      description: "the composer to arrive with the thread",
    });

    const input = ui.byName("Message text") as HTMLInputElement;
    await ui.type(input, "On my way");
    // Disabled while empty, named for who it goes to.
    expect(ui.byName("Send message to Maya Chen")).toBeTruthy();
    await act(async () => {
      FakeWebSocket.current.open();
    });
    await ui.click(ui.byName("Send message to Maya Chen"));

    await ui.waitFor(
      () => (panelOf(ui.container)?.textContent ?? "").includes("On my way"),
      { description: "the sent message to show in the thread" },
    );

    const posts = requests.calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ recipientId: "user-2", content: "On my way" });
    // The API saved the row; this tells the room it exists, so the recipient's
    // list re-reads in the moment instead of on their next beat. The socket is
    // open in this test — a closed one sends nothing, which is exactly when
    // their fallback poll is already running.
    expect(FakeWebSocket.current.sentFrames()).toContainEqual(
      expect.objectContaining({ type: "message", conversationId: "conversation-1" }),
    );
    // The composer is empty again — the message is in the thread, not in a
    // field the reader has to clear before the next one.
    expect(input.value).toBe("");
  });

  test("hands the text back when the send fails", async () => {
    stubFetch({ "/api/messages": answerMessages() }); // every POST answers 500

    const ui = mountSurface(<ChatBubble />);
    await openPanel(ui);
    await ui.click(
      [...ui.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Maya Chen"),
      )!,
    );
    await ui.waitFor(() => ui.container.querySelector('[aria-label="Message text"]') !== null, {
      description: "the composer to arrive with the thread",
    });

    const input = ui.byName("Message text") as HTMLInputElement;
    await ui.type(input, "Meet at six");
    await ui.click(ui.byName("Send message to Maya Chen"));

    await ui.waitFor(() => ui.container.querySelector('[role="alert"]') !== null, {
      description: "the failure to be announced",
    });
    // Nothing is silently dropped: the draft is back in the field, ready to
    // retry, and the optimistic copy never claimed a place in the thread.
    expect(input.value).toBe("Meet at six");
    expect(panelOf(ui.container)!.textContent).not.toContain("Meet at six");
  });

  test("re-reads the badge the moment a message arrives over the socket", async () => {
    // The list answers with the counts it had, then — as though somebody
    // else's message had landed server-side — with the cleared ones. Only the
    // socket event fetches that second answer: nothing here waits on a clock,
    // which is the whole claim over the old 30-second poll.
    let reads = 0;
    stubFetch({
      "/api/messages": (request) => {
        if (request.method === "POST") return json({}, 201);
        if (request.query.get("id")) return threadPayload;
        reads += 1;
        return reads === 1 ? listPayload : listAfterReading;
      },
    });

    const ui = mountSurface(<ChatBubble />);
    await ui.waitFor(
      () => toggleOf(ui.container)?.getAttribute("aria-label") === "Chat, 3 unread messages",
      { description: "the initial badge" },
    );

    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({ type: "message", conversationId: "conversation-2" });
    });

    await ui.waitFor(
      () => toggleOf(ui.container)?.getAttribute("aria-label") === "Chat, 1 unread message",
      { description: "the badge to follow the socket's news" },
    );
  });

  test("a message for the open thread re-reads it; one for another thread leaves it alone", async () => {
    let threadReads = 0;
    stubFetch({
      "/api/messages": (request) => {
        if (request.method === "POST") return json({}, 201);
        if (request.query.get("id")) {
          threadReads += 1;
          return threadPayload;
        }
        return listPayload;
      },
    });

    const ui = mountSurface(<ChatBubble />);
    await openPanel(ui);
    await ui.click(
      [...ui.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Maya Chen"),
      )!,
    );
    await ui.waitFor(() => (panelOf(ui.container)?.textContent ?? "").includes("See you then"), {
      description: "the thread to arrive",
    });
    expect(threadReads).toBe(1);

    // Somebody else's conversation: the reader's own thread must not be
    // yanked out from under them, however loud the room is.
    await act(async () => {
      FakeWebSocket.current.message({ type: "message", conversationId: "conversation-2" });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(threadReads).toBe(1);

    // …and their own conversation updates where they are reading it.
    await act(async () => {
      FakeWebSocket.current.message({ type: "message", conversationId: "conversation-1" });
    });
    await ui.waitFor(() => threadReads === 2, { description: "the open thread to re-read" });
  });

  test("closes on Escape, the way a floating layer should", async () => {
    stubFetch({ "/api/messages": answerMessages({ onPost: () => json({}, 201) }) });

    const ui = mountSurface(<ChatBubble />);
    await openPanel(ui);

    await ui.press(toggleOf(ui.container), "Escape");
    await ui.waitFor(() => panelOf(ui.container) === null, {
      description: "the panel to close on Escape",
    });
    expect(toggleOf(ui.container)!.getAttribute("aria-expanded")).toBe("false");
  });

  test("marks my messages the counterpart has read — and announces my own reads on the socket", async () => {
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
    stubFetch({ "/api/messages": answerMessages({ thread }) });

    const ui = mountSurface(<ChatBubble />);
    await act(async () => {
      FakeWebSocket.current.open();
    });
    await openPanel(ui);
    await ui.click(
      [...ui.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Maya Chen"),
      )!,
    );
    await ui.waitFor(() => (panelOf(ui.container)?.textContent ?? "").includes("Hi Maya"), {
      description: "the thread to arrive",
    });

    const panel = panelOf(ui.container)!;
    const bubbleFor = (text: string) => {
      const paragraph = [...panel.querySelectorAll("p")].find((node) => node.textContent === text);
      expect(paragraph, `no bubble rendered for ${text}`).not.toBeNull();
      return paragraph!.parentElement!.textContent ?? "";
    };

    // Their watermark (09:30) covers my 09:00 message and nothing sent after
    // it — and never one of theirs, however old.
    expect(bubbleFor("Hi Maya")).toContain("· Read");
    expect(bubbleFor("Still writing it up")).not.toContain("Read");
    expect(bubbleFor("Hey!")).not.toContain("Read");

    // This open moved *our* watermark in the database; the frame on the wire
    // carries that server instant — not one the browser's clock invented.
    expect(FakeWebSocket.current.sentFrames()).toContainEqual({
      type: "read",
      conversationId: "conversation-1",
      at: Date.parse(OUR_MARK),
    });
  });

  test("advances the receipt when the counterpart's read frame arrives over the socket", async () => {
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
          content: "And this too",
          senderId: "user-1",
          readAt: null,
          createdAt: "2026-09-20T09:45:00.000Z",
          sender: { name: "Theo Wu", avatarUrl: null },
        },
      ],
      otherMember: { userId: "user-2", name: "Maya Chen", avatarUrl: null, lastReadAt: null },
    };
    stubFetch({ "/api/messages": answerMessages({ thread }) });

    const ui = mountSurface(<ChatBubble />);
    await act(async () => {
      FakeWebSocket.current.open();
    });
    await openPanel(ui);
    await ui.click(
      [...ui.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Maya Chen"),
      )!,
    );
    await ui.waitFor(() => (panelOf(ui.container)?.textContent ?? "").includes("Hi Maya"), {
      description: "the thread to arrive",
    });
    expect(panelOf(ui.container)!.textContent).not.toContain("· Read");

    // Noise that must not move the watermark: a receipt from somebody who is
    // not the counterpart, and one for a different conversation entirely.
    await act(async () => {
      FakeWebSocket.current.message({
        type: "read",
        conversationId: "conversation-1",
        userId: "user-9",
        at: Date.parse("2026-09-21T00:00:00.000Z"),
      });
      FakeWebSocket.current.message({
        type: "read",
        conversationId: "elsewhere",
        userId: "user-2",
        at: Date.parse("2026-09-21T00:00:00.000Z"),
      });
    });
    expect(panelOf(ui.container)!.textContent).not.toContain("· Read");

    // …and the counterpart's own receipt for this thread, covering both.
    await act(async () => {
      FakeWebSocket.current.message({
        type: "read",
        conversationId: "conversation-1",
        userId: "user-2",
        at: Date.parse("2026-09-20T09:50:00.000Z"),
      });
    });
    await ui.waitFor(() => (panelOf(ui.container)?.textContent ?? "").includes("· Read"), {
      description: "the receipt to arrive over the socket",
    });
    const panel = panelOf(ui.container)!;
    const bubbleFor = (text: string) =>
      [...panel.querySelectorAll("p")].find((node) => node.textContent === text)!.parentElement!
        .textContent ?? "";
    expect(bubbleFor("Hi Maya")).toContain("· Read");
    expect(bubbleFor("And this too")).toContain("· Read");
  });
});
