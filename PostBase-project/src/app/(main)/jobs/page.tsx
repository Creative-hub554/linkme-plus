"use client";
import { SponsoredPlacement } from "@/components/advertising/sponsored-placement";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChip } from "@/components/shared/filter-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { JobCard } from "@/components/jobs/job-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientRequest } from "@/lib/client-request";
import { Plus, Search, MapPin } from "lucide-react";

const jobTypes = ["All", "Full-time", "Part-time", "Contract", "Remote", "Internship"];

interface JobResult {
  id: string;
  title: string;
  location?: string | null;
  remoteStatus?: string | null;
  jobType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  createdAt: string;
  company?: { name?: string | null; logoUrl?: string | null } | null;
  /** The viewer's own flag, answered per row by the list read for a signed-in
   * member and `false` for a visitor — the same contract the single-job read
   * has always had. */
  hasApplied: boolean;
  /** Where the viewer's application stands, carried beside the flag the same
   * way the single-job read answers it; null when there is no application. */
  applicationStatus: string | null;
}

function formatPosted(value: string) {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function workModelLabel(status: JobResult["remoteStatus"]) {
  if (status === "remote") return "Remote";
  if (status === "hybrid") return "Hybrid";
  if (status === "onsite" || status === "on-site") return "On-site";
}

function salaryLabel(job: JobResult) {
  const { salaryMin, salaryMax } = job;
  if (salaryMin != null && salaryMax != null) return `${dollars.format(salaryMin)}–${dollars.format(salaryMax)}`;
  if (salaryMin != null) return `From ${dollars.format(salaryMin)}`;
  if (salaryMax != null) return `Up to ${dollars.format(salaryMax)}`;
}

type JobPreviewDetails = { description: string | null; requirements: string | null };

function JobPreview({ job }: { job: JobResult }) {
  const [details, setDetails] = useState<JobPreviewDetails>();
  const [error, setError] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia?.("(min-width: 1024px)");
    if (!desktop) return;
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      if (!desktop.matches) return;
      const request = new AbortController();
      controller = request;
      setError(false);
      clientRequest<{ job: JobPreviewDetails }>(`/api/jobs?id=${encodeURIComponent(job.id)}`, { signal: request.signal })
        .then(({ job: detail }) => { if (!request.signal.aborted) setDetails(detail); })
        .catch(() => { if (!request.signal.aborted) setError(true); });
    };
    load();
    desktop.addEventListener("change", load);
    return () => {
      controller?.abort();
      desktop.removeEventListener("change", load);
    };
  }, [job.id]);

  return (
    <aside className="commerce-job-preview hidden lg:block" aria-label="Job preview">
      <p className="text-sm text-muted-foreground">{job.company?.name || "Company"}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight break-words">{job.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{[job.location, workModelLabel(job.remoteStatus), salaryLabel(job)].filter(Boolean).join(" · ")}</p>
      <Button asChild className="commerce-create mt-4"><Link href={`/jobs/${job.id}`}>View job and application</Link></Button>
      <div className="mt-5 space-y-3 border-t pt-4">
        {error ? <p role="status">Preview unavailable. Open the job to see its details.</p> : !details ? <p role="status">Loading job details…</p> : (
          <>
            {details.description && <p className="whitespace-pre-wrap break-words">{details.description}</p>}
            {details.requirements && <><h3 className="font-semibold">Requirements</h3><p className="whitespace-pre-wrap break-words">{details.requirements}</p></>}
            {!details.description && !details.requirements && <p className="text-muted-foreground">The employer hasn’t added a description.</p>}
          </>
        )}
      </div>
    </aside>
  );
}

export default function JobsPage() {
  const requestRef = useRef(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedType, setSelectedType] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useState("");
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [previewId, setPreviewId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20", page: String(page) });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (selectedType !== "All") params.set("type", selectedType);
      if (location.trim()) params.set("location", location.trim());
      const response = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load jobs");
      const payload = await response.json();
      if (request !== requestRef.current) return;
      setJobs(Array.isArray(payload.data) ? payload.data : []);
      setHasMore(Boolean(payload.pagination?.hasMore));
      setTotal(payload.pagination?.total ?? payload.data?.length ?? 0);
    } catch { if (request === requestRef.current) setError("We couldn't load jobs right now."); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [location, searchQuery, selectedType, page]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);
  useEffect(() => { setPage(1); }, [location, searchQuery, selectedType]);
  const preview = jobs.find((job) => job.id === previewId) ?? jobs[0];

  return (
    <div className="commerce-page space-y-5">
      {/* Header */}
      <header className="commerce-heading">
        <div>
          <h1 className="commerce-title">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Find your next opportunity</p>
        </div>
        <Button asChild className="commerce-create"><Link href="/jobs/new"><Plus aria-hidden="true" className="size-4" />Post job</Link></Button>
      </header>
      <nav className="commerce-links" aria-label="Employer tools"><Link href="/jobs/manage">Manage jobs and applicants</Link></nav>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search jobs by title, skill, or company"
            placeholder="Search jobs by title, skill, or company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void loadJobs(); }}
            className="pl-9 bg-card"
          />
        </div>
        <div className="relative w-full sm:w-48">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Location"
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void loadJobs(); }}
            className="pl-9 bg-card"
          />
        </div>
      </div>

      {/* Job Types */}
      <div
        role="group"
        aria-label="Filter jobs by type"
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide"
      >
        {jobTypes.map((type) => (
          <FilterChip
            key={type}
            selected={selectedType === type}
            onClick={() => setSelectedType(type)}
          >
            {type}
          </FilterChip>
        ))}
      </div>

      {!loading && !error && <p role="status" className="text-sm text-muted-foreground">{total} matching jobs</p>}
      {!searchQuery.trim() && !location.trim() && selectedType === "All" && <SponsoredPlacement location="jobs" />}
      {/* Job Listings */}
      {loading ? (
        <div className="space-y-3" aria-label="Loading jobs" aria-busy="true">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-36 rounded-xl" />)}</div>
      ) : error ? (
        <EmptyState title="Jobs unavailable" description={error} action={<Button variant="outline" onClick={() => void loadJobs()}>Try again</Button>} />
      ) : jobs.length === 0 ? (
        <EmptyState title="No jobs found" description="Try another search or check back when new opportunities are posted." />
      ) : (
        <div className="commerce-job-board">
          <div className="min-w-0 space-y-3">
          {jobs.map((job) => {
            const workModel = workModelLabel(job.remoteStatus);
            return (
              <JobCard key={job.id} id={job.id} title={job.title} company={job.company?.name || "Company"}
                companyLogo={job.company?.logoUrl || undefined} location={[job.location, workModel].filter(Boolean).join(" · ") || "Location not specified"}
                type={job.jobType || "Job"} salary={salaryLabel(job)} posted={formatPosted(job.createdAt)}
                applied={job.hasApplied} applicationStatus={job.applicationStatus}
                onPreview={() => setPreviewId(job.id)} previewSelected={preview?.id === job.id} />
            );
          })}
          </div>
          {preview && <JobPreview key={preview.id} job={preview} />}
        </div>
      )}
      <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </div>
  );
}
