import { db } from "@/lib/db";
import { auditLogs, users, userRoleEnum } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse, paginatedResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { and, count, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";

/**
 * The two moves an administrator may make from the dashboard, and the states
 * each may move out of. The ladder is deliberately short: `member` and
 * `moderator`. The `admin` role appears in neither, and that is the whole
 * point — the set of admins is whatever the owner has elevated with the
 * `admin:grant` console, and granting admin stays the one privilege with no
 * in-app donor. A dirty moderator can do no more than this route allows them
 * to undo each other, and even that takes an admin's own session.
 */
const MODERATOR_ACTIONS = {
  promote: { from: "member", to: "moderator" },
  demote: { from: "moderator", to: "member" },
} as const;
type ModeratorAction = keyof typeof MODERATOR_ACTIONS;

function isModeratorAction(action: string): action is ModeratorAction {
  return action === "promote" || action === "demote";
}

/**
 * The members the dashboard manages, searchable and filtered.
 *
 * Emails are in the payload behind an admin-only gate — the moderation surface
 * needs them, and the gate is exactly the stats route's gate. The list skips
 * no one by role (the filter tells it who to show) but does skip deleted
 * accounts, which are gone rather than manageable.
 */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const requestedRole = url.searchParams.get("role") || "all";
  const role: (typeof userRoleEnum.enumValues)[number] | "all" =
    userRoleEnum.enumValues.find((value) => value === requestedRole) ?? "all";
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
  // A bounded page: the list route's contract everywhere else is a limit the
  // client "chooses" from a query param, so 100 is the widest page this hands out.
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20") || 20));
  const offset = (page - 1) * limit;

  // `all` means "do not filter by role"; a garbage `role` param narrowed to
  // nothing above, and here it collapses to the unfiltered answer rather than
  // an empty one — the same reading the reports route gives its status. A
  // nullable column's predicate is `isNull`, not a boolean comparison.
  const conditions: (SQL | undefined)[] = [
    role === "all" ? undefined : eq(users.role, role),
    query !== "" ? or(ilike(users.username, `%${query}%`), ilike(users.email, `%${query}%`)) : undefined,
    isNull(users.deletedAt),
  ];
  const combined = conditions.filter((value): value is SQL => value !== undefined);
  const where = combined.length > 0 ? and(...combined) : undefined;

  try {
    // The gate before the list: only a strict `admin` may read the membership,
    // which is the same read the stats route takes — inside the `try`, so a
    // database error on the lookup is the 500 below rather than an answer.
    const [admin] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id));
    if (!admin || admin.role !== "admin") {
      return errorResponse("Unauthorized", 403);
    }

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(users).where(where);

    return paginatedResponse(rows, total, page, limit);
  } catch (listError) {
    console.error("List members error:", listError);
    return errorResponse("Unable to list members", 500);
  }
}

/**
 * Promote a member to moderator, or demote a moderator back to member.
 *
 * Two things sit before any write, and each for a reason stated in code: the
 * caller must hold the `admin` role — not moderator, because promoting people
 * is a platform decision — and the move must be one the ladder allows. An
 * `admin` target is refused outright (403), whether promoted from or demoted
 * to: an admin is the owner console's to make, and a route that could demote
 * one would let a stolen admin session erase the role's last holder. The
 * decision is audited beside the write, as every other dashboard decision is.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("A member and an action are required", 400);
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId || !isUuid(userId)) {
    return errorResponse("The member to move is required", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!isModeratorAction(action)) {
    return errorResponse("An action of promote or demote is required", 400);
  }

  try {
    const [admin] = await db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id));
    if (!admin || admin.role !== "admin") {
      return errorResponse("Unauthorized", 403);
    }

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));

    if (!target) return errorResponse("Member not found", 404);

    // The one role this route cannot name, named first so the refusal is the
    // same whoever presses it: the owner's console owns the admin role.
    if (target.role === "admin") {
      return errorResponse("Admin roles are granted and revoked by the owner, not from the dashboard", 403);
    }

    const step = MODERATOR_ACTIONS[action];
    if (target.role !== step.from) {
      return errorResponse(`A member who is ${target.role} has no ${action} to make`, 409);
    }

    const updated = await db.transaction(async (tx) => {
      const [moved] = await tx
        .update(users)
        .set({ role: step.to })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ id: users.id, role: users.role });
      if (!moved) return null;

      await tx.insert(auditLogs).values({
        actorId: session.user.id,
        action: `moderator.${action}`,
        targetType: "user",
        targetId: userId,
        metadata: { from: step.from, to: step.to },
      });
      return moved;
    });
    if (!updated) return errorResponse("Member not found", 404);

    return successResponse({ user: updated });
  } catch (moderationError) {
    console.error("Moderator role change error:", moderationError);
    return errorResponse("Unable to record this role change", 500);
  }
}
