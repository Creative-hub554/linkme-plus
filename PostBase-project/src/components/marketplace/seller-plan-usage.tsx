"use client";
import { useEffect, useState } from "react";
import { clientRequest } from "@/lib/client-request";
type Usage = { plan: string; storedProducts: number; publicProducts: number; limits: { storedProducts: number | null; publicProducts: number | null } };
export function SellerPlanUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<{ seller: Usage }>("/api/entitlements", { signal: controller.signal }).then(result => setUsage(result.seller)).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return <section className="rounded-xl border bg-card p-4" aria-label="Seller plan usage">
    <h2 className="font-semibold">Seller plan / គម្រោងអ្នកលក់</h2>
    {usage ? <p className="text-sm">{usage.plan.toUpperCase()} · Inventory: {usage.storedProducts} / {usage.limits.storedProducts ?? "Unlimited"} · Public: {usage.publicProducts} / {usage.limits.publicProducts ?? "Unlimited"}</p> : <p className="text-sm" role="status">{failed ? "Unable to load your plan usage. Reload to retry." : "Loading plan usage…"}</p>}
    <p className="mt-1 text-xs text-muted-foreground">Stock units and variants do not count as separate products. Existing products are retained when a plan expires.</p>
  </section>;
}
