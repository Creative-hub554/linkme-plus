import { sql, type SQL } from "drizzle-orm";
import { listingMedia, marketplaceListings } from "@/lib/db/schema";

/**
 * The card's photo: one read, spoken in one place.
 *
 * A listing has no image column — a photo is a row in `listing_media`, ordered
 * by `order` (the same `order` the single-listing read sorts by). Both list
 * reads that dress a row for a card — the marketplace grid and the saved
 * shelf — resolve that first row with the same correlated subquery, and a rule
 * living in two files is a rule that drifts: the day one shelf sorts
 * differently, or picks a different row on a tie, the same listing carries a
 * different picture on each. Written once here, so a change in how the photo
 * is chosen is a change to one reviewed line instead of a coordinated edit.
 *
 * It is a correlated subquery rather than a join on purpose — joining the
 * media would multiply a listing by its photos and page the grid in the wrong
 * units, the shape the posts route counts reactions with.
 *
 * The correlation is spelled with the schema's own column references rather
 * than string literals, and the inner select aliases its own `listing_media`
 * as `lm` exactly as the single-listing read does — so the same photo is
 * chosen at card resolution time and on the product page a card opens.
 */
export function listingFirstPhoto(): SQL {
  return sql<string | null>`(
    select lm.url from ${listingMedia} as lm
    where lm.listing_id = ${marketplaceListings.id}
    order by lm."order" asc
    limit 1
  )`;
}
