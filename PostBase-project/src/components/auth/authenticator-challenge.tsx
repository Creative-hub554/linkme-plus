"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export function AuthenticatorChallenge({ factorId, onVerified, onBack }: { factorId: string; onVerified: () => void; onBack: () => void }) {
  // Memoised so the effect below keys on `factorId`, not on a client that
  // `createClient()` would otherwise rebuild on every render.
  const supabase = useMemo(() => createClient(), []);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.mfa.challenge({ factorId }).then(({ data, error: challengeError }) => {
      if (!active) return;
      if (challengeError) setError(challengeError.message);
      else setChallengeId(data.id);
      setLoading(false);
    });
    return () => { active = false; };
  }, [factorId, supabase]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    setError(""); setLoading(true);
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId, code: code.replace(/\s/g, "") });
    if (verifyError) { setError("That code is not valid or has expired. Try the latest code from your authenticator."); setLoading(false); return; }
    onVerified();
  };

  return (
    <div className="rounded-2xl border border-brand-blue/15 bg-card p-5 shadow-xl shadow-navy-900/5 sm:p-7">
      <div className="mb-6 flex items-center gap-3"><div className="rounded-xl bg-brand-blue/10 p-2 text-brand-blue"><ShieldCheck className="h-5 w-5" /></div><div><h3 className="font-semibold text-navy-800">Verify it’s you</h3><p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p></div></div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <form onSubmit={verify} className="space-y-4"><div className="space-y-2"><Label htmlFor="login-authenticator-code">Authenticator code</Label><Input id="login-authenticator-code" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} placeholder="000000" required /></div><Button className="h-11 w-full rounded-xl" type="submit" disabled={loading || !challengeId || code.replace(/\s/g, "").length < 6}>{loading ? "Checking..." : "Verify and continue"}</Button></form>
      <Button type="button" variant="ghost" className="mt-3 w-full" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back to sign in</Button>
    </div>
  );
}
