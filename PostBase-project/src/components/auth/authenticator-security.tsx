"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Smartphone, Trash2 } from "lucide-react";

type Factor = { id: string; friendly_name?: string | null; status: string; factor_type: string };

type Enrollment = { id: string; qr_code?: string; secret?: string; uri?: string };

export function AuthenticatorSecurity() {
  // Memoised so `loadFactor` (and the effect that runs it) is stable across
  // renders rather than depending on a client rebuilt every render.
  const supabase = useMemo(() => createClient(), []);
  const [factor, setFactor] = useState<Factor | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadFactor = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    const active = data?.totp?.find((item) => item.status === "verified") as Factor | undefined;
    setFactor(active ?? null);
    if (listError) setError(listError.message);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void loadFactor(); }, [loadFactor]);

  const startEnrollment = async () => {
    setError(""); setMessage(""); setBusy(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "LinkMe+ Authenticator",
    });
    if (enrollError) setError(enrollError.message);
    else if (data) setEnrollment({ id: data.id, ...data.totp });
    setBusy(false);
  };

  const verifyEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enrollment) return;
    setError(""); setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
    if (challengeError) { setError(challengeError.message); setBusy(false); return; }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.id,
      challengeId: challenge.id,
      code: code.replace(/\s/g, ""),
    });
    if (verifyError) setError("That code is not valid. Check your authenticator and try again.");
    else { setEnrollment(null); setCode(""); setMessage("Authenticator protection is enabled."); await loadFactor(); }
    setBusy(false);
  };

  const removeFactor = async () => {
    if (!factor || !window.confirm("Remove authenticator protection from this account?")) return;
    setError(""); setBusy(true);
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removeError) setError(removeError.message);
    else { setFactor(null); setMessage("Authenticator protection was removed."); }
    setBusy(false);
  };

  if (loading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading security settings...</CardContent></Card>;

  return (
    <Card className="border-brand-blue/15 shadow-sm">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-brand-blue/10 p-2 text-brand-blue"><ShieldCheck className="h-5 w-5" /></div>
          <div><CardTitle>Authenticator app</CardTitle><CardDescription>Use a time-based security code when signing in.</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
        {factor ? (
          <div className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-emerald-700" /><div><p className="font-semibold text-navy-800">Authenticator enabled</p><p className="text-xs text-emerald-800">Your account requires a fresh code at sign in.</p></div></div>
            <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={removeFactor} disabled={busy}><Trash2 className="mr-2 h-4 w-4" />Remove</Button>
          </div>
        ) : !enrollment ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-lg text-sm text-muted-foreground">Add your account to Google Authenticator, 1Password, Authy, or another TOTP app.</p><Button onClick={startEnrollment} disabled={busy}>{busy ? "Preparing..." : "Set up authenticator"}</Button></div>
        ) : (
          <form onSubmit={verifyEnrollment} className="space-y-4">
            <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app, then enter the six-digit code it generates.</p>
            {/* The QR code needs a white quiet zone in both themes: a scanner reads
                the contrast of the code against its background, not the app's palette. */}
            {enrollment.qr_code && <div className="flex justify-center rounded-xl bg-white p-4"><img src={enrollment.qr_code} alt="Authenticator setup QR code" className="h-48 w-48" /></div>}
            {enrollment.secret && <p className="break-all rounded-lg bg-slate-50 p-3 text-center font-mono text-xs text-slate-700">Can’t scan? {enrollment.secret}</p>}
            <div className="space-y-2"><Label htmlFor="authenticator-code">6-digit verification code</Label><Input id="authenticator-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} placeholder="000000" required /></div>
            <div className="flex gap-2"><Button type="submit" disabled={busy || code.replace(/\s/g, "").length < 6}>{busy ? "Verifying..." : "Verify and enable"}</Button><Button type="button" variant="ghost" onClick={() => setEnrollment(null)}>Cancel</Button></div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
