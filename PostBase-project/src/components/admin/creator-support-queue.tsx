"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Ticket { id: string; subject: string; message: string; status: string; createdAt: string; username: string; displayName: string | null; }

export function CreatorSupportQueue() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const response = await fetch("/api/admin/creator-support", { cache: "no-store" }); const body = await response.json() as { tickets?: Ticket[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Priority support could not be loaded."); setTickets(body.tickets ?? []); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Priority support could not be loaded."); } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const resolve = async (ticketId: string) => { setBusy(ticketId); try { const response = await fetch("/api/admin/creator-support", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId, status: "resolved" }) }); const body = await response.json().catch(() => null) as { error?: string } | null; if (!response.ok) throw new Error(body?.error ?? "The ticket could not be resolved."); await load(); } catch (resolveError) { setError(resolveError instanceof Error ? resolveError.message : "The ticket could not be resolved."); } finally { setBusy(null); } };
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading priority support…</p>;
  return <section className="space-y-3" aria-label="Creator priority support">{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{tickets.length === 0 ? <p className="text-sm text-muted-foreground">No open Creator Boost support requests.</p> : <ul className="divide-y divide-surface-border">{tickets.map((ticket) => <li key={ticket.id} className="space-y-2 py-3"><p className="font-medium text-navy-800">{ticket.subject} <span className="font-normal text-muted-foreground">from @{ticket.username}</span></p><p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.message}</p><Button size="sm" disabled={busy === ticket.id} onClick={() => void resolve(ticket.id)}>Resolve</Button></li>)}</ul>}</section>;
}
