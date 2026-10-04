import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The post route's writes, driven through the handler itself.
 *
 * `POST /api/posts` is where a post and its media are created together, and
 * these tests pin that pairing: one insert for the row, one for its attachments,
 * each carrying the position the reader sees and the id the row's own insert
 * returned — so the media is written *after* the post and can never be orphaned
 * from a row that did not exist yet. They also pin that the subject is decided
 * by the handler (a Page the caller administers, or a group they belong to),
 * which is the authorization a body is not trusted for.
 *
 * `DELETE /api/posts` is the app's only post-removal path, and it soft-deletes:
 * the row stays with `deleted_at` set, so its `post_media` rows survive and are
 * read *after* the update — that is the only record mapping the post back to the
 * objects it uploaded, and it is what lets the bucket be cleaned. The route is
 * where the "read them and hand them over" wiring lives, which is what these
 * tests pin; the pure part ("is this URL ours", "was anything displaced") is
 * `src/lib/r2.test.ts`, and the decision to delete at all — the soft-delete
 * write itself — is asserted here.
 *
 * `PUT /api/posts` deliberately has no storage wiring — media is out of scope
 * for an edit, the dialog only offers text and audience — so there is no
 * "replacement" to pin. What is pinned instead is that an edit *leaves storage
 * alone* and that the two rules the handler does own hold: a group post's
 * audience cannot be widened by an edit, and a non-author's edit reaches neither
 * the row nor the media.
 *
 * The seams are the same as the Page route tests next door: a scripted
 * `@/lib/db` (`src/test/fake-db.ts`), an `@/lib/auth` that answers with a
 * session, and a partial `@/lib/r2` mock that spies on the network-touching
 * functions while keeping every pure decision real.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "author-1" as string | null }));

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
    assertStorageConfigured: vi.fn(),
    putObject: vi.fn(async () => {}),
    deleteStoredObjects: vi.fn(async () => [] as string[]),
  };
});

// The create path calls this before inserting, best-effort. It is its own
// database read-and-maybe-write, which belongs to a provisioning test rather
// than to one about what the route stores, so it is a no-op here.
vi.mock("@/lib/db/ensure-profile", () => ({
  ensureLocalUserProfile: vi.fn(async () => {}),
}));

import { DELETE, GET, POST, PUT } from "./route";
import { posts, postMedia, pages, pageRoles, groups, groupMembers } from "@/lib/db/schema";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { deleteStoredObjects } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const POST_ID = "22222222-2222-4222-8222-222222222222";
const PAGE_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ONE = "https://test.r2.dev/posts/author-1/1-photo.png";
const MEDIA_TWO = "https://test.r2.dev/posts/author-1/2-video.mp4";

const deletion = () => vi.mocked(deleteStoredObjects);

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

/** The row `PUT` reads first, as the route's own ownership check would answer. */
function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    authorId: "author-1",
    content: "The original text",
    visibility: "public",
    hashtags: [],
    groupId: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "author-1";
});

