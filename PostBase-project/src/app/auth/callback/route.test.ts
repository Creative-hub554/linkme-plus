import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The OAuth callback: exchange the provider's code, provision the member, and
 * land them somewhere it is safe to land.
 *
 * The identity it provisions is never the client's — it comes from
 * `exchangeCodeForSession`, and only a successful exchange with a `user` reaches
 * the database. The client-supplied `next` is the one thing the request does
 * control, and it is guarded against an open redirect: a value that is not a
 * single-slash absolute path falls back to `/feed`. A failed exchange, or a
 * provisioning error inside the `try`, both end at `/login?error=auth`.
 *
 * `@/utils/supabase/server` and `@/lib/db` are both replaced — the first by a
 * bare `{ auth: { exchangeCodeForSession } }`, the second by the table-keyed fake
 * — so the code under test is the route's own decisions.
 */
const exchange = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

import { GET } from "./route";
import { profiles, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  user_metadata: { full_name: "Ada Lovelace", username: "ada" },
};

function callback(query: string) {
  return new Request(`http://localhost/auth/callback${query}`, { method: "GET" });
}

function located(response: Response) {
  return response.headers.get("location");
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
});

describe("GET /auth/callback", () => {
  it("sends a request with no code to the login error, reading nothing", async () => {
    const response = await GET(callback(""));

    expect(response.status).toBe(307);
    expect(located(response)).toBe("http://localhost/login?error=auth");
    expect(exchange).not.toHaveBeenCalled();
    expectGatedNone("reads");
  });

  it("sends a failed exchange to the login error, provisioning nothing", async () => {
    exchange.mockResolvedValueOnce({ data: { user: null }, error: { message: "bad code" } });

    const response = await GET(callback("?code=stale"));

    expect(response.status).toBe(307);
    expect(located(response)).toBe("http://localhost/login?error=auth");
    expectGatedNone("reads");
  });

  it("provisions a new member from the provider's user and lands on /feed", async () => {
    exchange.mockResolvedValueOnce({ data: { user: USER }, error: null });
    fakeDb
      .selectReturns(users, []) // no account yet
      .selectReturns(users, []) // the candidate username is free
      .selectReturns(profiles, []); // no profile yet

    const response = await GET(callback("?code=good"));

    expect(response.status).toBe(307);
    expect(located(response)).toBe("http://localhost/feed");
    // The account and the profile, both keyed on the provider's id — not on
    // anything the request supplied.
    expectGatedSequence("writes", ["users", "profiles"]);
    expectGatedInsert(users, {
      first: true,
      values: expect.objectContaining({ id: USER.id, email: USER.email, username: "ada" }),
    });
    expectGatedInsert(profiles, {
      values: expect.objectContaining({ userId: USER.id, displayName: "Ada Lovelace" }),
    });
  });

  it("honours a single-slash `next`", async () => {
    exchange.mockResolvedValueOnce({ data: { user: USER }, error: null });
    fakeDb
      .selectReturns(users, [{ id: USER.id }]) // account exists
      .selectReturns(profiles, [{ id: "p1" }]); // profile exists

    const response = await GET(callback("?code=good&next=/settings"));

    expect(located(response)).toBe("http://localhost/settings");
    // Nothing to provision, so nothing is written.
    expectGatedNone("writes");
  });

  it("refuses an off-site `next`, falling back to /feed", async () => {
    // A fresh answer per iteration: the exchange is the same, but the fake's
    // scripted reads are reset between cases.
    exchange.mockResolvedValue({ data: { user: USER }, error: null });

    for (const next of ["https://evil.example/steal", "//evil.example", "javascript:alert(1)"]) {
      resetFakeDb();
      fakeDb
        .selectReturns(users, [{ id: USER.id }])
        .selectReturns(profiles, [{ id: "p1" }]);

      const response = await GET(callback(`?code=good&next=${encodeURIComponent(next)}`));

      expect(located(response), next).toBe("http://localhost/feed");
    }
  });

  it("sends a provisioning failure to the login error rather than throwing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    exchange.mockResolvedValueOnce({ data: { user: USER }, error: null });
    fakeDb
      .selectReturns(users, [])
      .selectReturns(users, [])
      .failNextInsert(users, new Error("database unavailable"));
    try {
      const response = await GET(callback("?code=good"));

      expect(response.status).toBe(307);
      expect(located(response)).toBe("http://localhost/login?error=auth");
    } finally {
      silence.mockRestore();
    }
  });
});
