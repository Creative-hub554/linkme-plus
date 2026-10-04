// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The groups page, through the category its cards wear.
 *
 * The route left-joins `categories` and hands back `categoryName`; the page is
 * the pipe between that name and the card's badge, and a pipe is exactly what
 * this file holds it to: the name the route sends is the name the card shows,
 * and the raw id — the key this page never rendered but also never guarded
 * against — stays out of the reader's sight.
 */
// Hoisted so the object identity is stable across renders: the page's load
// effect keys on `user`, and a mock that mints a fresh object per render would
// refetch forever — one fetch per render, a loop the real provider's memoised
// context value never produces.
const mocks = vi.hoisted(() => ({
  user: { id: "user-1", name: "Theo Wu" },
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, isLoading: false }),
}));

const group = {
  id: "group-1",
  name: "Design & Product Makers",
  description: "People who make things",
  visibility: "public",
  categoryId: "90000000-0000-4000-8000-000000000002",
  categoryName: "Design",
  memberCount: 42,
  isMember: false,
};

async function mountGroups(
  endpoints: Record<string, StubEndpoint> = {},
): Promise<{ ui: MountedSurface }> {
  stubFetch({
    "/api/groups": { data: [group] },
    ...endpoints,
  });
  const { default: GroupsPage } = await import("@/app/(main)/groups/page");
  const ui = mountSurface(<GroupsPage />, { providers: "theme+tooltip" });
  return { ui };
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the groups page's community cards", () => {
  test("wears the category name the route resolved, not the id beside it", async () => {
    const { ui } = await mountGroups();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Design & Product Makers") ?? false,
      { description: "the communities" },
    );
    expect(ui.container.textContent).toContain("Design");
    expect(ui.container.textContent).not.toContain("90000000");
  });

  test("renders an uncategorised community with no badge", async () => {
    const { ui } = await mountGroups({
      "/api/groups": {
        data: [{ ...group, categoryId: null, categoryName: null }],
      },
    });
    await ui.waitFor(
      () => ui.container.textContent?.includes("Design & Product Makers") ?? false,
      { description: "the communities" },
    );
    // No name, no badge — and the page's own "Joined"/"New" chips are the only
    // filters, so nothing else may wear the category's clothes either.
    expect(ui.container.textContent).not.toContain("90000000");
  });
});
