"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, MessageCircle, Share2, Bookmark, Play, SmilePlus, Send, Loader2 } from "lucide-react";
import { AudienceIcon } from "@/components/social/audience-icon";
import { IconButton } from "@/components/ui/icon-button";
import { audienceLabel, isPostAudience } from "@/lib/post-audiences";
import { cn } from "@/lib/utils";
import { ReportPostDialog } from "@/components/social/report-post-dialog";
import { PostOptionsMenu } from "@/components/social/post-options-menu";
import type { PostEdit } from "@/components/social/post-edit-dialog";

interface Author {
  name: string;
  username: string;
  avatar?: string;
}

interface CommentItem {
  id: string;
  content: string;
  createdAt?: string;
  author?: { name?: string | null; username?: string | null; avatarUrl?: string | null };
}

/** Live activity the feed pushed for this post. */
export interface PostActivity {
  /** Monotonic per post, so a repeat event is still observable. */
  seq: number;
  /** Comment just published somewhere on the platform, if any. */
  commentAddedId?: string | null;
  /** Comment just removed (deleted), if any. */
  commentRemovedId?: string | null;
}

interface PostCardProps {
  id: string;
  author: Author;
  content: string;
  image?: string;
  mediaType?: string;
  time: string;
  likes: number;
  comments: number;
  shares: number;
  liked?: boolean;
  saved?: boolean;
  visibility?: "public" | "followers" | "private" | string | null;
  /**
   * The group a post was published into, when it was published into one. A
   * group post reaches a feed because the reader is in that group, and without
   * this the card gives no sign of why it is there.
   */
  groupName?: string | null;
  /** Optimistic post that is still being published; interactions are disabled. */
  pending?: boolean;
  /** Live comment/reaction activity for this post, pushed over Realtime. */
  activity?: PostActivity;
  /**
   * Set only for the reader's own posts. Its presence is what turns the card's
   * menu into delete instead of report — the page decides, because it is the
   * one that knows who is signed in and owns the list the card lives in.
   */
  onDelete?: (postId: string) => Promise<void>;
  /**
   * Set only for the reader's own posts, alongside `onDelete`. Lets the menu
   * change the post's text or audience instead of only removing it.
   */
  onUpdate?: (postId: string, changes: PostEdit) => Promise<void>;
  /** The post has been edited since it was published; shown beside its time. */
  edited?: boolean;
}

/**
 * Reconciles an optimistic counter with the authoritative count the feed pushes
 * down.
 *
 * Live updates carry absolute totals, so assigning the prop straight into state
 * either fights the optimistic bump or double-counts it, depending on which
 * arrives first. Tracking the pending local delta means both orders converge on
 * the same number.
 */
function useReconciledCount(authoritative: number) {
  const [value, setValue] = useState(authoritative);
  const authoritativeRef = useRef(authoritative);
  const pendingRef = useRef(0);

  useEffect(() => {
    const previous = authoritativeRef.current;
    authoritativeRef.current = authoritative;
    // Once the server's own total reflects the local change, there is nothing
    // left to reconcile.
    if (authoritative >= previous + pendingRef.current) pendingRef.current = 0;
    setValue(Math.max(0, authoritative + pendingRef.current));
  }, [authoritative]);

  const bump = useCallback((delta: number) => {
    pendingRef.current += delta;
    setValue((current) => Math.max(0, current + delta));
  }, []);

  return [value, bump] as const;
}

const stickers = ["❤️", "😂", "🔥", "👏", "🎉", "😍"];

