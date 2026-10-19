// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { AdminReports } from "@/components/admin/admin-reports";

/**
 * The reports board, driven by `GET /api/admin/reports`.
 *
 * Pinned here is the contract the board reads with: the status filter narrows
 * the request and resets the page, the rows are exactly what the route sends
 * (with the status spelled out for a screen reader, since the glyph and colour
 * cannot carry it), and pagination moves only when the envelope says there is
 * another page. The `Review` button of the invented list is gone — a control
 * that decides nothing is not offered.
 */
const fetchMock = vi.fn();

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  reporterId: "user-1",
  targetType: "post",
  targetId: "22222222-2222-4222-8222-222222222222",
  reason: "Spam",
  description: "Posting crypto scams",
  status: "pending",
  createdAt: "2026-10-13T09:00:00.000Z",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function queueEnvelope(rows: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return json({
    data: rows,
    pagination: { total: rows.length, page: 1, limit: 20, totalPages: 1, hasMore: false, ...overrides },
  });
}

function stubByQuery() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const query = new URL(String(input), "http://localhost").searchParams;
    if (query.get("status") === "resolved") return queueEnvelope([{ ...ROW, id: "resolved-1", status: "resolved" }]);
    if (query.get("page") === "2") return queueEnvelope([{ ...ROW, id: "page-2" }]);
    return queueEnvelope([ROW]);
  });
}

async function loadedWith(ui: MountedSurface, text: string) {
  await ui.waitFor(() => ui.container.textContent?.includes(text) === true, {
    description: `the board to show "${text}"`,
  });
}

function buttonWith(ui: MountedSurface, text: string) {
  const button = [...ui.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`no button reading "${text}"`);
  return button;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  stubByQuery();
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("AdminReports", () => {
  test("renders the queue the route sent, with the status read aloud", async () => {
    const ui = mountSurface(<AdminReports />, { providers: "none" });
    await loadedWith(ui, "Spam");

    const text = ui.container.textContent ?? "";
    expect(text).toContain("Spam");
    expect(text).toContain("Posting crypto scams");
    expect(text).toContain("post");
    // The glyph and colour cannot carry the status to a screen reader; the
    // spelled-out line is what each state announces.
    expect(ui.container.textContent).toContain("Status: pending");
    expect(text).toContain("Page 1 of 1");
  });

  test("picking a filter narrows the request and restarts the paging", async () => {
    const ui = mountSurface(<AdminReports />, { providers: "none" });
    await loadedWith(ui, "Spam");

    await ui.click(buttonWith(ui, "Resolved"));
    await loadedWith(ui, "resolved");

    const url = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(url).toContain("status=resolved");
    expect(url).toContain("page=1");
  });

  test("pagination moves only where the envelope says there is more", async () => {
    // Mount with the envelope that already promises a second page: the board
    // renders the envelope it *received*, so a mock swapped in after loading
    // would leave the first envelope's `hasMore: false` in charge and Next
    // would sit disabled no matter what the future fetch returned.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const query = new URL(String(input), "http://localhost").searchParams;
      if (query.get("page") !== "2") {
        return json({
          data: [ROW],
          pagination: { total: 40, page: 1, limit: 20, totalPages: 2, hasMore: true },
        });
      }
      return queueEnvelope([{ ...ROW, id: "page-2", reason: "Harassment" }]);
    });
    const ui = mountSurface(<AdminReports />, { providers: "none" });
    await loadedWith(ui, "Spam");

    const next = buttonWith(ui, "Next");
    expect(next.hasAttribute("disabled")).toBe(false);

    await ui.click(next);
    await loadedWith(ui, "Harassment");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("page=2");
  });
});
