"use client";

import { useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PostEditDialog, type PostEdit } from "@/components/social/post-edit-dialog";

/**
 * The three-dot menu for a post the reader may change — their own.
 *
 * Anyone else's post keeps `ReportPostDialog`, which brings its own identical
 * trigger, so the card shows exactly one control either way.
 *
 * Deleting asks for confirmation because it cannot be undone: the page removes
 * the card the moment the request leaves, so a stray click on a menu item would
 * otherwise destroy a post with no chance to stop it. The dialog does not wait
 * around for the outcome — the page owns that, and a failure restores the card
 * and reports it in the feed's own error banner.
 *
 * Editing works the same way: the form is seeded from the post on the card, the
 * page applies the change optimistically, and a failed save is rolled back and
 * reported in that page's banner. Both items are optional so the menu can be
 * used where only one of the two is allowed.
 */
export function PostOptionsMenu({
  postId,
  content,
  visibility,
  groupName,
  hasMedia,
  onDelete,
  onUpdate,
}: {
  postId: string;
  /** The post's current text, used to seed the edit form. */
  content: string;
  visibility?: string | null;
  /**
   * The group the post belongs to, when it belongs to one. Passed through to the
   * edit form, which cannot offer a group post an audience: it has one.
   */
  groupName?: string | null;
  /** Whether the post has a photo or video, which lets its text be cleared. */
  hasMedia?: boolean;
  /** Removes the post optimistically; resolves once the request has settled. */
  onDelete: (postId: string) => Promise<void>;
  /** Saves an edit; resolves once the request has settled. */
  onUpdate?: (postId: string, changes: PostEdit) => Promise<void>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(postId);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="More post options"
            className="h-9 w-9 shrink-0"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onUpdate && (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit post
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => setConfirmOpen(true)}
            className="text-destructive focus:bg-red-50 focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete post
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {onUpdate && (
        <PostEditDialog
          postId={postId}
          content={content}
          visibility={visibility}
          groupName={groupName}
          hasMedia={hasMedia}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={onUpdate}
        />
      )}

      {/* Leaving the dialog open while the request runs would let a second
          click delete a post that is already going, so every control is held
          until it settles. */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(nextOpen) => {
          if (!deleting) setConfirmOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. Any photo or video in the post is removed with it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
