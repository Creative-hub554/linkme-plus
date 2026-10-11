import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the feed serves beside the reader's own posts.
 *
 * The three rules this exists to hold are each a case below: money buys
 * *placement* and not *access* (the same audience rule runs on a sponsored post
 * as on any other), a campaign at its day's cap is passed over rather than
 * asked twice, and a post already in the page of feed is dropped rather than
 * shown twice under two names.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return { db: fakeDb, withDbRetry: (operation: () => unknown) => operation() };
});

import { isHomeFeed, sponsoredFeedPosts } from "./sponsored-feed";
import { adCampaigns, adMetrics, postMedia, posts } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { DAILY_IMPRESSION_CAP } from "./boosts";

const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const POST_ID = "11111111-1111-4111-8111-111111111111";
const READER_ID = "99999999-9999-4999-8999-999999999999";

/** A campaign running now, for a post, unless a case says otherwise. */
function running() {
  return {
    campaignId: CAMPAIGN_ID,
    budget: 50,
    postId: POST_ID,
    startDate: new Date(Date.now() - 60_000),
    endDate: new Date(Date.now() + 60_000),
  };
}

/** The post a running campaign points at, in the feed's own shape. */
function servedPost() {
  return {
    id: POST_ID,
    content: "Opening night is Thursday.",
    type: "text",
    visibility: "public",
    createdAt: new Date("2026-10-09T09:00:00.000Z"),
    editedAt: null,
    commentCount: 2,
    reactionCount: 5,
    author: { id: "88888888-8888-4888-8888-888888888888", name: "Theo Wu", username: "theo", avatarUrl: null },
    page: { id: "77777777-7777-4777-8777-777777777777", username: "northside", name: "Northside Studio", avatarUrl: null },
    campaignId: CAMPAIGN_ID,
    targetLocation: "Lisbon",
  };
}

function ask(excludePostIds: string[] = []) {
  return sponsoredFeedPosts({ readerId: READER_ID, excludePostIds, limit: 1 });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
});

describe("sponsoredFeedPosts", () => {
  it("serves nothing when no campaign is running, and looks no further", async () => {
    fakeDb.selectReturns(adCampaigns, []);

    expect(await ask()).toEqual([]);
    // One read: nothing to cap, nothing to load.
    expect(fakeDb.reads).toEqual(["ad_campaigns"]);
  });

  it("passes over a campaign that has served its day already", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, [
        { campaignId: CAMPAIGN_ID, date: new Date(), impressions: DAILY_IMPRESSION_CAP, clicks: 0 },
      ]);

    expect(await ask()).toEqual([]);
    // The cap is read before a post is fetched, so a capped campaign costs one
    // read of its own metrics and nothing else.
    expect(fakeDb.reads).toEqual(["ad_campaigns", "ad_metrics"]);
  });

  it("serves the post in the feed's own shape, tagged as sponsored", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, [])
      .selectReturns(posts, [servedPost()])
      .selectReturns(postMedia, [
        { postId: POST_ID, url: "https://cdn.example/poster.png", altText: "Opening night poster", type: "image", order: 0 },
      ]);

    const sponsored = await ask();

    expect(sponsored).toHaveLength(1);
    expect(sponsored[0]).toMatchObject({
      id: POST_ID,
      sponsored: true,
      campaignId: CAMPAIGN_ID,
      content: "Opening night is Thursday.",
      commentCount: 2,
      reactionCount: 5,
      page: { username: "northside" },
      media: [{ url: "https://cdn.example/poster.png" }],
    });

    // The post read is gated on public visibility as well as on the ids the
    // caps left: a boost buys placement, not access. The audience rule rides
    // along behind them, which is the same condition the organic feed carries.
    const postRead = fakeDb.reads.indexOf("posts");
    expect(fakeDb.selectParams[postRead].slice(0, 2)).toEqual([POST_ID, "public"]);
  });

  it("does not serve a post the reader's page of feed already holds", async () => {
    fakeDb
      .selectReturns(adCampaigns, [running()])
      .selectReturns(adMetrics, []);

    expect(await ask([POST_ID])).toEqual([]);
    // Nothing is fetched for a post that is already on screen.
    expect(fakeDb.reads).toEqual(["ad_campaigns", "ad_metrics"]);
  });
});

describe("isHomeFeed", () => {
  it("recognises the front page of the feed and nothing narrower", () => {
    expect(isHomeFeed(new URLSearchParams("limit=20"))).toBe(true);
    expect(isHomeFeed(new URLSearchParams("authorId=1"))).toBe(false);
    expect(isHomeFeed(new URLSearchParams("pageId=1"))).toBe(false);
    expect(isHomeFeed(new URLSearchParams("groupId=1"))).toBe(false);
    expect(isHomeFeed(new URLSearchParams("ids=1,2"))).toBe(false);
    expect(isHomeFeed(new URLSearchParams("cursor=abc"))).toBe(false);
  });
});
