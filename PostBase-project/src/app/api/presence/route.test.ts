import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The presence route: a heartbeat that counts a member in, and the roster it
 * answers with.
 *
 * "Online" is a property of *time* here — a member is online while their last
 * beat is inside {@link PRESENCE_WINDOW_MS} — so this file drives `Date` rather
 * than sleeping: the boundary is the claim, and a test that waits 90 seconds
 * proves nothing a `setSystemTime` cannot prove exactly. Only `Date` is faked,
 * so the route's own promises still settle on the microtask queue as they
 * normally would.
 *
 * The fake db answers from the `users` table the roster query selects from and
 * does not evaluate the join, so the rows below are what a real join would hand
 * back — member id and username from `users`, name and photo from `profiles`.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb };
});

const auth = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (auth.userId ? { user: { id: auth.userId } } : null),
    },
  },
}));

import { GET, POST } from "./route";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { resetPresence, PRESENCE_WINDOW_MS } from "@/lib/presence";
import { users } from "@/lib/db/schema";

/**
 * Three members, scripted out of name order — Sam before Theo before Maya —
 * so the roster's own ordering (online first, then by name) has to actually
 * rearrange them rather than echo the order the fake answered in.
 */
const MEMBERS = [
  { userId: "member-3", username: "sam", displayName: "Sam Lee", avatarUrl: null },
  { userId: "member-1", username: "theo", displayName: "Theo Wu", avatarUrl: "theo.png" },
  { userId: "member-2", username: "maya", displayName: "Maya Chen", avatarUrl: null },
];

const T0 = new Date("2026-10-08T12:00:00.000Z");

function request(method: "GET" | "POST" = "GET") {
  return new Request("http://localhost/api/presence", { method });
}

async function rosterFrom(handler: typeof GET | typeof POST, method: "GET" | "POST") {
  // The fake answers each read from the queue, so the roster is scripted for
  // *this* read rather than once per test: every request in a file that asks
  // several times sees the members a live database would return.
  fakeDb.selectReturns(users, MEMBERS);
  const response = await handler(request(method));
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { users: Array<{ userId: string; online: boolean }> };
  return payload.users;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  auth.userId = "member-1";
  resetPresence();
  resetFakeDb();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/presence", () => {
  test("answers 401 to a visitor, and reads nothing on the way", async () => {
    auth.userId = null;

    expect((await GET(request())).status).toBe(401);
    expect((await POST(request("POST"))).status).toBe(401);
    // No roster for a session that does not exist — not a partial answer and
    // not a database read made on behalf of nobody.
    expect(fakeDb.reads).toEqual([]);
  });

  test("counts nobody in: a plain read leaves every beat where it was", async () => {
    // No heartbeat has happened yet, and GET is not one — the roster it
    // returns must not have quietly made the caller online.
    const roster = await rosterFrom(GET, "GET");
    expect(roster.every((member) => member.online === false)).toBe(true);
  });
});

describe("POST /api/presence", () => {
  test("counts the caller in and answers with the whole roster, online first", async () => {
    const roster = await rosterFrom(POST, "POST");

    // Theo just beat, so he leads; the offline members follow by name — Maya
    // before Sam — which is not the order the fake handed the rows over in.
    expect(roster.map((member) => member.userId)).toEqual([
      "member-1",
      "member-2",
      "member-3",
    ]);
    expect(roster.filter((member) => member.online).map((member) => member.userId)).toEqual([
      "member-1",
    ]);
  });

  test("carries the profile beside the flag, so the strip need not fetch it twice", async () => {
    // Read straight here rather than through `rosterFrom`: that helper has
    // already consumed this response's body reading its status.
    fakeDb.selectReturns(users, MEMBERS);
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      users: Array<{ username: string | null; displayName: string | null; avatarUrl: string | null }>;
    };
    expect(payload.users.find((member) => member.username === "theo")).toMatchObject({
      displayName: "Theo Wu",
      avatarUrl: "theo.png",
    });
  });

  test("holds every live session at the head of the roster, by name", async () => {
    await rosterFrom(POST, "POST");
    auth.userId = "member-3";
    await rosterFrom(POST, "POST");

    const roster = await rosterFrom(GET, "GET");
    // Two beats, two online members — Sam before Theo by name, and Maya's
    // never-beaten row stays behind them.
    expect(roster.slice(0, 2).map((member) => member.userId)).toEqual(["member-3", "member-1"]);
    expect(roster[2]).toMatchObject({ userId: "member-2", online: false });
  });

  test("answers 500 when the roster cannot be read, rather than a half one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(users, new Error("database unreachable"));

    expect((await POST(request("POST"))).status).toBe(500);
  });
});

describe("the freshness window", () => {
  test("a beat is still online just inside the window, and gone just past it", async () => {
    await rosterFrom(POST, "POST");

    // One millisecond inside: the beat counts, even though it is old.
    vi.setSystemTime(new Date(T0.getTime() + PRESENCE_WINDOW_MS - 1));
    const inside = await rosterFrom(GET, "GET");
    expect(inside.find((member) => member.userId === "member-1")?.online).toBe(true);

    // One millisecond past: it is stale, and the member it belonged to is
    // shown offline like any member who never beat at all.
    vi.setSystemTime(new Date(T0.getTime() + PRESENCE_WINDOW_MS));
    const past = await rosterFrom(GET, "GET");
    expect(past.find((member) => member.userId === "member-1")?.online).toBe(false);
  });

  test("a fresh beat behind a stale one brings the member back", async () => {
    await rosterFrom(POST, "POST");
    vi.setSystemTime(new Date(T0.getTime() + PRESENCE_WINDOW_MS + 60_000));
    await rosterFrom(POST, "POST");

    const roster = await rosterFrom(GET, "GET");
    expect(roster.find((member) => member.userId === "member-1")?.online).toBe(true);
  });
});
