import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The display-preferences route: the accent, and nothing else.
 *
 * This endpoint stores the one preference that belongs to the account privately
 * — the accent — and deliberately not the light/dark choice, which belongs to
 * the device. What these tests pin is the shape of that contract: `GET` returns
 * the member's own `appearance` (an empty object when nothing is stored), `PUT`
 * accepts only an accent the picker offers and merges it into the existing
 * JSONB in **one** statement rather than reading and rewriting it, and both
 * answer `503 Preferences are temporarily unavailable` on a database failure —
 * an honest failure so the caller keeps what the device has, rather than an
 * invented empty preference. Both methods run the profile-repair step first, so
 * an email sign-up can reach them before its local records exist.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the merge
 * is read rather than executed: the test asserts the written value is a SQL
 * expression (which cannot clobber sibling keys) and not a plain object. The
 * fake's `failNextUpdate` is the seam for the `503`.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET, PUT } from "./route";
import { profiles, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

function jsonRequest(method: string, body: unknown, raw = false) {
  return new Request("http://localhost/api/preferences", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

/** The profile rows the repair step and the route's own read consume, in order. */
function profileExists() {
  return fakeDb.selectReturns(users, [{ id: "member-1" }]).selectReturns(profiles, [{ id: "p-1" }]);
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("GET /api/preferences", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(new Request("http://localhost/api/preferences", { method: "GET" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("returns an empty appearance when nothing has been stored", async () => {
    profileExists().selectReturns(profiles, [{ appearance: null }]);

    const response = await GET(new Request("http://localhost/api/preferences", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ appearance: {} });
  });

  it("returns the accent that was stored", async () => {
    profileExists().selectReturns(profiles, [{ appearance: { accent: "violet" } }]);

    const response = await GET(new Request("http://localhost/api/preferences", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ appearance: { accent: "violet" } });
  });

  it("provisions the profile first when the records do not exist yet", async () => {
    // The repair step finds the local user, finds no profile, and creates one
    // before the route reads it.
    fakeDb
      .selectReturns(users, [{ id: "member-1" }])
      .selectReturns(profiles, [])
      .selectReturns(profiles, [{ appearance: { accent: "rose" } }]);

    const response = await GET(new Request("http://localhost/api/preferences", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ appearance: { accent: "rose" } });
    expectGatedSequence("writes", [
      { table: "profiles", values: { userId: "member-1", displayName: "Member", avatarUrl: null } },
    ]);
  });

  it("answers 503 when the read fails, rather than inventing an empty preference", async () => {
    profileExists();
    fakeDb.failNextSelect(profiles);

    const response = await GET(new Request("http://localhost/api/preferences", { method: "GET" }));

    expect(response.status).toBe(503);
  });
});

describe("PUT /api/preferences", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await PUT(jsonRequest("PUT", { accent: "blue" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a body that is not JSON, reading nothing", async () => {
    const response = await PUT(jsonRequest("PUT", "not json", true));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses an accent the picker does not offer, writing nothing", async () => {
    const response = await PUT(jsonRequest("PUT", { accent: "chartreuse" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a missing accent, writing nothing", async () => {
    const response = await PUT(jsonRequest("PUT", {}));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("merges the accent in one update and returns the stored appearance", async () => {
    profileExists();
    fakeDb.updateReturns(profiles, [{ appearance: { accent: "emerald" } }]);

    const response = await PUT(jsonRequest("PUT", { accent: "emerald" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ appearance: { accent: "emerald" } });
    expect(fakeDb.writes).toHaveLength(1);
    // A SQL expression, not a plain object: `||` merges the key and leaves any
    // sibling keys alone, which a whole-object write would clobber.
    expectGatedUpdate(profiles, {
      first: true,
      values: expect.objectContaining({
        appearance: expect.objectContaining({ queryChunks: expect.anything() }),
      }),
    });
  });

  it("falls back to the requested accent when the update returned no row", async () => {
    profileExists();
    fakeDb.updateReturns(profiles, []);

    const response = await PUT(jsonRequest("PUT", { accent: "amber" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ appearance: { accent: "amber" } });
  });

  it("answers 503 when the write fails, rather than inventing a preference", async () => {
    profileExists();
    fakeDb.failNextUpdate(profiles);

    const response = await PUT(jsonRequest("PUT", { accent: "blue" }));

    expect(response.status).toBe(503);
  });
});
