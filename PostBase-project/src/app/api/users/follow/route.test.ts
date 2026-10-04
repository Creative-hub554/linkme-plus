import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The follow route: a member's followers/following list, and the toggle.
 *
 * `GET` lists one side of the relationship for a member, keyset-paginated, so
 * the validation in front of a read is the contract — a uuid `userId`, a `type`
 * of `followers` or `following`, and a cursor that decodes. A member who is not
 * there is a `404`. The page itself is pinned as the read order (`users`, then
 * `follows`), the members returned without their cursor fields, and a
 * `nextCursor` built from the last row when a further page exists; the page size
 * is clamped, so an absurd `limit` cannot widen the window.
 *
 * `POST` is the same intent-aware toggle as the Page follow route: the id must be
 * a uuid and cannot be the caller, `following` must be a boolean when given, and
 * the target must exist. An explicit intent that already holds does no write; a
 * follow inserts and answers `201`; an insert dropped as a conflict answers
 * `200`; an unfollow deletes the `follower`/`following` pair, which the fake
 * records as the delete's `where` (`deleteWheres`) and parameters
 * (`deleteParams`). The fake's `delete` reports no rows, so an unfollow is
 * pinned as the `200` it is with the delete recorded.
 *
 * A block closes the relationship in both directions, and both sides are pinned:
 * `POST` refuses with a `403` and writes nothing when a block row comes back,
 * and the `GET` list read carries the block predicate in its `where` (recorded
 * by the fake as {@link FakeDb.selectWheres}), since the fake cannot filter a
 * row it never evaluates.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "viewer-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET, POST } from "./route";
import { blocks, follows, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import {
  expectGatedDelete,
  expectGatedNone,
  expectGatedRead,
  expectGatedSequence,
} from "@/test/expect-gated";
import { encodeCursor } from "@/lib/cursor-pagination";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const FOLLOW_ID = "77777777-7777-4777-8777-777777777777";
const BLOCK_ID = "88888888-8888-4888-8888-888888888888";

function list(query: string) {
  return new Request(`http://localhost/api/users/follow${query}`, { method: "GET" });
}

function toggle(body: unknown) {
  return new Request("http://localhost/api/users/follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "viewer-1";
});

describe("GET /api/users/follow", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(list(`?userId=${USER_ID}`));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a uuid user id, reading nothing", async () => {
    expect((await GET(list(""))).status).toBe(400);
    expect((await GET(list("?userId=not-a-uuid"))).status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses an unknown type, reading nothing", async () => {
    const response = await GET(list(`?userId=${USER_ID}&type=blockers`));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses a malformed cursor before reading the list", async () => {
    const response = await GET(list(`?userId=${USER_ID}&cursor=not-a-cursor`));

    expect(response.status).toBe(400);
    // The target read happens before the cursor is used only for the list; a bad
    // cursor is refused before either.
    expectGatedNone("reads");
  });

  it("answers 404 when the member is not there", async () => {
    fakeDb.selectReturns(users, []);

    const response = await GET(list(`?userId=${USER_ID}`));

    expect(response.status).toBe(404);
    expectGatedSequence("reads", ["users"]);
  });

  it("lists a page of members and hands back a cursor for the next one", async () => {
    const rows = [
      {
        id: "u-1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        bio: null,
        isFollowing: false,
        followId: "f-1",
        followedAtKey: "2026-01-03T00:00:00.000000",
      },
      {
        id: "u-2",
        username: "bob",
        displayName: "Bob",
        avatarUrl: null,
        bio: null,
        isFollowing: true,
        followId: "f-2",
        followedAtKey: "2026-01-02T00:00:00.000000",
      },
      // The extra row only reveals another page exists.
      {
        id: "u-3",
        username: "carol",
        displayName: "Carol",
        avatarUrl: null,
        bio: null,
        isFollowing: false,
        followId: "f-3",
        followedAtKey: "2026-01-01T00:00:00.000000",
      },
    ];
    fakeDb.selectReturns(users, [{ id: USER_ID }]).selectReturns(follows, rows);

    const response = await GET(list(`?userId=${USER_ID}&limit=2`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { id: "u-1", username: "alice", displayName: "Alice", avatarUrl: null, bio: null, isFollowing: false },
        { id: "u-2", username: "bob", displayName: "Bob", avatarUrl: null, bio: null, isFollowing: true },
      ],
      pagination: {
        limit: 2,
        nextCursor: encodeCursor("2026-01-02T00:00:00.000000", "f-2"),
        hasMore: true,
      },
    });
    // The target first, then the relationship list.
    expectGatedSequence("reads", ["users", "follows"]);
  });

  it("clamps an absurd limit into the allowed window", async () => {
    fakeDb.selectReturns(users, [{ id: USER_ID }]).selectReturns(follows, [
      {
        id: "u-1",
        username: "alice",
        displayName: "Alice",
        followId: "f-1",
        followedAtKey: "2026-01-01T00:00:00.000000",
      },
    ]);

    const response = await GET(list(`?userId=${USER_ID}&limit=99999`));

    expect(response.status).toBe(200);
    expect((await response.json()).pagination.limit).toBe(100);
  });

  it("accepts `type=following`", async () => {
    fakeDb.selectReturns(users, [{ id: USER_ID }]).selectReturns(follows, []);

    const response = await GET(list(`?userId=${USER_ID}&type=following`));

    expect(response.status).toBe(200);
    expectGatedSequence("reads", ["users", "follows"]);
    expect((await response.json()).pagination.nextCursor).toBeNull();
  });

  it("answers 500 when the list read fails", async () => {
    fakeDb.failNextSelect(users);

    const response = await GET(list(`?userId=${USER_ID}`));

    expect(response.status).toBe(500);
  });

  it("gates the list on a block between the viewer and each member", async () => {
    fakeDb.selectReturns(users, [{ id: USER_ID }]).selectReturns(follows, []);

    const response = await GET(list(`?userId=${USER_ID}`));

    expect(response.status).toBe(200);
    // The list read — the second read, after the target — has to carry the block
    // predicate; without it a blocked member stays listed to the person who
    // blocked them, which is exactly what the fake cannot express by filtering.
    // And the correlation has to be the member being listed, so it filters per
    // row rather than matching the block against itself.
    expectGatedRead(follows, {
      where: [/not exists/, /from "blocks"/, /"blocked_id" = "users"\."id"/],
    });
  });
});

