import { db } from "@/lib/db";
import { users, profiles, posts, pages, groups, marketplaceListings, jobs, companies, follows } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, sql, like, or, desc, and } from "drizzle-orm";
import { visiblePostsCondition } from "@/lib/db/post-visibility";
import { notBlockedEitherWay } from "@/lib/db/blocks";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const type = url.searchParams.get("type") || "all";
  const limit = parseInt(url.searchParams.get("limit") || "20");

  if (!query) {
    return errorResponse("Search query is required");
  }

  try {
    const searchTerm = `%${query}%`;
    const results: Record<string, unknown> = {};

    // Search users
    if (type === "all" || type === "users") {
      results.users = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: profiles.displayName,
          avatarUrl: profiles.avatarUrl,
          bio: profiles.bio,
          // Whether the viewer already follows this member. Without it a result
          // offers to follow somebody they already follow, which reads as
          // broken — and the follow endpoint is asked for an intent, not a
          // toggle, so a wrong label would be misleading rather than harmless.
          isFollowing: sql<boolean>`exists (
            select 1 from ${follows} as f
            where f.follower_id = ${session.user.id} and f.following_id = ${users.id}
          )`,
        })
        .from(users)
        .innerJoin(profiles, eq(users.id, profiles.userId))
        .where(
          and(
            or(
              like(profiles.displayName, searchTerm),
              like(users.username, searchTerm)
            ),
            // Search is another way to find a member, so a block must hide them
            // here too — in either direction, not only the searcher's own.
            notBlockedEitherWay(session.user.id, users.id)
          )
        )
        .limit(limit);
    }

    // Search posts
    if (type === "all" || type === "posts") {
      results.posts = await db
        .select({
          id: posts.id,
          content: posts.content,
          createdAt: posts.createdAt,
          author: {
            name: profiles.displayName,
            username: users.username,
          },
        })
        .from(posts)
        .innerJoin(users, eq(posts.authorId, users.id))
        .innerJoin(profiles, eq(users.id, profiles.userId))
        // Search is another way to read a post, so the same audience rule
        // applies: without it a private post's text is searchable by anybody.
        .where(
          and(
            like(posts.content, searchTerm),
            sql`${posts.deletedAt} IS NULL`,
            visiblePostsCondition(session.user.id),
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(limit);
    }

    // Search pages
    if (type === "all" || type === "pages") {
      results.pages = await db
        .select()
        .from(pages)
        .where(
          or(
            like(pages.name, searchTerm),
            like(pages.description, searchTerm)
          )
        )
        .limit(limit);
    }

    // Search groups
    if (type === "all" || type === "groups") {
      results.groups = await db
        .select()
        .from(groups)
        .where(
          or(
            like(groups.name, searchTerm),
            like(groups.description, searchTerm)
          )
        )
        .limit(limit);
    }

    // Search marketplace
    if (type === "all" || type === "marketplace") {
      results.marketplace = await db
        .select()
        .from(marketplaceListings)
        .where(
          or(
            like(marketplaceListings.title, searchTerm),
            like(marketplaceListings.description, searchTerm)
          )
        )
        .orderBy(desc(marketplaceListings.createdAt))
        .limit(limit);
    }

    // Search jobs
    if (type === "all" || type === "jobs") {
      results.jobs = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          location: jobs.location,
          jobType: jobs.jobType,
          createdAt: jobs.createdAt,
          company: {
            name: companies.name,
            logoUrl: companies.logoUrl,
          },
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(
          or(
            like(jobs.title, searchTerm),
            like(jobs.description, searchTerm)
          )
        )
        .orderBy(desc(jobs.createdAt))
        .limit(limit);
    }

    return successResponse({ results });
  } catch (err) {
    console.error("Search error:", err);
    return errorResponse("Search failed", 500);
  }
}
