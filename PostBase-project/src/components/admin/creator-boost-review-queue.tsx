"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CREATOR_BOOST_BENEFITS, type CreatorBoostEligibility, type CreatorBoostTier } from "@/lib/creator-boost";

interface Application {
  id: string;
  username: string;
  displayName: string | null;
  tier: CreatorBoostTier | null;
  eligibilitySnapshot: CreatorBoostEligibility;
  createdAt: string;
}

/** Owner-only decisions for a limited commercial benefit. */
export function CreatorBoostReviewQueue() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/admin/creator-boost", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { applications?: Application[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Creator Boost applications could not be loaded.");
      setApplications(body?.applications ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Creator Boost applications could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const review = async (applicationId: string, decision: "approved" | "rejected") => {
    setBusy(applicationId);
    setError(null);
    try {
      const response = await fetch("/api/admin/creator-boost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId, decision }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The Creator Boost decision could not be saved.");
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "The Creator Boost decision could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading Creator Boost applications…</p>;
  return (
    <section aria-label="Creator Boost applications" className="space-y-3">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Creator Boost applications are waiting for review.</p>
      ) : (
        <ul className="divide-y divide-surface-border">
          {applications.map((application) => {
            const metrics = application.eligibilitySnapshot.metrics;
            const tier = application.tier;
            return (
              <li key={application.id} className="space-y-2 py-4">
                <div>
                  <p className="font-medium text-navy-800">{application.displayName ?? application.username} <span className="text-sm font-normal text-muted-foreground">@{application.username}</span></p>
                  <p className="text-xs text-muted-foreground">Applied {new Date(application.createdAt).toLocaleDateString()}</p>
                </div>
                <p className="text-sm text-navy-700">
                  {metrics.followers.toLocaleString()} followers · {metrics.publicPosts} public posts · {metrics.shortVideos} short videos · {metrics.averageOrganicLikes.toLocaleString()} average organic likes
                </p>
                <p className="text-sm text-violet-800">Suggested tier: <strong>{tier ? CREATOR_BOOST_BENEFITS[tier].label : "Not eligible"}</strong>{tier ? ` (${CREATOR_BOOST_BENEFITS[tier].discountPercent}% off)` : ""}</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy === application.id} onClick={() => void review(application.id, "approved")}>Approve for 30 days</Button>
                  <Button size="sm" variant="outline" disabled={busy === application.id} onClick={() => void review(application.id, "rejected")}>Reject</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
