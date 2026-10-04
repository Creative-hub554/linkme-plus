import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The post engagement counts route: what it will accept and what it will answer.
 *
 * This is the reconcile endpoint a reconnecting feed calls — realtime events
 * that fired while the socket was down are gone, so the feed asks for absolute
 * counts by id afterwards. The whole contract is in its validation, which is
 * what these tests pin: it must have at least one id, must not be handed more
 * than the ceiling (a crafted request asking for the world), and must be given
 * ids shaped like uuids before any query runs. Duplicates collapse, so a client
 * that re-lists an id does not trip the ceiling on its own repetition. Only then
 * does it read `posts`, once, and answer `{ data }` — an id missing from that
 * data is a post that was deleted or narrowed away, deliberately not an error.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the
 * visibility predicate this route composes is not re-tested here — it is pinned
 * through the query builder in `post-visibility.test.ts`. What is read here is
 * the route's own answer to a read that returned nothing, and the single `posts`
 * read it did or did not make.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "reader-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET } from "./route";
import { posts } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

/** A batch of `n` distinct, uuid-shaped ids. */
function ids(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
  );
}

function get(query: string) {
  return new Request(`http://localhost/api/posts/counts${query}`, { method: "GET" });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "reader-1";
});

describe("GET /api/posts/counts", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(get(`?ids=${POST_ID}`));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires at least one id, reading nothing", async () => {
    const response = await GET(get(""));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses more ids than the ceiling allows, before any read", async () => {
    const response = await GET(get(`?ids=${ids(101).join(",")}`));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("accepts exactly the ceiling", async () => {
    fakeDb.selectReturns(posts, []);
    const response = await GET(get(`?ids=${ids(100).join(",")}`));

    expect(response.status).toBe(200);
    expectGatedSequence("reads", ["posts"]);
  });

  it("collapses duplicates, so repetition alone cannot exceed the ceiling", async () => {
    fakeDb.selectReturns(posts, []);
    const repeated = Array.from({ length: 200 }, () => POST_ID).join(",");

    const response = await GET(get(`?ids=${repeated}`));

    expect(response.status).toBe(200);
    expectGatedSequence("reads", ["posts"]);
  });

  it("refuses ids that are not uuid-shaped, before any read", async () => {
    const response = await GET(get(`?ids=${POST_ID},not-a-uuid`));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("returns the counts for the ids that were found, reading posts once", async () => {
    const rows = [
      { id: POST_ID, commentCount: 3, reactionCount: 7 },
      { id: OTHER_ID, commentCount: 0, reactionCount: 1 },
    ];
    fakeDb.selectReturns(posts, rows);

    const response = await GET(get(`?ids=${POST_ID},${OTHER_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: rows });
    expectGatedSequence("reads", ["posts"]);
  });

  it("answers an empty list for ids that were all filtered out, without erroring", async () => {
    // A requested id that is absent is a post that was deleted or narrowed away,
    // which is the contract the feed relies on after a reconnect.
    fakeDb.selectReturns(posts, []);

    const response = await GET(get(`?ids=${POST_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it("answers 500 when the count read fails", async () => {
    fakeDb.failNextSelect(posts);

    const response = await GET(get(`?ids=${POST_ID}`));

    expect(response.status).toBe(500);
  });
});
