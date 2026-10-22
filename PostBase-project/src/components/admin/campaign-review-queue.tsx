"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "lucide-react";

/** One campaign waiting for a decision, as `GET /api/admin/campaigns` reports it. */
interface QueuedCampaign {
  id: string;
  budget: number;
  priorityReview: boolean;
  goal: string | null;
  excerpt: string | null;
  pageName: string;
  pageUsername: string;
  advertiser: string;
  startDate: string | null;
  endDate: string | null;
}

/**
 * The queue a platform administrator clears before any boost runs.
 *
 * Approval is the only thing that starts delivery, and it is reachable only
 * here: an advertiser may book and pay for a boost from their Page, and a
 * platform administrator — never the same person in the same click — decides.
 * A refusal takes a reason, because it is sent back to whoever paid for the
 * campaign, and the route keeps it beside the decision.
 */
export function CampaignReviewQueue() {
  const [campaigns, setCampaigns] = useState<QueuedCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/campaigns", { cache: "no-store" });
    if (!response.ok) {
      setError("The review queue could not be loaded");
      setLoaded(true);
      return;
    }
    const payload = (await response.json()) as { campaigns: QueuedCampaign[] };
    setCampaigns(payload.campaigns ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (campaignId: string, action: "approve" | "reject") => {
    setBusy(campaignId);
    setError(null);
    const response = await fetch("/api/admin/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, action, reason: reason.trim() || undefined }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That decision could not be recorded");
      return;
    }
    setRejecting(null);
    setReason("");
    await load();
  };

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading campaigns…</p>;

  if (campaigns.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        No campaigns are waiting for a decision.
      </p>
    );
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="divide-y divide-surface-border">
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy-800">
                  {campaign.pageName} <span className="text-muted-foreground">@{campaign.pageUsername}</span>
                  {campaign.priorityReview && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">Creator priority</span>}
                </p>
                <p className="mt-0.5 text-sm text-navy-700">{campaign.excerpt ?? "Boosted post"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Booked by @{campaign.advertiser} · budget {campaign.budget} ·{" "}
                  {campaign.startDate && campaign.endDate
                    ? `${new Date(campaign.startDate).toLocaleDateString()} to ${new Date(campaign.endDate).toLocaleDateString()}`
                    : "dates pending"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy === campaign.id}
                  onClick={() => void decide(campaign.id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === campaign.id}
                  onClick={() => setRejecting(rejecting === campaign.id ? null : campaign.id)}
                >
                  Reject
                </Button>
              </div>
            </div>
            {rejecting === campaign.id && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`reject-${campaign.id}`}>
                  Why this campaign is refused
                </label>
                <Input
                  id={`reject-${campaign.id}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why this campaign is refused"
                  className="h-9 max-w-sm flex-1"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === campaign.id || reason.trim() === ""}
                  onClick={() => void decide(campaign.id, "reject")}
                >
                  Confirm rejection
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
