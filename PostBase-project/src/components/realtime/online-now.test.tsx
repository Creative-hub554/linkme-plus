// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The listing that took the Social strip's tabs' place, read through the two
 * claims a static render cannot see: that a visitor is shown nothing and the
 * API is asked nothing (a list that only ever fails is furniture), and that a
 * signed-in reader's first sight of it is the answer to the heartbeat the
 * component just sent — names, in the roster's online-first order, with the
 * status spelled out beside each one rather than only coloured.
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

async function mountOnlineNow(
  endpoint: StubEndpoint = roster,
): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch({ "/api/presence": endpoint });
  const ui = mountSurface(<OnlineNow />);
  return { ui, requests };
}

beforeEach(() => {
  mocks.signedIn = true;
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
    // answer a visitor 401, so the visitor's browser does not ask.
    expect(requests.calls).toEqual([]);
  });

  test("sends the heartbeat and renders the roster it comes back with", async () => {
    const { ui, requests } = await mountOnlineNow();

    await ui.waitFor(() => (ui.container.textContent ?? "").includes("Maya Chen"), {
      description: "the roster to arrive",
    });

    // One beat — the request that both counts the reader in and asks who is
    // here, so the listing never shows the answer to an older question.
    const beats = requests.calls.filter(
      (call) => call.pathname === "/api/presence" && call.method === "POST",
    );
    expect(beats).toHaveLength(1);

    const items = [...ui.container.querySelectorAll("li")];
    expect(items).toHaveLength(2);
    // The route sends online-first and the strip keeps that order, so the live
    // member cannot be pushed out of the slice by an idle one.
    expect(items[0].textContent).toContain("Maya Chen");
    expect(items[0].textContent).toContain("Online");
    expect(items[1].textContent).toContain("Sam Lee");
    expect(items[1].textContent).toContain("Offline");
    expect(ui.container.textContent).toContain("Online now");
  });

  test("draws the faces the strip has room for, not the whole roster", async () => {
    const crowded = {
      users: Array.from({ length: 10 }, (_, index) => ({
        userId: `member-${index}`,
        displayName: `Member ${index}`,
        avatarUrl: null,
        online: false,
      })),
    };

    const { ui } = await mountOnlineNow(crowded);
    await ui.waitFor(() => ui.container.querySelectorAll("li").length > 0, {
      description: "the roster to arrive",
    });

    expect(ui.container.querySelectorAll("li")).toHaveLength(8);
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
});
