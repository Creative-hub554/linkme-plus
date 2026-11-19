// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { json, stubFetch, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The advertising manager, driven through the forms a member and an
 * administrator actually use.
 *
 * The page reads two endpoints on mount — its campaigns and the listings/posts
 * it may promote — so a test that only asserted the markup would leave every
 * handler behind the buttons unread. Here the campaign list is rendered, the
 * type switch narrows the placements and sources, booking and payment go through
 * the JSON body the route expects, pausing is a PUT, and the administrator's
 * review and KHQR forms post to the admin endpoint.
 */
const merchant = {
  merchantName: "Merchant",
  qrImageUrl: "https://example.com/qr.png",
  currency: "KHR",
};
const placements = [
  { id: "feed-1", name: "Feed banner", location: "feed", dailyRate: 10000, currency: "KHR", maxActive: 1 },
  { id: "market-1", name: "Marketplace banner", location: "marketplace", dailyRate: 5000, currency: "KHR", maxActive: 1 },
  { id: "jobs-1", name: "Jobs banner", location: "jobs", dailyRate: 4000, currency: "KHR", maxActive: 1 },
];
const sources = {
  listings: [{ id: "listing-1", title: "Vintage chair" }],
  posts: [{ id: "post-1", content: "Page news", pageName: "Corner Cafe" }],
};
function campaign(overrides: Record<string, unknown> = {}) {
  return {
    campaign: {
      id: "campaign-1",
      type: "banner",
      budget: 20000,
      currency: "KHR",
      status: "active",
      startDate: "2026-10-28T00:00:00.000Z",
      endDate: "2026-11-10T00:00:00.000Z",
      ...(overrides.campaign as object),
    },
    creative: {
      headline: "Our shop",
      destinationUrl: "https://example.com",
      imageUrl: "https://example.com/banner.png",
      ...(overrides.creative as object),
    },
    payment: {
      status: "verified",
      reference: "BANK-1",
      payerName: "Theo",
      note: null,
      merchantName: "Merchant",
      qrImageUrl: "https://example.com/qr.png",
      ...(overrides.payment as object),
    },
    impressions: 120,
    clicks: 8,
    sourceEligible: true,
  };
}
function data(overrides: Record<string, unknown> = {}) {
  return {
    campaigns: [campaign()],
    placements,
    settings: merchant,
    isAdmin: false,
    hasMore: false,
    ...overrides,
  };
}

async function mountPage(endpoints: Record<string, StubEndpoint> = {}, overrides: Record<string, unknown> = {}) {
  const requests = stubFetch({
    "/api/advertising": data(overrides),
    "/api/advertising/sources": sources,
    ...endpoints,
  });
  const { default: Page } = await import("@/app/(main)/advertising/page");
  const ui = mountSurface(<Page />, { providers: "theme+tooltip" });
  await ui.waitFor(() => ui.container.textContent?.includes("My campaigns") ?? false, {
    description: "the campaign list",
  });
  return { ui, requests };
}

/** A native `<select>`, changed the way a reader changes one. */
async function choose(element: HTMLSelectElement, value: string) {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setValue?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(ui: MountedSurface, label: string) {
  const found = [...ui.container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLElement;
}

afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  });
});

