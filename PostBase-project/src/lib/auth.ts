import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { isRestrictedAccount } from "@/lib/account-restrictions";

export async function getSession() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || await isRestrictedAccount(user.id)) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id === user.id ? session : null;
}

export async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user && !(await isRestrictedAccount(user.id)) ? user : null;
}

export async function requireAuth(_request?: Request) {
  const user = await getUser();

  if (!user) {
    return {
      user: null,
      error: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  return { user, error: null };
}

export async function signUp(email: string, password: string, metadata?: { username?: string }) {
  const supabase = await createClient();
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
    },
  });
}

export async function signIn(email: string, password: string) {
  const supabase = await createClient();
  return supabase.auth.signInWithPassword({
    email,
    password,
  });
}

export async function signOut() {
  const supabase = await createClient();
  return supabase.auth.signOut();
}

export async function signInWithOAuth(provider: "google" | "facebook") {
  const supabase = await createClient();
  return supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`,
    },
  });
}

/**
 * Compatibility facade for API routes that use the former auth API shape.
 * The application now authenticates through Supabase, so sessions are read
 * from the request cookies by the server client above.
 */
export const auth = {
  api: {
    getSession: async ({ headers: _headers }: { headers: Headers }) => getSession(),
  },
  handler: async (_request: Request) =>
    NextResponse.json({ error: "Authentication is handled by Supabase" }, { status: 404 }),
};

export type Session = Awaited<ReturnType<typeof getSession>>;
export type User = Awaited<ReturnType<typeof getUser>>;
