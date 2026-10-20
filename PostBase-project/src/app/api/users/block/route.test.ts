import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The block toggle: a caller may only ever block or unblock for themselves.
 *
 * Every write is keyed on the session user as the blocker, so the body can name
 * a target but never the actor. The cases worth pinning are the three refusals
 * that need no query — a missing target, an attempt to block yourself, and a
 * malformed id that would otherwise reach the database as a type error and a
 * `500` — and the toggle itself: no existing row inserts a block (`201`), an
 * existing row deletes it (`{blocked: false}`). The fake `@/lib/db` does not
 * evaluate `where`, so the toggle is read as "did an insert or a delete follow
 * the lookup".
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "blocker-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET, POST } from "./route";
import { blocks, follows, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedDelete, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "66666666-6666-4666-8666-666666666666";

function block(body: unknown) {
  return new Request("http://localhost/api/users/block", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "blocker-1";
});

describe("GET /api/users/block", () => {
  it("requires a session before reading block state", async () => {
    session.userId = null;

    const response = await GET(new Request(`http://localhost/api/users/block?userId=${TARGET_ID}`));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("reports the viewer's block state after validating the target", async () => {
    fakeDb.selectReturns(users, [{ id: TARGET_ID }]).selectReturns(blocks, [{ id: BLOCK_ID }]);

    const response = await GET(new Request(`http://localhost/api/users/block?userId=${TARGET_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blocked: true });
    expectGatedSequence("reads", ["users", "blocks"]);
  });

  it("answers 404 for a missing target", async () => {
    fakeDb.selectReturns(users, []);

    const response = await GET(new Request(`http://localhost/api/users/block?userId=${TARGET_ID}`));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["users"]);
  });

  it("requires a target id, reading nothing", async () => {
    const response = await GET(new Request("http://localhost/api/users/block"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "User ID is required" });
    expectGatedNone("reads");
  });

  it("refuses a malformed target id, reading nothing", async () => {
    const response = await GET(new Request("http://localhost/api/users/block?userId=not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid user ID" });
    expectGatedNone("reads");
  });

  it("refuses to read your own block state", async () => {
    // The session id is a real uuid here, so the self-refusal is the branch
    // that answers — not the uuid check a non-uuid session id would hit first.
    const SELF_ID = "33333333-3333-4333-8333-333333333333";
    session.userId = SELF_ID;

    const response = await GET(new Request(`http://localhost/api/users/block?userId=${SELF_ID}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Cannot block yourself" });
    expectGatedNone("reads");
  });

  it("answers 500 when the block state cannot be read", async () => {
    fakeDb.selectReturns(users, [{ id: TARGET_ID }]).failNextSelect(blocks);
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await GET(new Request(`http://localhost/api/users/block?userId=${TARGET_ID}`));

      expect(response.status).toBe(500);
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("POST /api/users/block", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a user id, reading nothing", async () => {
    const response = await POST(block({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "User ID is required" });
    expectGatedNone("reads");
  });

  it("refuses to block yourself, reading nothing", async () => {
    const response = await POST(block({ userId: "blocker-1" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Cannot block yourself" });
    expectGatedNone("reads");
  });

  it("refuses a malformed target id, reading nothing", async () => {
    // The id is bound into the block lookup, so a non-uuid is a bad request
    // here rather than a type error the database raises as a 500.
    for (const userId of ["not-a-uuid", 123, {}, TARGET_ID.slice(0, -1)]) {
      const response = await POST(block({ userId }));

      expect(response.status, JSON.stringify(userId)).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid user ID" });
    }
    expectGatedNone("reads");
  });

  it("blocks a member, removes follows in either direction, and returns fresh counts", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(blocks, [])
      .insertReturns(blocks, [{ id: BLOCK_ID }])
      .selectReturns(follows, [{ followers: 3 }])
      .selectReturns(follows, [{ following: 4 }]);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ blocked: true, followers: 3, following: 4 });
    expectGatedSequence("writes", [
      { table: "blocks", values: { blockerId: "blocker-1", blockedId: TARGET_ID } },
    ]);
    expectGatedSequence("deletes", ["follows"]);
    expectGatedDelete(follows, {
      where: [
        '"follows"."follower_id" = $1',
        '"follows"."following_id" = $2',
        '"follows"."follower_id" = $3',
        '"follows"."following_id" = $4',
      ],
      params: ["blocker-1", TARGET_ID, TARGET_ID, "blocker-1"],
    });
  });

  it("unblocks without restoring either follow, and returns fresh counts", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(blocks, [{ id: BLOCK_ID }])
      .selectReturns(follows, [{ followers: 2 }])
      .selectReturns(follows, [{ following: 1 }]);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blocked: false, followers: 2, following: 1 });
    expectGatedSequence("deletes", ["blocks"]);
    expectGatedNone("writes");
    expectGatedDelete(blocks, {
      where: '"blocks"."id" = $1',
      params: [BLOCK_ID],
    });
  });

  it("answers 500 when the block lookup fails, writing nothing", async () => {
    fakeDb.selectReturns(users, [{ id: TARGET_ID }]).failNextSelect(blocks);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });

  it("answers 500 when the target lookup fails, writing nothing", async () => {
    fakeDb.failNextSelect(users);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });

  it("answers 404 for an unknown target without writing", async () => {
    fakeDb.selectReturns(users, []);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });
});
