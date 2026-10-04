import { db, withDbRetry } from "@/lib/db";
import { ensureLocalUserProfile } from "@/lib/db/ensure-profile";
import { users, profiles, follows, visibilityEnum } from "@/lib/db/schema";
import { requireAuth, successResponse, errorResponse } from "@/lib/api-helpers";
import { createClient } from "@/utils/supabase/server";
import { eq, and, sql, count, ne } from "drizzle-orm";

type Visibility = (typeof visibilityEnum.enumValues)[number];

/**
 * The `PUT /api/users` payload. Fields the handler coerces are left `unknown`
 * and narrowed at use with `String(...)`/`Array.isArray(...)`; the ones written
 * straight into a column carry that column's type so the `.set()` below stays
 * honest. `request.json()` returns `any`, so this describes the contract rather
 * than validating it — the same trust the handler had before.
 */
interface ProfileUpdateBody {
  displayName?: unknown;
  username?: unknown;
  bio?: unknown;
  location?: unknown;
  skills?: unknown;
  visibility?: Visibility;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  coverVideoUrl?: string | null;
  coverConfig?: unknown;
  work?: unknown;
  education?: unknown;
  website?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  currentContactPreferences?: unknown;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  const url = new URL(request.url);
  const userId = url.searchParams.get("id");
  const username = url.searchParams.get("username");

  try {
    await withTimeout(withDbRetry(() => ensureLocalUserProfile(session.user)), 8000);
    const query = db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        coverUrl: profiles.coverUrl,
        coverVideoUrl: profiles.coverVideoUrl,
        coverConfig: profiles.coverConfig,
        shortVideoCoverConfig: profiles.shortVideoCoverConfig,
        bio: profiles.bio,
        location: profiles.location,
        work: profiles.work,
        education: profiles.education,
        website: profiles.website,
        skills: profiles.skills,
        contactEmail: sql<string | null>`${profiles.contactPreferences} ->> 'contactEmail'`,
        contactPhone: sql<string | null>`${profiles.contactPreferences} ->> 'contactPhone'`,
        visibility: profiles.visibility,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(
        userId
          ? eq(users.id, userId)
          : username
          ? eq(users.username, username)
          : sql`1 = 0`
      );

    const [user] = await query;

    if (!user) {
      return errorResponse("User not found", 404);
    }

    // Get follower/following counts
    const [{ followers }] = await db
      .select({ followers: count() })
      .from(follows)
      .where(eq(follows.followingId, user.id));

    const [{ following }] = await db
      .select({ following: count() })
      .from(follows)
      .where(eq(follows.followerId, user.id));

    // Check if current user follows this user
    const [isFollowing] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerId, session.user.id),
          eq(follows.followingId, user.id)
        )
      );

    return successResponse({
      user,
      stats: {
        followers,
        following,
      },
      isFollowing: !!isFollowing,
    });
  } catch (err) {
    console.error("Get user error:", err);

    // Render the authenticated user's settings/profile from Auth metadata while
    // the local Postgres pooler is unavailable. This prevents a database
    // outage from turning the whole page into a timeout.
    const metadata = session.user.user_metadata ?? {};
    const fallbackUsername = String(
      metadata.username || metadata.user_name || session.user.email?.split("@")[0] || "member"
    ).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30) || "member";
    return successResponse({
      user: {
        id: session.user.id,
        username: fallbackUsername,
        role: "member",
        createdAt: session.user.created_at ?? null,
        displayName: String(metadata.display_name || metadata.full_name || metadata.name || session.user.email?.split("@")[0] || "Member"),
        avatarUrl: String(metadata.avatar_url || metadata.picture || "") || null,
        coverUrl: String(metadata.cover_url || "") || null,
        coverVideoUrl: String(metadata.cover_video_url || "") || null,
        coverConfig: null,
        shortVideoCoverConfig: null,
        bio: typeof metadata.bio === "string" ? metadata.bio : null,
        location: typeof metadata.location === "string" ? metadata.location : null,
        work: typeof metadata.work === "string" ? metadata.work : null,
        education: typeof metadata.education === "string" ? metadata.education : null,
        website: typeof metadata.website === "string" ? metadata.website : null,
        skills: Array.isArray(metadata.skills) ? metadata.skills : [],
        contactEmail: typeof metadata.contact_email === "string" ? metadata.contact_email : null,
        contactPhone: typeof metadata.contact_phone === "string" ? metadata.contact_phone : null,
        visibility: metadata.visibility || "public",
      },
      stats: { followers: 0, following: 0 },
      isFollowing: false,
      persistence: "auth-metadata",
    });
  }
}

