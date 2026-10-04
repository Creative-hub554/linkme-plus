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

import { GET, POST } from "./route";
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
  it("requires an inventory id, a type and a quantity, reading nothing", async () => {
    const response = await POST(
      jsonRequest("POST", "/api/marketplace/inventory", { inventoryId: INVENTORY_ID }),
    );

    expect(response.status).toBe(400);
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
