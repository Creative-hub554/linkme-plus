import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("@/test/fake-db")).fakeDb }));
const session = vi.hoisted(() => ({ userId: "reviewer-1" as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.userId ? { user: { id: session.userId } } : null } } }));

import { GET, PATCH } from "./route";
import { auditLogs, users, verificationRequests } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";

const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/verification-requests", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function reviewer(role = "admin") { fakeDb.selectReturns(users, [{ role }]); }
beforeEach(() => { resetFakeDb(); session.userId = "reviewer-1"; });

describe("admin verification review", () => {
  it("denies unauthenticated and non-reviewer callers", async () => {
    session.userId = null;
    expect((await GET(req("GET"))).status).toBe(401);
    session.userId = "member-1";
    reviewer("member");
    expect((await GET(req("GET"))).status).toBe(403);
    expect(fakeDb.reads).toEqual(["users"]);
  });

  it("returns private links only from the gated reviewer queue", async () => {
    reviewer();
    fakeDb.selectReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1", username: "maya", displayName: "Maya Chen", evidenceUrls: ["https://example.com"], status: "pending", createdAt: new Date() }]);
    fakeDb.selectReturns(verificationRequests, [{ total: 1 }]);
    const response = await GET(req("GET"));
    expect(response.status).toBe(200);
    // The identity fields are the join's product — `username` from `users`,
    // `displayName` from the `profiles` table — and the queue is what carries
    // them to a reviewer, so they are pinned here rather than left to
    // `toMatchObject`'s tolerance of whatever else the join returns.
    expect(await response.json()).toMatchObject({ data: [{ id: REQUEST_ID, username: "maya", displayName: "Maya Chen", evidenceUrls: ["https://example.com"] }], pagination: { total: 1 } });
    expect(fakeDb.reads).toEqual(["users", "verification_requests", "verification_requests"]);
  });

  it("approves once, awards the badge and audits the reviewer", async () => {
    reviewer();
    fakeDb.selectReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1" }]);
    fakeDb.updateReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1", status: "approved" }]);
    fakeDb.insertReturns(auditLogs, [{ id: "audit-1" }]);
    const response = await PATCH(req("PATCH", { requestId: REQUEST_ID, decision: "approved", reviewNote: "Confirmed public profile" }));
    expect(response.status).toBe(200);
    expect(fakeDb.writes).toEqual([
      { table: "verification_requests", values: { status: "approved", reviewNote: "Confirmed public profile", reviewedBy: "reviewer-1", reviewedAt: expect.any(Date) } },
      { table: "users", values: { verified: true } },
      { table: "audit_logs", values: { actorId: "reviewer-1", action: "verification.approved", targetType: "user", targetId: "member-1", metadata: { requestId: REQUEST_ID, reviewNote: "Confirmed public profile" } } },
    ]);
  });

  it("rejects without awarding the badge", async () => {
    reviewer();
    fakeDb.selectReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1" }]);
    fakeDb.updateReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1", status: "rejected" }]);
    fakeDb.insertReturns(auditLogs, [{ id: "audit-2" }]);
    const response = await PATCH(req("PATCH", { requestId: REQUEST_ID, decision: "rejected" }));
    expect(response.status).toBe(200);
    expect(fakeDb.writes.map((write) => write.table)).toEqual(["verification_requests", "audit_logs"]);
  });

  it("rolls back approval when awarding the badge fails", async () => {
    reviewer();
    fakeDb.selectReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1" }]);
    fakeDb.updateReturns(verificationRequests, [{ id: REQUEST_ID, userId: "member-1", status: "approved" }]);
    fakeDb.failNextUpdate(users, new Error("database unavailable"));
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await PATCH(req("PATCH", { requestId: REQUEST_ID, decision: "approved" }));

      expect(response.status).toBe(500);
      expect(fakeDb.writes).toEqual([]);
    } finally {
      silence.mockRestore();
    }
  });

  it("rejects invalid decisions before database access beyond reviewer gate", async () => {
    reviewer();
    const response = await PATCH(req("PATCH", { requestId: REQUEST_ID, decision: "granted" }));
    expect(response.status).toBe(400);
    expect(fakeDb.reads).toEqual([]);
    expect(fakeDb.writes).toEqual([]);
  });
});
