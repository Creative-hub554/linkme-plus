"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { InlineNotice } from "@/components/shared/inline-notice";
import { PostComposer } from "@/components/social/post-composer";
import type { PostAudience } from "@/lib/post-audiences";
import type { PostEdit } from "@/components/social/post-edit-dialog";
import { PostCard, type PostActivity } from "@/components/social/post-card";
import { formatPostTime } from "@/lib/post-time";
import { VirtualFeedList, type VirtualFeedListHandle } from "@/components/social/virtual-feed-list";
import { useAuth } from "@/components/auth-provider";
import {
  followLossEffect,
  groupLossEffect,
  groupRevealNoticeMessage,
  mergeRevealedPosts,
  newestFirst,
  revealNoticeMessage,
  visibilityChangeNeedsRecheck,
} from "@/lib/feed-audience";
import { createClient } from "@/utils/supabase/client";
import { publishPost } from "@/lib/publish-post";
import {
  ArrowRight,
  Briefcase,
  Compass,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Users,
  X,
} from "lucide-react";

/** Posts requested per page. The API clamps this to 1-100. */
const PAGE_SIZE = 20;
/**
 * How long realtime inserts are collected before being hydrated, so a burst of
 * posts arriving together costs one lookup instead of one request per post.
 */
const REALTIME_BATCH_MS = 150;
/**
 * Newest posts fetched after a subscription is re-established. Events during a
 * gap are gone for good, so the feed reconciles once against the API.
 */
const REALTIME_CATCHUP_LIMIT = 10;
/** Ceiling on posts held back while the reader has not asked for them yet. */
const MAX_HELD_POSTS = 50;
/**
 * Realtime channel the comment/reaction trigger broadcasts to. A Supabase
 * channel's name *is* the broadcast topic, so this is also the topic the
 * database publishes on.
 */
const FEED_ACTIVITY_TOPIC = "feed:activity";
/** Local id prefix for a post the server has not confirmed yet. */
const PENDING_ID_PREFIX = "pending-";
/** Ids per reconciliation request; the counts endpoint caps a request at 100. */
const COUNT_RECONCILE_CHUNK = 100;
/**
 * Ids per audience re-check. `GET /api/posts?ids=` rejects more than 25 at once
 * (`MAX_LOOKUP_IDS` there), and an unfollow can ask about every card on screen.
 */
const VISIBILITY_CHECK_CHUNK = 25;
/**
 * How many of a newly followed member's posts are pulled in at once. Older ones
 * need no special handling: they are visible to the reader from that moment on,
 * so ordinary paging brings them in like any other post.
 */
const REVEALED_POST_LIMIT = 20;
/** How long the "posts added to your feed" status stays before fading out. */
const REVEAL_NOTICE_MS = 8000;
/** Ceiling on posts reconciled after a reconnect, to bound the work. */
const MAX_RECONCILE_IDS = 200;
/** How long a post jumped to from a notification stays ringed. */
const FOCUS_HIGHLIGHT_MS = 2600;
/**
 * Pages paged forward while looking for the post a notification points at.
 * Beyond this the post is inserted by id instead, which is cheaper than paging
 * through a very long history.
 */
const MAX_FOCUS_PAGES = 5;

/** Stable identity (and measurement key) for a feed item. */
function getPostKey(post: FeedPost) {
  return post.id;
}

interface FeedMedia {
  id: string;
  url: string;
  type: string;
  altText?: string | null;
}

