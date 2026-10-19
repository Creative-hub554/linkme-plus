// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { AdminModeration } from "@/components/admin/admin-moderation";

/**
 * The moderation queue's hands, driven by the pending side of
 * `GET /api/admin/reports` and the existing `POST /api/admin/moderate`.
 *
 * Pinned here is what the dashboard offers on each report kind: a content
 * report is offered warnings and removals, an account report is offered
 * suspensions and bans, and — the part the route leaves to the presser —
 * *no* decision goes out without a reason, because the route accepts an
 * unexplained one and the board refuses to send it. A decision reloads the
 * queue, so a pressed report does not linger in a list that says pending.
 */
const fetchMock = vi.fn();

const CONTENT_REPORT = {
  id: "11111111-1111-4111-8111-111111111111",
  reporterId: "user-1",
  targetType: "post",
  targetId: "22222222-2222-4222-8222-222222222222",
  reason: "Spam",
  description: "Posting crypto scams",
  status: "pending",
  createdAt: "2026-10-16T09:00:00.000Z",
  targetContent: "Double your coins in 24 hours, link in bio, three more words to clamp.",
  targetAuthor: "@spammer",
};
const ACCOUNT_REPORT = {
  ...CONTENT_REPORT,
  id: "33333333-3333-4333-8333-333333333333",
  targetType: "user",
  targetId: "44444444-4444-4444-8444-444444444444",
  reason: "Harassment",
  targetContent: null,
  targetAuthor: "@harasser",
};

function json(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 400, headers: { "content-type": "application/json" } });
}

function stubDefault() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      return json({ action: { id: "action-1" } });
    }
    const query = new URL(String(input), "http://localhost").searchParams;
    expect(query.get("status")).toBe("pending");
    return json({ data: [CONTENT_REPORT, ACCOUNT_REPORT], pagination: { total: 2, page: 1, limit: 20, totalPages: 1, hasMore: false } });
  });
}

async function loadedWith(ui: MountedSurface, text: string) {
  await ui.waitFor(() => ui.container.textContent?.includes(text) === true, {
    description: `the queue to show "${text}"`,
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
  stubDefault();
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

describe("AdminModeration", () => {
  test("splits the pending queue by what is reported, with the actions each kind earns", async () => {
    const ui = mountSurface(<AdminModeration />, { providers: "none" });
    await loadedWith(ui, "Posting crypto scams");

    const text = ui.container.textContent ?? "";
    expect(text).toContain("Reported content — posts and comments");
    expect(text).toContain("Reported accounts");
    // The content row's pair, and the account row's pair.
    expect(buttonWith(ui, "Warn")).toBeTruthy();
    expect(buttonWith(ui, "Remove content")).toBeTruthy();
    expect(buttonWith(ui, "Suspend")).toBeTruthy();
    expect(buttonWith(ui, "Ban")).toBeTruthy();
  });

  test("shows what was reported and who wrote it, on every row", async () => {
    const ui = mountSurface(<AdminModeration />, { providers: "none" });
    await loadedWith(ui, "Posting crypto scams");

    const text = ui.container.textContent ?? "";
    // The post's words are on the row — the excerpt the admin judges — with
    // its author's handle beside it.
    expect(text).toContain("Double your coins in 24 hours");
    expect(text).toContain("@spammer");
    // The account row names the reported account itself.
    expect(text).toContain("@harasser");
  });

  test("a content row without the target's words says so rather than showing silence", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return json({ action: { id: "action-1" } });
      return json({
        data: [{ ...CONTENT_REPORT, targetContent: null, targetAuthor: null }],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false },
      });
    });

    const ui = mountSurface(<AdminModeration />, { providers: "none" });
    await loadedWith(ui, "Posting crypto scams");

    expect(ui.container.textContent).toContain("The reported content is no longer available to show.");
    // The warned action is still offered: a deleted post is not an unresolved
    // reason to skip the decision.
    expect(buttonWith(ui, "Warn")).toBeTruthy();
    expect(buttonWith(ui, "Remove content")).toBeTruthy();
  });

  test("every decision waits for a reason before it is sent", async () => {
    const ui = mountSurface(<AdminModeration />, { providers: "none" });
    await loadedWith(ui, "Posting crypto scams");

    // Pressing Warn opens the reason, which starts empty: the stale sentence
    // of a previous row must not ride along to this one.
    await ui.click(buttonWith(ui, "Warn"));
    const field = ui.container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(field.value).toBe("");
    expect(buttonWith(ui, "Record decision").hasAttribute("disabled")).toBe(true);

    await ui.type(field, "Spam campaign, third report for this account");
    await ui.click(buttonWith(ui, "Record decision"));

    await ui.waitFor(
      () => fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST"),
      { description: "the decision to be sent" },
    );
    const sent = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST")?.[1]!.body));
    expect(sent).toEqual({
      reportId: CONTENT_REPORT.id,
      action: "warning",
      reason: "Spam campaign, third report for this account",
    });
  });

  test("the first offered action is the one the confirmation records", async () => {
    const ui = mountSurface(<AdminModeration />, { providers: "none" });
    await loadedWith(ui, "Harassment");

    // Opening the account row's suspending flow and confirming sends a
    // suspension for the account report, not content actions for it.
    const banSection = [...ui.container.querySelectorAll("section")].find((section) =>
      section.textContent?.includes("Reported accounts"),
    )!;
    const suspendButton = [...banSection.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Suspend",
    )!;
    await ui.click(suspendButton);
    await ui.type(banSection.querySelector("textarea")!, "Reported for harassment");
    await ui.click([...banSection.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Record decision")!);

    await ui.waitFor(
      () => fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST"),
      { description: "the suspension to be sent" },
    );
    const sent = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST")?.[1]!.body));
    expect(sent.reportId).toBe(ACCOUNT_REPORT.id);
    expect(sent.action).toBe("suspension");
  });
});
