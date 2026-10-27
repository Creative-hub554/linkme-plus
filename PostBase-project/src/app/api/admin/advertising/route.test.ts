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
import {
  adCampaigns,
  adPaymentSettings,
  adPayments,
  adPlacements,
  auditLogs,
  users,
} from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
const id = "22222222-2222-4222-8222-222222222222";
const admin = () => fakeDb.selectReturns(users, [{ role: "admin" }]);
/** Assert the exact refusal: the status *and* the message this branch owns. */
async function expectRefusal(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}
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

test.each([
  { name: "an unparseable image URL", body: { qrImageUrl: "not a url" } },
  { name: "a non-http image URL", body: { qrImageUrl: "javascript:alert(1)" } },
  { name: "a non-string merchant name", body: { merchantName: 42 } },
  { name: "a blank merchant name", body: { merchantName: "   " } },
  { name: "an over-long merchant name", body: { merchantName: "x".repeat(101) } },
  { name: "an unsupported currency", body: { currency: "EUR" } },
])("KHQR settings refuse $name", async ({ body }) => {
  admin();
  const response = await POST(
    request({
      action: "settings",
      merchantName: "Merchant",
      currency: "USD",
      qrImageUrl: "https://example.com/qr.png",
      ...body,
    }),
  );
  await expectRefusal(
    response,
    400,
    "Merchant name, KHQR image URL, and currency are required",
  );
  expect(fakeDb.deletes).toEqual([]);
  expect(fakeDb.writes).toEqual([]);
});

test.each([
  { name: "an unknown location", body: { location: "sidebar" } },
  { name: "a missing name", body: { name: undefined } },
  { name: "a blank name", body: { name: "   " } },
  { name: "an over-long name", body: { name: "x".repeat(101) } },
  { name: "a fractional rate", body: { dailyRate: 500.5 } },
  { name: "a zero rate", body: { dailyRate: 0 } },
  { name: "an excessive rate", body: { dailyRate: 10000001 } },
  { name: "zero capacity", body: { maxActive: 0 } },
  { name: "over capacity", body: { maxActive: 21 } },
  { name: "a fractional capacity", body: { maxActive: 1.5 } },
  { name: "an unsupported currency", body: { currency: "EUR" } },
])("ad placements refuse $name", async ({ body }) => {
  admin();
  const response = await POST(
    request({
      action: "placement",
      location: "feed",
      name: "Homepage",
      dailyRate: 500,
      maxActive: 2,
      currency: "USD",
      ...body,
    }),
  );
  await expectRefusal(
    response,
    400,
    "Enter a valid placement, rate, currency and capacity",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a valid placement is created and handed back", async () => {
  admin().insertReturns(adPlacements, [
    { id, name: "Homepage", location: "feed", maxActive: 2 },
  ]);
  const response = await POST(
    request({
      action: "placement",
      location: "feed",
      name: "  Homepage  ",
      dailyRate: 500,
      maxActive: 2,
      currency: "USD",
    }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    placement: { id, name: "Homepage", location: "feed", maxActive: 2 },
  });
  expect(fakeDb.writes).toHaveLength(1);
  expect(fakeDb.writes[0]).toMatchObject({
    table: "ad_placements",
    values: {
      name: "Homepage",
      location: "feed",
      dailyRate: 500,
      currency: "USD",
      maxActive: 2,
    },
  });
});

test.each([
  { name: "a malformed campaign id", body: { id: "not-a-uuid" } },
  { name: "a missing campaign id", body: { id: undefined } },
  { name: "an unknown decision", body: { action: "delete" } },
  { name: "a missing note", body: { note: undefined } },
  { name: "a blank note", body: { note: "   " } },
  { name: "an over-long note", body: { note: "x".repeat(2001) } },
])("advertising decisions refuse $name before reading a campaign", async ({ body }) => {
  admin();
  const response = await POST(
    request({ id, action: "approve", note: "reviewed", ...body }),
  );
  await expectRefusal(
    response,
    400,
    "A campaign, decision and review note are required",
  );
  expect(fakeDb.reads).toEqual(["users"]);
  expect(fakeDb.writes).toEqual([]);
});

test("a decision for an unknown campaign answers campaign not found", async () => {
  admin().selectReturns(adCampaigns, []);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    404,
    "Campaign not found",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a campaign without a payment record answers payment not found", async () => {
  admin().selectReturns(adCampaigns, [campaign()]).selectReturns(adPayments, []);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    404,
    "Payment record not found",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("refunding refuses a payment that was never verified", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "submitted" }]);
  await expectRefusal(
    await POST(request({ id, action: "refund", note: "duplicate charge" })),
    409,
    "Only a verified payment can be marked refunded",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("refunding a verified payment refunds both the payment and the campaign", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "verified" }]);
  const response = await POST(
    request({ id, action: "refund", note: "duplicate charge" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(fakeDb.writes.map((write) => write.table)).toEqual([
    "ad_payments",
    "ad_campaigns",
    "audit_logs",
  ]);
  expect(fakeDb.writes[0].values).toMatchObject({
    status: "refunded",
    note: "duplicate charge",
  });
  expect(fakeDb.writes[1].values).toEqual({ status: "refunded" });
  expect(fakeDb.writes[2].values).toMatchObject({
    action: "advertising.refund",
  });
});

test.each([
  { name: "a cancelled campaign", body: { status: "cancelled" } },
  { name: "a refunded campaign", body: { status: "refunded" } },
  { name: "a completed campaign", body: { status: "completed" } },
  { name: "a campaign without an end date", body: { endDate: undefined } },
  {
    name: "a campaign whose end date has passed",
    body: { endDate: new Date(Date.now() - 1000) },
  },
])("decisions refuse $name as ended", async ({ body }) => {
  admin()
    .selectReturns(adCampaigns, [{ ...campaign(), ...body }])
    .selectReturns(adPayments, [{ status: "verified" }]);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    409,
    "This campaign has ended",
  );
  expect(fakeDb.writes).toEqual([]);
});

