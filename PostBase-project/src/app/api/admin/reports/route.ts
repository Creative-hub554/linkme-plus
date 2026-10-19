import { db } from "@/lib/db";
import { reports, users, posts, comments, reportStatusEnum } from "@/lib/db/schema";
import { requireAuth, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { eq, sql, count, desc, inArray } from "drizzle-orm";

/** What a report row gains: the target's words and its author's handle. */
interface TargetSummary {
  targetContent: string | null;
  targetAuthor: string | null;
}

function unique(values: (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * The queue reads better when a row says what it is about rather than only
 * naming its target by id: an admin judging a report should be able to read
 * the reported post's words and see its author's handle without leaving the
 * list. This returns one summary per report row, in the order given.
 *
 * Three batched reads, not one per row: every post target this page names in
 * one `inArray` ask of `posts`, the same for comments, and one ask of `users`
 * for every person involved — the content's author, and for rows that report
 * an account, the account itself (`targetAuthor` is then the reported member,
 * the handle the suspension or ban decision is about). A target that no longer
 * exists comes back as null fields rather than shortening the list: the report
 * still needs resolving, so its row still deserves its place.
 */
async function withTargetSummaries(rows: { targetType: string; targetId: string }[]) {
  const postIds = unique(rows.filter((row) => row.targetType === "post").map((row) => row.targetId));
  const commentIds = unique(rows.filter((row) => row.targetType === "comment").map((row) => row.targetId));

  // target id → what was said and who said it.
  const contents = new Map<string, { content: string | null; authorId: string | null }>();
  if (postIds.length > 0) {
    const found = await db
      .select({ id: posts.id, content: posts.content, authorId: posts.authorId })
      .from(posts)
      .where(inArray(posts.id, postIds));
    for (const post of found) {
      contents.set(post.id, { content: post.content, authorId: post.authorId });
    }
  }
  if (commentIds.length > 0) {
    const found = await db
      .select({ id: comments.id, content: comments.content, authorId: comments.authorId })
      .from(comments)
      .where(inArray(comments.id, commentIds));
    for (const comment of found) {
      contents.set(comment.id, { content: comment.content, authorId: comment.authorId });
    }
  }

  // One users read for every name the rows will show: authors of reported
  // content and the reported accounts. The reporter is deliberately left out —
  // the report's own words are what identifies it, and the author line is
  // about the target, not the informer.
  const memberIds = unique([
    ...rows.filter((row) => row.targetType === "user").map((row) => row.targetId),
    ...unique([...contents.values()].map((content) => content.authorId ?? undefined)),
  ]);
  const names = new Map<string, string>();
  if (memberIds.length > 0) {
    const members = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, memberIds));
    for (const member of members) names.set(member.id, member.username);
  }

  return rows.map<TargetSummary>((row) => {
    if (row.targetType === "post" || row.targetType === "comment") {
      const content = contents.get(row.targetId);
      const author = content?.authorId ?? null;
      return {
        targetContent: content?.content ?? null,
        targetAuthor: author ? `@${names.get(author)}` : null,
      };
    }
    if (row.targetType === "user") {
      const name = names.get(row.targetId);
      return { targetContent: null, targetAuthor: name ? `@${name}` : null };
    }
    return { targetContent: null, targetAuthor: null };
  });
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  // Check admin role
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user || user.role !== "admin") {
    return errorResponse("Unauthorized", 403);
  }

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") || "pending";
  // "all" means "do not filter"; anything else is narrowed to a real enum
  // member, so the value handed to Drizzle is one the column can accept.
  const status: (typeof reportStatusEnum.enumValues)[number] | "all" =
    requestedStatus === "all"
      ? "all"
      : reportStatusEnum.enumValues.find((value) => value === requestedStatus) ?? "pending";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  try {
    const result = await db
      .select()
      .from(reports)
      .where(status !== "all" ? eq(reports.status, status) : sql`1 = 1`)
      .orderBy(desc(reports.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(reports)
      .where(status !== "all" ? eq(reports.status, status) : sql`1 = 1`);

    const targetSummaries = await withTargetSummaries(result);
    const enrichedRows = result.map((row, index) => ({
      ...row,
      ...targetSummaries[index],
    }));
    return paginatedResponse(enrichedRows, total, page, limit);
  } catch (err) {
    console.error("Get reports error:", err);
    return errorResponse("Failed to fetch reports", 500);
  }
}