describe("the advertising manager", () => {
  test("lists a campaign with its creative, payment state and performance", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
    const { ui } = await mountPage();
    const text = ui.container.textContent ?? "";
    expect(text).toContain("Our shop");
    expect(text).toContain("Status: active");
    expect(text).toContain("Payment: verified");
    expect(text).toContain("120 member views");
    const image = ui.container.querySelector('img[alt="Campaign creative"]') as HTMLImageElement;
    expect(image.src).toBe("https://example.com/banner.png");
    const destination = [...ui.container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Review campaign destination"),
    );
    expect(destination?.getAttribute("href")).toBe("https://example.com");
  });

  test("narrows placements and sources to the campaign type", async () => {
    const { ui, requests } = await mountPage();
    const type = ui.container.querySelector("#campaignType") as HTMLSelectElement;
    const placementOptions = () =>
      [...ui.container.querySelectorAll("#placement option")].map((option) => option.textContent);

    expect(placementOptions()).toHaveLength(3);
    await choose(type, "promotion");
    expect(ui.container.textContent).toContain("Your listing");
    expect(placementOptions()).toHaveLength(1);
    expect(placementOptions()[0]).toContain("Marketplace banner");
    expect(placementOptions()[0]).toContain("5,000");
    await ui.waitFor(
      () => [...ui.container.querySelectorAll("#source option")].some((option) => option.textContent === "Vintage chair"),
      { description: "the member's listings" },
    );

    await choose(type, "boost");
    expect(placementOptions()).toHaveLength(1);
    expect(placementOptions()[0]).toContain("Feed banner");
    expect([...ui.container.querySelectorAll("#source option")].map((o) => o.textContent)).toContain(
      "Corner Cafe: Page news",
    );

    await ui.click(button(ui, "Older sources"));
    await ui.waitFor(() => requests.calls.some((call) => call.pathname === "/api/advertising/sources" && call.query.get("page") === "2"), {
      description: "the next source page",
    });
  });

  test("books a banner from the form and reports it saved", async () => {
    const { ui, requests } = await mountPage();
    await ui.type(ui.container.querySelector("#headline") as HTMLInputElement, "Autumn sale");
    await ui.type(ui.container.querySelector("#imageUrl") as HTMLInputElement, "https://example.com/sale.png");
    await ui.type(ui.container.querySelector("#destinationUrl") as HTMLInputElement, "https://example.com/sale");
    await ui.type(ui.container.querySelector("#startDate") as HTMLInputElement, "2026-10-28");
    await ui.type(ui.container.querySelector("#endDate") as HTMLInputElement, "2026-10-30");
    await ui.click(button(ui, "Create booking and view payment amount"));

    await ui.waitFor(() => requests.calls.some((call) => call.pathname === "/api/advertising" && call.method === "POST"), {
      description: "the booking",
    });
    const booking = requests.calls.find((call) => call.pathname === "/api/advertising" && call.method === "POST");
    expect(booking?.body).toMatchObject({
      type: "banner",
      placementId: "feed-1",
      headline: "Autumn sale",
      imageUrl: "https://example.com/sale.png",
      destinationUrl: "https://example.com/sale",
    });
    expect(new Date(String(booking?.body?.startDate)).getDate()).toBe(28);
    await ui.waitFor(() => ui.container.textContent?.includes("Saved successfully.") ?? false, {
      description: "the save notice",
    });
  });

  test("submits a bank reference for an awaiting payment", async () => {
    const { ui, requests } = await mountPage(
      {},
      { campaigns: [campaign({ payment: { status: "awaiting" } })] },
    );
    await ui.type(ui.container.querySelector("#reference-campaign-1") as HTMLInputElement, "BANK-777");
    await ui.type(ui.container.querySelector("#payer-campaign-1") as HTMLInputElement, "Theo Wu");
    await ui.click(button(ui, "Submit payment for manual verification"));
    await ui.waitFor(() => requests.calls.some((call) => call.method === "PUT"), {
      description: "the payment submission",
    });
    expect(requests.calls.find((call) => call.method === "PUT")?.body).toEqual({
      id: "campaign-1",
      action: "payment",
      reference: "BANK-777",
      payerName: "Theo Wu",
    });
  });

  test("pauses a running campaign", async () => {
    const { ui, requests } = await mountPage();
    await ui.click(button(ui, "Pause"));
    await ui.waitFor(() => requests.calls.some((call) => call.method === "PUT"), {
      description: "the pause",
    });
    expect(requests.calls.find((call) => call.method === "PUT")?.body).toEqual({
      id: "campaign-1",
      action: "pause",
    });
  });

  test("pages to older campaigns", async () => {
    const { ui, requests } = await mountPage({}, { hasMore: true });
    expect(button(ui, "Previous campaigns").hasAttribute("disabled")).toBe(true);
    await ui.click(button(ui, "Next campaigns"));
    await ui.waitFor(
      () => requests.calls.some((call) => call.pathname === "/api/advertising" && call.query.get("page") === "2"),
      { description: "the second campaign page" },
    );
  });

  test("an administrator reviews campaigns and records a decision", async () => {
    const { ui, requests } = await mountPage({}, { isAdmin: true });
    await ui.click(button(ui, "Review all campaigns"));
    await ui.waitFor(() => ui.container.textContent?.includes("Campaign review") ?? false, {
      description: "the review queue",
    });
    await ui.type(ui.container.querySelector("#note-campaign-1") as HTMLInputElement, "Bank credit confirmed");
    await ui.click(button(ui, "Save reviewed decision"));
    await ui.waitFor(() => requests.calls.some((call) => call.pathname === "/api/admin/advertising"), {
      description: "the decision",
    });
    expect(requests.calls.find((call) => call.pathname === "/api/admin/advertising")?.body).toEqual({
      id: "campaign-1",
      action: "verify",
      note: "Bank credit confirmed",
    });
    expect(ui.container.textContent).toContain("Bank reference: BANK-1");
  });

  test("an administrator saves the merchant KHQR details", async () => {
    const { ui, requests } = await mountPage({}, { isAdmin: true });
    const merchantName = ui.container.querySelector("#merchantName") as HTMLInputElement;
    await ui.type(merchantName, "Corner Merchant");
    await ui.click(button(ui, "Save merchant KHQR"));
    await ui.waitFor(() => requests.calls.some((call) => call.pathname === "/api/admin/advertising"), {
      description: "the settings save",
    });
    expect(requests.calls.find((call) => call.pathname === "/api/admin/advertising")?.body).toEqual({
      action: "settings",
      merchantName: "Corner Merchant",
      currency: "KHR",
      qrImageUrl: "https://example.com/qr.png",
    });
  });

  test("both currencies remain bookable and the merchant form loads each currency's QR", async () => {
    const usd = { merchantName: "USD merchant", qrImageUrl: "https://example.com/usd.png", currency: "USD" };
    const { ui, requests } = await mountPage({}, {
      isAdmin: true,
      paymentSettings: [merchant, usd],
      placements: [...placements, { ...placements[0], id: "usd-feed", name: "USD feed", currency: "USD", dailyRate: 3 }],
    });
    expect(ui.container.textContent).toContain("USD feed");
    expect(ui.container.textContent).toContain("Feed banner");
    await choose(ui.container.querySelector("#currency") as HTMLSelectElement, "USD");
    expect((ui.container.querySelector("#qrImageUrl") as HTMLInputElement).value).toBe(usd.qrImageUrl);
    await ui.click(button(ui, "Save merchant KHQR"));
    await ui.waitFor(() => requests.calls.some((call) => call.pathname === "/api/admin/advertising"), { description: "USD settings save" });
    expect(requests.calls.find((call) => call.pathname === "/api/admin/advertising")?.body).toMatchObject({ currency: "USD", qrImageUrl: usd.qrImageUrl });
  });

  test("shows what went wrong when the campaign list cannot load", async () => {
    const requests = stubFetch({
      "/api/advertising": () => json({ error: "Unable to load campaigns" }, 500),
      "/api/advertising/sources": sources,
    });
    const { default: Page } = await import("@/app/(main)/advertising/page");
    const ui = mountSurface(<Page />, { providers: "theme+tooltip" });
    await ui.waitFor(
      () => ui.container.querySelector('[role="alert"]')?.textContent === "Unable to load campaigns",
      { description: "the load failure" },
    );
    expect(requests.answered).toContain("/api/advertising");
  });
});
