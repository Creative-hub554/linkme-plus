import { db } from "@/lib/db";
import { inventoryItems, inventoryMovements, marketplaceListings } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, desc } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const listingId = url.searchParams.get("listingId");

  if (!listingId) {
    return errorResponse("Listing ID is required");
  }
  if (!isUuid(listingId)) return errorResponse("Invalid listing ID");

  try {
    // Inventory is the seller's own stock, so reading it is scoped to the
    // listing's seller — the same `seller_id` edge the marketplace route uses
    // for its own writes. A listing that is not there is a 404 on the read.
    const [listing] = await db
      .select({ sellerId: marketplaceListings.sellerId })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, listingId));

    if (!listing) {
      return errorResponse("Listing not found", 404);
    }

    if (listing.sellerId !== session.user.id) {
      return errorResponse("Only the seller can view this inventory", 403);
    }

    const [inventory] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.listingId, listingId));

    if (!inventory) {
      return errorResponse("Inventory not found", 404);
    }

    // Get recent movements
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.inventoryId, inventory.id))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(20);

    return successResponse({ inventory, movements });
  } catch (err) {
    console.error("Get inventory error:", err);
    return errorResponse("Failed to fetch inventory", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { inventoryId, variantId, type, quantity, reason } = body;

    if (!inventoryId || !type || quantity === undefined) {
      return errorResponse("Inventory ID, type, and quantity are required");
    }
    if (typeof inventoryId !== "string" || !isUuid(inventoryId)) return errorResponse("Invalid inventory ID");
    if (!["added", "sold", "damaged", "expired", "adjusted", "returned"].includes(type)) return errorResponse("Invalid movement type");
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647 || (type !== "adjusted" && quantity === 0)) return errorResponse("Quantity must be a valid non-negative whole number");
    if (variantId) return errorResponse("Adjust the base product here; variant stock adjustments are not supported");
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 100)) return errorResponse("Reason must be at most 100 characters");

    return await db.transaction(async tx => {

    // Get current inventory
    const [inventory] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, inventoryId)).for("update");

    if (!inventory) {
      return errorResponse("Inventory not found", 404);
    }

    // Only the listing's seller may move its stock: the quantity is theirs to
    // keep, and every movement is a record of what they sold, lost or counted.
    const [listing] = await tx
      .select({ sellerId: marketplaceListings.sellerId })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, inventory.listingId));

    if (listing?.sellerId !== session.user.id) {
      return errorResponse("Only the seller can adjust this inventory", 403);
    }

    // Calculate new quantity
    let newQuantity = inventory.quantity ?? 0;
    switch (type) {
      case "added":
        newQuantity += quantity;
        break;
      case "sold":
      case "damaged":
      case "expired":
        newQuantity -= quantity;
        break;
      case "adjusted":
        newQuantity = quantity;
        break;
      case "returned":
        newQuantity += quantity;
        break;
    }

    if (newQuantity < 0 || newQuantity > 2147483647) return errorResponse("This movement would produce invalid stock", 409);
    // Update inventory
    await tx
      .update(inventoryItems)
      .set({ quantity: newQuantity })
      .where(eq(inventoryItems.id, inventoryId));

    // Record movement
    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        inventoryId,
        variantId,
        type,
        quantity,
        reason,
        actorId: session.user.id,
      })
      .returning();

    return successResponse({ movement, newQuantity }, 201);
    });
  } catch (err) {
    console.error("Create inventory movement error:", err);
    return errorResponse("Failed to create inventory movement", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  try {
    const { listingId, sku, unitCost, lowStockThreshold = 5 } = await request.json();
    if (typeof listingId !== "string" || !isUuid(listingId)) return errorResponse("Invalid listing ID");
    if (sku !== undefined && (typeof sku !== "string" || sku.length > 50)) return errorResponse("Invalid SKU");
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 2147483647) return errorResponse("Invalid low-stock threshold");
    if (unitCost !== undefined && unitCost !== null && (!Number.isInteger(unitCost) || unitCost < 0 || unitCost > 2147483647)) return errorResponse("Invalid unit cost");
    return await db.transaction(async tx => {
      const [listing] = await tx.select({ sellerId: marketplaceListings.sellerId }).from(marketplaceListings).where(eq(marketplaceListings.id, listingId)).for("update");
      if (!listing) return errorResponse("Listing not found", 404);
      if (listing.sellerId !== session.user.id) return errorResponse("Only the seller can manage inventory", 403);
      const [existing] = await tx.select().from(inventoryItems).where(eq(inventoryItems.listingId, listingId));
      const values = { sku, unitCost, lowStockThreshold };
      const [inventory] = existing
        ? await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, existing.id)).returning()
        : await tx.insert(inventoryItems).values({ ...values, listingId, quantity: 0 }).onConflictDoNothing({ target: inventoryItems.listingId }).returning();
      if (!inventory) return errorResponse("Stock setup changed. Please reload.", 409);
      return successResponse({ inventory });
    });
  } catch { return errorResponse("Unable to configure inventory", 500); }
}
