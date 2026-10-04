// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";

/**
 * The browser auth client, driven with a fake Supabase client.
 *
 * Two halves, and they are different kinds of thing. The helpers
 * (`signIn.email`, `signOut`, `signInWithGoogle`, …) are plain functions that
 * forward one call each, so the test reads the call off the spy. The `useSession`
 * hook is the one piece with state: it reads the current session on mount and
 * then keeps it current through `onAuthStateChange`, which the fake drives
 * directly so both the initial read and the live update are covered.
 */
const mocks = vi.hoisted(() => {
  const initial = { user: { id: "user-1", email: "theo@example.com", name: "Theo Wu" } };
  const state = {
    authChange: null as null | ((event: string, session: unknown) => void),
    unsubscribe: vi.fn(),
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: initial } })),
    onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
      state.authChange = callback;
      return { data: { subscription: { unsubscribe: state.unsubscribe } } };
    }),
    signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    signUp: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ data: {}, error: null })),
  };
  return { auth, state };
});

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({ auth: mocks.auth }),
}));

const { useSession, useUser, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook } =
  await import("@/lib/auth-client");

/** Reads the hook the way a component does, so a mount can observe it. */
function SessionProbe() {
  const { user, loading } = useSession();
  return <p>{loading ? "loading" : user ? `signed in as ${user.email}` : "signed out"}</p>;
}

/** Reads the lighter `useUser` wrapper the same way. */
function UserProbe() {
  const { user, loading } = useUser();
  return <p>{loading ? "loading" : user ? `user ${user.id}` : "no user"}</p>;
}

afterEach(() => {
  cleanupSurfaces();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.authChange = null;
});

describe("the browser auth client", () => {
  test("useSession settles from loading to the session it read", async () => {
    const ui = mountSurface(<SessionProbe />, { providers: "none" });
    expect(ui.container.textContent).toContain("loading");
    await ui.waitFor(() => ui.container.textContent?.includes("signed in as theo@example.com") ?? false, {
      description: "the session to arrive",
    });
  });

  test("useSession keeps up with a signed-in event", async () => {
    const ui = mountSurface(<SessionProbe />, { providers: "none" });
    await ui.waitFor(() => mocks.state.authChange !== null, {
      description: "the auth state subscription to be installed",
    });
    // Supabase hands the callback the session itself, not a wrapped object.
    const next = { user: { id: "user-2", email: "maya@example.com" } };
    await act(async () => {
      mocks.state.authChange?.("SIGNED_IN", next);
    });
    expect(ui.container.textContent).toContain("signed in as maya@example.com");
  });

  test("useSession returns to signed-out when the event carries no session", async () => {
    const ui = mountSurface(<SessionProbe />, { providers: "none" });
    await ui.waitFor(() => mocks.state.authChange !== null, {
      description: "the auth state subscription to be installed",
    });
    await act(async () => {
      mocks.state.authChange?.("SIGNED_OUT", null);
    });
    expect(ui.container.textContent).toContain("signed out");
  });

  test("useSession unsubscribes when the surface goes away", async () => {
    const ui = mountSurface(<SessionProbe />, { providers: "none" });
    await ui.waitFor(() => mocks.state.authChange !== null, {
      description: "the auth state subscription to be installed",
    });
    ui.unmount();
    expect(mocks.state.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("useUser exposes the same user through the lighter wrapper", async () => {
    const ui = mountSurface(<UserProbe />, { providers: "none" });
    await ui.waitFor(() => ui.container.textContent?.includes("user user-1") ?? false, {
      description: "the user to arrive",
    });
  });

  test("signIn.email forwards the password grant", async () => {
    await signIn.email("theo@example.com", "hunter2");
    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "theo@example.com",
      password: "hunter2",
    });
  });

  test("signIn.social returns to this app's callback", async () => {
    await signIn.social("facebook");
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "facebook",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  test("signIn.phoneNumber sends the one-time code", async () => {
    await signIn.phoneNumber("+15551234567");
    expect(mocks.auth.signInWithOtp).toHaveBeenCalledWith({ phone: "+15551234567" });
  });

  test("signUp carries the metadata as Supabase options", async () => {
    await signUp("theo@example.com", "hunter2", { username: "theo" });
    expect(mocks.auth.signUp).toHaveBeenCalledWith({
      email: "theo@example.com",
      password: "hunter2",
      options: { data: { username: "theo" } },
    });
  });

  test("signOut forwards to the client", async () => {
    await signOut();
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  test("the Google and Facebook shortcuts choose their provider", async () => {
    await signInWithGoogle();
    expect(mocks.auth.signInWithOAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
    await signInWithFacebook();
    expect(mocks.auth.signInWithOAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "facebook" }),
    );
  });
});
