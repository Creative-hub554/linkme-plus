// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { VerificationApplication } from "./verification-application";

const fetchMock = vi.fn();
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function button(ui: MountedSurface, text: string) {
  const found = [...ui.container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanupSurfaces(); vi.unstubAllGlobals(); });

describe("VerificationApplication", () => {
  test("submits public profile links and reflects pending review status", async () => {
    let submitted: unknown;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return json({ request: { status: "pending" } }, 201);
      }
      return submitted
        ? json({ verified: false, request: { status: "pending", evidenceUrls: ["https://public.example/about"], reviewNote: null } })
        : json({ verified: false, request: null });
    });
    const ui = mountSurface(<VerificationApplication />, { providers: "none" });
    await ui.waitFor(() => ui.container.querySelector('input[aria-label="Public verification link 1"]') !== null, { description: "verification application form" });
    await ui.type(ui.container.querySelector('input[aria-label="Public verification link 1"]') as HTMLInputElement, "https://public.example/about");
    await ui.click(button(ui, "Submit for review"));
    await ui.waitFor(() => ui.container.textContent?.includes("under review") === true, { description: "pending application" });
    expect(submitted).toEqual({ evidenceUrls: ["https://public.example/about"] });
    expect(ui.container.textContent).toContain("https://public.example/about");
  });

  test("shows the verified state instead of the application form", async () => {
    fetchMock.mockResolvedValue(json({ verified: true, request: null }));
    const ui = mountSurface(<VerificationApplication />, { providers: "none" });
    await ui.waitFor(() => ui.container.textContent?.includes("Your account is verified.") === true, { description: "verified account state" });
    expect(ui.container.querySelector("form")).toBeNull();
  });
});
