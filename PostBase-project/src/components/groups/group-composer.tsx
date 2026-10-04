"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Users } from "lucide-react";

interface GroupComposerProps {
  /** The group the post is published into. */
  groupId: string;
  /** The group's name, used in the label and the button's words. */
  groupName: string;
  /** Called after the post is saved, so the group's feed can pick it up. */
  onPosted: () => void | Promise<void>;
}

/**
 * "Post in <Group>", and the reason it has no audience picker.
 *
 * A group is not an audience a member chooses *about* a post; it is what
 * publishing in a group means. So this sends `groupId` and no `visibility` at
 * all, and the API sets the post's audience to the group's members — which is
 * the one answer that is ever true here. A picker would offer Public for a post
 * that has nowhere to be public: it is inside a group.
 *
 * The membership that lets a member post is checked again on the way in rather
 * than trusted from the fact that this form was on screen; the composer is not
 * the gate, the server is.
 */
export function GroupComposer({ groupId, groupName, onPosted }: GroupComposerProps) {
  // Generated, not written: a group's own id would collide if the composer were
  // ever mounted twice, and a duplicate id breaks `for` silently.
  const fieldId = useId();
  const [content, setContent] = useState("");
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
        body: JSON.stringify({ content: text, groupId }),
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
      <Label htmlFor={fieldId}>Post in {groupName}</Label>
      <Textarea
        id={fieldId}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={`Share something with ${groupName}...`}
        maxLength={2000}
        rows={3}
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* Said rather than chosen: the audience is a fact about where this is
            being published, so it is a sentence and not a control. */}
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          Members of {groupName} can see this
        </span>
        <span role="status" aria-live="polite" className="text-xs font-medium text-red-600">
          {error ?? ""}
        </span>
        <Button type="submit" size="sm" className="ml-auto" disabled={!content.trim() || posting}>
          {posting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          Post
        </Button>
      </div>
    </form>
  );
}
