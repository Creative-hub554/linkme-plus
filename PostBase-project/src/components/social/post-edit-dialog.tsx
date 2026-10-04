"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PostAudienceSelect } from "@/components/social/post-audience-select";
import { toPostAudience, type PostAudience } from "@/lib/post-audiences";

/** The two things an edit can change today. */
export interface PostEdit {
  content: string;
  visibility: PostAudience;
}

/**
 * Edits a published post's text and audience.
 *
 * Media is deliberately out of scope: a post's attachment is stored and served
 * as its own object, so swapping it is a different operation from rewriting the
 * words — this dialog only offers what `PUT /api/posts` already accepts.
 *
 * The dialog does not wait for the outcome. The page owns the request, removes
 * nothing optimistically on success and puts the post back on failure, so a
 * failed save is reported in that page's error banner while the author's text
 * is not silently kept as if it had been saved.
 */
export function PostEditDialog({
  postId,
  content,
  visibility,
  groupName,
  hasMedia = false,
  open,
  onOpenChange,
  onSave,
}: {
  postId: string;
  /** The post as it currently reads; the form starts from this every time. */
  content: string;
  visibility?: string | null;
  /**
   * The group the post was published into, if any. A group post's audience is
   * not the author's to move: it is what publishing in the group means. So this
   * form does not offer a picker for one — it states the audience the post
   * already has, and only the words can change. Offering Public beside it would
   * be a control whose one effect is to take a group's post out of the group.
   */
  groupName?: string | null;
  /** A post with an attachment may be left with no text at all. */
  hasMedia?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (postId: string, changes: PostEdit) => Promise<void>;
}) {
  const [draft, setDraft] = useState(content);
  const [audience, setAudience] = useState<PostAudience>(toPostAudience(visibility));
  const [saving, setSaving] = useState(false);

  // Seeded on open rather than on mount: the card stays mounted while the post
  // is edited, so a second edit — or an edit that was rolled back, or one that
  // arrived over realtime — must not open the form showing stale text.
  useEffect(() => {
    if (!open) return;
    setDraft(content);
    setAudience(toPostAudience(visibility));
  }, [open, content, visibility]);

  const trimmed = draft.trim();
  // A post that is only words must keep some words: saving nothing would leave
  // an empty card that the author could no longer reach to fix.
  const canSave = (trimmed.length > 0 || hasMedia) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // The group's audience is sent as itself rather than as whatever the form
      // happens to hold, which for a group post is also `group` — the point is
      // that no other value can reach this line from here.
      await onSave(postId, {
        content: trimmed,
        visibility: groupName ? "group" : audience,
      });
    } finally {
      setSaving(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Held shut while the request runs, exactly like the delete dialog: two
        // clicks would otherwise fire two edits off one form.
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
          <DialogDescription>
            Change what the post says or who can see it. Any photo or video stays as it is.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="sr-only" htmlFor={`edit-post-content-${postId}`}>
            Post text
          </label>
          <textarea
            id={`edit-post-content-${postId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            autoFocus
            className="w-full resize-none rounded-lg border border-surface-border bg-surface-light-blue p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Who can see this</span>
            {groupName ? (
              <span className="text-xs font-medium text-navy-700">
                Everyone in {groupName}
              </span>
            ) : (
              <PostAudienceSelect value={audience} onChange={setAudience} />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
