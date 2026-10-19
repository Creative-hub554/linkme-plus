import { db } from "@/lib/db";
import { adCampaigns, posts, reports, users } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { count, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * The campaign states in which a budget is real money the platform holds:
 * approved and running or already delivered. Drafts were never authorised,
 * pending campaigns have not been approved, and cancelled/refunded/rejected
 * campaigns either never started or had to give the money back — counting
 * those would inflate the number, so the where-clause enumerates the paid
 * states rather than excluding the free ones.
 */
const REVENUE_STATUSES = ["approved", "scheduled", "active", "paused", "completed"] as const;

/**
 * The dashboard's headline numbers, in one read.
 *
 * These are counts, not estimates, so each is computed by the database rather
 * than guessed client-side: members the platform still has (a soft-deleted
 * account is not one), posts live after soft deletes, reports still waiting
 * for a decision, and delivered ad spend — the money actually taken, not the
 * money merely booked. One route, admin-only, because every number here is
 * something a stranger could mine for: how big the platform is, how much
 * money it moves, how badly moderated its content is.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const [admin] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id));

    if (!admin || admin.role !== "admin") {
      return errorResponse("Unauthorized", 403);
    }

    const [userCount] = await db
      .select({ total: count() })
      .from(users)
      .where(isNull(users.deletedAt));
    const [postCount] = await db
      .select({ total: count() })
      .from(posts)
      .where(isNull(posts.deletedAt));
    const [reportCount] = await db
      .select({ total: count() })
      .from(reports)
      .where(eq(reports.status, "pending"));
    // `sum` over an integer column answers bigint in Postgres, which arrives as
    // a string over the wire; the cast keeps it a number the payload promised.
    const [spend] = await db
      .select({ revenue: sql<number>`coalesce(sum(${adCampaigns.spent}), 0)::int` })
      .from(adCampaigns)
      .where(inArray(adCampaigns.status, [...REVENUE_STATUSES]));

    return successResponse({
      stats: {
        totalUsers: Number(userCount?.total ?? 0),
        activePosts: Number(postCount?.total ?? 0),
        pendingReports: Number(reportCount?.total ?? 0),
        adRevenue: Number(spend?.revenue ?? 0),
      },
    });
  } catch (statsError) {
    console.error("Admin stats error:", statsError);
    return errorResponse("Unable to compute platform stats", 500);
  }
}
