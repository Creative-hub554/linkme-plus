import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The marketplace inventory route: whose stock is it, and what a movement does.
 *
 * A listing's stock belongs to the listing's **seller** — `inventory_items`
 * names a listing and `marketplace_listings.seller_id` names its owner — so both
 * methods are scoped to that seller, the same ownership edge the marketplace
 * route itself uses. `GET` answers `404` for a listing that is not there and
 * `403` for a signed-in member who does not own it, both **before** the stock or
 * its movements are read; `POST` reads the inventory row (`404` if it is gone)
 * and then refuses a stranger with `403` **before** any write. The movement
 * itself is pinned as two writes in order: the `inventory_items` quantity, then
 * the `inventory_movements` row that records who moved it.
 *
 * The fake `@/lib/db` is table-keyed and does not evaluate `where`, so the
 * predicates here are not what the tests read — the route's answer to a read
 * that returned nothing, and the writes it did or did not make, are. That is the
 * same limit the other route tests in this app record.
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

import { GET, POST, PUT } from "./route";
import { inventoryItems, inventoryMovements, marketplaceListings } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

const LISTING_ID = "99999999-9999-4999-8999-999999999999";
const INVENTORY_ID = "88888888-8888-4888-8888-888888888888";
const MOVEMENT_ID = "77777777-7777-4777-8777-777777777777";

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

