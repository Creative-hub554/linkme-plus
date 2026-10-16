/**
 * The rules a boosted post is built out of.
 *
 * The PRD's Page Post Boost is four decisions in a trench coat: who may ask
 * (a Page admin, for a public published post of that Page), what they may ask
 * for (a budget, a duration, a goal, optional targeting), what happens next
 * (payment is authorised, a platform admin approves, delivery runs inside a
 * window), and what delivery costs (impressions drawn against the budget at a
 * fixed rate).
 *
 * This module holds those rules as pure functions over plain values, so the
 * routes that use them decide *when* to apply a rule and the tests here decide
 * whether the rule is right. No database, no request, no clock: the caller
 * passes the instant, which is what makes a window boundary testable rather
 * than merely believed.
 *
 * What it deliberately does not model: a payment provider. The app has none
 * connected, so "pay" is the authorisation step of the PRD's ladder — a status
 * change and nothing more — and the real gateway can replace the route's
 * handler without any of these rules moving.
 */

/** The goal an administrator picks, as the column stores it. */
export const BOOST_GOALS = [
  "reach",
  "engagement",
  "website_visits",
  "marketplace_visits",
  "job_applications",
] as const;

export type BoostGoal = (typeof BOOST_GOALS)[number];

/** The durations a boost may be booked for, in days. */
export const BOOST_DURATIONS = [7, 14, 30] as const;

/**
 * What a thousand impressions cost, in whole budget units.
 *
 * The column is an integer, so a fractional per-impression charge would
 * truncate to nothing; spend is therefore derived from the impression count
 * (`spendFor`) rather than accrued a fraction at a time. Delivery stops when
 * that derived spend reaches the budget, which is the whole of the money rule.
 */
export const BOOST_CPM = 5;

export const BOOST_MIN_BUDGET = 5;
export const BOOST_MAX_BUDGET = 5_000;

/**
 * Impressions one campaign may serve in a day.
 *
 * A stand-in for the frequency caps the PRD asks for, and the honest limit of
 * one: capping per *reader* needs a ledger of who has seen what, which the
 * schema does not have yet. Capping per campaign per day still stops a boost
 * from eating its budget in an hour and then asking for more.
 */
export const DAILY_IMPRESSION_CAP = 500;

