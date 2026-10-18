"use client";

import { LogIn, LogOut, Sparkles, UserPlus } from "lucide-react";

/** The three moments this overlay covers: signing in, signing up, signing out. */
export type AuthTransitionMode = "login" | "register" | "logout";

/**
 * What each mode says, in one place.
 *
 * The three fields are the whole of what differs between modes — which icon is
 * drawn, what the status region is named, and the two lines a viewer reads — so
 * the component below stays a single rendering rather than three branches that
 * have to be kept in step. The `icon` is picked over a ternary for the same
 * reason: an icon is a component, and a map of components is read as a map.
 */
const MODE_COPY: Record<
  AuthTransitionMode,
  { icon: typeof LogIn; status: string; headline: string; detail: string }
> = {
  login: {
    icon: LogIn,
    status: "Signing in",
    headline: "Welcome back.",
    detail: "Preparing your space and reconnecting your world.",
  },
  register: {
    icon: UserPlus,
    status: "Creating your account",
    headline: "You're on your way.",
    detail: "Setting up your profile and making room for what matters.",
  },
  logout: {
    icon: LogOut,
    status: "Signing out",
    headline: "See you soon.",
    detail: "Securing your session and closing the door.",
  },
};

interface AuthTransitionOverlayProps {
  mode: AuthTransitionMode;
}

/**
 * The full-screen panel that covers the moment between a credential being
 * accepted and the destination page being ready.
 *
 * It is a `status` live region rather than a dialog: nothing is to be acted on
 * here, and a screen reader should hear that the sign-in is in progress without
 * being moved to it or trapped by it. The label names the mode so the three
 * callers' announcements differ in the way their copy does.
 */
export function AuthTransitionOverlay({ mode }: AuthTransitionOverlayProps) {
  const copy = MODE_COPY[mode];
  const Icon = copy.icon;

  return (
    <div
      className="auth-transition-overlay fixed inset-0 z-[100] flex items-center justify-center bg-[#071426]/90 p-6 text-white backdrop-blur-md"
      role="status"
      aria-live="polite"
      aria-label={copy.status}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-6 text-center shadow-2xl">
        <div className="auth-transition-glow pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-purple/40 blur-3xl" />
        <div className="auth-transition-glow auth-transition-glow-delay pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-brand-blue/40 blur-3xl" />
        <div className="relative mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full border border-white/20 bg-white/10">
          <span className="auth-transition-ring absolute inset-2 rounded-full border border-brand-blue-light/70" />
          <span className="auth-transition-ring auth-transition-ring-delay absolute inset-5 rounded-full border border-brand-purple-light/70" />
          <Icon className="relative h-7 w-7 text-blue-200" />
        </div>
        <div className="relative flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">
          <Sparkles className="h-3.5 w-3.5 text-purple-300" />
          LinkMe+
        </div>
        <p className="relative mt-3 text-xl font-semibold">{copy.headline}</p>
        <p className="relative mt-2 text-sm text-white/65">{copy.detail}</p>
        <div className="relative mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-white/15">
          <span className="auth-transition-progress block h-full w-1/2 rounded-full bg-gradient-to-r from-brand-blue-light to-brand-purple-light" />
        </div>
      </div>
    </div>
  );
}
