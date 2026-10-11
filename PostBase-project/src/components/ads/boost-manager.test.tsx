// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { BoostManager } from "@/components/ads/boost-manager";

/**
 * The Page administrator's whole relationship with a boost, driven as they
 * drive it.
 *
 * The case that would catch the most: the buttons on a campaign row are read
 * off the ladder the route enforces, so a running campaign offers Pause and
 * Cancel and *not* Approve — the control an advertiser must never be given is
 * absent because the table says so, not because a list was typed by hand.
 */
const fetchMock = vi.fn();

const CAMPAIGN = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "active",
  postId: "11111111-1111-4111-8111-111111111111",
  excerpt: "Opening night.",
  goal: "reach",
  budget: 50,
  spent: 5,
  impressions: 1000,
  clicks: 20,
  startDate: "2026-10-10T00:00:00.000Z",
  endDate: "2026-10-17T00:00:00.000Z",
};

function json(body: unknown, ok = true, status = ok ? 200 : 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(campaigns: unknown[] = [CAMPAIGN], posts: unknown[] = [{ id: CAMPAIGN.postId, content: "Opening night." }]) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/boosts")) return json({ campaigns });
    if (url.startsWith("/api/posts/boost")) return json({ campaign: { id: "new-campaign", status: "pending_payment" } }, true, 201);
    if (url.startsWith("/api/posts")) return json({ data: posts });
    return json({ error: "not found" }, false, 404);
  });
}

async function settled(ui: MountedSurface) {
  await ui.waitFor(() => ui.container.textContent?.includes("Opening night.") === true, {
    description: "the campaign list to load",
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

describe("BoostManager", () => {
  test("reports a campaign the way the PRD asks to be told about it", async () => {
    stub();
    const ui = mountSurface(<BoostManager pageId="page-1" />, { providers: "none" });
    await settled(ui);

    const text = ui.container.textContent ?? "";
    expect(text).toContain("Opening night.");
    expect(text).toContain("Running");
    expect(text).toContain("1,000 impressions");
    expect(text).toContain("20 clicks");
    expect(text).toContain("5 of 50");
  });

  test("offers only the actions a running campaign may be given", async () => {
    stub();
    const ui = mountSurface(<BoostManager pageId="page-1" />, { providers: "none" });
    await settled(ui);

    const labels = [...ui.container.querySelectorAll("button")].map((button) => button.textContent?.trim());
    expect(labels).toContain("Pause");
    expect(labels).toContain("Cancel");
    // Approval is the platform's own step, and this list cannot offer it.
    expect(labels).not.toContain("Approve");
    expect(labels).not.toContain("Authorise payment");
  });

  test("books a boost, then asks for the authorisation that queues it", async () => {
    stub([], [{ id: "post-9", content: "Late opening." }]);
    const ui = mountSurface(<BoostManager pageId="page-1" />, { providers: "none" });
    await ui.waitFor(() => ui.container.textContent?.includes("No boosts yet") === true, {
      description: "the empty campaign list",
    });

    const opener = [...ui.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Boost a post"),
    ) as HTMLElement;
    await ui.click(opener);

    // The dialog is portalled out of the mount container — the same reason the
    // audit searches the whole document — so the form is read from there, and
    // the posts it offers are fetched as it opens rather than on mount.
    await ui.waitFor(() => document.querySelector("#boost-post") !== null, {
      description: "the booking dialog to open",
    });
    await ui.waitFor(() => document.querySelector('#boost-post option[value="post-9"]') !== null, {
      description: "the Page's posts to arrive",
    });

    // Chosen the way a reader chooses it — a `change` on the select, not a
    // value assignment, which React would discard as unheard.
    await act(async () => {
      const select = document.querySelector<HTMLSelectElement>("#boost-post")!;
      select.value = "post-9";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const submit = document.querySelector('button[type="submit"]') as HTMLElement;
    await ui.click(submit);

    await ui.waitFor(() => document.body.textContent?.includes("Authorise this boost") === true, {
      description: "the dialog to move to its payment step",
    });

    const booked = fetchMock.mock.calls.map(([input, init]) => [String(input), String((init as RequestInit)?.body ?? "")]);
    expect(booked.some(([url, body]) => url === "/api/posts/boost" && body.includes("post-9"))).toBe(true);
  });
});
