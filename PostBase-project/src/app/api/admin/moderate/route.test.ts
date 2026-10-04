import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The moderation route: who may resolve a report, and what it refuses.
 *
 * Four refusals sit before any write. A caller who is not an admin or moderator
 * is a `403` — and the role read happens *inside* the `try`, so a database error
 * on that lookup is a `500`, not an uncaught rejection: authorization must not
 * answer "allowed" on error. An `action` the enum column does not accept is a
 * `400` before the report is even read, rather than a constraint violation at
 * write time. A report that is not there is a `404`. And a report that is no
 * longer `pending` is a `409` — moderating a closed report would stack a second
 * action and audit row over the first.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so what the
 * tests read is the route's answer to a scripted read, and the writes it did or
 * did not make — not the SQL.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "user-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { POST } from "./route";
import { moderationActions, reports, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/admin/moderate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The role read plus a pending report — the two reads every accepted request makes. */
function scriptAdminAndReport(status = "pending") {
  fakeDb
    .selectReturns(users, [{ id: "user-1", role: "admin" }])
    .selectReturns(reports, [
      { id: REPORT_ID, status, targetType: "post", targetId: TARGET_ID },
    ]);
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "user-1";
});

describe("POST /api/admin/moderate", () => {
  it("requires authentication, reading nothing", async () => {
    session.userId = null;

    const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "warning" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a caller who is not an admin or moderator", async () => {
    fakeDb.selectReturns(users, [{ id: "user-1", role: "member" }]);

    const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "warning" }));

    expect(response.status).toBe(403);
    // The role read only — the report is never reached, nothing written.
    expectGatedSequence("reads", ["users"]);
    expectGatedNone("writes");
  });

  it("answers 500, not an escaping throw, when the role read fails", async () => {
    // The role check is inside the `try`, so a database error on the lookup is
    // the route's own 500. If it sat before the `try`, this request would reject
    // out of POST instead of answering.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(users, new Error("database unavailable"));
    try {
      const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "warning" }));

      expect(response.status).toBe(500);
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("requires a report id and an action, reading no report", async () => {
    fakeDb.selectReturns(users, [{ id: "user-1", role: "admin" }]);

    const response = await POST(jsonRequest({ action: "warning" }));

    expect(response.status).toBe(400);
    expectGatedSequence("reads", ["users"]);
    expectGatedNone("writes");
  });

  it("refuses an action the enum does not accept, reading no report", async () => {
    fakeDb.selectReturns(users, [{ id: "user-1", role: "moderator" }]);

    const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "shred" }));

    expect(response.status).toBe(400);
    // Refused before the report is read, let alone written.
    expectGatedSequence("reads", ["users"]);
    expectGatedNone("writes");
  });

  it("answers 404 when the report does not exist", async () => {
    fakeDb.selectReturns(users, [{ id: "user-1", role: "admin" }]).selectReturns(reports, []);

    const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "warning" }));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["users", "reports"]);
    expectGatedNone("writes");
  });

  it("answers 409 for a report that is no longer pending, writing nothing", async () => {
    scriptAdminAndReport("resolved");

    const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "removal" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Report is not pending" });
    expectGatedSequence("reads", ["users", "reports"]);
    // No moderation action, no status update, no audit row over the closed report.
    expectGatedNone("writes");
  });

  it("resolves a pending report, writing the action, the status, and the audit row", async () => {
    scriptAdminAndReport("pending");
    fakeDb.insertReturns(moderationActions, [
      { id: "action-1", action: "removal", targetType: "post", targetId: TARGET_ID },
    ]);

    const response = await POST(
      jsonRequest({ reportId: REPORT_ID, action: "removal", reason: "spam" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      action: { id: "action-1", action: "removal", targetType: "post", targetId: TARGET_ID },
    });

    // The action carries the report's target, the session actor, and the request's
    // action and reason; the report is then resolved; the audit row records the
    // same action under `moderation.`.
    expectGatedSequence("writes", [
      {
        table: "moderation_actions",
        values: {
          targetType: "post",
          targetId: TARGET_ID,
          actorId: "user-1",
          action: "removal",
          reason: "spam",
        },
      },
      { table: "reports", values: { status: "resolved" } },
      {
        table: "audit_logs",
        values: {
          actorId: "user-1",
          action: "moderation.removal",
          targetType: "post",
          targetId: TARGET_ID,
          metadata: { reportId: REPORT_ID, reason: "spam" },
        },
      },
    ]);
  });

  it("admits a moderator, not only an admin", async () => {
    fakeDb
      .selectReturns(users, [{ id: "user-1", role: "moderator" }])
      .selectReturns(reports, [
        { id: REPORT_ID, status: "pending", targetType: "post", targetId: TARGET_ID },
      ]);

    const response = await POST(jsonRequest({ reportId: REPORT_ID, action: "warning" }));

    expect(response.status).toBe(201);
    expectGatedSequence("writes", [
      "moderation_actions",
      "reports",
      "audit_logs",
    ]);
  });
});
