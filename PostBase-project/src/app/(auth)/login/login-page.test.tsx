// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import LoginPage from "@/app/(auth)/login/page";

/**
 * The sign-in page, driven through its form.
 *
 * Four paths reach four different places: a password sign-in that lands on the
 * feed, the same sign-in when the account has a verified second factor (which
 * shows the challenge instead), a refusal (which shows the server's sentence),
 * and the OAuth buttons. The challenge is stubbed because it is a separate
 * component with its own requests — this is a test of the page's routing between
 * its states, and the stub's buttons are how the page's own `onVerified`/`onBack`
 * handlers are reached.
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  // Return types are named so a test can answer with a refusal (`error`) or a
  // challenge factor without the factory pinning the shape to `null`/`never`.
  signInEmail: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  signInSocial: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  getAssurance: vi.fn(
    async (): Promise<{ data: { nextLevel: string; currentLevel: string } }> => ({
      data: { nextLevel: "aal1", currentLevel: "aal1" },
    }),
  ),
  listFactors: vi.fn(
    async (): Promise<{ data: { totp: Array<{ id: string; status: string }> } }> => ({
      data: { totp: [] },
    }),
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  signIn: { email: mocks.signInEmail, social: mocks.signInSocial },
}));

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.getAssurance,
        listFactors: mocks.listFactors,
      },
    },
  }),
}));

vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/auth/login-live-visual", () => ({
  LoginLiveVisual: () => <div aria-hidden="true" />,
}));

vi.mock("@/components/auth/authenticator-challenge", () => ({
  AuthenticatorChallenge: ({
    factorId,
    onVerified,
    onBack,
  }: {
    factorId: string;
    onVerified: () => void;
    onBack: () => void;
  }) => (
    <div>
      <p>Challenge {factorId}</p>
      <button type="button" onClick={onVerified}>
        Verify
      </button>
      <button type="button" onClick={onBack}>
        Back
      </button>
    </div>
  ),
}));

/** Submits the form the way the button does. */
async function submit(ui: MountedSurface) {
  const form = ui.container.querySelector("form");
  if (!form) throw new Error("the login page rendered no form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function buttonByText(ui: MountedSurface, text: string): HTMLElement {
  const button = [...ui.container.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes(text),
  );
  if (!button) throw new Error(`no button labelled ${text}`);
  return button as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAssurance.mockResolvedValue({ data: { nextLevel: "aal1", currentLevel: "aal1" } });
  mocks.listFactors.mockResolvedValue({ data: { totp: [] } });
  mocks.signInEmail.mockResolvedValue({ error: null });
  mocks.signInSocial.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
});

describe("LoginPage", () => {
  test("signs in with a password and forwards to the feed", async () => {
    vi.useFakeTimers();
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    const email = ui.container.querySelector("#email") as HTMLInputElement;
    const password = ui.container.querySelector("#password") as HTMLInputElement;
    await ui.type(email, "theo@example.com");
    await ui.type(password, "hunter2");
    await submit(ui);
    expect(mocks.signInEmail).toHaveBeenCalledWith("theo@example.com", "hunter2");
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.push).toHaveBeenCalledWith("/feed");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("shows the server's sentence when the password is refused", async () => {
    mocks.signInEmail.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    expect(ui.container.textContent).toContain("Invalid login credentials");
  });

  test("falls back to a generic refusal message", async () => {
    mocks.signInEmail.mockResolvedValueOnce({ error: { message: "" } });
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    expect(ui.container.textContent).toContain("Invalid email or password");
  });

  test("shows a generic failure when the request itself throws", async () => {
    mocks.signInEmail.mockRejectedValueOnce(new Error("offline"));
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    expect(ui.container.textContent).toContain("Something went wrong");
  });

  test("shows the second-factor challenge when the account has a verified one", async () => {
    mocks.getAssurance.mockResolvedValueOnce({ data: { nextLevel: "aal2", currentLevel: "aal1" } });
    mocks.listFactors.mockResolvedValueOnce({
      data: { totp: [{ id: "factor-1", status: "verified" }] },
    });
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    await ui.waitFor(() => ui.container.textContent?.includes("Challenge factor-1") ?? false, {
      description: "the authenticator challenge",
    });
    // Going back returns to the password form.
    await ui.click(buttonByText(ui, "Back"));
    expect(ui.container.textContent).toContain("Or continue with email");
  });

  test("goes to the feed from the challenge", async () => {
    vi.useFakeTimers();
    mocks.getAssurance.mockResolvedValueOnce({ data: { nextLevel: "aal2", currentLevel: "aal1" } });
    mocks.listFactors.mockResolvedValueOnce({ data: { totp: [{ id: "factor-1", status: "verified" }] } });
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    await ui.waitFor(() => ui.container.textContent?.includes("Challenge factor-1") ?? false, {
      description: "the authenticator challenge",
    });
    await ui.click(buttonByText(ui, "Verify"));
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.push).toHaveBeenCalledWith("/feed");
  });

  test("skips the challenge when no verified factor exists", async () => {
    vi.useFakeTimers();
    mocks.getAssurance.mockResolvedValueOnce({ data: { nextLevel: "aal2", currentLevel: "aal1" } });
    mocks.listFactors.mockResolvedValueOnce({ data: { totp: [{ id: "factor-1", status: "unverified" }] } });
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.push).toHaveBeenCalledWith("/feed");
  });

  test("does not challenge a reader already at the required level", async () => {
    vi.useFakeTimers();
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await submit(ui);
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/feed");
  });

  test("starts a Google sign-in", async () => {
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await ui.click(buttonByText(ui, "Google"));
    expect(mocks.signInSocial).toHaveBeenCalledWith("google");
  });

  test("shows the server's sentence when OAuth is refused", async () => {
    mocks.signInSocial.mockResolvedValueOnce({ error: { message: "OAuth is off" } });
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await ui.click(buttonByText(ui, "Facebook"));
    expect(mocks.signInSocial).toHaveBeenCalledWith("facebook");
    await ui.waitFor(() => ui.container.textContent?.includes("OAuth is off") ?? false, {
      description: "the OAuth refusal",
    });
  });

  test("falls back to a generic message when OAuth throws", async () => {
    mocks.signInSocial.mockRejectedValueOnce(new Error("offline"));
    const ui = mountSurface(<LoginPage />, { providers: "none" });
    await ui.click(buttonByText(ui, "Google"));
    await ui.waitFor(() => ui.container.textContent?.includes("Something went wrong") ?? false, {
      description: "the generic OAuth failure",
    });
  });
});
