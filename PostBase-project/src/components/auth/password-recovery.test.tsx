// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/utils/supabase/client", () => ({ createClient: () => ({ auth }) }));
import { PasswordRecovery } from "./password-recovery";
beforeEach(() => {
  vi.resetAllMocks();
  auth.getUser.mockResolvedValue({
    data: { user: { id: "member" } },
    error: null,
  });
});
afterEach(() => {
  cleanupSurfaces();
});
test("requests a reset link through the existing callback and confirms without exposing account existence", async () => {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  const ui = mountSurface(<PasswordRecovery />);
  (ui.container.querySelector("#email") as HTMLInputElement).value =
    "ada@example.com";
  await act(async () => {
    ui.container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ada@example.com", {
    redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
  });
  expect(ui.container.textContent).toContain("If an account exists");
});
test("rejects mismatching passwords without changing the account", async () => {
  const ui = mountSurface(<PasswordRecovery reset />);
  await ui.waitFor(
    () =>
      !(
        ui.container.querySelector('button[type="submit"]') as HTMLButtonElement
      ).disabled,
  );
  (ui.container.querySelector("#password") as HTMLInputElement).value =
    "new-password";
  (ui.container.querySelector("#confirm") as HTMLInputElement).value =
    "different-password";
  await act(async () => {
    ui.container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(ui.container.textContent).toContain("Passwords do not match");
});
test("an expired reset link cannot submit a password", async () => {
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const ui = mountSurface(<PasswordRecovery reset />);
  await ui.waitFor(() =>
    Boolean(ui.container.textContent?.includes("expired")),
  );
  expect(
    (ui.container.querySelector('button[type="submit"]') as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
