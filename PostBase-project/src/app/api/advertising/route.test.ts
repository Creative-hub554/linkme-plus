import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
const auth = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111" as string | null,
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (auth.id ? { user: { id: auth.id } } : null),
    },
  },
}));
import { GET, POST, PUT } from "./route";
import {
  adCampaigns,
  adPayments,
  adPlacements,
  adPaymentSettings,
  categories,
  inventoryItems,
  listingMedia,
  marketplaceListings,
  pageRoles,
  postMedia,
  posts,
  users,
} from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
const id = "22222222-2222-4222-8222-222222222222";
const request = (method: string, body?: unknown, query = "") =>
  new Request(`http://localhost/api/advertising${query}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  resetFakeDb();
  auth.id = "11111111-1111-4111-8111-111111111111";
});
test("visitors cannot book or inspect campaigns", async () => {
  auth.id = null;
  expect((await GET(request("GET"))).status).toBe(401);
  expect((await POST(request("POST", {}))).status).toBe(401);
  expect(fakeDb.reads).toEqual([]);
});
test("a member cannot inspect the administrator's payment queue", async () => {
  fakeDb.selectReturns(users, [{ role: "member" }]);
  expect((await GET(request("GET", undefined, "?admin=true"))).status).toBe(
    403,
  );
  expect(fakeDb.reads).toEqual(["users"]);
});
test("booking totals come from the placement rate and never the client's amount or status", async () => {
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 10000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ])
    .insertReturns(adCampaigns, [
      { id, budget: 20000, status: "pending_payment" },
    ]);
  const start = new Date(Date.now() + 86400000),
    end = new Date(start.getTime() + 2 * 86400000);
  const response = await POST(
    request("POST", {
      type: "banner",
      placementId: id,
      startDate: start,
      endDate: end,
      budget: 1,
      status: "active",
      headline: "Our shop",
      imageUrl: "https://example.com/banner.png",
      destinationUrl: "https://example.com",
    }),
  );
  expect(response.status).toBe(201);
  expect(fakeDb.writes[0].values).toMatchObject({
    budget: 20000,
    currency: "KHR",
    status: "pending_payment",
  });
  expect(fakeDb.writes[2]).toMatchObject({
    table: "ad_payments",
    values: { status: "awaiting", merchantName: "Merchant" },
  });
});
test("payment submission waits for verification and cannot activate a campaign", async () => {
  fakeDb
    .selectReturns(adCampaigns, [
      {
        id,
        advertiserId: auth.id,
        status: "pending_payment",
        endDate: new Date(Date.now() + 86400000),
      },
    ])
    .selectReturns(adPayments, [{ status: "awaiting" }]);
  expect(
    (
      await PUT(
        request("PUT", {
          id,
          action: "payment",
          reference: "bank-123",
          payerName: "Customer",
        }),
      )
    ).status,
  ).toBe(200);
  expect(fakeDb.writes).toEqual([
    {
      table: "ad_payments",
      values: {
        reference: "BANK-123",
        payerName: "Customer",
        status: "submitted",
        note: null,
      },
    },
    { table: "ad_campaigns", values: { status: "pending_review" } },
  ]);
});
test("a different member cannot modify a campaign", async () => {
  fakeDb.selectReturns(adCampaigns, [{ id, advertiserId: "someone-else" }]);
  expect((await PUT(request("PUT", { id, action: "cancel" }))).status).toBe(
    404,
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a member reads their campaigns beside the placements and KHQR settings", async () => {
  const row = {
    campaign: { id },
    creative: { headline: "Our shop" },
    payment: { status: "awaiting" },
    sourceEligible: true,
    impressions: 10,
    clicks: 2,
  };
  fakeDb
    .selectReturns(users, [{ role: "member" }])
    .selectReturns(adCampaigns, [row])
    .selectReturns(adPlacements, [{ id, location: "feed" }])
    .selectReturns(adPaymentSettings, [
      { id: "khqr", merchantName: "Merchant" },
    ]);
  const response = await GET(request("GET"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    campaigns: [row],
    hasMore: false,
    placements: [{ id, location: "feed" }],
    settings: { id: "khqr", merchantName: "Merchant" },
    paymentSettings: [{ id: "khqr", merchantName: "Merchant" }],
    isAdmin: false,
  });
  // The read is scoped to the signed-in advertiser, not the whole table.
  expect(fakeDb.selectParams).toContainEqual([auth.id]);
});

function bookingWindow(days: number) {
  const start = new Date(Date.now() + 86400000);
  return {
    startDate: start,
    endDate: new Date(start.getTime() + days * 86400000),
  };
}

test("promoting an active listing books against the listing's own media and category", async () => {
  const listingId = "33333333-3333-4333-8333-333333333333";
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 5000, currency: "KHR", location: "marketplace" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ])
    .selectReturns(marketplaceListings, [
      {
        id: listingId,
        sellerId: auth.id,
        status: "active",
        deletedAt: null,
        categoryId: "cat-1",
        title: "Vintage chair",
      },
    ])
    .selectReturns(inventoryItems, [{ quantity: 3 }])
    .selectReturns(categories, [{ name: "Furniture" }])
    .selectReturns(listingMedia, [{ url: "https://example.com/chair.png" }])
    .insertReturns(adCampaigns, [{ id }]);
  const response = await POST(
    request("POST", {
      type: "promotion",
      placementId: id,
      sourceId: listingId,
      ...bookingWindow(2),
    }),
  );
  expect(response.status).toBe(201);
  expect(fakeDb.writes[0].values).toMatchObject({
    type: "promotion",
    status: "pending_payment",
    budget: 10000,
    targetCategories: ["Furniture"],
  });
  expect(fakeDb.writes[1].values).toMatchObject({
    headline: "Vintage chair",
    destinationUrl: `/marketplace/${listingId}`,
    imageUrl: "https://example.com/chair.png",
  });
  expect(fakeDb.writes[3]).toMatchObject({
    table: "promoted_listing_campaigns",
    values: { campaignId: id, listingId },
  });
});

test("a sold-out listing cannot be promoted", async () => {
  const listingId = "33333333-3333-4333-8333-333333333333";
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 5000, currency: "KHR", location: "marketplace" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ])
    .selectReturns(marketplaceListings, [
      {
        id: listingId,
        sellerId: auth.id,
        status: "active",
        deletedAt: null,
        title: "Vintage chair",
      },
    ])
    .selectReturns(inventoryItems, [{ quantity: 0 }]);
  const response = await POST(
    request("POST", {
      type: "promotion",
      placementId: id,
      sourceId: listingId,
      ...bookingWindow(2),
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Out-of-stock listings cannot be promoted",
  });
  expect(fakeDb.writes).toEqual([]);
});

test("boosting a Page post takes its headline and first image from the post", async () => {
  const postId = "44444444-4444-4444-8444-444444444444";
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 7000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ])
    .selectReturns(posts, [
      {
        id: postId,
        pageId: "page-1",
        visibility: "public",
        deletedAt: null,
        content: "Page news",
      },
    ])
    .selectReturns(pageRoles, [{ role: "admin" }])
    .selectReturns(postMedia, [
      { type: "image/png", url: "https://example.com/news.png" },
    ])
    .insertReturns(adCampaigns, [{ id }]);
  const response = await POST(
    request("POST", {
      type: "boost",
      placementId: id,
      sourceId: postId,
      ...bookingWindow(1),
    }),
  );
  expect(response.status).toBe(201);
  expect(fakeDb.writes[1].values).toMatchObject({
    headline: "Page news",
    destinationUrl: `/feed?post=${postId}`,
    imageUrl: "https://example.com/news.png",
  });
  expect(fakeDb.writes[3]).toMatchObject({
    table: "boosted_post_campaigns",
    values: { campaignId: id, postId, goal: "reach" },
  });
});

test("a non-administrator cannot boost a Page post", async () => {
  const postId = "44444444-4444-4444-8444-444444444444";
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 7000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ])
    .selectReturns(posts, [
      {
        id: postId,
        pageId: "page-1",
        visibility: "public",
        deletedAt: null,
        content: "Page news",
      },
    ])
    .selectReturns(pageRoles, []);
  const response = await POST(
    request("POST", {
      type: "boost",
      placementId: id,
      sourceId: postId,
      ...bookingWindow(1),
    }),
  );
  expect(response.status).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});

test("pausing and resuming an owned campaign follows the payment state", async () => {
  const owned = {
    id,
    advertiserId: auth.id,
    status: "active",
    endDate: new Date(Date.now() + 86400000),
  };
  fakeDb.selectReturns(adCampaigns, [owned]);
  expect((await PUT(request("PUT", { id, action: "pause" }))).status).toBe(200);
  expect(fakeDb.writes[0].values).toEqual({ status: "paused" });

  fakeDb
    .selectReturns(adCampaigns, [owned])
    .selectReturns(adPayments, [{ status: "awaiting" }]);
  expect((await PUT(request("PUT", { id, action: "resume" }))).status).toBe(
    409,
  );

  fakeDb
    .selectReturns(adCampaigns, [owned])
    .selectReturns(adPayments, [{ status: "verified" }]);
  expect((await PUT(request("PUT", { id, action: "resume" }))).status).toBe(
    200,
  );
  expect(fakeDb.writes.at(-1)?.values).toEqual({ status: "pending_review" });
});

test("a campaign that has already ended cannot be changed", async () => {
  fakeDb.selectReturns(adCampaigns, [
    {
      id,
      advertiserId: auth.id,
      status: "active",
      endDate: new Date(Date.now() - 1000),
    },
  ]);
  const response = await PUT(request("PUT", { id, action: "cancel" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "This campaign has ended" });
  expect(fakeDb.writes).toEqual([]);
});

function bookablePlacement(location: "feed" | "marketplace" | "jobs") {
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 5000, currency: "KHR", location },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ]);
}

test("an author can book a personal post boost, while another member cannot", async () => {
  const postId = "44444444-4444-4444-8444-444444444444";
  const post = { id: postId, pageId: null, groupId: null, visibility: "public", content: "My post" };
  const body = { type: "boost", placementId: id, sourceId: postId, ...bookingWindow(1) };

  bookablePlacement("feed");
  fakeDb.selectReturns(posts, [{ ...post, authorId: "another-member" }]);
  const refused = await POST(request("POST", body));
  expect(refused.status).toBe(403);
  expect(fakeDb.writes).toEqual([]);

  bookablePlacement("feed");
  fakeDb
    .selectReturns(posts, [{ ...post, authorId: auth.id }])
    .selectReturns(postMedia, [])
    .insertReturns(adCampaigns, [{ id }]);
  const booked = await POST(request("POST", body));
  expect(booked.status).toBe(201);
  expect(fakeDb.writes[0].values).toMatchObject({ type: "boost", status: "pending_payment" });
  expect(fakeDb.writes[3]).toMatchObject({ table: "boosted_post_campaigns", values: { postId } });
});

test("a booking must name a known campaign type and a real placement", async () => {
  const invalidType = await POST(request("POST", { type: "video" }));
  expect(invalidType.status).toBe(400);
  expect(await invalidType.json()).toEqual({
    error: "Select a valid campaign type and placement",
  });

  const nonStringPlacement = await POST(
    request("POST", { type: "banner", placementId: 42 }),
  );
  expect(nonStringPlacement.status).toBe(400);
  expect(await nonStringPlacement.json()).toEqual({
    error: "Select a valid campaign type and placement",
  });

  const invalidPlacement = await POST(
    request("POST", { type: "banner", placementId: "not-a-uuid" }),
  );
  expect(invalidPlacement.status).toBe(400);
  expect(await invalidPlacement.json()).toEqual({
    error: "Select a valid campaign type and placement",
  });
  expect(fakeDb.reads).toEqual([]);
});

test("a campaign total beyond the stored budget limit is refused", async () => {
  const body = {
    type: "banner",
    placementId: id,
    ...bookingWindow(1),
    headline: "Our shop",
    imageUrl: "https://example.com/banner.png",
    destinationUrl: "https://example.com",
  };
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 3000000000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ]);
  const overLimit = await POST(request("POST", body));
  expect(overLimit.status).toBe(400);
  expect(await overLimit.json()).toEqual({
    error: "Campaign total is too large",
  });

  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 1e300, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ]);
  const notSafe = await POST(request("POST", body));
  expect(notSafe.status).toBe(400);
  expect(await notSafe.json()).toEqual({
    error: "Campaign total is too large",
  });
  expect(fakeDb.writes).toEqual([]);
});

test("a promotion or boost must carry a uuid source", async () => {
  for (const extra of [{}, { sourceId: 42 }, { sourceId: "not-a-uuid" }]) {
    bookablePlacement("feed");
    const response = await POST(
      request("POST", {
        type: "boost",
        placementId: id,
        ...bookingWindow(1),
        ...extra,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Select a valid source post or listing",
    });
  }
  expect(fakeDb.writes).toEqual([]);
});

test("a listing promotion must use a marketplace placement", async () => {
  bookablePlacement("feed");
  const response = await POST(
    request("POST", {
      type: "promotion",
      placementId: id,
      sourceId: "33333333-3333-4333-8333-333333333333",
      ...bookingWindow(1),
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Listing promotions belong in marketplace placements",
  });
  expect(fakeDb.reads).toEqual(["ad_placements", "ad_payment_settings"]);
  expect(fakeDb.writes).toEqual([]);
});

test("only the caller's active, undeleted listings can be promoted", async () => {
  const listingId = "33333333-3333-4333-8333-333333333333";
  const owned = {
    id: listingId,
    sellerId: auth.id,
    status: "active",
    deletedAt: null,
    title: "Vintage chair",
  };
  const cases = [
    [],
    [{ ...owned, sellerId: "someone-else" }],
    [{ ...owned, status: "draft" }],
    [{ ...owned, deletedAt: new Date() }],
  ];
  for (const rows of cases) {
    bookablePlacement("marketplace");
    fakeDb.selectReturns(marketplaceListings, rows);
    const response = await POST(
      request("POST", {
        type: "promotion",
        placementId: id,
        sourceId: listingId,
        ...bookingWindow(1),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only your active listings can be promoted",
    });
  }
  expect(fakeDb.writes).toEqual([]);
});

test("a post boost must use a feed placement", async () => {
  bookablePlacement("marketplace");
  const response = await POST(
    request("POST", {
      type: "boost",
      placementId: id,
      sourceId: "44444444-4444-4444-8444-444444444444",
      ...bookingWindow(1),
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Boosted posts belong in feed placements",
  });
  expect(fakeDb.writes).toEqual([]);
});

test("a boost must target a published, public, undeleted post outside a group", async () => {
  const postId = "44444444-4444-4444-8444-444444444444";
  const published = {
    id: postId,
    pageId: "page-1",
    visibility: "public",
    deletedAt: null,
    content: "Page news",
  };
  const cases = [
    [],
    [{ ...published, groupId: "group-1" }],
    [{ ...published, visibility: "private" }],
    [{ ...published, deletedAt: new Date() }],
  ];
  for (const rows of cases) {
    bookablePlacement("feed");
    fakeDb.selectReturns(posts, rows);
    const response = await POST(
      request("POST", {
        type: "boost",
        placementId: id,
        sourceId: postId,
        ...bookingWindow(1),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a published public post outside a group",
    });
  }
  expect(fakeDb.writes).toEqual([]);
});

test("a booking window must start in the future and cover at most 90 days", async () => {
  const start = new Date(Date.now() + 5 * 86400000);
  expect(
    (
      await POST(
        request("POST", {
          type: "banner",
          placementId: id,
          startDate: new Date(Date.now() - 5 * 86400000),
          endDate: new Date(Date.now() - 86400000),
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await POST(
        request("POST", {
          type: "banner",
          placementId: id,
          startDate: start,
          endDate: new Date(start.getTime() + 91 * 86400000),
        }),
      )
    ).status,
  ).toBe(400);
  expect(fakeDb.reads).toEqual([]);
});

test("a placement with no rate or no matching KHQR agreement is refused", async () => {
  const body = {
    type: "banner",
    placementId: id,
    ...bookingWindow(1),
    headline: "Our shop",
    imageUrl: "https://example.com/banner.png",
    destinationUrl: "https://example.com",
  };
  fakeDb.selectReturns(adPlacements, [
    { id, dailyRate: 0, currency: "KHR", location: "feed" },
  ]);
  expect((await POST(request("POST", body))).status).toBe(400);
  resetFakeDb();
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 5000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "USD",
      },
    ]);
  expect((await POST(request("POST", body))).status).toBe(503);
});

test("a banner must carry a headline, destination and image", async () => {
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 5000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ]);
  const response = await POST(
    request("POST", {
      type: "banner",
      placementId: id,
      ...bookingWindow(1),
      headline: "Our shop",
    }),
  );
  expect(response.status).toBe(400);
  expect(fakeDb.writes).toEqual([]);
});

test("a failed campaign read answers 500 rather than a partial ledger", async () => {
  fakeDb.failNextSelect(users);
  const response = await GET(request("GET"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Unable to load campaigns",
  });
});

test("a failed booking write does not report success", async () => {
  fakeDb
    .selectReturns(adPlacements, [
      { id, dailyRate: 5000, currency: "KHR", location: "feed" },
    ])
    .selectReturns(adPaymentSettings, [
      {
        merchantName: "Merchant",
        qrImageUrl: "https://example.com/khqr.png",
        currency: "KHR",
      },
    ])
    .failNextInsert(adCampaigns);
  const response = await POST(
    request("POST", {
      type: "banner",
      placementId: id,
      ...bookingWindow(1),
      headline: "Our shop",
      imageUrl: "https://example.com/banner.png",
      destinationUrl: "https://example.com",
    }),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Unable to create campaign",
  });
});

test("a payment must name a campaign and carry a reference and payer", async () => {
  expect(
    (await PUT(request("PUT", { id: "nope", action: "payment" }))).status,
  ).toBe(400);
  fakeDb.selectReturns(adCampaigns, [
    {
      id,
      advertiserId: auth.id,
      status: "pending_payment",
      endDate: new Date(Date.now() + 86400000),
    },
  ]);
  const response = await PUT(
    request("PUT", {
      id,
      action: "payment",
      reference: "123",
      payerName: "Customer",
    }),
  );
  expect(response.status).toBe(400);
  expect(fakeDb.writes).toEqual([]);
});

test("a verified payment cannot be submitted again", async () => {
  fakeDb
    .selectReturns(adCampaigns, [
      {
        id,
        advertiserId: auth.id,
        status: "pending_review",
        endDate: new Date(Date.now() + 86400000),
      },
    ])
    .selectReturns(adPayments, [{ status: "verified" }]);
  const response = await PUT(
    request("PUT", {
      id,
      action: "payment",
      reference: "BANK-123",
      payerName: "Customer",
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Payment cannot be changed" });
});

test("an unknown campaign action is refused", async () => {
  fakeDb.selectReturns(adCampaigns, [
    {
      id,
      advertiserId: auth.id,
      status: "active",
      endDate: new Date(Date.now() + 86400000),
    },
  ]);
  const response = await PUT(request("PUT", { id, action: "archive" }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid campaign action" });
});

test("a duplicate transaction reference is reported against the campaign", async () => {
  fakeDb
    .selectReturns(adCampaigns, [
      {
        id,
        advertiserId: auth.id,
        status: "pending_payment",
        endDate: new Date(Date.now() + 86400000),
      },
    ])
    .selectReturns(adPayments, [{ status: "awaiting" }])
    .failNextUpdate(
      adPayments,
      Object.assign(new Error("duplicate"), { code: "23505" }),
    );
  const response = await PUT(
    request("PUT", {
      id,
      action: "payment",
      reference: "BANK-123",
      payerName: "Customer",
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "This transaction reference is already attached to a campaign",
  });
});

test("an unexpected ledger failure answers 500", async () => {
  fakeDb
    .selectReturns(adCampaigns, [
      {
        id,
        advertiserId: auth.id,
        status: "pending_payment",
        endDate: new Date(Date.now() + 86400000),
      },
    ])
    .failNextSelect(adPayments, new Error("boom"));
  const response = await PUT(
    request("PUT", {
      id,
      action: "payment",
      reference: "BANK-123",
      payerName: "Customer",
    }),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Unable to update campaign" });
});
