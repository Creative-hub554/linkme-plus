"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOOST_DURATIONS, BOOST_GOALS, PAGE_ACTIONS, type CampaignStatus, type PageAction } from "@/lib/ads/boosts";
import { cn } from "@/lib/utils";
import { Loader2, Megaphone, Rocket } from "lucide-react";

/** One campaign as `GET /api/boosts` reports it. */
interface CampaignRow {
  id: string;
  status: CampaignStatus;
  postId: string;
  /** The post's opening words, carried by the list itself. */
  excerpt: string | null;
  goal: string | null;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  startDate: string | null;
  endDate: string | null;
}

/** One of the Page's posts, offered to be boosted. */
interface PagePost {
  id: string;
  content: string | null;
}

/** What each status reads as, for a reader who is not going to learn the enum. */
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_payment: "Awaiting payment",
  pending_review: "In review",
  approved: "Approved",
  scheduled: "Scheduled",
  active: "Running",
  paused: "Paused",
  rejected: "Rejected",
  completed: "Finished",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** A goal as a reader says it. */
const GOAL_LABEL: Record<string, string> = {
  reach: "Reach more people",
  engagement: "More reactions and comments",
  website_visits: "Visits to a website",
  marketplace_visits: "Visits to the marketplace",
  job_applications: "Job applications",
};

/** How each page-admin action reads on a button. */
const ACTION_LABEL: Record<PageAction, string> = {
  pay: "Authorise payment",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
};

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  return (await response.json()) as T;
}

/**
 * Everything a Page administrator does with a boost, in one place.
 *
 * The list is the campaign report the PRD asks for — spend, impressions,
 * clicks, the campaign's own dates — and the buttons on each row are not
 * hard-coded: they are read off the same ladder `@/api/boosts` enforces, so a
 * button can never offer an action the route would refuse. Approval is
 * conspicuously absent, and the copy under a campaign in review says why: the
 * platform clears that, not the advertiser.
 *
 * The dialog is the booking itself — the post, the goal, the length, the
 * budget, the targeting — and it does not end at "created". A boost is booked
 * before it is paid for, so the dialog's second step is the authorisation,
 * which is the moment the campaign enters the review queue.
 */
