// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { AdminVerificationRequests } from "./admin-verification-requests";

const fetchMock = vi.fn();
const row = {
  id: "44444444-4444-4444-8444-444444444444",
  username: "maya",
  displayName: "Maya Chen",
  evidenceUrls: ["https://public.example/about"],
  createdAt: "2026-10-15T12:00:00.000Z",
};
function response(data: unknown[]) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") return response([]);
    return response(row.id ? [row] : []);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanupSurfaces(); vi.unstubAllGlobals(); });

describe("AdminVerificationRequests", () => {
  test("shows the request and sends the reviewer decision", async () => {
    const ui = mountSurface(<AdminVerificationRequests />, { providers: "none" });
    await ui.waitFor(() => ui.container.textContent?.includes("Maya Chen") === true, { description: "verification request" });
    expect(ui.container.querySelector('a[href="https://public.example/about"]')).not.toBeNull();
    const approve = [...ui.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Approve verification");
    if (!approve) throw new Error("No approve control was rendered");
    await ui.click(approve);
    await ui.waitFor(() => fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH"), { description: "approval request" });
    const [, init] = fetchMock.mock.calls.find(([, options]) => (options as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ requestId: row.id, decision: "approved" });
  });
});
