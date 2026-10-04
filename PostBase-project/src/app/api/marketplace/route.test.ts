import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The marketplace route's writes, validation and ownership guards.
 *
 * Creating a listing is up to **four** writes — the listing, then its media, its
 * variants and its inventory — all keyed by the id the first insert returned, so
 * the order is forced and the test pins the whole set. The listing is created as
 * a `draft`, which is what keeps an incomplete listing out of `GET`'s
 * `status = 'active'` listing until the seller publishes it. Editing and
 * deleting compare against `seller_id`, so a stranger's request matches no row
 * and is answered `404` — and deletion is a **soft** delete (`status: "removed"`
 * plus `deleted_at`), not a removed row, which is what makes the ownership test
 * an update that matched nothing rather than a delete that found nothing.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "seller-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { DELETE, GET, POST, PUT } from "./route";
import {
  inventoryItems,
  listingMedia,
  marketplaceListings,
  productVariants,
  savedListings,
} from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const LISTING_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_LISTING_ID = "88888888-8888-4888-8888-888888888888";
const CATEGORY_ID = "90000000-0000-4000-8000-000000000001";
const MEDIA_URL = "https://test.r2.dev/listings/seller-1/photo.png";

function jsonRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "seller-1";
});

describe("GET /api/marketplace", () => {
  it("answers 500 when the list read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(marketplaceListings, new Error("database unavailable"));
    try {
      const response = await GET(
        new Request("http://localhost/api/marketplace", { method: "GET" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch listings" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });

  it("returns one listing by id, with its media, inventory, variants and saved flag", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, title: "Camera" }])
      .selectReturns(listingMedia, [{ listingId: LISTING_ID, url: MEDIA_URL }])
      .selectReturns(inventoryItems, [{ listingId: LISTING_ID, quantity: 2 }])
      .selectReturns(productVariants, [{ listingId: LISTING_ID, name: "Black" }])
      .selectReturns(savedListings, [{ id: "saved-1" }]);

    const response = await GET(new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    // The single-listing branch packs the whole product, not a one-item list.
    expect(body.listing.id).toBe(LISTING_ID);
    expect(body.media).toHaveLength(1);
    expect(body.inventory.quantity).toBe(2);
    expect(body.variants).toHaveLength(1);
    expect(body.isSaved).toBe(true);
  });

  it("answers 404 for a listing that does not exist", async () => {
    fakeDb.selectReturns(marketplaceListings, []);

    const response = await GET(new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Listing not found" });
    // None of the child reads are made for a listing that is not there.
    expect(fakeDb.reads).toEqual(["marketplace_listings"]);
  });

  it("refuses a malformed listing id and seller filter instead of casting them", async () => {
    const byId = await GET(new Request("http://localhost/api/marketplace?id=not-a-uuid"));
    expect(byId.status).toBe(400);
    expect(await byId.json()).toEqual({ error: "Invalid listing id" });

    const bySeller = await GET(
      new Request("http://localhost/api/marketplace?sellerId=not-a-uuid"),
    );
    expect(bySeller.status).toBe(400);
    expect(await bySeller.json()).toEqual({ error: "Invalid seller id" });

    expectGatedNone("reads");
  });
});

describe("GET /api/marketplace list read — the category name", () => {
  /**
   * A listing stores its category as an id, but a card is rendered from these
   * rows — and a badge that prints a uuid is a database key wearing a name's
   * clothing. The join is the same shape the Pages route reads: `left`, so a
   * listing with no category (or a since-deleted one) still lists, with the
   * name `null` beside it.
   */

  it("carries the category's name beside its id on every listed row", async () => {
    // Both reads of the table are scripted: the page, then the count the
    // pagination header is made from.
    fakeDb
      .selectReturns(marketplaceListings, [
        {
          id: LISTING_ID,
          title: "Mechanical keyboard",
          description: null,
          categoryId: CATEGORY_ID,
          categoryName: "Technology",
          priceMin: 95,
          priceMax: 95,
          condition: "Good",
          location: "Austin, Texas",
          status: "active",
          createdAt: "2026-09-20T09:00:00.000Z",
        },
      ])
      .selectReturns(marketplaceListings, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: LISTING_ID,
      title: "Mechanical keyboard",
      categoryId: CATEGORY_ID,
      categoryName: "Technology",
    });
  });

  it("still lists a listing whose category has no row, naming it nothing", async () => {
    // The join is left, so an orphaned or absent category reads `null` — the
    // row is listed and the card renders no badge, not a broken one.
    fakeDb
      .selectReturns(marketplaceListings, [
        {
          id: LISTING_ID,
          title: "Desk setup bundle",
          categoryId: null,
          categoryName: null,
          priceMin: 180,
          priceMax: 220,
          status: "active",
          createdAt: "2026-09-20T09:00:00.000Z",
        },
      ])
      .selectReturns(marketplaceListings, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].categoryName).toBeNull();
  });

  it("filters by the category id the query asks for, not by name", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [])
      .selectReturns(marketplaceListings, [{ total: 0 }]);

    const response = await GET(
      new Request(`http://localhost/api/marketplace?category=${CATEGORY_ID}`),
    );

    expect(response.status).toBe(200);
    // The filter is a category *id* bound into the read — the names ride the
    // rows out, they are not what the rows are filtered by.
    expect(fakeDb.selectParams[0]).toContain(CATEGORY_ID);
    // And it is bound into the listing's own column: the read's predicate
    // references only `marketplace_listings`, never the joined row.
    expect(fakeDb.selectWheres[0]).not.toContain("categories");
  });

  it("accepts the category's display name, which is what the filter chips send", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [
        { id: LISTING_ID, title: "Mechanical keyboard", categoryName: "Technology" },
      ])
      .selectReturns(marketplaceListings, [{ total: 1 }]);

    const response = await GET(
      new Request("http://localhost/api/marketplace?category=Technology"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    // A name is not a uuid, so the filter must bind it against the category
    // row the read joined in — binding it into the listing's uuid column is
    // the cast failure this parameter used to be. The value and the table it
    // is bound against are pinned separately: either alone would pass a
    // route that merely echoed the name into the wrong predicate.
    expect(fakeDb.selectParams[0]).toContain("Technology");
    expect(fakeDb.selectWheres[0]).toContain("categories");
  });

  it("accepts the category's slug the same way", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [])
      .selectReturns(marketplaceListings, [{ total: 0 }]);

    const response = await GET(
      new Request("http://localhost/api/marketplace?category=home-garden"),
    );

    expect(response.status).toBe(200);
    // Name and slug are the same `or` — either shape resolves the row, and
    // both land against the joined category row, not the listing's column.
    expect(fakeDb.selectParams[0]).toContain("home-garden");
    expect(fakeDb.selectWheres[0]).toContain("categories");
  });

  it("answers an empty list, not a cast error, for a category nothing is named", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [])
      .selectReturns(marketplaceListings, [{ total: 0 }]);

    const response = await GET(
      new Request("http://localhost/api/marketplace?category=Nonexistent"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // An unknown name is a filter that matched nothing, not a server error —
    // the page's own chips make this request on the first click.
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("counts under the same category filter the page was read under", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [
        { id: LISTING_ID, title: "Mechanical keyboard", categoryName: "Technology" },
      ])
      .selectReturns(marketplaceListings, [{ total: 1 }]);

    const response = await GET(
      new Request("http://localhost/api/marketplace?category=Technology"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // The pagination header describes *this* list: the count read carries the
    // same bound filter, so total is the filtered total, not every listing.
    expect(body.pagination.total).toBe(1);
    expect(fakeDb.selectParams[1]).toContain("Technology");
    expect(fakeDb.selectWheres[1]).toContain("categories");
  });
});

