"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** One row of the record, as `GET /api/admin/moderation-actions` reports it. */
interface RecordedAction {
  id: string;
  action: "warning" | "removal" | "suspension" | "ban";
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
  actorUsername: string;
}

interface HistoryPagination {
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

/** The verb each recorded action names, in the sentence the row reads as. */
const ACTION_LABELS: Record<RecordedAction["action"], string> = {
  warning: "Warned",
  removal: "Removed content",
  suspension: "Suspended",
  ban: "Banned",
};

/**
 * The moderation record, read back.
 *
 * Where `AdminModeration` is the queue's hands — the decisions still to make —
 * this is the ledger underneath them: every action ever recorded through the
 * moderate route, newest first, with who made it, what it was about, why, and
 * when. A decision is a matter of record precisely so it can be shown later;
 * a history that hid behind ref ids alone would not be one. An action whose
 * reason was never given is listed honestly as unexplained rather than skipped.
 */
export function AdminModerationHistory() {
  const [rows, setRows] = useState<RecordedAction[]>([]);
  const [pagination, setPagination] = useState<HistoryPagination | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async (page: number) => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/moderation-actions?page=${page}&limit=20`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError("The moderation history could not be loaded. Refresh to try again.");
        setLoaded(true);
        return;
      }
      const payload = (await response.json()) as {
        data?: RecordedAction[];
        pagination?: HistoryPagination;
      };
      setRows(payload.data ?? []);
      setPagination(payload.pagination ?? null);
      setLoaded(true);
    } catch {
      setError("The moderation history could not be loaded. Refresh to try again.");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading the moderation history…</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* The record, handed over in full: a server-built CSV the browser
          downloads without script — no client assembly, no pagination window,
          the whole ledger the route gates. Offered only while rows are here;
          an empty record has nothing to hand over. */}
      {rows.length > 0 && (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a
              href="/api/admin/moderation-actions/export"
              className="pressable"
            >
              Export CSV ({pagination?.total ?? rows.length} recorded)
            </a>
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No moderation actions recorded yet.</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <p className="text-sm font-medium text-navy-800">
                {ACTION_LABELS[row.action] ?? row.action}{" "}
                <span className="text-muted-foreground">
                  the {row.targetType} · ref {row.targetId.slice(0, 8)}…
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                by <span className="font-medium">@{row.actorUsername}</span> ·{" "}
                {new Date(row.createdAt).toLocaleString()}
              </p>
              <p className="text-xs text-navy-700">
                {row.reason ? `Reason: ${row.reason}` : "No reason was recorded for this action."}
              </p>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString()} recorded
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
