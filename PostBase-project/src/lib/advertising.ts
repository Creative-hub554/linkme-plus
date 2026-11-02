import { sellerPublicVisibility } from "@/lib/seller-entitlements";
import {
  adCampaigns,
  boostedPostCampaigns,
  posts,
  promotedListingCampaigns,
  marketplaceListings,
  inventoryItems,
} from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const adLocations = ["feed", "marketplace", "jobs"] as const;
export function safeAdUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
/** Recheck the source at delivery time; removed/edited/out-of-stock content never keeps advertising. */
export function eligibleAdSource(reviewAt?: Date) {
  const campaignId = sql.raw('"ad_campaigns"."id"');
  const reviewedAt = reviewAt
    ? sql`${reviewAt}`
    : sql.raw('"ad_campaigns"."reviewed_at"');
  return sql`(${adCampaigns.type} = 'banner' or
    (${adCampaigns.type} = 'boost' and exists (select 1 from ${boostedPostCampaigns} b join ${posts} p on p.id = b.post_id where b.campaign_id = ${campaignId} and p.deleted_at is null and p.visibility = 'public' and p.page_id is not null and (p.edited_at is null or p.edited_at <= ${reviewedAt}))) or
    (${adCampaigns.type} = 'promotion' and exists (select 1 from ${promotedListingCampaigns} pl join ${marketplaceListings} l on l.id = pl.listing_id where pl.campaign_id = ${campaignId} and l.deleted_at is null and l.status = 'active' and ${sellerPublicVisibility("l")} and not exists (select 1 from ${inventoryItems} i where i.listing_id = l.id and coalesce(i.quantity, 0) <= 0))))`;
}
