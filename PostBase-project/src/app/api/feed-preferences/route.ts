import { db, withDbRetry } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { profiles } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { defaultFeedPreferences, parseFeedPreferences, feedTopics } from "@/lib/feed-topics";
import { eq, sql } from "drizzle-orm";
export async function GET(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  try {
    await withDbRetry(() => ensureLocalUserProfile(session.user));
    const [row] = await db.select({ appearance: profiles.appearance }).from(profiles).where(eq(profiles.userId, session.user.id));
    const feed = (row?.appearance as { feed?: unknown } | null)?.feed;
    return successResponse({ preferences: parseFeedPreferences(feed) ?? defaultFeedPreferences, topics: feedTopics });
  } catch { return errorResponse("Feed preferences are temporarily unavailable", 503); }
}
export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request); if (error) return error;
  let body: unknown; try { body = await request.json(); } catch { return errorResponse("Expected a JSON body", 400); }
  const preferences = parseFeedPreferences(body);
  if (!preferences) return errorResponse("Choose valid topics and a feed format", 400);
  try {
    await withDbRetry(() => ensureLocalUserProfile(session.user));
    await db.update(profiles).set({ appearance: sql`coalesce(${profiles.appearance}, '{}'::jsonb) || ${JSON.stringify({ feed: preferences })}::jsonb` }).where(eq(profiles.userId, session.user.id));
    return successResponse({ preferences });
  } catch { return errorResponse("Unable to save feed preferences", 503); }
}