describe("POST /api/users/follow", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a uuid user id, reading nothing", async () => {
    const missing = await POST(toggle({}));
    expect(missing.status).toBe(400);
    // A missing id is answered as missing, not as malformed — the two guards
    // must not both fall through to the uuid check's message.
    expect(await missing.json()).toEqual({ error: "User ID is required" });

    expect((await POST(toggle({ userId: "not-a-uuid" }))).status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses a non-boolean `following`, reading nothing", async () => {
    const response = await POST(toggle({ userId: TARGET_ID, following: "yes" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses to follow yourself, reading nothing", async () => {
    // The id must be uuid-shaped, or it is refused as invalid before the
    // self-check is reached — which is what makes this test about the self-check.
    session.userId = USER_ID;

    const response = await POST(toggle({ userId: USER_ID }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Cannot follow yourself" });
    expectGatedNone("reads");
  });

  it("answers 404 when the member is not there, writing nothing", async () => {
    fakeDb.selectReturns(users, []);

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("follows by default when there is no row yet, writing the pair and 201", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(follows, [])
      .insertReturns(follows, [{ id: FOLLOW_ID }])
      .selectReturns(follows, [{ followers: 8 }]);

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ following: true, followers: 8 });
    expectGatedSequence("writes", [
      { table: "follows", values: { followerId: "viewer-1", followingId: TARGET_ID } },
    ]);
  });

  it("unfollows when asked, deleting and answering 200", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(follows, [{ id: FOLLOW_ID }])
      .selectReturns(follows, [{ followers: 7 }]);

    const response = await POST(toggle({ userId: TARGET_ID, following: false }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: false, followers: 7 });
    expectGatedSequence("deletes", ["follows"]);
    expectGatedNone("writes");
    // The delete is keyed on the pair, not the row id: the caller is the
    // follower and the target the followed, so an unfollow cannot remove a
    // relationship it does not describe.
    expectGatedDelete(follows, {
      where: ['"follows"."follower_id" = $1', '"follows"."following_id" = $2'],
      params: ["viewer-1", TARGET_ID],
    });
  });

  it("does no write when the desired state already holds", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(follows, [{ id: FOLLOW_ID }])
      .selectReturns(follows, [{ followers: 8 }]);

    const response = await POST(toggle({ userId: TARGET_ID, following: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true, followers: 8 });
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("answers 200, not 201, when the insert was dropped as a conflict", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(follows, [])
      .insertReturns(follows, [])
      .selectReturns(follows, [{ followers: 8 }]);

    const response = await POST(toggle({ userId: TARGET_ID, following: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true, followers: 8 });
  });

  it("refuses a member a block stands between, writing nothing", async () => {
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(blocks, [{ id: BLOCK_ID }]);

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You cannot follow this member" });
    // The target first, then the block — and nothing written or deleted.
    expectGatedSequence("reads", ["users", "blocks"]);
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("follows whenever no block stands between, even if one once did", async () => {
    // The block is a live check, not a stored flag: with no row back from it,
    // the follow proceeds as normal.
    fakeDb
      .selectReturns(users, [{ id: TARGET_ID }])
      .selectReturns(blocks, [])
      .selectReturns(follows, [])
      .insertReturns(follows, [{ id: FOLLOW_ID }])
      .selectReturns(follows, [{ followers: 1 }]);

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(201);
    expectGatedSequence("writes", [
      { table: "follows", values: { followerId: "viewer-1", followingId: TARGET_ID } },
    ]);
  });

  it("answers 500 when the block read fails, writing nothing", async () => {
    fakeDb.selectReturns(users, [{ id: TARGET_ID }]).failNextSelect(blocks);

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });

  it("answers 500 when the target read fails, writing nothing", async () => {
    fakeDb.failNextSelect(users);

    const response = await POST(toggle({ userId: TARGET_ID }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });
});
