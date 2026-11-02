"use client";
import { useEffect, useState } from "react";
import { clientRequest, jsonBody } from "@/lib/client-request";
import { defaultFeedPreferences, feedTopics, parseFeedPreferences, type FeedPreferences } from "@/lib/feed-topics";
import { Button } from "@/components/ui/button";
export function FeedPreferencesSettings() {
  const [preferences, setPreferences] = useState<FeedPreferences>(defaultFeedPreferences);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    clientRequest<{ preferences: FeedPreferences }>("/api/feed-preferences", { signal: controller.signal })
      .then(result => { const parsed = parseFeedPreferences(result.preferences); if (!parsed) throw new Error("Invalid preferences response"); setPreferences(parsed); setReady(true); })
      .catch(() => { if (!controller.signal.aborted) setMessage("Unable to load feed preferences. Reload to retry."); });
    return () => controller.abort();
  }, []);
  async function save(value: FeedPreferences) {
    setBusy(true); setMessage("");
    try { await clientRequest("/api/feed-preferences", jsonBody(value, "PUT")); setPreferences(value); setMessage("Feed preferences saved. They apply to your entire home feed."); }
    catch { setMessage("Unable to save feed preferences. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="feed-preferences-title">
    <h2 id="feed-preferences-title" className="text-xl font-semibold">Feed preferences / ចំណូលចិត្តមាតិកា</h2>
    <p className="text-sm text-muted-foreground">Choose what appears in your home feed, including people you follow. Profiles and groups keep their own content.</p>
    <fieldset disabled={!ready || busy} className="space-y-2"><legend className="font-medium">Topics / ប្រភេទមាតិកា</legend>
      <label className="flex gap-2"><input type="checkbox" checked={preferences.topics.length === 0} onChange={() => setPreferences({ ...preferences, topics: [] })} />All topics / គ្រប់ប្រភេទ</label>
      {feedTopics.map(topic => <label key={topic.id} className="flex gap-2"><input type="checkbox" checked={preferences.topics.includes(topic.id)} onChange={event => setPreferences({ ...preferences, topics: event.target.checked ? [...preferences.topics, topic.id] : preferences.topics.filter(id => id !== topic.id) })} />{topic.en} / {topic.km}</label>)}
    </fieldset>
    <label className="block space-y-1"><span>Content format / ទម្រង់មាតិកា</span><select className="block w-full rounded border bg-background p-2" disabled={!ready || busy} value={preferences.format} onChange={event => setPreferences({ ...preferences, format: event.target.value as FeedPreferences["format"] })}><option value="all">Posts and Shorts</option><option value="posts">Posts only</option><option value="shorts">Shorts only</option></select></label>
    <p className="text-sm text-muted-foreground">Shorts publishing is being prepared. Shorts-only may currently have no matching content.</p>
    <div className="flex gap-3"><Button disabled={!ready || busy} onClick={() => void save(preferences)}>Save feed preferences</Button><Button variant="outline" disabled={!ready || busy} onClick={() => void save(defaultFeedPreferences)}>Reset feed preferences</Button></div>
    <p role="status" className="text-sm">{message}</p>
  </section>;
}
