import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notifications route: the viewer's own rows, and the authoritative unread
 * total beside them.
 *
 * Both methods are scoped to the session user, so the body cannot reach another
 * member's notifications — and `POST` additionally scopes its update to rows
 * that are still unread, which makes marking idempotent. What these tests pin is
 * that boundary and the response shape: `GET` lists (bounded) rows with a
 * separate unread `COUNT`; `POST` refuses a request that names neither an id nor
 * `all: true`, refuses a malformed id, and then updates either every unread row
 * or the one named row, always recomputing the unread total rather than trusting
 * a client decrement. The fake `@/lib/db` does not evaluate `where`, so the
 * scoping is read as which table was written and what the update returned.
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

import { GET, POST } from "./route";
import { notifications } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

const NOTIFICATION_ID = "11111111-1111-4111-8111-111111111111";

function markRead(body: unknown) {
  return new Request("http://localhost/api/notifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "viewer-1";
});

describe("GET /api/notifications", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(new Request("http://localhost/api/notifications", { method: "GET" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("returns the rows and the unread total, reading notifications twice", async () => {
    const rows = [{ id: NOTIFICATION_ID, type: "follow", read: false }];
    fakeDb
      .selectReturns(notifications, rows)
      .selectReturns(notifications, [{ unread: 4 }]);

    const response = await GET(new Request("http://localhost/api/notifications", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: rows, unreadCount: 4 });
    expectGatedSequence("reads", ["notifications", "notifications"]);
  });

  it("answers 500 when the list read fails", async () => {
    fakeDb.failNextSelect(notifications);

    const response = await GET(new Request("http://localhost/api/notifications", { method: "GET" }));

    expect(response.status).toBe(500);
  });
});

describe("POST /api/notifications", () => {
  it("requires a session before reading or writing anything", async () => {
    session.userId = null;

    const response = await POST(markRead({ all: true }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("requires an id or `all: true`, writing nothing", async () => {
    const response = await POST(markRead({}));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses an id that is not uuid-shaped, writing nothing", async () => {
    const response = await POST(markRead({ id: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("marks every unread row and answers the recomputed total", async () => {
    fakeDb
      .updateReturns(notifications, [{ id: "n-1" }, { id: "n-2" }])
      .selectReturns(notifications, [{ unread: 0 }]);

    const response = await POST(markRead({ all: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 2, unreadCount: 0 });
    expect(fakeDb.writes).toHaveLength(1);
    // The table is named by the helper rather than indexed; a timestamp is set,
    // not read from the body.
    expectGatedUpdate(notifications, {
      first: true,
      values: expect.objectContaining({ readAt: expect.any(Date) }),
    });
  });

  it("marks a single named row", async () => {
    fakeDb
      .updateReturns(notifications, [{ id: NOTIFICATION_ID }])
      .selectReturns(notifications, [{ unread: 3 }]);

    const response = await POST(markRead({ id: NOTIFICATION_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1, unreadCount: 3 });
    expect(fakeDb.writes).toHaveLength(1);
  });

  it("answers 500 when the recount read fails", async () => {
    fakeDb.updateReturns(notifications, [{ id: NOTIFICATION_ID }]).failNextSelect(notifications);

    const response = await POST(markRead({ id: NOTIFICATION_ID }));

    expect(response.status).toBe(500);
  });
});
