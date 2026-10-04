"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PostAudienceSelect } from "@/components/social/post-audience-select";
import type { PostAudience } from "@/lib/post-audiences";
import { Loader2, Send } from "lucide-react";

interface PageComposerProps {
  /** The Page the post is published as. */
  pageId: string;
  /** The Page's name, used in the label and the button's words. */
  pageName: string;
  /** Called after the post is saved, so the Page's feed can pick it up. */
  onPosted: () => void | Promise<void>;
}

/**
 * "Post as <Page>", and the reason it is its own composer rather than a mode on
 * the feed's.
 *
 * The feed's composer is about the person typing; this one is about the Page
 * speaking, and the difference is not a flag — it is a different endpoint body
 * (`pageId`), an audience chosen for the Page rather than for the typist, and a
 * different promise about whose words they are. The Page is named on the field,
 * on the button and in the audience picker, so that nobody can publish as a Page
 * by accident and no reader is told the wrong people can see it; the API checks
 * the admin role again on the way in rather than trusting this form to have been
 * shown only to admins.
 */
export function PageComposer({ pageId, pageName, onPosted }: PageComposerProps) {
  // Generated, not written: a Page's own id would collide if the composer were
  // ever mounted twice, and a duplicate id breaks `for` silently.
  const fieldId = useId();
  const [content, setContent] = useState("");
  /**
   * Chosen here, and starting at `public`: a Page is a public account, so the
   * audience a reader expects from it is the one it gets if nobody picks. Held
   * in this component rather than persisted, which is what the feed's composer
   * does too — but, like that one, the choice stays put from one post to the
   * next while the composer is mounted, because silently resetting an explicit
   * choice is worse than keeping it. Every audience is offered, because the
   * server rule enforces all three for a Page's post: `followers` is the Page's
   * own followers, and `private` is the single admin who wrote it.
   */
  const [audience, setAudience] = useState<PostAudience>("public");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    const text = content.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, pageId, visibility: audience }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not publish");
      setContent("");
      await onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish");
    } finally {
      setPosting(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void publish();
      }}
    >
      <Label htmlFor={fieldId}>Post as {pageName}</Label>
      <Textarea
        id={fieldId}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={`Share something as ${pageName}...`}
        maxLength={2000}
        rows={3}
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* The same control the feed and the profile use, told that a Page is
            speaking so its `followers` copy names the Page rather than "you". */}
        <PostAudienceSelect
          value={audience}
          onChange={setAudience}
          compact
          asPage={pageName}
        />
        <span role="status" aria-live="polite" className="text-xs font-medium text-red-600">
          {error ?? ""}
        </span>
        <Button type="submit" size="sm" className="ml-auto" disabled={!content.trim() || posting}>
          {posting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          Publish as {pageName}
        </Button>
      </div>
    </form>
  );
}
