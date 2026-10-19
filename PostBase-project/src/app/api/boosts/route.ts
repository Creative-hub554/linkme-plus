import { db } from "@/lib/db";
import { adCampaigns, adMetrics, boostedPostCampaigns, pageRoles, posts } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { PAGE_ACTIONS, spendFor, type CampaignStatus, type PageAction } from "@/lib/ads/boosts";
import { and, eq, inArray } from "drizzle-orm";

/**
 * The two halves of a Page's relationship with its own campaigns: what is
 * running, and what the administrator may do about it.
 *
 * `GET` answers the first with the numbers the PRD's report asks for — spend,
 * impressions, clicks, the campaign's own dates — and `POST` takes one action
 * from the page-admin ladder (`pay`, `pause`, `resume`, `cancel`). Approval is
 * deliberately *not* offered here: it belongs to the platform admin, and an
 * advertiser clearing their own campaign is the rule the PRD states twice.
 *
 * Everything is gated on the Page's own role row, read for the Page the campaign
 * belongs to rather than for the advertiser's account: a campaign created by one
 * admin is visible to the others, and neither may act on a Page they do not
 * administer.
 */

/** How each action reads inside a refusal, so the sentence is English. */
const VERBS: Record<PageAction, string> = {
  pay: "paid for",
  pause: "paused",
  resume: "resumed",
  cancel: "cancelled",
};

/** One campaign as the list reports it. */
function toReport(row: {
  id: string;
  status: CampaignStatus;
  budget: number;
  spent: number | null;
  startDate: Date | null;
  endDate: Date | null;
  goal: string | null;
  postId: string;
  /** The post's opening words, so the list can say what it is about. */
  excerpt: string | null;
  impressions: number;
  clicks: number;
}) {
  return {
    id: row.id,
    status: row.status,
    postId: row.postId,
    goal: row.goal,
    excerpt: row.excerpt,
    budget: row.budget,
    // The spend the delivery implies, rather than the column, which is only
    // ever written when a campaign is settled. An advertiser watching a
    // running boost wants what it has cost so far, and this is the same
    // arithmetic delivery stops on.
    spent: spendFor(row.impressions, row.budget),
    impressions: row.impressions,
    clicks: row.clicks,
    startDate: row.startDate,
    endDate: row.endDate,
  };
}

async function isAdminOf(pageId: string, userId: string) {
  const [role] = await db
    .select({ id: pageRoles.id })
    .from(pageRoles)
    .where(and(eq(pageRoles.pageId, pageId), eq(pageRoles.userId, userId), eq(pageRoles.role, "admin")));
  return Boolean(role);
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId") ?? "";
  if (!isUuid(pageId)) return errorResponse("A page id is required", 400);

  try {
    if (!(await isAdminOf(pageId, session.user.id))) {
      return errorResponse("Only a Page admin can see its campaigns", 403);
    }

    const rows = await db
      .select({
        id: adCampaigns.id,
        status: adCampaigns.status,
        budget: adCampaigns.budget,
        spent: adCampaigns.spent,
        startDate: adCampaigns.startDate,
        endDate: adCampaigns.endDate,
        goal: boostedPostCampaigns.goal,
        postId: boostedPostCampaigns.postId,
        excerpt: posts.content,
      })
      .from(adCampaigns)
      .innerJoin(boostedPostCampaigns, eq(adCampaigns.id, boostedPostCampaigns.campaignId))
      .innerJoin(posts, eq(boostedPostCampaigns.postId, posts.id))
      .where(eq(posts.pageId, pageId));

    // The metrics are summed here rather than in SQL: a campaign's rows are its
    // days, there are few of them, and the aggregate has to agree with the
    // spend above it — which is derived from the same two numbers.
    const metrics =
      rows.length > 0
        ? await db
            .select()
            .from(adMetrics)
            .where(
              inArray(
                adMetrics.campaignId,
                rows.map((row) => row.id),
              ),
            )
        : [];

    const byCampaign = new Map<string, { impressions: number; clicks: number }>();
    for (const metric of metrics) {
      const tally = byCampaign.get(metric.campaignId) ?? { impressions: 0, clicks: 0 };
      tally.impressions += metric.impressions ?? 0;
      tally.clicks += metric.clicks ?? 0;
      byCampaign.set(metric.campaignId, tally);
    }

    const campaigns = rows.map((row) =>
      toReport({ ...row, ...(byCampaign.get(row.id) ?? { impressions: 0, clicks: 0 }) }),
    );

    return successResponse({ campaigns });
  } catch (listError) {
    console.error("List boost campaigns error:", listError);
    return errorResponse("Unable to list these campaigns", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("A campaign and an action are required", 400);
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId || !isUuid(campaignId)) {
    return errorResponse("A campaign is required", 400);
  }

  const action = typeof body.action === "string" ? (body.action as PageAction) : ("" as PageAction);
  if (!(action in PAGE_ACTIONS)) {
    return errorResponse("That is not an action a Page admin may take", 400);
  }

  try {
    // The campaign, its post and the Page that post belongs to, in one read:
    // the role gate below is about the Page, and reaching it through the post
    // is what keeps "the Page's campaigns" and "the advertiser's account" from
    // becoming two different answers.
    const [campaign] = await db
      .select({
        id: adCampaigns.id,
        status: adCampaigns.status,
        pageId: posts.pageId,
      })
      .from(adCampaigns)
      .innerJoin(boostedPostCampaigns, eq(adCampaigns.id, boostedPostCampaigns.campaignId))
      .innerJoin(posts, eq(boostedPostCampaigns.postId, posts.id))
      .where(eq(adCampaigns.id, campaignId));

    if (!campaign) return errorResponse("Campaign not found", 404);
    if (!campaign.pageId) return errorResponse("This campaign has no Page behind it", 409);
    if (!(await isAdminOf(campaign.pageId, session.user.id))) {
      return errorResponse("Only a Page admin may manage its campaigns", 403);
    }

    const step = PAGE_ACTIONS[action];
    if (!step.from.includes(campaign.status)) {
      // The status is in the answer because it is the whole of the refusal: an
      // action that is not legal *now* is not a mistake, it is a campaign that
      // has moved on — and a client that shows the wrong button deserves to be
      // told which button was right.
      return errorResponse(
        `A campaign that is ${campaign.status.replace("_", " ")} cannot be ${VERBS[action]}`,
        409,
      );
    }

    const [updated] = await db
      .update(adCampaigns)
      .set({ status: step.to })
      .where(eq(adCampaigns.id, campaignId))
      .returning({ id: adCampaigns.id, status: adCampaigns.status });

    return successResponse({ campaign: updated });
  } catch (actionError) {
    console.error("Boost campaign action error:", actionError);
    return errorResponse("Unable to update this campaign", 500);
  }
}
