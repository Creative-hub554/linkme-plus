"use client";
import { useEffect, useState } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { PrivateEvidencePreview } from "@/components/shared/private-evidence-upload";
import { Button } from "@/components/ui/button";
type Row = { id: string; title?: string; email?: string; description?: string; reviewNote?: string; evidenceIds?: string[]; officeEvidenceIds?: string[]; pendingRevision?: Record<string, unknown> | null };
export function EmploymentReviews() {
  const [kind, setKind] = useState("jobs"), [rows, setRows] = useState<Row[]>([]), [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<{ jobs?: Row[]; requests?: Row[]; hasMore: boolean }>(`/api/admin/${kind}?page=${page}`, { signal: controller.signal }).then(result => { setRows(result.jobs ?? result.requests ?? []); setHasMore(result.hasMore); }).catch(() => { if (!controller.signal.aborted) setError("Unable to load employment reviews"); });
    return () => controller.abort();
  }, [kind, page, reload]);
  return <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="employment-reviews-title">
    <h2 id="employment-reviews-title" className="text-xl font-semibold">Job and identity reviews</h2>
    <label className="block">Review queue<select className="ml-2 rounded border bg-background p-2" value={kind} onChange={event => { setKind(event.target.value); setPage(1); setRows([]); setError(""); }}><option value="jobs">Jobs</option><option value="verification">National IDs</option></select></label>
    {error && <p role="alert">{error}</p>}
    {!rows.length && <p>No submissions on this page.</p>}
    {rows.map(row => <form key={row.id} className="space-y-2 rounded border p-3" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
      try { await clientRequest(`/api/admin/${kind}`, jsonBody({ id: row.id, action: form.get("action"), note: form.get("note") })); setReload(value => value + 1); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Review failed"); }
      finally { setBusy(false); }
    }}>
      <h3 className="font-semibold">{row.title ?? row.email ?? row.id}</h3><p className="whitespace-pre-wrap text-sm">{row.description}</p><p className="text-sm">{row.reviewNote}</p>
      {row.pendingRevision && <details><summary>Proposed job changes</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(row.pendingRevision, null, 2)}</pre></details>}
      {(row.evidenceIds ?? row.officeEvidenceIds ?? []).map(id => <PrivateEvidencePreview key={id} id={id} />)}
      <label className="block text-sm">Decision<select name="action" className="ml-2 rounded border bg-background p-2"><option value="approve">Approve</option><option value="reject">Reject</option>{kind === "jobs" ? <><option value="changes">Request changes</option><option value="remove">Remove</option></> : <option value="revoke">Revoke verification</option>}</select></label>
      <label className="block text-sm">Reason (do not include ID numbers)<textarea name="note" required maxLength={2000} className="block w-full rounded border bg-background p-2" /></label>
      <Button disabled={busy} type="submit">Record review decision</Button>
    </form>)}
    <div className="flex gap-3"><Button variant="outline" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>Previous reviews</Button><Button variant="outline" disabled={!hasMore || busy} onClick={() => setPage(value => value + 1)}>Next reviews</Button></div>
  </section>;
}
