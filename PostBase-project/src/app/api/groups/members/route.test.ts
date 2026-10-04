import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The group membership route: who may read a group's members, and what joining
 * or leaving does.
 *
 * A group has no company or Page to defer to, so its admin is the `role` on its
 * own `group_members` row. `GET` answers `404` for a group that is not there and
 * `403` for a signed-in caller whose own membership is not an admin — both
 * **before** the member rows are read. `POST` is the caller's own join/leave
 * toggle: it writes only the session user's row, and the one refusal beyond the
 * usual `404` is a last admin leaving a group with no successor (`409`), before
 * the delete it would otherwise make.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the
 * predicates here are not what the tests read — the route's answer to a read
 * that returned nothing, and the writes it did or did not make, are. A table
 * read twice is answered in the order the route asks, which is how the `GET`
 * admin check and its member list are scripted apart.
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

import { GET, POST } from "./route";
import { groupMembers, groups } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "user-1";
});

describe("GET /api/groups/members", () => {
  it("requires a group id, reading nothing", async () => {
    const response = await GET(new Request("http://localhost/api/groups/members", { method: "GET" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("answers 404 when the group does not exist, reading no membership", async () => {
    fakeDb.selectReturns(groups, []);

    const response = await GET(
      new Request(`http://localhost/api/groups/members?groupId=${GROUP_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["groups"]);
  });

  it("refuses a non-member with 403, reading no member list", async () => {
    fakeDb.selectReturns(groups, [{ id: GROUP_ID }]).selectReturns(groupMembers, []);

    const response = await GET(
      new Request(`http://localhost/api/groups/members?groupId=${GROUP_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(403);
    // The group, then the caller's own membership — and no second read of the
    // members, which only an admin reaches.
    expectGatedSequence("reads", ["groups", "group_members"]);
  });

  it("refuses a member who is not an admin with 403", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, [{ id: "m-1", role: "member" }]);

    const response = await GET(
      new Request(`http://localhost/api/groups/members?groupId=${GROUP_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(403);
    expectGatedSequence("reads", ["groups", "group_members"]);
  });

  it("returns the member list for a group admin", async () => {
    const admin = { id: "m-1", groupId: GROUP_ID, userId: "user-1", role: "admin" };
    const member = { id: "m-2", groupId: GROUP_ID, userId: "user-2", role: "member" };
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, [admin])
      .selectReturns(groupMembers, [admin, member]);

    const response = await GET(
      new Request(`http://localhost/api/groups/members?groupId=${GROUP_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ members: [admin, member] });
    // The admin check first, then the full list — both on the same table.
    expectGatedSequence("reads", ["groups", "group_members", "group_members"]);
  });

  it("answers 500 when the group read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(groups, new Error("database unavailable"));
    try {
      const response = await GET(
        new Request(`http://localhost/api/groups/members?groupId=${GROUP_ID}`, { method: "GET" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch members" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("POST /api/groups/members", () => {
  it("requires a group id, reading nothing", async () => {
    const response = await POST(jsonRequest("POST", "/api/groups/members", {}));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 when the group does not exist, writing nothing", async () => {
    fakeDb.selectReturns(groups, []);

    const response = await POST(jsonRequest("POST", "/api/groups/members", { groupId: GROUP_ID }));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("joins the caller as a member, writing only their own row", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, []);

    const response = await POST(jsonRequest("POST", "/api/groups/members", { groupId: GROUP_ID }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ member: true });
    // The session's user, not anything the body carried.
    expectGatedSequence("writes", [
      { table: "group_members", values: { groupId: GROUP_ID, userId: "user-1", role: "member" } },
    ]);
  });

  it("removes the caller's own membership when they leave", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, [{ id: "m-1", role: "member" }]);

    const response = await POST(jsonRequest("POST", "/api/groups/members", { groupId: GROUP_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ member: false });
    expectGatedSequence("deletes", ["group_members"]);
    expectGatedNone("writes");
  });

  it("refuses to let the last admin leave, deleting nothing", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, [{ id: "m-1", role: "admin" }])
      .selectReturns(groupMembers, [{ admins: 1 }]);

    const response = await POST(jsonRequest("POST", "/api/groups/members", { groupId: GROUP_ID }));

    expect(response.status).toBe(409);
    expectGatedNone("deletes");
  });

  it("lets an admin leave once another admin exists", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, [{ id: "m-1", role: "admin" }])
      .selectReturns(groupMembers, [{ admins: 2 }]);

    const response = await POST(jsonRequest("POST", "/api/groups/members", { groupId: GROUP_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ member: false });
    expectGatedSequence("deletes", ["group_members"]);
  });

  it("answers 500 and writes nothing when the toggle read fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(groups, new Error("database unavailable"));
    try {
      const response = await POST(jsonRequest("POST", "/api/groups/members", { groupId: GROUP_ID }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to toggle membership" });
      // The group read never resolved, so neither the leave's delete nor the
      // join's insert ran.
      expectGatedNone("writes");
      expectGatedNone("deletes");
    } finally {
      silence.mockRestore();
    }
  });
});
