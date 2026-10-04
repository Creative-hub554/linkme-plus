import { db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type AuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function normalizeUsername(user: AuthUser) {
  const metadata = user.user_metadata ?? {};
  const candidate = metadata.username || metadata.user_name || user.email?.split("@")[0] || "member";
  const normalized = String(candidate).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
  return normalized.length >= 3 ? normalized : "member";
}

function displayNameFor(user: AuthUser) {
  const metadata = user.user_metadata ?? {};
  return String(metadata.full_name || metadata.name || user.email?.split("@")[0] || "Member").slice(0, 50) || "Member";
}

/**
 * Email sign-ups can reach the application before the OAuth callback has
 * provisioned the local records. Repair those records before profile writes.
 */
export async function ensureLocalUserProfile(user: AuthUser) {
  let [localUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, user.id));

  if (!localUser) {
    const rootUsername = normalizeUsername(user);
    for (let attempt = 0; attempt < 12 && !localUser; attempt += 1) {
      const suffix = attempt === 0 ? "" : `_${Math.random().toString(36).slice(2, 7)}`;
      const username = `${rootUsername.slice(0, 30 - suffix.length)}${suffix}`;
      try {
        await db.insert(users).values({
          id: user.id,
          email: user.email || `${username}@local.invalid`,
          username,
          emailVerified: user.email_confirmed_at ? new Date(user.email_confirmed_at) : new Date(),
        }).onConflictDoNothing({ target: users.id });
      } catch (error) {
        // A username collision is safe to retry with a new suffix. Other
        // database errors must surface instead of being mistaken for a race.
        if (!(error instanceof Error) || !/unique|duplicate/i.test(error.message)) throw error;
      }
      [localUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, user.id));
    }

    if (!localUser) throw new Error("Unable to provision the local user record");
  }

  const [localProfile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, user.id));
  if (!localProfile) {
    await db.insert(profiles).values({
      userId: user.id,
      displayName: displayNameFor(user),
      avatarUrl: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
    }).onConflictDoNothing({ target: profiles.userId });
  }
}
