// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";

/**
 * The reset-password page: without a recovery session the form is refused and
 * an expired-link notice explains why; with one, mismatched passwords are
 * refused locally, a matching pair updates the password, and a refusal shows
 * the server's sentence.
 */
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(async (): Promise<{ data: { user: object | null }; error: object | null }> => ({
    data: { user: {} },
    error: null,
  })),
  updateUser: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
}));

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  }),
}));

/**
 * Mounts the page and lets its mount effect settle inside `act`: the page reads
 * the recovery session in an effect, and that state update lands after the
 * mount returns.
 */
async function mountPage() {
  const ui = mountSurface(<ResetPasswordPage />, { providers: "none" });
  await act(async () => {});
  return ui;
}

async function submit(ui: MountedSurface) {
  const form = ui.container.querySelector("form");
  if (!form) throw new Error("the page rendered no form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function submitButton(ui: MountedSurface): HTMLButtonElement {
  const button = ui.container.querySelector('button[type="submit"]');
  if (!button) throw new Error("the page rendered no submit button");
  return button as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: {} }, error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanupSurfaces();
});

describe("ResetPasswordPage", () => {
  test("refuses the form and explains an expired link when there is no recovery session", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const ui = await mountPage();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Your reset link has expired") ?? false,
      { description: "the expired-link notice" },
    );
    expect(submitButton(ui).disabled).toBe(true);
  });

  test("refuses mismatched passwords without calling the server", async () => {
    const ui = await mountPage();
    await ui.waitFor(() => submitButton(ui).disabled === false, { description: "the ready form" });
    await ui.type(ui.container.querySelector("#password") as HTMLInputElement, "hunter22");
    await ui.type(ui.container.querySelector("#confirm") as HTMLInputElement, "hunter23");
    await submit(ui);
    expect(ui.container.textContent).toContain("Passwords do not match.");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  test("updates the password and confirms", async () => {
    const ui = await mountPage();
    await ui.waitFor(() => submitButton(ui).disabled === false, { description: "the ready form" });
    await ui.type(ui.container.querySelector("#password") as HTMLInputElement, "hunter22");
    await ui.type(ui.container.querySelector("#confirm") as HTMLInputElement, "hunter22");
    await submit(ui);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "hunter22" });
    await ui.waitFor(() => ui.container.textContent?.includes("Your password has been updated.") ?? false, {
      description: "the success notice",
    });
  });

  test("shows the server's sentence when the update is refused", async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: new Error("Password is too weak") });
    const ui = await mountPage();
    await ui.waitFor(() => submitButton(ui).disabled === false, { description: "the ready form" });
    await ui.type(ui.container.querySelector("#password") as HTMLInputElement, "hunter22");
    await ui.type(ui.container.querySelector("#confirm") as HTMLInputElement, "hunter22");
    await submit(ui);
    await ui.waitFor(() => ui.container.textContent?.includes("Password is too weak") ?? false, {
      description: "the refusal sentence",
    });
  });
});