export async function PUT(request: Request) {
  const { session, error } = await requireAuth(request);
  if (error) return error;

  let body: ProfileUpdateBody = {};
  try {
    body = await request.json();
    await withTimeout(withDbRetry(() => ensureLocalUserProfile(session.user)), 8000);
    const { displayName, username, bio, location, skills, visibility, avatarUrl, coverUrl, coverVideoUrl, coverConfig, work, education, website, contactEmail, contactPhone } = body;

    if (username !== undefined) {
      const normalizedUsername = String(username).trim().toLowerCase();
      if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
        return errorResponse("Username must be 3–30 characters using only letters, numbers, or underscores", 400);
      }
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, normalizedUsername), ne(users.id, session.user.id)));
      if (existingUser) return errorResponse("That username is already taken", 409);
      await db.update(users).set({ username: normalizedUsername }).where(eq(users.id, session.user.id));
    }

    const profileUpdate = {
      ...(displayName !== undefined ? { displayName: String(displayName).trim() } : {}),
      ...(bio !== undefined ? { bio: bio === null ? null : String(bio).trim() } : {}),
      ...(location !== undefined ? { location: location === null ? null : String(location).trim() } : {}),
      ...(work !== undefined ? { work: work === null ? null : String(work).trim().slice(0, 120) } : {}),
      ...(education !== undefined ? { education: education === null ? null : String(education).trim().slice(0, 120) } : {}),
      ...(website !== undefined ? { website: website === null ? null : String(website).trim() } : {}),
      ...((contactEmail !== undefined || contactPhone !== undefined)
        ? {
            contactPreferences: {
              ...(typeof body.currentContactPreferences === "object" && body.currentContactPreferences !== null ? body.currentContactPreferences : {}),
              ...(contactEmail !== undefined ? { contactEmail: contactEmail === null ? null : String(contactEmail).trim() } : {}),
              ...(contactPhone !== undefined ? { contactPhone: contactPhone === null ? null : String(contactPhone).trim() } : {}),
            },
          }
        : {}),
      ...(skills !== undefined ? { skills: Array.isArray(skills) ? skills.map(String).slice(0, 12) : [] } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(coverUrl !== undefined ? { coverUrl } : {}),
      ...(coverVideoUrl !== undefined ? { coverVideoUrl } : {}),
      ...(coverConfig !== undefined ? { coverConfig } : {}),
    };

    const [updated] = await db
      .update(profiles)
      .set(profileUpdate)
      .where(eq(profiles.userId, session.user.id))
      .returning();

    return successResponse({ profile: updated });
  } catch (err) {
    console.error("Update profile error:", err);

    // Keep profile editing usable while the local Postgres pooler is down.
    // Auth metadata is immediately available to the client and can be copied
    // into the local profile when the database connection recovers.
    try {
      const supabase = await createClient();
      const metadata = {
        ...(typeof body.displayName === "string" ? { display_name: body.displayName.trim() } : {}),
        ...(typeof body.username === "string" ? { username: body.username.trim().toLowerCase() } : {}),
        ...(typeof body.bio === "string" || body.bio === null ? { bio: body.bio } : {}),
        ...(typeof body.location === "string" || body.location === null ? { location: body.location } : {}),
        ...(typeof body.work === "string" || body.work === null ? { work: body.work } : {}),
        ...(typeof body.education === "string" || body.education === null ? { education: body.education } : {}),
        ...(typeof body.website === "string" || body.website === null ? { website: body.website } : {}),
        ...(typeof body.contactEmail === "string" || body.contactEmail === null ? { contact_email: body.contactEmail } : {}),
        ...(typeof body.contactPhone === "string" || body.contactPhone === null ? { contact_phone: body.contactPhone } : {}),
        ...(Array.isArray(body.skills) ? { skills: body.skills.map(String).slice(0, 12) } : {}),
        ...(typeof body.visibility === "string" ? { visibility: body.visibility } : {}),
      };
      const { error: metadataError } = await supabase.auth.updateUser({ data: metadata });
      if (!metadataError) {
        return successResponse({ profile: metadata, persistence: "auth-metadata" });
      }
    } catch (metadataError) {
      console.error("Auth metadata profile fallback failed:", metadataError);
    }

    return errorResponse("Profile database is temporarily unavailable. Please try again shortly.", 503);
  }
}
