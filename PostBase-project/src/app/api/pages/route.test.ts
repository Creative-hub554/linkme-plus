import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Page route's storage wiring, driven through the handler itself.
 *
 * These pin what the live bucket probes used to prove by hand: which stored
 * object a write offers up for deletion. `replacedObjectUrl`'s three-state
 * contract is tested on its own in `src/lib/r2.test.ts`; what was untested is
 * that the route *reads the old URL before the write* and hands the right pair
 * of fields to `deleteStoredObjects`. A rename that accidentally deletes a photo,
 * or a replacement that leaves the old object behind, is exactly the kind of
 * wiring mistake a pure helper test cannot see.
 *
 * The seams: `@/lib/db` is `src/test/fake-db.ts`, which answers the reads the
 * route makes and records its writes and deletes; `@/lib/auth` is reduced to a
 * session that says who is asking; and `@/lib/r2` keeps every pure decision real
 * while the two functions that would touch the network are spies.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    // The retry wrapper's whole job is transient-failure handling, which is not
    // this test's business; running the operation once is what the route expects.
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

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    // The env-completeness check is a deployment concern and would otherwise
    // 503 before the wiring under test is reached.
    assertStorageConfigured: vi.fn(),
    putObject: vi.fn(async () => {}),
    deleteStoredObjects: vi.fn(async () => [] as string[]),
  };
});

import { DELETE, GET, POST, PUT } from "./route";
import { pages, pageFollows, pageRoles, postMedia, posts, users } from "@/lib/db/schema";
import { deleteStoredObjects } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import {
  expectGatedDelete,
  expectGatedInsert,
  expectGatedNone,
  expectGatedRead,
  expectGatedSequence,
} from "@/test/expect-gated";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const OLD_AVATAR = "https://test.r2.dev/avatars/page-1/1-old.png";
const OLD_COVER = "https://test.r2.dev/covers/page-1/2-old.png";
const NEW_AVATAR = "https://test.r2.dev/avatars/page-1/3-new.png";
const MEDIA_ONE = "https://test.r2.dev/posts/page-1/4-photo.png";
const MEDIA_TWO = "https://test.r2.dev/posts/page-1/5-video.mp4";

