import { expect, test } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  companies,
  jobApplications,
  inventoryItems,
  adMetrics,
  adEvents,
  adPayments,
  adPaymentSettings,
  accountRestrictions,
  adCampaigns,
  adCreatives,
} from "@/lib/db/schema";
test("database uniqueness prevents concurrent duplicate logical records", () => {
  for (const [table, name] of [
    [companies, "companies_page_unique"],
    [jobApplications, "job_applications_job_user_unique"],
    [inventoryItems, "inventory_items_listing_unique"],
    [adMetrics, "ad_metrics_campaign_date_unique"],
    [adEvents, "ad_events_viewer_day_unique"],
  ] as const) {
    expect(
      getTableConfig(table).indexes.some(
        (index) => index.config.name === name && index.config.unique,
      ),
    ).toBe(true);
  }
});
test("new payment and restriction tables deny direct client access through RLS", () => {
  for (const table of [
    adPayments,
    adPaymentSettings,
    adEvents,
    accountRestrictions,
    adCampaigns,
    adCreatives,
    inventoryItems,
    jobApplications,
  ] as PgTable[])
    expect(getTableConfig(table).enableRLS).toBe(true);
});
