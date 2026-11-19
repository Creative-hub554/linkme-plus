// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
const mocks = vi.hoisted(() => ({
  push: vi.fn(), refresh: vi.fn(),
  signUp: vi.fn(), google: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/auth-client", () => ({ signUp: mocks.signUp, signInWithGoogle: mocks.google }));
vi.mock("@/components/auth/auth-shell", () => ({ AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import RegisterPage from "./page";
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => {
  cleanupSurfaces();
});
async function submitRegistration() {
  const ui = mountSurface(<RegisterPage />, { providers: "none" });
  await ui.type(ui.container.querySelector("#username") as HTMLInputElement, "new_member");
  await ui.type(ui.container.querySelector("#email") as HTMLInputElement, "member@example.com");
  await ui.type(ui.container.querySelector("#password") as HTMLInputElement, "test-password-only");
  await act(async () => { ui.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  return ui;
}
test("email signup waits for confirmation instead of entering a protected page", async () => {
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  const ui = await submitRegistration();
  expect(ui.container.textContent).toContain("Check your email");
  expect(ui.container.querySelector('[role="status"]')?.textContent).toContain("member@example.com");
  expect(ui.container.querySelector('a[href="/login"]')).not.toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
});
test("an immediate valid session proceeds to the profile", async () => {
  mocks.signUp.mockResolvedValue({ data: { session: { user: { id: "new-user" } } }, error: null });
  await submitRegistration();
  expect(mocks.push).toHaveBeenCalledWith("/profile");
});
test("a refused signup stays on the form and shows its error", async () => {
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: { message: "Unable to send confirmation email" } });
  const ui = await submitRegistration();
  expect(ui.container.querySelector('[role="alert"]')?.textContent).toContain("Unable to send confirmation email");
  expect(mocks.push).not.toHaveBeenCalled();
  expect(ui.container.textContent).not.toContain("Facebook");
  expect(ui.container.textContent).not.toContain("Telegram");
});