describe("GET /api/marketplace/inventory", () => {
  it("requires a listing id, reading nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/marketplace/inventory", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Listing ID is required" });
    expectGatedNone("reads");
  });

  it("refuses a listing id that is not a uuid, reading nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/marketplace/inventory?listingId=not-a-uuid", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid listing ID" });
    expectGatedNone("reads");
  });

  it("answers 404 when the listing does not exist, reading no stock", async () => {
    fakeDb.selectReturns(marketplaceListings, []);

    const response = await GET(
      new Request(`http://localhost/api/marketplace/inventory?listingId=${LISTING_ID}`, {
        method: "GET",
      }),
    );

    expect(response.status).toBe(404);
    expect(fakeDb.reads).not.toContain("inventory_items");
  });

  it("refuses a caller who is not the listing's seller, reading no stock", async () => {
    // Somebody else's listing: the seller id is compared to the session, and a
    // stranger never reaches the inventory row or its movements.
    fakeDb.selectReturns(marketplaceListings, [{ sellerId: "someone-else" }]);

    const response = await GET(
      new Request(`http://localhost/api/marketplace/inventory?listingId=${LISTING_ID}`, {
        method: "GET",
      }),
    );

    expect(response.status).toBe(403);
    expect(fakeDb.reads).not.toContain("inventory_items");
    expect(fakeDb.reads).not.toContain("inventory_movements");
  });

  it("answers 404 when the seller's listing has no inventory row", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .selectReturns(inventoryItems, []);

    const response = await GET(
      new Request(`http://localhost/api/marketplace/inventory?listingId=${LISTING_ID}`, {
        method: "GET",
      }),
    );

    expect(response.status).toBe(404);
    expect(fakeDb.reads).not.toContain("inventory_movements");
  });

  it("returns the stock and its recent movements for the seller", async () => {
    const inventory = { id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 };
    const movements = [{ id: MOVEMENT_ID, inventoryId: INVENTORY_ID, type: "added" }];
    fakeDb
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .selectReturns(inventoryItems, [inventory])
      .selectReturns(inventoryMovements, movements);

    const response = await GET(
      new Request(`http://localhost/api/marketplace/inventory?listingId=${LISTING_ID}`, {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inventory, movements });
    // The movements are read for the row that was found, after the stock.
    expectGatedSequence("reads", [
      "marketplace_listings",
      "inventory_items",
      "inventory_movements",
    ]);
  });

  it("answers 500 when the listing read fails, recording no read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(marketplaceListings, new Error("database unavailable"));
    try {
      const response = await GET(
        new Request(`http://localhost/api/marketplace/inventory?listingId=${LISTING_ID}`, {
          method: "GET",
        }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch inventory" });
      // The read never resolved, so the fake recorded nothing.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("POST /api/marketplace/inventory", () => {
  it("requires an inventory id, a type and a quantity, before any read", async () => {
    // Each of the three required fields in turn: the refusal is the required-
    // fields message, not a sibling's message for whatever the missing field
    // then fails to be.
    for (const body of [
      { inventoryId: INVENTORY_ID },
      { type: "added", quantity: 3 },
      { inventoryId: INVENTORY_ID, type: "added" },
    ]) {
      const response = await POST(jsonRequest("POST", "/api/marketplace/inventory", body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Inventory ID, type, and quantity are required",
      });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an inventory id that is not a uuid, before any read", async () => {
    for (const inventoryId of [123, "not-a-uuid"]) {
      const response = await POST(
        jsonRequest("POST", "/api/marketplace/inventory", {
          inventoryId,
          type: "added",
          quantity: 3,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid inventory ID" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a movement type outside the six it records, before any read", async () => {
    for (const type of ["shipped", "Added"]) {
      const response = await POST(
        jsonRequest("POST", "/api/marketplace/inventory", {
          inventoryId: INVENTORY_ID,
          type,
          quantity: 3,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid movement type" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a quantity that is not a non-negative whole number, before any read", async () => {
    // A fraction, a negative, an int4 overflow, and the zero a non-adjustment
    // may not carry — each is this guard's refusal, even though a later 404
    // would answer some of them once the guard is gone.
    for (const quantity of [1.5, -1, 2147483648, 0]) {
      const response = await POST(
        jsonRequest("POST", "/api/marketplace/inventory", {
          inventoryId: INVENTORY_ID,
          type: "added",
          quantity,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Quantity must be a valid non-negative whole number",
      });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a variant-scoped stock movement, before any read", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", {
        inventoryId: INVENTORY_ID,
        type: "added",
        quantity: 3,
        variantId: "variant-1",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Adjust the base product here — variant stock adjustments are not supported",
    });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a reason that is not a short string, before any read", async () => {
    for (const reason of [123, "x".repeat(101)]) {
      const response = await POST(
        jsonRequest("POST", "/api/marketplace/inventory", {
          inventoryId: INVENTORY_ID,
          type: "added",
          quantity: 3,
          reason,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Reason must be at most 100 characters" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 when the inventory does not exist, writing nothing", async () => {
    fakeDb.selectReturns(inventoryItems, []);

    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", {
        inventoryId: INVENTORY_ID,
        type: "added",
        quantity: 3,
      }),
    );

    expect(response.status).toBe(404);
    expectGatedNone("writes");
    // No row means no listing to check ownership against.
    expect(fakeDb.reads).not.toContain("marketplace_listings");
  });

  it("refuses a caller who does not own the listing, writing nothing", async () => {
    fakeDb
      .selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 }])
      .selectReturns(marketplaceListings, [{ sellerId: "someone-else" }]);

    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", {
        inventoryId: INVENTORY_ID,
        type: "added",
        quantity: 3,
      }),
    );

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("adds stock and records the movement as the seller, in that order", async () => {
    fakeDb
      .selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 }])
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .insertReturns(inventoryMovements, [{ id: MOVEMENT_ID, type: "added", quantity: 3 }]);

    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", {
        inventoryId: INVENTORY_ID,
        type: "added",
        quantity: 3,
        reason: "restock",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      movement: { id: MOVEMENT_ID, type: "added", quantity: 3 },
      newQuantity: 8,
    });
    // The quantity first, then the row that records it — and the actor is the
    // session's user, not anything the body carried.
    expectGatedSequence("writes", [
      { table: "inventory_items", values: { quantity: 8 } },
      {
        table: "inventory_movements",
        values: {
          inventoryId: INVENTORY_ID,
          variantId: undefined,
          type: "added",
          quantity: 3,
          reason: "restock",
          actorId: "seller-1",
        },
      },
    ]);
  });

  it("subtracts stock for a sale", async () => {
    fakeDb
      .selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 }])
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .insertReturns(inventoryMovements, [{ id: MOVEMENT_ID, type: "sold", quantity: 2 }]);

    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", {
        inventoryId: INVENTORY_ID,
        type: "sold",
        quantity: 2,
      }),
    );

    expect(response.status).toBe(201);
    expect((await response.json()).newQuantity).toBe(3);
    expectGatedUpdate(inventoryItems, { first: true, values: { quantity: 3 } });
  });

  it("sets an absolute quantity when the movement is an adjustment", async () => {
    fakeDb
      .selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 }])
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .insertReturns(inventoryMovements, [{ id: MOVEMENT_ID, type: "adjusted", quantity: 11 }]);

    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", {
        inventoryId: INVENTORY_ID,
        type: "adjusted",
        quantity: 11,
      }),
    );

    expect(response.status).toBe(201);
    // An adjustment is the counted number itself, not a delta.
    expectGatedUpdate(inventoryItems, { first: true, values: { quantity: 11 } });
  });

  it("answers 500 and writes nothing when the quantity update fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 }])
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .failNextUpdate(inventoryItems, new Error("database unavailable"));
    try {
      const response = await POST(
        jsonRequest("POST", "/api/marketplace/inventory", {
          inventoryId: INVENTORY_ID,
          type: "added",
          quantity: 3,
        }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to create inventory movement" });
      // The quantity never moved, so the movement that would record it is never
      // written either.
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
it("prevents a stock movement from making the quantity negative", async () => {
  fakeDb.selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 1 }]).selectReturns(marketplaceListings, [{ sellerId: "seller-1" }]);
  expect((await POST(jsonRequest("POST", "/api/marketplace/inventory", { inventoryId: INVENTORY_ID, type: "sold", quantity: 2 }))).status).toBe(409);
  expect(fakeDb.writes).toEqual([]);
});
it("allows a stock count to be corrected to zero", async () => {
  fakeDb.selectReturns(inventoryItems, [{ id: INVENTORY_ID, listingId: LISTING_ID, quantity: 5 }]).selectReturns(marketplaceListings, [{ sellerId: "seller-1" }]).insertReturns(inventoryMovements, [{ id: MOVEMENT_ID }]);
  expect((await POST(jsonRequest("POST", "/api/marketplace/inventory", { inventoryId: INVENTORY_ID, type: "adjusted", quantity: 0 }))).status).toBe(201);
  expect(fakeDb.writes[0].values).toEqual({ quantity: 0 });
});
it("does not allow a stranger to initialize someone else's inventory", async () => {
  fakeDb.selectReturns(marketplaceListings, [{ sellerId: "someone-else" }]);
  expect((await PUT(jsonRequest("PUT", "/api/marketplace/inventory", { listingId: LISTING_ID, sku: "NEW", lowStockThreshold: 5 }))).status).toBe(403); expect(fakeDb.writes).toEqual([]);
});

describe("PUT /api/marketplace/inventory", () => {
  const configure = (body: unknown) =>
    PUT(jsonRequest("PUT", "/api/marketplace/inventory", body));

  it("refuses a listing id that is missing, not a string, or not a uuid", async () => {
    for (const listingId of [undefined, 123, "not-a-uuid"]) {
      const response = await configure({ listingId, lowStockThreshold: 5 });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid listing ID" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a sku that is not a string or is longer than 50 characters", async () => {
    for (const sku of [123, "x".repeat(51)]) {
      const response = await configure({ listingId: LISTING_ID, sku, lowStockThreshold: 5 });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid SKU" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a low-stock threshold that is not a non-negative whole number", async () => {
    for (const lowStockThreshold of [1.5, -1, 2147483648]) {
      const response = await configure({ listingId: LISTING_ID, lowStockThreshold });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid low-stock threshold" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a unit cost that is present and not a non-negative whole number", async () => {
    for (const unitCost of [1.5, -1, 2147483648, "5"]) {
      const response = await configure({ listingId: LISTING_ID, unitCost, lowStockThreshold: 5 });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid unit cost" });
    }
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 when the listing does not exist, writing nothing", async () => {
    fakeDb.selectReturns(marketplaceListings, []);

    const response = await configure({ listingId: LISTING_ID, sku: "NEW", lowStockThreshold: 5 });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Listing not found" });
    expectGatedNone("writes");
  });

  it("answers 409 when the stock setup it read was replaced before the write", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ sellerId: "seller-1" }])
      .selectReturns(inventoryItems, [{ id: INVENTORY_ID }])
      .updateReturns(inventoryItems, []);

    const response = await configure({ listingId: LISTING_ID, sku: "NEW", lowStockThreshold: 5 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Stock setup changed. Please reload." });
  });

  it("answers 500 when the listing read fails, writing nothing", async () => {
    fakeDb.failNextSelect(marketplaceListings, new Error("database unavailable"));

    const response = await configure({ listingId: LISTING_ID, lowStockThreshold: 5 });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to configure inventory" });
    expectGatedNone("writes");
  });
});
