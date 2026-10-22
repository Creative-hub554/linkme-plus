"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Handshake, Headphones, Loader2, Pin, Sparkles, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface CreatorHubData {
  membership: { tier: string };
  analytics: { followers: number; postsLast30Days: number; likesLast30Days: number };
  spotlightPostId: string | null;
  recentPosts: { id: string; content: string | null; createdAt: string }[];
  scheduledPosts: { id: string; content: string; scheduledFor: string; status: string; failureReason: string | null }[];
  communities: { id: string; groupId: string; name: string; visibility: string }[];
  collaborations: { id: string; postId: string; status: string; collaborator: string }[];
  incomingCollaborations: { id: string; postId: string; creator: string }[];
  supportTickets: { id: string; subject: string; status: string; createdAt: string }[];
}

async function responseBody(response: Response) {
  return (await response.json().catch(() => null)) as { error?: string } | null;
}

/** Creator-only operations. All eligibility and writes are enforced by its API. */
export function CreatorHub() {
  const [data, setData] = useState<CreatorHubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleContent, setScheduleContent] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [communityName, setCommunityName] = useState("");
  const [collaborator, setCollaborator] = useState("");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/creator-hub", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as CreatorHubData | { error?: string } | null;
      if (!response.ok || !body || !("analytics" in body)) throw new Error((body as { error?: string } | null)?.error ?? "Creator Hub could not be loaded.");
      setData(body);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Creator Hub could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, payload: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/creator-hub", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(body?.error ?? "That Creator Hub action could not be completed.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "That Creator Hub action could not be completed.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading Creator Hub…</p>;
  if (!data) return <p role="alert" className="text-sm text-red-700">{error ?? "Creator Hub is unavailable."}</p>;

  return (
    <section aria-label="Creator Hub" className="space-y-4">
      <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-700" aria-hidden="true" /><div><h2 className="font-semibold text-navy-800">Creator Hub</h2><p className="text-sm text-muted-foreground">{data.membership.tier} Creator Boost tools</p></div></div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        {[{ label: "Followers", value: data.analytics.followers }, { label: "Posts, 30 days", value: data.analytics.postsLast30Days }, { label: "Organic likes, 30 days", value: data.analytics.likesLast30Days }].map((metric) => <Card key={metric.label}><CardContent className="p-4"><p className="text-xl font-bold text-navy-800">{metric.value.toLocaleString()}</p><p className="text-xs text-muted-foreground">{metric.label}</p></CardContent></Card>)}
      </div>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Pin className="h-4 w-4 text-violet-700" />Profile spotlight</CardTitle><p className="text-sm text-muted-foreground">Highlight one public post on your profile without changing feed ranking.</p></CardHeader><CardContent className="space-y-2">{data.recentPosts.length === 0 ? <p className="text-sm text-muted-foreground">Publish a public post first.</p> : data.recentPosts.map((post) => <div key={post.id} className="flex items-center justify-between gap-3 rounded-md border border-surface-border p-2"><p className="min-w-0 truncate text-sm">{post.content ?? "Media post"}</p><Button size="sm" variant={data.spotlightPostId === post.id ? "secondary" : "outline"} disabled={busy !== null} onClick={() => void act(`spotlight-${post.id}`, { action: "spotlight", postId: post.id })}>{data.spotlightPostId === post.id ? "Spotlighted" : "Spotlight"}</Button></div>)}</CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-violet-700" />Schedule a post</CardTitle><p className="text-sm text-muted-foreground">Save a text draft or publish automatically within five minutes of the selected time.</p></CardHeader><CardContent className="space-y-3"><Textarea id="creator-schedule-content" value={scheduleContent} onChange={(event) => setScheduleContent(event.target.value)} placeholder="Write your post…" rows={3} /><Input id="creator-schedule-time" type="datetime-local" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy !== null || !scheduleContent.trim()} onClick={() => void act("draft", { action: "saveDraft", content: scheduleContent }).then(() => setScheduleContent(""))}>Save draft</Button><Button disabled={busy !== null || !scheduleContent.trim() || !scheduleTime} onClick={() => void act("schedule", { action: "schedule", content: scheduleContent, scheduledFor: new Date(scheduleTime).toISOString() }).then(() => { setScheduleContent(""); setScheduleTime(""); })}>{busy === "schedule" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Schedule post</Button></div>{data.scheduledPosts.length > 0 && <ul className="space-y-2">{data.scheduledPosts.map((post) => <li key={post.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{post.content} · {post.status}{post.status === "draft" ? "" : ` · ${new Date(post.scheduledFor).toLocaleString()}`}</span>{post.status === "scheduled" && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`cancel-${post.id}`, { action: "cancelSchedule", id: post.id })}>Cancel</Button>}</li>)}</ul>}</CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="h-4 w-4 text-violet-700" />Creator community</CardTitle><p className="text-sm text-muted-foreground">Start an ordinary LinkMe+ Group that your community can join and participate in.</p></CardHeader><CardContent className="space-y-3"><Input id="creator-community-name" value={communityName} onChange={(event) => setCommunityName(event.target.value)} placeholder="Community name" /><Button disabled={busy !== null || !communityName.trim()} onClick={() => void act("community", { action: "community", name: communityName }).then(() => setCommunityName(""))}>Create community</Button>{data.communities.map((community) => <Link key={community.id} href={`/groups/${community.groupId}`} className="block text-sm text-brand-blue underline">{community.name} · {community.visibility}</Link>)}</CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Handshake className="h-4 w-4 text-violet-700" />Collaborations</CardTitle><p className="text-sm text-muted-foreground">Invite another Creator Boost member to co-author a post. Invites never grant account or publishing access.</p></CardHeader><CardContent className="space-y-3"><Input id="creator-collaborator" value={collaborator} onChange={(event) => setCollaborator(event.target.value)} placeholder="Collaborator username" />{data.recentPosts.map((post) => <Button key={post.id} size="sm" variant="outline" disabled={busy !== null || !collaborator.trim()} onClick={() => void act(`invite-${post.id}`, { action: "collaborate", postId: post.id, username: collaborator })}>Invite for “{(post.content ?? "Media post").slice(0, 24)}”</Button>)}{data.incomingCollaborations.map((invite) => <div key={invite.id} className="flex flex-wrap items-center gap-2 text-sm">@{invite.creator} invited you to collaborate. <Button size="sm" onClick={() => void act(`accept-${invite.id}`, { action: "respondCollaboration", id: invite.id, decision: "accepted" })}>Accept</Button><Button size="sm" variant="ghost" onClick={() => void act(`decline-${invite.id}`, { action: "respondCollaboration", id: invite.id, decision: "declined" })}>Decline</Button></div>)}</CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Headphones className="h-4 w-4 text-violet-700" />Priority support</CardTitle><p className="text-sm text-muted-foreground">Creator Boost requests are shown first to platform owners. Moderation and safety reports follow their normal process.</p></CardHeader><CardContent className="space-y-3"><Input id="creator-support-subject" value={supportSubject} onChange={(event) => setSupportSubject(event.target.value)} placeholder="What do you need help with?" /><Textarea id="creator-support-message" value={supportMessage} onChange={(event) => setSupportMessage(event.target.value)} placeholder="Tell us what happened…" rows={3} /><Button disabled={busy !== null || !supportSubject.trim() || !supportMessage.trim()} onClick={() => void act("support", { action: "support", subject: supportSubject, message: supportMessage }).then(() => { setSupportSubject(""); setSupportMessage(""); })}>Send priority request</Button>{data.supportTickets.map((ticket) => <p key={ticket.id} className="text-sm text-muted-foreground">{ticket.subject} · {ticket.status}</p>)}</CardContent></Card>
    </section>
  );
}
