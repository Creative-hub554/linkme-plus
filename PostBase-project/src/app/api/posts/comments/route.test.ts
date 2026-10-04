import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The comments route's writes and its total, driven through the handler.
 *
 * A comment is created with the caller as its author — the author id comes from
 * the session, never the body — and removed by a *soft* delete whose ownership
 * lives in the `where` (`comments.author_id = the caller`), which is the same
 * "my row or nobody's" rule the post route uses. What can be pinned without a
 * database is that the author is the session's, that a missing post or empty
 * content is refused before any write, that removal sets `deleted_at` and does
 * not remove the row, and that an update matching nothing is a `404` with no
 * hard delete behind it. The paginated envelope is pinned too, because its
 * `total` is the number the reader sees above the list.
 *
 * The fake `@/lib/db` does not *evaluate* `where`, so the route's answer to an
 * update that matched nothing is what decides the `404`. The ownership
 * *predicate* itself is still asserted — the fake records each update's `where`
 * (`updateWheres`) and its parameters (`updateParams`), so the soft delete is
 * pinned to `comments.author_id = the caller` rather than merely to a write.
 *
 * `GET` is gated by the post's audience, because a comment is only readable
 * through the post it belongs to. The `postId` path reads the post with
 * `visiblePostsCondition` and answers `404` when it is not visible; the `ids`
 * path joins the post and applies the same predicate, which the fake records as
 * the read's `where` (`selectWheres`) even though it cannot filter on it. `POST`
 * is gated the same way: a comment is only written onto a post the viewer may
 * read, so the post is read first and an invisible one answers `404` with
 * nothing written. A `postId` that is not a uuid is a `400` before that read,
 * since the id is bound into it.
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

import { DELETE, GET, POST } from "./route";
import { comments, posts } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import {
  expectGatedInsert,
  expectGatedNone,
  expectGatedRead,
  expectGatedSequence,
  expectGatedUpdate,
} from "@/test/expect-gated";

const POST_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const PARENT_ID = "66666666-6666-4666-8666-666666666666";

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
  session.userId = "author-1";
});

