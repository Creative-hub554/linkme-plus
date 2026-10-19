import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route that counts attention against a campaign.
 *
 * What is pinned here is the difference between a request that went wrong and a
 * campaign that should stop: a beacon fired from a reader's feed may arrive for
 * a campaign that has ended, hit its daily cap or spent its budget, and none of
 * those is a failure — they are the delivery rules answering. Each therefore
 * gets its own status and its own words, and the two writes that matter (the
 * impression that settles a spent campaign, the counter that moves) are
 * asserted as writes rather than trusted to have happened.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb, withDbRetry: (operation: () => unknown) => operation() };
});

const session = vi.hoisted(() => ({ userId: "reader-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { POST } from "./route";
import { adCampaigns, adMetrics } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedUpdate } from "@/test/expect-gated";
import { DAILY_IMPRESSION_CAP } from "@/lib/ads/boosts";

const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const METRIC_ID = "66666666-6666-4666-8666-666666666666";

/** A campaign running right now, unless a case says otherwise. */
function running(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    status: "active",
    budget: 50,
    startDate: new Date(Date.now() - 60_000),
    endDate: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

/** A metric row from today. */
function today(overrides: Record<string, unknown> = {}) {
  return { id: METRIC_ID, campaignId: CAMPAIGN_ID, date: new Date(), impressions: 0, clicks: 0, ...overrides };
}

function event(body: unknown) {
  return new Request("http://localhost/api/boosts/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "reader-1";
});

describe("POST /api/boosts/events", () => {
  it("requires a session, a campaign and an event it counts", async () => {
    session.userId = null;
    expect((await POST(event({}))).status).toBe(401);

    session.userId = "reader-1";
    expect((await POST(event({ type: "impression" }))).status).toBe(400);
    expect((await POST(event({ campaignId: CAMPAIGN_ID, type: "stare" }))).status).toBe(400);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses an event for a campaign that is not running", async () => {
    fakeDb.selectReturns(adCampaigns, [running({ status: "paused" })]);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "impression" }));

    expect(response.status).toBe(409);
    expectGatedNone("writes");
  });

  it("reports a campaign at its daily cap without counting the impression", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, [today({ impressions: DAILY_IMPRESSION_CAP })]);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "impression" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: false, reason: "daily cap reached" });
    expectGatedNone("writes");
  });

  it("settles a campaign whose budget the impression would overshoot", async () => {
    // A budget of one buys two hundred impressions at the platform's rate, and
    // today has already served them: the next one is past what was authorised,
    // so the campaign is finished rather than counted. The allowance is still
    // inside the day's cap, which is the other refusal this route makes — the
    // two are independent, and this case is the one that is about money.
    fakeDb
      .selectReturns(adCampaigns, [running({ budget: 1 })])
      .selectReturns(adMetrics, [today({ impressions: 200 })]);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "impression" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      recorded: false,
      reason: "budget spent",
      completed: true,
    });
    expectGatedUpdate(adCampaigns, {
      values: { status: "completed", spent: 1 },
    });
  });

  it("moves today's counter when today already has a row", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, [today({ impressions: 4, clicks: 1 })])
      .updateReturns(adMetrics, [{ id: METRIC_ID, impressions: 5 }]);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "impression" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true, impressions: 5, clicks: 1 });
    expectGatedUpdate(adMetrics, { values: { impressions: 5 } });
  });

  it("opens a row for the day when there is none", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, [])
      .insertReturns(adMetrics, [{ id: METRIC_ID }]);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "click" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true, impressions: 0, clicks: 1 });
    expectGatedInsert(adMetrics, {
      values: expect.objectContaining({ campaignId: CAMPAIGN_ID, clicks: 1, impressions: 0 }),
    });
  });

  it("counts a click against the same row an impression used", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, [today({ impressions: 3, clicks: 2 })])
      .updateReturns(adMetrics, [{ id: METRIC_ID, clicks: 3 }]);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "click" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true, impressions: 3, clicks: 3 });
  });

  it("answers 404 for a campaign that is not there, counting nothing", async () => {
    // A beacon can name a campaign that never was: the answer is a 404, not
    // a delivery-rule response and not an effective count of anything.
    fakeDb.selectReturns(adCampaigns, []);

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "impression" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Campaign not found" });
    expectGatedNone("writes");
  });

  it("answers 400 for a body that is not an event", async () => {
    const response = await POST(
      new Request("http://localhost/api/boosts/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json [[",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "An event is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 500 when the campaign cannot be read", async () => {
    fakeDb.failNextSelect(adCampaigns, new Error("db down"));

    const response = await POST(event({ campaignId: CAMPAIGN_ID, type: "impression" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to record this event" });
  });
});
