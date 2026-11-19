"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface JobDetail {
  job: {
    id: string;
    title: string;
    description: string | null;
    requirements: string | null;
    location: string | null;
    status: string;
    deadline: string | null;
    company: { name: string };
  };
  hasApplied: boolean;
  applicationStatus: string | null;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<JobDetail>(`/api/jobs?id=${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [id]);
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await clientRequest<{ application: { status: string } }>(
        "/api/jobs/applications",
        jsonBody({
          jobId: id,
          coverLetter: form.get("coverLetter"),
          cvUrl: form.get("cvUrl") || undefined,
        }),
      );
      setData(
        (prev) =>
          prev && {
            ...prev,
            hasApplied: true,
            applicationStatus: result.application.status,
          },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to apply.");
    } finally {
      setBusy(false);
    }
  }
  const closed =
    data &&
    (data.job.status !== "active" ||
      (data.job.deadline && new Date(data.job.deadline) < new Date()));
  return (
    <div className="commerce-page commerce-detail mx-auto max-w-3xl space-y-6">
      <Link href="/jobs" className="text-brand-blue">
        ← Jobs
      </Link>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!data ? (
        !error && <p role="status">Loading job…</p>
      ) : (
        <>
          <h1 className="text-2xl font-bold">{data.job.title}</h1>
          <p>
            {data.job.company.name} ·{" "}
            {data.job.location || "Location not specified"}
          </p>
          <section className="space-y-3">
            <h2 className="font-semibold">Description</h2>
            <p className="whitespace-pre-wrap">
              {data.job.description || "No description provided."}
            </p>
            <h2 className="font-semibold">Requirements</h2>
            <p className="whitespace-pre-wrap">
              {data.job.requirements ||
                "Contact the employer for requirements."}
            </p>
          </section>
          {data.hasApplied ? (
            <p role="status">
              Application submitted · {data.applicationStatus}
            </p>
          ) : closed ? (
            <p>This job is no longer accepting applications.</p>
          ) : (
            <form
              onSubmit={apply}
              className="space-y-4 rounded-xl border bg-card p-5"
            >
              <h2 className="text-lg font-semibold">Apply for this role</h2>
              <Label htmlFor="coverLetter">Cover letter</Label>
              <Textarea id="coverLetter" name="coverLetter" maxLength={10000} />
              <Label htmlFor="cvUrl">CV or portfolio URL (optional)</Label>
              <Input
                id="cvUrl"
                name="cvUrl"
                type="url"
                placeholder="https://"
              />
              <Button disabled={busy} type="submit">
                {busy ? "Submitting…" : "Submit application"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Your application will be shared with this employer.
              </p>
            </form>
          )}
        </>
      )}
    </div>
  );
}
