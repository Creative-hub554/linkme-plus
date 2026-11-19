const { isRestrictedAccount } = vi.hoisted(() => ({
  isRestrictedAccount: vi.fn(async (_userId: string) => false),
}));
vi.mock("@/lib/account-restrictions", () => ({ isRestrictedAccount }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `updateSession` runs on every non-static request. It refreshes the Supabase
 * session and gates every member-only path, redirecting a signed-out reader to
 * `/login`, a restricted member to `/account-restricted`, and leaving everyone
 * else alone.
 *
 * Supabase is mocked so `getUser` can answer both ways; `NextRequest` and
 * `NextResponse` are the real ones, because the point is the response this
 * module builds (a pass-through with refreshed cookies, or a redirect).
 */
type CookieOptions = { cookies: { getAll(): unknown; setAll(c: unknown[]): void } };

const getUser = vi.fn(async () => ({ data: { user: null as { id: string } | null } }));

const createServerClient = vi.fn(
  (_url: string, _key: string, options: CookieOptions) => {
    // Exercise both handlers as the real client would: read the request's
    // cookies and push a refresh back through `setAll`.
    options.cookies.getAll();
    options.cookies.setAll([{ name: "sb-token", value: "refreshed", options: { path: "/" } }]);
    return { auth: { getUser } };
  },
);

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) =>
    (createServerClient as (...inner: unknown[]) => unknown)(...args),
}));

import { updateSession } from "./middleware";

beforeEach(() => {
  getUser.mockClear();
  getUser.mockResolvedValue({ data: { user: null } });
  createServerClient.mockClear();
  isRestrictedAccount.mockClear();
  isRestrictedAccount.mockResolvedValue(false);
});

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe("updateSession", () => {
  it("lets an unprotected path through when signed out", async () => {
    const response = await updateSession(request("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects a signed-out reader away from each protected path", async () => {
    for (const path of ["/feed", "/profile", "/settings", "/messages", "/cover-studio", "/marketplace/saved", "/marketplace/new", "/marketplace/inventory", "/jobs/new", "/jobs/manage", "/advertising", "/admin"]) {
      const response = await updateSession(request(path));
      expect(response.headers.get("location"), `${path} should redirect`).toBe("http://localhost/login");
    }
  });

  it("sends a restricted member to the account-restricted notice, cookies intact", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "restricted-1" } } });
    isRestrictedAccount.mockResolvedValue(true);
    const response = await updateSession(request("/feed?tab=foryou"));
    expect(isRestrictedAccount).toHaveBeenCalledWith("restricted-1");
    expect(response.headers.get("location")).toBe("http://localhost/account-restricted");
    expect(response.cookies.get("sb-token")?.value).toBe("refreshed");
  });

  it("lets a signed-in reader into a protected path", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "member-1" } } });
    const response = await updateSession(request("/settings"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("carries the refreshed session cookie on the response", async () => {
    const response = await updateSession(request("/"));
    // `setAll` both mutated the request and wrote the cookie onto the response.
    expect(response.cookies.get("sb-token")?.value).toBe("refreshed");
  });
});
