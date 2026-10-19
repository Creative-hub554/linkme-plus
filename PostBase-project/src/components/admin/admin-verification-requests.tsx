"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface VerificationRow {
  id: string;
  username: string;
  displayName: string;
  evidenceUrls: string[];
  createdAt: string;
}

export function AdminVerificationRequests() {
  const [requests, setRequests] = useState<VerificationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/verification-requests", { cache: "no-store" });
      if (!response.ok) throw new Error("The verification queue could not be loaded.");
      const body = await response.json() as { data?: VerificationRow[] };
      setRequests(body.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The verification queue could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const review = async (requestId: string, decision: "approved" | "rejected") => {
    setBusy(requestId);
    setError("");
    try {
      const response = await fetch("/api/admin/verification-requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The review could not be saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The review could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading verification requests…</p>;
  return <section aria-label="Verification requests" className="space-y-3">
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {requests.length === 0 ? <p className="text-sm text-muted-foreground">No verification requests are waiting for review.</p> : <ul className="divide-y divide-surface-border">
      {requests.map((request) => <li key={request.id} className="space-y-2 py-4">
        <div><p className="font-medium">{request.displayName} <span className="text-sm text-muted-foreground">@{request.username}</span></p><p className="text-xs text-muted-foreground">Submitted {new Date(request.createdAt).toLocaleDateString()}</p></div>
        <ul className="list-inside list-disc space-y-1">{request.evidenceUrls.map((url) => <li key={url} className="break-all text-sm"><a href={url} target="_blank" rel="noreferrer" className="text-brand-blue underline">{url}</a></li>)}</ul>
        <div className="flex gap-2"><Button size="sm" disabled={busy === request.id} onClick={() => void review(request.id, "approved")}>Approve verification</Button><Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void review(request.id, "rejected")}>Reject request</Button></div>
      </li>)}
    </ul>}
  </section>;
}
