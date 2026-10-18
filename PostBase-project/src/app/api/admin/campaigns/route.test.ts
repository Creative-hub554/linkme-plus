import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The review queue, and the two decisions that end a campaign's wait.
 *
 * The case that matters most is the first refusal: this route is where
 * "approval cannot be the advertiser's own" lives, so every path here checks
 * the platform role before it reads a campaign. The approval itself is pinned
 * by its *effect* rather than its status alone — approving is the moment the
 * booked window becomes the run, and a campaign that starts with its days
 * already spent is the bug that re-anchoring exists to prevent.
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
import { adCampaigns, auditLogs, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";

function queue() {
  return new Request("http://localhost/api/admin/campaigns");
}

function decide(body: unknown) {
  return new Request("http://localhost/api/admin/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A campaign waiting for a decision, booked for seven days in early October. */
function awaiting() {
  return {
    id: CAMPAIGN_ID,
    status: "pending_review",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-08T00:00:00.000Z"),
  };
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("GET /api/admin/campaigns", () => {
  it("answers only a platform administrator", async () => {
    session.userId = null;
    expect((await GET(queue())).status).toBe(401);

    // The role is read per request, and a member's account is the one that
    // answers 403 — a moderator clears the queue too, which is the platform's
    // role and not the Page's.
    session.userId = "member-1";
    fakeDb.selectReturns(users, [{ role: "member" }]);
    expect((await GET(queue())).status).toBe(403);
    expectGatedNone("writes");
  });

  it("lists what is waiting, with the Page and post an approver decides on", async () => {
    fakeDb
      .selectReturns(users, [{ role: "admin" }])
      .selectReturns(adCampaigns, [
        {
          id: CAMPAIGN_ID,
          status: "pending_review",
          budget: 50,
          startDate: new Date("2026-10-01T00:00:00.000Z"),
          endDate: new Date("2026-10-08T00:00:00.000Z"),
          advertiser: "theo",
          goal: "reach",
          postId: "11111111-1111-4111-8111-111111111111",
          excerpt: "Come to the opening night.",
          pageName: "Northside Studio",
          pageUsername: "northside",
        },
      ]);

    const response = await GET(queue());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaigns: [
        expect.objectContaining({
          id: CAMPAIGN_ID,
          status: "pending_review",
          goal: "reach",
          excerpt: "Come to the opening night.",
          pageName: "Northside Studio",
          advertiser: "theo",
        }),
      ],
    });
  });
});

describe("POST /api/admin/campaigns", () => {
  it("requires a decision it recognises, reading nothing", async () => {
    expect((await POST(decide({ campaignId: CAMPAIGN_ID }))).status).toBe(400);
    expect((await POST(decide({ campaignId: CAMPAIGN_ID, action: "boost" }))).status).toBe(400);
    // A refusal an advertiser never sees is still a decision, and a campaign
    // cannot simply be turned away with no words to answer with.
    expect(
      (await POST(decide({ campaignId: CAMPAIGN_ID, action: "reject" }))).status,
    ).toBe(400);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("refuses a decision from someone who is not the platform's", async () => {
    session.userId = "owner-1";
    fakeDb.selectReturns(users, [{ role: "member" }]);

    const response = await POST(decide({ campaignId: CAMPAIGN_ID, action: "approve" }));

    expect(response.status).toBe(403);
    // The refusal is the role, not a missing campaign: nothing was read but
    // the caller's own account.
    expectGatedSequence("reads", ["users"]);
    expectGatedNone("writes");
  });

  it("refuses a second decision on a campaign that already had one", async () => {
    fakeDb
      .selectReturns(users, [{ role: "admin" }])
      .selectReturns(adCampaigns, [{ ...awaiting(), status: "active" }]);

    const response = await POST(decide({ campaignId: CAMPAIGN_ID, action: "approve" }));

    expect(response.status).toBe(409);
    expectGatedNone("writes");
  });

  it("approves a campaign, and gives it its seven days from now", async () => {
    const start = Date.now();
    fakeDb
      .selectReturns(users, [{ role: "admin" }])
      .selectReturns(adCampaigns, [awaiting()])
      .updateReturns(adCampaigns, [
        {
          id: CAMPAIGN_ID,
          status: "active",
          startDate: new Date(start),
          endDate: new Date(start + 7 * 86_400_000),
        },
      ])
      .insertReturns(auditLogs, [{ id: "log-1" }]);

    const response = await POST(decide({ campaignId: CAMPAIGN_ID, action: "approve" }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { campaign: { status: string; startDate: string } };
    expect(payload.campaign.status).toBe("active");
    // The booked window was seven days in October; approval runs it for seven
    // days from the decision, not from the booking.
    const firstDay = new Date(payload.campaign.startDate).getTime();
    expect(firstDay).toBeGreaterThanOrEqual(start - 1_000);
    expect(firstDay).toBeLessThanOrEqual(Date.now() + 1_000);

    expectGatedInsert(auditLogs, {
      values: expect.objectContaining({ action: "campaign.approve", targetType: "ad_campaign" }),
    });
  });

  it("rejects a campaign, and keeps the reason with the decision", async () => {
    fakeDb
      .selectReturns(users, [{ role: "admin" }])
      .selectReturns(adCampaigns, [awaiting()])
      .updateReturns(adCampaigns, [{ ...awaiting(), status: "rejected" }])
      .insertReturns(auditLogs, [{ id: "log-2" }]);

    const response = await POST(
      decide({ campaignId: CAMPAIGN_ID, action: "reject", reason: "  Misleading price  " }),
    );

    expect(response.status).toBe(200);
    expectGatedInsert(auditLogs, {
      values: expect.objectContaining({
        action: "campaign.reject",
        metadata: { reason: "Misleading price" },
      }),
    });
  });
});
