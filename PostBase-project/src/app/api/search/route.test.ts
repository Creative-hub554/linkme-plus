import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The search route: a query is required, and the `type` decides which tables are
 * touched.
 *
 * Search fans out across the app — members, posts, pages, groups, marketplace
 * and jobs — and two properties matter enough to pin. First, a request with no
 * `q` is refused before any read. Second, `type` selects the reads: `all` reads
 * every table in a fixed order, a single type reads only its own, and an
 * unrecognised type reads nothing and answers an empty `results` rather than
 * silently searching everything. The post arm is the one with an audience rule
 * (`visiblePostsCondition`), which the fake `@/lib/db` does not evaluate — that
 * predicate is pinned through the query builder in `post-visibility.test.ts`;
 * here it is pinned only as "posts are read once, in the fan-out order".
 *
 * The member arm is gated the same way: a block in either direction hides the
 * member from search, and the fake records that predicate as the arm's `where`
 * (`selectWheres`) even though it cannot filter on it.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "searcher-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET } from "./route";
import { users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedRead, expectGatedSequence } from "@/test/expect-gated";

function search(query: string) {
  return new Request(`http://localhost/api/search${query}`, { method: "GET" });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "searcher-1";
});

describe("GET /api/search", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(search("?q=hello"));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires a query, reading nothing", async () => {
    const response = await GET(search(""));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("reads every source in order for `all`", async () => {
    const response = await GET(search("?q=hello&type=all"));

    expect(response.status).toBe(200);
    // `users` and `posts` are joined queries; the fake records the table the
    // chain started from, which is the source each arm searches.
    expectGatedSequence("reads", [
      "users",
      "posts",
      "pages",
      "groups",
      "marketplace_listings",
      "jobs",
    ]);
    const body = await response.json();
    expect(Object.keys(body.results)).toEqual([
      "users",
      "posts",
      "pages",
      "groups",
      "marketplace",
      "jobs",
    ]);
  });

  it("reads only the named source when a type is given", async () => {
    for (const [type, table] of [
      ["users", "users"],
      ["posts", "posts"],
      ["pages", "pages"],
      ["groups", "groups"],
      ["marketplace", "marketplace_listings"],
      ["jobs", "jobs"],
    ] as const) {
      resetFakeDb();
      const response = await GET(search(`?q=hello&type=${type}`));

      expect(response.status).toBe(200);
      expectGatedSequence("reads", [table]);
    }
  });

  it("reads nothing and answers empty results for an unknown type", async () => {
    const response = await GET(search("?q=hello&type=bogus"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: {} });
    expectGatedNone("reads");
  });

  it("gates the member arm on a block between the viewer and each result", async () => {
    const response = await GET(search("?q=hello&type=users"));

    expect(response.status).toBe(200);
    expectGatedSequence("reads", ["users"]);
    // Per-row, correlated to the member being searched rather than to a fixed
    // pair: an unqualified column here would hide nobody.
    expectGatedRead(users, {
      where: [/not exists/, /from "blocks"/, /"blocked_id" = "users"\."id"/],
    });
  });

  it("answers 500 when a source read fails", async () => {
    fakeDb.failNextSelect(users);

    const response = await GET(search("?q=hello&type=all"));

    expect(response.status).toBe(500);
  });
});
