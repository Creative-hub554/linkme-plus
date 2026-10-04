"use client";

import { useEffect, useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImageIcon, VideoIcon, SmileIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PostAudienceSelect } from "@/components/social/post-audience-select";
import type { PostAudience } from "@/lib/post-audiences";

export type ComposerFocusTarget = "inside" | "outside" | "off-document";

/**
 * Whether an empty composer collapses now that focus has moved.
 *
 * Lifted out of the component because it is the whole rule, and it has been
 * wrong twice. Collapsing on submit hid the toolbar the Post button lives in:
 * a textarea that already has focus fires no further `focus` event, so nothing
 * ever re-expanded it. Collapsing on blur while the audience picker was open
 * closed the composer the moment the menu took focus — the menu renders in a
 * portal, so focus moving onto an option looked exactly like leaving — which
 * left the audience impossible to change until something had been typed.
 */
export function shouldCollapseComposer({
  focusTarget,
  ownsOpenPopover,
  hasDraft,
}: {
  /** Where focus went: still in the composer, out of it, or off the document. */
  focusTarget: ComposerFocusTarget;
  /** The composer's own picker has a menu open, in a portal it does not contain. */
  ownsOpenPopover: boolean;
  /** Text or an attachment in the box. */
  hasDraft: boolean;
}): boolean {
  // Off the document is not leaving: an opened file dialog is the usual cause,
  // and collapsing would hide the toolbar the dialog was opened from.
  if (focusTarget !== "outside") return false;
  // Focus is on an option in the composer's own menu, which lives in a portal.
  if (ownsOpenPopover) return false;
  return !hasDraft;
}

interface PostComposerProps {
  user?: {
    name?: string | null;
    image?: string | null;
  };
  onSubmit?: (content: string, image?: File, audience?: PostAudience) => void;
  /** Text to restore into the composer, e.g. after a failed publish. */
  draft?: string | null;
  /** Called once the restored draft has been placed in the textarea. */
  onDraftUsed?: () => void;
}

export function PostComposer({ user, onSubmit, draft, onDraftUsed }: PostComposerProps) {
  const [content, setContent] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [audience, setAudience] = useState<PostAudience>("public");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // A ref, not state: it has to be current inside the blur handler that fires
  // moments after the menu opens, before any re-render.
  const ownsOpenPopover = useRef(false);
  const hasDraft = Boolean(content.trim() || image);

  // Restore a draft the page hands back after a failed publish so the author
  // does not lose what they wrote.
  useEffect(() => {
    if (!draft) return;
    setContent(draft);
    setIsExpanded(true);
    onDraftUsed?.();
  }, [draft, onDraftUsed]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = () => {
    if (!content.trim() && !image) return;
    onSubmit?.(content, image ?? undefined, audience);
    setContent("");
    setImage(null);
    setImagePreview(null);
  };

  /**
   * Collapse an empty composer only once focus has left it entirely.
   *
   * Collapsing on submit instead left the composer unusable: the textarea keeps
   * focus after posting, and a textarea that is already focused fires no further
   * `focus` event, so the toolbar — including the Post button — never came back
   * until the author clicked somewhere else first.
   */
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    const focusTarget: ComposerFocusTarget = !next
      ? "off-document"
      : composerRef.current?.contains(next)
        ? "inside"
        : "outside";
    if (shouldCollapseComposer({ focusTarget, ownsOpenPopover: ownsOpenPopover.current, hasDraft })) {
      setIsExpanded(false);
    }
  };

  /**
   * The toolbar's picker has opened or closed its menu.
   *
   * Opening moves focus into a portal this element does not contain, which is
   * the one case where the composer must not read focus leaving as the author
   * leaving. Closing it needs the look at the next frame, below.
   */
  const handleToolbarPopoverOpenChange = (open: boolean) => {
    ownsOpenPopover.current = open;
    if (open) return;

    // Closing hands focus to nobody when the option was picked with the mouse,
    // which left the author looking at an empty composer with their choice
    // hidden in a toolbar that had gone. Put focus back in the box they were
    // writing in. A click somewhere else still wins: the browser moves focus to
    // what was clicked after this runs, and the check on the next frame decides
    // from where focus actually ended up.
    textareaRef.current?.focus();
    requestAnimationFrame(() => {
      const focusTarget: ComposerFocusTarget = composerRef.current?.contains(
        document.activeElement,
      )
        ? "inside"
        : "outside";
      if (shouldCollapseComposer({ focusTarget, ownsOpenPopover: ownsOpenPopover.current, hasDraft })) {
        setIsExpanded(false);
      }
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div ref={composerRef} className="flex items-start gap-3" onBlur={handleBlur}>
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.image ?? undefined} />
            <AvatarFallback>{user?.name?.[0] || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              placeholder="What's on your mind?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onFocus={() => setIsExpanded(true)}
              className="w-full resize-none rounded-lg border border-surface-border bg-surface-light-blue p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue min-h-[40px]"
              rows={isExpanded ? 3 : 1}
            />
            {imagePreview && (
              <div className="relative mt-2 inline-block">
                <img src={imagePreview} alt="" className="max-h-48 rounded-lg object-cover" />
                <button
                  onClick={() => { setImage(null); setImagePreview(null); }}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                  aria-label="Remove selected image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {isExpanded && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
                <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <ImageIcon className="h-4 w-4 mr-1" />
                  Photo
                </Button>
                <Button variant="ghost" size="sm">
                  <VideoIcon className="h-4 w-4 mr-1" />
                  Video
                </Button>
                <Button variant="ghost" size="sm">
                  <SmileIcon className="h-4 w-4 mr-1" />
                  Feeling
                </Button>
                <PostAudienceSelect
                  value={audience}
                  onChange={setAudience}
                  onOpenChange={handleToolbarPopoverOpenChange}
                  compact
                />
                <Button
                  size="sm"
                  className={cn("ml-auto")}
                  onClick={handleSubmit}
                  disabled={!content.trim() && !image}
                >
                  Post
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
