import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/db", async () => ({
  db: (await import("@/test/fake-db")).fakeDb,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "viewer" } }) } },
}));
import { POST } from "./route";
import { adCampaigns, adEvents, reports } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
beforeEach(resetFakeDb);
const id = "22222222-2222-4222-8222-222222222222";
const eventRequest = (body: unknown) =>
  new Request("http://localhost/api/advertising/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
test("a duplicate member view cannot increment the campaign metrics twice", async () => {
  fakeDb.selectReturns(adCampaigns, [{ id }]).insertReturns(adEvents, []);
  const response = await POST(
    eventRequest({ campaignId: id, event: "impression" }),
  );
  expect(await response.json()).toEqual({ recorded: false });
  expect(fakeDb.writes.map((item) => item.table)).toEqual(["ad_events"]);
});

test("an event must name a real campaign and a known event kind", async () => {
  for (const body of [
    { campaignId: "not-a-uuid", event: "impression" },
    { campaignId: id, event: "view" },
    {},
  ]) {
    const response = await POST(eventRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid advertising event",
    });
  }
  expect(fakeDb.reads).toEqual([]);
});

test("an event for an unavailable campaign is refused before any write", async () => {
  fakeDb.selectReturns(adCampaigns, []);
  const response = await POST(
    eventRequest({ campaignId: id, event: "impression" }),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Campaign is unavailable" });
  expect(fakeDb.writes).toEqual([]);
});

test("a fresh impression is recorded and counted in today's metrics", async () => {
  fakeDb
    .selectReturns(adCampaigns, [{ id }])
    .insertReturns(adEvents, [{ id: "event-1" }]);
  const response = await POST(
    eventRequest({ campaignId: id, event: "impression" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ recorded: true });
  expect(fakeDb.writes.map((item) => item.table)).toEqual([
    "ad_events",
    "ad_metrics",
  ]);
  expect(fakeDb.writes[0].values).toMatchObject({
    campaignId: id,
    viewerId: "viewer",
    event: "impression",
  });
  expect(fakeDb.writes[1].values).toMatchObject({
    campaignId: id,
    impressions: 1,
    clicks: 0,
    uniqueReach: 1,
  });
});

test("reporting a campaign stores one pending report and repeats are ignored", async () => {
  fakeDb.selectReturns(adCampaigns, [{ id }]).selectReturns(reports, []);
  const first = await POST(
    eventRequest({ campaignId: id, event: "report", reason: "scam" }),
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ reported: true });
  expect(fakeDb.reads).toEqual(["ad_campaigns", "reports"]);
  expect(fakeDb.writes).toEqual([
    {
      table: "reports",
      values: {
        reporterId: "viewer",
        targetType: "campaign",
        targetId: id,
        reason: "scam",
      },
    },
  ]);

  fakeDb
    .selectReturns(adCampaigns, [{ id }])
    .selectReturns(reports, [{ id: "existing" }]);
  const duplicate = await POST(
    eventRequest({ campaignId: id, event: "report", reason: "scam" }),
  );
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toEqual({ reported: true });
  expect(fakeDb.writes).toHaveLength(1);
});

test("a report must name a known reason", async () => {
  fakeDb.selectReturns(adCampaigns, [{ id }]);
  const unknown = await POST(
    eventRequest({ campaignId: id, event: "report", reason: "boring" }),
  );
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toEqual({ error: "Select a report reason" });
  expect(fakeDb.reads).toEqual(["ad_campaigns"]);

  fakeDb.selectReturns(adCampaigns, [{ id }]);
  const missing = await POST(eventRequest({ campaignId: id, event: "report" }));
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: "Select a report reason" });
  expect(fakeDb.writes).toEqual([]);
});

test("a failed event read answers 500 rather than dropping the event", async () => {
  fakeDb.failNextSelect(adCampaigns);
  const response = await POST(
    eventRequest({ campaignId: id, event: "impression" }),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Unable to record advertising event",
  });
  expect(fakeDb.writes).toEqual([]);
});
