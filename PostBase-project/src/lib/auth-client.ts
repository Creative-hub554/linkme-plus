"use client";

import { createClient } from "@/utils/supabase/client";
import { useState, useEffect } from "react";
import type { Session } from "@supabase/supabase-js";

/**
 * The account shape the app reads. Supabase's `User` supplies `id`, `email` and
 * `user_metadata`; the app also reads `name`, `username` and `image` directly,
 * so they are named here rather than hidden behind `any`.
 */
export type AuthUser = Session["user"] & {
  name?: string | null;
  username?: string | null;
  image?: string | null;
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading, user: (session?.user as AuthUser | undefined) ?? null };
}

export function useUser() {
  const { user, loading } = useSession();
  return { user, loading };
}

// Auth methods
export const signIn = {
  email: async (email: string, password: string) => {
    const supabase = createClient();
    return supabase.auth.signInWithPassword({ email, password });
  },
  social: async (provider: "google" | "facebook") => {
    const supabase = createClient();
    return supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  },
  phoneNumber: async (phone: string) => {
    const supabase = createClient();
    return supabase.auth.signInWithOtp({ phone });
  },
};

export const signUp = async (email: string, password: string, metadata?: Record<string, unknown>) => {
  const supabase = createClient();
  return supabase.auth.signUp({
    email,
    password,
    options: { data: metadata },
  });
};

export const signOut = async () => {
  const supabase = createClient();
  return supabase.auth.signOut();
};

// OAuth helpers
export const signInWithGoogle = () => signIn.social("google");
export const signInWithFacebook = () => signIn.social("facebook");
