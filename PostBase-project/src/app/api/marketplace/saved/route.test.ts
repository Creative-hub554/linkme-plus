import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The saved-listings route's write path.
 *
 * The heart on a card is the only client of this route, and what it needs
 * pinned is the pair of keys a press writes and clears: the insert is bound to
 * the *session's* user id (nobody saves into somebody else's list, and no body
 * field can say otherwise), the delete is narrowed by the same predicate, and
 * both answers report the state that now holds — `{ saved: true | false }` —
 * so the card reconciles from the server's word. Saving is idempotent by
 * construction (the pair is the key), so a second press on a filled heart is
 * answered, not written twice; un-saving what is not saved answers `false`
 * rather than a 404, because the heart asked to be unfilled and it now is.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb };
});

const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { DELETE, GET, POST } from "./route";
import { marketplaceListings, savedListings } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import {
  expectGatedDelete,
  expectGatedInsert,
  expectGatedNone,
  expectGatedSequence,
} from "@/test/expect-gated";

const LISTING_ID = "77777777-7777-4777-8777-777777777777";

function saveRequest(body?: unknown) {
  return new Request("http://localhost/api/marketplace/saved", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

function unsaveRequest(listingId?: string) {
  return new Request(
    `http://localhost/api/marketplace/saved${listingId ? `?listingId=${listingId}` : ""}`,
    { method: "DELETE" },
  );
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("POST /api/marketplace/saved", () => {
  it("refuses a visitor before touching the database", async () => {
    session.userId = null;

    const response = await POST(saveRequest({ listingId: LISTING_ID }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // Saving is a member's act: no listing lookup, no saved row.
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a request with no listing id and one that is not a uuid", async () => {
    const missing = await POST(saveRequest({}));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Listing id is required" });

    const malformed = await POST(saveRequest({ listingId: "not-a-uuid" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid listing id" });

    // A number is not an id, however uuid-like its digits look.
    const numeric = await POST(saveRequest({ listingId: 123456 }));
    expect(numeric.status).toBe(400);
    expect(await numeric.json()).toEqual({ error: "Invalid listing id" });

    // Nothing was read for any of them: the body is judged before the
    // database is asked for anything.
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 for a listing that does not exist, writing no orphan row", async () => {
    fakeDb.selectReturns(marketplaceListings, []);

    const response = await POST(saveRequest({ listingId: LISTING_ID }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Listing not found" });
    expect(fakeDb.reads).toEqual(["marketplace_listings"]);
    expectGatedNone("writes");
  });

  it("saves the session member's pairing of themselves with the listing", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID }])
      .selectReturns(savedListings, [])
      .insertReturns(savedListings, [{ userId: "member-1", listingId: LISTING_ID }]);

    const response = await POST(saveRequest({ listingId: LISTING_ID }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ saved: true, listingId: LISTING_ID });
    // The listing is resolved first (a save needs something to point at),
    // then the member's own pair is checked; the insert comes last.
    expectGatedSequence("reads", ["marketplace_listings", "saved_listings"]);
    // The user id is the session's, not a body field: the write carries the
    // pair the request authenticated, and nothing the request invented.
    expectGatedInsert(savedListings, {
      values: { userId: "member-1", listingId: LISTING_ID },
    });
  });

  it("answers an already-saved heart without writing a second row", async () => {
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID }])
      .selectReturns(savedListings, [{ id: "saved-1" }]);

    const response = await POST(saveRequest({ listingId: LISTING_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    // The pair was found; the answer is the state, not another insert.
    expectGatedNone("writes");
  });

  it("answers 500 when the insert fails, recording no completed write", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(marketplaceListings, [{ id: LISTING_ID }])
      .selectReturns(savedListings, [])
      .failNextInsert(savedListings);
    try {
      const response = await POST(saveRequest({ listingId: LISTING_ID }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to save listing" });
      // A rejected write is not recorded: it did not happen.
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/marketplace/saved — the shelf read", () => {
  /**
   * The flag contract pointed the other way: the marketplace grid reads every
   * listing and answers `isSaved` per row; the shelf reads only the saved ones
   * and answers `isSaved: true` on each — the same field, so a card is
   * rendered from either without knowing which read fed it. The visitor
   * discipline carries over too: an empty shelf answered without the read at
   * all, never a 401 hollow page.
   */

  it("answers the member's saved rows dressed for a card, each carrying isSaved", async () => {
    fakeDb
      .selectReturns(savedListings, [
        {
          id: LISTING_ID,
          title: "Vintage camera",
          categoryName: "Electronics",
          priceMin: 240,
          status: "active",
        },
      ])
      .selectReturns(savedListings, [{ total: 1 }]);

    const response = await GET(new Request("http://localhost/api/marketplace/saved"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Vintage camera");
    expect(body.data[0].categoryName).toBe("Electronics");
    // The flag is the shelf itself: the field the grid's cards read is
    // answered on this read too, true on every row.
    expect(body.data[0].isSaved).toBe(true);
    expect(body.pagination.total).toBe(1);
    // The reads are bound to the member — the shelf is theirs, and nothing
    // else's rows can reach it.
    expect(fakeDb.reads).toEqual(["saved_listings", "saved_listings"]);
    expect(fakeDb.selectParams[0]).toContain("member-1");
  });

  it("answers a visitor an empty shelf without reading the saved table", async () => {
    session.userId = null;

    const response = await GET(new Request("http://localhost/api/marketplace/saved"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
    // The flag discipline: no session, no read — the same answer the grid's
    // per-viewer flag skips.
    expect(fakeDb.reads).toEqual([]);
  });

  it("answers a member who saved nothing an empty shelf, from the read's own emptiness", async () => {
    fakeDb.selectReturns(savedListings, []).selectReturns(savedListings, [{ total: 0 }]);

    const response = await GET(new Request("http://localhost/api/marketplace/saved"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("answers 500 when the shelf read fails, recording no completed read", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(savedListings);
    try {
      const response = await GET(new Request("http://localhost/api/marketplace/saved"));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch saved listings" });
      // A rejected read is not recorded: the route asked, but got no answer.
      expectGatedNone("reads");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("DELETE /api/marketplace/saved", () => {
  it("refuses a visitor before touching the database", async () => {
    session.userId = null;

    const response = await DELETE(unsaveRequest(LISTING_ID));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expectGatedNone("reads");
    expectGatedNone("deletes");
  });

  it("refuses a request with no listing id and one that is not a uuid", async () => {
    const missing = await DELETE(unsaveRequest());
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Listing id is required" });

    const malformed = await DELETE(unsaveRequest("not-a-uuid"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid listing id" });

    expectGatedNone("deletes");
  });

  it("un-saves by the viewer's own pair — the predicate that keeps one member's press from clearing another's list", async () => {
    const response = await DELETE(unsaveRequest(LISTING_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: false });
    // The delete is narrowed to the session user *and* the listing — both
    // keys, not the listing alone.
    expectGatedDelete(savedListings, {
      where: "saved_listings",
      params: ["member-1", LISTING_ID],
    });
  });

  it("answers saved: false when nothing was saved, rather than judging the row count", async () => {
    // The fake's delete resolves no rows for a matchless predicate, which is
    // exactly the not-saved case: the heart asked to be unfilled, and
    // successfully unfilled is what it is — 200 with the state, never a 404.
    const response = await DELETE(unsaveRequest(LISTING_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: false });
    expectGatedSequence("deletes", ["saved_listings"]);
  });

  it("answers 500 when the un-save write fails, recording no delete", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextDelete(savedListings);
    try {
      const response = await DELETE(unsaveRequest(LISTING_ID));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to unsave listing" });
      // A rejected write is not recorded: it did not happen.
      expectGatedNone("deletes");
    } finally {
      silence.mockRestore();
    }
  });
});
