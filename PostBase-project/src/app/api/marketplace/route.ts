import { db } from "@/lib/db";
import { listingFirstPhoto } from "@/lib/db/listing-first-photo";
import { categories, marketplaceListings, listingMedia, inventoryItems, productVariants, savedListings } from "@/lib/db/schema";
import {
  optionalAuth,
  requireAuth,
  successResponse,
  errorResponse,
  paginatedResponse,
} from "@/lib/api-helpers";
import { eq, and, inArray, or, sql, count, desc } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

/** One entry of the `media` array a client posts when creating a listing. */
interface ListingMediaInput {
  url: string;
  altText?: string | null;
}

/** One entry of the `variants` array a client posts when creating a listing. */
interface ProductVariantInput {
  name: string;
  sku?: string | null;
  price: number;
  stockQuantity?: number | null;
  imageUrl?: string | null;
}

export async function GET(request: Request) {
  // Browsing is public: the marketplace is the product's discovery surface, and
  // the signed-out header advertises it to visitors. The session is read because
  // the single-listing branch carries the viewer's own "is this saved" flag —
  // a visitor simply gets `isSaved: false`, never a 401 hollow page.
  const { session } = await optionalAuth(request);

  const url = new URL(request.url);
  const listingId = url.searchParams.get("id");
  const sellerId = url.searchParams.get("sellerId");
  // Both are bound into `uuid` columns below, so a value that is not one is a
  // 400 rather than a cast failure the catch reports as a 500.
  if (listingId && !isUuid(listingId)) return errorResponse("Invalid listing id", 400);
  if (sellerId && !isUuid(sellerId)) return errorResponse("Invalid seller id", 400);
  // The category filter arrives in any of the three shapes a client holds:
  // the category's uuid (the oldest callers), its slug, or its display name —
  // what the page's own filter chips send. Which column the filter binds is
  // decided once, here, from the parameter's own shape, so both reads below
  // filter by value instead of guessing per read.
  const category = url.searchParams.get("category");
  const categoryFilter = !category
    ? null
    : isUuid(category)
      ? eq(marketplaceListings.categoryId, category)
      : or(eq(categories.name, category), eq(categories.slug, category));
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  try {
    if (listingId) {
      const [listing] = await db
        .select()
        .from(marketplaceListings)
        .where(eq(marketplaceListings.id, listingId));

      if (!listing) {
        return errorResponse("Listing not found", 404);
      }

      // Get media
      const media = await db
        .select()
        .from(listingMedia)
        .where(eq(listingMedia.listingId, listingId))
        .orderBy(listingMedia.order);

      // Get inventory
      const [inventory] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.listingId, listingId));

      // Get variants
      const variants = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.listingId, listingId));

      // Check if saved — a member's own flag, so a visitor (no session) is
      // answered without the read at all rather than filtering by a user id
      // that does not exist.
      const isSaved = session
        ? (
            await db
              .select()
              .from(savedListings)
              .where(
                and(
                  eq(savedListings.userId, session.user.id),
                  eq(savedListings.listingId, listingId),
                ),
              )
          )[0]
        : undefined;

      return successResponse({
        listing,
        media,
        inventory,
        variants,
        isSaved: !!isSaved,
      });
    }

    // List listings. The category's human name rides along through a left
    // join — the same shape the Pages route reads — because the listing only
    // stores the category's id, and a card is rendered from these rows: an id
    // in the badge is a database key wearing a name's clothing. `left` so a
    // listing with no category (or a since-deleted one) still lists.
    const query = db
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
        // The card's photo — the one read, spelled once in
        // `@/lib/db/listing-first-photo`, so the grid and the saved shelf
        // cannot drift apart.
        imageUrl: listingFirstPhoto(),
        createdAt: marketplaceListings.createdAt,
      })
      .from(marketplaceListings)
      .leftJoin(categories, eq(marketplaceListings.categoryId, categories.id))
      .where(
        and(
          eq(marketplaceListings.status, "active"),
          // The filter is already the right predicate for its shape — an id
          // binds the listing's column, a name or slug the joined row — and
          // `1 = 1` keeps `and` well-formed when there is no filter at all.
          categoryFilter ?? sql`1 = 1`,
          sellerId ? eq(marketplaceListings.sellerId, sellerId) : sql`1 = 1`
        )
      )
      .orderBy(desc(marketplaceListings.createdAt))
      .limit(limit)
      .offset(offset);

    const result = await query;

    // Counted under the same filters the page was read under — the pagination
    // header describes *this* list, so a category or seller filter that
    // narrowed the page narrows the total, and a filter that matches nothing
    // reads 0 rather than every active listing's count.
    const [{ total }] = await db
      .select({ total: count() })
      .from(marketplaceListings)
      .leftJoin(categories, eq(marketplaceListings.categoryId, categories.id))
      .where(
        and(
          eq(marketplaceListings.status, "active"),
          categoryFilter ?? sql`1 = 1`,
          sellerId ? eq(marketplaceListings.sellerId, sellerId) : sql`1 = 1`
        )
      );

    // The viewer's own saved flags ride the rows the same way the single-listing
    // branch answers `isSaved`: one read for the whole page — the page's ids, not
    // a query per row — and answered `false` without the read at all when nobody
    // is signed in, the same visitor discipline the single read follows.
    const savedIds =
      session && result.length > 0
        ? new Set(
            (
              await db
                .select({ listingId: savedListings.listingId })
                .from(savedListings)
                .where(
                  and(
                    eq(savedListings.userId, session.user.id),
                    inArray(savedListings.listingId, result.map((listing) => listing.id)),
                  ),
                )
            ).map((saved) => saved.listingId),
          )
        : new Set<string>();

    return paginatedResponse(
      result.map((listing) => ({ ...listing, isSaved: savedIds.has(listing.id) })),
      total,
      page,
      limit,
    );
  } catch (err) {
    console.error("Get listings error:", err);
    return errorResponse("Failed to fetch listings", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const {
      title,
      description,
      categoryId,
      priceMin,
      priceMax,
      condition,
      location,
      media,
      variants,
      inventory,
    } = body;

    if (!title) {
      return errorResponse("Title is required");
    }
    if (categoryId !== undefined && categoryId !== null && (typeof categoryId !== "string" || !isUuid(categoryId))) {
      return errorResponse("Invalid category id", 400);
    }

    // Create listing
    const [newListing] = await db
      .insert(marketplaceListings)
      .values({
        sellerId: session.user.id,
        title,
        description,
        categoryId,
        priceMin,
        priceMax,
        condition,
        location,
        status: "draft",
      })
      .returning();

    // Add media
    if (media && media.length > 0) {
      await db.insert(listingMedia).values(
        media.map((m: ListingMediaInput, index: number) => ({
          listingId: newListing.id,
          url: m.url,
          altText: m.altText,
          order: index,
        }))
      );
    }

    // Add variants
    if (variants && variants.length > 0) {
      await db.insert(productVariants).values(
        variants.map((v: ProductVariantInput) => ({
          listingId: newListing.id,
          name: v.name,
          sku: v.sku,
          price: v.price,
          stockQuantity: v.stockQuantity || 0,
          imageUrl: v.imageUrl,
        }))
      );
    }

    // Add inventory
    if (inventory) {
      await db.insert(inventoryItems).values({
        listingId: newListing.id,
        quantity: inventory.quantity || 0,
        sku: inventory.sku,
        unitCost: inventory.unitCost,
        lowStockThreshold: inventory.lowStockThreshold || 5,
      });
    }

    return successResponse({ listing: newListing }, 201);
  } catch (err) {
    console.error("Create listing error:", err);
    return errorResponse("Failed to create listing", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { id, title, description, categoryId, priceMin, priceMax, condition, location, status } = body;

    if (!id) {
      return errorResponse("Listing ID is required");
    }
    if (typeof id !== "string" || !isUuid(id)) {
      return errorResponse("Invalid listing id", 400);
    }
    if (categoryId !== undefined && categoryId !== null && (typeof categoryId !== "string" || !isUuid(categoryId))) {
      return errorResponse("Invalid category id", 400);
    }

    // Check ownership
    const [existing] = await db
      .select()
      .from(marketplaceListings)
      .where(and(eq(marketplaceListings.id, id), eq(marketplaceListings.sellerId, session.user.id)));

    if (!existing) {
      return errorResponse("Listing not found or unauthorized", 404);
    }

    const [updated] = await db
      .update(marketplaceListings)
      .set({
        title: title ?? undefined,
        description: description ?? undefined,
        categoryId: categoryId ?? undefined,
        priceMin: priceMin ?? undefined,
        priceMax: priceMax ?? undefined,
        condition: condition ?? undefined,
        location: location ?? undefined,
        status: status ?? undefined,
      })
      .where(eq(marketplaceListings.id, id))
      .returning();

    return successResponse({ listing: updated });
  } catch (err) {
    console.error("Update listing error:", err);
    return errorResponse("Failed to update listing", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return errorResponse("Listing ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid listing id", 400);
    }

    // Soft delete
    const [deleted] = await db
      .update(marketplaceListings)
      .set({ status: "removed", deletedAt: new Date() })
      .where(and(eq(marketplaceListings.id, id), eq(marketplaceListings.sellerId, session.user.id)))
      .returning();

    if (!deleted) {
      return errorResponse("Listing not found or unauthorized", 404);
    }

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete listing error:", err);
    return errorResponse("Failed to delete listing", 500);
  }
}
