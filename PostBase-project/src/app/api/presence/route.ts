import { db } from "@/lib/db";
import { users, profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { eq, desc } from "drizzle-orm";
import { isOnline, touchPresence } from "@/lib/presence";

/** One member as the roster answers them: who they are, and whether they are here. */
interface RosterMember {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  online: boolean;
}

/**
 * The roster both handlers answer with: every member with their profile, each
 * flagged from the heartbeat registry and sorted online-first.
 *
 * There is deliberately no `limit` here. A blind cap would be applied *before*
 * the online flags exist, so with more members than the cap a live member
 * could be cut out of the roster the client is about to render — the failure
 * this listing exists to avoid. The client takes the slice it can show; if the
 * member list ever outgrows one answer, the fix is filtering online members
 * in the query, not a number picked in advance.
 */
async function roster(): Promise<RosterMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(users.id, profiles.userId))
    .orderBy(desc(users.createdAt));

  const now = Date.now();
  // Online first so the client's slice cannot cut a live member off the end;
  // among the rest, by name, so the grey members hold a stable order between
  // answers instead of reshuffling on every beat.
  return rows
    .map((row) => ({ ...row, online: isOnline(row.userId, now) }))
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) ||
        (a.displayName ?? "").localeCompare(b.displayName ?? ""),
    );
}

/**
 * Reads who is here without counting the caller in — the plain question, for
 * anything that wants the roster without side effects.
 */
export async function GET(request: Request) {
  // Only the session's *existence* matters here: a plain read counts nobody
  // in, so the caller's id is deliberately not taken out of the result.
  const { error } = await requireAuth(request);
  if (error) return error;

  try {
    return successResponse({ users: await roster() });
  } catch (err) {
    console.error("Presence roster error:", err);
    return errorResponse("Failed to load who is online", 500);
  }
}

/**
 * The heartbeat: counts the caller in and answers with the roster in one
 * round trip. The client asks "am I counted?" and "who is here?" together
 * every 30 seconds, so two requests would double the traffic this endpoint
 * exists to keep small.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  touchPresence(session.user.id);

  try {
    return successResponse({ users: await roster() });
  } catch (err) {
    console.error("Presence heartbeat error:", err);
    return errorResponse("Failed to load who is online", 500);
  }
}
