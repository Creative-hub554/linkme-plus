"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSession, type AuthUser } from "@/lib/auth-client";
import type { Session } from "@supabase/supabase-js";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  session: Session | null;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  session: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { session, loading, user } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <AuthContext.Provider
        value={{ isAuthenticated: false, isLoading: true, user: null, session: null }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!session,
        isLoading: loading,
        user,
        session,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
