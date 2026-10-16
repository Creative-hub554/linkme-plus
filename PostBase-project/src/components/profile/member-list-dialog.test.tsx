// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch } from "@/test/stub-fetch";
import { MemberListDialog, type MemberListEvent } from "@/components/profile/member-list-dialog";

/**
 * The followers/following dialog, driven through its one endpoint.
 *
 * It has three states that must not be confused — loading, empty and a list —
 * plus two live paths that only a follow event reaches: a row fetched by id when
 * someone joins, and a filtered-out row when someone leaves. The follow button
 * on each row is stubbed: it is a different component with its own requests, and
 * this is a test of the list.
 */
vi.mock("@/components/social/follow-button", () => ({
  FollowButton: ({ userId }: { userId: string }) => (
    <button type="button" aria-label={`Follow ${userId}`}>
      Follow {userId}
    </button>
  ),
}));

/**
 * Presence rides along on the same two doubles the strip's test uses: a
 * session, so the roster is asked for rather than skipped, and a hand-driven
 * `WebSocket`, because the real one would dial a server the suite never serves
 * and report its failure asynchronously, some time after the test has finished.
 */
const mocks = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: mocks.signedIn ? { user: { id: "member-1" } } : null,
    loading: false,
  }),
}));

/** The fake socket, with the events the test drives as real methods. */
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

  /** The socket the current mount opened — one dialog, one connection. */
  static get current(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }
}

/** The roster as the route answers it: every member flagged either way. */
function rosterResponse(members: Array<{ userId: string; online: boolean }>) {
  return {
    users: members.map((member) => ({
      userId: member.userId,
      displayName: null,
      avatarUrl: null,
      online: member.online,
    })),
  };
}

const members = [
  {
    id: "u1",
    username: "maya",
    displayName: "Maya Chen",
    avatarUrl: null,
    bio: "Designer",
    isFollowing: true,
  },
  {
    id: "u2",
    username: "theo",
    displayName: "Theo Wu",
    avatarUrl: "https://cdn.example/theo.png",
    bio: null,
    isFollowing: false,
  },
];

/** The pagination cursor the first page hands back, so "Load more" exists. */
const nextCursor = "cursor-2";

function page(data: typeof members, cursor: string | null) {
  return { data, pagination: { nextCursor: cursor } };
}

function renderDialog(props: Partial<Parameters<typeof MemberListDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const ui = mountSurface(
    <MemberListDialog
      open
      onOpenChange={onOpenChange}
      userId="u1"
      mode="followers"
      {...props}
    />,
    { providers: "none" },
  );
  return { ui, onOpenChange };
}

/** A row is found in the document, not the container: the dialog is a portal. */
function rowNamed(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll("li")].find((row) => row.textContent?.includes(name)) as HTMLElement | undefined
  ) ?? null;
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // A dialog is portalled onto the body, but each test mounts its own and the
  // leak check clears it; nothing else in this file leaves a document behind.
  mocks.signedIn = true;
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

