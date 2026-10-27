// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";

/**
 * The forgot-password page: a sent link shows the neutral confirmation, a
 * refusal from Supabase shows its sentence, and a dropped request shows the
 * error it carried.
 */
const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
}));

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  }),
}));

async function submit(ui: MountedSurface) {
  const form = ui.container.querySelector("form");
  if (!form) throw new Error("the page rendered no form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanupSurfaces();
});

describe("ForgotPasswordPage", () => {
  test("sends the reset link and confirms without revealing the account", async () => {
    const ui = mountSurface(<ForgotPasswordPage />, { providers: "none" });
    const email = ui.container.querySelector("#email") as HTMLInputElement;
    await ui.type(email, "theo@example.com");
    await submit(ui);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "theo@example.com",
      expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback?next=/reset-password") }),
    );
    await ui.waitFor(
      () => ui.container.textContent?.includes("you will receive a password reset link") ?? false,
      { description: "the neutral confirmation" },
    );
  });

  test("shows the server's sentence when the reset is refused", async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error("Rate limit exceeded") });
    const ui = mountSurface(<ForgotPasswordPage />, { providers: "none" });
    await submit(ui);
    await ui.waitFor(() => ui.container.textContent?.includes("Rate limit exceeded") ?? false, {
      description: "the refusal sentence",
    });
  });

  test("shows the failure the request carried", async () => {
    mocks.resetPasswordForEmail.mockRejectedValueOnce(new Error("offline"));
    const ui = mountSurface(<ForgotPasswordPage />, { providers: "none" });
    await submit(ui);
    await ui.waitFor(() => ui.container.textContent?.includes("offline") ?? false, {
      description: "the dropped request's message",
    });
  });
});
