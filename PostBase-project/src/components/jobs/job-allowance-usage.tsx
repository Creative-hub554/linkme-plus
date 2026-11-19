"use client";
import { useEffect, useState } from "react";
import { clientRequest } from "@/lib/client-request";
export function JobAllowanceUsage() {
  const [usage, setUsage] = useState<{ freeRemaining: number; paidRemaining: number; paidPeriodActive: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<NonNullable<typeof usage>>("/api/jobs/entitlements", { signal: controller.signal }).then(setUsage).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return <section aria-label="Job posting allowance" className="rounded border bg-card p-3 text-sm">
    <h2 className="font-semibold">Job posting allowance</h2>
    {usage ? <p>{usage.freeRemaining} of 10 lifetime free publications remaining.{usage.paidPeriodActive ? ` ${usage.paidRemaining} paid publications remain this billing month.` : " An employer subscription is required after your free allowance."}</p> : <p role="status">{failed ? "Unable to load your allowance. Reload to retry." : "Loading allowance…"}</p>}
    <p>Rejected submissions and edits do not consume credits. Deleting a published job does not restore its credit.</p>
  </section>;
}
