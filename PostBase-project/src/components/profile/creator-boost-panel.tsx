"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CREATOR_BOOST_BENEFITS,
  CREATOR_BOOST_REQUIREMENTS,
  type CreatorBoostEligibility,
  type CreatorBoostTier,
} from "@/lib/creator-boost";

interface Membership {
  id: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  tier: CreatorBoostTier | null;
  reviewNote: string | null;
  expiresAt: string | null;
}

interface CreatorBoostResponse {
  eligibility: CreatorBoostEligibility;
  membership: Membership | null;
}

function metric(value: number, target: number) {
  return `${value.toLocaleString()} / ${target.toLocaleString()}`;
}

/** A member-facing application and renewal status, sourced entirely from the server. */
export function CreatorBoostPanel() {
  const [data, setData] = useState<CreatorBoostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/creator-boost", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as CreatorBoostResponse | { error?: string } | null;
      if (!response.ok || !body || !("eligibility" in body)) {
        throw new Error((body as { error?: string } | null)?.error ?? "Creator Boost status could not be loaded.");
      }
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Creator Boost status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/creator-boost", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Creator Boost application could not be submitted.");
      await load();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Creator Boost application could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading Creator Boost status…</p>;
  if (!data) return <p role="alert" className="text-sm text-red-700">{error ?? "Creator Boost status is unavailable."}</p>;

  const { eligibility, membership } = data;
  const active = membership?.status === "approved" && membership.expiresAt && new Date(membership.expiresAt) > new Date();
  const canApply = eligibility.eligible && !active && membership?.status !== "pending";
  const tier = active ? membership.tier : eligibility.tier;

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-violet-950">
          <Sparkles className="h-4 w-4 text-violet-700" aria-hidden="true" />
          Creator Boost
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A creator benefit programme, reviewed by the platform owner. It is separate from the blue verified identity badge.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {active && tier ? (
          <div className="rounded-lg border border-violet-200 bg-card px-3 py-3 text-sm text-navy-700">
            <p className="flex items-center gap-1 font-semibold text-violet-800"><BadgeCheck className="h-4 w-4" /> {CREATOR_BOOST_BENEFITS[tier].label}</p>
            <p className="mt-1">{CREATOR_BOOST_BENEFITS[tier].discountPercent}% off up to {CREATOR_BOOST_REQUIREMENTS.discountedBoostsPerMonth} boosts each month. Reassessment is due {new Date(membership.expiresAt!).toLocaleDateString()}.</p>
          </div>
        ) : membership?.status === "pending" ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Your application is waiting for the platform owner’s review.</p>
        ) : membership?.status === "rejected" ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Your last application was not approved.{membership.reviewNote ? ` ${membership.reviewNote}` : ""}</p>
        ) : null}

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p className="rounded-md bg-card px-3 py-2">Followers <strong className="float-right">{metric(eligibility.metrics.followers, CREATOR_BOOST_REQUIREMENTS.minFollowers)}</strong></p>
          <p className="rounded-md bg-card px-3 py-2">Public posts, 90 days <strong className="float-right">{metric(eligibility.metrics.publicPosts, CREATOR_BOOST_REQUIREMENTS.minPublicPosts)}</strong></p>
          <p className="rounded-md bg-card px-3 py-2">Short videos, 90 days <strong className="float-right">{metric(eligibility.metrics.shortVideos, CREATOR_BOOST_REQUIREMENTS.minShortVideos)}</strong></p>
          <p className="rounded-md bg-card px-3 py-2">Organic likes, latest 30 <strong className="float-right">{metric(eligibility.metrics.averageOrganicLikes, CREATOR_BOOST_REQUIREMENTS.minAverageOrganicLikes)}</strong></p>
        </div>
        {!eligibility.eligible && !active && (
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button onClick={() => void apply()} disabled={!canApply || busy}>
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
          {active ? "Creator Boost active" : membership?.status === "pending" ? "Application under review" : "Apply for Creator Boost"}
        </Button>
        <p className="text-xs text-muted-foreground">Discounts apply to organic engagement only; paid boost reactions are excluded from qualification and do not affect feed ranking or moderation.</p>
      </CardContent>
    </Card>
  );
}
