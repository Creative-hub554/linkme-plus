"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChip } from "@/components/shared/filter-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { JobCard } from "@/components/jobs/job-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MapPin, Building2, Briefcase, DollarSign } from "lucide-react";

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

export default function JobsPage() {
  const [selectedType, setSelectedType] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useState("");
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (selectedType !== "All") params.set("type", selectedType);
      if (location.trim()) params.set("location", location.trim());
      const response = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load jobs");
      const payload = await response.json();
      setJobs(Array.isArray(payload.data) ? payload.data : []);
    } catch { setError("We couldn't load jobs right now."); }
    finally { setLoading(false); }
  }, [location, searchQuery, selectedType]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Find your next opportunity</p>
        </div>
        <Button>Post a Job</Button>
      </div>

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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Jobs", value: "2,456", icon: Briefcase },
          { label: "Remote Jobs", value: "892", icon: Building2 },
          { label: "This Week", value: "156", icon: Briefcase },
          { label: "Avg Salary", value: "$95k", icon: DollarSign },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-3 text-center">
              <stat.icon className="h-5 w-5 mx-auto text-brand-blue mb-1" />
              <p className="text-lg font-bold text-navy-800">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Job Listings */}
      {loading ? (
        <div className="space-y-3" aria-label="Loading jobs" aria-busy="true">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-36 rounded-xl" />)}</div>
      ) : error ? (
        <EmptyState title="Jobs unavailable" description={error} action={<Button variant="outline" onClick={() => void loadJobs()}>Try again</Button>} />
      ) : jobs.length === 0 ? (
        <EmptyState title="No jobs found" description="Try another search or check back when new opportunities are posted." />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const salary = job.salaryMin || job.salaryMax
              ? `$${job.salaryMin ?? ""}${job.salaryMax ? ` - $${job.salaryMax}` : ""}`
              : undefined;
            return <JobCard key={job.id} id={job.id} title={job.title} company={job.company?.name || "Company"} companyLogo={job.company?.logoUrl || undefined} location={job.remoteStatus === "remote" ? "Remote" : job.location || "Location not specified"} type={job.jobType || "Job"} salary={salary} posted={formatPosted(job.createdAt)} description="View this opportunity for the full role description and requirements." applied={job.hasApplied} applicationStatus={job.applicationStatus} />;
          })}
        </div>
      )}
    </div>
  );
}
