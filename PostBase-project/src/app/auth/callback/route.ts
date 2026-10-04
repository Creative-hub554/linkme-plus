import { createClient } from "@/utils/supabase/server";
import { db } from "@/lib/db";
import { profiles, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function baseUsername(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata ?? {};
  const candidate = metadata.username || metadata.user_name || user.email?.split("@")[0] || "member";
  const normalized = String(candidate).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
  return normalized.length >= 3 ? normalized : "member";
}

async function provisionUser(user: {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, user.id));
  const metadata = user.user_metadata ?? {};
  const displayName = String(
    metadata.full_name || metadata.name || user.email?.split("@")[0] || "Member"
  ).slice(0, 50);

  if (!existingUser) {
    const rootUsername = baseUsername(user);
    let username = rootUsername;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username));
      if (!taken) break;
      username = `${rootUsername.slice(0, 24)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    await db.insert(users).values({
      id: user.id,
      email: user.email || `${username}@oauth.local`,
      username,
      emailVerified: user.email_confirmed_at ? new Date(user.email_confirmed_at) : new Date(),
    });
  }

  const [existingProfile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, user.id));

  if (!existingProfile) {
    await db.insert(profiles).values({
      userId: user.id,
      displayName,
      avatarUrl: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
    });
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next") ?? "/feed";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/feed";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      try {
        await provisionUser(data.user);
        return NextResponse.redirect(`${origin}${next}`);
      } catch (provisionError) {
        console.error("OAuth user provisioning failed:", provisionError);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
