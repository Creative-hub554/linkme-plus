import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The moderation record, read back.
 *
 * Who may read it is the same gate the reports route answers with: an
 * unauthenticated caller is a `401` before anything is read, and a
 * non-admin is a `403` having read only their own role row. What the list
 * gives is every recorded action, newest first, with the actor's handle
 * joined beside it — the read joins `users` on the cascade-deleting foreign
 * key, so a listed action always names who made it.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so what
 * the tests assert is the route's read order, the page envelope's total, and
 * the joined row shape — not the SQL.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "admin-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET } from "./route";
import { moderationActions, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedRead, expectGatedSequence } from "@/test/expect-gated";

const ACTION_ID = "11111111-1111-4111-8111-111111111111";

function list(path = "/api/admin/moderation-actions") {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/admin/moderation-actions", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(list());

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a caller who is not an admin, reading no actions", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "moderator" }]);

    const response = await GET(list());

    expect(response.status).toBe(403);
    // The role read only — the record is never reached.
    expectGatedSequence("reads", ["users"]);
  });

  it("lists the recorded actions newest first, with each actor's handle beside it", async () => {
    const rows = [
      { id: ACTION_ID, action: "ban", targetType: "user", reason: "spam network", actorUsername: "spammer-admin" },
      { id: "22222222-2222-4222-8222-222222222222", action: "warning", targetType: "post", reason: null, actorUsername: "admin-1" },
    ];
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(moderationActions, rows)
      .selectReturns(moderationActions, [{ total: 2 }]);

    const response = await GET(list());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: rows,
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1, hasMore: false },
    });
    // The role read, then the list and its total — the same three reads the
    // reports route makes of its own table.
    expectGatedSequence("reads", ["users", "moderation_actions", "moderation_actions"]);
    // A page carries no filter: the history is every action there is.
    expectGatedRead(moderationActions, { where: "" });
  });

  it("hands back the requested page", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(moderationActions, [])
      .selectReturns(moderationActions, [{ total: 45 }]);

    const response = await GET(list("/api/admin/moderation-actions?page=2&limit=20"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      pagination: { total: 45, page: 2, limit: 20, totalPages: 3, hasMore: true },
    });
  });

  it("includes the actor username through the join, not a second read", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(moderationActions, [
        { id: ACTION_ID, action: "suspension", targetType: "user", reason: "harassment", actorUsername: "mod-kev" },
      ])
      .selectReturns(moderationActions, [{ total: 1 }]);

    const response = await GET(list());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { actorUsername: string }[] };
    // The handle arrives on the same request: the joined list read is the
    // actor source, so the history never needs a lookup per row.
    expect(payload.data[0].actorUsername).toBe("mod-kev");
  });

  it("answers 500 when the list read fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .failNextSelect(moderationActions, new Error("database unavailable"));
    try {
      const response = await GET(list());

      expect(response.status).toBe(500);
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
