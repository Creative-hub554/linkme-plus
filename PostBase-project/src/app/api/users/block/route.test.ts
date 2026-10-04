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

import { POST } from "./route";
import { blocks } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

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

  it("blocks a member the caller does not already block", async () => {
    fakeDb.selectReturns(blocks, []);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ blocked: true });
    expectGatedSequence("writes", [
      { table: "blocks", values: { blockerId: "blocker-1", blockedId: TARGET_ID } },
    ]);
  });

  it("unblocks by deleting the existing row, writing nothing else", async () => {
    fakeDb.selectReturns(blocks, [{ id: BLOCK_ID }]);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blocked: false });
    expectGatedSequence("deletes", ["blocks"]);
    expectGatedNone("writes");
  });

  it("answers 500 when the lookup fails, writing nothing", async () => {
    fakeDb.failNextSelect(blocks);

    const response = await POST(block({ userId: TARGET_ID }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });
});
