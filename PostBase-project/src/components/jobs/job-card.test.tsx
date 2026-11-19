// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { JobCard } from "@/components/jobs/job-card";

/**
 * The Apply button on a job card: a signed-in reader's application flips the
 * card at once, a signed-out visitor is asked to sign in, and any other refusal
 * or a dropped request shows the server's sentence (or a generic one).
 */
const fetchMock = vi.fn();

const baseProps = {
  id: "job-1",
  title: "Designer",
  company: "Acme",
  location: "Remote",
  type: "Full-time",
  posted: "2d ago",
  description: "Design things.",
};

function applyButton(ui: MountedSurface): HTMLButtonElement {
  const button = [...ui.container.querySelectorAll("button")].find(
    (candidate) => (candidate.textContent ?? "").includes("Apply") || (candidate.textContent ?? "").includes("Applied"),
  );
  if (!button) throw new Error("no Apply button rendered");
  return button as HTMLButtonElement;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("JobCard Apply", () => {
  test("submits the application and flips the card to Applied", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    const ui = mountSurface(<JobCard {...baseProps} />, { providers: "none" });
    await ui.click(applyButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("Pending") ?? false, {
      description: "the pending status badge",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/jobs/applications",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ jobId: "job-1" }) }),
    );
    expect(applyButton(ui).textContent).toContain("Applied");
    expect(applyButton(ui).disabled).toBe(true);
  });

  test("asks a signed-out visitor to sign in", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    const ui = mountSurface(<JobCard {...baseProps} />, { providers: "none" });
    await ui.click(applyButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("Sign in to apply") ?? false, {
      description: "the sign-in prompt",
    });
    expect(applyButton(ui).textContent).toContain("Apply");
    expect(applyButton(ui).disabled).toBe(false);
    const signInLink = ui.container.querySelector('[role="alert"] a');
    expect(signInLink?.getAttribute("href")).toBe("/login");
    expect(signInLink?.textContent).toBe("Sign in");
  });

  test("shows the server's sentence when the application is refused", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Applications are closed" }), { status: 409 }));
    const ui = mountSurface(<JobCard {...baseProps} />, { providers: "none" });
    await ui.click(applyButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("Applications are closed") ?? false, {
      description: "the refusal sentence",
    });
  });

  test("shows a generic message when the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const ui = mountSurface(<JobCard {...baseProps} />, { providers: "none" });
    await ui.click(applyButton(ui));
    await ui.waitFor(() => ui.container.textContent?.includes("We couldn't submit your application") ?? false, {
      description: "the generic failure",
    });
  });
});
