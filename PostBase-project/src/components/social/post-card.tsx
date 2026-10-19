"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeCheck, Heart, MessageCircle, Share2, Bookmark, Play, SmilePlus, Send, Loader2, ImagePlus, Trash2 } from "lucide-react";
import { AudienceIcon } from "@/components/social/audience-icon";
import { IconButton } from "@/components/ui/icon-button";
import { audienceLabel, isPostAudience } from "@/lib/post-audiences";
import { cn } from "@/lib/utils";
import { ReportPostDialog } from "@/components/social/report-post-dialog";
import { PostOptionsMenu } from "@/components/social/post-options-menu";
import { uploadPostAttachment } from "@/lib/publish-post";
import type { PostEdit } from "@/components/social/post-edit-dialog";
import { useAuth } from "@/components/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Author {
  name: string;
  username: string;
  avatar?: string;
  verified?: boolean;
}

interface CommentItem {
  id: string;
  content: string;
  createdAt?: string;
  /**
   * The viewer's own reaction on this comment — the type under the thread's
   * heart (`"like"`, `null` when none), as the comments read answers it. A
   * thread is loaded fresh every open, and its open thread lives under cards
   * the virtualized feed remounts freely: the row the thread re-seeds from
   * answers the reaction, so the confirmed heart survives the remount.
   */
  viewerReaction?: string | null;
  /** How many reactions the comment holds, as the read answered it. */
  reactionCount?: number;
  /**
   * The author, whose `id` is what tells the reader this is their own comment.
   * The delete control below is drawn only for the reader's own comments, so
   * the comparison needs the id rather than the name — two members may share a
   * display name, and a name is not an identity.
   */
  author?: { id?: string | null; name?: string | null; username?: string | null; avatarUrl?: string | null };
  /** Photos attached to the comment, in pick order; a text-only comment has none. */
  media?: Array<{ url: string; altText?: string | null; type?: string }>;
}

/** How many photos one comment may carry — this side of the server's cap. */
const MAX_COMMENT_PHOTOS = 4;

/**
 * A data URL for a picked photo, so its chip can show the image before the
 * comment is sent. A `FileReader` rather than `URL.createObjectURL`: blob URLs
 * do not exist in the test environment, and a preview that vanishes there
 * would take the whole attach flow with it.
 */
function readPhotoPreview(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
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
  /**
   * The row's confirmed reaction *type*, as the read answered it — `"like"` or
   * a sticker, `null` when the viewer has none, and undefined when the parent's
   * rows do not carry a type at all (the boolean fallback below is for those).
   * Rows from `/api/posts` answer it per post, so a card remounted while
   * scrolling — the virtualized feed unmounts a card the moment it leaves the
   * window, and the remount seeds from the row — wears the reaction the server
   * still holds, including a sticker a boolean could never name.
   */
  reaction?: string | null;
  saved?: boolean;
  visibility?: "public" | "followers" | "private" | string | null;
  /**
   * Told the server's answer once a write is confirmed — the state the row
   * the card was painted from now holds: `null` when the reaction came off,
   * `"like"` when it went on, the new type on a swap. Silence is the
   * rollback's answer: a write that did not happen leaves the rows where they
   * were, so the parent never repaints from one.
   */
  onReactionSettled?: (type: string | null) => void;
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
   * Set when a boosted campaign is paying for this post's place in the feed.
   *
   * The card marks it Sponsored, counts the view for the campaign, and offers
   * the two controls every paid placement owes a reader: a way to the Page
   * behind it, and a way to put it away. Nothing else about the post changes —
   * a boost buys placement, and the same audience rule decided this post could
   * be in the reader's feed at all.
   */
  sponsored?: {
    campaignId: string;
    pageUsername?: string | null;
    targetLocation?: string | null;
  };
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

/**   * The card that holds a post, which is held in the rows its parent lists. The
   * `liked`/`reaction` pair starts from the row the parent passed (`initialLiked`,
   * and the row's confirmed type when it carries one as `reaction`),
 * but a parent whose rows move under a still-mounted card would otherwise leave
 * a stale heart behind — so the card adopts the row's state whenever it changes
 * and nothing of the card's own is in flight, and the parent repainting from
 * `onReactionSettled`'s written rows is how a confirmed write reaches a card's
 * colour, even mid-scroll.
 */
/**
 * Tell the campaign it was seen, or that its page was opened.
 *
 * One function rather than a fetch in each place because the two calls are the
 * same request with one word changed, and because a beacon that fails is not an
 * error: a reader's feed is not where a campaign's counter problem belongs to
 * surface.
 */
function reportBoostEvent(campaignId: string, type: "impression" | "click") {
  void fetch("/api/boosts/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, type }),
  }).catch(() => {});
}

