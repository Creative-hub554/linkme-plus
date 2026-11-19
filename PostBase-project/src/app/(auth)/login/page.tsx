"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { signIn } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginLiveVisual } from "@/components/auth/login-live-visual";
import { AuthenticatorChallenge } from "@/components/auth/authenticator-challenge";
import { createClient } from "@/utils/supabase/client";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { AuthTransitionOverlay } from "@/components/auth/auth-transition-overlay";

import { GoogleIcon } from "@/components/auth/google-icon";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  const goToProfile = () => {
    setIsTransitioning(true);
    window.setTimeout(() => {
      router.push("/profile");
      router.refresh();
    }, 850);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const { error: signInError } = await signIn.email(email, password);
      if (signInError) setError(signInError.message || "Invalid email or password");
      else {
        const supabase = createClient();
        const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const factor = factors?.totp?.find((item) => item.status === "verified");
          if (factor) { setMfaFactorId(factor.id); setLoading(false); return; }
        }
        goToProfile();
      }
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const handleOAuth = async (provider: "google") => {
    setError(""); setLoading(true);
    try {
      const { error: oauthError } = await signIn.social(provider);
      if (oauthError) { setError(oauthError.message || "OAuth sign in failed"); setLoading(false); }
    } catch { setError("Something went wrong. Please try again."); setLoading(false); }
  };

  return <AuthShell mode="login"><>{isTransitioning && <AuthTransitionOverlay mode="login" />}<div className="mx-auto w-full max-w-md"><div className="page-enter motion-delay-100 mb-6"><LoginLiveVisual /></div><div className="page-enter motion-delay-200 mb-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-purple">Welcome back</p><h2 className="mt-3 text-3xl font-bold tracking-tight text-navy-800">Sign in to your world.</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Pick up where you left off and keep moving forward.</p></div>{mfaFactorId ? <AuthenticatorChallenge factorId={mfaFactorId} onVerified={goToProfile} onBack={() => setMfaFactorId(null)} /> : <div className="page-enter motion-delay-300 rounded-2xl border border-surface-border bg-card p-5 shadow-xl shadow-navy-900/5 sm:p-7"><div className="grid gap-3"><Button variant="outline" className="pressable h-11 rounded-xl" onClick={() => handleOAuth("google")} type="button" disabled={loading}><GoogleIcon /><span className="ml-2">Google</span></Button></div><div className="relative my-6"><div className="absolute inset-0 flex items-center"><Separator /></div><div className="relative flex justify-center"><span className="bg-card px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Or continue with email</span></div></div><form onSubmit={handleSubmit} className="space-y-4">{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="space-y-2"><Label htmlFor="email" className="text-navy-700">Email address</Label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 rounded-xl pl-10" /></div></div><div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password" className="text-navy-700">Password</Label><Link href="/forgot-password" className="text-xs font-semibold text-brand-blue hover:underline">Forgot password?</Link></div><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="password" type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 rounded-xl pl-10" /></div></div><Button type="submit" className="pressable shimmer-on-hover h-11 w-full rounded-xl shadow-lg shadow-brand-blue/20" disabled={loading}>{loading ? "Signing in..." : "Sign in"}<ArrowRight className="ml-2 h-4 w-4" /></Button></form><p className="mt-6 text-center text-sm text-muted-foreground">New to LinkMe+? <Link href="/register" className="font-semibold text-brand-blue hover:underline">Create a free account</Link></p></div>}<p className="mt-5 text-center text-xs leading-5 text-muted-foreground">By continuing, you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p></div></></AuthShell>;
}

