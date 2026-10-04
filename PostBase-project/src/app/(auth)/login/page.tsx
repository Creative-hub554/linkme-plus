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
import { ArrowRight, Facebook, LockKeyhole, Mail } from "lucide-react";
import { AuthTransitionOverlay } from "@/components/auth/auth-transition-overlay";

const GoogleIcon = () => <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  const goToDiscover = () => {
    setIsTransitioning(true);
    window.setTimeout(() => {
      router.push("/feed");
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
        goToDiscover();
      }
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const handleOAuth = async (provider: "google" | "facebook") => {
    setError(""); setLoading(true);
    try {
      const { error: oauthError } = await signIn.social(provider);
      if (oauthError) { setError(oauthError.message || "OAuth sign in failed"); setLoading(false); }
    } catch { setError("Something went wrong. Please try again."); setLoading(false); }
  };

  return <AuthShell mode="login"><>{isTransitioning && <AuthTransitionOverlay mode="login" />}<div className="mx-auto w-full max-w-md"><div className="page-enter motion-delay-100 mb-6"><LoginLiveVisual /></div><div className="page-enter motion-delay-200 mb-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-purple">Welcome back</p><h2 className="mt-3 text-3xl font-bold tracking-tight text-navy-800">Sign in to your world.</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Pick up where you left off and keep moving forward.</p></div>{mfaFactorId ? <AuthenticatorChallenge factorId={mfaFactorId} onVerified={goToDiscover} onBack={() => setMfaFactorId(null)} /> : <div className="page-enter motion-delay-300 rounded-2xl border border-surface-border bg-card p-5 shadow-xl shadow-navy-900/5 sm:p-7"><div className="grid gap-3 sm:grid-cols-2"><Button variant="outline" className="pressable h-11 rounded-xl" onClick={() => handleOAuth("google")} type="button" disabled={loading}><GoogleIcon /><span className="ml-2">Google</span></Button><Button variant="outline" className="pressable h-11 rounded-xl" onClick={() => handleOAuth("facebook")} type="button" disabled={loading}><Facebook className="h-5 w-5 fill-[#1877F2] text-[#1877F2]" /><span className="ml-2">Facebook</span></Button></div><div className="relative my-6"><div className="absolute inset-0 flex items-center"><Separator /></div><div className="relative flex justify-center"><span className="bg-card px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Or continue with email</span></div></div><form onSubmit={handleSubmit} className="space-y-4">{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="space-y-2"><Label htmlFor="email" className="text-navy-700">Email address</Label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 rounded-xl pl-10" /></div></div><div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password" className="text-navy-700">Password</Label><button type="button" className="text-xs font-semibold text-brand-blue hover:underline">Forgot password?</button></div><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="password" type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 rounded-xl pl-10" /></div></div><Button type="submit" className="pressable shimmer-on-hover h-11 w-full rounded-xl shadow-lg shadow-brand-blue/20" disabled={loading}>{loading ? "Signing in..." : "Sign in"}<ArrowRight className="ml-2 h-4 w-4" /></Button></form><p className="mt-6 text-center text-sm text-muted-foreground">New to LinkMe+? <Link href="/register" className="font-semibold text-brand-blue hover:underline">Create a free account</Link></p></div>}<p className="mt-5 text-center text-xs leading-5 text-muted-foreground">By continuing, you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p></div></></AuthShell>;
}
