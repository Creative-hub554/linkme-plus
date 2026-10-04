import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The groups route's writes, validation and the admin guard.
 *
 * Creating a group is **two** writes — the group row, then the creator's
 * `group_members` row making them its first admin — and the order matters: the
 * membership names the group's id, so the group must exist first. The test pins
 * that pair and their order. Editing and deleting are gated on an admin row, so
 * an empty role read is the `403` a stranger meets; a delete is unpinned from
 * storage here because a group owns no object that this route reaches (its cover
 * is a URL on the row, not an uploaded file, and no cleanup is attempted — see
 * the runbook note).
 *
 * One thing this route does *not* recover from is a failure between its two
 * writes: the group is inserted before the membership, so a failure on the
 * second leaves a group nobody administers. That is recorded rather than
 * asserted — see the write-failure test, which stops at the *first* write.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { DELETE, GET, POST, PUT } from "./route";
import { groups, groupMembers } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedRead, expectGatedSequence } from "@/test/expect-gated";

const GROUP_ID = "88888888-8888-4888-8888-888888888888";

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
  session.userId = "member-1";
});

describe("GET /api/groups", () => {
  it("gates the list on the audience rule and counts members unfiltered", async () => {
    fakeDb
      .selectReturns(groups, [{
        id: GROUP_ID,
        name: "Northwind",
        categoryId: "90000000-0000-4000-8000-000000000002",
        categoryName: "Design",
        visibility: "public",
      }])
      .selectReturns(groups, [{ total: 1 }])
      .selectReturns(groupMembers, [{ groupId: GROUP_ID, members: 3 }])
      .selectReturns(groupMembers, [{ groupId: GROUP_ID }]);

    const response = await GET(new Request("http://localhost/api/groups"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: GROUP_ID,
        memberCount: 3,
        isMember: true,
        categoryId: "90000000-0000-4000-8000-000000000002",
        categoryName: "Design",
      }),
    ]);

    // The list read is gated on the audience rule the `exists` subquery renders.
    expectGatedRead(groups, { nth: 0, where: [/"groups"\."visibility" = \$1/, /exists/] });
    // The member counts are deliberately *unfiltered* — one `groupBy` for the
    // whole page, not a read per group — and `where: ""` is the form that pins
    // an unfiltered read instead of leaving it unasserted.
    expectGatedRead(groupMembers, { nth: 0, where: "" });
    // The memberships read narrows to the session's own rows, so the `isMember`
    // flag is that user's and not another member's.
    expectGatedRead(groupMembers, { nth: 1, params: ["member-1"] });
    // The category name rides the row out of the same read that fetched the
    // group — no `categories` lookup per row on top of it.
    expect(fakeDb.reads.filter((table) => table === "categories")).toEqual([]);
  });

  it("answers 404 — and reads no members — when the group does not exist", async () => {
    fakeDb.selectReturns(groups, []);

    const response = await GET(jsonRequest("GET", `/api/groups?id=${GROUP_ID}`));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Group not found" });
    // The lookup found nothing, so the member reads are never reached.
    expectGatedSequence("reads", ["groups"]);
  });

  it("refuses a non-member of a non-public group", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID, visibility: "followers" }])
      .selectReturns(groupMembers, [{ members: 2 }])
      .selectReturns(groupMembers, []);

    const response = await GET(jsonRequest("GET", `/api/groups?id=${GROUP_ID}`));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You must be a member to view this group" });
    // The membership is looked up for *this* user on *this* group, not any row.
    expectGatedRead(groupMembers, { nth: 1, params: [GROUP_ID, "member-1"] });
  });

  it("returns a non-public group to its member", async () => {
    fakeDb
      .selectReturns(groups, [{
        id: GROUP_ID,
        name: "Northwind",
        description: null,
        categoryId: null,
        categoryName: null,
        coverUrl: null,
        visibility: "followers",
        createdAt: null,
      }])
      .selectReturns(groupMembers, [{ members: 2 }])
      .selectReturns(groupMembers, [{ id: "m-1", role: "member" }]);

    const response = await GET(jsonRequest("GET", `/api/groups?id=${GROUP_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      group: {
        id: GROUP_ID,
        name: "Northwind",
        description: null,
        categoryId: null,
        categoryName: null,
        coverUrl: null,
        visibility: "followers",
        createdAt: null,
      },
      stats: { members: 2 },
      isMember: true,
      memberRole: "member",
    });
  });

  it("opens a group with its category's name beside its id", async () => {
    fakeDb
      .selectReturns(groups, [{
        id: GROUP_ID,
        name: "Design & Product Makers",
        categoryId: "90000000-0000-4000-8000-000000000002",
        categoryName: "Design",
        visibility: "public",
      }])
      .selectReturns(groupMembers, [{ members: 7 }])
      .selectReturns(groupMembers, []);

    const response = await GET(jsonRequest("GET", `/api/groups?id=${GROUP_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.group).toMatchObject({
      id: GROUP_ID,
      categoryId: "90000000-0000-4000-8000-000000000002",
      categoryName: "Design",
    });
    // The name arrives with the row — one read of `groups` — not from a
    // per-group `categories` lookup tacked on afterwards. (The fake echoes the
    // rows a test scripts, so the shape is the contract pinned here; what a
    // second read would look like is what the `reads` list must not hold.)
    expect(fakeDb.reads.filter((table) => table === "categories")).toEqual([]);
  });

  it("answers 500 — and records no read — when the list's first read fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(groups, new Error("database unavailable"));
    try {
      const response = await GET(new Request("http://localhost/api/groups"));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch groups" });
      // The read never resolved, so the fake recorded nothing — the route asked
      // and got no answer, which is the same line the write seams draw.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a malformed group id instead of casting it into the column", async () => {
    const response = await GET(jsonRequest("GET", "/api/groups?id=not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid group ID" });
    expectGatedNone("reads");
  });
});

