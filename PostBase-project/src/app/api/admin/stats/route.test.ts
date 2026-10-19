import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/admin/stats` — the dashboard's headline numbers.
 *
 * The route answers five reads in a fixed order: the caller's role first (the
 * gate, before anything about the platform is computed), then the four
 * aggregates — members, live posts, pending reports, delivered ad spend. The
 * fake `@/lib/db` answers a table's reads in order, which is exactly the shape
 * this route needs: `users` is read twice, once for the gate and once for the
 * count, and the two answers are scripted separately.
 *
 * Pinned here, beside the numbers: the aggregates are gated (member counts skip
 * soft-deleted rows; the pending count is the `pending` status and nothing
 * else) and the revenue sum is widened to the paid campaign states — a draft
 * or refunded campaign is not revenue, and that predicate is what keeps the
 * card honest.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb };
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
import { users, posts, reports, adCampaigns } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

function list() {
  return new Request("http://localhost/api/admin/stats", { method: "GET" });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/admin/stats", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(list());

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a caller who is not an admin, computing nothing", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "moderator" }]);

    const response = await GET(list());

    expect(response.status).toBe(403);
    // The role read only — no aggregate was computed for an unauthorised eye.
    expectGatedSequence("reads", ["users"]);
  });

  it("answers the four counts, gated on what makes each one true", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
    fakeDb.selectReturns(users, [{ total: 3 }]);
    fakeDb.selectReturns(posts, [{ total: 9 }]);
    fakeDb.selectReturns(reports, [{ total: 2 }]);
    fakeDb.selectReturns(adCampaigns, [{ revenue: 500 }]);

    const response = await GET(list());
    const body = (await response.json()) as { stats: Record<string, number> };

    expect(response.status).toBe(200);
    expect(body.stats).toEqual({
      totalUsers: 3,
      activePosts: 9,
      pendingReports: 2,
      adRevenue: 500,
    });
    // The order is the route's shape: the gate, then the four aggregates.
    expectGatedSequence("reads", ["users", "users", "posts", "reports", "ad_campaigns"]);

    // Each gate that keeps a number from lying: members exclude deleted rows,
    // the pending count is the pending status, and revenue counts only the
    // states in which the platform actually holds the money.
    const usersCountIndex = fakeDb.reads.indexOf("users", 1);
    expect(fakeDb.selectWheres[usersCountIndex]).toContain("deleted_at");
    const reportsIndex = fakeDb.reads.indexOf("reports");
    expect(fakeDb.selectWheres[reportsIndex]).toContain("status");
    expect(fakeDb.selectParams[reportsIndex]).toEqual(["pending"]);
    const campaignsIndex = fakeDb.reads.indexOf("ad_campaigns");
    expect(fakeDb.selectWheres[campaignsIndex]).toContain("status");
    for (const paidState of ["approved", "active", "completed"]) {
      expect(fakeDb.selectParams[campaignsIndex]).toContain(paidState);
    }
    // Refunded, rejected, cancelled and draft money is not revenue.
    expect(fakeDb.selectParams[campaignsIndex]).not.toContain("draft");
    expect(fakeDb.selectParams[campaignsIndex]).not.toContain("refunded");
  });

  it("answers 500 when the aggregates cannot be computed", async () => {
    fakeDb.failNextSelect(users);

    const response = await GET(list());

    expect(response.status).toBe(500);
  });
});