describe("POST /api/posts/comments", () => {
  it("authors the comment as the session's user, not the body's", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .insertReturns(comments, [{ id: COMMENT_ID, content: "Nice one" }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts/comments", {
        postId: POST_ID,
        content: "Nice one",
        // A body that tries to claim the comment: it must be ignored in favour
        // of the session, exactly as every other author id is.
        authorId: "someone-else",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ comment: { id: COMMENT_ID, content: "Nice one" } });
    expectGatedSequence("writes", [
      {
        table: "comments",
        values: { postId: POST_ID, authorId: "author-1", content: "Nice one", parentId: null },
      },
    ]);
    // The post is read first, and its guard is the audience rule: commenting is
    // gated the same way reading the thread is.
    expectGatedSequence("reads", ["posts"]);
    expectGatedRead(posts, { where: [/"visibility" = 'public'/, /exists/] });
  });

  it("keeps the parent when the comment is a reply", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .insertReturns(comments, [{ id: COMMENT_ID }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts/comments", {
        postId: POST_ID,
        content: "Replying",
        parentId: PARENT_ID,
      }),
    );

    expect(response.status).toBe(201);
    expectGatedInsert(comments, { values: expect.objectContaining({ parentId: PARENT_ID }) });
  });

  it("refuses a comment with no post or no content, writing nothing", async () => {
    const withoutPost = await POST(
      jsonRequest("POST", "/api/posts/comments", { content: "Whose post?" }),
    );
    const withoutContent = await POST(
      jsonRequest("POST", "/api/posts/comments", { postId: POST_ID }),
    );

    expect(withoutPost.status).toBe(400);
    expect(withoutContent.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a post id that is not a uuid, reading nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/posts/comments", { postId: "not-a-uuid", content: "Hi" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid post ID" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404, writing nothing, when the post is not visible", async () => {
    // An empty post read is a post the viewer may not read — private, or
    // followers-only to somebody else — and it must not accept a comment.
    fakeDb.selectReturns(posts, []);

    const response = await POST(
      jsonRequest("POST", "/api/posts/comments", { postId: POST_ID, content: "Hi" }),
    );

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["posts"]);
    expectGatedNone("writes");
  });

  it("answers 500 and writes nothing when the comment insert fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .failNextInsert(comments, new Error("database unavailable"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/posts/comments", { postId: POST_ID, content: "Hi" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create comment" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("DELETE /api/posts/comments", () => {
  it("refuses a delete with no id, writing nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/posts/comments", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Comment ID is required" });
    expectGatedNone("writes");
  });

  it("refuses a delete with a malformed id, writing nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/posts/comments?id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid comment id" });
    expectGatedNone("writes");
  });

  it("soft-deletes the caller's comment rather than removing it", async () => {
    fakeDb.updateReturns(comments, [{ id: COMMENT_ID }]);

    const response = await DELETE(
      new Request(`http://localhost/api/posts/comments?id=${COMMENT_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    // `deleted_at` is set and the row stays: a comment thread is a conversation
    // whose replies still have to resolve their parent.
    expectGatedSequence("writes", [
      { table: "comments", values: { deletedAt: expect.any(Date) } },
    ]);
    expectGatedNone("deletes");
    // The row id names *which* comment, and the author id in the same `where`
    // is the ownership: the update cannot touch a comment the caller does not
    // own, even though the fake does not evaluate the predicate for it.
    expectGatedUpdate(comments, {
      where: ['"comments"."id" = $1', '"comments"."author_id" = $2'],
      params: [COMMENT_ID, "author-1"],
    });
  });

  it("answers 404, with no hard delete, when no row belongs to the caller", async () => {
    // An update that matched nothing is how "somebody else's comment" arrives
    // here: the ownership is in the `where`, which the fake records but does not
    // evaluate.
    fakeDb.updateReturns(comments, []);

    const response = await DELETE(
      new Request(`http://localhost/api/posts/comments?id=${COMMENT_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("deletes");
  });

  it("answers 500 when the soft delete fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextUpdate(comments, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request(`http://localhost/api/posts/comments?id=${COMMENT_ID}`, { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete comment" });
      expectGatedNone("writes");
      expectGatedNone("deletes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/posts/comments", () => {
  it("reports the server's total in the page envelope", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .selectReturns(comments, [{ id: COMMENT_ID, content: "One" }])
      .selectReturns(comments, [{ total: 3 }]);

    const response = await GET(
      new Request(`http://localhost/api/posts/comments?postId=${POST_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    // The total is the page's own count and drives the footer; `hasMore` is
    // false because twenty fit in one page and only three exist.
    expect(await response.json()).toEqual({
      data: [{ id: COMMENT_ID, content: "One" }],
      pagination: { total: 3, page: 1, limit: 20, totalPages: 1, hasMore: false },
    });
    // The post is read first — its visibility decides whether the thread opens
    // at all — and the guard carries the audience rule.
    expectGatedRead(posts, { first: true, where: [/"visibility" = 'public'/, /exists/] });
  });

  it("answers 404 and reads no comments when the post is not visible", async () => {
    // An empty post read is a post the viewer may not read — private, or
    // followers-only to somebody else — and it must not disclose its thread.
    fakeDb.selectReturns(posts, []);

    const response = await GET(
      new Request(`http://localhost/api/posts/comments?postId=${POST_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["posts"]);
  });

  it("gates the id lookup on the owning post's audience", async () => {
    fakeDb.selectReturns(comments, [{ id: COMMENT_ID, content: "One" }]);

    const response = await GET(
      new Request(`http://localhost/api/posts/comments?ids=${COMMENT_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    expectGatedSequence("reads", ["comments"]);
    // The comment read joins its post and carries the audience rule, so a
    // comment on an invisible post cannot be hydrated by naming its id.
    expectGatedRead(comments, { where: [/"visibility" = 'public'/, /exists/] });
  });

  it("refuses a lookup asking for more ids than the ceiling allows", async () => {
    const manyIds = Array.from(
      { length: 26 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ).join(",");

    const response = await GET(
      new Request(`http://localhost/api/posts/comments?ids=${manyIds}`, { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "At most 25 ids can be looked up at once",
    });
    expectGatedNone("reads");
  });

  it("refuses a lookup containing an id that is not a uuid", async () => {
    const response = await GET(
      new Request(`http://localhost/api/posts/comments?ids=${COMMENT_ID},not-a-uuid`, {
        method: "GET",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid ids" });
    expectGatedNone("reads");
  });

  it("refuses a request naming neither a post nor any comment ids", async () => {
    const response = await GET(
      new Request("http://localhost/api/posts/comments", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A post ID or comment ids are required" });
    expectGatedNone("reads");
  });

  it("refuses a malformed post id instead of casting it into the column", async () => {
    const response = await GET(
      new Request("http://localhost/api/posts/comments?postId=not-a-uuid", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid post id" });
    expectGatedNone("reads");
  });

  it("answers 500 when the post read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(posts, new Error("database unavailable"));
    try {
      const response = await GET(
        new Request(`http://localhost/api/posts/comments?postId=${POST_ID}`, { method: "GET" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch comments" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});
