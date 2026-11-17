import { db } from "@/lib/db";
import { posts, pageRoles, pages, marketplaceListings } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { and, eq, isNull, desc, or } from "drizzle-orm";
import { offsetPagination } from "@/lib/offset-pagination";
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  const { limit, offset } = offsetPagination(
    new URL(request.url).searchParams,
    100,
  );
  try {
    const listings = await db
      .select({ id: marketplaceListings.id, title: marketplaceListings.title })
      .from(marketplaceListings)
      .where(
        and(
          eq(marketplaceListings.sellerId, session.user.id),
          eq(marketplaceListings.status, "active"),
          isNull(marketplaceListings.deletedAt),
        ),
      )
      .orderBy(desc(marketplaceListings.createdAt))
      .limit(limit)
      .offset(offset);
    const publicPosts = await db
      .select({ id: posts.id, content: posts.content, pageName: pages.name })
      .from(posts)
      .leftJoin(
        pageRoles,
        and(
          eq(posts.pageId, pageRoles.pageId),
          eq(pageRoles.userId, session.user.id),
          eq(pageRoles.role, "admin"),
        ),
      )
      .leftJoin(pages, eq(posts.pageId, pages.id))
      .where(
        and(
          or(
            and(isNull(posts.pageId), eq(posts.authorId, session.user.id)),
            eq(pageRoles.userId, session.user.id),
          ),
          isNull(posts.groupId),
          eq(posts.visibility, "public"),
          isNull(posts.deletedAt),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset);
    return successResponse({ listings, posts: publicPosts });
  } catch {
    return errorResponse("Unable to load promotion sources", 500);
  }
}
