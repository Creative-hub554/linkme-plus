"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** One row of the pending queue, as `GET /api/admin/reports` reports it. */
interface PendingReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
  /** What the reported object actually said, attached by the route. */
  targetContent?: string | null;
  /** The reported content's author, or — on an account row — the account itself. */
  targetAuthor?: string | null;
}

interface QueuePagination {
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * The action each target shape makes sense for, and the word it carries on the
 * button. The moderation route accepts the enum freely — it is a shared surface
 * signed by admins and moderators — so the *dashboard* is where the affordances
 * are kept honest: warnings and removals are decisions about content, and a
 * suspension or ban is a decision about an account. A button is never offered
 * whose object the sentence does not describe.
 */
interface ModerationOffer {
  action: "warning" | "removal" | "suspension" | "ban";
  label: string;
}

const CONTENT_ACTIONS: ModerationOffer[] = [
  { action: "warning", label: "Warn" },
  { action: "removal", label: "Remove content" },
];

const ACCOUNT_ACTIONS: ModerationOffer[] = [
  { action: "suspension", label: "Suspend" },
  { action: "ban", label: "Ban" },
];

function actionsFor(row: PendingReport): ModerationOffer[] {
  if (row.targetType === "post" || row.targetType === "comment") return CONTENT_ACTIONS;
  if (row.targetType === "user") return ACCOUNT_ACTIONS;
  return [];
}

/**
 * The moderation queue's hands, behind the report board.
 *
 * The Reports tab is the map: every report, any status, listed truthfully.
 * This tab is what acts: only reports still `pending` are fetched, split by
 * what they report — a post or comment to judge as content, an account to
 * judge as a member — and each row carries the actions that apply to its
 * kind. Every action requires a reason before it can be pressed: the route
 * accepts the request without one, but a moderation that lands on somebody
 * should be explainable to them, and this is where that sentence is asked
 * for. What a decision does at the route is already pinned there (the
 * action row, the report resolved, the audit trail); what is pinned here is
 * that the dashboard asks why before it does any of it.
 */
export function AdminModeration() {
  const [rows, setRows] = useState<PendingReport[]>([]);
  const [pagination, setPagination] = useState<QueuePagination | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row in the reason box, and the exact action its opened button chose —
  // never "the first one offered": what the confirm records is what was pressed.
  const [acting, setActing] = useState<{ id: string; action: ModerationOffer["action"] } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async (page: number) => {
    setError(null);
    try {
      const params = new URLSearchParams({ status: "pending", page: String(page), limit: "20" });
      const response = await fetch(`/api/admin/reports?${params}`, { cache: "no-store" });
      if (!response.ok) {
        setError("The moderation queue could not be loaded. Refresh to try again.");
        setLoaded(true);
        return;
      }
      const payload = (await response.json()) as { data?: PendingReport[]; pagination?: QueuePagination };
      setRows(payload.data ?? []);
      setPagination(payload.pagination ?? null);
      setLoaded(true);
    } catch {
      setError("The moderation queue could not be loaded. Refresh to try again.");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const isContent = (row: PendingReport) => row.targetType === "post" || row.targetType === "comment";
  const offeredFor = (row: PendingReport) => actionsFor(row);
  const isAccount = (row: PendingReport) => row.targetType === "user";

  const decide = async (row: PendingReport, action: string) => {
    setBusy(row.id);
    try {
      const response = await fetch("/api/admin/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId: row.id, action, reason: reason.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That decision could not be recorded");
        setActing(null);
        setReason("");
        return;
      }
      setActing(null);
      setReason("");
      await load(page);
    } finally {
      setBusy(null);
    }
  };

  const rowView = (row: PendingReport) => {
    const offered: ModerationOffer[] = offeredFor(row);
    const actingRow = acting?.id === row.id;
    const isContentTarget = row.targetType === "post" || row.targetType === "comment";
    return (
      <div className="space-y-2">
        <p className="text-sm text-navy-700">{row.description ?? "No description was added to this report."}</p>
        {row.targetContent ? (
          <blockquote className="rounded-lg border-l-2 border-surface-border bg-surface-muted px-3 py-2 text-sm text-navy-700">
            <span className="line-clamp-3">{row.targetContent}</span>
          </blockquote>
        ) : (
          isContentTarget && (
            <p className="text-xs text-muted-foreground">The reported content is no longer available to show.</p>
          )
        )}
        <p className="text-xs text-muted-foreground">
          {row.targetType} · {isContentTarget ? "by " : "account "}
          <span className="font-medium">{row.targetAuthor ?? "unknown"}</span> · reported{" "}
          {new Date(row.createdAt).toLocaleString()} · ref {row.targetId.slice(0, 8)}…
        </p>

        {offered.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {offered.map(({ action, label }) => (
              <Button
                key={action}
                size="sm"
                variant="outline"
                disabled={busy === row.id}
                onClick={() => {
                  // Opening the reason box re-enters at empty: a stale sentence
                  // from a previous row must not ride along to this one.
                  setActing(actingRow ? null : { id: row.id, action });
                  setReason("");
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            This report&apos;s target type has no dashboard action yet — judge it on the Reports board.
          </p>
        )}

        {actingRow && (
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor={`reason-${row.id}`} className="text-xs font-medium text-navy-700">
              Why? The reason is recorded beside the decision
            </label>
            <textarea
              id={`reason-${row.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              aria-required="true"
              className="min-w-[16rem] flex-1 rounded-lg border border-surface-border p-2 text-sm"
            />
            <Button
              size="sm"
              disabled={busy === row.id || reason.trim() === "" || acting === null}
              onClick={() => {
                if (acting && acting.id === row.id) void decide(row, acting.action);
              }}
            >
              Record decision
            </Button>
          </div>
        )}
      </div>
    );
  };

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading the moderation queue…</p>;
  }

  const contentRows = rows.filter(isContent);
  const accountRows = rows.filter(isAccount);
  const untypedRows = rows.filter((row) => !isContent(row) && !isAccount(row));

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section aria-label="Reported content">
        <h3 className="text-sm font-semibold text-navy-800">Reported content — posts and comments</h3>
        {contentRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending content reports.</p>
        ) : (
          <ul className="mt-2 divide-y divide-surface-border">
            {contentRows.map((row) => (
              <li key={row.id} className="py-3">
                <p className="text-sm font-medium text-navy-800">{row.reason}</p>
                {rowView(row)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Reported accounts">
        <h3 className="text-sm font-semibold text-navy-800">Reported accounts</h3>
        {accountRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending account reports.</p>
        ) : (
          <ul className="mt-2 divide-y divide-surface-border">
            {accountRows.map((row) => (
              <li key={row.id} className="py-3">
                <p className="text-sm font-medium text-navy-800">{row.reason}</p>
                {rowView(row)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {untypedRows.length > 0 && (
        <section aria-label="Other reports">
          <ul className="divide-y divide-surface-border">
            {untypedRows.map((row) => (
              <li key={row.id} className="py-3">
                <p className="text-sm font-medium text-navy-800">{row.reason}</p>
                {rowView(row)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString()} pending
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!pagination.hasMore}
              onClick={() => setPage(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
