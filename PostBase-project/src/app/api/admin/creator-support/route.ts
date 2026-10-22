import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { isUuid } from "@/lib/cursor-pagination";
import { creatorSupportTickets, profiles, users } from "@/lib/db/schema";

async function isPlatformOwner(userId: string) {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return user?.role === "admin";
}

/** The owner-facing priority support queue; ticket messages never reach public profiles. */
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  try {
    if (!(await isPlatformOwner(session.user.id))) return errorResponse("Unauthorized", 403);
    const tickets = await db
      .select({ id: creatorSupportTickets.id, subject: creatorSupportTickets.subject, message: creatorSupportTickets.message, status: creatorSupportTickets.status, createdAt: creatorSupportTickets.createdAt, username: users.username, displayName: profiles.displayName })
      .from(creatorSupportTickets)
      .innerJoin(users, eq(creatorSupportTickets.creatorId, users.id))
      .leftJoin(profiles, eq(creatorSupportTickets.creatorId, profiles.userId))
      .where(and(eq(creatorSupportTickets.status, "open")))
      .orderBy(desc(creatorSupportTickets.createdAt));
    return successResponse({ tickets });
  } catch (supportError) {
    console.error("List creator support error:", supportError);
    return errorResponse("Unable to load priority support", 500);
  }
}

export async function PATCH(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;
  let body: { ticketId?: unknown; status?: unknown };
  try { body = await request.json(); } catch { return errorResponse("A ticket and status are required", 400); }
  const ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
  const status = body.status === "in_progress" || body.status === "resolved" ? body.status : null;
  if (!isUuid(ticketId) || !status) return errorResponse("A valid ticket and status are required", 400);
  try {
    if (!(await isPlatformOwner(session.user.id))) return errorResponse("Unauthorized", 403);
    const [ticket] = await db.update(creatorSupportTickets).set({ status, reviewedBy: session.user.id, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(creatorSupportTickets.id, ticketId), eq(creatorSupportTickets.status, "open"))).returning({ id: creatorSupportTickets.id, status: creatorSupportTickets.status });
    if (!ticket) return errorResponse("Open Creator support ticket not found", 404);
    return successResponse({ ticket });
  } catch (supportError) {
    console.error("Update creator support error:", supportError);
    return errorResponse("Unable to update priority support", 500);
  }
}
