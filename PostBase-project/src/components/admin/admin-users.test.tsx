// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { AdminUsers } from "@/components/admin/admin-users";

/**
 * The member list behind the Users tab, driven by `/api/admin/roles`.
 *
 * Pinned here is what the dashboard offers, exactly matching what the route's
 * ladder allows: a member row offers promote, a moderator row offers demote,
 * an admin row offers nothing — its badge says what it is and the absence of
 * buttons says the owner console owns that role. The search narrows the
 * request rather than the DOM, so what it finds is what the route answered.
 */
const fetchMock = vi.fn();

const MEMBER = {
  id: "44444444-4444-4444-8444-444444444444",
  username: "maya_designs",
  email: "maya@example.com",
  role: "member",
  createdAt: "2026-10-13T09:00:00.000Z",
};
const MODERATOR = { ...MEMBER, id: "55555555-5555-4555-8555-555555555555", username: "sam", role: "moderator" };
const ADMIN = { ...MEMBER, id: "66666666-6666-4666-8666-666666666666", username: "theowumicrosoft", role: "admin" };

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function envelope(rows: Record<string, unknown>[]) {
  return json({
    data: rows,
    pagination: { total: rows.length, page: 1, limit: 20, totalPages: 1, hasMore: false },
  });
}

function stubDefault() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body)) as { action: string };
      return json({ user: { id: MEMBER.id, role: body.action === "promote" ? "moderator" : "member" } });
    }
    const query = new URL(String(input), "http://localhost").searchParams;
    if (query.get("q") === "maya") return envelope([MEMBER]);
    return envelope([MEMBER, MODERATOR, ADMIN]);
  });
}

async function loadedWith(ui: MountedSurface, text: string) {
  await ui.waitFor(() => ui.container.textContent?.includes(text) === true, {
    description: `the list to show "${text}"`,
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

describe("AdminUsers", () => {
  test("shows each member with the role written out", async () => {
    const ui = mountSurface(<AdminUsers />, { providers: "none" });
    await loadedWith(ui, "maya_designs");

    const text = ui.container.textContent ?? "";
    expect(text).toContain("maya_designs");
    expect(text).toContain("maya@example.com");
    expect(text).toContain("Role: member");
    expect(text).toContain("Role: moderator");
    expect(text).toContain("Role: admin");
  });

  test("offers the ladder's two moves and nothing on an admin row", async () => {
    const ui = mountSurface(<AdminUsers />, { providers: "none" });
    await loadedWith(ui, "theowumicrosoft");

    expect(buttonWith(ui, "Promote to moderator")).toBeTruthy();
    expect(buttonWith(ui, "Demote to member")).toBeTruthy();
    // The admin row is badge-only: no dashboard control may promise to move
    // the role the owner console owns, so the row that announces an admin
    // carries no buttons at all.
    const adminRow = [...ui.container.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("theowumicrosoft"),
    );
    expect(adminRow).toBeTruthy();
    expect(adminRow!.textContent).toContain("Role: admin");
    expect(adminRow!.querySelectorAll("button")).toHaveLength(0);
  });

  test("promoting sends the member id and reloads the list", async () => {
    const ui = mountSurface(<AdminUsers />, { providers: "none" });
    await loadedWith(ui, "maya_designs");

    await ui.click(buttonWith(ui, "Promote to moderator"));

    await ui.waitFor(
      () =>
        fetchMock.mock.calls.some(([, init]) => String((init as RequestInit)?.body ?? "").includes("promote")),
      { description: "the promotion to be sent with the member id" },
    );
    const sent = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.body)?.[1]!.body));
    expect(sent.userId).toBe(MEMBER.id);
    expect(sent.action).toBe("promote");
  });

  test("the search narrows the request, not the DOM", async () => {
    const ui = mountSurface(<AdminUsers />, { providers: "none" });
    await loadedWith(ui, "maya_designs");

    const field = ui.container.querySelector<HTMLInputElement>("#admin-user-search")!;
    await ui.type(field, "maya");
    await ui.click(buttonWith(ui, "Search"));

    await ui.waitFor(() => fetchMock.mock.calls.some((call) => String(call[0]).includes("q=maya")), {
      description: "the search to reach the route",
    });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("q=maya");
  });
});
