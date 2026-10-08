// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

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

async function mountMessages(): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch(endpoints);
  const { default: MessagesPage } = await import("@/app/(main)/messages/page");
  const ui = mountSurface(<MessagesPage />);
  return { ui, requests };
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
});
