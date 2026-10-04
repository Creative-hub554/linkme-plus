// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import type { AuthUser } from "@/lib/auth-client";

/**
 * `AuthProvider` exposes the session as one context object and, importantly,
 * reports `isLoading` until it has mounted — the flag the nav uses to avoid
 * rendering a signed-out header for a signed-in reader. `useSession` is mocked
 * so both states can be handed to it directly.
 */
const sessionState = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  loading: false,
  user: null as AuthUser | null,
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    session: sessionState.session,
    loading: sessionState.loading,
    user: sessionState.user,
  }),
}));

import { AuthProvider, useAuth } from "./auth-provider";

function Reader() {
  const { isAuthenticated, isLoading, user, session } = useAuth();
  return (
    <div data-testid="auth">
      {JSON.stringify({ isAuthenticated, isLoading, userId: user?.id ?? null, hasSession: Boolean(session) })}
    </div>
  );
}

function read(container: HTMLElement) {
  return JSON.parse(container.querySelector('[data-testid="auth"]')?.textContent ?? "{}");
}

afterEach(() => {
  cleanupSurfaces();
  sessionState.session = null;
  sessionState.loading = false;
  sessionState.user = null;
});

describe("AuthProvider", () => {
  it("reports a signed-out reader", () => {
    const ui = mountSurface(
      <AuthProvider>
        <Reader />
      </AuthProvider>,
      { providers: "none" },
    );
    expect(read(ui.container)).toEqual({
      isAuthenticated: false,
      isLoading: false,
      userId: null,
      hasSession: false,
    });
  });

  it("reports the signed-in reader and their user", () => {
    sessionState.session = { user: { id: "member-1" } };
    sessionState.user = { id: "member-1", email: "m@example.com" } as AuthUser;

    const ui = mountSurface(
      <AuthProvider>
        <Reader />
      </AuthProvider>,
      { providers: "none" },
    );

    expect(read(ui.container)).toEqual({
      isAuthenticated: true,
      isLoading: false,
      userId: "member-1",
      hasSession: true,
    });
  });

  it("keeps the loading flag while the session is unresolved", () => {
    sessionState.loading = true;

    const ui = mountSurface(
      <AuthProvider>
        <Reader />
      </AuthProvider>,
      { providers: "none" },
    );
    expect(read(ui.container).isLoading).toBe(true);
  });
});

describe("useAuth", () => {
  it("returns the safe default outside a provider rather than throwing", () => {
    const ui = mountSurface(<Reader />, { providers: "none" });
    expect(read(ui.container)).toEqual({
      isAuthenticated: false,
      isLoading: true,
      userId: null,
      hasSession: false,
    });
  });
});
