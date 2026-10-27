"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Option = { id: string; name: string };
export default function NewJobPage() {
  const router = useRouter();
  const [options, setOptions] = useState<{
    companies: Option[];
    pages: Option[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<{ companies: Option[]; pages: Option[] }>("/api/companies", {
      signal: controller.signal,
    })
      .then(setOptions)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const pageId = String(form.get("pageId"));
      let company = options?.companies.find((item) => item.id === pageId);
      if (!company)
        company = (
          await clientRequest<{ company: Option }>(
            "/api/companies",
            jsonBody({ pageId }),
          )
        ).company;
      const result = await clientRequest<{ job: { id: string } }>(
        "/api/jobs",
        jsonBody({
          companyId: company.id,
          title: form.get("title"),
          location: form.get("location"),
          remoteStatus: form.get("remoteStatus"),
          jobType: form.get("jobType"),
          description: form.get("description"),
          requirements: form.get("requirements"),
          deadline: form.get("deadline") || undefined,
        }),
      );
      router.push(`/jobs/${result.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to post job.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/jobs" className="text-brand-blue">
        ← Jobs
      </Link>
      <h1 className="text-2xl font-bold">Post a job</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {!options ? (
        !error && <p role="status">Loading your companies…</p>
      ) : !options.pages.length && !options.companies.length ? (
        <p>
          Create a{" "}
          <Link className="text-brand-blue underline" href="/pages/new">
            business Page
          </Link>{" "}
          first. Jobs are managed by the Page’s administrators.
        </p>
      ) : (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border bg-card p-5"
        >
          <Label htmlFor="pageId">Company or business Page</Label>
          <select
            id="pageId"
            name="pageId"
            required
            className="w-full rounded border bg-background p-2"
          >
            {options.companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            {options.pages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} (Page)
              </option>
            ))}
          </select>
          <Label htmlFor="title">Job title</Label>
          <Input id="title" name="title" required maxLength={200} />
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" maxLength={100} />
          <Label htmlFor="remoteStatus">Work arrangement</Label>
          <select
            id="remoteStatus"
            name="remoteStatus"
            className="w-full rounded border bg-background p-2"
          >
            <option value="onsite">On-site</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <Label htmlFor="jobType">Job type</Label>
          <select
            id="jobType"
            name="jobType"
            className="w-full rounded border bg-background p-2"
          >
            {["Full-time", "Part-time", "Contract", "Internship"].map(
              (type) => (
                <option key={type}>{type}</option>
              ),
            )}
          </select>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            required
            maxLength={20000}
          />
          <Label htmlFor="requirements">Requirements</Label>
          <Textarea id="requirements" name="requirements" maxLength={20000} />
          <Label htmlFor="deadline">Application deadline (optional)</Label>
          <Input id="deadline" name="deadline" type="date" />
          <Button type="submit" disabled={busy}>
            {busy ? "Publishing…" : "Publish job"}
          </Button>
        </form>
      )}
    </div>
  );
}
