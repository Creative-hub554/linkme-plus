// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The listing that took the Social strip's tabs' place, read through the
 * claims a static render cannot see: that a visitor is shown nothing and the
 * API is asked nothing (a list that only ever fails is furniture), and that a
 * signed-in reader's first sight of it is the roster the heartbeat answered
 * with — the members who are actually here, in the roster's online-first
 * order, with the status spelled out beside each one rather than only
 * coloured, and the row the roster flagged offline drawn not at all.
 *
 * The strip opens a socket now, so the browser's `WebSocket` is replaced with
 * a fake the test drives by hand: the socket's *snapshot* decides who is here
 * while it answers, an arrival lands without a beat, and the beat comes back
 * the moment the socket drops. A real one would attempt a connection the
 * suite never serves and report its failure asynchronously, some time after
 * the test has finished.
 */
const mocks = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: mocks.signedIn ? { user: { id: "member-1" } } : null,
    loading: false,
  }),
}));

import { OnlineNow } from "./online-now";

/** The roster as the route answers it: the online member first, by design. */
const roster = {
  users: [
    { userId: "member-2", displayName: "Maya Chen", avatarUrl: null, online: true },
    { userId: "member-3", displayName: "Sam Lee", avatarUrl: "sam.png", online: false },
  ],
};

/** The fake socket, with the events the strip listens for as real methods. */
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

  /** The server hanging up — which is what the beat's return path is for. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** The socket the current mount opened — one strip, one connection. */
  static get current(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }
}

/** How many times the strip has posted the heartbeat. */
function beats(requests: FetchRecorder): number {
  return requests.calls.filter(
    (call) => call.pathname === "/api/presence" && call.method === "POST",
  ).length;
}

async function mountOnlineNow(
  endpoint: StubEndpoint = roster,
): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch({ "/api/presence": endpoint });
  const ui = mountSurface(<OnlineNow />);
  return { ui, requests };
}

beforeEach(() => {
  mocks.signedIn = true;
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OnlineNow", () => {
  test("renders nothing for a visitor, and beats nowhere", async () => {
    mocks.signedIn = false;

    const { ui, requests } = await mountOnlineNow();

    expect(ui.container.innerHTML).toBe("");
    // Not a hidden listing with a live heartbeat behind it: the API would
    // answer a visitor 401, so the visitor's browser does not ask — and the
    // hook does not dial either, for the same reason.
    expect(requests.calls).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  test("sends the heartbeat and renders the members who are actually here", async () => {
    const { ui, requests } = await mountOnlineNow();

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Maya Chen"), {
      description: "the roster to arrive",
    });

    // One beat — the request that both counts the reader in and asks who is
    // here, so the listing never shows the answer to an older question.
    expect(beats(requests)).toBe(1);

    const items = [...ui.container.querySelectorAll("li")];
    // The roster answers with both members — Sam's row included, flagged
    // offline — and the strip draws only the one who is here. What survives
    // keeps the route's online-first order, so the live member leads.
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Maya Chen");
    expect(items[0].textContent).toContain("Online");
    expect(ui.container.textContent).not.toContain("Sam Lee");
    expect(ui.container.textContent).toContain("Online now");
  });

  test("draws the faces the strip has room for, not the whole roster", async () => {
    const crowded = {
      users: Array.from({ length: 10 }, (_, index) => ({
        userId: `member-${index}`,
        displayName: `Member ${index}`,
        avatarUrl: null,
        online: true,
      })),
    };

    const { ui } = await mountOnlineNow(crowded);
    await ui.waitFor(() => ui.container.querySelectorAll("li").length > 0, {
      description: "the roster to arrive",
    });

    expect(ui.container.querySelectorAll("li")).toHaveLength(8);
  });

  test("draws nothing at all when every member the roster answers with is idle", async () => {
    const allIdle = {
      users: [{ userId: "member-2", displayName: "Maya Chen", avatarUrl: null, online: false }],
    };

    const { ui, requests } = await mountOnlineNow(allIdle);
    await ui.waitFor(() => requests.calls.length === 1, { description: "the beat to be sent" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The heading is the claim; with nobody behind it, the strip keeps the
    // claim by not appearing rather than by drawing an empty one.
    expect(ui.container.innerHTML).toBe("");
  });

  test("renders nothing at all when the roster never answers", async () => {
    const { ui, requests } = await mountOnlineNow(() => {
      return new Response(JSON.stringify({ error: "presence is down" }), { status: 500 });
    });

    // Wait for the beat to have been sent, then for the microtasks that answer
    // it to drain — there is no visible state to wait *for*, which is the
    // point: a failed beat leaves the strip with the Feed tab and nothing
    // pretending to be a listing.
    await ui.waitFor(() => requests.calls.length === 1, { description: "the beat to be sent" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ui.container.innerHTML).toBe("");
  });

  test("takes the socket's snapshot as the verdict, over the roster's flags", async () => {
    const { ui } = await mountOnlineNow();
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Maya Chen"), {
      description: "the roster to arrive",
    });

    // The roster flags Maya online and Sam not. The socket says the opposite
    // — Sam is connected, Maya is not — and while the socket answers it wins:
    // a connection is a fact, a flag is a memory of the last beat.
    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({
        type: "presence:snapshot",
        userIds: ["member-1", "member-3"],
      });
    });

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Sam Lee"), {
      description: "the snapshot to take effect",
    });
    expect(ui.container.textContent).not.toContain("Maya Chen");
  });

  test("hears a member arrive in the moment, and beats again the moment the socket drops", async () => {
    const { ui, requests } = await mountOnlineNow();
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Maya Chen"), {
      description: "the roster to arrive",
    });
    expect(beats(requests)).toBe(1);

    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({ type: "user:online", userId: "member-3" });
    });

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Sam Lee"), {
      description: "Sam's arrival to land",
    });
    // The arrival needed no beat at all — the socket carried it, and with the
    // roster already in hand the interval is gone rather than merely ignored.
    expect(beats(requests)).toBe(1);

    await act(async () => {
      FakeWebSocket.current.drop();
    });
    // The socket is the realtime half; the moment it is gone the slow half is
    // picked back up — re-read at once, not one interval later.
    await ui.waitFor(() => beats(requests) === 2, { description: "the beat to resume" });
  });
});
