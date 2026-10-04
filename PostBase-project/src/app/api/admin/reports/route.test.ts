import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin reports list: the moderation queue, its status filter, and the
 * session-derived authority that guards it.
 *
 * The route reads the caller's `users` row and refuses any role but `admin`
 * (`403`) before the reports are read, so the body and query can never name the
 * actor. The `status` filter is narrowed to a real `reportStatusEnum` member (or
 * the explicit `all`, which is the unfiltered `1 = 1`) — anything else falls back
 * to `pending`, so the value handed to Drizzle is always one the column accepts.
 * The page envelope's `total` is a separate count, which is the number the queue
 * shows beside the list.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the
 * filter is read from the rendered condition the fake records rather than from
 * the rows: the fake returns what a test scripts, and the test asserts the filter
 * that would have narrowed it. `expectGatedRead(reports, …)` names the table
 * rather than the read's position, so the assertion does not have to be kept in
 * step with the route's read order by hand.
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
import { reports, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedRead, expectGatedSequence } from "@/test/expect-gated";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";

function list(path = "/api/admin/reports") {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/admin/reports", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(list());

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a caller who is not an admin, reading no reports", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "moderator" }]);

    const response = await GET(list());

    expect(response.status).toBe(403);
    // The role read only — the queue is never reached.
    expectGatedSequence("reads", ["users"]);
  });

  it("lists the pending queue by default, with the total beside it", async () => {
    const rows = [{ id: REPORT_ID, status: "pending" }];
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(reports, rows)
      .selectReturns(reports, [{ total: 3 }]);

    const response = await GET(list());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: rows,
      pagination: { total: 3, page: 1, limit: 20, totalPages: 1, hasMore: false },
    });
    // The role read, then the list and its count.
    expectGatedSequence("reads", ["users", "reports", "reports"]);
    // The default filter is `pending`, applied to both reads.
    expectGatedRead(reports, { where: '"status" = $1', params: ["pending"] });
    expectGatedRead(reports, { nth: 1, params: ["pending"] });
  });

  it("narrows the filter to a requested status", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(reports, [])
      .selectReturns(reports, [{ total: 0 }]);

    const response = await GET(list("/api/admin/reports?status=resolved"));

    expect(response.status).toBe(200);
    // The bound value is the requested status, not the default.
    expectGatedRead(reports, { params: ["resolved"] });
  });

  it("treats `all` as no filter at all", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(reports, [])
      .selectReturns(reports, [{ total: 0 }]);

    const response = await GET(list("/api/admin/reports?status=all"));

    expect(response.status).toBe(200);
    // The unfiltered predicate the route writes rather than a status match.
    expectGatedRead(reports, { where: "1 = 1" });
  });

  it("falls back to `pending` for a status the enum does not define", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(reports, [])
      .selectReturns(reports, [{ total: 0 }]);

    const response = await GET(list("/api/admin/reports?status=shred"));

    expect(response.status).toBe(200);
    // Not the bogus value, and not `all` — the enum's default.
    expectGatedRead(reports, { params: ["pending"] });
  });

  it("answers 500 when the list read fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .failNextSelect(reports, new Error("database unavailable"));
    try {
      const response = await GET(list());

      expect(response.status).toBe(500);
    } finally {
      silence.mockRestore();
    }
  });
});
