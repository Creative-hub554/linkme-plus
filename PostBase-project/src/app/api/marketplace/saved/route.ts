import { db } from "@/lib/db";
import { listingFirstPhoto } from "@/lib/db/listing-first-photo";
import { categories, marketplaceListings, savedListings } from "@/lib/db/schema";
import {
  optionalAuth,
  requireAuth,
  successResponse,
  errorResponse,
  paginatedResponse,
} from "@/lib/api-helpers";
import { eq, and, desc, count } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

/**
 * The saved-listings write path: a member's own pair of keys, toggled by the
 * card's heart. `POST` saves, `DELETE` unsaves, and both answer what the state
 * now *is* (`{ saved: true | false }`), so the client can reconcile from the
 * server's word rather than from its own guess.
 */
/**
 * The saved shelf itself: the member's saved pairs, dressed for a card.
 *
 * The flag contract is the marketplace list's, pointed the other way: the
 * marketplace grid reads *every* listing and answers `isSaved` per row; the
 * shelf reads only the saved ones and answers `isSaved: true` on each — the
 * same field, so a card is rendered from either without knowing which read
 * fed it. A visitor is answered an empty shelf without the read at all, the
 * same discipline the grid follows (the middleware is what turns a typed URL
 * around before a visitor reaches the page that asks).
 */
export async function GET(request: Request) {
  const { session } = await optionalAuth(request);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  try {
    if (!session) {
      return paginatedResponse([], 0, page, limit);
    }

    // The rows are the member's own saved pairs joined to the listing they
    // name — the category's human name rides the same left join the
    // marketplace list reads through, because a card is rendered from these
    // rows and an id in a badge is a key wearing a name's clothing. Only a
    // live listing sits on the shelf: a saved row whose listing left the
    // browse surface (drafted, removed) has nothing to show, and rendering it
    // would be a broken card where a heart used to be.
    const shelfRead = () =>
      db
        .select({
          id: marketplaceListings.id,
          title: marketplaceListings.title,
          description: marketplaceListings.description,
          categoryId: marketplaceListings.categoryId,
          categoryName: categories.name,
          priceMin: marketplaceListings.priceMin,
          priceMax: marketplaceListings.priceMax,
          condition: marketplaceListings.condition,
          location: marketplaceListings.location,
          status: marketplaceListings.status,
          // The card's photo — the same one read the grid calls, so a listing
          // keeps its picture when it moves between the two shelves.
          imageUrl: listingFirstPhoto(),
          createdAt: marketplaceListings.createdAt,
        })
        .from(savedListings)
        .innerJoin(marketplaceListings, eq(savedListings.listingId, marketplaceListings.id))
        .leftJoin(categories, eq(marketplaceListings.categoryId, categories.id))
        .where(
          and(
            eq(savedListings.userId, session.user.id),
            eq(marketplaceListings.status, "active"),
          ),
        );

    const result = await shelfRead().orderBy(desc(savedListings.createdAt)).limit(limit).offset(offset);

    // Counted under the same predicate the shelf was read under — the
    // pagination header describes this shelf, so the page's total is the
    // member's own live saves, not every saved row in the table. The count
    // needs no category join: a left join preserves rows, so it cannot move
    // the number, and the cheaper read is the honest one.
    const [{ total }] = await db
      .select({ total: count() })
      .from(savedListings)
      .innerJoin(marketplaceListings, eq(savedListings.listingId, marketplaceListings.id))
      .where(
        and(
          eq(savedListings.userId, session.user.id),
          eq(marketplaceListings.status, "active"),
        ),
      );

    return paginatedResponse(
      result.map((listing) => ({ ...listing, isSaved: true })),
      total,
      page,
      limit,
    );
  } catch (err) {
    console.error("Get saved listings error:", err);
    return errorResponse("Failed to fetch saved listings", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { listingId } = body;

    // `saved_listings.listing_id` is a `uuid` column, so a value that is not
    // one is a 400 rather than a cast failure the catch reports as a 500.
    if (!listingId) {
      return errorResponse("Listing id is required");
    }
    if (typeof listingId !== "string" || !isUuid(listingId)) {
      return errorResponse("Invalid listing id", 400);
    }

    // Saving requires a listing to point at: a listing that is not there — a
    // stale card, a hand-built request — is a 404, not an orphan row waiting
    // for a listing that never existed.
    const [listing] = await db
      .select({ id: marketplaceListings.id })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, listingId));
    if (!listing) {
      return errorResponse("Listing not found", 404);
    }

    // A heart already filled is asked again and answered, not written twice:
    // the save is idempotent by construction (the pair is the key), so a
    // second press re-answers the truth and changes nothing.
    const [existing] = await db
      .select({ id: savedListings.id })
      .from(savedListings)
      .where(
        and(
          eq(savedListings.userId, session.user.id),
          eq(savedListings.listingId, listingId),
        ),
      );
    if (existing) {
      return successResponse({ saved: true });
    }

    const [saved] = await db
      .insert(savedListings)
      .values({
        userId: session.user.id,
        listingId,
      })
      .returning({ userId: savedListings.userId, listingId: savedListings.listingId });

    return successResponse({ saved: true, listingId: saved.listingId }, 201);
  } catch (err) {
    console.error("Save listing error:", err);
    return errorResponse("Failed to save listing", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const listingId = url.searchParams.get("listingId");

    if (!listingId) {
      return errorResponse("Listing id is required");
    }
    if (!isUuid(listingId)) {
      return errorResponse("Invalid listing id", 400);
    }

    // The delete is narrowed to the viewer's own pair — the predicate is what
    // keeps one member's press from clearing another's saved list. Un-saving
    // what is not saved changes nothing: the heart asked to be unfilled, and
    // successfully unfilled is what it is, so the request is answered `false`
    // (200) rather than judged by whether a row happened to be there.
    await db
      .delete(savedListings)
      .where(
        and(
          eq(savedListings.userId, session.user.id),
          eq(savedListings.listingId, listingId),
        ),
      );

    return successResponse({ saved: false });
  } catch (err) {
    console.error("Unsave listing error:", err);
    return errorResponse("Failed to unsave listing", 500);
  }
}