describe("MemberListDialog", () => {
  test("loads the list and names it for the owner", async () => {
    stubFetch({ "/api/users/follow": page(members, null) });
    const { ui } = renderDialog({ ownerName: "Maya Chen", total: 40, viewerId: "u1" });
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the rows to arrive" });
    expect(document.body.textContent).toContain("Followers of Maya Chen");
    expect(document.body.textContent).toContain("Showing 2 of 40");
    // The viewer's own row is labelled rather than followed.
    expect(rowNamed("Maya Chen")?.textContent).toContain("· You");
    expect(document.body.textContent).toContain("Follow u2");
    expect(rowNamed("Theo Wu")?.textContent).toContain("@theo");
  });

  test("names the following list for its owner", async () => {
    stubFetch({ "/api/users/follow": page(members, null) });
    const { ui } = renderDialog({ mode: "following", ownerName: "Maya Chen" });
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the rows to arrive" });
    expect(document.body.textContent).toContain("Members Maya Chen follows");
  });

  test("falls back to the plain title with no owner named", async () => {
    stubFetch({ "/api/users/follow": page([], null) });
    const { ui } = renderDialog();
    await ui.waitFor(() => document.body.textContent?.includes("No followers yet") ?? false, {
      description: "the empty state",
    });
    expect(document.body.textContent).toContain("Followers");
    expect(document.body.textContent).toContain("Members who follow this profile.");
    expect(document.body.textContent).toContain("When somebody follows this profile");
  });

  test("says when a following list is empty", async () => {
    stubFetch({ "/api/users/follow": page([], null) });
    const { ui } = renderDialog({ mode: "following" });
    await ui.waitFor(() => document.body.textContent?.includes("Not following anyone yet") ?? false, {
      description: "the empty following state",
    });
    expect(document.body.textContent).toContain("The profiles this member follows");
  });

  test("shows a loading state while the first page is in flight", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const { ui } = renderDialog();
    await ui.waitFor(() => document.querySelector('[aria-label="Loading followers"]') !== null, {
      description: "the loading skeleton",
    });
    await act(async () => {
      release(
        new Response(JSON.stringify(page(members, null)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
  });

  test("offers a retry when the first page fails", async () => {
    let attempts = 0;
    stubFetch(
      {
        "/api/users/follow": () => {
          attempts += 1;
          return attempts === 1
            ? new Response(JSON.stringify({ error: "no" }), { status: 500 })
            : page(members, null);
        },
      },
    );
    const { ui } = renderDialog();
    await ui.waitFor(() => document.body.textContent?.includes("Try again") ?? false, {
      description: "the retry state",
    });
    expect(document.body.textContent).toContain("unavailable");
    const retry = [...document.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    await ui.click(retry as HTMLElement);
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the retry to load the list" });
  });

  test("loads the next page and does not repeat a row", async () => {
    stubFetch({
      "/api/users/follow": (request) =>
        request.query.get("cursor")
          ? page([members[1], { ...members[0], id: "u3", displayName: "Nia" }], null)
          : page(members, nextCursor),
    });
    const { ui } = renderDialog();
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the first page" });
    const more = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load more");
    await ui.click(more as HTMLElement);
    await ui.waitFor(() => rowNamed("Nia") !== null, { description: "the second page" });
    // Theo came back on both pages and must not be listed twice.
    expect([...document.querySelectorAll("li")].filter((row) => row.textContent?.includes("Theo Wu"))).toHaveLength(1);
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Load more")).toBe(false);
  });

  test("says so when a further page fails", async () => {
    stubFetch({
      "/api/users/follow": (request) =>
        request.query.get("cursor")
          ? new Response(JSON.stringify({ error: "no" }), { status: 500 })
          : page(members, nextCursor),
    });
    const { ui } = renderDialog();
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the first page" });
    const more = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load more");
    await ui.click(more as HTMLElement);
    await ui.waitFor(() => document.body.textContent?.includes("couldn't load more") ?? false, {
      description: "the load-more failure",
    });
    // The rows already loaded stay on screen behind the message.
    expect(rowNamed("Maya Chen")).not.toBeNull();
  });

  test("prepends a member who joins the open list", async () => {
    stubFetch({
      "/api/users/follow": page(members, null),
      "/api/users/brief": {
        data: [{ id: "u9", username: "nia", displayName: "Nia Okoro", avatarUrl: null, bio: "New", isFollowing: true }],
      },
    });
    const { ui } = renderDialog();
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the first page" });
    const event: MemberListEvent = { seq: 1, memberId: "u9", added: true };
    await ui.render(
      <MemberListDialog open onOpenChange={() => {}} userId="u1" mode="followers" event={event} />,
    );
    await ui.waitFor(() => rowNamed("Nia Okoro") !== null, { description: "the new member to appear" });
    expect(rowNamed("Nia Okoro")?.textContent).toContain("@nia");
  });

  test("shows a placeholder while a joining member's row is fetched", async () => {
    let release: (value: Response) => void = () => {};
    stubFetch({ "/api/users/follow": page([], null) });
    const { ui } = renderDialog();
    await ui.waitFor(() => document.body.textContent?.includes("No followers yet") ?? false, {
      description: "the empty list",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const event: MemberListEvent = { seq: 2, memberId: "u9", added: true };
    await ui.render(
      <MemberListDialog open onOpenChange={() => {}} userId="u1" mode="followers" event={event} />,
    );
    await ui.waitFor(() => document.querySelector('[aria-label="Loading a new member"]') !== null, {
      description: "the placeholder for the joining member",
    });
    await act(async () => {
      release(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
  });

  test("drops a member who leaves the open list", async () => {
    stubFetch({ "/api/users/follow": page(members, null) });
    const { ui } = renderDialog();
    await ui.waitFor(() => rowNamed("Theo Wu") !== null, { description: "the first page" });
    const event: MemberListEvent = { seq: 3, memberId: "u2", added: false };
    await ui.render(
      <MemberListDialog open onOpenChange={() => {}} userId="u1" mode="followers" event={event} />,
    );
    expect(rowNamed("Theo Wu")).toBeNull();
    expect(rowNamed("Maya Chen")).not.toBeNull();
  });

  test("asks to close, and drops the rows it held", async () => {
    stubFetch({ "/api/users/follow": page(members, null) });
    const { ui, onOpenChange } = renderDialog();
    await ui.waitFor(() => rowNamed("Maya Chen") !== null, { description: "the first page" });
    await ui.press(document.body, "Escape");
    await ui.waitFor(() => onOpenChange.mock.calls.length > 0, { description: "the close request" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  describe("presence", () => {
    test("draws who is here beside each name once the roster answers", async () => {
      const requests = stubFetch({
        "/api/users/follow": page(members, null),
        "/api/presence": rosterResponse([
          { userId: "u1", online: false },
          { userId: "u2", online: true },
        ]),
      });
      const { ui } = renderDialog();

      await ui.waitFor(
        () => rowNamed("Theo Wu")?.textContent?.includes("Online") ?? false,
        { description: "the roster's verdict to arrive" },
      );
      expect(requests.calls.some((call) => call.pathname === "/api/presence")).toBe(true);
      expect(rowNamed("Theo Wu")?.textContent).not.toContain("Offline");
      expect(rowNamed("Maya Chen")?.textContent).toContain("Offline");
    });

    test("claims nothing about presence before anything has been asked", async () => {
      // The follow list answers; presence answers with nothing to say (the
      // undeclared path falls back to an empty body). Until a roster or a
      // socket has actually spoken, a row is a name — not somebody drawn as
      // away because the ask had not happened yet.
      const requests = stubFetch({ "/api/users/follow": page(members, null) });
      const { ui } = renderDialog();

      await ui.waitFor(() => rowNamed("Theo Wu") !== null, { description: "the first page" });
      // The claim is an absence — that the roster's answer drew *no* verdict —
      // and there is no arrival to wait for; the sleep lets the answer be
      // processed so "still nothing drawn" is read after it rather than before.
      await ui.settle(); // settle-on-purpose: an absence, not an arrival

      expect(requests.calls.some((call) => call.pathname === "/api/presence")).toBe(true);
      expect(document.body.textContent).not.toContain("Online");
      expect(document.body.textContent).not.toContain("Offline");
    });

    test("takes the socket's verdict over the roster's flags, both ways", async () => {
      stubFetch({
        "/api/users/follow": page(members, null),
        "/api/presence": rosterResponse([
          { userId: "u1", online: true },
          { userId: "u2", online: false },
        ]),
      });
      const { ui } = renderDialog();
      await ui.waitFor(
        () => rowNamed("Maya Chen")?.textContent?.includes("Online") ?? false,
        { description: "the roster's verdict to arrive" },
      );

      // The roster has it backwards from the socket's point of view: Theo is
      // here, Maya is not. While the socket answers it wins in both directions —
      // a connection is a fact, a flag is a memory of the last beat.
      await act(async () => {
        FakeWebSocket.current.open();
        FakeWebSocket.current.message({ type: "presence:snapshot", userIds: ["u2"] });
      });

      await ui.waitFor(
        () => rowNamed("Theo Wu")?.textContent?.includes("Online") ?? false,
        { description: "the snapshot to take effect" },
      );
      expect(rowNamed("Maya Chen")?.textContent).not.toContain("Online");
      expect(rowNamed("Maya Chen")?.textContent).toContain("Offline");
    });

    test("does not ask about presence or dial for a visitor", async () => {
      mocks.signedIn = false;
      const requests = stubFetch({ "/api/users/follow": page(members, null) });
      const { ui } = renderDialog();

      // No sleep before these either: with no session the hook decides at
      // mount — the roster effect returns before fetching and the socket gets
      // its disabled flag — so by the time the rows are up there is nothing
      // async left that could still dial.
      await ui.waitFor(() => rowNamed("Theo Wu") !== null, { description: "the first page" });

      // The API would answer a visitor 401, so the visitor's browser does not
      // ask — and the hook does not dial either, for the same reason.
      expect(requests.calls.filter((call) => call.pathname === "/api/presence")).toHaveLength(0);
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(document.body.textContent).not.toContain("Online");
    });
  });
});
