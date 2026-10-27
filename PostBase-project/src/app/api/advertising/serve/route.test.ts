import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
import { GET } from "./route";
import { adCampaigns } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
beforeEach(resetFakeDb);
test("delivery requires verified payment, approved creative, live dates and eligible source content", async () => {
  fakeDb.selectReturns(adCampaigns, []);
  expect(
    (
      await GET(
        new Request(
          "http://localhost/api/advertising/serve?location=marketplace&category=Technology",
        ),
      )
    ).status,
  ).toBe(200);
  const where = fakeDb.selectWheres[0];
  expect(where).toContain("ad_payments");
  expect(where).toContain("reviewed_at");
  expect(where).toContain("deleted_at");
  expect(where).toContain("quantity");
  expect(where).toContain("any");
  expect(fakeDb.selectParams[0]).toContain("verified");
  expect(fakeDb.selectParams[0]).toContain("Technology");
});