describe("GET /api/marketplace list read — the viewer's saved flags", () => {
  /**
   * The list is what a card is rendered from, so the viewer's own `isSaved`
   * rides every listed row — the same contract the single-listing branch has
   * always answered. One read carries the whole page's flags (the page's ids,
   * not a query per row), and the visitor discipline carries over too: with no
   * session the flag is answered `false` and the saved table is never read.
   */

  it("carries isSaved on the listed rows, from one read for the whole page", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [
        { id: LISTING_ID, title: "Mechanical keyboard", categoryName: "Technology" },
        { id: OTHER_LISTING_ID, title: "Desk mat", categoryName: "Technology" },
      ])
      .selectReturns(marketplaceListings, [{ total: 2 }])
      .selectReturns(savedListings, [{ listingId: LISTING_ID }]);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].isSaved).toBe(true);
    expect(body.data[1].isSaved).toBe(false);
    // The flags are the third read (page, count, flags) — one read, not one
    // per row — and it is bound to the viewer and the page's ids, the way the
    // category filter above is pinned by its own shape.
    expect(fakeDb.reads).toEqual([
      "marketplace_listings",
      "marketplace_listings",
      "saved_listings",
    ]);
    expect(fakeDb.selectWheres[2]).toContain("saved_listings");
    expect(fakeDb.selectParams[2]).toContain("seller-1");
    expect(fakeDb.selectParams[2]).toContain(LISTING_ID);
    expect(fakeDb.selectParams[2]).toContain(OTHER_LISTING_ID);
  });

  it("answers isSaved false on every row when the member has saved nothing", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, title: "Camera" }])
      .selectReturns(marketplaceListings, [{ total: 1 }])
      .selectReturns(savedListings, []);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].isSaved).toBe(false);
  });

  it("answers isSaved false for a visitor without the saved read", async () => {
    session.userId = null;
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, title: "Camera" }])
      .selectReturns(marketplaceListings, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].isSaved).toBe(false);
    expect(fakeDb.reads).not.toContain("saved_listings");
  });

  it("makes no saved read for an empty page", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [])
      .selectReturns(marketplaceListings, [{ total: 0 }]);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(fakeDb.reads).not.toContain("saved_listings");
  });
});

