// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch, json } from "@/test/stub-fetch";
import { ProfileMediaGallery } from "@/components/profile/media-gallery";
import { SponsoredPlacement } from "@/components/advertising/sponsored-placement";
afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
};

test("an employer can review an applicant and persist a hiring status", async () => {
  let status = "pending";
  const requests = stubFetch({
    "/api/jobs": {
      data: [{ id: "job-1", title: "Designer", status: "active" }],
      pagination: { hasMore: false },
    },
    "/api/jobs/applications": (request) =>
      request.method === "PUT"
        ? ((status = String(request.body?.status)), { application: { status } })
        : {
            data: [
              {
                id: "application-1",
                userId: "applicant-1",
                applicant: { name: "Ada Applicant" },
                coverLetter: "I design products",
                status,
              },
            ],
            pagination: { hasMore: false },
          },
  });
  const { default: Page } = await import("@/app/(main)/jobs/manage/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() =>
    Boolean(ui.container.textContent?.includes("Ada Applicant")),
  );
  const select = ui.container.querySelector(
    "#status-application-1",
  ) as HTMLSelectElement;
  await act(async () => {
    select.value = "shortlisted";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await ui.waitFor(() => requests.calls.some((call) => call.method === "PUT"));
  expect(requests.calls.find((call) => call.method === "PUT")?.body).toEqual({
    id: "application-1",
    status: "shortlisted",
  });
});

test("a seller can initialize inventory without exposing their unit cost to other users", async () => {
  const requests = stubFetch({
    "/api/marketplace": {
      data: [{ id: "listing-1", title: "Camera", status: "active" }],
      pagination: { hasMore: false },
    },
    "/api/marketplace/inventory": (request) =>
      request.method === "PUT"
        ? {
            inventory: {
              id: "stock-1",
              quantity: 0,
              lowStockThreshold: 5,
              sku: "CAMERA",
              unitCost: 100,
            },
          }
        : json({ error: "Inventory not found" }, 404),
  });
  const { default: Page } =
    await import("@/app/(main)/marketplace/inventory/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() =>
    Boolean(ui.container.textContent?.includes("Start tracking stock")),
  );
  (ui.container.querySelector("#sku") as HTMLInputElement).value = "CAMERA";
  (ui.container.querySelector("#unitCost") as HTMLInputElement).value = "100";
  await submit(ui.container.querySelector("form")!);
  expect(
    requests.calls.find((call) => call.method === "PUT")?.body,
  ).toMatchObject({
    listingId: "listing-1",
    sku: "CAMERA",
    unitCost: 100,
    lowStockThreshold: 5,
  });
  expect(ui.container.textContent).toContain("Out of stock");
  expect(ui.container.textContent).toContain("Record a stock movement");
});

test("advertisers submit KHQR references for manual review rather than claiming payment is verified", async () => {
  let submitted = false;
  const row = () => ({
    campaign: {
      id: "campaign-1",
      type: "banner",
      budget: 10000,
      currency: "KHR",
      status: submitted ? "pending_review" : "pending_payment",
      startDate: "2099-01-01",
      endDate: "2099-01-03",
    },
    creative: { headline: "Our shop", destinationUrl: "https://example.com" },
    payment: {
      status: submitted ? "submitted" : "awaiting",
      merchantName: "Our Merchant",
      qrImageUrl: "https://example.com/qr.png",
    },
    impressions: 0,
    clicks: 0,
    sourceEligible: true,
  });
  const requests = stubFetch({
    "/api/advertising": (request) =>
      request.method === "PUT"
        ? ((submitted = true), { success: true })
        : {
            campaigns: [row()],
            placements: [],
            settings: {
              merchantName: "Our Merchant",
              qrImageUrl: "https://example.com/qr.png",
              currency: "KHR",
            },
            isAdmin: false,
            hasMore: false,
          },
    "/api/advertising/sources": { listings: [], posts: [] },
  });
  const { default: Page } = await import("@/app/(main)/advertising/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() =>
    Boolean(ui.container.querySelector("#reference-campaign-1")),
  );
  const reference = ui.container.querySelector(
    "#reference-campaign-1",
  ) as HTMLInputElement;
  reference.value = "BANK123";
  (ui.container.querySelector("#payer-campaign-1") as HTMLInputElement).value =
    "Ada";
  await submit(reference.closest("form")!);
  await ui.waitFor(() =>
    Boolean(ui.container.textContent?.includes("pending_review")),
  );
  expect(requests.calls.find((call) => call.method === "PUT")?.body).toEqual({
    id: "campaign-1",
    action: "payment",
    reference: "BANK123",
    payerName: "Ada",
  });
  expect(ui.container.textContent).toContain("Payment: submitted");
});

test("the media gallery reads older post pages and includes matching media", async () => {
  const requests = stubFetch({
    "/api/posts": (request) =>
      request.query.get("cursor")
        ? {
            data: [
              {
                media: [
                  {
                    url: "https://example.com/older.jpg",
                    type: "image",
                    altText: "Older photo",
                  },
                ],
              },
            ],
            pagination: { nextCursor: null },
          }
        : {
            data: [
              {
                media: [
                  {
                    url: "https://example.com/photo.jpg",
                    type: "image",
                    altText: "First photo",
                  },
                ],
              },
            ],
            pagination: { nextCursor: "older" },
          },
  });
  const ui = mountSurface(
    <ProfileMediaGallery userId="member-1" kind="photos" onClose={() => {}} />,
  );
  await ui.waitFor(() =>
    Boolean(document.querySelector('img[alt="First photo"]')),
  );
  const more = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Load more media",
  );
  expect(more).toBeTruthy();
  await ui.click(more!);
  await ui.waitFor(() =>
    Boolean(document.querySelector('img[alt="Older photo"]')),
  );
  expect(requests.calls.at(-1)?.query.get("cursor")).toBe("older");
});

test("sponsored placements are labelled and can be hidden", async () => {
  stubFetch({
    "/api/advertising/serve": {
      ads: [
        {
          id: "ad-1",
          headline: "Sponsored shop",
          destinationUrl: "https://example.com",
          imageUrl: null,
        },
      ],
    },
    "/api/advertising/events": { recorded: true },
  });
  const ui = mountSurface(<SponsoredPlacement location="marketplace" />);
  await ui.waitFor(() =>
    Boolean(ui.container.textContent?.includes("Sponsored shop")),
  );
  expect(
    ui.container.querySelector('[aria-label="Sponsored placement"]'),
  ).toBeTruthy();
  await ui.click(
    [...ui.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Hide ad",
    )!,
  );
  expect(ui.container.textContent).not.toContain("Sponsored shop");
  expect(localStorage.getItem("hidden-ad:ad-1")).toBe("1");
});
