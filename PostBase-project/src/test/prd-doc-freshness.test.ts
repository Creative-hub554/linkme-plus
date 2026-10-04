import { describe, expect, it } from "vitest";

import { expectDocSelfHeld, expectHeld, readSource } from "./doc-freshness";

/**
 * `docs/postbase-product-requirements.md` is the product contract: the labels the UI
 * must show, the statuses the campaign lifecycle uses, and the data entities the
 * schema should model. A contract nothing compiled against ages silently — a renamed
 * label or a dropped table leaves it describing a product that no longer exists.
 * These cases hold the contract's quotable claims against the artifacts that make
 * them true, byte-exact, through the shared `./doc-freshness` helper.
 *
 * Deliberately outside the hold, stated here so the exclusion is a decision and not
 * an omission: the aspirational paragraphs (features the product has not grown yet —
 * the stock-status labels beyond `Sponsored`, escrow, live streaming, mobile apps),
 * the inventory rules and workflows that describe behavior rather than quote text
 * the code contains, and the section headings and capability prose that no single
 * line of source states. The PRD's entity paragraph is held as a *mapping* — each
 * entity to the schema table that models it — rather than literally, because the
 * schema spells them snake_case and the PRD names them PascalCase; two entities the
 * paragraph names are deliberately mapped to *absence* (see EXCLUDED_ENTITIES), so
 * the exclusion is held rather than silent.
 */

const doc = readSource("docs/postbase-product-requirements.md");
const schema = readSource("src/lib/db/schema.ts");
const adsPage = readSource("src/app/(static)/ads/page.tsx");

/** The PRD's quotable strings, and the doc-side form every rule first assumes. */
const DOC_NEEDLES: Record<string, string> = {
  sponsoredLabel: "**Sponsored**",
  boostedPost: "**Boosted Post**",
  boostedPosts: "**Boosted Posts**",
  inventoryManager: "**Inventory Manager**",
  advertisementLabel: "**Advertisement**",
  campaignStatuses:
    "draft, pending payment, pending review, approved, scheduled, active, paused, rejected, completed, cancelled, refunded",
  entitiesParagraph:
    "`User`, `Profile`, `Follow`, `Post`, `PostMedia`, `Comment`, `Reaction`, `SavedItem`, `Notification`, `Conversation`, `Message`, `Page`, `PageRole`, `Group`, `GroupMember`, `MarketplaceListing`, `ProductVariant`, `InventoryItem`, `InventoryMovement`, `Storefront`, `Job`, `Company`, `JobApplication`, `AdvertisementCampaign`, `AdvertisementCreative`, `AdvertisementPlacement`, `AdvertisementBooking`, `AdvertisementMetric`, `PromotedListingCampaign`, `BoostedPostCampaign`, `Report`, `ModerationAction`, `Payment`, and `AuditLog`",
};

/** Each PRD entity the schema models, and the table that models it. */
const ENTITY_MAP: Record<string, string> = {
  User: "users",
  Profile: "profiles",
  Follow: "follows",
  Post: "posts",
  PostMedia: "post_media",
  Comment: "comments",
  Reaction: "reactions",
  SavedItem: "saved_items",
  Notification: "notifications",
  Conversation: "conversations",
  Message: "messages",
  Page: "pages",
  PageRole: "page_roles",
  Group: "groups",
  GroupMember: "group_members",
  MarketplaceListing: "marketplace_listings",
  ProductVariant: "product_variants",
  InventoryItem: "inventory_items",
  InventoryMovement: "inventory_movements",
  Storefront: "storefronts",
  Job: "jobs",
  Company: "companies",
  JobApplication: "job_applications",
  AdvertisementCampaign: "ad_campaigns",
  AdvertisementCreative: "ad_creatives",
  AdvertisementPlacement: "ad_placements",
  AdvertisementMetric: "ad_metrics",
  PromotedListingCampaign: "promoted_listing_campaigns",
  BoostedPostCampaign: "boosted_post_campaigns",
  Report: "reports",
  ModerationAction: "moderation_actions",
  AuditLog: "audit_logs",
};

/**
 * The two entities the PRD's paragraph names that no table models yet — a booking
 * ledger and a payment ledger are both "later releases" work. Held as *required
 * absence* rather than skipped: if a table for either appears, this case goes red
 * and tells the editor to refresh the contract's own exclusions in the same commit.
 */
const EXCLUDED_ENTITIES: Record<string, string> = {
  AdvertisementBooking: "booking",
  Payment: "payment",
};

describe("the product requirements doc against the app it describes", () => {
  it("is quoted accurately: the strings it quotes exist in the doc itself", () => {
    expectDocSelfHeld(DOC_NEEDLES, doc, "the PRD");
  });

  it("names UI labels the ads surface really renders", () => {
    // The one label the contract quotes that the product already renders. The
    // stock-status labels and the rest of the quoted vocabulary are aspirational —
    // held never, rather than red from birth.
    expectHeld("Sponsored", adsPage, "ads/page.tsx");
  });

  it("holds the campaign lifecycle to the schema's own status enum", () => {
    // The PRD's eleven statuses are the contract for the campaign lifecycle, and the
    // schema states the same lifecycle as `campaign_status` — an enum whose order is
    // the doc's order, with `pending payment` spelled `pending_payment`. The hold is
    // the *list*, not a quotation: read the enum out of the schema text, normalize
    // the doc's prose form the same way, and require equality — so a status added to
    // either side without the other is a named red.
    const enumMatch = schema.match(/pgEnum\("campaign_status", \[(.*?)\]\)/);
    expect(enumMatch).not.toBeNull();
    const enumValues = (enumMatch as RegExpMatchArray)[1]
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, ""));
    const docStatuses = DOC_NEEDLES.campaignStatuses
      .split(", ")
      .map((status) => status.replace(/ /g, "_"));
    expect(docStatuses).toEqual(enumValues);
  });

  it("models the entities the contract names, table by table", () => {
    // Each entity's table must still be declared in the schema, under the name the
    // mapping records — a dropped or renamed table is a contract change and goes
    // through the doc in the same commit.
    for (const [entity, table] of Object.entries(ENTITY_MAP)) {
      expectHeld(`pgTable("${table}"`, schema, `schema: ${entity} → ${table}`);
    }
  });

  it("holds the two unmodeled entities to their documented absence", () => {
    // The exclusion is part of the contract: no booking table and no payment table
    // exist yet, and the paragraph names them anyway. A table that appears for
    // either fails here, directing the editor to refresh the entity paragraph —
    // the mapping above — rather than letting the contract and the schema agree
    // by accident.
    for (const [entity, fragment] of Object.entries(EXCLUDED_ENTITIES)) {
      expect(schema.match(new RegExp(`pgTable\\("[^"]*${fragment}`)), entity).toBeNull();
    }
  });
});
