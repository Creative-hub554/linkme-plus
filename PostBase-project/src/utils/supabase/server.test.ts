import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `createClient()` is the server-side Supabase factory every route, page and
 * auth component uses. What it owns is the cookie bridge: `getAll` reads the
 * request's cookies and `setAll` writes back whatever Supabase refreshes.
 *
 * Both Supabase and `next/headers` are mocked, so the test is about *this*
 * module's wiring rather than about either library: the mocked factory calls the
 * cookie handlers it was handed, and the assertions are on what those handlers
 * do with the store.
 */
const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb-token", value: "old" }]),
  set: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const createServerClient = vi.fn(
  (_url: string, _key: string, options: { cookies: { getAll(): unknown; setAll(c: unknown[]): void } }) => {
    // Reach into the wiring the way Supabase would, so the handlers actually run.
    options.cookies.getAll();
    options.cookies.setAll([{ name: "sb-token", value: "new", options: { path: "/" } }]);
    return { marker: "supabase-client" };
  },
);

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) =>
    (createServerClient as (...inner: unknown[]) => unknown)(...args),
}));

import { createClient } from "./server";

beforeEach(() => {
  cookieStore.getAll.mockClear();
  cookieStore.set.mockClear();
  createServerClient.mockClear();
});

describe("the server Supabase client", () => {
  it("returns the client the factory builds", async () => {
    await expect(createClient()).resolves.toEqual({ marker: "supabase-client" });
  });

  it("reads cookies through the request store", async () => {
    await createClient();
    expect(cookieStore.getAll).toHaveBeenCalled();
  });

  it("writes refreshed cookies back to the store", async () => {
    await createClient();
    expect(cookieStore.set).toHaveBeenCalledWith("sb-token", "new", { path: "/" });
  });

  it("swallows a store that refuses writes, as a Server Component's does", async () => {
    // Writing cookies during render throws in a Server Component; the module
    // catches that rather than failing the render.
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });

    await expect(createClient()).resolves.toEqual({ marker: "supabase-client" });
  });
});
