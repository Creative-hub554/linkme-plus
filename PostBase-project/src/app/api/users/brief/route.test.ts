import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The brief users route: member summaries for ids that arrived over Realtime.
 *
 * It is a hydration helper, so its whole contract is the validation in front of
 * the one read: `ids` must be present, at most 25 per request, and every id
 * uuid-shaped before any query runs. The read itself is a single `users`
 * left-joined to `profiles` — the profile is optional and the name falls back to
 * the username in SQL, which the fake does not evaluate; what is pinned is that
 * the ids as given reach one read and the rows come back under `data`.
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

import { GET } from "./route";
import { users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function brief(query: string) {
  return new Request(`http://localhost/api/users/brief${query}`, { method: "GET" });
}

function ids(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
  );
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "viewer-1";
});

describe("GET /api/users/brief", () => {
  it("requires a session before reading anything", async () => {
    session.userId = null;

    const response = await GET(brief(`?ids=${USER_ID}`));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
  });

  it("requires ids, reading nothing", async () => {
    const response = await GET(brief(""));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("refuses more than 25 ids, before any read", async () => {
    const response = await GET(brief(`?ids=${ids(26).join(",")}`));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("accepts exactly 25 ids", async () => {
    fakeDb.selectReturns(users, []);

    const response = await GET(brief(`?ids=${ids(25).join(",")}`));

    expect(response.status).toBe(200);
    expectGatedSequence("reads", ["users"]);
  });

  it("refuses ids that are not uuid-shaped, before any read", async () => {
    const response = await GET(brief(`?ids=${USER_ID},not-a-uuid`));

    expect(response.status).toBe(400);
    expectGatedNone("reads");
  });

  it("returns the summaries under `data`, reading users once", async () => {
    const rows = [
      { id: USER_ID, username: "alice", displayName: "Alice", isFollowing: true },
      { id: OTHER_ID, username: "bob", displayName: "Bob", isFollowing: false },
    ];
    fakeDb.selectReturns(users, rows);

    const response = await GET(brief(`?ids=${USER_ID},${OTHER_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: rows });
    expectGatedSequence("reads", ["users"]);
  });

  it("returns an empty list when no id matched", async () => {
    fakeDb.selectReturns(users, []);

    const response = await GET(brief(`?ids=${USER_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it("answers 500 when the read fails", async () => {
    fakeDb.failNextSelect(users);

    const response = await GET(brief(`?ids=${USER_ID}`));

    expect(response.status).toBe(500);
  });
});
