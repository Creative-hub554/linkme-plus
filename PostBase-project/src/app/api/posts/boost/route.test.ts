import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route that books a boost, gate by gate.
 *
 * Each case below stands for one sentence of the PRD's own eligibility rule —
 * public, published, owned by the Page, requested by an admin of it — and each
 * asserts the *shape* of the refusal as well as its status: a gate that fails
 * must fail before anything is read or written, which is what the `expectGated*`
 * helpers measure. The duplicate guard is the one that earns its keep in
 * production, so it is pinned from both sides: a live campaign refuses with a
 * `409`, and a finished one leaves the post free.
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

vi.mock("@/lib/db/creator-boost", () => ({
  getCreatorBoostBenefit: async () => null,
  getActiveCreatorMembership: async () => null,
}));

import { POST } from "./route";
import { adCampaigns, boostedPostCampaigns, pageRoles, posts } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedInsert, expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";

/** A published public Page post, which is what every gate below passes on. */
function publishedPagePost(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    pageId: PAGE_ID,
    groupId: null,
    visibility: "public",
    deletedAt: null,
    ...overrides,
  };
}

function boost(body: unknown) {
  return new Request("http://localhost/api/posts/boost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { postId: POST_ID, budget: 50, durationDays: 7, goal: "reach" };

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("POST /api/posts/boost", () => {
  it("requires a session before reading or writing anything", async () => {
    session.userId = null;

    const response = await POST(boost(validBody));

    expect(response.status).toBe(401);
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("requires a post and a valid request before it reads anything", async () => {
    expect((await POST(boost({ ...validBody, postId: "" }))).status).toBe(400);
    expect((await POST(boost({ ...validBody, postId: "not-a-uuid" }))).status).toBe(400);
    expect((await POST(boost({ ...validBody, budget: 1 }))).status).toBe(400);
    expect((await POST(boost({ ...validBody, goal: "miracles" }))).status).toBe(400);

    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 404 for a post that is not there", async () => {
    fakeDb.selectReturns(posts, []);

    const response = await POST(boost(validBody));

    expect(response.status).toBe(404);
    expectGatedNone("writes");
  });

  it("refuses a member's own post, a group post, and one that is not public", async () => {
    fakeDb
      .selectReturns(posts, [publishedPagePost({ pageId: null })])
      .selectReturns(posts, [publishedPagePost({ groupId: "44444444-4444-4444-8444-444444444444" })])
      .selectReturns(posts, [publishedPagePost({ visibility: "followers" })]);

    expect((await POST(boost(validBody))).status).toBe(400);
    expect((await POST(boost(validBody))).status).toBe(400);
    expect((await POST(boost(validBody))).status).toBe(400);
    expectGatedNone("writes");
  });

  it("refuses a post whose author Page the caller does not administer", async () => {
    fakeDb.selectReturns(posts, [publishedPagePost()]).selectReturns(pageRoles, []);

    const response = await POST(boost(validBody));

    expect(response.status).toBe(403);
    // The role read is gated on the Page *and* the session's id and the admin
    // role together — a member of the Page is not an admin of it.
    const roleRead = fakeDb.reads.indexOf("page_roles");
    expect(fakeDb.selectParams[roleRead]).toEqual([PAGE_ID, "admin-1", "admin"]);
    expectGatedNone("writes");
  });

  it("refuses a post that already has a live campaign, and writes nothing", async () => {
    fakeDb
      .selectReturns(posts, [publishedPagePost()])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "active" }]);

    const response = await POST(boost(validBody));

    expect(response.status).toBe(409);
    expectGatedNone("writes");
  });

  it("books the campaign at pending payment, with the window and the goal it was asked for", async () => {
    fakeDb
      .selectReturns(posts, [publishedPagePost()])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(adCampaigns, [])
      .insertReturns(adCampaigns, [
        {
          id: CAMPAIGN_ID,
          status: "pending_payment",
          budget: 50,
          chargeAmount: 50,
          creatorDiscountPercent: 0,
          creatorDiscountAmount: 0,
          priorityReview: false,
          startDate: new Date("2026-10-10T00:00:00.000Z"),
          endDate: new Date("2026-10-17T00:00:00.000Z"),
        },
      ])
      .insertReturns(boostedPostCampaigns, [{ id: "bp-1" }]);

    const response = await POST(
      boost({ ...validBody, targetLocation: "Lisbon", interests: ["design"] }),
    );

    expect(response.status).toBe(201);
    // Dates come back as the strings JSON makes of them: the response is the
    // campaign as a client receives it, not the row as the driver returned it.
    expect(await response.json()).toEqual({
      campaign: {
        id: CAMPAIGN_ID,
        status: "pending_payment",
        budget: 50,
        chargeAmount: 50,
        creatorDiscountPercent: 0,
        creatorDiscountAmount: 0,
        priorityReview: false,
        startDate: "2026-10-10T00:00:00.000Z",
        endDate: "2026-10-17T00:00:00.000Z",
        goal: "reach",
        postId: POST_ID,
      },
      next: "pay",
    });

    // Two writes, in the order the campaign and its link to the post are built:
    // the campaign carries the advertiser's own id — never one from the body —
    // and the goal lives on the join row, where the schema put it.
    expectGatedSequence("writes", ["ad_campaigns", "boosted_post_campaigns"]);
    expectGatedInsert(adCampaigns, {
      values: expect.objectContaining({
        advertiserId: "admin-1",
        type: "boosted_post",
        status: "pending_payment",
        budget: 50,
        chargeAmount: 50,
        creatorDiscountPercent: 0,
        creatorDiscountAmount: 0,
        priorityReview: false,
        targetLocation: "Lisbon",
        targetCategories: ["design"],
      }),
    });
    expectGatedInsert(boostedPostCampaigns, {
      values: { campaignId: CAMPAIGN_ID, postId: POST_ID, goal: "reach" },
    });
  });

  it("leaves a post free again once its campaign has finished", async () => {
    fakeDb
      .selectReturns(posts, [publishedPagePost()])
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(adCampaigns, [{ id: CAMPAIGN_ID, status: "completed" }])
      .insertReturns(adCampaigns, [
        { id: "55555555-5555-4555-8555-555555555555", status: "pending_payment" },
      ])
      .insertReturns(boostedPostCampaigns, [{ id: "bp-2" }]);

    const response = await POST(boost(validBody));

    expect(response.status).toBe(201);
  });

  it("refuses a post that is no longer on the site, before any Page is asked about", async () => {
    // A soft-deleted post is the one eligibility case whose refusal is a 404
    // rather than a 400: the payment target simply is not there any more. The
    // words matter too - they name the state the post is in, and are not the
    // generic missing-post answer.
    fakeDb.selectReturns(posts, [publishedPagePost({ deletedAt: new Date() })]);

    const response = await POST(boost(validBody));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "This post is no longer on the site" });
    expectGatedNone("writes");
  });

  it("answers 400 for a body that is not a boost request", async () => {
    const response = await POST(
      new Request("http://localhost/api/posts/boost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json [[",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A boost request is required" });
    expectGatedNone("reads");
    expectGatedNone("writes");
  });

  it("answers 500 when the post cannot be read", async () => {
    fakeDb.failNextSelect(posts, new Error("db down"));

    const response = await POST(boost(validBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to book this boost" });
  });
});