export function PostCard({ id, author, content, image, mediaType, time, likes: initialLikes, comments: initialComments, shares, liked: initialLiked = false, saved: initialSaved = false, visibility, groupName, pending = false, activity, onDelete, onUpdate, edited = false }: PostCardProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [reaction, setReaction] = useState<string | null>(initialLiked ? "like" : null);
  const [saved, setSaved] = useState(initialSaved);
  // Both counters follow one rule: the feed's number is authoritative, and an
  // optimistic local change is held until the authoritative number catches up.
  const [likes, bumpLikes] = useReconciledCount(initialLikes);
  const [commentCount, bumpComments] = useReconciledCount(initialComments);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentItems, setCommentItems] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reactionLoading, setReactionLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isVideo = mediaType?.toLowerCase().startsWith("video");

  /**
   * The action row's buttons carry no visible label, so each name is passed to
   * `IconButton`, which uses the one string for both the hint and the accessible
   * name. "Remove reaction" rather than "Remove reaction post", which is what
   * the two halves used to join into — it reads badly out loud, and now it is
   * read out twice.
   */
  const reactionLabel = reaction ? "Remove reaction" : "React to post";
  const commentLabel = "Comment on post";
  const shareLabel = "Share post";
  const bookmarkLabel = saved ? "Remove bookmark" : "Bookmark post";

  /** Resolves comments by id — the same shape the thread renders, authors included. */
  const fetchComments = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return [] as CommentItem[];
    try {
      const response = await fetch(`/api/posts/comments?ids=${encodeURIComponent(ids.join(","))}`);
      if (!response.ok) return [] as CommentItem[];
      const payload = await response.json().catch(() => null);
      return Array.isArray(payload?.data) ? (payload.data as CommentItem[]) : [];
    } catch {
      return [] as CommentItem[];
    }
  }, []);

  useEffect(() => {
    if (!commentsOpen || !id) return;
    let cancelled = false;
    const loadComments = async () => {
      setCommentsLoading(true);
      try {
        const response = await fetch(`/api/posts/comments?postId=${encodeURIComponent(id)}&limit=10`);
        const payload = await response.json();
        if (!cancelled && response.ok) setCommentItems(payload.data || []);
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    };
    void loadComments();
    return () => { cancelled = true; };
  }, [commentsOpen, id]);

  // Live activity for this post. The counts arrive through props; what is left
  // here is the thread: a comment that should appear in it, or one that left.
  const lastActivitySeqRef = useRef(0);
  // Read through a ref so the effect does not restart — and abandon an in-flight
  // lookup — every time the thread is opened or closed.
  const commentsOpenRef = useRef(commentsOpen);
  useEffect(() => {
    commentsOpenRef.current = commentsOpen;
  }, [commentsOpen]);

  useEffect(() => {
    if (!activity || activity.seq === lastActivitySeqRef.current) return;
    lastActivitySeqRef.current = activity.seq;

    if (activity.commentRemovedId) {
      const removedId = activity.commentRemovedId;
      setCommentItems((items) => items.filter((item) => item.id !== removedId));
    }

    const addedId = activity.commentAddedId;
    // A closed thread needs no body: the next time it opens it loads current.
    if (!addedId || !commentsOpenRef.current) return;

    const load = async (attempt: number) => {
      const [comment] = await fetchComments([addedId]);
      if (!comment) {
        // The trigger broadcasts as the row is written, which can be a beat
        // ahead of it being readable; one retry covers that window.
        if (attempt === 0) window.setTimeout(() => void load(1), 600);
        return;
      }
      setCommentItems((items) => {
        if (items.some((item) => item.id === comment.id)) return items;
        // Two comments arriving together resolve in whatever order their lookups
        // finish, so the thread is ordered rather than prepended blindly.
        return [comment, ...items].sort((left, right) =>
          String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
        );
      });
    };
    // Deliberately not cancelled when the next event arrives: a second comment
    // must not discard the first one's in-flight lookup.
    void load(0);
  }, [activity, fetchComments]);

  const updateReaction = async (type: string) => {
    if (reactionLoading || pending) return;
    const wasActive = reaction === type;
    const previousReaction = reaction;
    const previousLiked = liked;
    // One reaction per person: adding one moves the count, swapping its type
    // does not, and removing yours takes one back.
    const delta = wasActive ? -1 : previousReaction ? 0 : 1;
    setReaction(wasActive ? null : type);
    setLiked(!wasActive && type === "like");
    bumpLikes(delta);
    setStickerOpen(false);
    setReactionLoading(true);
    try {
      const response = await fetch("/api/posts/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "post", targetId: id, type }),
      });
      if (!response.ok) throw new Error("Reaction failed");
      const payload = await response.json();
      const nextReaction = payload.type ?? null;
      setReaction(nextReaction);
      setLiked(nextReaction === "like");
    } catch {
      setReaction(previousReaction);
      setLiked(previousLiked);
      bumpLikes(-delta);
      setNotice("Reaction could not be saved.");
      window.setTimeout(() => setNotice(null), 2200);
    } finally {
      setReactionLoading(false);
    }
  };

  const submitComment = async () => {
    const content = commentText.trim();
    if (!content || submitting || pending) return;
    setSubmitting(true);
    // Counted before the request: our own comment is broadcast back to us as an
    // absolute total, and bumping first is what keeps that from double-counting.
    bumpComments(1);
    try {
      const response = await fetch("/api/posts/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: id, content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Comment failed");
      const created = payload.comment;
      setCommentItems((items) => [created, ...items]);
      setCommentText("");
      // The insert response is the raw row, so resolve the author before it can
      // render as an anonymous "Member".
      const [hydrated] = await fetchComments([created?.id].filter(Boolean));
      if (hydrated) {
        setCommentItems((items) =>
          items.map((item) => (item.id === hydrated.id ? hydrated : item)),
        );
      }
    } catch {
      bumpComments(-1);
      setNotice("Comment could not be posted.");
      window.setTimeout(() => setNotice(null), 2200);
    } finally {
      setSubmitting(false);
    }
  };

  const sharePost = async () => {
    const url = `${window.location.origin}/feed#post-${id}`;
    try {
      const canShare = typeof navigator.share === "function";
      if (canShare) await navigator.share({ title: `Post by ${author.name}`, url });
      else await navigator.clipboard.writeText(url);
      setNotice(canShare ? "Shared post." : "Post link copied.");
    } catch {
      // A cancelled native share is not an error to surface.
    }
    window.setTimeout(() => setNotice(null), 1800);
  };

  return (
    <Card
      id={`post-${id}`}
      aria-busy={pending || undefined}
      className={cn("overflow-visible border-surface-border/90 shadow-sm transition-shadow", pending ? "opacity-70" : "hover:shadow-md")}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0 ring-2 ring-brand-blue/10">
            <AvatarImage src={author.avatar} alt={`${author.name}'s profile picture`} />
            <AvatarFallback className="bg-brand-blue/10 font-semibold text-brand-blue">{author.name[0]}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-navy-800">{author.name}</span>
                  <span className="text-xs text-muted-foreground">@{author.username}</span>
                  {groupName && (
                    <span className="text-xs text-muted-foreground">
                      in <span className="font-medium text-navy-700">{groupName}</span>
                    </span>
                  )}
                </div>
                {pending ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-blue" role="status">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Posting...
                  </span>
                ) : (
                  <time className="text-xs text-muted-foreground" dateTime={time}>{time}</time>
                )}
                {!pending && edited && (
                  <span
                    className="text-xs text-muted-foreground"
                    title="This post was edited after it was published"
                  >
                    · Edited
                  </span>
                )}
                {isPostAudience(visibility) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-light-blue px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title={`Audience: ${audienceLabel[visibility]}`}>
                    <AudienceIcon audience={visibility} className="h-3 w-3" />
                    {audienceLabel[visibility]}
                  </span>
                )}
              </div>
              {!pending && (onDelete
                ? <PostOptionsMenu
                    postId={id}
                    content={content}
                    visibility={visibility}
                    groupName={groupName}
                    hasMedia={Boolean(image)}
                    onDelete={onDelete}
                    onUpdate={onUpdate}
                  />
                : <ReportPostDialog postId={id} />)}
            </div>
            {content && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-navy-700">{content}</p>}
            {image && <div className="relative mt-4 overflow-hidden rounded-lg border border-surface-border bg-ink-800">{isVideo ? <video src={image} controls preload="metadata" className="max-h-[520px] w-full object-cover" aria-label="Post video" /> : <img src={image} alt="Image shared in this post" loading="lazy" className="max-h-[520px] w-full object-cover" />}{isVideo && <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-navy-900/70 px-2 py-1 text-[11px] font-medium text-white"><Play className="h-3 w-3 fill-current" /> Video</span>}</div>}

            <div className="relative mt-4 flex items-center gap-1 border-t border-surface-border pt-2">
              <IconButton size="sm" label={reactionLabel} className={cn("h-9 px-3 text-xs", reaction && "text-red-500 hover:text-red-600")} onClick={() => void updateReaction("like")} disabled={reactionLoading || pending}>
                {reactionLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Heart className={cn("mr-1.5 h-4 w-4", reaction === "like" && "fill-current")} />}{likes}
              </IconButton>
              <div className="relative">
                <Button variant="ghost" size="sm" aria-label="Add sticker reaction" className="h-9 px-3 text-xs" onClick={() => setStickerOpen((open) => !open)} disabled={pending}><SmilePlus className="mr-1.5 h-4 w-4" />Sticker</Button>
                {stickerOpen && <div className="absolute bottom-10 left-0 z-20 flex gap-1 rounded-xl border border-surface-border bg-card p-2 shadow-xl" role="menu" aria-label="Sticker reactions">{stickers.map((sticker) => <button key={sticker} type="button" role="menuitem" aria-label={`React ${sticker}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-transform hover:scale-125 hover:bg-surface-light-blue" onClick={() => void updateReaction(sticker)}>{sticker}</button>)}</div>}
              </div>
              <IconButton size="sm" label={commentLabel} className="h-9 px-3 text-xs" onClick={() => setCommentsOpen((open) => !open)} disabled={pending}><MessageCircle className="mr-1.5 h-4 w-4" />{commentCount}</IconButton>
              <IconButton size="sm" label={shareLabel} className="h-9 px-3 text-xs" onClick={() => void sharePost()} disabled={pending}><Share2 className="mr-1.5 h-4 w-4" />{shares}</IconButton>
              <IconButton size="sm" label={bookmarkLabel} className={cn("ml-auto h-9 px-3 text-xs", saved && "text-brand-blue")} onClick={() => setSaved(!saved)} disabled={pending}><Bookmark className={cn("h-4 w-4", saved && "fill-current")} /></IconButton>
            </div>
            {notice && <p role="status" className="mt-2 text-xs font-medium text-brand-blue">{notice}</p>}

            {commentsOpen && <div className="mt-3 space-y-3 border-t border-surface-border pt-3">
              {commentsLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading comments...</div> : commentItems.length > 0 ? <div className="max-h-52 space-y-3 overflow-y-auto">{commentItems.map((comment) => <div key={comment.id} className="flex gap-2"><Avatar className="h-7 w-7 shrink-0"><AvatarImage src={comment.author?.avatarUrl ?? undefined} /><AvatarFallback className="text-[10px]">{comment.author?.name?.[0] || "U"}</AvatarFallback></Avatar><div className="min-w-0 rounded-xl bg-surface-light-blue px-3 py-2"><p className="text-[11px] font-semibold text-navy-800">{comment.author?.name || comment.author?.username || "Member"}</p><p className="text-xs leading-5 text-navy-700">{comment.content}</p></div></div>)}</div> : <p className="text-xs text-muted-foreground">No comments yet. Start the conversation.</p>}
              <div className="flex items-center gap-2"><input aria-label="Write a comment" value={commentText} onChange={(event) => setCommentText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitComment(); }} placeholder="Write a comment..." className="h-10 min-w-0 flex-1 rounded-full border border-surface-border bg-card px-4 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20" /><Button type="button" size="icon" aria-label="Send comment" onClick={() => void submitComment()} disabled={!commentText.trim() || submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div>
            </div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