export function PostCard({ id, author, content, image, mediaType, time, likes: initialLikes, comments: initialComments, shares, liked: initialLiked = false, reaction: rowReaction, saved: initialSaved = false, visibility, groupName, pending = false, activity, sponsored, onDelete, onUpdate, edited = false, onReactionSettled }: PostCardProps) {
  // The reaction is the row's state the card holds in escrow, exactly as the
  // listing card's heart is: `useState` reads the props once, and a parent whose
  // rows move under a still-mounted card leaves a stale react behind unless the
  // row's new state reaches the card. The parent does that by calling
  // `onReactionSettled` — through which the row is written — and the card below
  // then adopts the new state on the parent's re-render (the card's own press
  // is in flight meanwhile, guarded by `reactionLoading`).
  const [liked, setLiked] = useState(initialLiked);
  const [reaction, setReaction] = useState<string | null>(
    // A row that carries the type seeds the card from it directly; one that
    // carries only the boolean re-derives `like`-or-nothing, as it always did.
    rowReaction !== undefined ? rowReaction : initialLiked ? "like" : null,
  );
  const [saved, setSaved] = useState(initialSaved);
  const [commentCount, bumpComments] = useReconciledCount(initialComments);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  // Photos chosen for the next comment. Held as the `File` itself (uploaded
  // at submit, so a `blob:` preview URL can never reach the server) beside a
  // data-URL preview for the chip.
  const [commentPhotos, setCommentPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const commentPhotoInputRef = useRef<HTMLInputElement>(null);

  // A paid placement owes the campaign a count and the reader a way out.
  //
  // The impression is reported once per mount — a re-render is not a second
  // view — and both reports are fire-and-forget on purpose: this is a beacon
  // fired from a reader's feed, and a failure the reader cannot act on is
  // noise in their afternoon rather than an error they should see.
  const impressionReported = useRef(false);
  const [sponsoredHidden, setSponsoredHidden] = useState(false);

  useEffect(() => {
    if (!sponsored || impressionReported.current) return;
    impressionReported.current = true;
    reportBoostEvent(sponsored.campaignId, "impression");
  }, [sponsored]);

  const visitSponsoredPage = () => {
    if (sponsored) reportBoostEvent(sponsored.campaignId, "click");
  };
  const [commentItems, setCommentItems] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState(false);
  const [commentsRetry, setCommentsRetry] = useState(0);
  // One comment's reaction write in flight at a time — a press while another
  // is settling would double a count that has not caught up to its row yet.
  const [commentWriteId, setCommentWriteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reactionLoading, setReactionLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The signed-in reader, whose id is what marks a comment in the thread as
  // their own — the sole condition under which the delete control is drawn.
  const { user: viewer } = useAuth();
  const viewerId = viewer?.id ?? null;
  // The comment the reader asked to delete, held open under its confirmation
  // dialog until they confirm or cancel, plus whether its request is in flight.
  const [commentDeleteTarget, setCommentDeleteTarget] = useState<CommentItem | null>(null);
  const [commentDeleting, setCommentDeleting] = useState(false);

  // The row's confirmed reaction type reaches the card through the parent's
  // re-render; while one of this card's own writes is in flight, what it is
  // writing is what the card holds, not what an in-between row says.
  //
  // `reactionLoading` is fed through a ref on purpose: the guard is a
  // "don't adopt mid-write" gate, not a subscription — putting it in the deps
  // would re-run this effect when a write starts or ends and adopt whatever
  // the row happens to say at that moment, exactly the stale repaint the
  // guard exists to prevent. The listing card holds the same rule with its
  // own `saving` ref.
  const reactionLoadingRef = useRef(false);
  useEffect(() => {
    reactionLoadingRef.current = reactionLoading;
  }, [reactionLoading]);
  // What the last confirmed write settled, as the row will hold it. A repaint
  // that matches this is the echo of this card's own write arriving through
  // the parent — and adopting an echo could only downgrade the card, because
  // the row's boolean (`viewerLiked: type === "like"`) carries strictly less
  // than the confirmation the card already holds: re-deriving the reaction
  // *type* from that boolean would clobber a confirmed 🔥 into nothing. So an
  // echo is skipped, and any repaint the card did not cause is adopted.
  const confirmedReactionRef = useRef({
    liked: initialLiked,
    reaction: initialLiked ? "like" : null,
  });
  useEffect(() => {
    if (reactionLoadingRef.current) return;
    // A row that speaks the reaction's *type* is adopted whole, and needs no
    // echo-guard: the repaint of this card's own confirmed write carries the
    // same type the confirmation settled, so adopting it is a no-op at worst,
    // and a repaint the card did not cause is exactly the row to follow — a
    // 🔥 stays a 🔣 through both paths, where a boolean row could only
    // re-derive it back to nothing.
    if (rowReaction !== undefined) {
      setReaction(rowReaction);
      setLiked(rowReaction === "like");
      return;
    }
    // Boolean-only rows keep the echo-guard: what the last confirmed write
    // settled, as the row will hold it. A repaint that matches this is the
    // echo of this card's own write arriving through the parent — and adopting
    // an echo could only downgrade the card, because the row's boolean
    // (`viewerLiked: type === "like"`) carries strictly less than the
    // confirmation the card already holds: re-deriving the reaction *type*
    // from that boolean would clobber a confirmed 🔥 into nothing. So an
    // echo is skipped, and any repaint the card did not cause is adopted.
    const confirmed = confirmedReactionRef.current;
    if (confirmed.liked === initialLiked && confirmed.reaction !== null) return;
    setReaction(initialLiked ? "like" : null);
    setLiked(initialLiked);
  }, [initialLiked, rowReaction]);

  // Both counters follow one rule: the feed's number is authoritative, and an
  // optimistic local change is held until the authoritative number catches up.
  const [likes, bumpLikes] = useReconciledCount(initialLikes);
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
      setCommentsError(false);
      try {
        const response = await fetch(`/api/posts/comments?postId=${encodeURIComponent(id)}&limit=10`);
        if (!response.ok) throw new Error("Could not load comments");
        const payload = await response.json();
        if (!Array.isArray(payload?.data)) throw new Error("Invalid comments response");
        if (!cancelled) setCommentItems(payload.data);
      } catch {
        if (!cancelled) setCommentsError(true);
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    };
    void loadComments();
    return () => { cancelled = true; };
  }, [commentsOpen, id, commentsRetry]);

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
      // Recorded before the parent is told, so the repaint its write causes
      // reads as this card's own echo rather than as a row to adopt.
      confirmedReactionRef.current = {
        liked: nextReaction === "like",
        reaction: nextReaction,
      };
      // The server's word, carried to the row: the parent writes it into the
      // row this card was painted from, so the same card — same key, still
      // mounted — re-derives from written truth on the repaint rather than
      // from a state the press is holding. Only a confirmed write is told; a
      // rollback is the rows staying exactly where they were.
      onReactionSettled?.(nextReaction);
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
  /**
   * One press under a comment, through the same `/api/posts/reactions` write
   * the posts' hearts use — the target type is what changes.
   *
   * The count moves from what the row itself answered — the comment's own
   * read carried both the viewer's type and the total, and the settle below
   * keeps the pressed state as the row holds it, so a thread reloaded after
   * any part of this — remount, reopen, repaint — shows the server's truth
   * and count, never an optimistic state mistaken for the row's.
   */
  const toggleCommentReaction = async (comment: CommentItem) => {
    if (commentWriteId || pending) return;
    const wasActive = comment.viewerReaction === "like";
    const previousReaction = comment.viewerReaction ?? null;
    const previousCount = comment.reactionCount ?? 0;
    // One reaction per person: adding one moves the count, removing yours
    // takes one back — the same arithmetic the posts' hearts hold.
    const delta = wasActive ? -1 : 1;
    setCommentItems((items) =>
      items.map((item) =>
        item.id === comment.id
          ? { ...item, viewerReaction: wasActive ? null : "like", reactionCount: previousCount + delta }
          : item,
      ),
    );
    setCommentWriteId(comment.id);
    try {
      const response = await fetch("/api/posts/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "comment", targetId: comment.id, type: "like" }),
      });
      if (!response.ok) throw new Error("Reaction failed");
      const payload = await response.json();
      const settled = payload.type ?? null;
      setCommentItems((items) =>
        items.map((item) =>
          item.id === comment.id
            ? { ...item, viewerReaction: settled, reactionCount: previousCount + delta }
            : item,
        ),
      );
    } catch {
      // The rollback puts the row back where the read found it — the same
      // state a fresh thread load would have answered.
      setCommentItems((items) =>
        items.map((item) =>
          item.id === comment.id
            ? { ...item, viewerReaction: previousReaction, reactionCount: previousCount }
            : item,
        ),
      );
      setNotice("Reaction could not be saved.");
      window.setTimeout(() => setNotice(null), 2200);
    } finally {
      setCommentWriteId(null);
    }
  };

  /** Chooses photos for the next comment, up to the cap, and previews each. */
  const onCommentPhotosPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    // Cleared so picking the same file again still fires a change event.
    event.target.value = "";
    if (picked.length === 0) return;
    const added = picked
      .slice(0, Math.max(0, MAX_COMMENT_PHOTOS - commentPhotos.length))
      .map((file) => ({ file, preview: "" }));
    if (added.length === 0) return;
    setCommentPhotos([...commentPhotos, ...added]);
    for (const entry of added) {
      void readPhotoPreview(entry.file).then((preview) => {
        setCommentPhotos((photos) =>
          photos.map((photo) => (photo.file === entry.file ? { ...photo, preview } : photo)),
        );
      });
    }
  };

  const submitComment = async () => {
    const content = commentText.trim();
    // Text or a photo makes a comment — the same rule the server states.
    if ((!content && commentPhotos.length === 0) || submitting || pending) return;
    setSubmitting(true);
    // Counted before the request: our own comment is broadcast back to us as an
    // absolute total, and bumping first is what keeps that from double-counting.
    bumpComments(1);
    try {
      // The files are stored first, like the composer publishes a post: the
      // server records the URL that comes back, never the preview in this
      // browser — a `blob:` URL would be dead for everyone after a reload.
      const media: Array<{ url: string; type: string; altText: string }> = [];
      for (const photo of commentPhotos) {
        const uploaded = await uploadPostAttachment(photo.file);
        media.push({ url: uploaded.url, type: uploaded.type, altText: "Comment photo" });
      }
      const response = await fetch("/api/posts/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: id, content, media }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Comment failed");
      const created = payload.comment;
      setCommentItems((items) => [created, ...items]);
      setCommentText("");
      setCommentPhotos([]);
      // The insert response is the raw row, so resolve the author before it can
      // render as an anonymous "Member".
      const [hydrated] = await fetchComments([created?.id].filter(Boolean));
      if (hydrated) {
        setCommentItems((items) =>
          items.map((item) => (item.id === hydrated.id ? hydrated : item)),
        );
      }
    } catch (error) {
      bumpComments(-1);
      // The upload's own message is written for the author ("we couldn't
      // reach the server…") — show it when it exists, the generic line when
      // the failure carried none.
      const message = error instanceof Error && error.message ? error.message : "Comment could not be posted.";
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2200);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Removes the reader's own comment from the thread.
   *
   * Optimistic, like a post deletion: the comment leaves the thread the moment
   * the request does, because a confirmation has already been given and making
   * the reader watch a spinner on their own undoable action is worse than
   * showing the result. A failure puts the comment back, in its old place among
   * the loaded ones, and says so in the card's own notice — the count is
   * restored with it, so a failed delete leaves the card exactly as it was.
   *
   * The server soft-deletes the row and reclaims the comment's photos from
   * storage; the Realtime `comment_removed_id` the broadcast carries is the
   * same removal arriving a beat later for the other viewers, and a no-op here
   * because the item is already gone.
   */
  const deleteComment = async (comment: CommentItem) => {
    if (commentDeleting) return;
    setCommentDeleting(true);
    // The order the thread was in, so a rollback restores it rather than
    // appending the comment back at the top where it never was.
    const previous = commentItems;
    setCommentItems((items) => items.filter((item) => item.id !== comment.id));
    bumpComments(-1);
    try {
      const response = await fetch(
        `/api/posts/comments?id=${encodeURIComponent(comment.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Delete failed");
    } catch {
      setCommentItems(previous);
      bumpComments(1);
      setNotice("Comment could not be deleted. It's still here.");
      window.setTimeout(() => setNotice(null), 2200);
    } finally {
      setCommentDeleting(false);
      setCommentDeleteTarget(null);
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

  // Hid by the reader, the card is gone rather than greyed: the control is
  // advertised as a way to put the placement away, and a placeholder is not
  // away. Every hook above has run by here, so the early return is legal.
  if (sponsored && sponsoredHidden) return null;

  return (
    <Card
      id={`post-${id}`}
      aria-busy={pending || undefined}
      className={cn("overflow-visible border-surface-border/90 shadow-sm transition-shadow", pending ? "opacity-70" : "hover:shadow-md")}
    >
      <CardContent className="p-4 sm:p-5">
        {sponsored && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-surface-border/70 bg-surface-light-blue/50 px-3 py-1.5">
            <p className="min-w-0 truncate text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wider text-navy-700">Sponsored</span>
              {sponsored.targetLocation ? ` · ${sponsored.targetLocation}` : ""}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href={`/pages/${sponsored.pageUsername ?? ""}`}
                onClick={visitSponsoredPage}
                className="text-[11px] font-semibold text-brand-blue hover:underline"
              >
                Visit page
              </Link>
              <button
                type="button"
                onClick={() => setSponsoredHidden(true)}
                className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-navy-800"
              >
                Hide
              </button>
            </div>
          </div>
        )}
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
                  {author.verified && <span aria-label={`${author.name}'s verified account badge`} title="Verified account" className="text-sky-700"><BadgeCheck className="h-4 w-4" aria-hidden="true" /></span>}
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
              {commentsLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading comments...</div> : commentsError ? <div role="alert" className="flex items-center gap-2 text-xs text-muted-foreground"><span>Comments couldn&apos;t be loaded.</span><Button type="button" variant="outline" size="sm" aria-label="Retry loading comments" onClick={() => setCommentsRetry((retry) => retry + 1)}>Retry loading comments</Button></div> : commentItems.length > 0 ? <div className="max-h-52 space-y-3 overflow-y-auto">{commentItems.map((comment) => <div key={comment.id} className="flex gap-2"><Avatar className="h-7 w-7 shrink-0"><AvatarImage src={comment.author?.avatarUrl ?? undefined} /><AvatarFallback className="text-[10px]">{comment.author?.name?.[0] || "U"}</AvatarFallback></Avatar><div className="min-w-0 rounded-xl bg-surface-light-blue px-3 py-2"><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-[11px] font-semibold text-navy-800">{comment.author?.name || comment.author?.username || "Member"}</p>{viewerId && <button type="button" aria-label={`like reaction${(comment.reactionCount ?? 0) > 0 ? `, ${(comment.reactionCount ?? 0)} ${(comment.reactionCount ?? 0) === 1 ? "reaction" : "reactions"}` : ""} — ${comment.viewerReaction === "like" ? "remove your" : "add your"} reaction`} aria-pressed={comment.viewerReaction === "like"} disabled={commentWriteId === comment.id} onClick={() => void toggleCommentReaction(comment)} className={`flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${comment.viewerReaction === "like" ? "text-rose-600" : "text-muted-foreground hover:text-rose-600"}`}><Heart className="h-3 w-3" fill={comment.viewerReaction === "like" ? "currentColor" : "none"} />{(comment.reactionCount ?? 0) > 0 && <span>{comment.reactionCount}</span>}</button>}{viewerId && comment.author?.id === viewerId && <Button variant="ghost" size="icon" aria-label="Delete comment" className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive" disabled={commentDeleting} onClick={() => setCommentDeleteTarget(comment)}><Trash2 className="h-3 w-3" /></Button>}</div>{comment.content && <p className="text-xs leading-5 text-navy-700">{comment.content}</p>}{(comment.media?.length ?? 0) > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Photos in this comment">{comment.media!.map((photo) => (<img key={photo.url} src={photo.url} alt={photo.altText || "Photo attached to comment"} loading="lazy" className="h-20 w-20 rounded-md border border-surface-border bg-ink-800 object-cover" />))}</div>}</div></div>)}</div> : <p className="text-xs text-muted-foreground">No comments yet. Start the conversation.</p>}
              <div className="space-y-2">{commentPhotos.length > 0 && <div className="flex flex-wrap gap-2" role="list" aria-label="Photos attached to this comment">{commentPhotos.map((photo, index) => (<div key={`${photo.file.name}-${index}`} role="listitem" className="relative">{photo.preview ? <img src={photo.preview} alt={`Attached photo ${index + 1}`} className="h-16 w-16 rounded-md border border-surface-border object-cover" /> : <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-surface-border bg-surface-light-blue px-1 text-center text-[9px] leading-tight">{photo.file.name}</span>}<button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setCommentPhotos((photos) => photos.filter((_, position) => position !== index))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white shadow">×</button></div>))}</div>}<div className="flex items-center gap-2"><input ref={commentPhotoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onCommentPhotosPicked} /><IconButton size="sm" label="Attach photos to comment" onClick={() => commentPhotoInputRef.current?.click()} disabled={submitting || pending || commentPhotos.length >= MAX_COMMENT_PHOTOS}><ImagePlus className="h-4 w-4" /></IconButton><input aria-label="Write a comment" value={commentText} onChange={(event) => setCommentText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitComment(); }} placeholder="Write a comment..." className="h-10 min-w-0 flex-1 rounded-full border border-surface-border bg-card px-4 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20" /><Button type="button" size="icon" aria-label="Send comment" onClick={() => void submitComment()} disabled={(commentText.trim().length === 0 && commentPhotos.length === 0) || submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div></div>
            </div>}
          </div>
        </div>
      </CardContent>

      {/* Deleting a comment cannot be undone, and the request removes its photos
          from storage with it — so the same confirmation the post's own delete
          asks for, held open until the request settles so a second click cannot
          fire a delete that is already away. */}
      <Dialog
        open={commentDeleteTarget !== null}
        onOpenChange={(nextOpen) => {
          // Dismissable (Escape, an overlay click) only while nothing is in
          // flight — the same hold the post's own delete dialog keeps.
          if (!nextOpen && !commentDeleting) setCommentDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this comment?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. Any photo in the comment is removed with it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentDeleteTarget(null)} disabled={commentDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => commentDeleteTarget && void deleteComment(commentDeleteTarget)}
              disabled={commentDeleting}
            >
              {commentDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
