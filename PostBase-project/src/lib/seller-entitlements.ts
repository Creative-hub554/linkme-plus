import { db } from "@/lib/db";
import { accountSubscriptions, marketplaceListings, users } from "@/lib/db/schema";
import { sellerPlans, isSellerPlan, type SellerPlan } from "@/lib/plan-entitlements";
import { and, eq, gt, lte, count, isNull, inArray, sql } from "drizzle-orm";
type Database = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function sellerUsage(tx: Database | typeof db, userId: string) {
  const now = new Date();
  const [subscription] = await tx.select().from(accountSubscriptions).where(and(eq(accountSubscriptions.userId, userId), eq(accountSubscriptions.kind, "seller"), lte(accountSubscriptions.startsAt, now), gt(accountSubscriptions.expiresAt, now)));
  const plan: SellerPlan = subscription && isSellerPlan(subscription.tier) ? subscription.tier : "free";
  const [stored] = await tx.select({ total: count() }).from(marketplaceListings).where(and(eq(marketplaceListings.sellerId, userId), isNull(marketplaceListings.deletedAt), inArray(marketplaceListings.status, ["draft", "active", "reserved", "sold", "expired"])));
  const [published] = await tx.select({ total: count() }).from(marketplaceListings).where(and(eq(marketplaceListings.sellerId, userId), isNull(marketplaceListings.deletedAt), inArray(marketplaceListings.status, ["active", "reserved"])));
  return { plan, limits: sellerPlans[plan], storedProducts: Number(stored?.total ?? 0), publicProducts: Number(published?.total ?? 0), expiresAt: subscription?.expiresAt ?? null };
}
// All quota-changing mutations lock the same account row before counting.
export async function lockSeller(tx: Database, userId: string) {
  const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  if (!user) throw new Error("Seller account is unavailable");
}

/** Deterministic public selection after downgrade; no product data is deleted. */
export function sellerPublicVisibility(alias: "marketplace_listings" | "l" = "marketplace_listings") {
  const ref = (column: string) => sql.raw(`"${alias}"."${column}"`);
  return sql`(${ref("status")} not in ('active','reserved') OR
    (select count(*) from marketplace_listings earlier
      where earlier.seller_id = ${ref("seller_id")} and earlier.deleted_at is null
      and earlier.status in ('active','reserved')
      and (earlier.created_at, earlier.id) <= (${ref("created_at")}, ${ref("id")}))
    <= coalesce((select case s.tier when 'ultra' then 2147483647 when 'plus' then 500 when 'pro' then 200 else 30 end
      from account_subscriptions s where s.user_id = ${ref("seller_id")} and s.kind = 'seller'
      and s.starts_at <= now() and s.expires_at > now() limit 1),30))`;
}
