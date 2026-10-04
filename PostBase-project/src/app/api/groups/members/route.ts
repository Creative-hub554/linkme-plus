import { db } from "@/lib/db";
import { groupMembers, groups } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, and, count } from "drizzle-orm";

/**
 * Who is in a group is the group's own membership list, so reading it is scoped
 * to a group admin: a group has no company or Page to defer to, and its admin
 * is the `role` on its own `group_members` row — the same edge the admin-leave
 * rule in `POST` already reads. A group that is not there is a `404` on the
 * read; a signed-in member who is not its admin is refused with `403` *before*
 * the member rows are read.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId");

  if (!groupId) {
    return errorResponse("Group ID is required");
  }

  try {
    const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
    if (!group) return errorResponse("Group not found", 404);

    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, session.user.id))
      );

    if (membership?.role !== "admin") {
      return errorResponse("Only a group admin can view members", 403);
    }

    const members = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));

    return successResponse({ members });
  } catch (err) {
    console.error("List group members error:", err);
    return errorResponse("Failed to fetch members", 500);
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { groupId } = body;

    if (!groupId) {
      return errorResponse("Group ID is required");
    }

    const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
    if (!group) return errorResponse("Group not found", 404);

    // Check if already member
    const [existing] = await db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, session.user.id))
      );

    if (existing) {
      if (existing.role === "admin") {
        const [{ admins }] = await db
          .select({ admins: count() })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "admin")));
        if (Number(admins) <= 1) return errorResponse("Add another admin before leaving this community", 409);
      }
      await db.delete(groupMembers).where(eq(groupMembers.id, existing.id));
      return successResponse({ member: false });
    }

    // Join group
    await db.insert(groupMembers).values({
      groupId,
      userId: session.user.id,
      role: "member",
    });

    return successResponse({ member: true }, 201);
  } catch (err) {
    console.error("Toggle membership error:", err);
    return errorResponse("Failed to toggle membership", 500);
  }
}
