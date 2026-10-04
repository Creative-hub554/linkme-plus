import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The users route: resolving a profile to read, and updating your own to write.
 *
 * `GET` resolves one member by `id` or `username`, with their follower/following
 * counts and whether the viewer follows them, and answers `404` for a member who
 * is not there. It has a deliberate outage path: when the database is
 * unreachable it renders the *authenticated* member from their Auth metadata and
 * says so (`persistence: "auth-metadata"`), so a pooler outage does not blank
 * the settings page.
 *
 * `PUT` edits only the caller's own row — the update is keyed on the session
 * user, never an id from the body. It validates a username before using it,
 * refuses one already taken with `409`, and builds a partial `profileUpdate`
 * that carries only the fields the body actually sent. Its outage path mirrors
 * `GET`'s: if the write fails it copies the changes into Auth metadata and
 * answers `200 persistence: "auth-metadata"`, and only when that also fails does
 * it answer `503`.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so scoping
 * is read as which table was written and what the write carried. The Supabase
 * client is mocked because this route touches it only in the fallback.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "viewer-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

const supa = vi.hoisted(() => ({ mode: "ok" as "ok" | "error" | "throw" }));

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      updateUser: async () => {
        if (supa.mode === "throw") throw new Error("supabase unavailable");
        if (supa.mode === "error") return { error: { message: "nope" } };
        return { error: null };
      },
    },
  }),
}));

import { GET, PUT } from "./route";
import { follows, profiles, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const USER_ROW = {
  id: USER_ID,
  username: "alice",
  role: "member",
  displayName: "Alice",
  bio: "hi",
  visibility: "public",
};

/** The user/profile rows the repair step consumes, so it makes no writes. */
function repaired() {
  return fakeDb
    .selectReturns(users, [{ id: "viewer-1" }])
    .selectReturns(profiles, [{ id: "p-1" }]);
}

function get(query: string) {
  return new Request(`http://localhost/api/users${query}`, { method: "GET" });
}

function put(body: unknown) {
  return new Request("http://localhost/api/users", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "viewer-1";
  supa.mode = "ok";
});

describe("GET /api/users", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(get(`?id=${USER_ID}`));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("answers 404 when the member is not there", async () => {
    repaired().selectReturns(users, []);

    const response = await GET(get(`?id=${USER_ID}`));

    expect(response.status).toBe(404);
    // Repair (users, profiles), then the resolve read.
    expectGatedSequence("reads", ["users", "profiles", "users"]);
  });

  it("returns the member with their counts and the viewer's follow state", async () => {
    repaired()
      .selectReturns(users, [USER_ROW])
      .selectReturns(follows, [{ followers: 12 }])
      .selectReturns(follows, [{ following: 4 }])
      .selectReturns(follows, [{ id: "f-1" }]);

    const response = await GET(get(`?id=${USER_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: USER_ROW,
      stats: { followers: 12, following: 4 },
      isFollowing: true,
    });
    // Resolve read, then the three follows reads (followers, following, check).
    expectGatedSequence("reads", ["users", "profiles", "users", "follows", "follows", "follows"]);
  });

  it("renders the signed-in member from Auth metadata when the database fails", async () => {
    // Repair cannot find a local user, so it exhausts its retries and throws;
    // the route must still answer rather than blank the page.
    fakeDb.selectReturns(users, []);

    const response = await GET(get(`?id=${USER_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.persistence).toBe("auth-metadata");
    expect(body.user.id).toBe("viewer-1");
    expect(body.stats).toEqual({ followers: 0, following: 0 });
    expect(body.isFollowing).toBe(false);
  });

  it("falls back to Auth metadata when the resolve read fails", async () => {
    repaired();
    fakeDb.failNextSelect(users);

    const response = await GET(get(`?id=${USER_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.persistence).toBe("auth-metadata");
    expect(body.user.id).toBe("viewer-1");
  });
});

describe("PUT /api/users", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await PUT(put({ displayName: "New" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a username that is not 3-30 letters/digits/underscores", async () => {
    repaired();

    const response = await PUT(put({ username: "No Spaces!" }));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a username already taken by someone else, writing nothing", async () => {
    repaired().selectReturns(users, [{ id: "someone-else" }]);

    const response = await PUT(put({ username: "taken" }));

    expect(response.status).toBe(409);
    expectGatedNone("writes");
  });

  it("writes only the fields the body sent, keyed on the session user", async () => {
    repaired();
    fakeDb.updateReturns(profiles, [{ ...USER_ROW, displayName: "New Name", bio: "hi" }]);

    const response = await PUT(put({ displayName: "  New Name  ", bio: "hi", skills: ["a", "b"] }));

    expect(response.status).toBe(200);
    expect(fakeDb.writes).toHaveLength(1);
    expectGatedUpdate(profiles, {
      first: true,
      values: { displayName: "New Name", bio: "hi", skills: ["a", "b"] },
    });
  });

  it("copies changes into Auth metadata when the write fails, and says so", async () => {
    repaired();
    fakeDb.failNextUpdate(profiles);

    const response = await PUT(put({ displayName: "New Name" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.persistence).toBe("auth-metadata");
    expect(body.profile.display_name).toBe("New Name");
  });

  it("answers 503 when the write fails and the metadata fallback errors too", async () => {
    repaired();
    fakeDb.failNextUpdate(profiles);
    supa.mode = "error";

    const response = await PUT(put({ displayName: "New Name" }));

    expect(response.status).toBe(503);
  });

  it("answers 503 when the write fails and the metadata client cannot be reached", async () => {
    repaired();
    fakeDb.failNextUpdate(profiles);
    supa.mode = "throw";

    const response = await PUT(put({ displayName: "New Name" }));

    expect(response.status).toBe(503);
  });

  it("falls back to Auth metadata when the repair read fails", async () => {
    fakeDb.failNextSelect(users);

    const response = await PUT(put({ displayName: "New Name" }));

    expect(response.status).toBe(200);
    expect((await response.json()).persistence).toBe("auth-metadata");
  });
});
