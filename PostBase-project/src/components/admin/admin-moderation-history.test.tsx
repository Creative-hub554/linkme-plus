// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { AdminModerationHistory } from "@/components/admin/admin-moderation-history";

/**
 * The record, rendered.
 *
 * What is pinned is the sentence the ledger reads as: what was done, to
 * what, by whom, why, and when — and honestly when a reason was never
 * given. The empty ledger says so rather than rendering silence.
 */
const fetchMock = vi.fn();

const BAN = {
  id: "11111111-1111-4111-8111-111111111111",
  action: "ban",
  targetType: "user",
  targetId: "44444444-4444-4444-8444-444444444444",
  reason: "Ran a coordinated spam network",
  createdAt: "2026-10-16T09:30:00.000Z",
  actorUsername: "mod-kev",
};
const WARNING = { ...BAN, id: "22222222-2222-4222-8222-222222222222", action: "warning", targetType: "post", actorUsername: "admin-1" };
const UNEXPLAINED = { ...BAN, id: "33333333-3333-4333-8333-333333333333", action: "removal", targetType: "comment", reason: null };

function json(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 400, headers: { "content-type": "application/json" } });
}

function stub(rows: unknown[], pagination = { total: rows.length, page: 1, limit: 20, totalPages: 1, hasMore: false }) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const query = new URL(String(input), "http://localhost").searchParams;
    expect(query.get("page")).toBe("1");
    expect(query.get("limit")).toBe("20");
    return json({ data: rows, pagination });
  });
}

async function loadedWith(ui: MountedSurface, text: string) {
  await ui.waitFor(() => ui.container.textContent?.includes(text) === true, {
    description: `the history to show "${text}"`,
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

describe("AdminModerationHistory", () => {
  test("the empty ledger says so rather than rendering nothing", async () => {
    stub([]);
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "No moderation actions recorded yet.");

    expect(ui.container.querySelectorAll("button").length).toBe(0);
  });

  test("each recorded action names what, whom, who made it, and when", async () => {
    stub([BAN]);
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "Banned");

    const text = ui.container.textContent ?? "";
    expect(text).toContain("Banned");
    expect(text).toContain("the user");
    expect(text).toContain("@mod-kev");
    expect(text).toContain("Reason: Ran a coordinated spam network");
    expect(text).toContain(new Date(BAN.createdAt).toLocaleString());
  });

  test("a decision taken without a reason is listed as unexplained, not skipped", async () => {
    stub([UNEXPLAINED]);
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "Removed content");

    expect(ui.container.textContent).toContain("No reason was recorded for this action.");
  });

  test("offers the record as a downloadable CSV handover, without script", async () => {
    stub([BAN]);
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "Export CSV");

    const link = [...ui.container.querySelectorAll("a")].find((a) =>
      a.getAttribute("href")?.includes("/api/admin/moderation-actions/export"),
    );
    expect(link, "an anchor to the export route").toBeTruthy();
    // The server builds the file: a plain link the cookie can ride on, not a
    // client-side assembly, and the label names how much is being handed over.
    expect(link?.tagName).toBe("A");
    expect(link?.textContent).toContain("Export CSV (1 recorded)");
  });

  test("an empty record offers nothing to export and no link either", async () => {
    stub([]);
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "No moderation actions recorded yet.");

    expect([...ui.container.querySelectorAll("a")].some((a) => a.getAttribute("href")?.includes("export"))).toBe(false);
    expect(ui.container.textContent).not.toContain("Export CSV");
  });

  test("pages through the record, stopping at the end of it", async () => {
    // Page 1 of a two-page record, then the last page the Next press loads.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input), "http://localhost").searchParams.get("page") ?? 1);
      return json({
        data: page === 1 ? [WARNING] : [BAN],
        pagination: { total: 11, page, limit: 10, totalPages: 2, hasMore: page === 1 },
      });
    });
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "Warned");
    expect(ui.container.textContent).toContain("Page 1 of 2 · 11 recorded");

    const next = [...ui.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Next");
    expect(next?.hasAttribute("disabled")).toBe(false);
    await ui.click(next!);
    await loadedWith(ui, "Banned");

    expect(ui.container.textContent).toContain("Page 2 of 2 · 11 recorded");
    // The record is over: nothing forwards past the last page.
    const nextAgain = [...ui.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Next");
    expect(nextAgain?.hasAttribute("disabled")).toBe(true);
  });

  test("a failed load tells the reader instead of vanishing", async () => {
    fetchMock.mockImplementation(async () => json({ error: "boom" }, false));
    const ui = mountSurface(<AdminModerationHistory />, { providers: "none" });
    await loadedWith(ui, "The moderation history could not be loaded");

    expect(ui.container.querySelector('[role="alert"]')).toBeTruthy();
  });
});