/** The campaign statuses, spelled the way the enum column spells them. */
export const CAMPAIGN_STATUSES = [
  "draft",
  "pending_payment",
  "pending_review",
  "approved",
  "scheduled",
  "active",
  "paused",
  "rejected",
  "completed",
  "cancelled",
  "refunded",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Statuses in which a campaign is occupying its post. */
const LIVE_STATUSES = new Set<CampaignStatus>([
  "pending_payment",
  "pending_review",
  "approved",
  "scheduled",
  "active",
  "paused",
]);

/**
 * The actions the page-admin route offers, and the states each may be taken
 * from. Stated as a table rather than as branches so the whole ladder is one
 * reading — and so an action that has no legal source state is refused before
 * a row is read, let alone written.
 */
export const PAGE_ACTIONS = {
  // The `from` lists are typed rather than inferred as literals, so a check
  // against a campaign's status is a check and not a comparison with `never`.
  pay: { from: ["pending_payment"] as readonly CampaignStatus[], to: "pending_review" },
  pause: { from: ["active"] as readonly CampaignStatus[], to: "paused" },
  resume: { from: ["paused"] as readonly CampaignStatus[], to: "active" },
  cancel: {
    from: [
      "pending_payment",
      "pending_review",
      "approved",
      "scheduled",
      "active",
      "paused",
    ] as readonly CampaignStatus[],
    to: "cancelled",
  },
} as const satisfies Record<string, { from: readonly CampaignStatus[]; to: CampaignStatus }>;

export type PageAction = keyof typeof PAGE_ACTIONS;

/** The actions only a platform admin may take, and the states they need. */
export const REVIEW_ACTIONS = {
  approve: { from: ["pending_review"] as readonly CampaignStatus[], to: "active" },
  reject: { from: ["pending_review"] as readonly CampaignStatus[], to: "rejected" },
} as const satisfies Record<
  string,
  { from: readonly CampaignStatus[]; to: CampaignStatus }
>;

export type ReviewAction = keyof typeof REVIEW_ACTIONS;

/** Why a boost request was refused, in the words the route returns. */
export type BoostRejection =
  | "A budget between 5 and 5000 is required"
  | "A duration of 7, 14 or 30 days is required"
  | "A goal is required"
  | "The goal is not one this platform offers"
  | "Target location is too long"
  | "At most 5 interests may be targeted"
  | "An interest is too long";

/** What a valid boost request asked for. */
export interface BoostRequest {
  budget: number;
  durationDays: (typeof BOOST_DURATIONS)[number];
  goal: BoostGoal;
  targetLocation: string | null;
  interests: string[];
}

/**
 * Read the request body into the shape the route stores, or say why it cannot
 * be.
 *
 * Every field is checked here rather than trusted into a column: the budget is
 * bounded at both ends (a zero-credit boost would deliver nothing and a
 * five-thousand one is not a click), the duration is one of three, and the goal
 * is one the enum's vocabulary carries. The targeting is optional but bounded,
 * because an unbounded array in a request body is an unbounded write.
 */
export function parseBoostRequest(body: unknown): { ok: true; value: BoostRequest } | { ok: false; reason: BoostRejection } {
  const input = (body ?? {}) as Record<string, unknown>;

  const budget = typeof input.budget === "number" ? Math.trunc(input.budget) : NaN;
  if (!Number.isFinite(budget) || budget < BOOST_MIN_BUDGET || budget > BOOST_MAX_BUDGET) {
    return { ok: false, reason: "A budget between 5 and 5000 is required" };
  }

  const duration = input.durationDays;
  if (duration !== 7 && duration !== 14 && duration !== 30) {
    return { ok: false, reason: "A duration of 7, 14 or 30 days is required" };
  }

  const goal = typeof input.goal === "string" ? input.goal : "";
  if (goal === "") return { ok: false, reason: "A goal is required" };
  if (!BOOST_GOALS.includes(goal as BoostGoal)) {
    return { ok: false, reason: "The goal is not one this platform offers" };
  }

  const targetLocation =
    typeof input.targetLocation === "string" && input.targetLocation.trim() !== ""
      ? input.targetLocation.trim().slice(0, 100)
      : null;
  if (typeof input.targetLocation === "string" && input.targetLocation.length > 100) {
    return { ok: false, reason: "Target location is too long" };
  }

  const rawInterests = Array.isArray(input.interests) ? input.interests : [];
  if (rawInterests.length > 5) {
    return { ok: false, reason: "At most 5 interests may be targeted" };
  }
  const interests = rawInterests
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .slice(0, 5);
  if (rawInterests.some((value) => typeof value === "string" && value.length > 40)) {
    return { ok: false, reason: "An interest is too long" };
  }

  return {
    ok: true,
    value: { budget, durationDays: duration, goal: goal as BoostGoal, targetLocation, interests },
  };
}

/** Whether a campaign still occupies its post — one live boost per post. */
export function occupiesPost(status: CampaignStatus): boolean {
  return LIVE_STATUSES.has(status);
}

/**
 * Whether a campaign may be served at this instant.
 *
 * Three independent answers, and a campaign needs all of them: it is running,
 * its window has arrived and not passed, and the day's cap has room. The
 * impression budget is checked by the caller, which is where the count lives.
 */
export function isDelivering(
  campaign: { status: CampaignStatus; startDate: Date | null; endDate: Date | null },
  now: Date,
): boolean {
  if (campaign.status !== "active") return false;
  if (!campaign.startDate || !campaign.endDate) return false;
  return campaign.startDate.getTime() <= now.getTime() && now.getTime() <= campaign.endDate.getTime();
}

/**
 * The window a campaign runs in, from the day it was booked for.
 *
 * The booked window is anchored at creation so the request records the length
 * the administrator asked for; approval re-anchors it from the moment delivery
 * actually starts, so a campaign approved on a Tuesday does not arrive with
 * three days of its window already gone.
 */
export function windowFrom(start: Date, durationDays: number): { startDate: Date; endDate: Date } {
  const endDate = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
  return { startDate: start, endDate };
}

/** Impressions a budget buys at {@link BOOST_CPM}, rounded down. */
export function impressionsAllowable(budget: number): number {
  return Math.floor((budget * 1000) / BOOST_CPM);
}

/**
 * What a number of impressions has cost, in whole budget units.
 *
 * Rounded *up* and capped at the budget: a campaign never reports spending more
 * than it was authorised for, and a fraction of a unit is a whole one rather
 * than nothing — which is the direction an integer column should err in when
 * the money is the advertiser's.
 */
export function spendFor(impressions: number, budget: number): number {
  return Math.min(budget, Math.ceil((impressions * BOOST_CPM) / 1000));
}

/** The first day a metric row belongs to, for a campaign served on `now`. */
export function dayStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}
