// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder } from "@/test/stub-fetch";

/**
 * The verdicts a listing draws per member, read through the claims a string
 * test cannot see: that an inactive consumer asks nothing and dials nothing ( a dialog that exists closed on the page must not connect before anyone
 * opens it), that a roster answers with a verdict for every member it knows —
 * and *no* verdict at all until something was actually asked or the ask
 * failed, because "not yet asked" and "away" are different claims and only one
 * of them may be drawn.
 *
 * The socket is a fake the test drives by hand, for the same reason the strip's
 * is: its snapshot decides while it answers, an arrival lands without a beat,
 * and the moment it drops the roster's flags are the live answer again.
 */
const mocks = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: mocks.signedIn ? { user: { id: "member-1" } } : null,
    loading: false,
  }),
}));

import { usePresenceFlags } from "./use-presence-flags";

/** The roster as the route answers it: every member flagged either way. */
const roster = {
  users: [
    { userId: "member-1", displayName: "Theo Wu", avatarUrl: null, online: false },
    { userId: "member-2", displayName: "Maya Chen", avatarUrl: null, online: true },
    { userId: "member-3", displayName: "Sam Lee", avatarUrl: null, online: false },
  ],
};

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

  /** The server hanging up — which is what the roster's return path is for. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** The socket the current mount opened — one probe, one connection. */
  static get current(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }
}

/** The verdicts for a few ids, as text a test can read off the document. */
function Probe({ ids, active = true }: { ids: string[]; active?: boolean }) {
  const { isOnline } = usePresenceFlags(active);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          {`${id}:${isOnline(id) === null ? "unknown" : isOnline(id) ? "online" : "offline"}`}
        </li>
      ))}
    </ul>
  );
}

function mountProbe(
  ids: string[],
  { active = true }: { active?: boolean } = {},
): { ui: MountedSurface; requests: FetchRecorder } {
  const requests = stubFetch({ "/api/presence": roster });
  const ui = mountSurface(<Probe ids={ids} active={active} />, { providers: "none" });
  return { ui, requests };
}

/** How many times the roster has been read. */
function beats(requests: FetchRecorder): number {
  return requests.calls.filter((call) => call.pathname === "/api/presence").length;
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

describe("usePresenceFlags", () => {
  test("asks nothing and claims nothing while inactive", async () => {
    // No sleep before the assertions: an inactive hook decides at mount — the
    // roster effect returns before fetching and the socket is handed its
    // disabled flag — so by the time the rows are on screen there is nothing
    // async left that could still dial.
    const { ui, requests } = mountProbe(["member-2"], { active: false });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2"), {
      description: "the probe's rows to render",
    });

    expect(requests.calls).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(ui.container.textContent).toContain("member-2:unknown");
  });

  test("asks nothing of the API and dials nothing for a visitor", async () => {
    mocks.signedIn = false;

    // As above: with no session the hook decides at mount, so the wait is for
    // the rows themselves rather than for anything to finish not happening.
    const { ui, requests } = mountProbe(["member-2"]);
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2"), {
      description: "the probe's rows to render",
    });

    expect(requests.calls).toEqual([]);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(ui.container.textContent).toContain("member-2:unknown");
  });

  test("reads the roster once and gives every member a verdict", async () => {
    const { ui, requests } = mountProbe(["member-2", "member-3", "member-9"]);

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the roster's verdict to arrive",
    });

    // One read — the heartbeat both counts the reader in and asks who is here —
    // and then the answer stands until a socket carries one.
    expect(beats(requests)).toBe(1);
    expect(ui.container.textContent).toContain("member-3:offline");
    // The roster answers for every member it knows; an id it does not name has
    // never been anywhere, and the flags are complete rather than partial.
    expect(ui.container.textContent).toContain("member-9:offline");
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("room=presence");
  });

  test("claims nothing when the roster cannot be read", async () => {
    const requests = stubFetch({
      "/api/presence": () => new Response(JSON.stringify({ error: "down" }), { status: 500 }),
    });
    const ui = mountSurface(<Probe ids={["member-2"]} />, { providers: "none" });

    await ui.waitFor(() => beats(requests) === 1, { description: "the read to be sent" });
    // The claim is an absence — that a failed read produces *no* verdict — and
    // there is no arrival to wait for; the sleep lets the answer be processed
    // so "still unknown" is read after it rather than before.
    await ui.settle(); // settle-on-purpose: an absence, not an arrival

    // A failed read is not a verdict: the row stays unknown rather than
    // drawing somebody as away because the ask went missing.
    expect(ui.container.textContent).toContain("member-2:unknown");
  });

  test("takes the socket's snapshot as the verdict, over the roster's flags", async () => {
    const { ui } = mountProbe(["member-2", "member-3"]);
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the roster's verdict to arrive",
    });

    // The roster flags Maya here and Sam not. The socket says the opposite —
    // Sam connected, Maya did not — and while the socket answers it wins: a
    // connection is a fact, a flag is a memory of the last beat. The snapshot
    // is complete, so everybody it omits is offline rather than keeping an
    // old flag.
    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({
        type: "presence:snapshot",
        userIds: ["member-1", "member-3"],
      });
    });

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-3:online"), {
      description: "the snapshot to take effect",
    });
    expect(ui.container.textContent).toContain("member-2:offline");
  });

  test("hears an arrival and a departure in the moment", async () => {
    const { ui } = mountProbe(["member-3"]);
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-3:offline"), {
      description: "the roster's verdict to arrive",
    });

    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({ type: "user:online", userId: "member-3" });
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-3:online"), {
      description: "Sam's arrival to land",
    });

    await act(async () => {
      FakeWebSocket.current.message({ type: "user:offline", userId: "member-3" });
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-3:offline"), {
      description: "Sam's departure to land",
    });
  });

  test("falls back to the roster's flags the moment the socket drops", async () => {
    const { ui } = mountProbe(["member-2", "member-3"]);
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the roster's verdict to arrive",
    });

    // The socket contradicts the roster, then hangs up: its verdicts are
    // frozen history the moment it is gone, and the flags it overrode are the
    // live answer again — rather than the last snapshot standing until some
    // later read.
    await act(async () => {
      FakeWebSocket.current.open();
      FakeWebSocket.current.message({ type: "presence:snapshot", userIds: ["member-3"] });
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-3:online"), {
      description: "the snapshot to take effect",
    });

    await act(async () => {
      FakeWebSocket.current.drop();
    });
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("member-2:online"), {
      description: "the roster's flags to stand in again",
    });
    expect(ui.container.textContent).toContain("member-3:offline");
  });

  test("refreshes the roster on its own heartbeat while no socket answers", async () => {
    // The slow beat, and the reason there is one: with no socket carrying
    // verdicts — one that has not answered yet, or one that hung up — the
    // roster *is* the live picture, and a roster read once is a roster going
    // stale on a page left open. Thirty seconds is the thing under test, so
    // the clock is driven rather than slept against: the same fake-timer seam
    // the socket's own ping heartbeat uses in `use-websocket.test.tsx`, and
    // for the same reason — what is claimed is *when* the read happens.
    vi.useFakeTimers();
    try {
      const { requests } = mountProbe(["member-2"]);

      // The activation's read resolves on the microtask queue, which fake
      // timers leave alone: advancing by zero drains it without the clock
      // standing in for an arrival.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(beats(requests)).toBe(1);

      // One beat, one more read — fired by the clock itself, since nothing
      // arrived: the interval is what keeps the stand-in from going stale.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(beats(requests)).toBe(2);

      // …and it keeps beat: the next thirty seconds read again, so an open
      // page with no socket never settles for an old roster.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(beats(requests)).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
