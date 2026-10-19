"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface VerificationStatus {
  verified: boolean;
  request: null | { status: "pending" | "approved" | "rejected"; reviewNote: string | null; evidenceUrls: string[] };
}

export function VerificationApplication() {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [links, setLinks] = useState([""]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const response = await fetch("/api/verification-requests", { cache: "no-store" });
      if (!response.ok) throw new Error("Verification status could not be loaded.");
      const body = await response.json() as VerificationStatus;
      setStatus(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification status could not be loaded.");
    }
  };

  useEffect(() => { void load(); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/verification-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceUrls: links.filter((link) => link.trim()) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Your request could not be submitted.");
      setMessage("Verification request submitted for review.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your request could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-sky-600" aria-hidden="true" /> Account verification</CardTitle>
        <CardDescription>Request a verified badge by sharing public links that establish your identity or public presence. We never ask for identity documents here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        {!status ? <p className="text-sm text-muted-foreground">Loading verification status…</p> : status.verified ? (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-sky-700"><BadgeCheck className="h-5 w-5" aria-hidden="true" /> Your account is verified.</p>
        ) : status.request?.status === "pending" ? (
          <div className="space-y-2 text-sm"><p role="status">Your verification request is under review.</p><p className="text-muted-foreground">Submitted links:</p><ul className="list-inside list-disc">{status.request.evidenceUrls.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all text-brand-blue underline">{url}</a></li>)}</ul></div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <p className="text-sm text-muted-foreground">Add one to five public HTTPS links from reputable websites or public profiles. Links are only visible to you and verification reviewers.</p>
            {links.map((link, index) => <Input key={index} id={`verification-link-${index}`} aria-label={`Public verification link ${index + 1}`} type="url" inputMode="url" placeholder="https://example.com/your-profile" value={link} onChange={(event) => setLinks((current) => current.map((value, item) => item === index ? event.target.value : value))} />)}
            {links.length < 5 && <Button type="button" variant="outline" size="sm" onClick={() => setLinks((current) => [...current, ""])}>Add another link</Button>}
            {status.request?.status === "rejected" && <p className="text-sm text-amber-700">Previous request was not approved{status.request.reviewNote ? `: ${status.request.reviewNote}` : ". You may submit updated public links."}</p>}
            <Button type="submit" disabled={busy || !links.some((link) => link.trim())}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Submit for review</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
