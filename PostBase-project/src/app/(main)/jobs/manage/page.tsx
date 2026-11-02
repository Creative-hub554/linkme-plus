"use client";
import Link from "next/link";
import { JobAllowanceUsage } from "@/components/jobs/job-allowance-usage";
import { useCallback, useEffect, useState } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
type Job = {
  id: string;
  title: string;
  status: string;
  reviewStatus?: string;
  reviewNote?: string | null;
  company?: { name: string };
};
type Application = {
  id: string;
  userId: string;
  coverLetter: string | null;
  cvUrl: string | null;
  status: string;
  applicant?: { name: string; username: string };
};
const safeCv = (value: string | null) => {
  try {
    return value && ["http:", "https:"].includes(new URL(value).protocol)
      ? value
      : null;
  } catch {
    return null;
  }
};
export default function ManageJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState("");
  const [applications, setApplications] = useState<Application[]>([]);
  const [page, setPage] = useState(1);
  const [applicationPage, setApplicationPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [moreApplications, setMoreApplications] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    clientRequest<{ data: Job[]; pagination: { hasMore: boolean } }>(
      `/api/jobs?manage=true&page=${page}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setJobs(result.data);
        setHasMore(result.pagination.hasMore);
        setSelected((previous) =>
          result.data.some((job) => job.id === previous)
            ? previous
            : result.data[0]?.id || "",
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, reload]);
  const loadApplications = useCallback(
    async (signal?: AbortSignal) => {
      if (!selected) return;
      setLoading(true);
      setError("");
      try {
        const result = await clientRequest<{
          data: Application[];
          pagination: { hasMore: boolean };
        }>(
          `/api/jobs/applications?jobId=${encodeURIComponent(selected)}&page=${applicationPage}`,
          { signal },
        );
        if (!signal?.aborted) {
          setApplications(result.data);
          setMoreApplications(result.pagination.hasMore);
        }
      } catch (err) {
        if (!signal?.aborted)
          setError(
            err instanceof Error ? err.message : "Unable to load applications.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [selected, applicationPage],
  );
  useEffect(() => {
    const controller = new AbortController();
    setApplications([]);
    void loadApplications(controller.signal);
    return () => controller.abort();
  }, [loadApplications]);
  async function updateApplication(id: string, status: string) {
    setBusy(true);
    setError("");
    try {
      await clientRequest(
        "/api/jobs/applications",
        jsonBody({ id, status }, "PUT"),
      );
      await loadApplications();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update application.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggleJob() {
    const job = jobs.find((item) => item.id === selected);
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      await clientRequest(
        "/api/jobs",
        jsonBody(
          { id: job.id, status: job.status === "active" ? "closed" : "active" },
          "PUT",
        ),
      );
      setReload((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update job.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/jobs" className="text-brand-blue">
        ← Jobs
      </Link>
      <h1 className="text-2xl font-bold">Manage jobs and applicants</h1>
      <JobAllowanceUsage />
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading…</p>}
      {!jobs.length && !loading && (
        <p>
          No managed jobs yet.{" "}
          <Link className="text-brand-blue underline" href="/jobs/new">
            Post a job
          </Link>{" "}
          from a Page you administer.
        </p>
      )}
      {jobs.length > 0 && (
        <>
          <Label htmlFor="managedJob">Job</Label>
          <select
            id="managedJob"
            disabled={busy}
            className="w-full rounded border bg-background p-2"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setApplicationPage(1);
            }}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {job.reviewStatus ?? "Review pending"} · {job.company?.name} · {job.status}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={busy} onClick={toggleJob}>
              {jobs.find((item) => item.id === selected)?.status === "active"
                ? "Close applications"
                : "Reopen applications"}
            </Button>
            <Button
              variant="outline"
              disabled={page === 1 || loading || busy}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous jobs
            </Button>
            <Button
              variant="outline"
              disabled={!hasMore || loading || busy}
              onClick={() => setPage((value) => value + 1)}
            >
              Next jobs
            </Button>
          </div>
          <h2 className="text-xl font-semibold">Applicants</h2>
          {!loading && !applications.length && (
            <p>No applications on this page.</p>
          )}
          {applications.map((application) => (
            <article
              key={application.id}
              className="space-y-3 rounded-xl border bg-card p-5"
            >
              <Link
                className="font-semibold text-brand-blue"
                href={`/profile?user=${application.userId}`}
              >
                {application.applicant?.name || application.userId}
              </Link>
              <p className="whitespace-pre-wrap">
                {application.coverLetter || "No cover letter provided."}
              </p>
              {safeCv(application.cvUrl) && (
                <a
                  href={safeCv(application.cvUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-blue underline"
                >
                  View CV or portfolio
                </a>
              )}
              <Label htmlFor={`status-${application.id}`}>
                Application status
              </Label>
              <select
                id={`status-${application.id}`}
                value={application.status}
                disabled={busy}
                onChange={(event) =>
                  void updateApplication(application.id, event.target.value)
                }
                className="w-full rounded border bg-background p-2"
              >
                {[
                  "pending",
                  "reviewing",
                  "shortlisted",
                  "rejected",
                  "hired",
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </article>
          ))}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={applicationPage === 1 || loading || busy}
              onClick={() => setApplicationPage((value) => value - 1)}
            >
              Previous applicants
            </Button>
            <span>Page {applicationPage}</span>
            <Button
              variant="outline"
              disabled={!moreApplications || loading || busy}
              onClick={() => setApplicationPage((value) => value + 1)}
            >
              Next applicants
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
