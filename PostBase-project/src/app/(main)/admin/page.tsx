"use client";
import { EmploymentReviews } from "@/components/admin/employment-reviews";

import Link from "next/link";
import { AdminMemberDirectory } from "@/components/admin/member-directory";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface Report {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
}
interface Overview {
  stats: { users: number; posts: number; pendingReports: number };
  users: { id: string; username: string; role: string; createdAt: string }[];
  actions: {
    id: string;
    targetType: string;
    action: string;
    reason: string | null;
    createdAt: string;
  }[];
}
export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Report | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const [summary, result] = await Promise.all([
          clientRequest<Overview>("/api/admin/overview", { signal }),
          clientRequest<{ data: Report[]; pagination: { hasMore: boolean } }>(
            `/api/admin/reports?status=${status}&page=${page}&limit=20`,
            { signal },
          ),
        ]);
        if (signal?.aborted) return;
        setOverview(summary);
        setReports(result.data);
        setHasMore(result.pagination.hasMore);
      } catch (err) {
        if (!signal?.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load admin dashboard.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [status, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function moderate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await clientRequest(
        "/api/admin/moderate",
        jsonBody({
          reportId: selected.id,
          action: form.get("action"),
          reason: form.get("reason"),
        }),
      );
      setSelected(null);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to resolve report.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      <EmploymentReviews />
          <p className="text-muted-foreground">Manage your LinkMe+ platform</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/settings">Settings</Link>
        </Button>
      </div>
      {error && (
        <div role="alert" className="space-y-2 text-red-600">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}
      {loading && <p role="status">Loading dashboard…</p>}
      {overview && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Total Users", overview.stats.users],
              ["Active Posts", overview.stats.posts],
              ["Reports Pending", overview.stats.pendingReports],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-4">
                <p className="text-sm">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>
          <Tabs defaultValue="reports">
            <TabsList aria-label="Admin sections">
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
            <TabsContent value="reports" className="space-y-4">
              <Label htmlFor="reportStatus">Report status</Label>
              <select
                id="reportStatus"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                  setSelected(null);
                }}
                className="ml-3 rounded border bg-background p-2"
              >
                {["pending", "resolved", "dismissed", "all"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              {!loading && !reports.length && <p>No reports in this view.</p>}
              {reports.map((report) => (
                <article
                  key={report.id}
                  className="space-y-2 rounded-xl border bg-card p-4"
                >
                  <h2 className="font-semibold">
                    {report.reason} · {report.targetType}
                  </h2>
                  <p>{report.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Target: {report.targetId} · {report.status} ·{" "}
                    {new Date(report.createdAt).toLocaleString()}
                  </p>
                  {report.targetType === "post" && (
                    <Link
                      className="text-brand-blue"
                      href={`/feed?post=${report.targetId}`}
                    >
                      View reported post
                    </Link>
                  )}
                  {report.status === "pending" && (
                    <Button
                      variant="outline"
                      onClick={() => setSelected(report)}
                    >
                      Review
                    </Button>
                  )}
                </article>
              ))}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <span>Page {page}</span>
                <Button
                  variant="outline"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
              {selected && (
                <form
                  onSubmit={moderate}
                  className="space-y-4 rounded-xl border bg-card p-5"
                >
                  <h2 className="font-semibold">
                    Resolve report: {selected.reason}
                  </h2>
                  <Label htmlFor="action">Decision</Label>
                  <select
                    id="action"
                    name="action"
                    className="w-full rounded border bg-background p-2"
                  >
                    <option value="dismiss">Dismiss report</option>
                    <option value="warning">Record a warning</option>
                    {["post", "comment", "listing", "job", "campaign"].includes(
                      selected.targetType,
                    ) && (
                      <option value="removal">Remove reported content</option>
                    )}
                  </select>
                  <Label htmlFor="reason">Decision reason</Label>
                  <Textarea
                    id="reason"
                    name="reason"
                    required
                    maxLength={2000}
                  />
                  <div className="flex gap-3">
                    <Button type="submit" disabled={busy}>
                      {busy ? "Saving…" : "Save decision"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setSelected(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </TabsContent>
            <TabsContent value="users"><AdminMemberDirectory /></TabsContent>
            <TabsContent value="content">
              <h2 className="my-3 font-semibold">
                Recent moderation decisions
              </h2>
              {!overview.actions.length && <p>No moderation decisions yet.</p>}
              {overview.actions.map((action) => (
                <div key={action.id} className="border-b py-3">
                  <p>
                    {action.action} · {action.targetType}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {action.reason} ·{" "}
                    {new Date(action.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="analytics">
              <div className="my-4 space-y-3">
                <h2 className="font-semibold">Current platform totals</h2>
                <p>
                  {overview.stats.users} members · {overview.stats.posts} posts
                  · {overview.stats.pendingReports} reports awaiting review
                </p>
                <p className="text-sm text-muted-foreground">
                  These figures come from current database records.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  Refresh totals
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
