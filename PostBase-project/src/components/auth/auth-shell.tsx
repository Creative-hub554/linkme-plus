"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Sparkles } from "lucide-react";

interface AuthShellProps {
  mode: "login" | "register";
  children: React.ReactNode;
  liveVisual?: React.ReactNode;
}

export function AuthShell({ mode, children, liveVisual }: AuthShellProps) {
  const isRegister = mode === "register";

  return (
    <div className="page-enter relative min-h-[calc(100vh-56px)] overflow-hidden bg-surface-light-blue">
      <div className="ambient-pulse pointer-events-none absolute -left-32 top-10 h-80 w-80 rounded-full bg-brand-purple/10 blur-3xl" />
      <div className="ambient-pulse motion-delay-200 pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-brand-blue/10 blur-3xl" />
      <div className="mx-auto grid min-h-[calc(100vh-56px)] max-w-7xl items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_460px] lg:gap-20 lg:px-8 lg:py-12">
        <section className="soft-float relative hidden overflow-hidden rounded-[2rem] bg-ink-800 p-10 text-white shadow-2xl shadow-navy-900/10 lg:flex lg:min-h-[650px] lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-purple/30 blur-2xl" />
          <div className="absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-brand-blue/30 blur-2xl" />
          <div className="relative">
            <Link href="/" className="inline-flex items-center gap-2 text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-black text-brand-blue">L+</span>
              <span className="text-xl font-bold tracking-tight">LinkMe<span className="text-brand-purple-light">+</span></span>
            </Link>
            <div className="mt-20 max-w-md">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-brand-purple-light" /> Built for meaningful connections
              </div>
              <h1 className="text-4xl font-bold leading-[1.08] tracking-tight xl:text-5xl">
                {isRegister ? "Your next chapter starts here." : "Good to see you again."}
              </h1>
              <p className="mt-5 text-base leading-7 text-navy-200">
                One polished home for your people, ideas, work, and opportunities.
              </p>
            </div>
            {liveVisual && <div className="relative mt-8">{liveVisual}</div>}
          </div>
          <div className="relative space-y-3">
            {["Connect with people who get it", "Discover work, groups, and ideas", "Create a profile that feels like you"].map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm text-ink-100">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-blue/80"><Check className="h-3 w-3" /></span>
                {item}
              </div>
            ))}
            <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-5 text-xs text-navy-300">
              <span>Trusted by a growing community</span>
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
        </section>

        <section className="w-full">
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-navy-800">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-blue text-sm font-black text-white">L+</span>
              LinkMe<span className="text-brand-purple">+</span>
            </Link>
            <Link href={isRegister ? "/login" : "/register"} className="text-sm font-semibold text-brand-blue">
              {isRegister ? "Sign in" : "Create account"}
            </Link>
          </div>
          <div className="mb-6 lg:hidden">{liveVisual}</div>
          {children}
        </section>
      </div>
    </div>
  );
}
