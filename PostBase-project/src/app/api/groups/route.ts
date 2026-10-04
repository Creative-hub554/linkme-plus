import { db } from "@/lib/db";
import { categories, groups, groupMembers } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { eq, and, or, exists, count, desc } from "drizzle-orm";
import { isUuid } from "@/lib/cursor-pagination";

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const groupId = url.searchParams.get("id");
  // Bound into a `uuid` column below, so a value that is not one is a 400 rather
  // than a cast failure the catch reports as a 500.
  if (groupId && !isUuid(groupId)) return errorResponse("Invalid group ID", 400);
  const requestedPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const offset = (page - 1) * limit;

  try {
    if (groupId) {
      // The category's human name rides along through a left join — the same
      // shape the Pages and marketplace routes read — because a group only
      // stores its category's id, and a badge rendered from this row wants a
      // word, not a database key. `left` so an uncategorised group still opens.
      const [group] = await db
        .select({
          id: groups.id,
          name: groups.name,
          description: groups.description,
          categoryId: groups.categoryId,
          categoryName: categories.name,
          coverUrl: groups.coverUrl,
          visibility: groups.visibility,
          createdAt: groups.createdAt,
        })
        .from(groups)
        .leftJoin(categories, eq(groups.categoryId, categories.id))
        .where(eq(groups.id, groupId));

      if (!group) {
        return errorResponse("Group not found", 404);
      }

      // Get member count
      const [{ members }] = await db
        .select({ members: count() })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, groupId));

      // Check if current user is member
      const [isMember] = await db
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, session.user.id))
        );

      if (group.visibility !== "public" && !isMember) {
        return errorResponse("You must be a member to view this group", 403);
      }

      return successResponse({
        group,
        stats: { members },
        isMember: !!isMember,
        memberRole: isMember?.role || null,
      });
    }

    // Only public groups or groups the current user already belongs to are discoverable.
    const visibleGroups = or(
      eq(groups.visibility, "public"),
      exists(
        db.select({ id: groupMembers.id })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, session.user.id)))
      )
    );

    const result = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        categoryId: groups.categoryId,
        categoryName: categories.name,
        coverUrl: groups.coverUrl,
        visibility: groups.visibility,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .leftJoin(categories, eq(groups.categoryId, categories.id))
      .where(visibleGroups)
      .orderBy(desc(groups.createdAt))
      .limit(limit)
      .offset(offset);

    const memberCounts = await db
      .select({ groupId: groupMembers.groupId, members: count() })
      .from(groupMembers)
      .groupBy(groupMembers.groupId);
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, session.user.id));
    const countByGroup = new Map(memberCounts.map((item) => [item.groupId, Number(item.members)]));
    const memberGroupIds = new Set(memberships.map((item) => item.groupId));
    const enriched = result.map((group) => ({
      ...group,
      memberCount: countByGroup.get(group.id) ?? 0,
      isMember: memberGroupIds.has(group.id),
    }));

    const [{ total }] = await db.select({ total: count() }).from(groups).where(visibleGroups);

    return paginatedResponse(enriched, total, page, limit);
  } catch (err) {
    console.error("Get groups error:", err);
    return errorResponse("Failed to fetch groups", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const { categoryId, coverUrl, visibility = "public" } = body;

    if (!name) return errorResponse("Name is required");
    if (name.length > 100) return errorResponse("Name must be 100 characters or fewer");
    if (description && description.length > 500) return errorResponse("Description must be 500 characters or fewer");
    if (visibility !== "public" && visibility !== "followers" && visibility !== "private") {
      return errorResponse("Invalid group visibility");
    }
    if (categoryId !== undefined && categoryId !== null && (typeof categoryId !== "string" || !isUuid(categoryId))) {
      return errorResponse("Invalid category id", 400);
    }

    const [newGroup] = await db
      .insert(groups)
      .values({
        name,
        description,
        categoryId,
        coverUrl,
        visibility,
      })
      .returning();

    // Add creator as admin
    await db.insert(groupMembers).values({
      groupId: newGroup.id,
      userId: session.user.id,
      role: "admin",
    });

    return successResponse({ group: newGroup }, 201);
  } catch (err) {
    console.error("Create group error:", err);
    return errorResponse("Failed to create group", 500);
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { id, name, description, categoryId, coverUrl, visibility } = body;

    if (!id) {
      return errorResponse("Group ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid group ID", 400);
    }

    // Check admin role
    const [role] = await db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, id), eq(groupMembers.userId, session.user.id), eq(groupMembers.role, "admin"))
      );

    if (!role) {
      return errorResponse("Unauthorized", 403);
    }

    // The same shape check the create path makes on this column.
    if (categoryId !== undefined && categoryId !== null && (typeof categoryId !== "string" || !isUuid(categoryId))) {
      return errorResponse("Invalid category id", 400);
    }

    const [updated] = await db
      .update(groups)
      .set({
        name: name ?? undefined,
        description: description ?? undefined,
        categoryId: categoryId ?? undefined,
        coverUrl: coverUrl ?? undefined,
        visibility: visibility ?? undefined,
      })
      .where(eq(groups.id, id))
      .returning();

    return successResponse({ group: updated });
  } catch (err) {
    console.error("Update group error:", err);
    return errorResponse("Failed to update group", 500);
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return errorResponse("Group ID is required");
    }
    if (!isUuid(id)) {
      return errorResponse("Invalid group ID", 400);
    }

    // Check admin role
    const [role] = await db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, id), eq(groupMembers.userId, session.user.id), eq(groupMembers.role, "admin"))
      );

    if (!role) {
      return errorResponse("Unauthorized", 403);
    }

    await db.delete(groups).where(eq(groups.id, id));

    return successResponse({ success: true });
  } catch (err) {
    console.error("Delete group error:", err);
    return errorResponse("Failed to delete group", 500);
  }
}
