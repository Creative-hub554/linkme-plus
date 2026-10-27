import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
const auth = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111" as string | null,
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (auth.id ? { user: { id: auth.id } } : null),
    },
  },
}));
import { POST } from "./route";
import { adCampaigns, adPlacements, adPayments, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
const id = "22222222-2222-4222-8222-222222222222";
const request = (body: unknown) =>
  new Request("http://localhost/api/admin/advertising", {
    method: "POST",
    body: JSON.stringify(body),
  });
const campaign = () => ({
  id,
  advertiserId: "other-advertiser",
  placementId: id,
  status: "pending_review",
  startDate: new Date(),
  endDate: new Date(Date.now() + 86400000),
});
beforeEach(() => {
  resetFakeDb();
  auth.id = "11111111-1111-4111-8111-111111111111";
});
test("ordinary members cannot configure KHQR or verify payments", async () => {
  fakeDb.selectReturns(users, [{ role: "member" }]);
  expect((await POST(request({ action: "settings" }))).status).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});

test.each(["KHR", "USD"])("saving %s KHQR only replaces settings for that currency", async (currency) => {
  fakeDb.selectReturns(users, [{ role: "admin" }]);
  const response = await POST(request({
    action: "settings", merchantName: "Merchant", currency,
    qrImageUrl: `https://example.com/${currency}.png`,
  }));
  expect(response.status).toBe(200);
  expect(fakeDb.deletes).toEqual(["ad_payment_settings"]);
  expect(fakeDb.deleteParams).toEqual([[`khqr_${currency}`]]);
  const insertion = fakeDb.writes.find((write) => write.table === "ad_payment_settings");
  expect(insertion?.values).toMatchObject({ id: `khqr_${currency}`, currency });
});
test("administrators cannot approve their own advertising payments", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(adCampaigns, [{ ...campaign(), advertiserId: auth.id }]);
  expect(
    (await POST(request({ id, action: "verify", note: "bank checked" })))
      .status,
  ).toBe(403);
  expect(fakeDb.writes).toEqual([]);
});
test("submitted payment references are not enough to approve delivery", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "submitted" }]);
  expect(
    (await POST(request({ id, action: "approve", note: "reviewed" }))).status,
  ).toBe(409);
  expect(fakeDb.writes).toEqual([]);
});
test("slot capacity is enforced before activation", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adCampaigns, [{ total: 1 }])
    .selectReturns(adPayments, [{ status: "verified" }])
    .selectReturns(adPlacements, [{ id, maxActive: 1 }]);
  expect(
    (await POST(request({ id, action: "approve", note: "reviewed" }))).status,
  ).toBe(409);
  expect(fakeDb.writes).toEqual([]);
});
test("verification, source eligibility and available capacity allow audited activation", async () => {
  fakeDb
    .selectReturns(users, [{ role: "admin" }])
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adCampaigns, [{ total: 0 }])
    .selectReturns(adCampaigns, [{ id }])
    .selectReturns(adPayments, [{ status: "verified" }])
    .selectReturns(adPlacements, [{ id, maxActive: 1 }]);
  expect(
    (
      await POST(
        request({ id, action: "approve", note: "bank and creative checked" }),
      )
    ).status,
  ).toBe(200);
  expect(fakeDb.writes[0]).toMatchObject({
    table: "ad_campaigns",
    values: { status: "active", reviewedAt: expect.any(Date) },
  });
  expect(fakeDb.writes.at(-1)).toMatchObject({
    table: "audit_logs",
    values: { action: "advertising.approve" },
  });
});