export function BoostManager({ pageId }: { pageId: string }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [posts, setPosts] = useState<PagePost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [postId, setPostId] = useState<string>("");
  const [goal, setGoal] = useState<string>("reach");
  const [durationDays, setDurationDays] = useState<number>(7);
  const [budget, setBudget] = useState<string>("50");
  const [targetLocation, setTargetLocation] = useState("");
  const [interests, setInterests] = useState("");
  const [booked, setBooked] = useState<{ id: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/boosts?pageId=${encodeURIComponent(pageId)}`, {
      cache: "no-store",
    });
    const payload = await readJson<{ campaigns: CampaignRow[] }>(response);
    setCampaigns(payload?.campaigns ?? []);
    setLoaded(true);
  }, [pageId]);

  // The posts are read when the dialog is opened rather than on mount: an
  // administrator scanning their campaigns has not asked for a list of posts,
  // and a second request fired at every Page view is a second thing to wait
  // for on a page that has nothing to do with boosting.
  const loadPosts = useCallback(async () => {
    const response = await fetch(`/api/posts?pageId=${encodeURIComponent(pageId)}&limit=10`, {
      cache: "no-store",
    });
    const payload = await readJson<{ data: PagePost[] } | PagePost[]>(response);
    setPosts(Array.isArray(payload) ? payload : (payload?.data ?? []));
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (campaignId: string, action: PageAction) => {
    setBusy(campaignId);
    setError(null);
    const response = await fetch("/api/boosts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, action }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That action could not be taken");
      return;
    }
    await load();
  };

  const book = async () => {
    setBusy("book");
    setError(null);
    const response = await fetch("/api/posts/boost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postId,
        budget: Number(budget),
        durationDays,
        goal,
        targetLocation: targetLocation.trim() || null,
        interests: interests
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    });
    const payload = await readJson<{ campaign?: { id: string }; error?: string }>(response);
    setBusy(null);
    if (!response.ok || !payload?.campaign) {
      setError(payload?.error ?? "This boost could not be booked");
      return;
    }
    setBooked({ id: payload.campaign.id });
  };

  const reset = () => {
    setBooked(null);
    setError(null);
    setPostId("");
    setInterests("");
    setTargetLocation("");
  };

  return (
    <Card className="border-surface-border/90">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 text-brand-blue" aria-hidden="true" />
            Boosted posts
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Pay to place a post in front of people beyond your followers. Every boost is labelled
            Sponsored, and a platform administrator approves it before it runs.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) void loadPosts();
            if (!next) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Rocket className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Boost a post
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{booked ? "Authorise this boost" : "Boost a post"}</DialogTitle>
              <DialogDescription>
                {booked
                  ? "The campaign is booked. Payment is what puts it in the review queue."
                  : "Choose a published post, then what the boost is for and what it may spend."}
              </DialogDescription>
            </DialogHeader>

            {booked ? (
              <div className="space-y-4">
                <p className="text-sm text-navy-700">
                  Once authorised, a platform administrator reviews the campaign — usually the same
                  day — and it runs for the length you booked.
                </p>
                {error && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                <Button className="w-full" onClick={() => void runAction(booked.id, "pay")} disabled={busy !== null}>
                  {busy === booked.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Authorise payment
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void book();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="boost-post">Post</Label>
                  <select
                    id="boost-post"
                    value={postId}
                    onChange={(event) => setPostId(event.target.value)}
                    required
                    className="h-10 w-full rounded-lg border border-surface-border bg-card px-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                  >
                    <option value="">Choose a post</option>
                    {posts.map((post) => (
                      <option key={post.id} value={post.id}>
                        {(post.content ?? "Untitled post").slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="boost-goal">Goal</Label>
                  <select
                    id="boost-goal"
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    className="h-10 w-full rounded-lg border border-surface-border bg-card px-3 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                  >
                    {BOOST_GOALS.map((option) => (
                      <option key={option} value={option}>
                        {GOAL_LABEL[option]}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-navy-700">Length</legend>
                  <div className="flex gap-2">
                    {BOOST_DURATIONS.map((days) => (
                      <label
                        key={days}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                          durationDays === days
                            ? "border-brand-blue bg-brand-blue/5 text-brand-blue"
                            : "border-surface-border text-navy-700",
                        )}
                      >
                        <input
                          type="radio"
                          name="boost-duration"
                          value={days}
                          checked={durationDays === days}
                          onChange={() => setDurationDays(days)}
                          className="sr-only"
                        />
                        {days} days
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="boost-budget">Budget</Label>
                    <Input
                      id="boost-budget"
                      type="number"
                      min={5}
                      max={5000}
                      value={budget}
                      onChange={(event) => setBudget(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="boost-location">Location (optional)</Label>
                    <Input
                      id="boost-location"
                      value={targetLocation}
                      onChange={(event) => setTargetLocation(event.target.value)}
                      placeholder="Lisbon"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="boost-interests">Interests (optional)</Label>
                  <Input
                    id="boost-interests"
                    value={interests}
                    onChange={(event) => setInterests(event.target.value)}
                    placeholder="design, gardening"
                  />
                  <p className="text-xs text-muted-foreground">Comma separated, up to five.</p>
                </div>

                {error && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={busy !== null || postId === ""}>
                  {busy === "book" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Book this boost
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No boosts yet. A boost starts with the post, and ends with a report.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-800">
                    <Link href={`/feed#post-${campaign.postId}`} className="hover:underline">
                      {(campaign.excerpt ?? "Boosted post").slice(0, 60)}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-navy-700">{STATUS_LABEL[campaign.status] ?? campaign.status}</span>
                    {campaign.goal ? ` · ${GOAL_LABEL[campaign.goal] ?? campaign.goal}` : ""} ·{" "}
                    {campaign.impressions.toLocaleString()} impressions · {campaign.clicks.toLocaleString()} clicks ·{" "}
                    {campaign.spent} of {campaign.budget}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(Object.keys(PAGE_ACTIONS) as PageAction[])
                    .filter((action) => PAGE_ACTIONS[action].from.includes(campaign.status))
                    .map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={action === "cancel" ? "ghost" : "outline"}
                        disabled={busy === campaign.id}
                        onClick={() => void runAction(campaign.id, action)}
                      >
                        {ACTION_LABEL[action]}
                      </Button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && !open && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
