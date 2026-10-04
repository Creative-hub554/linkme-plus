import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The server-side auth facade, driven with a fake Supabase client.
 *
 * `src/lib/auth.ts` is a thin mapping over `supabase.auth`: it creates a
 * cookie-bound client and forwards one call. Nothing about that is worth a
 * database — what matters is that each helper *forwards the right call and
 * returns its `data`*, and that `requireAuth` turns a missing user into a 401
 * rather than a render with a null user.
 *
 * The client is a plain object shared across the module, so a test reads the
 * call a helper made off the same spies it answers with. It is created by
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports and
 * cannot close over a `const` declared below it.
 */
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } } })),
  // Nullable, so `requireAuth`'s signed-out path can be driven.
  getUser: vi.fn(
    async (): Promise<{ data: { user: { id: string; email: string } | null } }> => ({
      data: { user: { id: "user-1", email: "theo@example.com" } },
    }),
  ),
  signUp: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
  signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: null })),
  signOut: vi.fn(async () => ({ error: null })),
  signInWithOAuth: vi.fn(async () => ({ data: { url: "https://example/auth" }, error: null })),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: mocks }),
}));

const {
  getSession,
  getUser,
  requireAuth,
  signUp,
  signIn,
  signOut,
  signInWithOAuth,
  auth,
} = await import("@/lib/auth");

describe("the server auth facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  });

  test("getSession hands back the session the client read", async () => {
    const session = await getSession();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(session).toEqual({ user: { id: "user-1" } });
  });

  test("getUser hands back the user the client read", async () => {
    const user = await getUser();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(user).toEqual({ id: "user-1", email: "theo@example.com" });
  });

  test("requireAuth passes a signed-in reader through with no error", async () => {
    const result = await requireAuth();
    expect(result.error).toBeNull();
    expect(result.user).toEqual({ id: "user-1", email: "theo@example.com" });
  });

  test("requireAuth answers 401 rather than a null user when nobody is signed in", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    const result = await requireAuth();
    expect(result.user).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.status).toBe(401);
    // The body is the app's, not Supabase's: the route answers what it means.
    await expect(result.error?.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  test("signUp forwards the details and the metadata as Supabase options", async () => {
    await signUp("theo@example.com", "hunter2", { username: "theo" });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "theo@example.com",
      password: "hunter2",
      options: { data: { username: "theo" } },
    });
  });

  test("signUp without metadata still sends an options object", async () => {
    await signUp("theo@example.com", "hunter2");
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "theo@example.com",
      password: "hunter2",
      options: { data: undefined },
    });
  });

  test("signIn forwards the password grant", async () => {
    await signIn("theo@example.com", "hunter2");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "theo@example.com",
      password: "hunter2",
    });
  });

  test("signOut forwards to the client", async () => {
    await signOut();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  test("signInWithOAuth sends the callback Supabase should return to", async () => {
    await signInWithOAuth("google");
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://project.supabase.co/auth/v1/callback" },
    });
  });

  test("the compatibility facade reads the same session from the cookies", async () => {
    const session = await auth.api.getSession({ headers: new Headers() });
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(session).toEqual({ user: { id: "user-1" } });
  });

  test("the compatibility handler says Supabase owns authentication", async () => {
    const response = await auth.handler(new Request("https://example/auth"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication is handled by Supabase",
    });
  });
});
