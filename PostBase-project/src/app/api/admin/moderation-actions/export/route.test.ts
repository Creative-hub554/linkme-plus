import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The record, handed over in full.
 *
 * Who may hold the handover is the same gate every admin read answers: a
 * signed-out caller is a `401` before anything is read, and a non-admin a
 * `403` having read only their own role row. The document itself is CSV —
 * a header row, then every recorded action with who made it, what it was
 * about, why, and when — and the quoting is what makes it a *record*: a
 * reason holding a comma, a quote, or a line break must land in exactly one
 * cell of exactly one row.
 *
 * The fake `@/lib/db` is table-keyed, so the read order is what the tests
 * pin — the role read, then the joined list — and the CSV text is compared
 * exactly.
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
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

function requestExport(path = "/api/admin/moderation-actions/export") {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/admin/moderation-actions/export", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(requestExport());

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a caller who is not an admin, reading no actions", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "moderator" }]);

    const response = await GET(requestExport());

    expect(response.status).toBe(403);
    expectGatedSequence("reads", ["users"]);
  });

  it("answers with a downloadable CSV carrying the header and every recorded action", async () => {
    const createdAt = new Date("2026-10-16T09:30:00.000Z");
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(moderationActions, [
        {
          id: "11111111-1111-4111-8111-111111111111",
          action: "ban",
          targetType: "user",
          targetId: "44444444-4444-4444-8444-444444444444",
          reason: "Ran a coordinated spam network",
          createdAt,
          actorUsername: "walkthrough",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          action: "warning",
          targetType: "post",
          targetId: "31000000-0000-4000-8000-000000000000",
          reason: null,
          createdAt,
          actorUsername: "admin-1",
        },
      ]);

    const response = await GET(requestExport());

    expect(response.status).toBe(200);
    // An attachment the browser downloads by itself: the type is CSV and the
    // disposition names the file.
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");

    const body = await response.text();
    const rows = body.split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe("id,action,targetType,targetId,reason,createdAt,actor");
    // A record row: the action, its target, the actor's handle, the date in ISO.
    expect(rows[1]).toBe(
      "11111111-1111-4111-8111-111111111111,ban,user,44444444-4444-4444-8444-444444444444,Ran a coordinated spam network,2026-10-16T09:30:00.000Z,walkthrough",
    );
    // A reason the decision never carried is an empty cell, not the word null.
    expect(rows[2]).toBe(
      "22222222-2222-4222-8222-222222222222,warning,post,31000000-0000-4000-8000-000000000000,,2026-10-16T09:30:00.000Z,admin-1",
    );
    // One joined list read covers the whole handover — no count, no per-row lookups.
    expectGatedSequence("reads", ["users", "moderation_actions"]);
  });

  it("keeps a reason holding commas, quotes and line breaks inside one cell", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(moderationActions, [
        {
          id: "33333333-3333-4333-8333-333333333333",
          action: "removal",
          targetType: "comment",
          targetId: "55555555-5555-4555-8555-555555555555",
          reason: 'Said: "no commas, no\nline breaks", =HYPERLINK("http://x")',
          createdAt: new Date("2026-10-15T12:00:00.000Z"),
          actorUsername: "mod-kev",
        },
      ]);

    const response = await GET(requestExport());

    expect(response.status).toBe(200);
    const body = await response.text();
    const rows = body.split("\r\n");
    // The quoted field doubles its embedded quotes and keeps its newline; the
    // line stays one row, and the formula-shaped reason stays inert text.
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      '33333333-3333-4333-8333-333333333333,removal,comment,55555555-5555-4555-8555-555555555555,"Said: ""no commas, no\nline breaks"", =HYPERLINK(""http://x"")",2026-10-15T12:00:00.000Z,mod-kev',
    );
  });

  it("prefixes formula-shaped cells so a spreadsheet imports text, not a formula", async () => {
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .selectReturns(moderationActions, [
        {
          id: "44444444-4444-4444-8444-444444444444",
          action: "warning",
          targetType: "post",
          targetId: "55555555-5555-4555-8555-555555555555",
          reason: "=1+1",
          createdAt: new Date("2026-10-15T12:00:00.000Z"),
          actorUsername: "admin-1",
        },
      ]);

    const body = await (await GET(requestExport())).text();

    // RFC CSV quotes alone are removed before a spreadsheet decides whether a
    // cell is a formula. The apostrophe is the spreadsheet-level text escape.
    expect(body).toContain(",'=1+1,");
  });

  it("answers 500 when the list read fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(users, [{ id: "admin-1", role: "admin" }])
      .failNextSelect(moderationActions, new Error("database unavailable"));
    try {
      const response = await GET(requestExport());

      expect(response.status).toBe(500);
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
