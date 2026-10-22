import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, scheduledCreatorPosts } from "@/lib/db/schema";

/**
 * Claims due scheduled text posts before publishing them. The short-lived
 * `publishing` state prevents two cron invocations from releasing a duplicate
 * post if their windows overlap. Failed rows stay visible in Creator Hub.
 */
export async function publishDueCreatorPosts(now = new Date(), batchLimit = 25) {
  const due = await db
    .select({ id: scheduledCreatorPosts.id })
    .from(scheduledCreatorPosts)
    .where(and(eq(scheduledCreatorPosts.status, "scheduled"), lte(scheduledCreatorPosts.scheduledFor, now)))
    .limit(batchLimit);

  let published = 0;
  let failed = 0;
  for (const candidate of due) {
    const [claimed] = await db
      .update(scheduledCreatorPosts)
      .set({ status: "publishing", updatedAt: now })
      .where(and(eq(scheduledCreatorPosts.id, candidate.id), eq(scheduledCreatorPosts.status, "scheduled")))
      .returning({ id: scheduledCreatorPosts.id, creatorId: scheduledCreatorPosts.creatorId, content: scheduledCreatorPosts.content, visibility: scheduledCreatorPosts.visibility });
    if (!claimed) continue;
    try {
      const [post] = await db
        .insert(posts)
        .values({ authorId: claimed.creatorId, content: claimed.content, visibility: claimed.visibility, type: "text" })
        .returning({ id: posts.id });
      await db
        .update(scheduledCreatorPosts)
        .set({ status: "published", publishedPostId: post.id, updatedAt: new Date() })
        .where(eq(scheduledCreatorPosts.id, claimed.id));
      published += 1;
    } catch (scheduleError) {
      await db
        .update(scheduledCreatorPosts)
        .set({ status: "failed", failureReason: scheduleError instanceof Error ? scheduleError.message.slice(0, 500) : "Publishing failed", updatedAt: new Date() })
        .where(eq(scheduledCreatorPosts.id, claimed.id));
      failed += 1;
    }
  }
  return { claimed: due.length, published, failed };
}
