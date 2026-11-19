import { db } from "@/lib/db";
import { users, posts, reports, moderationActions } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { count, desc, eq, isNull } from "drizzle-orm";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    const [actor] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id));
    if (actor?.role !== "admin")
      return errorResponse("Administrator access required", 403);
    const [[userCount], [postCount], [pendingCount], members, actions] =
      await Promise.all([
        db
          .select({ total: count() })
          .from(users)
          .where(isNull(users.deletedAt)),
        db
          .select({ total: count() })
          .from(posts)
          .where(isNull(posts.deletedAt)),
        db
          .select({ total: count() })
          .from(reports)
          .where(eq(reports.status, "pending")),
        db
          .select({
            id: users.id,
            username: users.username,
            role: users.role,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(isNull(users.deletedAt))
          .orderBy(desc(users.createdAt))
          .limit(20),
        db
          .select({
            id: moderationActions.id,
            targetType: moderationActions.targetType,
            action: moderationActions.action,
            reason: moderationActions.reason,
            createdAt: moderationActions.createdAt,
          })
          .from(moderationActions)
          .orderBy(desc(moderationActions.createdAt))
          .limit(20),
      ]);
    return successResponse({
      stats: {
        users: userCount.total,
        posts: postCount.total,
        pendingReports: pendingCount.total,
      },
      users: members,
      actions,
    });
  } catch {
    return errorResponse("Unable to load admin overview", 500);
  }
}
