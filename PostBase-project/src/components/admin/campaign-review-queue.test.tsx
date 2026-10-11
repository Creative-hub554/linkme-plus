// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { CampaignReviewQueue } from "@/components/admin/campaign-review-queue";

/**
 * The queue a platform administrator clears.
 *
 * What is pinned is the pair the PRD cares about: a campaign may be approved in
 * one press, and a refusal is not a press — it is a decision with a reason
 * attached, which is the sentence that goes back to whoever paid.
 */
const fetchMock = vi.fn();

const QUEUED = {
  id: "33333333-3333-4333-8333-333333333333",
  budget: 50,
  goal: "reach",
  excerpt: "Opening night is Thursday.",
  pageName: "Northside Studio",
  pageUsername: "northside",
  advertiser: "theo",
  startDate: "2026-10-10T00:00:00.000Z",
  endDate: "2026-10-17T00:00:00.000Z",
};

function json(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
}

function stub(campaigns: unknown[]) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return json({ campaign: { id: QUEUED.id, status: "rejected" } });
    return json({ campaigns });
  });
}

async function loadedWith(ui: MountedSurface, text: string) {
  await ui.waitFor(() => ui.container.textContent?.includes(text) === true, {
    description: `the queue to show "${text}"`,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("CampaignReviewQueue", () => {
  test("says the queue is empty rather than rendering nothing", async () => {
    stub([]);
    const ui = mountSurface(<CampaignReviewQueue />, { providers: "none" });
    await loadedWith(ui, "No campaigns are waiting");

    expect(ui.container.querySelectorAll("button").length).toBe(0);
  });

  test("shows who booked what, and offers the two decisions", async () => {
    stub([QUEUED]);
    const ui = mountSurface(<CampaignReviewQueue />, { providers: "none" });
    await loadedWith(ui, "Opening night is Thursday.");

    const text = ui.container.textContent ?? "";
    expect(text).toContain("Northside Studio");
    expect(text).toContain("@northside");
    expect(text).toContain("@theo");
    expect(text).toContain("budget 50");

    const labels = [...ui.container.querySelectorAll("button")].map((button) => button.textContent?.trim());
    expect(labels).toContain("Approve");
    expect(labels).toContain("Reject");
    // Approving needs no words; refusing does, and there is nowhere to write
    // them until the decision is pressed.
    expect(ui.container.querySelector('input[id^="reject-"]')).toBeNull();
  });

  test("makes a refusal carry a reason back to the route", async () => {
    stub([QUEUED]);
    const ui = mountSurface(<CampaignReviewQueue />, { providers: "none" });
    await loadedWith(ui, "Opening night is Thursday.");

    await ui.click([...ui.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reject")!);
    const field = ui.container.querySelector<HTMLInputElement>('input[id^="reject-"]')!;
    await ui.type(field, "Misleading price");

    await ui.click(
      [...ui.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Confirm rejection")!,
    );
    await ui.waitFor(() => fetchMock.mock.calls.some(([, init]) => String((init as RequestInit)?.body ?? "").includes("Misleading price")), {
      description: "the rejection to be sent with its reason",
    });
  });
});
