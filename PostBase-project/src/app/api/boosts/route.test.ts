import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Page's own view of its campaigns, and the ladder it may climb.
 *
 * The two halves are pinned against each other on purpose: `GET` must answer
 * only for a Page the caller administers, and `POST` must refuse an action the
 * campaign's status does not allow *before* it writes — a client that shows a
 * Pause button on a campaign in review is exactly the client that finds out
 * from a silent no-op. Approval is absent from the ladder here, and the case at
 * the bottom says so: an advertiser may not clear their own boost.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb, withDbRetry: (operation: () => unknown) => operation() };
});

const session = vi.hoisted(() => ({ userId: "admin-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

import { GET, POST } from "./route";
import { adCampaigns, adMetrics, pageRoles } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";

function list() {
  return new Request(`http://localhost/api/boosts?pageId=${PAGE_ID}`);
}

function act(body: unknown) {
  return new Request("http://localhost/api/boosts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/boosts", () => {
  it("requires a session and a page id before reading anything", async () => {
    session.userId = null;
    expect((await GET(list())).status).toBe(401);

    session.userId = "admin-1";
    expect((await GET(new Request("http://localhost/api/boosts"))).status).toBe(400);
    expectGatedNone("reads");
  });

  it("answers only for a Page the caller administers", async () => {
    fakeDb.selectReturns(pageRoles, []);

    const response = await GET(list());

    expect(response.status).toBe(403);
    // The role read narrowed to this Page, this member, and the admin role.
    expect(fakeDb.selectParams[0]).toEqual([PAGE_ID, "admin-1", "admin"]);
    expectGatedNone("writes");
  });

  it("reports each campaign with the metrics of its days, and the spend they imply", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(adCampaigns, [
        {
          id: CAMPAIGN_ID,
          status: "active",
          budget: 50,
          spent: null,
          startDate: new Date("2026-10-10T00:00:00.000Z"),
          endDate: new Date("2026-10-17T00:00:00.000Z"),
          goal: "reach",
          postId: "11111111-1111-4111-8111-111111111111",
          excerpt: "Opening night is Thursday.",
        },
      ])
      .selectReturns(adMetrics, [
        { campaignId: CAMPAIGN_ID, impressions: 600, clicks: 12 },
        { campaignId: CAMPAIGN_ID, impressions: 400, clicks: 8 },
      ]);

    const response = await GET(list());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaigns: [
        {
          id: CAMPAIGN_ID,
          status: "active",
          postId: "11111111-1111-4111-8111-111111111111",
          goal: "reach",
          excerpt: "Opening night is Thursday.",
          budget: 50,
          // A thousand impressions at a five-per-thousand rate is five units —
          // the same arithmetic delivery stops on, not the row's own column,
          // which is only written when a campaign settles.
          spent: 5,
          impressions: 1000,
          clicks: 20,
          startDate: "2026-10-10T00:00:00.000Z",
          endDate: "2026-10-17T00:00:00.000Z",
        },
      ],
    });
    expectGatedSequence("reads", ["page_roles", "ad_campaigns", "ad_metrics"]);
  });

  it("asks for no metrics when the Page has no campaigns", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]).selectReturns(adCampaigns, []);

    const response = await GET(list());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ campaigns: [] });
    // An `inArray` over no ids is a query that would fail or scan; the route
    // does not make it.
    expectGatedSequence("reads", ["page_roles", "ad_campaigns"]);
  });

  it("answers 500 when the listing itself cannot be read", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .failNextSelect(adCampaigns, new Error("db down"));

    const response = await GET(list());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to list these campaigns" });
    expectGatedNone("writes");
  });
});

describe("POST /api/boosts", () => {
  it("requires a session, a campaign and an action it offers", async () => {
    session.userId = null;
    expect((await POST(act({}))).status).toBe(401);

    session.userId = "admin-1";
    expect((await POST(act({ action: "pay" }))).status).toBe(400);
    expect((await POST(act({ campaignId: CAMPAIGN_ID }))).status).toBe(400);
    // The step the platform keeps for itself is not one this route performs.
    expect((await POST(act({ campaignId: CAMPAIGN_ID, action: "approve" }))).status).toBe(400);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a campaign the caller's Page does not own", async () => {
    fakeDb
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "pending_payment", pageId: PAGE_ID }])
      .selectReturns(pageRoles, []);

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pay" }));

    expect(response.status).toBe(403);
    expectGatedNone("writes");
  });

  it("refuses an action the campaign's status does not allow, writing nothing", async () => {
    fakeDb
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "pending_review", pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pause" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A campaign that is pending review cannot be paused",
    });
    expectGatedNone("writes");
  });

  it("authorises a booked campaign into review", async () => {
    fakeDb
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "pending_payment", pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .updateReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "pending_review" }]);

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pay" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: CAMPAIGN_ID, status: "pending_review" },
    });
    expectGatedSequence("writes", [{ table: "ad_campaigns", values: { status: "pending_review" } }]);
  });

  it("pauses a running campaign and leaves its dates alone", async () => {
    fakeDb
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "active", pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .updateReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "paused" }]);

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pause" }));

    expect(response.status).toBe(200);
    expectGatedInsert(adCampaigns, { values: { status: "paused" } });
  });

  it("answers 404 for a campaign that is not there, writing nothing", async () => {
    // A campaign the Page names by id and cannot find is not an action to
    // retry: the answer is a 404 before the caller's role is even consulted,
    // and certainly before any state moves.
    fakeDb.selectReturns(adCampaigns, []);

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pay" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Campaign not found" });
    expectGatedNone("writes");
  });

  it("refuses a campaign reached by a read that found no Page behind it", async () => {
    // The post the read joined is what names the Page, so a campaign whose
    // post has none is one nothing bills and no Page admin may manage. The
    // refusal is the campaign's state, written before the caller's role is
    // even asked about.
    fakeDb.selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "active", pageId: null }]);

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pause" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This campaign has no Page behind it" });
    expectGatedNone("writes");
  });

  it("answers 400 for a body that is not an action", async () => {
    const response = await POST(
      new Request("http://localhost/api/boosts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json [[",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A campaign and an action are required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 500 when the campaign cannot be updated", async () => {
    fakeDb
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "pending_payment", pageId: PAGE_ID }])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .failNextUpdate(adCampaigns, new Error("db down"));

    const response = await POST(act({ campaignId: CAMPAIGN_ID, action: "pay" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to update this campaign" });
  });
});
