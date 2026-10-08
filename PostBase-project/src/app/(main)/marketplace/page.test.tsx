// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The marketplace page, through the two things its cards wear that the route
 * has to send: the category's name and the listing's photo.
 *
 * The route left-joins `categories` and hands back `categoryName`; the page is
 * the pipe between that name and the card's badge, and a pipe is exactly what
 * this file holds it to: the name the route sends is the name the card shows,
 * and the raw id — the thing this page used to render when the name was
 * missing — never reaches the card at all. The photo is the same pipe in the
 * other direction: the route resolves a listing's first media row into
 * `imageUrl`, and until this page passed it on, every card rendered the
 * "No image" placeholder over a listing that had three photos behind it.
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Theo Wu" }, isLoading: false }),
}));

const LISTING_PHOTO = "https://cdn.example.com/seed/listings/listing-00.jpg";

const listing = {
  id: "listing-1",
  title: "Mechanical keyboard",
  priceMin: 95,
  priceMax: 95,
  condition: "Good",
  location: "Austin, Texas",
  categoryId: "90000000-0000-4000-8000-000000000001",
  categoryName: "Technology",
  imageUrl: LISTING_PHOTO,
  createdAt: "2026-09-20T09:00:00.000Z",
};

// Unnamed and photo-less: the fixture the fallbacks are read through.
const unnamedListing = {
  ...listing,
  id: "listing-2",
  title: "Desk setup bundle",
  categoryId: null,
  categoryName: null,
  imageUrl: null,
};

async function mountMarketplace(
  endpoints: Record<string, StubEndpoint> = {},
): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch({
    "/api/marketplace": { data: [listing, unnamedListing] },
    ...endpoints,
  });
  const { default: MarketplacePage } = await import("@/app/(main)/marketplace/page");
  const ui = mountSurface(<MarketplacePage />, { providers: "tooltip" });
  return { ui, requests };
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the marketplace page's listing cards", () => {
  test("wears the category name the route resolved, not the id beside it", async () => {
    const { ui } = await mountMarketplace();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Mechanical keyboard") ?? false,
      { description: "the listings" },
    );
    expect(ui.container.textContent).toContain("Technology");
    expect(ui.container.textContent).not.toContain("90000000");
  });

  test("renders an uncategorised listing with no badge rather than a fallback key", async () => {
    const { ui } = await mountMarketplace();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Desk setup bundle") ?? false,
      { description: "the listings" },
    );
    // The page used to paper over a missing name with "Marketplace" — a word
    // the reader would take for a category. The word belongs to the heading
    // alone: one occurrence means no card grew a fake category badge.
    const occurrences = (ui.container.textContent ?? "").split("Marketplace").length - 1;
    expect(occurrences).toBe(1);
    expect(ui.container.textContent).not.toContain("90000000");
  });

  test("shows the photo the read resolved, and names the placeholder when there is none", async () => {
    const { ui } = await mountMarketplace();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Mechanical keyboard") ?? false,
      { description: "the listings" },
    );

    // The listing's own first photo, not one the grid invented: the page is the
    // pipe between the read's `imageUrl` and the card's frame.
    expect(ui.container.querySelector("img[alt='Mechanical keyboard']")?.getAttribute("src")).toBe(
      LISTING_PHOTO,
    );
    // A listing with no photo still renders a card, and says so rather than
    // leaving an empty frame.
    expect(ui.container.querySelector("img[alt='Desk setup bundle']")).toBeNull();
    expect(ui.container.textContent).toContain("No image");
  });

  test("sends a filter chip's own name as the category filter", async () => {
    const { ui, requests } = await mountMarketplace();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Mechanical keyboard") ?? false,
      { description: "the listings" },
    );

    const chip = [...ui.container.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === "Electronics",
    );
    expect(chip, "the Electronics filter chip").toBeTruthy();
    await ui.click(chip as HTMLElement);

    // The chip holds a display name, so the filter that reaches the route is
    // the name — which the route resolves against the joined category row.
    await ui.waitFor(
      () =>
        requests.calls.some(
          (call) =>
            call.pathname === "/api/marketplace" && call.query.get("category") === "Electronics",
        ),
      { description: "the filtered fetch" },
    );
  });

  test("does not duplicate the listings fetch, which would double the load", async () => {
    const { ui, requests } = await mountMarketplace();
    await ui.waitFor(
      () => ui.container.textContent?.includes("Mechanical keyboard") ?? false,
      { description: "the listings" },
    );
    // The page had two identical effects racing on the same dependencies; the
    // list must be asked for once per load.
    expect(requests.calls.filter((call) => call.pathname === "/api/marketplace")).toHaveLength(1);
  });
});