describe("POST /api/groups", () => {
  it("writes the group and then the creator's admin membership", async () => {
    fakeDb.insertReturns(groups, [{ id: GROUP_ID, name: "Northwind" }]);

    const response = await POST(
      jsonRequest("POST", "/api/groups", { name: "Northwind", visibility: "followers" }),
    );

    expect(response.status).toBe(201);
    expectGatedSequence("writes", [
      {
        table: "groups",
        values: {
          name: "Northwind",
          description: null,
          categoryId: undefined,
          coverUrl: undefined,
          visibility: "followers",
        },
      },
      // The membership carries the id the group insert returned, which is why
      // the group has to be written first.
      { table: "group_members", values: { groupId: GROUP_ID, userId: "member-1", role: "admin" } },
    ]);
  });

  it("refuses a group with no name or a bad visibility, writing nothing", async () => {
    const withoutName = await POST(jsonRequest("POST", "/api/groups", { visibility: "public" }));
    const badVisibility = await POST(
      jsonRequest("POST", "/api/groups", { name: "Northwind", visibility: "secret" }),
    );

    expect(withoutName.status).toBe(400);
    expect(badVisibility.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a name longer than 100 characters", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/groups", { name: "n".repeat(101) }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Name must be 100 characters or fewer" });
    expectGatedNone("writes");
  });

  it("refuses a description longer than 500 characters", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/groups", { name: "Northwind", description: "d".repeat(501) }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Description must be 500 characters or fewer",
    });
    expectGatedNone("writes");
  });

  it("answers 500 and writes nothing when the group row cannot be created", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextInsert(groups, new Error("unique violation"));
    try {
      const response = await POST(jsonRequest("POST", "/api/groups", { name: "Northwind" }));

      expect(response.status).toBe(500);
      // Nothing was written, so there is no half-created group and no membership
      // pointing at one. (A failure on the *second* insert is the case this route
      // does not recover from — see the file's header.)
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a category id that is not uuid-shaped", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/groups", { name: "Northwind", categoryId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("writes");
  });
});

describe("PUT /api/groups", () => {
  it("refuses an update with no id, reading nothing", async () => {
    const response = await PUT(jsonRequest("PUT", "/api/groups", { name: "Renamed" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Group ID is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an update with a malformed id, reading nothing", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/groups", { id: "not-a-uuid", name: "Renamed" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid group ID" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a non-admin before writing anything", async () => {
    fakeDb.selectReturns(groupMembers, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/groups", { id: GROUP_ID, name: "Renamed" }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("updates the group when the caller is an admin", async () => {
    fakeDb
      .selectReturns(groupMembers, [{ id: "membership-1", role: "admin" }])
      .updateReturns(groups, [{ id: GROUP_ID, name: "Renamed" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/groups", { id: GROUP_ID, name: "Renamed" }),
    );

    expect(response.status).toBe(200);
    expectGatedSequence("writes", [{ table: "groups", values: { name: "Renamed" } }]);
  });

  it("refuses a category id that is not uuid-shaped, after the admin check", async () => {
    fakeDb.selectReturns(groupMembers, [{ id: "membership-1", role: "admin" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/groups", { id: GROUP_ID, categoryId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("writes");
  });

  it("answers 500 when the update fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(groupMembers, [{ id: "membership-1", role: "admin" }])
      .failNextUpdate(groups, new Error("database unavailable"));
    try {
      const response = await PUT(jsonRequest("PUT", "/api/groups", { id: GROUP_ID, name: "Renamed" }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to update group" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("DELETE /api/groups", () => {
  it("refuses a delete with no id, reading and deleting nothing", async () => {
    const response = await DELETE(new Request("http://localhost/api/groups", { method: "DELETE" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Group ID is required" });
    expectGatedNone("reads");
    expectGatedNone("deletes");
  });

  it("refuses a delete with a malformed id, reading and deleting nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/groups?id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid group ID" });
    expectGatedNone("reads");
    expectGatedNone("deletes");
  });

  it("refuses a non-admin without deleting the group", async () => {
    fakeDb.selectReturns(groupMembers, []);

    const response = await DELETE(
      new Request(`http://localhost/api/groups?id=${GROUP_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("deletes");
  });

  it("deletes the group for an admin", async () => {
    fakeDb.selectReturns(groupMembers, [{ id: "membership-1", role: "admin" }]);

    const response = await DELETE(
      new Request(`http://localhost/api/groups?id=${GROUP_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expectGatedSequence("deletes", ["groups"]);
  });

  it("answers 500 when the admin read fails, deleting nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(groupMembers, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request(`http://localhost/api/groups?id=${GROUP_ID}`, { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete group" });
      // The role read never resolved, so the delete is never attempted.
      expectGatedNone("deletes");
    } finally {
      silence.mockRestore();
    }
  });
});
