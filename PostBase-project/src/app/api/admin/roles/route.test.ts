import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET`/`POST /api/admin/roles` — the moderator ladder, as the dashboard uses
 * it.
 *
 * The listing is gated before it is read and filtered exactly as the query
 * says. The write side is where the constraints live, so that is what is
 * pinned hardest: only a strict `admin` may press it, the target must be in
 * the state the move expects (a 409, not a surprise), and an `admin` target is
 * refused outright — promoting *from* or demoting *to* admin is the owner
 * console's affair, and this pin is what keeps a dashboard route from ever
 * becoming a second way to mint or erase the role.
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

import { GET, POST } from "./route";
import { users, auditLogs } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const MEMBER_ID = "44444444-4444-4444-8444-444444444444";

function list(params = "") {
  return new Request(`http://localhost/api/admin/roles${params}`, { method: "GET" });
}

function move(body: unknown) {
  return new Request("http://localhost/api/admin/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Scripts the two reads POST makes of `users` before the write: the gate, then the target. */
function gateAdminAndTarget(targetRole: string) {
  fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
  fakeDb.selectReturns(users, [{ id: MEMBER_ID, role: targetRole }]);
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/admin/roles", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(list());

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("refuses a caller who is not an admin", async () => {
    fakeDb.selectReturns(users, [{ id: "mod-1", role: "moderator" }]);

    const response = await GET(list());

    expect(response.status).toBe(403);
    expectGatedSequence("reads", ["users"]);
  });

  it("lists the unfiltered membership, gated on the caller's role first", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
    fakeDb.selectReturns(users, [
      { id: MEMBER_ID, username: "theowumicrosoft", email: "theowumicrosoft@gmail.com", role: "member", createdAt: new Date() },
    ]);
    fakeDb.selectReturns(users, [{ total: 1 }]);

    const response = await GET(list());
    const body = (await response.json()) as { data: unknown[]; pagination: { total: number } };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
    // The read order is the list route's shape: the gate, the page, the count.
    expectGatedSequence("reads", ["users", "users", "users"]);
  });

  it("narrows the listing to the role the query names", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
    fakeDb.selectReturns(users, []);
    fakeDb.selectReturns(users, [{ total: 0 }]);

    await GET(list("?role=moderator"));

    const listIndex = fakeDb.reads.indexOf("users", 1);
    expect(fakeDb.selectWheres[listIndex]).toContain("role");
    expect(fakeDb.selectParams[listIndex]).toContain("moderator");
  });

  it("narrow a search to both the username and the email columns", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
    fakeDb.selectReturns(users, []);
    fakeDb.selectReturns(users, [{ total: 0 }]);

    await GET(list("?q=theo"));

    const listIndex = fakeDb.reads.indexOf("users", 1);
    expect(fakeDb.selectParams[listIndex]).toContain("%theo%");
  });

  it("answers 500 when the listing cannot be read", async () => {
    fakeDb.failNextSelect(users);

    const response = await GET(list());

    expect(response.status).toBe(500);
  });
});

describe("POST /api/admin/roles", () => {
  it("refuses a malformed body before anything is read", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/roles", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a move that names no member, before anything is read", async () => {
    const response = await POST(move({ action: "promote" }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("The member to move is required");
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a target id that is not a uuid, before anything is read", async () => {
    const response = await POST(move({ userId: "not-a-uuid", action: "promote" }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("The member to move is required");
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an unknown action before anything is read", async () => {
    const response = await POST(move({ userId: MEMBER_ID, action: "banner" }));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a non-admin caller, reading the gate and nothing else", async () => {
    fakeDb.selectReturns(users, [{ id: "mod-1", role: "moderator" }]);

    const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));

    expect(response.status).toBe(403);
    expectGatedSequence("reads", ["users"]);
    expectGatedNone("writes");
  });

  it("answers 404 when the member to move does not exist", async () => {
    // The gate answers, the target read does not: no member with that id.
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
    fakeDb.selectReturns(users, []);

    const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("does not consider a soft-deleted account a role target", async () => {
    fakeDb.selectReturns(users, [{ id: "admin-1", role: "admin" }]);
    fakeDb.selectReturns(users, []);

    const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));

    expect(response.status).toBe(404);
    expect(fakeDb.selectWheres[1]).toContain("deleted_at");
    expect(fakeDb.selectParams[1]).toContain(MEMBER_ID);
    expectGatedNone("writes");
  });

  it("never touches an admin: the owner console owns that role", async () => {
    gateAdminAndTarget("admin");

    const response = await POST(move({ userId: "99999999-9999-4999-8999-999999999999", action: "demote" }));

    expect(response.status).toBe(403);
    expect((await response.json()) as { error: string }).toBeTruthy();
    expectGatedNone("writes");
  });

  it("refuses a move the ladder does not allow, before any write", async () => {
    gateAdminAndTarget("moderator");

    const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));

    expect(response.status).toBe(409);
    expectGatedNone("writes");
  });

  it("promotes a member to moderator and audits the move", async () => {
    gateAdminAndTarget("member");
    fakeDb.updateReturns(users, [{ id: MEMBER_ID, role: "moderator" }]);
    fakeDb.insertReturns(auditLogs, [{ id: "audit-1" }]);

    const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));
    const body = (await response.json()) as { user: { role: string } };

    expect(response.status).toBe(200);
    expect(body.user.role).toBe("moderator");
    // The write pair: the ladder's step, then the record beside it.
    expectGatedSequence("writes", ["users", "audit_logs"]);
  });

  it("answers 404 when the ladder step's write matches nothing — the row vanished", async () => {
    gateAdminAndTarget("member");
    fakeDb.updateReturns(users, []);

    const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));

    expect(response.status).toBe(404);
    // The vanished row's 404 answers before the audit: the ladder step was
    // attempted, but no record was taken beside it.
    expectGatedSequence("writes", ["users"]);
  });

  it("answers 500 when the move cannot be recorded at all", async () => {
    // Nothing was scripted: the very first read — the caller's gate — fails.
    fakeDb.failNextSelect(users);
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await POST(move({ userId: MEMBER_ID, action: "promote" }));

      expect(response.status).toBe(500);
      expectGatedNone("reads");
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("demotes a moderator back to member, with the record beside it", async () => {
    gateAdminAndTarget("moderator");
    fakeDb.updateReturns(users, [{ id: MEMBER_ID, role: "member" }]);
    fakeDb.insertReturns(auditLogs, [{ id: "audit-1" }]);

    const response = await POST(move({ userId: MEMBER_ID, action: "demote" }));

    expect(response.status).toBe(200);
    expect(((await response.json()) as { user: { role: string } }).user.role).toBe("member");
  });
});
