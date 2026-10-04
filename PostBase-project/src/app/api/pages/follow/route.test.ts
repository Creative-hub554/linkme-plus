import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page follow route: what it accepts, and the state it lands on.
 *
 * Following a Page is a toggle with a twist — `following` may *state* the intent,
 * so a client holding a stale view lands on the state the person asked for
 * rather than flipping the relationship the wrong way. That intent and the
 * validation around it are what these tests pin: the Page id must be present and
 * uuid-shaped, `following` must be a boolean when given, and the Page must
 * exist. Beyond that, the interesting cases are the ones the caller cannot see
 * from a flip: an explicit `following` that already matches does **no** write;
 * the desired state decides whether the route inserts or deletes; and the
 * follower total always comes back so no client guesses ±1. A follow that wrote
 * a new row answers `201`, everything else `200`.
 *
 * The fake `@/lib/db` does not evaluate `where`, so the follow predicate is not
 * interpreted for its result — what is read is whether an insert or a delete
 * followed the lookup, and what the route answered. The predicate itself is
 * still asserted: the fake records each delete's `where` (`deleteWheres`) and
 * its parameters (`deleteParams`), so an unfollow is pinned to the
 * `page_id`/`user_id` pair. The fake's `delete` never reports removed rows, so
 * an unfollow is pinned as the `200` it is, with the delete recorded, rather
 * than as a `201` this seam cannot produce.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "follower-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { POST } from "./route";
import { pages, pageFollows } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedDelete, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const FOLLOW_ID = "55555555-5555-4555-8555-555555555555";

function follow(body: unknown) {
  return new Request("http://localhost/api/pages/follow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "follower-1";
});

describe("POST /api/pages/follow", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await POST(follow({ pageId: PAGE_ID }));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a Page id, reading nothing", async () => {
    const response = await POST(follow({}));

    expect(response.status).toBe(400);
    // The guard's own refusal, not the uuid check's — a missing id is not a
    // malformed one, and the two must not collapse into the same answer.
    expect(await response.json()).toEqual({ error: "Page ID is required" });
    expectGatedNone("reads");
  });

  it("refuses a Page id that is not uuid-shaped, before any read", async () => {
    const response = await POST(follow({ pageId: "not-a-page" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses a `following` that is not a boolean, before any read", async () => {
    const response = await POST(follow({ pageId: PAGE_ID, following: "yes" }));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("answers 404 when the Page does not exist, writing nothing", async () => {
    fakeDb.selectReturns(pages, []);

    const response = await POST(follow({ pageId: PAGE_ID }));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("follows when asked, writing the row and answering the new total with 201", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageFollows, [])
      .insertReturns(pageFollows, [{ id: FOLLOW_ID }])
      .selectReturns(pageFollows, [{ followers: 6 }]);

    const response = await POST(follow({ pageId: PAGE_ID, following: true }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ following: true, followers: 6 });
    // The session's user, not anything the body carried.
    expectGatedSequence("writes", [
      { table: "page_follows", values: { pageId: PAGE_ID, userId: "follower-1" } },
    ]);
  });

  it("defaults to following when no intent is given and there is no row yet", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageFollows, [])
      .insertReturns(pageFollows, [{ id: FOLLOW_ID }])
      .selectReturns(pageFollows, [{ followers: 1 }]);

    const response = await POST(follow({ pageId: PAGE_ID }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ following: true, followers: 1 });
  });

  it("unfollows when asked, deleting and answering 200", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageFollows, [{ id: FOLLOW_ID }])
      .selectReturns(pageFollows, [{ followers: 4 }]);

    const response = await POST(follow({ pageId: PAGE_ID, following: false }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: false, followers: 4 });
    expectGatedSequence("deletes", ["page_follows"]);
    expectGatedNone("writes");
    // The delete names the Page *and* the caller: an unfollow removes the
    // caller's relationship with that Page, not every page's relationship.
    expectGatedDelete(pageFollows, {
      where: ['"page_follows"."page_id" = $1', '"page_follows"."user_id" = $2'],
      params: [PAGE_ID, "follower-1"],
    });
  });

  it("does no write when the desired state already holds", async () => {
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageFollows, [{ id: FOLLOW_ID }])
      .selectReturns(pageFollows, [{ followers: 9 }]);

    const response = await POST(follow({ pageId: PAGE_ID, following: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true, followers: 9 });
    expectGatedNone("writes");
    expectGatedNone("deletes");
  });

  it("answers 200, not 201, when the insert was dropped as a conflict", async () => {
    // A second request interleaved: `onConflictDoNothing` writes nothing, so the
    // caller did not change the relationship and gets the ordinary `200`.
    fakeDb
      .selectReturns(pages, [{ id: PAGE_ID }])
      .selectReturns(pageFollows, [])
      .insertReturns(pageFollows, [])
      .selectReturns(pageFollows, [{ followers: 2 }]);

    const response = await POST(follow({ pageId: PAGE_ID, following: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true, followers: 2 });
  });

  it("answers 500 when the Page read fails, writing nothing", async () => {
    fakeDb.failNextSelect(pages);

    const response = await POST(follow({ pageId: PAGE_ID }));

    expect(response.status).toBe(500);
    expectGatedNone("writes");
  });
});