test.each([
  { name: "a payment that was never submitted", payment: { status: "submitted" } },
  {
    name: "a submitted payment without a reference",
    payment: { status: "submitted", reference: null },
  },
  {
    name: "an already verified payment",
    payment: { status: "verified", reference: "TXN-1" },
  },
])("verification refuses $name", async ({ payment }) => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [payment]);
  await expectRefusal(
    await POST(request({ id, action: "verify", note: "bank checked" })),
    409,
    "The advertiser must submit a transaction reference first",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("verifying a submitted reference records the verifier and audit trail", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "submitted", reference: "TXN-1" }]);
  const response = await POST(
    request({ id, action: "verify", note: "bank checked" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(fakeDb.writes[0]).toMatchObject({
    table: "ad_payments",
    values: {
      status: "verified",
      verifiedBy: auth.id,
      verifiedAt: expect.any(Date),
      note: "bank checked",
    },
  });
  expect(fakeDb.writes.at(-1)).toMatchObject({
    table: "audit_logs",
    values: { action: "advertising.verify" },
  });
});

test("approval refuses a payment that is only submitted, not verified", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "submitted" }]);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    409,
    "Confirm receipt in your bank before approving this campaign",
  );
  expect(fakeDb.writes).toEqual([]);
});

test.each([
  {
    name: "a missing placement",
    placements: [] as Record<string, unknown>[],
    campaign: {} as { startDate?: Date },
  },
  {
    name: "an unspecified start date",
    placements: [{ id, maxActive: 2 }],
    campaign: { startDate: undefined },
  },
])("approval refuses $name", async ({ placements, campaign: override }) => {
  admin()
    .selectReturns(adCampaigns, [{ ...campaign(), ...override }])
    .selectReturns(adPayments, [{ status: "verified" }])
    .selectReturns(adPlacements, placements);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    409,
    "Placement is unavailable",
  );
  expect(fakeDb.writes).toEqual([]);
});

test.each([
  { name: "an unspecified capacity", placement: { id }, total: 1 },
  { name: "a full placement", placement: { id, maxActive: 2 }, total: 2 },
])("approval refuses $name as fully booked", async ({ placement, total }) => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adCampaigns, [{ total }])
    .selectReturns(adPayments, [{ status: "verified" }])
    .selectReturns(adPlacements, [placement]);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    409,
    "This placement is fully booked for those dates. Arrange new dates or a manual refund.",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("approval refuses a campaign whose source content is no longer eligible", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adCampaigns, [{ total: 0 }])
    .selectReturns(adCampaigns, [])
    .selectReturns(adPayments, [{ status: "verified" }])
    .selectReturns(adPlacements, [{ id, maxActive: 2 }]);
  await expectRefusal(
    await POST(request({ id, action: "approve", note: "reviewed" })),
    409,
    "Source content was removed, made private or is out of stock",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a failed actor lookup answers the generic save failure", async () => {
  fakeDb.failNextSelect(users);
  await expectRefusal(
    await POST(request({ action: "settings" })),
    500,
    "Unable to save advertising decision",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a failed settings delete answers the generic save failure", async () => {
  admin();
  fakeDb.failNextDelete(adPaymentSettings);
  await expectRefusal(
    await POST(
      request({
        action: "settings",
        merchantName: "Merchant",
        currency: "USD",
        qrImageUrl: "https://example.com/qr.png",
      }),
    ),
    500,
    "Unable to save advertising decision",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a failed placement insert answers the generic save failure", async () => {
  admin();
  fakeDb.failNextInsert(adPlacements);
  await expectRefusal(
    await POST(
      request({
        action: "placement",
        location: "feed",
        name: "Homepage",
        dailyRate: 500,
        maxActive: 2,
        currency: "USD",
      }),
    ),
    500,
    "Unable to save advertising decision",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a failed campaign write answers the generic save failure", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "verified" }]);
  fakeDb.failNextUpdate(adCampaigns);
  await expectRefusal(
    await POST(request({ id, action: "reject", note: "policy breach" })),
    500,
    "Unable to save advertising decision",
  );
  expect(fakeDb.writes).toEqual([]);
});

test("a failed audit insert answers the generic save failure", async () => {
  admin()
    .selectReturns(adCampaigns, [campaign()])
    .selectReturns(adPayments, [{ status: "verified" }]);
  fakeDb.failNextInsert(auditLogs);
  await expectRefusal(
    await POST(request({ id, action: "reject", note: "policy breach" })),
    500,
    "Unable to save advertising decision",
  );
  expect(fakeDb.writes.map((write) => write.table)).toEqual([
    "ad_campaigns",
    "ad_payments",
  ]);
});
