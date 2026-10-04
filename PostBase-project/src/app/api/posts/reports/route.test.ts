import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The post report route: what a report has to be, and what submitting it does.
 *
 * A report is authored by the session user and stamped `targetType: "post"`, so
 * the body cannot choose either. Two things are decided before any query: the
 * target and the reason. The reason must be one the app allows, but it is
 * normalised first — trimmed and lowercased — so a caller's casing or stray
 * spaces are not a validation failure. The description is trimmed and capped at
 * 1000 characters, or dropped to `null` when it is not a string, so nothing
 * arbitrary is stored. A caller who already has a **pending** report for the same
 * post is answered as a duplicate without a second row; otherwise exactly one
 * `reports` insert is made, carrying the session's id, and its `{id, status}` is
 * returned with the `201`.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the
 * duplicate predicate is not interpreted — what is read here is the route's
 * answer to a lookup that returned a row versus one that returned nothing, and
 * whether a write followed.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "reporter-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { POST } from "./route";
import { reports } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";

function report(body: unknown) {
  return new Request("http://localhost/api/posts/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "reporter-1";
});

describe("POST /api/posts/reports", () => {
  it("requires a session before reading or writing anything", async () => {
    session.userId = null;

    const response = await POST(report({ targetId: POST_ID, reason: "spam or scam" }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("requires a target and a reason it allows, reading nothing", async () => {
    const response = await POST(report({ reason: "spam or scam" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a reason outside the allowed set, writing nothing", async () => {
    const response = await POST(report({ targetId: POST_ID, reason: "i just don't like it" }));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("accepts a reason by trimming and lowercasing before it compares", async () => {
    fakeDb
      .selectReturns(reports, [])
      .insertReturns(reports, [{ id: REPORT_ID, status: "pending" }]);

    const response = await POST(report({ targetId: POST_ID, reason: "  SPAM OR SCAM  " }));

    expect(response.status).toBe(201);
    expectGatedInsert(reports, { values: expect.objectContaining({ reason: "spam or scam" }) });
  });

  it("writes the report as the session user and stamps it as a post report", async () => {
    fakeDb
      .selectReturns(reports, [])
      .insertReturns(reports, [{ id: REPORT_ID, status: "pending" }]);

    const response = await POST(
      report({ targetId: POST_ID, reason: "harassment or bullying", description: "  rude  " }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      reported: true,
      report: { id: REPORT_ID, status: "pending" },
    });
    expectGatedSequence("writes", [
      {
        table: "reports",
        values: {
          reporterId: "reporter-1",
          targetType: "post",
          targetId: POST_ID,
          reason: "harassment or bullying",
          description: "rude",
        },
      },
    ]);
  });

  it("caps the description at 1000 characters", async () => {
    fakeDb
      .selectReturns(reports, [])
      .insertReturns(reports, [{ id: REPORT_ID, status: "pending" }]);

    const response = await POST(
      report({ targetId: POST_ID, reason: "other", description: "x".repeat(1200) }),
    );

    expect(response.status).toBe(201);
    // The stored description is the 1000 `x`s and nothing more.
    expectGatedInsert(reports, {
      values: expect.objectContaining({ description: "x".repeat(1000) }),
    });
  });

  it("stores a null description when none is given", async () => {
    fakeDb
      .selectReturns(reports, [])
      .insertReturns(reports, [{ id: REPORT_ID, status: "pending" }]);

    const response = await POST(report({ targetId: POST_ID, reason: "other" }));

    expect(response.status).toBe(201);
    expectGatedInsert(reports, {
      values: {
        reporterId: "reporter-1",
        targetType: "post",
        targetId: POST_ID,
        reason: "other",
        description: null,
      },
    });
  });

  it("answers a duplicate without inserting a second row", async () => {
    fakeDb.selectReturns(reports, [{ id: REPORT_ID }]);

    const response = await POST(report({ targetId: POST_ID, reason: "spam or scam" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reported: true, duplicate: true });
    expectGatedNone("writes");
  });

  it("answers 500 when the duplicate lookup fails, writing nothing", async () => {
    fakeDb.failNextSelect(reports);

    const response = await POST(report({ targetId: POST_ID, reason: "spam or scam" }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });
});
