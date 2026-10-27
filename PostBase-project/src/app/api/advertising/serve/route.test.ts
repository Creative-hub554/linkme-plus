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

test("delivery requires a known placement location", async () => {
  const unknown = await GET(
    new Request("http://localhost/api/advertising/serve?location=sidebar"),
  );
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toEqual({
    error: "Invalid advertising location",
  });

  const missing = await GET(
    new Request("http://localhost/api/advertising/serve"),
  );
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({
    error: "Invalid advertising location",
  });
  expect(fakeDb.reads).toEqual([]);
});

test("a failed delivery read answers 503 rather than an empty ad slot", async () => {
  fakeDb.failNextSelect(adCampaigns);
  const response = await GET(
    new Request("http://localhost/api/advertising/serve?location=feed"),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Advertising is temporarily unavailable",
  });
});