const deletion = () => vi.mocked(deleteStoredObjects);

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The Page the edit path is about, as the route's own read of it would answer. */
function configured(avatarUrl: string | null, coverUrl: string | null) {
  return [{ avatarUrl, coverUrl }];
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/pages", () => {
  it("answers 500 when the list read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(pages, new Error("database unavailable"));
    try {
      const response = await GET(new Request("http://localhost/api/pages", { method: "GET" }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch pages" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("describes one Page by id, with its stats and the viewer's relationship", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID, name: "Northwind Works", username: "northwind" }])
      .selectReturns(pageFollows, [{ followers: 3 }])
      .selectReturns(posts, [{ postCount: 5 }])
      .selectReturns(pageFollows, [])
      .selectReturns(pageRoles, []);

    const response = await GET(
      new Request(`http://localhost/api/pages?id=${PAGE_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // The single-Page branch, not the directory: named by its id, described by
    // `describePage`, which is what the gated view reads.
    expect(body.page.id).toBe(PAGE_ID);
    expect(body.stats).toEqual({ followers: 3, posts: 5 });
    expect(body.isFollowing).toBe(false);
    expect(body.role).toBeNull();
  });

  it("finds a Page by username as well as by id", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID, name: "Northwind Works", username: "northwind" }])
      .selectReturns(pageFollows, [{ followers: 0 }])
      .selectReturns(posts, [{ postCount: 0 }])
      .selectReturns(pageFollows, [])
      .selectReturns(pageRoles, []);

    const response = await GET(new Request("http://localhost/api/pages?username=northwind"));

    expect(response.status).toBe(200);
    expect((await response.json()).page.id).toBe(PAGE_ID);
  });

  it("answers 404 for a Page that does not exist", async () => {
    fakeDb.selectReturns(pages, []);

    const response = await GET(
      new Request(`http://localhost/api/pages?id=${PAGE_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Page not found" });
    // Nothing further is read about a Page that is not there.
    expectGatedSequence("reads", ["pages"]);
  });

  it("refuses a malformed page id instead of casting it into the column", async () => {
    const response = await GET(new Request("http://localhost/api/pages?id=not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid page id" });
    expectGatedNone("reads");
  });
});

describe("POST /api/pages", () => {
  /**
   * The reads `describePage` makes about the fresh Page, in the order the route
   * issues them. Every slot must answer with a row: the counts destructure
   * `[{ followers }]`, so an empty answer throws rather than answering zero.
   */
  function scriptDescribe() {
    fakeDb
      .selectReturns(pageFollows, [{ followers: 0 }])
      .selectReturns(posts, [{ postCount: 0 }])
      .selectReturns(pageFollows, [])
      .selectReturns(pageRoles, []);
  }

  it("rejects a Page with no name, reading nothing", async () => {
    const response = await POST(jsonRequest("POST", "/api/pages", { username: "northwind" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A Page name is required" });
    // Validation is answered before the uniqueness lookups, so nothing is read.
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("rejects a name longer than 100 characters", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/pages", { name: "n".repeat(101), username: "northwind" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A Page name must be 100 characters or fewer",
    });
    expectGatedNone("reads");
  });

  it("rejects a username outside the 3–30 `[a-z0-9_]` rule", async () => {
    // Too short, so it fails the length arm of `PAGE_USERNAME` rather than the
    // character class — the same 400 either way.
    const response = await POST(
      jsonRequest("POST", "/api/pages", { name: "Northwind Works", username: "no" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A Page username must be 3–30 characters using only letters, numbers, or underscores",
    });
    // The username is checked before either uniqueness read, so nothing is read.
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("rejects a description longer than 500 characters", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/pages", {
        name: "Northwind Works",
        username: "northwind",
        description: "d".repeat(501),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A Page description must be 500 characters or fewer",
    });
    expectGatedNone("reads");
  });

  it("rejects a category id that is not uuid-shaped", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/pages", {
        name: "Northwind Works",
        username: "northwind",
        categoryId: "not-a-uuid",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 409 when the Page username is already taken", async () => {
    // The Page namespace is occupied. The body's username is mixed-case and
    // padded, so the lookup must be made with the normalized value.
    fakeDb.selectReturns(pages, [{ id: "page-1" }]);

    const response = await POST(
      jsonRequest("POST", "/api/pages", { name: "Northwind Works", username: "  NorthWind  " }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That Page username is already taken" });
    // The member namespace is never consulted once the Page one collides, and
    // nothing is written.
    expectGatedRead(pages, {
      first: true,
      where: '"pages"."username" = $1',
      params: ["northwind"],
    });
    expectGatedSequence("reads", ["pages"]);
    expectGatedNone("writes");
  });

  it("answers 409 when the username belongs to a member", async () => {
    // The Page namespace is free but the member namespace is not: a Page may not
    // shadow a member, whose `@name` would otherwise be ambiguous.
    fakeDb.selectReturns(pages, []).selectReturns(users, [{ id: "user-1" }]);

    const response = await POST(
      jsonRequest("POST", "/api/pages", { name: "Northwind Works", username: "northwind" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That username belongs to a member" });
    expectGatedRead(users, { where: '"users"."username" = $1', params: ["northwind"] });
    expectGatedSequence("reads", ["pages", "users"]);
    expectGatedNone("writes");
  });

  it("creates the Page and makes the creator its first admin", async () => {
    const created = {
      id: PAGE_ID,
      name: "Northwind Works",
      username: "northwind",
      description: null,
      categoryId: null,
    };
    fakeDb
      .selectReturns(pages, [])
      .selectReturns(users, [])
      .insertReturns(pages, [created]);
    scriptDescribe();

    const response = await POST(
      jsonRequest("POST", "/api/pages", { name: "Northwind Works", username: "NORTHWIND" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      page: created,
      stats: { followers: 0, posts: 0 },
      isFollowing: false,
      role: null,
    });
    // The Page stores the normalized username, with no other fields.
    expectGatedInsert(pages, {
      first: true,
      values: { name: "Northwind Works", username: "northwind", description: null, categoryId: null },
    });
    // Without this row nobody — not even the creator — could edit the Page.
    expectGatedInsert(pageRoles, {
      values: { pageId: PAGE_ID, userId: "admin-1", role: "admin" },
    });
    expectGatedSequence("writes", ["pages", "page_roles"]);
  });

  it("answers 500 and writes no role when the Page insert fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(pages, [])
      .selectReturns(users, [])
      .failNextInsert(pages, new Error("database unavailable"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/pages", { name: "Northwind Works", username: "northwind" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create page" });
      // The Page insert never committed, so its admin role is never written.
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("PUT /api/pages", () => {
  it("removes the photo an edit replaces", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, configured(OLD_AVATAR, OLD_COVER))
      .updateReturns(pages, [{ id: PAGE_ID, avatarUrl: NEW_AVATAR, coverUrl: OLD_COVER }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, avatarUrl: NEW_AVATAR }),
    );

    expect(response.status).toBe(200);
    // Only the avatar moved; the cover field was not in the body, so it is
    // offered as `null` — the state `deleteStoredObjects` skips.
    expect(deletion()).toHaveBeenCalledWith([OLD_AVATAR, null]);
    // And the write really happened, so the deletion is about a committed row.
    expectGatedSequence("writes", [{ table: "pages", values: { avatarUrl: NEW_AVATAR } }]);
  });

  it("deletes nothing when an edit only renames the Page", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, configured(OLD_AVATAR, OLD_COVER))
      .updateReturns(pages, [{ id: PAGE_ID, name: "Northwind Works" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, name: "Northwind Works" }),
    );

    expect(response.status).toBe(200);
    // Both fields are offered, and both are `null`: a rename names no image, so
    // nothing is displaced. Getting this wrong deletes a Page's photos on every
    // rename, which is precisely the bug a pure `replacedObjectUrl` test cannot
    // catch at the route.
    expect(deletion()).toHaveBeenCalledWith([null, null]);
  });

  it("removes a cover the edit clears", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, configured(OLD_AVATAR, OLD_COVER))
      .updateReturns(pages, [{ id: PAGE_ID, coverUrl: null }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, coverUrl: null }),
    );

    expect(response.status).toBe(200);
    // `null` is a real write — clearing the cover orphans it — while the
    // untouched avatar is not offered.
    expect(deletion()).toHaveBeenCalledWith([null, OLD_COVER]);
  });

  it("refuses a non-admin before reading or writing anything", async () => {
    // No role row: the caller is not an admin of this Page.
    fakeDb.selectReturns(pageRoles, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, coverUrl: null }),
    );

    expect(response.status).toBe(403);
    expect(deletion()).not.toHaveBeenCalled();
    expectGatedNone("writes");
    // The row is never even read, so there is no previous URL to lose.
    expectGatedSequence("reads", ["page_roles"]);
  });

  it("answers 500 when the update fails, deleting nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, configured(OLD_AVATAR, OLD_COVER))
      .failNextUpdate(pages, new Error("database unavailable"));
    try {
      const response = await PUT(
        jsonRequest("PUT", "/api/pages", { id: PAGE_ID, name: "Renamed" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to update page" });
      // The write never landed, so the image it would have displaced is still in
      // use and nothing is offered up.
      expect(deletion()).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses an edit with no id, before reading anything", async () => {
    const response = await PUT(jsonRequest("PUT", "/api/pages", {}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Page ID is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("refuses an edit with a malformed page id, before reading anything", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: "not-a-uuid", name: "Probe" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid page id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("refuses a name that is not text", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await PUT(jsonRequest("PUT", "/api/pages", { id: PAGE_ID, name: 123 }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A Page name must be text" });
    expectGatedSequence("reads", ["page_roles"]);
    expectGatedNone("writes");
  });

  it("refuses a name that is empty or too long", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const blank = await PUT(jsonRequest("PUT", "/api/pages", { id: PAGE_ID, name: "" }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({
      error: "A Page name is required and must be 100 characters or fewer",
    });

    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);
    const long = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, name: "n".repeat(101) }),
    );
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({
      error: "A Page name is required and must be 100 characters or fewer",
    });
    expectGatedNone("writes");
  });

  it("refuses a description that is not text", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, description: 5 }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A Page description must be text" });
    expectGatedNone("writes");
  });

  it("refuses a description longer than 500 characters, as creation does", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, description: "d".repeat(501) }),
    );

    // An edit is held to the same limit a create is, or a Page ends up in a
    // state it could never have been created in.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A Page description must be 500 characters or fewer",
    });
    expectGatedNone("writes");
  });

  it("refuses a category id that is not text", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, categoryId: 42 }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("writes");
  });

  it("refuses a category id that is not a uuid rather than letting the cast fail", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, categoryId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("writes");
  });

  it("refuses an image url that is neither a string nor null", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const avatar = await PUT(
      jsonRequest("PUT", "/api/pages", { id: PAGE_ID, avatarUrl: { url: "x" } }),
    );
    expect(avatar.status).toBe(400);
    expect(await avatar.json()).toEqual({ error: "An image url must be a string or null" });

    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);
    const cover = await PUT(jsonRequest("PUT", "/api/pages", { id: PAGE_ID, coverUrl: 7 }));
    expect(cover.status).toBe(400);
    expect(await cover.json()).toEqual({ error: "An image url must be a string or null" });
    expectGatedNone("writes");
  });
});

