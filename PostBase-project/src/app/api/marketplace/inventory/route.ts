import { db } from "@/lib/db";
import { inventoryItems, inventoryMovements, marketplaceListings } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, desc } from "drizzle-orm";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const listingId = url.searchParams.get("listingId");

  if (!listingId) {
    return errorResponse("Listing ID is required");
  }

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

    if (!inventoryId || !type || !quantity) {
      return errorResponse("Inventory ID, type, and quantity are required");
    }

    // Get current inventory
    const [inventory] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, inventoryId));

    if (!inventory) {
      return errorResponse("Inventory not found", 404);
    }

    // Only the listing's seller may move its stock: the quantity is theirs to
    // keep, and every movement is a record of what they sold, lost or counted.
    const [listing] = await db
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

    // Update inventory
    await db
      .update(inventoryItems)
      .set({ quantity: newQuantity })
      .where(eq(inventoryItems.id, inventoryId));

    // Record movement
    const [movement] = await db
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
  } catch (err) {
    console.error("Create inventory movement error:", err);
    return errorResponse("Failed to create inventory movement", 500);
  }
}