interface FeedPost {
  id: string;
  content?: string | null;
  createdAt: string;
  visibility?: string | null;
  /** Set once the post has been edited; the card marks it beside the time. */
  editedAt?: string | null;
  /** Authoritative engagement totals, patched by live activity. */
  commentCount?: number | null;
  reactionCount?: number | null;
  /**
   * The viewer's own reaction, once a write confirms. The feed read does not
   * answer per-row viewer state, so this starts unset and is written by the
   * confirmed-write seam (`onReactionSettled`): the row is what a repainted
   * card re-derives its colour from, which is why a confirmed write lands
   * here and not only in the card's own state.
   */
  viewerLiked?: boolean;
  author: {
    /** Present on posts from the API; used to recognise the reader's own posts. */
    id?: string | null;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
  /**
   * Present when a Page published the post, and the identity the card should
   * show. `author` above is the member who owns the row — which is what the
   * delete and edit checks compare against — but the Page is what it was
   * published *as*, so a card that rendered `author` would credit every Page
   * post to whoever happened to be signed in.
   */
  page?: {
    id?: string | null;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  /**
   * Present when the post was published into a group, which is how it reached
   * this feed at all — the reader is a member. Named on the card so that a post
   * addressed to a room does not read as one addressed to the reader.
   */
  group?: {
    id?: string | null;
    name?: string | null;
  } | null;
  media?: FeedMedia[];
  /** Optimistic post that has not been confirmed by the server yet. */
  pending?: boolean;
}

/**
 * The slice of a raw `posts` row that Realtime pushes. Supabase sends the
 * table's own column names, in snake_case.
 */
interface RealtimePostRow {
  id?: string | null;
  author_id?: string | null;
  deleted_at?: string | null;
  content?: string | null;
  visibility?: string | null;
  edited_at?: string | null;
}

/** Payload the follow trigger publishes on `feed:activity` (migration `0008`). */
interface FollowChangePayload {
  follower_id?: string | null;
  following_id?: string | null;
  /** False for a removal; absent from an older payload, so absent is ignored. */
  added?: boolean;
}

/**
 * Payload the group-membership trigger publishes on `feed:activity` (migration
 * `0013`). `user_id` is the member whose membership changed, which is not
 * necessarily the reader's own.
 */
interface GroupChangePayload {
  user_id?: string | null;
  group_id?: string | null;
  /** False for leaving a group; absent from an older payload, so absent is ignored. */
  added?: boolean;
}

/** Payload the comment/reaction trigger publishes on `feed:activity`. */
interface FeedActivityPayload {
  post_id?: string | null;
  comment_count?: number | null;
  reaction_count?: number | null;
  comment_added_id?: string | null;
  comment_removed_id?: string | null;
}

/** Structural view of the signed-in user, including Supabase Auth metadata. */
interface AuthUserLike {
  name?: string | null;
  username?: string | null;
  image?: string | null;
  user_metadata?: {
    username?: string | null;
    full_name?: string | null;
    name?: string | null;
    avatar_url?: string | null;
    picture?: string | null;
  } | null;
}


function FeedLoading() {
  return (
    <div className="space-y-4" aria-label="Loading social feed" aria-busy="true">
      {[1, 2, 3].map((item) => (
        <Card key={item} className="border-surface-border/80">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const shortcuts = [
  { href: "/profile", label: "My profile", icon: Users },
  { href: "/groups", label: "Groups", icon: Compass },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
];

function FeedContent() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  /** Post a notification asked the feed to open. */
  const focusedPostId = searchParams.get("post");
  /** Stable identity for the subscription: a new user object must not resubscribe. */
  const viewerId = user?.id ?? null;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  /** A failed publish or delete, shown above the composer. */
  const [postError, setPostError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /** Opaque keyset cursor for the next page; null means we are at the top. */
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const inFlightRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** Posts found by the live check that the reader has not been shown yet. */
  const [heldPosts, setHeldPosts] = useState<FeedPost[]>([]);
  /** Live thread activity per post, handed to the matching card. */
  const [activity, setActivity] = useState<Record<string, PostActivity>>({});
  /** Latest posts, for work that runs outside render (reconnect reconciliation). */
  const postsRef = useRef<FeedPost[]>([]);
  const knownIdsRef = useRef(new Set<string>());
  const viewerIdRef = useRef<string | null>(null);
  /** Ids named by realtime that have not been hydrated into full posts yet. */
  const pendingIdsRef = useRef<string[]>([]);
  const pendingTimerRef = useRef<number | null>(null);
  /** Post the reader is being taken to, until the list is positioned to show it. */
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  /**
   * Says which member's posts a follow just brought in, and which card to jump
   * to when the reader wants to see them.
   */
  const [revealNotice, setRevealNotice] = useState<{
    message: string;
    postId: string;
  } | null>(null);
  const listRef = useRef<VirtualFeedListHandle | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  /** Auto-dismiss for `revealNotice`; a second follow replaces the first. */
  const revealNoticeTimerRef = useRef<number | null>(null);
  /**
   * Post a notification took the reader to. A refresh replaces the list with
   * page one, which would otherwise throw away the post they were just shown.
   */
  const pinnedPostIdRef = useRef<string | null>(null);

  /** Drops the `?post=` parameter once it has been honoured. */
  const clearFocusParam = useCallback(() => {
    // `scroll: false` so replacing the URL does not undo the jump we just made.
    router.replace("/feed", { scroll: false });
  }, [router]);

  const fetchPosts = useCallback(
    async (cursor: string | null, mode: "initial" | "refresh" | "append") => {
      // One request at a time so a fast scroll cannot fire overlapping pages.
      // Callers that need the page (the notification jump) get nothing back
      // when a request is already running.
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;

      if (mode === "append") {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      setMoreError(null);

      try {
        const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/posts?${query.toString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load posts");
        const payload = await response.json();
        const serverPosts: FeedPost[] = Array.isArray(payload.data) ? payload.data : [];
        const nextCursor: string | null = payload.pagination?.nextCursor ?? null;

        // A cursor points at the last row we already have, so it is only
        // advanced on success — a failed page is retried from the same spot.
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
        hasMoreRef.current = Boolean(nextCursor);

        setPosts((prev) => {
          // Keyset paging cannot replay a row, but a refresh must keep posts
          // that are still publishing, and deduping keeps the list stable if
          // the same page is ever fetched twice.
          const keep =
            mode === "append"
              ? prev
              : prev.filter((post) => post.pending || post.id === pinnedPostIdRef.current);
          const seen = new Set(keep.map((post) => post.id));
          const additions = serverPosts.filter((post) => !seen.has(post.id));
          // A page continues from the last row the *server* sent, so appending
          // it after an older post that a notification jump inserted would
          // otherwise put newer posts below it.
          return [...keep, ...additions].sort(newestFirst);
        });

        return { posts: serverPosts, nextCursor };
      } catch {
        if (mode === "append") setMoreError("We couldn't load more posts.");
        else setError("We couldn't load the social feed right now.");
        return undefined;
      } finally {
        inFlightRef.current = false;
        if (mode === "append") setLoadingMore(false);
        else setLoading(false);
      }
    },
    [],
  );

  const loadMore = useCallback(() => {
    if (inFlightRef.current || !hasMoreRef.current || !cursorRef.current) return;
    void fetchPosts(cursorRef.current, "append");
  }, [fetchPosts]);

  /**
   * Opens the post a notification points at.
   *
   * The feed pages forward to reach it when it is only a few pages deep, and
   * falls back to fetching it by id for something much older. A post that no
   * longer exists says so instead of doing nothing.
   */
  const focusPost = useCallback((postId: string) => {
    pinnedPostIdRef.current = postId;

    if (postsRef.current.some((post) => post.id === postId)) {
      setFocusTarget(postId);
      return;
    }

    void (async () => {
      // Page forward first. The pages a keyset cursor walks are strictly older,
      // so a post reached this way can never be overtaken by a later page —
      // whereas a post inserted by hand can, which would slide it out of view
      // while the reader is looking at it.
      for (let page = 0; page < MAX_FOCUS_PAGES; page += 1) {
        if (!hasMoreRef.current || !cursorRef.current) break;
        const loaded = await fetchPosts(cursorRef.current, "append");
        if (!loaded) break;
        if (loaded.posts.some((post) => post.id === postId)) {
          setFocusTarget(postId);
          return;
        }
        if (!loaded.nextCursor) break;
      }

      // Older than the pages we are willing to walk: fetch it on its own and put
      // it where its timestamp belongs.
      try {
        const response = await fetch(`/api/posts?ids=${encodeURIComponent(postId)}`, {
          cache: "no-store",
        });
        const payload = response.ok ? await response.json() : null;
        const fetched: FeedPost | undefined = Array.isArray(payload?.data) ? payload.data[0] : undefined;
        if (!fetched) {
          setFocusNotice("That post is no longer available.");
          clearFocusParam();
          return;
        }
        setPosts((previous) =>
          previous.some((item) => item.id === fetched.id)
            ? previous
            : [...previous, fetched].sort(newestFirst),
        );
        setFocusTarget(fetched.id);
      } catch {
        setFocusNotice("We couldn't open that post right now.");
        clearFocusParam();
      }
    })();
  }, [clearFocusParam, fetchPosts]);

  // Each `?post=` is honoured once. `handledFocusRef` is what makes the effect
  // safe to re-run when the post list changes underneath it.
  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusedPostId || loading || authLoading) return;
    if (handledFocusRef.current === focusedPostId) return;
    handledFocusRef.current = focusedPostId;
    focusPost(focusedPostId);
  }, [focusedPostId, loading, authLoading, focusPost]);

  // Scrolling waits for the post to be in the list: a layout effect is the first
  // moment the list has been positioned with it. It keeps re-anchoring while the
  // post is ringed, because a page arriving below it — or an item above it being
  // measured for the first time — moves every offset underneath.
  useLayoutEffect(() => {
    if (!focusTarget) return;
    if (!listRef.current?.scrollToKey(focusTarget)) return;

    if (highlightId === focusTarget) return;

    setHighlightId(focusTarget);
    clearFocusParam();

    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightId(null);
      setFocusTarget(null);
    }, FOCUS_HIGHLIGHT_MS);
    // Keyed on the list's length rather than the list itself: a comment or
    // reaction patching a post must not pull the reader back.
  }, [focusTarget, highlightId, posts.length, clearFocusParam]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      if (revealNoticeTimerRef.current !== null) {
        window.clearTimeout(revealNoticeTimerRef.current);
      }
    },
    [],
  );

  const dismissRevealNotice = useCallback(() => {
    if (revealNoticeTimerRef.current !== null) {
      window.clearTimeout(revealNoticeTimerRef.current);
      revealNoticeTimerRef.current = null;
    }
    setRevealNotice(null);
  }, []);

  /**
   * Takes the reader to the first card a follow brought in.
   *
   * The card is already in the list, so this reuses the notification jump: the
   * list scrolls to it and rings it, which is what matters for a revealed post
   * that landed below the fold. The status goes, having served its purpose.
   */
  const jumpToRevealed = useCallback(() => {
    if (!revealNotice) return;
    const target = revealNotice.postId;
    dismissRevealNotice();
    setFocusTarget(target);
  }, [revealNotice, dismissRevealNotice]);

  // The shortcut exists only while the status does, so it is bound exactly as
  // long as there is something to jump to and cannot shadow a key once the
  // status has gone. `Alt` keeps it off the typing keys: a bare letter would be
  // a character-key shortcut, which has to be remappable or scoped to focus to
  // stay accessible. `event.code` rather than `event.key` because Alt changes
  // what a key reports on some layouts (Option+J is "∆" on macOS).
  useEffect(() => {
    if (!revealNotice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyJ" || !event.altKey) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      jumpToRevealed();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [revealNotice, jumpToRevealed]);

  useEffect(() => {
    if (!authLoading && user) void fetchPosts(null, "initial");
  }, [authLoading, user, fetchPosts]);

  // Remember what the feed already holds so the live check can offer only posts
  // the reader has never seen, and drop anything that a refresh has since
  // pulled in on its own.
  useEffect(() => {
    postsRef.current = posts;
    const known = new Set(posts.map((post) => post.id));
    knownIdsRef.current = known;
    setHeldPosts((previous) => {
      const remaining = previous.filter((post) => !known.has(post.id));
      return remaining.length === previous.length ? previous : remaining;
    });
  }, [posts]);

  useEffect(() => {
    viewerIdRef.current = viewerId;
  }, [viewerId]);

  /**
   * Offers posts to the reader without moving the list. A post appearing above
   * them pushes whatever they were reading further down the page, so it is held
   * back until they ask for it.
   */
  const holdPosts = useCallback((incoming: FeedPost[]) => {
    if (incoming.length === 0) return;
    setHeldPosts((previous) => {
      const held = new Set(previous.map((post) => post.id));
      const additions = incoming.filter(
        (post) =>
          // The reader's own posts are already on screen the moment they
          // publish, so they must never be announced back to them.
          (!viewerIdRef.current || post.author?.id !== viewerIdRef.current) &&
          !knownIdsRef.current.has(post.id) &&
          !held.has(post.id),
      );
      if (additions.length === 0) return previous;
      return [...additions, ...previous].slice(0, MAX_HELD_POSTS);
    });
  }, []);

  /**
   * Turns announced row ids into renderable posts.
   *
   * Realtime carries only the raw `posts` row, but a card needs the author and
   * media, so the ids are resolved through the API — the same shape the feed
   * already renders.
   */
  const hydrateAnnouncedPosts = useCallback(
    async (ids: string[]) => {
      const unique = [...new Set(ids)].filter(Boolean).slice(-MAX_HELD_POSTS);
      if (unique.length === 0) return;
      try {
        const response = await fetch(`/api/posts?ids=${encodeURIComponent(unique.join(","))}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Post lookup failed");
        const payload = await response.json();
        const incoming: FeedPost[] = Array.isArray(payload.data) ? payload.data : [];
        holdPosts(incoming);
      } catch {
        // The post is already committed, so a failed lookup is not worth an
        // error banner: a refresh or the next reconnect will pick it up.
      }
    },
    [holdPosts],
  );

  /** Collects ids into one lookup, so a burst of posts is a single request. */
  const queueAnnouncedIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      pendingIdsRef.current = [...pendingIdsRef.current, ...ids].slice(-MAX_HELD_POSTS);
      if (pendingTimerRef.current !== null) return;
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        const queued = pendingIdsRef.current;
        pendingIdsRef.current = [];
        void hydrateAnnouncedPosts(queued);
      }, REALTIME_BATCH_MS);
    },
    [hydrateAnnouncedPosts],
  );

  /** Reconciles against the API once, after a subscription gap. */
  const catchUpOnMissedPosts = useCallback(async () => {
    try {
      const response = await fetch(`/api/posts?limit=${REALTIME_CATCHUP_LIMIT}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json();
      const incoming: FeedPost[] = Array.isArray(payload.data) ? payload.data : [];
      holdPosts(incoming);
    } catch {
      // Realtime will deliver the next post regardless.
    }
  }, [holdPosts]);

  /** Drops a post the platform no longer has — from the list and from the pill. */
  const removePost = useCallback((postId: string) => {
    if (pinnedPostIdRef.current === postId) pinnedPostIdRef.current = null;
    setPosts((previous) => previous.filter((post) => post.id !== postId));
    setHeldPosts((previous) => previous.filter((post) => post.id !== postId));
    setActivity((previous) => {
      if (!(postId in previous)) return previous;
      const next = { ...previous };
      delete next[postId];
      return next;
    });
  }, []);

  /**
   * Brings posts that have just become readable into the feed.
   *
   * Following somebody makes their `followers` posts visible, and joining a group
   * makes that group's posts visible, but both were filtered out of every page
   * already fetched, so nothing on screen changes until a reload. This re-reads
   * what the API now includes — the caller names the query — and merges the posts
   * the list does not already hold, in date order, exactly where a fetched page
   * would have put them. A newer post this inserts does shift the cards below it
   * down; that is the price of showing it rather than holding it behind a pill,
   * which is only ever about *arriving* posts. A status line, built by the
   * caller, names what arrived and says how many cards came in, so the reader
   * knows why the list grew rather than wondering what they missed.
   */
  const revealPosts = useCallback(
    async (url: string, notice: (lead: FeedPost, count: number) => string) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const fetched: FeedPost[] = Array.isArray(payload.data) ? payload.data : [];
        if (fetched.length === 0) return;

        // Measured against the latest list for the status line; the insert below
        // dedupes again so a post that arrives in between cannot double up.
        const known = knownIdsRef.current;
        const fresh = fetched.filter((post) => !known.has(post.id));
        if (fresh.length === 0) return;

        // `fresh` was measured against the list as it was when this request went
        // out; the merge measures again against the list as it is now, so a post
        // that arrived in between cannot end up in twice.
        setPosts((previous) => mergeRevealedPosts(previous, fetched));

        // The API orders newest first, so the first fresh post is the one the
        // reader is most likely to want to see.
        const lead = fresh[0];
        setRevealNotice({ message: notice(lead, fresh.length), postId: lead.id });
        if (revealNoticeTimerRef.current !== null) {
          window.clearTimeout(revealNoticeTimerRef.current);
        }
        revealNoticeTimerRef.current = window.setTimeout(() => {
          revealNoticeTimerRef.current = null;
          setRevealNotice(null);
        }, REVEAL_NOTICE_MS);
      } catch {
        // The posts are readable from now on, so the next load has them anyway;
        // this is only the head start.
      }
    },
    [],
  );

  /** Reveals a member's `followers` posts, which a follow has just made readable. */
  const revealAuthorPosts = useCallback(
    (authorId: string) =>
      revealPosts(
        `/api/posts?authorId=${encodeURIComponent(authorId)}&limit=${REVEALED_POST_LIMIT}`,
        (lead, count) =>
          revealNoticeMessage(lead.author?.name || lead.author?.username || "they", count),
      ),
    [revealPosts],
  );

  /** Reveals a group's posts, which a membership has just made readable. */
  const revealGroupPosts = useCallback(
    (groupId: string) =>
      revealPosts(
        `/api/posts?groupId=${encodeURIComponent(groupId)}&limit=${REVEALED_POST_LIMIT}`,
        (lead, count) => groupRevealNoticeMessage(lead.group?.name || "the group", count),
      ),
    [revealPosts],
  );

  /**
   * Patches what a change touched, leaving the rest of the card alone.
   *
   * This is also the confirmed-write seam: a card's action row hands
   * `onReactionSettled` its type when the server confirms, and the row is
   * rewritten first — so the card re-derives from written truth on the
   * repaint, not from a state the press is holding. A like count is not a
   * viewer state, so nothing in `FeedPost` carries `liked`; the row's side of
   * the confirmation is the count the card's own `bumpLikes` brought forward,
   * and the card's colour is here: `viewerLiked`.
   */
  const patchPost = useCallback((postId: string, patch: Partial<FeedPost>) => {
    setPosts((previous) =>
      previous.map((post) => (post.id === postId ? { ...post, ...patch } : post)),
    );
  }, []);

  /**
   * Drops any of these cards the reader may no longer see.
   *
   * Whether a `followers` post counts as visible depends on a follow edge the
   * client does not track, so this asks the API — the same predicate the feed
   * was built from — rather than re-deriving it. A post that has left the
   * reader's reach simply comes back empty, exactly as a deleted one would, and
   * the card goes. Ids are sent in chunks because the endpoint caps a lookup.
   */
  const revalidateVisiblePosts = useCallback(
    async (postIds: string[]) => {
      const unique = [...new Set(postIds.filter(Boolean))];
      for (let index = 0; index < unique.length; index += VISIBILITY_CHECK_CHUNK) {
        const chunk = unique.slice(index, index + VISIBILITY_CHECK_CHUNK);
        try {
          const response = await fetch(`/api/posts?ids=${encodeURIComponent(chunk.join(","))}`, {
            cache: "no-store",
          });
          if (!response.ok) continue;
          const payload = await response.json();
          const returned = new Set(
            (Array.isArray(payload.data) ? payload.data : []).map((post: FeedPost) => post.id),
          );
          for (const id of chunk) if (!returned.has(id)) removePost(id);
        } catch {
          // A failed check leaves the card in place; the next reload decides
          // again, and a post the reader may not see is never rendered from
          // data they were not given.
        }
      }
    },
    [removePost],
  );

  /**
   * Reacts to a change in the reader's own follow graph.
   *
   * A `followers` post is readable exactly while the reader's edge to its author
   * exists, so a change to that edge changes what the feed may show: following
   * somebody makes their posts readable (brought in — see `revealAuthorPosts`),
   * and unfollowing makes them unreadable (the cards go).
   *
   * On an unfollow only `followers` cards can be affected — `public` stays
   * public and a `private` one could not have been on screen in the first place
   * — so those are dropped straight away rather than waiting on a round trip to
   * the API. The API remains the source of truth for anything a card cannot
   * tell us.
   */
  const applyFollowChange = useCallback(
    (payload: FollowChangePayload | null | undefined) => {
      if (payload?.follower_id !== viewerIdRef.current) return;
      const following = payload.following_id;
      // An older payload carries no direction, and guessing one would either
      // hide readable posts or show unreadable ones. Absent is ignored.
      if (!following || typeof payload?.added !== "boolean") return;

      if (payload.added) {
        void revealAuthorPosts(following);
        return;
      }

      const { drop, recheck } = followLossEffect(postsRef.current, following);
      for (const id of drop) removePost(id);
      if (recheck.length > 0) void revalidateVisiblePosts(recheck);
    },
    [removePost, revalidateVisiblePosts, revealAuthorPosts],
  );

  /**
   * Reacts to a change in the reader's own group memberships.
   *
   * A `group` post is readable exactly while the reader is a member of the group
   * it was published into, so a change to that membership changes what the feed
   * may show: joining brings the group's posts in (see `revealGroupPosts`), and
   * leaving takes them out. On leaving, the cards go at once rather than waiting
   * on a round trip to the API — membership is what held them up and nothing
   * else on the card can — and anything a card cannot settle is left to the API,
   * which stays the source of truth for the rest.
   *
   * The payload names the member whose membership changed, because the row it
   * came from is theirs; somebody else's membership says nothing about this
   * reader's feed.
   */
  const applyGroupChange = useCallback(
    (payload: GroupChangePayload | null | undefined) => {
      if (payload?.user_id !== viewerIdRef.current) return;
      const groupId = payload.group_id;
      // An older payload carries no direction, and guessing one would either
      // hide readable posts or show unreadable ones. Absent is ignored.
      if (!groupId || typeof payload?.added !== "boolean") return;

      if (payload.added) {
        void revealGroupPosts(groupId);
        return;
      }

      const { drop, recheck } = groupLossEffect(postsRef.current, groupId);
      for (const id of drop) removePost(id);
      if (recheck.length > 0) void revalidateVisiblePosts(recheck);
    },
    [removePost, revalidateVisiblePosts, revealGroupPosts],
  );

  /**
   * Deletes one of the reader's own posts, optimistically.
   *
   * The card goes before the request is sent and comes back if it fails. A
   * realtime UPDATE carrying `deleted_at` removes the same id a moment later,
   * which is a no-op, and a restored card is re-sorted by its own timestamp so
   * it cannot reappear above something newer.
   */
  const deletePost = useCallback(
    async (postId: string) => {
      const removed = postsRef.current.find((post) => post.id === postId);
      setPostError(null);
      removePost(postId);
      try {
        const response = await fetch(`/api/posts?id=${encodeURIComponent(postId)}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Delete failed");
      } catch {
        if (removed) {
          setPosts((previous) =>
            previous.some((post) => post.id === postId)
              ? previous
              : [...previous, removed].sort(newestFirst),
          );
        }
        setPostError("We couldn't delete that post. It's still here.");
      }
    },
    [removePost],
  );

  /**
   * Saves an edit to one of the reader's own posts, optimistically.
   *
   * The card changes before the request is sent so the author sees their own
   * edit immediately, and is put back exactly as it was if the save fails —
   * including the "Edited" mark, which is why the previous values are taken
   * from the list rather than recomputed. The author's own PUT also comes back
   * over realtime a beat later, which lands on the same values.
   */
  const updatePost = useCallback(
    async (postId: string, changes: PostEdit) => {
      const previous = postsRef.current.find((post) => post.id === postId);
      setPostError(null);
      patchPost(postId, {
        content: changes.content,
        visibility: changes.visibility,
        editedAt: new Date().toISOString(),
      });
      try {
        const response = await fetch("/api/posts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: postId, ...changes }),
        });
        if (!response.ok) throw new Error("Update failed");
      } catch {
        if (previous) {
          patchPost(postId, {
            content: previous.content,
            visibility: previous.visibility,
            editedAt: previous.editedAt,
          });
        }
        setPostError("We couldn't save your changes. Your post is unchanged.");
      }
    },
    [patchPost],
  );

  /**
   * Applies a live comment/reaction push for one post.
   *
   * Counts arrive as absolute totals, so they are assigned rather than added to.
   * A comment id in the same payload is forwarded to the card, which is the only
   * thing that knows whether its thread is open.
   */
  const applyActivity = useCallback(
    (payload: FeedActivityPayload | null | undefined) => {
      const postId = payload?.post_id;
      if (!postId) return;

      const patch: Partial<FeedPost> = {};
      if (typeof payload.comment_count === "number") patch.commentCount = payload.comment_count;
      if (typeof payload.reaction_count === "number") patch.reactionCount = payload.reaction_count;
      if (Object.keys(patch).length > 0) patchPost(postId, patch);

      if (payload.comment_added_id || payload.comment_removed_id) {
        setActivity((previous) => ({
          ...previous,
          [postId]: {
            seq: (previous[postId]?.seq ?? 0) + 1,
            commentAddedId: payload.comment_added_id ?? null,
            commentRemovedId: payload.comment_removed_id ?? null,
          },
        }));
      }
    },
    [patchPost],
  );

  /**
   * Re-reads the counts for the posts on screen.
   *
   * Realtime never replays what it missed while the socket was down, so after a
   * reconnect the totals are refreshed — and an id the API no longer returns has
   * been deleted, which is how a deletion during the gap is caught.
   */
  const reconcileCounts = useCallback(async () => {
    const ids = postsRef.current
      .map((post) => post.id)
      .filter((id) => !id.startsWith(PENDING_ID_PREFIX))
      .slice(0, MAX_RECONCILE_IDS);
    if (ids.length === 0) return;

    for (let index = 0; index < ids.length; index += COUNT_RECONCILE_CHUNK) {
      const chunk = ids.slice(index, index + COUNT_RECONCILE_CHUNK);
      try {
        const response = await fetch(
          `/api/posts/counts?ids=${encodeURIComponent(chunk.join(","))}`,
          { cache: "no-store" },
        );
        if (!response.ok) continue;
        const payload = await response.json();
        const rows: { id: string; commentCount: number; reactionCount: number }[] =
          Array.isArray(payload.data) ? payload.data : [];
        const returned = new Set(rows.map((row) => row.id));
        for (const row of rows) {
          patchPost(row.id, {
            commentCount: row.commentCount,
            reactionCount: row.reactionCount,
          });
        }
        for (const id of chunk) if (!returned.has(id)) removePost(id);
      } catch {
        // A reconciliation is a background nicety; the next reconnect or a
        // manual refresh will try again.
      }
    }
  }, [patchPost, removePost]);

  // Subscribe instead of polling. Supabase pushes each committed change over a
  // websocket, so posts, comment/reaction totals and deletions all arrive within
  // milliseconds of being written. The channel name doubles as the broadcast
  // topic the database publishes activity on.
  useEffect(() => {
    if (!viewerId) return;

    const supabase = createClient();
    let disposed = false;
    let subscribedOnce = false;

    const channel = supabase
      .channel(FEED_ACTIVITY_TOPIC)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload: { new: RealtimePostRow }) => {
          const row = payload.new;
          if (!row?.id) return;
          // Soft-deleted rows are not feed content, and the reader's own post is
          // already on screen — including while its id is still local.
          if (row.deleted_at) return;
          if (viewerIdRef.current && row.author_id === viewerIdRef.current) return;
          if (knownIdsRef.current.has(row.id)) return;
          queueAnnouncedIds([row.id]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload: { new: RealtimePostRow }) => {
          const row = payload.new;
          if (!row?.id) return;
          // A moderator or the author removing a post must take the card with
          // it: `deleted_at` is how this schema deletes.
          if (row.deleted_at) {
            removePost(row.id);
            return;
          }
          // Only patch what the row actually carries — writing an absent column
          // through would blank out what is on screen.
          const patch: Partial<FeedPost> = {};
          if (typeof row.content === "string" || row.content === null) {
            patch.content = row.content;
          }
          if (typeof row.visibility === "string") {
            patch.visibility = row.visibility;
            // An edit can move a post out of this reader's reach. Only the
            // author's own posts are never at risk, and only a *change* is worth
            // a request, so an ordinary content edit costs nothing extra.
            if (
              visibilityChangeNeedsRecheck({
                isViewerOwnPost: Boolean(
                  viewerIdRef.current && row.author_id === viewerIdRef.current,
                ),
                mounted: postsRef.current.find((post) => post.id === row.id),
                nextVisibility: row.visibility,
              })
            ) {
              void revalidateVisiblePosts([row.id]);
            }
          }
          // A row can arrive already edited, or with the mark cleared, so the
          // column is copied across rather than only ever being set.
          if (typeof row.edited_at === "string" || row.edited_at === null) {
            patch.editedAt = row.edited_at;
          }
          if (Object.keys(patch).length > 0) patchPost(row.id, patch);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload: { old: { id?: string | null } }) => {
          // A hard delete (a cascade, or a purge) only carries the key.
          const id = payload.old?.id;
          if (id) removePost(id);
        },
      )
      .on(
        "broadcast",
        { event: "counts" },
        (message: { payload?: FeedActivityPayload }) => applyActivity(message.payload),
      )
      // The follow graph is on the same topic: an unfollow can put a card out of
      // reach even though the post never changed, and a DELETE on `follows`
      // carries no ids over `postgres_changes`, so it arrives as this broadcast.
      .on(
        "broadcast",
        { event: "follows" },
        (message: { payload?: FollowChangePayload }) => applyFollowChange(message.payload),
      )
      // Group membership is on the same topic for the same reason: leaving a
      // group can put a `group` post out of reach even though the post never
      // changed, and a DELETE on `group_members` carries no ids over
      // `postgres_changes`, so it arrives as this broadcast instead.
      .on(
        "broadcast",
        { event: "group_members" },
        (message: { payload?: GroupChangePayload }) => applyGroupChange(message.payload),
      )
      .subscribe((status: string) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          // A reconnect means events were missed while the socket was down, and
          // realtime never replays them. The first subscribe needs no catch-up:
          // the initial page load already fetched the newest posts.
          if (subscribedOnce) {
            void catchUpOnMissedPosts();
            void reconcileCounts();
          }
          subscribedOnce = true;
        }
      });

    return () => {
      disposed = true;
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [
    viewerId,
    queueAnnouncedIds,
    catchUpOnMissedPosts,
    applyActivity,
    applyFollowChange,
    applyGroupChange,
    patchPost,
    removePost,
    revalidateVisiblePosts,
    reconcileCounts,
  ]);

  const showHeldPosts = useCallback(() => {
    if (heldPosts.length === 0) return;
    setPosts((previous) => {
      const known = new Set(previous.map((post) => post.id));
      const additions = heldPosts.filter((post) => !known.has(post.id));
      return additions.length > 0 ? [...additions, ...previous] : previous;
    });
    setHeldPosts([]);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [heldPosts]);

  // Fetch the next page as the sentinel approaches the viewport. Re-observing
  // whenever the list grows also handles the case where the first page does
  // not fill the viewport and the sentinel is already visible.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, posts.length]);

  const handlePost = async (content: string, image?: File, audience: PostAudience = "public") => {
    const trimmed = content.trim();
    const blobUrl = image ? URL.createObjectURL(image) : undefined;
    const media = image && blobUrl
      ? [{ url: blobUrl, type: image.type, altText: "Post image" }]
      : [];

    const authUser = user as AuthUserLike | null;
    const tempId = `${PENDING_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: FeedPost = {
      id: tempId,
      content: trimmed,
      createdAt: new Date().toISOString(),
      visibility: audience,
      author: {
        // Mirror the navigation's fallbacks so the optimistic card shows the
        // same identity the rest of the app does.
        name:
          authUser?.name ??
          authUser?.user_metadata?.full_name ??
          authUser?.user_metadata?.name ??
          null,
        username: authUser?.username ?? authUser?.user_metadata?.username ?? null,
        avatarUrl:
          authUser?.image ??
          authUser?.user_metadata?.avatar_url ??
          authUser?.user_metadata?.picture ??
          null,
      },
      media: media.map((item, index) => ({ ...item, id: `pending-media-${index}` })),
      pending: true,
    };

    // Show the post immediately, before the request is even sent, and clear any
    // previous feed/post errors so the optimistic card is visible.
    setPostError(null);
    setError(null);
    setPosts((prev) => [optimistic, ...prev]);

    const rollback = () => {
      setPosts((prev) => prev.filter((post) => post.id !== tempId));
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };

    try {
      // Upload the attachment for real before creating the post. The blob URL
      // above is only this tab's preview; persisting it would leave everybody
      // else — and the author on the next load — with a dead image.
      const { post: created, media: stored } = await publishPost({
        content: trimmed,
        file: image ?? null,
        audience,
      });

      // Promote the optimistic entry in place so it neither blinks nor moves.
      setPosts((prev) =>
        prev.map((post) =>
          post.id === tempId
            ? {
                ...post,
                id: created.id,
                createdAt: created.createdAt ?? post.createdAt,
                visibility: created.visibility ?? post.visibility,
                pending: false,
                media: stored.length
                  ? stored.map((entry, index) => ({
                      id: `${created.id}-media-${index}`,
                      url: entry.url,
                      type: entry.type,
                      altText: entry.altText,
                    }))
                  : post.media,
              }
            : post,
        ),
      );
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    } catch (error) {
      rollback();
      setPostError(
        error instanceof Error ? error.message : "We couldn't publish your post.",
      );
      // Hand the text back so nothing the author wrote is lost.
      if (trimmed) setDraft(trimmed);
    }
  };

  if (authLoading) return <FeedLoading />;
  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-purple">Social</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-800 sm:text-3xl">Your community</h1>
          <p className="mt-1 text-sm text-muted-foreground">See what people you follow are sharing today.</p>
        </div>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => void fetchPosts(null, "refresh")} disabled={loading}>
          <RefreshCw className={loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          Refresh feed
        </Button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[190px_minmax(0,1fr)_250px]">
        <aside className="hidden lg:block" aria-label="Social shortcuts">
          <Card className="sticky top-20">
            <CardContent className="p-3">
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Shortcuts</p>
              <nav className="space-y-1">
                {shortcuts.map((item) => (
                  <Link key={item.href} href={item.href} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-navy-600 transition-colors hover:bg-surface-light-blue hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
                    <item.icon className="h-4 w-4 text-brand-blue" />
                    {item.label}
                  </Link>
                ))}
              </nav>
              {/* The studio is a section of the profile, so this points at the
                  section rather than at a page of its own. */}
              <div className="mt-3 border-t border-surface-border pt-3">
                <Link href="/profile?tab=cover" className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-brand-purple transition-colors hover:bg-brand-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple">
                  <Sparkles className="h-4 w-4" />
                  Cover studio
                </Link>
              </div>
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          {postError && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span>
                {postError}
                {draft ? " Your text has been put back in the composer." : ""}
              </span>
              <button
                type="button"
                onClick={() => setPostError(null)}
                aria-label="Dismiss error"
                className="shrink-0 rounded-md p-1 text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <PostComposer user={user} onSubmit={handlePost} draft={draft} onDraftUsed={() => setDraft(null)} />

          {focusNotice && (
            <InlineNotice onDismiss={() => setFocusNotice(null)}>{focusNotice}</InlineNotice>
          )}

          {/* Explains the cards a follow just brought in, and jumps to them. */}
          {revealNotice && (
            <InlineNotice onDismiss={dismissRevealNotice}>
              <button
                type="button"
                onClick={jumpToRevealed}
                aria-keyshortcuts="Alt+J"
                title="Jump to the post (Alt+J)"
                className="group flex items-center gap-1.5 rounded-sm text-left font-medium transition-colors hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
              >
                <span className="underline-offset-2 group-hover:underline">
                  {revealNotice.message}
                </span>
                <kbd
                  aria-hidden="true"
                  className="hidden shrink-0 rounded border border-surface-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-navy-600 group-hover:border-brand-blue/40 sm:inline-block"
                >
                  Alt J
                </kbd>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-blue" />
              </button>
            </InlineNotice>
          )}

          {heldPosts.length > 0 && (
            <div role="status" aria-live="polite" className="sticky top-20 z-10 flex justify-center">
              <Button onClick={showHeldPosts} className="rounded-full shadow-lg transition-transform hover:scale-[1.03]">
                <Sparkles className="mr-2 h-4 w-4" />
                {heldPosts.length === 1 ? "1 new post" : `${heldPosts.length} new posts`}
              </Button>
            </div>
          )}

          {error && posts.length > 0 && (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => void fetchPosts(null, "refresh")}>
                Try again
              </Button>
            </div>
          )}

          {loading ? (
            <FeedLoading />
          ) : error && posts.length === 0 ? (
            <Card><CardContent className="p-2"><EmptyState icon={<RefreshCw className="h-8 w-8" />} title="Feed unavailable" description={error} action={<Button variant="outline" onClick={() => void fetchPosts(null, "initial")}>Try again</Button>} /></CardContent></Card>
          ) : posts.length === 0 ? (
            <Card><CardContent className="p-2"><EmptyState icon={<Users className="h-8 w-8" />} title="Your feed is quiet" description="Follow people and publish your first post to start the conversation." action={<Button asChild><Link href="/search">Find people <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>} /></CardContent></Card>
          ) : (
            <>
              {/* Windowed: only the cards near the viewport are mounted, so a
                  feed several hundred posts deep stays cheap to scroll. */}
              <VirtualFeedList
                ref={listRef}
                items={posts}
                getKey={getPostKey}
                highlightKey={highlightId}
                renderItem={(post) => {
                  const media = post.media?.find((item) => item.type.toLowerCase().startsWith("image") || item.type.toLowerCase().startsWith("video"));
                  return <PostCard id={post.id} author={post.page?.id ? { name: post.page.name || "Page", username: post.page.username || "page", avatar: post.page.avatarUrl || undefined } : { name: post.author.name || "Member", username: post.author.username || "member", avatar: post.author.avatarUrl || undefined }} content={post.content || ""} image={media?.url} mediaType={media?.type} time={formatPostTime(post.createdAt)} likes={post.reactionCount ?? 0} liked={post.viewerLiked} comments={post.commentCount ?? 0} shares={0} visibility={post.visibility} groupName={post.group?.name ?? undefined} pending={post.pending} activity={activity[post.id]} edited={Boolean(post.editedAt)} onReactionSettled={(type) => patchPost(post.id, { viewerLiked: type === "like" })} onDelete={viewerId && post.author.id === viewerId ? deletePost : undefined} onUpdate={viewerId && post.author.id === viewerId ? updatePost : undefined} />;
                }}
              />

              {moreError ? (
                <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
                  <span>{moreError}</span>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => loadMore()} disabled={loadingMore}>
                    Try again
                  </Button>
                </div>
              ) : hasMore ? (
                <div
                  ref={sentinelRef}
                  role="status"
                  aria-live="polite"
                  className="flex min-h-6 items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
                >
                  {loadingMore && (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading more posts...
                    </>
                  )}
                </div>
              ) : (
                <p role="status" className="py-4 text-center text-sm text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              )}
            </>
          )}
        </main>

        <aside className="hidden space-y-4 lg:block" aria-label="Discover on LinkMe+">
          <Card>
            <CardHeader className="p-4 pb-2"><CardTitle className="text-sm text-navy-800">Keep exploring</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              <p className="text-sm leading-6 text-muted-foreground">Connect with creators, discover opportunities, and find communities that fit your interests.</p>
              <div className="flex flex-wrap gap-1.5">
                {["Design", "Technology", "Photography", "Business"].map((topic) => <span key={topic} className="rounded-full border border-surface-border bg-surface-light-blue px-2.5 py-1 text-xs font-medium text-navy-600">{topic}</span>)}
              </div>
            </CardContent>
          </Card>
          <Card className="border-brand-purple/20 bg-gradient-to-br from-card to-brand-purple/5">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2 text-brand-purple"><Sparkles className="h-4 w-4" /><h2 className="text-sm font-semibold">Create something memorable</h2></div>
              <p className="text-sm leading-6 text-muted-foreground">Build a standout cover with Cover Studio.</p>
              <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0"><Link href="/profile?tab=cover">Open studio <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary, as on the search page. The feed
 * reads `?post=` so a notification can open the post it is about.
 */
export default function FeedPage() {
  return (
    <Suspense fallback={<FeedLoading />}>
      <FeedContent />
    </Suspense>
  );
}