describe("DELETE /api/pages", () => {
  it("removes the Page's photo, cover and its posts' media", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, configured(OLD_AVATAR, OLD_COVER))
      .selectReturns(postMedia, [{ url: MEDIA_ONE }, { url: MEDIA_TWO }]);

    const response = await DELETE(
      new Request(`http://localhost/api/pages?id=${PAGE_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    // Every URL the Page owned, read before anything was deleted: the posts are
    // hard-deleted and `post_media` cascades, so afterwards no row could map
    // these back to keys.
    expect(deletion()).toHaveBeenCalledWith([OLD_AVATAR, OLD_COVER, MEDIA_ONE, MEDIA_TWO]);
    // `posts.page_id` has no foreign key, so the posts must go explicitly, and
    // before the Page row they point at. Each delete names the Page: the posts
    // by `page_id`, the Page by its own id.
    expectGatedSequence("deletes", ["posts", "pages"]);
    expectGatedDelete(posts, { where: '"posts"."page_id" = $1', params: [PAGE_ID] });
    expectGatedDelete(pages, { where: '"pages"."id" = $1', params: [PAGE_ID] });
  });

  it("refuses a non-admin without deleting the Page or its objects", async () => {
    fakeDb.selectReturns(pageRoles, []);

    const response = await DELETE(
      new Request(`http://localhost/api/pages?id=${PAGE_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(403);
    expect(deletion()).not.toHaveBeenCalled();
    expectGatedNone("deletes");
  });

  it("answers 500 when the admin read fails, deleting nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(pageRoles, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request(`http://localhost/api/pages?id=${PAGE_ID}`, { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete page" });
      expect(deletion()).not.toHaveBeenCalled();
      expectGatedNone("deletes");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a delete with no id, before reading or deleting anything", async () => {
    const response = await DELETE(new Request("http://localhost/api/pages", { method: "DELETE" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Page ID is required" });
    expect(deletion()).not.toHaveBeenCalled();
    expectGatedNone("reads");
    expectGatedNone("deletes");
  });

  it("refuses a delete with a malformed page id, before reading or deleting anything", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/pages?id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid page id" });
    expect(deletion()).not.toHaveBeenCalled();
    expectGatedNone("reads");
    expectGatedNone("deletes");
  });
});
