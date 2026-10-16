import { describe, expect, it } from "vitest";

import {
  BOOST_CPM,
  PAGE_ACTIONS,
  REVIEW_ACTIONS,
  dayStart,
  impressionsAllowable,
  isDelivering,
  parseBoostRequest,
  spendFor,
  windowFrom,
  type CampaignStatus,
} from "./boosts";

/**
 * The rules a boosted post is built out of, stated where they can be wrong
 * without a request, a database or a clock in the way.
 *
 * The three that most deserve a test rather than a reading: the money (an
 * integer column and a fractional charge, which must not round a spend away to
 * nothing), the ladder (an action whose source state is not listed must be
 * refused, and the table is the only place that is decided), and the window
 * (approval re-anchors it, so "three days already gone" cannot happen).
 */

function request(overrides: Record<string, unknown> = {}) {
  return parseBoostRequest({
    budget: 50,
    durationDays: 7,
    goal: "reach",
    targetLocation: null,
    interests: [],
    ...overrides,
  });
}

describe("a boost request", () => {
  it("accepts the least an administrator can ask for, and reports it back", () => {
    const parsed = parseBoostRequest({ budget: 5, durationDays: 7, goal: "reach" });
    expect(parsed).toEqual({
      ok: true,
      value: { budget: 5, durationDays: 7, goal: "reach", targetLocation: null, interests: [] },
    });
  });

  it("refuses a budget that would deliver nothing, or that no click justifies", () => {
    expect(request({ budget: 0 })).toEqual({ ok: false, reason: "A budget between 5 and 5000 is required" });
    expect(request({ budget: 5001 })).toEqual({
      ok: false,
      reason: "A budget between 5 and 5000 is required",
    });
    expect(request({ budget: "50" })).toEqual({
      ok: false,
      reason: "A budget between 5 and 5000 is required",
    });
  });

  it("refuses a duration outside the three the platform books", () => {
    expect(request({ durationDays: 8 })).toEqual({
      ok: false,
      reason: "A duration of 7, 14 or 30 days is required",
    });
    expect(request({ durationDays: "7" })).toEqual({
      ok: false,
      reason: "A duration of 7, 14 or 30 days is required",
    });
  });

  it("refuses a goal the platform does not offer, and an absent one", () => {
    expect(request({ goal: "telepathy" })).toEqual({
      ok: false,
      reason: "The goal is not one this platform offers",
    });
    expect(request({ goal: undefined })).toEqual({ ok: false, reason: "A goal is required" });
  });

  it("trims the targeting, drops what is not a word, and bounds both", () => {
    const parsed = request({
      targetLocation: "  Lisbon  ",
      interests: [" design ", 7, "  ", "gardening"],
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        budget: 50,
        durationDays: 7,
        goal: "reach",
        targetLocation: "Lisbon",
        interests: ["design", "gardening"],
      },
    });

    expect(request({ interests: ["a", "b", "c", "d", "e", "f"] })).toEqual({
      ok: false,
      reason: "At most 5 interests may be targeted",
    });
    expect(request({ interests: ["x".repeat(41)] })).toEqual({
      ok: false,
      reason: "An interest is too long",
    });
  });
});

describe("what a budget buys", () => {
  it("turns a budget into the impressions it may serve", () => {
    expect(impressionsAllowable(5)).toBe((5 * 1000) / BOOST_CPM);
    expect(impressionsAllowable(50)).toBe(10_000);
  });

  it("does not round a real impression away to a free one", () => {
    // One impression at a five-per-thousand rate is a fraction of a unit, and a
    // column that can only hold whole ones must keep it — not drop it.
    expect(spendFor(1, 50)).toBe(1);
    expect(spendFor(1_000, 50)).toBe(BOOST_CPM);
  });

  it("never reports more spend than the campaign was authorised for", () => {
    expect(spendFor(999_999, 50)).toBe(50);
  });
});

describe("the campaign ladder", () => {
  it("lets a page admin take a campaign from paying to in review, and no other way", () => {
    expect(PAGE_ACTIONS.pay.from).toEqual(["pending_payment"]);
    expect(PAGE_ACTIONS.pay.to).toBe("pending_review");
    expect(PAGE_ACTIONS.pay.from.includes("active" as CampaignStatus)).toBe(false);
  });

  it("lets a running campaign be paused and a paused one resumed", () => {
    expect(PAGE_ACTIONS.pause.from).toEqual(["active"]);
    expect(PAGE_ACTIONS.resume.from).toEqual(["paused"]);
  });

  it("keeps approval and rejection to a platform admin's own step", () => {
    expect(REVIEW_ACTIONS.approve.from).toEqual(["pending_review"]);
    expect(REVIEW_ACTIONS.reject.from).toEqual(["pending_review"]);
    // The page-admin ladder has no approve at all: an advertiser cannot clear
    // their own campaign, which is the rule the PRD states twice.
    expect(Object.keys(PAGE_ACTIONS)).not.toContain("approve");
    expect(Object.keys(PAGE_ACTIONS)).not.toContain("reject");
  });

  it("offers every source state an action may be taken from", () => {
    const legal = (action: keyof typeof PAGE_ACTIONS, from: CampaignStatus) =>
      PAGE_ACTIONS[action].from.includes(from);

    expect(legal("cancel", "pending_payment")).toBe(true);
    expect(legal("cancel", "active")).toBe(true);
    expect(legal("cancel", "completed")).toBe(false);
    expect(legal("cancel", "rejected")).toBe(false);
    expect(legal("pause", "pending_review")).toBe(false);
  });
});

describe("the delivery window", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const running = { status: "active" as CampaignStatus, ...windowFrom(now, 7) };

  it("serves a running campaign inside its window", () => {
    expect(isDelivering(running, now)).toBe(true);
    expect(isDelivering(running, new Date("2026-10-16T23:59:59.000Z"))).toBe(true);
  });

  it("serves nothing outside the window, or before it opens", () => {
    // The window runs for exactly seven days from the moment it was booked, so
    // the boundary is that instant and not a calendar midnight.
    expect(isDelivering(running, new Date("2026-10-17T12:00:01.000Z"))).toBe(false);
    expect(isDelivering(running, new Date("2026-10-10T11:59:59.000Z"))).toBe(false);
  });

  it("serves nothing that is not running, and nothing with no window", () => {
    expect(isDelivering({ ...running, status: "paused" }, now)).toBe(false);
    expect(isDelivering({ ...running, status: "pending_review" }, now)).toBe(false);
    expect(isDelivering({ status: "active", startDate: null, endDate: now }, now)).toBe(false);
  });

  it("counts a metric row from midnight, so a day's cap is a day's", () => {
    expect(dayStart(new Date("2026-10-10T23:59:59.000Z")).toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });
});
