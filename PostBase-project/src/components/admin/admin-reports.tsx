"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

/** One row of the queue, as `GET /api/admin/reports` reports it. */
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
}

/** The count envelope `paginatedResponse` answers with. */
interface ReportPagination {
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * The status filters, in queue order first — the way a moderator meets them —
 * and `all` last, which is the unfiltered listing the route answers when told.
 */
const STATUS_FILTERS = ["pending", "reviewing", "resolved", "dismissed", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const PAGE_LIMIT = 20;

/**
 * The reports the platform has received, as they actually are.
 *
 * The list it replaced carried invented rows, so this reads the real queue from
 * `GET /api/admin/reports` — the same autopagination contract every list route
 * answers. What a moderator does about a report has its own surface (the
 * moderation steps), so this board's job is the truthful map: which reports
 * exist, what they say, what has and has not been dealt with, and what page the
 * queue is on. A review is not a placeholder button here — there is no
 * half-wired control pretending to decide something.
 */
export function AdminReports() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [pagination, setPagination] = useState<ReportPagination | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: StatusFilter, page: number) => {
    setError(null);
    try {
      const params = new URLSearchParams({ status, page: String(page), limit: String(PAGE_LIMIT) });
      const response = await fetch(`/api/admin/reports?${params}`, { cache: "no-store" });
      if (!response.ok) {
        setError("The reports queue could not be loaded. Refresh to try again.");
        setLoaded(true);
        return;
      }
      const payload = (await response.json()) as { data?: ReportRow[]; pagination?: ReportPagination };
      setRows(payload.data ?? []);
      setPagination(payload.pagination ?? null);
      setLoaded(true);
    } catch {
      setError("The reports queue could not be loaded. Refresh to try again.");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load(status, page);
  }, [load, status, page]);

  const pickStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  const statusGlyph = (row: ReportRow) => {
    const tone =
      row.status === "pending"
        ? { ring: "bg-yellow-100", icon: Clock, tint: "text-yellow-600" }
        : row.status === "reviewing"
          ? { ring: "bg-blue-100", icon: AlertTriangle, tint: "text-blue-600" }
          : row.status === "resolved"
            ? { ring: "bg-green-100", icon: CheckCircle, tint: "text-green-600" }
            : { ring: "bg-surface-light-blue", icon: XCircle, tint: "text-muted-foreground" };
    const Glyph = tone.icon;
    return (
      <div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${tone.ring}`}>
        {/* The status is a colour and a glyph, both invisible to a screen
            reader — the sr-only line is what makes the three states read
            differently, and why the text is spelled out rather than reused. */}
        <Glyph className={`h-4 w-4 ${tone.tint}`} aria-hidden="true" />
        <span className="sr-only">Status: {row.status}</span>
      </div>
    );
  };

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading reports…</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* The filters, named as a group so the row reads as one choice. */}
      <div role="group" aria-label="Filter reports by status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={status === filter ? "default" : "outline"}
            aria-pressed={status === filter}
            onClick={() => pickStatus(filter)}
          >
            {filter !== "all" ? filter[0].toUpperCase() + filter.slice(1) : "All"}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {status === "all" ? "" : `${status} `}reports. {status === "pending" ? "The queue is clear." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                {statusGlyph(row)}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-800">{row.reason}</p>
                  {row.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{row.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.targetType} · reported {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString()} total
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