describe("GET /api/marketplace as a visitor", () => {
  /**
   * Browsing is the posture the signed-out header advertises: no session, and
   * no 401 hollow page. `beforeEach` signs every other case in, so these set
   * `session.userId` to null explicitly — the visitor the header's links are
   * served to. The writes stay member-only, pinned in the describe below.
   */
  it("answers the public list with data, not a 401", async () => {
    session.userId = null;
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, title: "Camera" }])
      .selectReturns(marketplaceListings, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/marketplace"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Camera");
  });

  it("reads one listing for a visitor and answers isSaved false without the saved read", async () => {
    session.userId = null;
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, title: "Camera" }])
      .selectReturns(listingMedia, [])
      .selectReturns(inventoryItems, [])
      .selectReturns(productVariants, []);

    const response = await GET(new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    // The visitor's answer, not a member's default: `false` because there is
    // nobody to have saved anything, which is why the per-viewer read is never
    // made — its table is absent from the reads the fake recorded.
    expect(body.isSaved).toBe(false);
    expect(fakeDb.reads).not.toContain("saved_listings");
  });
});

describe("writes stay member-only", () => {
  // The other half of the same posture: discovery is public, but a listing is
  // created, edited and removed by a member — the write guards answer 401
  // before they read or write anything.
  it("answers 401 on POST, PUT and DELETE without a session", async () => {
    session.userId = null;

    const post = await POST(jsonRequest("POST", "/api/marketplace", { title: "Camera" }));
    const put = await PUT(jsonRequest("PUT", "/api/marketplace", { id: LISTING_ID, title: "Renamed" }));
    const del = await DELETE(
      new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`, { method: "DELETE" }),
    );

    expect(post.status).toBe(401);
    expect(put.status).toBe(401);
    expect(del.status).toBe(401);
    expectGatedNone("writes");
  });
});

describe("POST /api/marketplace", () => {
  it("writes the listing and every child row, in order, keyed by the new id", async () => {
    fakeDb.insertReturns(marketplaceListings, [{ id: LISTING_ID, title: "Camera" }]);

    const response = await POST(
      jsonRequest("POST", "/api/marketplace", {
        title: "Camera",
        media: [{ url: MEDIA_URL, altText: "Front" }],
        variants: [{ name: "Black", sku: "SKU-1", price: 100, stockQuantity: 3 }],
        inventory: { quantity: 5, sku: "SKU-1" },
      }),
    );

    expect(response.status).toBe(201);
    // The listing first, then the children that name its id — and the listing is
    // a draft, so an incomplete one never reaches the active listing.
    expectGatedSequence("writes", [
      "marketplace_listings",
      "listing_media",
      "product_variants",
      "inventory_items",
    ]);
    expectGatedInsert(marketplaceListings, {
      first: true,
      values: expect.objectContaining({ sellerId: "seller-1", title: "Camera", status: "draft" }),
    });
    expectGatedInsert(listingMedia, {
      values: [{ listingId: LISTING_ID, url: MEDIA_URL, altText: "Front", order: 0 }],
    });
    expectGatedInsert(productVariants, {
      values: [
        {
          listingId: LISTING_ID,
          name: "Black",
          sku: "SKU-1",
          price: 100,
          stockQuantity: 3,
          imageUrl: undefined,
        },
      ],
    });
    expectGatedInsert(inventoryItems, {
      values: expect.objectContaining({ listingId: LISTING_ID, quantity: 5, lowStockThreshold: 5 }),
    });
  });

  it("refuses a listing with no title, writing nothing", async () => {
    const response = await POST(jsonRequest("POST", "/api/marketplace", { description: "x" }));

    expect(response.status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a category id that is not uuid-shaped, writing nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/marketplace", { title: "Camera", categoryId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("writes");
  });

  it("answers 500 and writes no child rows when the listing itself cannot be created", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextInsert(marketplaceListings, new Error("unique violation"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/marketplace", {
          title: "Camera",
          media: [{ url: MEDIA_URL }],
        }),
      );

      expect(response.status).toBe(500);
      // The children are never attempted, so there is no media row pointing at a
      // listing that does not exist.
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("PUT /api/marketplace", () => {
  it("refuses an update with no id, reading and writing nothing", async () => {
    const response = await PUT(jsonRequest("PUT", "/api/marketplace", { title: "Renamed" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Listing ID is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an update with a malformed id, reading and writing nothing", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/marketplace", { id: "not-a-uuid", title: "Renamed" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid listing id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a category id that is not uuid-shaped", async () => {
    const response = await PUT(
      jsonRequest("PUT", "/api/marketplace", { id: LISTING_ID, categoryId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid category id" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a listing the caller does not own, writing nothing", async () => {
    // An empty ownership read is how "somebody else's listing" arrives here: the
    // seller id is in the `where`, which the fake does not evaluate.
    fakeDb.selectReturns(marketplaceListings, []);

    const response = await PUT(
      jsonRequest("PUT", "/api/marketplace", { id: LISTING_ID, title: "Mine now" }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("updates the owner's listing", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, sellerId: "seller-1" }])
      .updateReturns(marketplaceListings, [{ id: LISTING_ID, title: "Renamed" }]);

    const response = await PUT(
      jsonRequest("PUT", "/api/marketplace", { id: LISTING_ID, title: "Renamed" }),
    );

    expect(response.status).toBe(200);
    expectGatedSequence("writes", [{ table: "marketplace_listings", values: { title: "Renamed" } }]);
  });

  it("answers 500 when the update fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID, sellerId: "seller-1" }])
      .failNextUpdate(marketplaceListings, new Error("database unavailable"));
    try {
      const response = await PUT(
        jsonRequest("PUT", "/api/marketplace", { id: LISTING_ID, title: "Mine now" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to update listing" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("DELETE /api/marketplace", () => {
  it("refuses a delete with no id, writing nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/marketplace", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Listing ID is required" });
    expectGatedNone("writes");
  });

  it("refuses a delete with a malformed id, writing nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/marketplace?id=not-a-uuid", { method: "DELETE" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid listing id" });
    expectGatedNone("writes");
  });

  it("soft-deletes the owner's listing rather than removing the row", async () => {
    fakeDb.updateReturns(marketplaceListings, [{ id: LISTING_ID }]);

    const response = await DELETE(
      new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expectGatedSequence("writes", [
      {
        table: "marketplace_listings",
        values: { status: "removed", deletedAt: expect.any(Date) },
      },
    ]);
    expectGatedNone("deletes");
  });

  it("answers 404, deleting nothing, when no row belongs to the caller", async () => {
    fakeDb.updateReturns(marketplaceListings, []);

    const response = await DELETE(
      new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("deletes");
  });

  it("answers 500 when the soft delete fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextUpdate(marketplaceListings, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request(`http://localhost/api/marketplace?id=${LISTING_ID}`, { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to delete listing" });
      expectGatedNone("writes");
      expectGatedNone("deletes");
    } finally {
      silence.mockRestore();
    }
  });
});
