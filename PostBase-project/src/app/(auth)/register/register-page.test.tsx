// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import RegisterPage from "@/app/(auth)/register/page";

/**
 * The sign-up page, driven through its form.
 *
 * The subject this file exists for is the transition: creating an account is
 * the third moment the overlay covers, and until it was wired in this page
 * jumped straight from *accepted* to `/profile` with nothing between — the one
 * auth path where a reader was dropped onto a half-built profile with no word
 * about what was happening. So the routing assertions below are written
 * against the panel first and the destination second: the panel is up *before*
 * the route moves, it is the register one, and the route waits for it rather
 * than racing ahead of it.
 *
 * The refusal paths are here too, because a transition that shows on failure
 * would be the worse bug of the two — the panel must not appear when the
 * server says no.
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signUp: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  signInWithGoogle: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  signInWithFacebook: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  signUp: mocks.signUp,
  signInWithGoogle: mocks.signInWithGoogle,
  signInWithFacebook: mocks.signInWithFacebook,
}));

vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/** Submits the form the way the button does. */
async function submit(ui: MountedSurface) {
  const form = ui.container.querySelector("form");
  if (!form) throw new Error("the register page rendered no form");
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

/** Fills the three fields, since the page refuses to submit an empty one. */
async function fill(ui: MountedSurface) {
  const username = ui.container.querySelector("#username") as HTMLInputElement;
  const email = ui.container.querySelector("#email") as HTMLInputElement;
  const password = ui.container.querySelector("#password") as HTMLInputElement;
  await ui.type(username, "newcomer");
  await ui.type(email, "newcomer@example.com");
  await ui.type(password, "correct horse battery");
}

/** The transition panel, if the page has put one up. */
function overlay(ui: MountedSurface) {
  return ui.container.querySelector('[role="status"][aria-live="polite"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signUp.mockResolvedValue({ error: null });
  mocks.signInWithGoogle.mockResolvedValue({ error: null });
  mocks.signInWithFacebook.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
});

describe("RegisterPage", () => {
  test("shows the account-creation transition before it routes to the profile", async () => {
    vi.useFakeTimers();
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    expect(overlay(ui)).toBeNull();

    await fill(ui);
    await submit(ui);

    // The panel is up the moment the credential is accepted, and it is the
    // register one — the label is what a screen reader hears.
    const panel = overlay(ui);
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("aria-label")).toBe("Creating your account");
    // …and it has not routed yet: the destination waits for the panel.
    expect(mocks.push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.push).toHaveBeenCalledWith("/profile");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("waits the length of the transition rather than routing immediately", async () => {
    vi.useFakeTimers();
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    await fill(ui);
    await submit(ui);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(mocks.push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(mocks.push).toHaveBeenCalledWith("/profile");
  });

  test("shows the server's sentence and puts up no transition", async () => {
    mocks.signUp.mockResolvedValueOnce({ error: { message: "Email has already been registered" } });
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    await fill(ui);
    await submit(ui);

    expect(ui.container.textContent).toContain("Email has already been registered");
    expect(overlay(ui)).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test("falls back to a generic refusal when the request throws", async () => {
    mocks.signUp.mockRejectedValueOnce(new Error("offline"));
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    await fill(ui);
    await submit(ui);

    expect(ui.container.textContent).toContain("Something went wrong");
    expect(overlay(ui)).toBeNull();
  });

  test("signs up with Google", async () => {
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    await ui.click(buttonByText(ui, "Google"));
    expect(mocks.signInWithGoogle).toHaveBeenCalled();
  });

  test("signs up with Facebook", async () => {
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    await ui.click(buttonByText(ui, "Facebook"));
    expect(mocks.signInWithFacebook).toHaveBeenCalled();
  });

  test("shows the server's sentence when OAuth is refused", async () => {
    mocks.signInWithGoogle.mockResolvedValueOnce({ error: { message: "OAuth is off" } });
    const ui = mountSurface(<RegisterPage />, { providers: "none" });
    await ui.click(buttonByText(ui, "Google"));
    await ui.waitFor(() => ui.container.textContent?.includes("OAuth is off") ?? false, {
      description: "the OAuth refusal",
    });
  });
});
