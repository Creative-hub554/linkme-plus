// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

import { ChatBubble } from "./chat-bubble";

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
  }: {
    onPost?: (request: StubRequest) => unknown;
    listAfterReading?: typeof listPayload;
  } = {},
) {
  let threadOpened = false;
  return (request: StubRequest) => {
    if (request.method === "POST") return onPost(request);
    if (request.query.get("id")) {
      threadOpened = true;
      return threadPayload;
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
  });

  afterEach(() => {
    // Unmount first: a Radix portal (the toggle's tooltip) is a body child.
    cleanupSurfaces();
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
    await ui.click(ui.byName("Send message to Maya Chen"));

    await ui.waitFor(
      () => (panelOf(ui.container)?.textContent ?? "").includes("On my way"),
      { description: "the sent message to show in the thread" },
    );

    const posts = requests.calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ recipientId: "user-2", content: "On my way" });
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
});