describe("GET /api/posts", () => {
  it("answers 500 when the feed read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(posts, new Error("database unavailable"));
    try {
      const response = await GET(new Request("http://localhost/api/posts", { method: "GET" }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch posts" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a malformed page id instead of casting it into the column", async () => {
    const response = await GET(
      new Request("http://localhost/api/posts?pageId=not-a-uuid", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid page id" });
    // The filter is refused before the feed is ever queried.
    expectGatedNone("reads");
  });

  it("refuses a malformed group id", async () => {
    const response = await GET(
      new Request("http://localhost/api/posts?groupId=not-a-uuid", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid group id" });
    expectGatedNone("reads");
  });

  it("refuses a lookup asking for more ids than the ceiling allows", async () => {
    const manyIds = Array.from(
      { length: 26 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ).join(",");

    const response = await GET(new Request(`http://localhost/api/posts?ids=${manyIds}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "At most 25 ids can be looked up at once",
    });
    expectGatedNone("reads");
  });

  it("refuses a lookup containing an id that is not a uuid", async () => {
    const response = await GET(
      new Request(`http://localhost/api/posts?ids=${POST_ID},not-a-uuid`),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid ids" });
    expectGatedNone("reads");
  });

  it("refuses offset pagination rather than silently serving the first page", async () => {
    const response = await GET(new Request("http://localhost/api/posts?page=2"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Offset pagination is no longer supported. Follow pagination.nextCursor instead.",
    });
    expectGatedNone("reads");
  });

  it("refuses a cursor it cannot decode", async () => {
    const response = await GET(new Request("http://localhost/api/posts?cursor=not-a-cursor"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid cursor" });
    expectGatedNone("reads");
  });

  it("refuses a malformed author filter instead of casting it into the column", async () => {
    const response = await GET(new Request("http://localhost/api/posts?authorId=not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid author id" });
    expectGatedNone("reads");
  });
});

describe("DELETE /api/posts", () => {
  it("removes the post's media from the bucket", async () => {
    fakeDb
      .updateReturns(posts, [{ id: POST_ID }])
      .selectReturns(postMedia, [{ url: MEDIA_ONE }, { url: MEDIA_TWO }]);

    const response = await DELETE(
      new Request(`http://localhost/api/posts?id=${POST_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    // Every object the post uploaded, read after the soft delete left the rows
    // in place and handed over as a set.
    expect(deletion()).toHaveBeenCalledWith([MEDIA_ONE, MEDIA_TWO]);
    // It is a soft delete: the row is updated with `deleted_at`, never removed,
    // which is what leaves the media rows there to be read at all.
    expectGatedSequence("writes", [
      { table: "posts", values: { deletedAt: expect.any(Date) } },
    ]);
    expectGatedNone("deletes");
  });

  it("removes nothing, and still succeeds, for a post with no media", async () => {
    fakeDb.updateReturns(posts, [{ id: POST_ID }]).selectReturns(postMedia, []);

    const response = await DELETE(
      new Request(`http://localhost/api/posts?id=${POST_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    // Offered as an empty set: there was nothing to delete, and nothing is read
    // as if there had been.
    expect(deletion()).toHaveBeenCalledWith([]);
  });

  it("never reads or deletes media for a post the caller does not own", async () => {
    // The ownership is in the update's `where`, so an update that matches no row
    // is how "somebody else's post" arrives here.
    fakeDb.updateReturns(posts, []);

    const response = await DELETE(
      new Request(`http://localhost/api/posts?id=${POST_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(404);
    expect(deletion()).not.toHaveBeenCalled();
    // The media rows are never even queried — no URL is ever put in a position
    // to be deleted off the back of a request that did not own the post.
    expectGatedNone("reads");
  });

  it("answers 500 when the soft delete fails, deleting nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextUpdate(posts, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request(`http://localhost/api/posts?id=${POST_ID}`, { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete post" });
      // The row never changed, so the media rows are never read and nothing is
      // offered up for deletion.
      expect(deletion()).not.toHaveBeenCalled();
      expectGatedNone("writes");
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a delete with no id, writing nothing", async () => {
    const response = await DELETE(new Request("http://localhost/api/posts", { method: "DELETE" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Post ID is required" });
    expectGatedNone("writes");
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("refuses a delete with a malformed id, writing nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/posts?id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid post id" });
    expectGatedNone("writes");
    expect(deletion()).not.toHaveBeenCalled();
  });
});

describe("PUT /api/posts", () => {
  it("edits the post without touching its stored media", async () => {
    fakeDb
      .selectReturns(posts, [existing()])
      .updateReturns(posts, [{ id: POST_ID, content: "An edit" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/posts", { id: POST_ID, content: "An edit" }),
    );

    expect(response.status).toBe(200);
    // An edit is text and audience only: it neither reads the media rows nor
    // offers any object up for deletion. Media editing is what would change
    // this, and it is deliberately not here.
    expect(deletion()).not.toHaveBeenCalled();
    expectGatedSequence("reads", ["posts"]);
    expectGatedSequence("writes", [
      {
        table: "posts",
        values: {
          content: "An edit",
          visibility: "public",
          hashtags: [],
          editedAt: expect.any(Date),
        },
      },
    ]);
  });

  it("keeps a group post's audience when an edit tries to widen it", async () => {
    fakeDb
      .selectReturns(posts, [existing({ visibility: "group", groupId: GROUP_ID })])
      .updateReturns(posts, [{ id: POST_ID }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/posts", { id: POST_ID, visibility: "public" }),
    );

    expect(response.status).toBe(200);
    // The audience is the group whatever the body asks for: "my own post" is not
    // "mine to show the world" when the room it was written in is somebody
    // else's group.
    expectGatedSequence("writes", [
      {
        table: "posts",
        values: {
          content: "The original text",
          visibility: "group",
          hashtags: [],
          editedAt: expect.any(Date),
        },
      },
    ]);
  });

  it("refuses a post the caller does not own, without writing anything", async () => {
    fakeDb.selectReturns(posts, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/posts", { id: POST_ID, content: "Not mine" }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("answers 500 when the edit fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(posts, [existing()])
      .failNextUpdate(posts, new Error("database unavailable"));
    try {
      const response = await PUT(
        jsonRequest("PUT", "/api/posts", { id: POST_ID, content: "An edit" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to update post" });
      expect(deletion()).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses an edit with no id, reading and writing nothing", async () => {
    const response = await PUT(jsonRequest("PUT", "/api/posts", { content: "An edit" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Post ID is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an edit with a malformed id, reading and writing nothing", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/posts", { id: "not-a-uuid", content: "An edit" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid post id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });
});

describe("POST /api/posts", () => {
  it("inserts the post and its media in one create", async () => {
    fakeDb.insertReturns(posts, [{ id: POST_ID, content: "Hello world" }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts", {
        content: "Hello world",
        media: [
          { url: MEDIA_ONE, type: "image", altText: "A photograph" },
          { url: MEDIA_TWO, type: "video" },
        ],
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ post: { id: POST_ID, content: "Hello world" } });
    // The row and its media, in one call and in order. The media write carries
    // the id the insert *returned* — which is why the insert has to land first —
    // and each attachment's position, so the carousel cannot be reordered by a
    // storage round trip.
    expectGatedSequence("writes", [
      {
        table: "posts",
        values: {
          authorId: "author-1",
          pageId: null,
          groupId: null,
          content: "Hello world",
          type: "text",
          visibility: "public",
          hashtags: [],
          mentions: [],
        },
      },
      {
        table: "post_media",
        values: [
          { postId: POST_ID, url: MEDIA_ONE, altText: "A photograph", type: "image", order: 0 },
          { postId: POST_ID, url: MEDIA_TWO, altText: undefined, type: "video", order: 1 },
        ],
      },
    ]);
    // Best-effort provisioning runs before the insert; it is not what is stored.
    expect(vi.mocked(ensureLocalUserProfile)).toHaveBeenCalledOnce();
  });

  it("writes no media rows for a text-only post", async () => {
    fakeDb.insertReturns(posts, [{ id: POST_ID, content: "Just text" }]);

    const response = await POST(jsonRequest("POST", "/api/posts", { content: "Just text" }));

    expect(response.status).toBe(201);
    expectGatedSequence("writes", ["posts"]);
  });

  it("refuses a post with neither content nor media before writing anything", async () => {
    const response = await POST(jsonRequest("POST", "/api/posts", {}));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("records the Page on a post published as it", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .insertReturns(posts, [{ id: POST_ID, pageId: PAGE_ID }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "From the Page", pageId: PAGE_ID }),
    );

    expect(response.status).toBe(201);
    // The author is still the person — they own the row, so edits and deletes
    // keep working — and the Page is recorded beside them as the subject.
    expectGatedInsert(posts, {
      first: true,
      values: expect.objectContaining({
        authorId: "author-1",
        pageId: PAGE_ID,
        groupId: null,
      }),
    });
  });

  it("refuses to publish as a Page the caller does not administer", async () => {
    fakeDb.selectReturns(pages, [{ id: PAGE_ID }]).selectReturns(pageRoles, []);

    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "Not mine to say", pageId: PAGE_ID }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("publishes into a group under the group's audience, whatever the body says", async () => {
    fakeDb
      .selectReturns(groups, [{ id: GROUP_ID }])
      .selectReturns(groupMembers, [{ id: "member-1" }])
      .insertReturns(posts, [{ id: POST_ID }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts", {
        content: "In the group",
        groupId: GROUP_ID,
        visibility: "public",
      }),
    );

    expect(response.status).toBe(201);
    // The audience is the group the post was written in, not the one the body
    // asked for: a group post's room is its group.
    expectGatedInsert(posts, {
      first: true,
      values: expect.objectContaining({ pageId: null, groupId: GROUP_ID, visibility: "group" }),
    });
  });

  it("refuses a body that names both a Page and a group", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts", {
        content: "Whose is this?",
        pageId: PAGE_ID,
        groupId: GROUP_ID,
      }),
    );

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a malformed page id rather than casting it into the column", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "As nobody", pageId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid page id" });
    expectGatedNone("writes");
  });

  it("refuses a post as a Page that does not exist", async () => {
    fakeDb.selectReturns(pages, []);

    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "As nobody", pageId: PAGE_ID }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Page not found" });
    // The Page's role is never consulted: a Page that is not there has no admins.
    expectGatedNone("writes");
  });

  it("refuses a malformed group id rather than casting it into the column", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "Into nowhere", groupId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid group id" });
    expectGatedNone("writes");
  });

  it("refuses a post into a group that does not exist", async () => {
    fakeDb.selectReturns(groups, []);

    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "Into nowhere", groupId: GROUP_ID }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Group not found" });
    expectGatedNone("writes");
  });

  it("refuses a post into a group the caller is not a member of", async () => {
    fakeDb.selectReturns(groups, [{ id: GROUP_ID }]).selectReturns(groupMembers, []);

    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "Into the room", groupId: GROUP_ID }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only a member of this group can post in it" });
    expectGatedNone("writes");
  });

  it("refuses the group audience on a post with no group to hold it", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/posts", { content: "To the group that is not here", visibility: "group" }),
    );

    // `group` only means anything on a post with a group: without one the
    // audience admits nobody, so the request is refused at the door rather than
    // stored as a post its author cannot share and nobody can find.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A post is only visible to group members inside a group",
    });
    expectGatedNone("writes");
  });

  it("still publishes when profile provisioning fails, because the post is the point", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(ensureLocalUserProfile).mockRejectedValueOnce(new Error("provision unavailable"));
    fakeDb.insertReturns(posts, [{ id: POST_ID }]);
    try {
      const response = await POST(
        jsonRequest("POST", "/api/posts", { content: "Still posts" }),
      );

      // Provisioning is best-effort: the insert is reached and the caller gets
      // the post, so a profile repair cannot cost them their words.
      expect(response.status).toBe(201);
      expectGatedSequence("writes", ["posts"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("answers 500 and writes nothing when the post insert fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextInsert(posts, new Error("database unavailable"));
    try {
      const response = await POST(jsonRequest("POST", "/api/posts", { content: "Hello" }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create post" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
