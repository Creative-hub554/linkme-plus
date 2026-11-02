import { lockSeller, sellerUsage, sellerPublicVisibility } from "@/lib/seller-entitlements";
import { sellerLimitReached } from "@/lib/plan-entitlements";
import { offsetPagination } from "@/lib/offset-pagination";
import { db } from "@/lib/db";
import { categories, marketplaceListings, listingMedia, inventoryItems, productVariants, savedListings } from "@/lib/db/schema";
import {
  optionalAuth,
  requireAuth,
  successResponse,
  errorResponse,
  paginatedResponse,
} from "@/lib/api-helpers";
import { eq, and, inArray, notInArray, or, ilike, gte, lte, sql, count, desc, isNull } from "drizzle-orm";
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
  const mine = url.searchParams.get("mine") === "true";
  if (mine && !session) return errorResponse("Unauthorized", 401);
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
  const { page, limit, offset } = offsetPagination(url.searchParams);
  const search = url.searchParams.get("q")?.trim().slice(0, 200);
  const min = url.searchParams.get("minPrice");
  const max = url.searchParams.get("maxPrice");
  if ((min && (!Number.isSafeInteger(Number(min)) || Number(min) < 0 || Number(min) > 2147483647)) || (max && (!Number.isSafeInteger(Number(max)) || Number(max) < 0 || Number(max) > 2147483647))) return errorResponse("Invalid price filter");
  if (min && max && Number(min) > Number(max)) return errorResponse("Minimum price must not exceed maximum price");
  const location = url.searchParams.get("location")?.trim();
  const conditions = and(
    mine && session ? eq(marketplaceListings.sellerId, session.user.id) : eq(marketplaceListings.status, "active"), isNull(marketplaceListings.deletedAt),
    mine ? undefined : sellerPublicVisibility(),
    categoryFilter ?? sql`1 = 1`,
    sellerId ? eq(marketplaceListings.sellerId, sellerId) : sql`1 = 1`,
    search ? or(ilike(marketplaceListings.title, `%${search}%`), ilike(marketplaceListings.description, `%${search}%`)) : undefined,
    min ? gte(marketplaceListings.priceMin, Number(min)) : undefined,
    max ? lte(marketplaceListings.priceMin, Number(max)) : undefined,
    location ? ilike(marketplaceListings.location, `%${location}%`) : undefined,
  );

  try {
    if (listingId) {
      const [listing] = await db
        .select()
        .from(marketplaceListings)
        .where(and(eq(marketplaceListings.id, listingId), isNull(marketplaceListings.deletedAt), or(
          and(notInArray(marketplaceListings.status, ["draft", "removed"]), sellerPublicVisibility()),
          session ? eq(marketplaceListings.sellerId, session.user.id) : undefined,
        )));

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
        inventory: inventory && listing.sellerId !== session?.user.id
          ? { quantity: inventory.quantity, lowStockThreshold: inventory.lowStockThreshold }
          : inventory,
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
        createdAt: marketplaceListings.createdAt,
        image: sql<string | null>`(select url from listing_media where listing_id = ${marketplaceListings.id} order by "order" asc limit 1)`,
        sellerName: sql<string | null>`(select coalesce(p.display_name, u.username) from users u left join profiles p on p.user_id = u.id where u.id = ${marketplaceListings.sellerId})`,
      })
      .from(marketplaceListings)
      .leftJoin(categories, eq(marketplaceListings.categoryId, categories.id))
      .where(conditions)
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
      .where(conditions);

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

    if (typeof title !== "string" || !title.trim() || title.length > 200) {
      return errorResponse("Title is required");
    }
    if (priceMin !== undefined && (!Number.isSafeInteger(priceMin) || priceMin < 0 || priceMin > 2147483647)) return errorResponse("Invalid price");
    if (priceMax !== undefined && (!Number.isSafeInteger(priceMax) || priceMax < 0 || priceMax > 2147483647)) return errorResponse("Invalid price");
    if (categoryId !== undefined && categoryId !== null && (typeof categoryId !== "string" || !isUuid(categoryId))) {
      return errorResponse("Invalid category id", 400);
    }

    return await db.transaction(async tx => {
      await lockSeller(tx, session.user.id);
      const usage = await sellerUsage(tx, session.user.id);
      if (sellerLimitReached(usage.plan, "storedProducts", usage.storedProducts)) return errorResponse("Your inventory product limit has been reached. Upgrade your seller plan to add more products.", 409);
    // Create listing
    const [newListing] = await tx
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
      await tx.insert(listingMedia).values(
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
      await tx.insert(productVariants).values(
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
      await tx.insert(inventoryItems).values({
        listingId: newListing.id,
        quantity: inventory.quantity || 0,
        sku: inventory.sku,
        unitCost: inventory.unitCost,
        lowStockThreshold: inventory.lowStockThreshold || 5,
      });
    }

    return successResponse({ listing: newListing }, 201);
    });
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

    return await db.transaction(async tx => {
      await lockSeller(tx, session.user.id);
    // Check ownership
    const [existing] = await tx
      .select()
      .from(marketplaceListings)
      .where(and(eq(marketplaceListings.id, id), eq(marketplaceListings.sellerId, session.user.id)));

    if (!existing) {
      return errorResponse("Listing not found or unauthorized", 404);
    }

    const entersPublic = (status === "active" || status === "reserved") && existing.status !== "active" && existing.status !== "reserved";
    if (entersPublic) {
      const usage = await sellerUsage(tx, session.user.id);
      if (sellerLimitReached(usage.plan, "publicProducts", usage.publicProducts)) return errorResponse("Your public product limit has been reached. Unpublish another product or upgrade your plan.", 409);
    }
    const [updated] = await tx
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
    });
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
