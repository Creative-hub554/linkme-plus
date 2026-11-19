"use client";
import { useEffect, useState } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { PrivateEvidenceUpload } from "@/components/shared/private-evidence-upload";
import { Button } from "@/components/ui/button";
type Row = { id: string; status: string; revokedAt: string | null; reviewNote: string | null };
export function IdentityVerificationSettings() {
  const [ids, setIds] = useState<string[]>([]), [rows, setRows] = useState<Row[]>([]), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<{ requests: Row[] }>("/api/verification", { signal: controller.signal }).then(result => { if (!Array.isArray(result.requests)) throw new Error("Invalid verification response"); setRows(result.requests); }).catch(() => { if (!controller.signal.aborted) setMessage("Unable to load identity verification status."); });
    return () => controller.abort();
  }, [reload]);
  return <section className="space-y-3 rounded-xl border bg-card p-5" aria-labelledby="identity-verification-title">
    <h2 id="identity-verification-title" className="text-xl font-semibold">Employer identity verification</h2>
    <p className="text-sm">Optional National ID verification may allow jobs to publish automatically after system checks. Every job still needs private office-photo evidence. Identity verification does not certify the legitimacy of a job.</p>
    <p className="text-sm text-muted-foreground">An authorized administrator reviews your documents privately. Documents are scheduled for deletion 30 days after a decision. Never include ID numbers in review notes or public posts.</p>
    {rows.map(row => <p key={row.id} className="text-sm">{row.revokedAt ? "Revoked" : row.status}{row.reviewNote ? ` — ${row.reviewNote}` : ""}</p>)}
    <PrivateEvidenceUpload purpose="national_id" value={ids} onChange={setIds} />
    <Button disabled={!ids.length || busy} onClick={async () => {
      setBusy(true); setMessage("");
      try { await clientRequest("/api/verification", jsonBody({ evidenceIds: ids })); setIds([]); setReload(value => value + 1); setMessage("Submitted for private administrator review."); }
      catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to submit verification"); }
      finally { setBusy(false); }
    }}>Submit identity for review</Button>
    <p role="status" className="text-sm">{message}</p>
  </section>;
}
