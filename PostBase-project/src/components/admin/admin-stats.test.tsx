// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { AdminStats } from "@/components/admin/admin-stats";

/**
 * The dashboard's heading row, driven by `GET /api/admin/stats`.
 *
 * What is pinned is the difference between a card that computes and a card
 * that invents: real numbers reach the cards, a failure never masquerades as a
 * zero (a dash plus an alert says so), and the line under each number is the
 * stat's definition rather than a delta nobody computed. This is the fixture
 * that would have caught the invented "12,456 members".
 */
const fetchMock = vi.fn();

const STATS = {
  stats: {
    totalUsers: 3,
    activePosts: 9,
    pendingReports: 2,
    adRevenue: 500,
  },
};

function json(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });
}

async function loadedWith(ui: MountedSurface, text: string) {
  await ui.waitFor(() => ui.container.textContent?.includes(text) === true, {
    description: `the stats to show "${text}"`,
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

describe("AdminStats", () => {
  test("renders the counts the route computed, with what each one means", async () => {
    fetchMock.mockResolvedValue(json(STATS));
    const ui = mountSurface(<AdminStats />, { providers: "none" });
    // Wait on the *number*, not the label: the cards draw their labels and
    // definitions immediately, so a label-hung wait would judge the loading
    // state and find every expected string but the ones that count.
    await loadedWith(ui, "$500");

    const text = ui.container.textContent ?? "";
    expect(text).toContain("Total Users");
    expect(text).toContain("Active Posts");
    expect(text).toContain("Reports Pending");
    expect(text).toContain("Revenue");
    // The numbers themselves, formatted; and no invented delta beside them.
    expect(text).toContain("3");
    expect(text).toContain("9");
    expect(text).toContain("2");
    expect(text).toContain("$500");
    expect(text).toContain("reports awaiting a decision");
    expect(text).toContain("ad spend delivered on approved campaigns");

    // The single endpoint the heading row depends on, asked once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/admin/stats");
  });

  test("answers a route failure with an alert, never with a fake zero", async () => {
    fetchMock.mockResolvedValue(json({}, false));
    const ui = mountSurface(<AdminStats />, { providers: "none" });

    await ui.waitFor(() => ui.container.querySelector('[role="alert"]') !== null, {
      description: "the failure alert to appear",
    });

    const text = ui.container.textContent ?? "";
    expect(text).toContain("could not be loaded");
    expect(text).toContain("—");
    // No card asserts a made-up figure in the failure state.
    expect(text).not.toContain("$");
  });
});
