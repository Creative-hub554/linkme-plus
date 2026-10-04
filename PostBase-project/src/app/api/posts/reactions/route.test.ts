import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reactions route's toggle and its counters, driven through the handler.
 *
 * One endpoint is both add, change and remove: whether a press is a new
 * reaction, a change of type or a toggle-off depends on the row the caller
 * already owns for that target, and the row is looked up **scoped to the
 * caller** — a reaction is the caller's even on somebody else's post, so the
 * read filters on `user_id` rather than trusting the body. The three outcomes
 * are pinned as the three writes they are (insert, update, delete) and as the
 * `{reacted, type}` each answers, which is the state the card's counter is drawn
 * from. `GET` is where the count itself is computed, and its grouping is pure
 * arithmetic over the rows the database returns — so it is pinned here too.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`; the scoping
 * is what the route does with a row the fake hands it, not something the fake
 * checks. The insert's own `userId` is asserted, which is the half a test can
 * see.
 *
 * `GET` for a post is gated by the post's audience: the post is read first with
 * `visiblePostsCondition`, and a post that is not there, or not visible, answers
 * `404` with no `reactions` read. A non-post target is not gated, which is
 * pinned too. `POST` is gated the same way for a post target — a reaction is
 * only written onto a post the viewer may read, so the post is read before the
 * existing-reaction lookup and an invisible one answers `404` with nothing
 * written.
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

import { GET, POST } from "./route";
import { posts, reactions } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedRead, expectGatedSequence } from "@/test/expect-gated";

const POST_ID = "22222222-2222-4222-8222-222222222222";
const REACTION_ID = "77777777-7777-4777-8777-777777777777";

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

const like = { targetType: "post", targetId: POST_ID, type: "like" };

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "author-1";
});

describe("POST /api/posts/reactions", () => {
  it("adds the caller's reaction when they had none", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .selectReturns(reactions, [])
      .insertReturns(reactions, [{ id: REACTION_ID, type: "like" }]);

    const response = await POST(jsonRequest("POST", "/api/posts/reactions", like));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reacted: true, type: "like" });
    expectGatedSequence("writes", [
      {
        table: "reactions",
        values: { targetType: "post", targetId: POST_ID, userId: "author-1", type: "like" },
      },
    ]);
    // The post is read first, and its guard is the audience rule: reacting is
    // gated the same way reading the counters is.
    expectGatedRead(posts, { first: true, where: [/"visibility" = 'public'/, /exists/] });
  });

  it("toggles the same reaction off by deleting the row", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .selectReturns(reactions, [{ id: REACTION_ID, type: "like" }]);

    const response = await POST(jsonRequest("POST", "/api/posts/reactions", like));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reacted: false, type: null });
    // A second press of the same reaction removes it — a hard delete of the one
    // row, and no update or insert beside it.
    expectGatedSequence("deletes", ["reactions"]);
    expectGatedNone("writes");
  });

  it("changes the reaction when a different type is chosen", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .selectReturns(reactions, [{ id: REACTION_ID, type: "like" }])
      .updateReturns(reactions, [{ id: REACTION_ID, type: "love" }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts/reactions", { ...like, type: "love" }),
    );

    expect(response.status).toBe(200);
    // The answer carries the *stored* type, so the card never has to guess what
    // the write landed as.
    expect(await response.json()).toEqual({ reacted: true, type: "love" });
    expectGatedSequence("writes", [{ table: "reactions", values: { type: "love" } }]);
    expectGatedNone("deletes");
  });

  it("refuses a reaction with a missing field, writing nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/posts/reactions", { targetType: "post", targetId: POST_ID }),
    );

    expect(response.status).toBe(400);
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("refuses a target id that is not uuid-shaped, writing nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/posts/reactions", {
        targetType: "post",
        targetId: "not-a-uuid",
        type: "like",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid target id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404, writing nothing, when the post is not visible", async () => {
    // An empty post read is a post the viewer may not read, and it must not
    // accept a reaction — the action is refused before the existing-reaction
    // lookup, let alone an insert.
    fakeDb.selectReturns(posts, []);

    const response = await POST(jsonRequest("POST", "/api/posts/reactions", like));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["posts"]);
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("does not gate a target that is not a post", async () => {
    fakeDb
      .selectReturns(reactions, [])
      .insertReturns(reactions, [{ id: REACTION_ID, type: "like" }]);

    const response = await POST(
      jsonRequest("POST", "/api/posts/reactions", {
        targetType: "comment",
        targetId: POST_ID,
        type: "like",
      }),
    );

    expect(response.status).toBe(201);
    // Only a post has an audience to apply; anything else goes straight to the
    // reaction lookup.
    expectGatedSequence("reads", ["reactions"]);
  });

  it("answers 500 and writes nothing when the reaction insert fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(reactions, [])
      .failNextInsert(reactions, new Error("database unavailable"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/posts/reactions", {
          targetType: "comment",
          targetId: POST_ID,
          type: "like",
        }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to toggle reaction" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/posts/reactions", () => {
  it("refuses a read naming no target, reading nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/posts/reactions", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Target type and target ID are required" });
    expectGatedNone("reads");
  });

  it("refuses a target id that is not uuid-shaped, reading nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/posts/reactions?targetType=post&targetId=not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid target id" });
    expectGatedNone("reads");
  });

  it("counts the reactions by type and reports the caller's own", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .selectReturns(reactions, [
        { id: "r1", type: "like", userId: "someone-else" },
        { id: "r2", type: "like", userId: "author-1" },
        { id: "r3", type: "love", userId: "someone-else" },
      ]);

    const response = await GET(
      new Request(
        `http://localhost/api/posts/reactions?targetType=post&targetId=${POST_ID}`,
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      counts: { like: 2, love: 1 },
      total: 3,
      userReaction: "like",
    });
    // The post is read first, and its guard is the audience rule.
    expectGatedRead(posts, { first: true, where: [/"visibility" = 'public'/, /exists/] });
  });

  it("reports no reaction of the caller's when they have not reacted", async () => {
    fakeDb
      .selectReturns(posts, [{ id: POST_ID }])
      .selectReturns(reactions, [{ id: "r1", type: "like", userId: "someone-else" }]);

    const response = await GET(
      new Request(
        `http://localhost/api/posts/reactions?targetType=post&targetId=${POST_ID}`,
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(200);
    // `null`, not the first row's — the counter is the viewer's own state and a
    // stranger's reaction must never be read as theirs.
    expect(await response.json()).toEqual({
      counts: { like: 1 },
      total: 1,
      userReaction: null,
    });
  });

  it("answers 404 and reads no reactions when the post is not visible", async () => {
    fakeDb.selectReturns(posts, []);

    const response = await GET(
      new Request(
        `http://localhost/api/posts/reactions?targetType=post&targetId=${POST_ID}`,
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["posts"]);
  });

  it("does not gate a target that is not a post", async () => {
    fakeDb.selectReturns(reactions, []);

    const response = await GET(
      new Request(
        `http://localhost/api/posts/reactions?targetType=comment&targetId=${POST_ID}`,
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(200);
    // Only a post has an audience to apply; anything else is read directly.
    expectGatedSequence("reads", ["reactions"]);
  });

  it("answers 500 when the post read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(posts, new Error("database unavailable"));
    try {
      const response = await GET(
        new Request(
          `http://localhost/api/posts/reactions?targetType=post&targetId=${POST_ID}`,
          { method: "GET" },
        ),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch reactions" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});
