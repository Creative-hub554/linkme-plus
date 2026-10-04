"use client";

import { LogIn, LogOut, Sparkles } from "lucide-react";

interface AuthTransitionOverlayProps {
  mode: "login" | "logout";
}

export function AuthTransitionOverlay({ mode }: AuthTransitionOverlayProps) {
  const isLogout = mode === "logout";

  return (
    <div
      className="auth-transition-overlay fixed inset-0 z-[100] flex items-center justify-center bg-[#071426]/90 p-6 text-white backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-label={isLogout ? "Signing out" : "Signing in"}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-6 text-center shadow-2xl">
        <div className="auth-transition-glow pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-purple/40 blur-3xl" />
        <div className="auth-transition-glow auth-transition-glow-delay pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-brand-blue/40 blur-3xl" />
        <div className="relative mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full border border-white/20 bg-white/10">
          <span className="auth-transition-ring absolute inset-2 rounded-full border border-brand-blue-light/70" />
          <span className="auth-transition-ring auth-transition-ring-delay absolute inset-5 rounded-full border border-brand-purple-light/70" />
          {isLogout ? <LogOut className="relative h-7 w-7 text-blue-200" /> : <LogIn className="relative h-7 w-7 text-blue-200" />}
        </div>
        <div className="relative flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">
          <Sparkles className="h-3.5 w-3.5 text-purple-300" />
          LinkMe+
        </div>
        <p className="relative mt-3 text-xl font-semibold">{isLogout ? "See you soon." : "Welcome back."}</p>
        <p className="relative mt-2 text-sm text-white/65">{isLogout ? "Securing your session and closing the door." : "Preparing your space and reconnecting your world."}</p>
        <div className="relative mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-white/15">
          <span className="auth-transition-progress block h-full w-1/2 rounded-full bg-gradient-to-r from-brand-blue-light to-brand-purple-light" />
        </div>
      </div>
    </div>
  );
}
