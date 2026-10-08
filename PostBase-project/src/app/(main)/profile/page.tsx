"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostComposer } from "@/components/social/post-composer";
import type { PostAudience } from "@/lib/post-audiences";
import { PostCard } from "@/components/social/post-card";
import { formatPostTime } from "@/lib/post-time";
import type { PostEdit } from "@/components/social/post-edit-dialog";
import {
  CoverEditDialog,
  type CoverSelection,
} from "@/components/profile/cover-edit-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ProfileHeader, type ProfileTabId } from "@/components/profile/profile-header";
import {
  MemberListDialog,
  type MemberListEvent,
  type MemberListMode,
} from "@/components/profile/member-list-dialog";
import { createClient } from "@/utils/supabase/client";
import { publishPost } from "@/lib/publish-post";
import type { DynamicCoverConfig } from "@/components/profile/dynamic-cover-canvas";
import { parseCoverVideoConfig, type CoverVideoConfig } from "@/lib/cover-video";
import { shortVideoTemplateById } from "@/components/cover-studio/short-video-templates";
import { CoverStudio } from "@/components/cover-studio/cover-studio";
import {
  MapPin,
  Calendar,
  Image as ImageIcon,
  Video,
  RefreshCw,
  Loader2,
  Send,
  X,
} from "lucide-react";

interface ProfilePost {
  id: string;
  content?: string | null;
  createdAt: string;
  visibility?: string | null;
  /** Set once the post has been edited; the card marks it beside the time. */
  editedAt?: string | null;
  author: {
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
  media?: ProfileMediaItem[];
  /**
   * The viewer's own reaction, once a write confirms. The profile read answers
   * no viewer state, so this starts unset and is written by the confirmed-write
   * seam — the row is what a mounted card re-derives its heart from.
   */
  viewerLiked?: boolean;
}


interface ProfileMediaItem {
  id: string;
  postId: string;
  url: string;
  type: string;
  altText: string | null;
  createdAt: string;
}

/**
 * Realtime channel the follow trigger broadcasts totals on. A Supabase channel's
 * name *is* the broadcast topic, so this is also the topic the database
 * publishes on. It is deliberately not the feed's `feed:activity` topic:
 * `client.channel(name)` hands back the existing channel for a name, and each
 * page removes only its own on unmount, so two pages must not share one.
 */
const PROFILE_COUNTS_TOPIC = "profile:counts";
/** Posts fetched per page on a profile. The API clamps this to 1-100. */
const POSTS_PAGE_SIZE = 20;

/** Absolute totals plus the direction, published by the triggers in `0006`/`0007`. */
interface FollowerCountsPayload {
  follower_id?: string | null;
  following_id?: string | null;
  followers?: number;
  following?: number;
  /** False only for a removal; absent from an older payload, so absent reads as added. */
  added?: boolean;
}

function ProfileContent() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * The profile to show. Without a query parameter this is the signed-in
   * member's own profile; `?user=` (a follow notification) and `?username=`
   * (the QR share link) open somebody else's.
   */
  const requestedUserId = searchParams.get("user");
  const requestedUsername = searchParams.get("username");
  /**
   * The section to open on, when a url names one. Only the cover studio is ever
   * named: the header's shortcut and the redirect from the old `/cover-studio`
   * address both land on `?tab=cover`.
   */
  const requestedTab = searchParams.get("tab");
  const requestedQuery = requestedUserId
    ? `id=${encodeURIComponent(requestedUserId)}`
    : requestedUsername
    ? `username=${encodeURIComponent(requestedUsername)}`
    : null;
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  /** Bumped to re-read the profile after a realtime reconnect. */
  const [profileReloadKey, setProfileReloadKey] = useState(0);
  const [stats, setStats] = useState<{ followers: number; following: number } | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  /** Which member list is open, if any. */
  const [memberList, setMemberList] = useState<MemberListMode | null>(null);
  /** Latest follow change touching this profile, for the open list. */
  const [followEvent, setFollowEvent] = useState<MemberListEvent | null>(null);
  /**
   * Realtime payloads carry no ordering, so this counts the follow events we
   * have seen: it is what distinguishes two identical changes for the row
   * updater, which would otherwise treat the second as a duplicate.
   */
  const followSequenceRef = useRef(0);
  const [postsHasMore, setPostsHasMore] = useState(false);
  /** Cursor for the next page of this member's posts, if there is one. */
  const [postsCursor, setPostsCursor] = useState<string | null>(null);
  const [postsLoadingMore, setPostsLoadingMore] = useState(false);
  /** A failed page load, kept apart from `postsError` so it cannot hide the list. */
  const [postsMoreError, setPostsMoreError] = useState<string | null>(null);
  /** A failed publish or delete, shown above the composer. */
  const [composerError, setComposerError] = useState<string | null>(null);
  /** Text handed back to the composer after a failed publish. */
  const [draft, setDraft] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSending, setMessageSending] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTabId>("posts");
  /**
   * Whether the url's `?tab=` has been honoured yet. It is read once, on mount,
   * rather than tracked: a member who arrives at the studio and then taps Posts
   * means it, and leaving the parameter in the address bar is no reason to put
   * them back a moment later. The read is in an effect because on a client
   * navigation the parameters are not there yet during the first render —
   * `useState`'s initial value would have been computed from an empty url.
   */
  const appliedTabRef = useRef(false);
  const [coverDialogOpen, setCoverDialogOpen] = useState(false);
  const [cover, setCover] = useState<{ coverUrl: string | null; coverVideoUrl: string | null; coverConfig: DynamicCoverConfig | null }>({
    coverUrl: null,
    coverVideoUrl: null,
    coverConfig: null,
  });
  /** What the published Cover Studio video was made with, for the cover editor. */
  const [coverVideoConfig, setCoverVideoConfig] = useState<CoverVideoConfig | null>(null);
  const [profilePosts, setProfilePosts] = useState<ProfilePost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [profileMedia, setProfileMedia] = useState<ProfileMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaReloadKey, setMediaReloadKey] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const authMetadata = user?.user_metadata ?? {};
  const authAvatarUrl = user?.image ?? authMetadata.avatar_url ?? authMetadata.picture ?? null;
  const [profileDetails, setProfileDetails] = useState({
    name: "",
    username: "",
    bio: "",
    location: "",
    joinedAt: "",
  });

  /** Either the requested member, or the signed-in member's own id. */
  const profileQuery = requestedQuery ?? (user?.id ? `id=${encodeURIComponent(user.id)}` : null);
  const isOwnProfile = !requestedQuery || resolvedUserId === user?.id;
  const profileUserId = requestedQuery ? resolvedUserId : user?.id ?? null;

  // The cover studio has no address of its own any more, so a url that asks for
  // it lands on the profile and asks for the section there. It is only ever your
  // own: the studio writes the signed-in member's cover, so on somebody else's
  // profile the parameter is ignored rather than opening a section the tab bar
  // does not offer.
  useEffect(() => {
    if (appliedTabRef.current) return;
    appliedTabRef.current = true;
    if (requestedTab === "cover" && isOwnProfile) setActiveTab("cover");
  }, [requestedTab, isOwnProfile]);

  useEffect(() => {
    if (!profileQuery || !user?.id) return;

    let cancelled = false;
    const loadProfile = async () => {
      try {
        const response = await fetch(`/api/users?${profileQuery}`);
        if (!response.ok) {
          // Auth metadata describes the viewer, so it is only a stand-in when
          // the viewer is the profile being shown.
          if (!cancelled && requestedQuery) {
            setProfileError(
              response.status === 404
                ? "We couldn't find that profile."
                : "This profile is unavailable right now.",
            );
          }
          return;
        }
        const payload = await response.json();
        if (cancelled || !payload.user) return;

        setResolvedUserId(payload.user.id);
        setCover({
          coverUrl: payload.user.coverUrl ?? null,
          coverVideoUrl: payload.user.coverVideoUrl ?? null,
          coverConfig: payload.user.coverConfig ?? null,
        });
        setCoverVideoConfig(parseCoverVideoConfig(payload.user.shortVideoCoverConfig));
        setAvatarUrl(payload.user.avatarUrl ?? (payload.user.id === user.id ? authAvatarUrl : null));
        setProfileDetails({
          name: payload.user.displayName || String(authMetadata.full_name || authMetadata.name || user.email?.split("@")[0] || "Member"),
          username: payload.user.username || String(authMetadata.username || authMetadata.user_name || user.email?.split("@")[0] || "member"),
          bio: payload.user.bio || (typeof authMetadata.bio === "string" ? authMetadata.bio : ""),
          location: payload.user.location || (typeof authMetadata.location === "string" ? authMetadata.location : ""),
          joinedAt: payload.user.createdAt ? new Date(payload.user.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "",
        });
        setStats({
          followers: Number(payload.stats?.followers ?? 0),
          following: Number(payload.stats?.following ?? 0),
        });
        setIsFollowing(Boolean(payload.isFollowing));
      } catch {
        // The default gradient remains available if the profile cannot load.
        if (!cancelled && requestedQuery) setProfileError("This profile is unavailable right now.");
      }
    };
    void loadProfile();
    return () => {
      cancelled = true;
    };
    // The metadata fallbacks below are primitives, so they are compared by value
    // and cannot re-run this effect on a re-render that changed nothing.
  }, [
    authAvatarUrl,
    profileQuery,
    profileReloadKey,
    requestedQuery,
    user?.id,
    user?.email,
    authMetadata.bio,
    authMetadata.full_name,
    authMetadata.location,
    authMetadata.name,
    authMetadata.user_name,
    authMetadata.username,
  ]);

  /**
   * Follower and following totals, pushed by the database.
   *
   * The trigger in `0006_follower_counts.sql` publishes absolute totals whenever
   * the follow graph changes, so a profile that is already open keeps up with
   * people following it instead of waiting for a refresh. Absolute values are
   * what make this safe to apply blind: the numbers cannot drift, and the same
   * event delivered twice lands on the same total.
   */
  useEffect(() => {
    if (!profileUserId) return;

    const supabase = createClient();
    let disposed = false;
    let subscribedOnce = false;

    const channel = supabase
      .channel(PROFILE_COUNTS_TOPIC)
      .on(
        "broadcast",
        { event: "follower_counts" },
        (message: { payload?: FollowerCountsPayload }) => {
          const payload = message.payload;
          if (!payload) return;

          setStats((previous) => {
            if (!previous) return previous;
            const next = { ...previous };
            // The member this profile belongs to can be on either side of the
            // event: the person being followed, or the person doing the
            // following from somewhere else.
            if (payload.following_id === profileUserId && typeof payload.followers === "number") {
              next.followers = payload.followers;
            }
            if (payload.follower_id === profileUserId && typeof payload.following === "number") {
              next.following = payload.following;
            }
            return next.followers === previous.followers && next.following === previous.following
              ? previous
              : next;
          });

          // The same event tells an open list which row to add or drop. The id
          // that moved is whichever side of the relationship is not this
          // profile: a new follower of this member, or a member this member
          // started following.
          const memberId =
            payload.following_id === profileUserId
              ? payload.follower_id
              : payload.follower_id === profileUserId
              ? payload.following_id
              : null;
          if (memberId && memberId !== profileUserId) {
            followSequenceRef.current += 1;
            setFollowEvent({
              seq: followSequenceRef.current,
              memberId,
              added: payload.added !== false,
            });
          }
        },
      )
      .subscribe((status: string) => {
        if (disposed || status !== "SUBSCRIBED") return;
        // A reconnect means events were missed while the socket was down, and
        // realtime never replays them, so the totals are re-read from the API.
        // The first subscribe needs no catch-up: the profile was just fetched.
        if (subscribedOnce) setProfileReloadKey((key) => key + 1);
        subscribedOnce = true;
      });

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [profileUserId]);

  /** First page of this member's posts, replaced whenever the tab is opened. */
  useEffect(() => {
    if (!profileUserId || activeTab !== "posts") return;

    let cancelled = false;
    const loadProfilePosts = async () => {
      setPostsLoading(true);
      setPostsError(null);
      setPostsMoreError(null);
      try {
        const response = await fetch(
          `/api/posts?authorId=${encodeURIComponent(profileUserId)}&limit=${POSTS_PAGE_SIZE}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error("Unable to load posts");
        const payload = await response.json();
        if (cancelled) return;
        setProfilePosts(Array.isArray(payload.data) ? payload.data : []);
        setPostsCursor(payload.pagination?.nextCursor ?? null);
        // Only claim a post count we know is complete; the "+" it adds is what
        // the Load more button below removes.
        setPostsHasMore(Boolean(payload.pagination?.nextCursor));
      } catch {
        if (!cancelled) setPostsError("We couldn't load these posts right now.");
      } finally {
        if (!cancelled) setPostsLoading(false);
      }
    };

    void loadProfilePosts();
    return () => { cancelled = true; };
  }, [activeTab, mediaReloadKey, profileUserId]);

  useEffect(() => {
    if (!profileUserId || (activeTab !== "photos" && activeTab !== "videos")) return;

    let cancelled = false;
    const loadProfileMedia = async () => {
      setMediaLoading(true);
      setMediaError(null);

      try {
        const response = await fetch(`/api/posts?authorId=${encodeURIComponent(profileUserId)}&limit=100`);
        if (!response.ok) throw new Error("Unable to load profile media");

        const payload = await response.json();
        const items = (payload.data || []).flatMap((post: { media?: ProfileMediaItem[] }) => post.media || []);
        if (!cancelled) setProfileMedia(items);
      } catch {
        if (!cancelled) setMediaError("We couldn't load this media right now.");
      } finally {
        if (!cancelled) setMediaLoading(false);
      }
    };

    void loadProfileMedia();
    return () => {
      cancelled = true;
    };
  }, [activeTab, mediaReloadKey, profileUserId]);

  /**
   * Appends the next page of this member's posts.
   *
   * The API pages by keyset, so a post published while the reader is paging
   * cannot shift the window and replay or skip a row. Ids are still checked
   * before appending: nothing stops two independent requests returning the same
   * post, and a duplicate key would break the list.
   */
  const loadMorePosts = async () => {
    if (!profileUserId || !postsCursor || postsLoadingMore) return;

    setPostsLoadingMore(true);
    setPostsMoreError(null);
    try {
      const response = await fetch(
        `/api/posts?authorId=${encodeURIComponent(profileUserId)}&limit=${POSTS_PAGE_SIZE}&cursor=${encodeURIComponent(postsCursor)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Unable to load more posts");
      const payload = await response.json();

      setProfilePosts((previous) => {
        const seen = new Set(previous.map((post) => post.id));
        const next = (payload.data ?? []).filter((post: ProfilePost) => !seen.has(post.id));
        return [...previous, ...next];
      });
      setPostsCursor(payload.pagination?.nextCursor ?? null);
      setPostsHasMore(Boolean(payload.pagination?.nextCursor));
    } catch {
      // The list stays on screen; only the footer reports the failure, and the
      // button stays put so the same page can be asked for again.
      setPostsMoreError("We couldn't load more posts right now.");
    } finally {
      setPostsLoadingMore(false);
    }
  };

  const photos = profileMedia.filter((item) => item.type.toLowerCase().startsWith("image"));
  const videos = profileMedia.filter((item) => item.type.toLowerCase().startsWith("video"));

  /**
   * Sends the first message of a conversation and opens it.
   *
   * The API creates the conversation when there is not one yet, so this works
   * whether or not the two members have talked before; the messages page then
   * opens it by id.
   */
  const handleSendMessage = async () => {
    const content = messageDraft.trim();
    if (!content || !profileUserId || messageSending) return;

    setMessageSending(true);
    setMessageError(null);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: profileUserId, content }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || !payload?.conversationId) {
        throw new Error("Send failed");
      }
      setMessageOpen(false);
      setMessageDraft("");
      router.push(`/messages?c=${encodeURIComponent(payload.conversationId)}`);
    } catch {
      setMessageError("We couldn't send that message. Please try again.");
    } finally {
      setMessageSending(false);
    }
  };

  const handleCoverSave = async (selection: CoverSelection) => {
    // Only a fresh upload displaces anything. Saving with no new photo keeps the
    // existing cover — including a published video — exactly as it is.
    const replacedCover = selection.replacedCover;
    setCover((prev) => ({
      coverUrl: selection.coverUrl,
      coverVideoUrl: replacedCover ? null : prev.coverVideoUrl,
      coverConfig: replacedCover ? null : prev.coverConfig,
    }));
    if (replacedCover) setCoverVideoConfig(null);
    try {
      await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverUrl: selection.coverUrl,
          ...(replacedCover ? { coverVideoUrl: null, coverConfig: null } : {}),
        }),
      });
    } catch {
      // Non-fatal: the upload route already persisted the cover server-side.
    }
  };

  /**
   * Takes the published cover video down, leaving a photo cover in place.
   *
   * Optimistic in both directions: the video leaves the banner at once and is put
   * back if the request fails, so the member is never shown a cover they no
   * longer have — or told one is gone while it is still there. The failure is
   * re-thrown for the cover editor to report, because that is where the action
   * was taken from.
   */
  /**
   * Removes the cover entirely — photo, published video and animated config.
   *
   * Goes through the cover's own DELETE rather than the general profile update,
   * because that route answers success from auth metadata when the database is
   * unavailable, and a removal that reports success without persisting is worse
   * than one that fails. Optimistic in both directions, as removing the video is.
   */
  const handleClearCover = async () => {
    const previousCover = { ...cover };
    const previousConfig = coverVideoConfig;
    setCover({ coverUrl: null, coverVideoUrl: null, coverConfig: null });
    setCoverVideoConfig(null);
    try {
      const response = await fetch("/api/profile/cover", { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "We couldn't remove the cover.");
      }
    } catch (error) {
      setCover(previousCover);
      setCoverVideoConfig(previousConfig);
      throw error instanceof Error ? error : new Error("We couldn't remove the cover.");
    }
  };

  const handleRemoveCoverVideo = async () => {
    const previousVideoUrl = cover.coverVideoUrl;
    const previousConfig = coverVideoConfig;
    setCover((prev) => ({ ...prev, coverVideoUrl: null }));
    setCoverVideoConfig(null);
    try {
      const response = await fetch("/api/profile/cover-video", { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "We couldn't remove the cover video.");
      }
    } catch (error) {
      setCover((prev) => ({ ...prev, coverVideoUrl: previousVideoUrl }));
      setCoverVideoConfig(previousConfig);
      throw error instanceof Error ? error : new Error("We couldn't remove the cover video.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  // A profile reached by link needs the member resolved before anything of
  // theirs can be shown.
  if (requestedQuery && !resolvedUserId) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card className="rounded-xl shadow-sm">
          <div className="space-y-3 p-6" aria-busy={!profileError}>
            {profileError ? (
              <EmptyState
                icon={<RefreshCw className="h-8 w-8" />}
                title="Profile unavailable"
                description={profileError}
                action={
                  <Button variant="outline" size="sm" onClick={() => router.push("/feed")}>
                    Back to feed
                  </Button>
                }
              />
            ) : (
              <>
                <Skeleton className="h-40 rounded-xl" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const postCount = postsHasMore ? `${profilePosts.length}+` : String(profilePosts.length);

  const displayName = profileDetails.name || user.name || String(authMetadata.full_name || authMetadata.name || user.email?.split("@")[0] || "User");
  const username = profileDetails.username || user.username || String(authMetadata.username || authMetadata.user_name || user.email?.split("@")[0] || "user");
  const coverVideoTemplateName = coverVideoConfig?.templateId
    ? shortVideoTemplateById(coverVideoConfig.templateId)?.name ?? null
    : null;
  const coverVideoPictureCount = coverVideoConfig?.photoUrls?.length ?? null;

  /**
   * Publishes from the profile's own composer.
   *
   * The post appears immediately, with a local preview of any attachment, and
   * is then swapped for the saved row. A failure removes it and puts the text
   * back in the composer: `PostComposer` clears itself as soon as it hands the
   * content over, so without that step a failed publish would silently discard
   * what somebody wrote.
   */
  const handleProfilePost = async (
    content: string,
    file?: File,
    audience: PostAudience = "public"
  ) => {
    const trimmed = content.trim();
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewUrl = file ? URL.createObjectURL(file) : null;
    const now = new Date().toISOString();

    const optimistic: ProfilePost = {
      id: tempId,
      content: trimmed,
      createdAt: now,
      visibility: audience,
      author: { name: displayName, username, avatarUrl: avatarUrl ?? authAvatarUrl },
      media:
        file && previewUrl
          ? [
              {
                id: `${tempId}-media`,
                postId: tempId,
                url: previewUrl,
                type: file.type,
                altText: null,
                createdAt: now,
              },
            ]
          : [],
    };

    setComposerError(null);
    setProfilePosts((previous) => [optimistic, ...previous]);

    try {
      const { post, media } = await publishPost({ content: trimmed, file, audience });

      setProfilePosts((previous) =>
        previous.map((item) =>
          item.id === tempId
            ? {
                ...item,
                id: post.id,
                content: post.content ?? item.content,
                createdAt: post.createdAt ?? item.createdAt,
                visibility: post.visibility ?? item.visibility,
                // The preview is the local object URL; once the attachment is
                // uploaded the card points at the stored one.
                media: media.length
                  ? media.map((entry, index) => ({
                      id: `${post.id}-media-${index}`,
                      postId: post.id,
                      url: entry.url,
                      type: entry.type,
                      altText: entry.altText,
                      createdAt: item.createdAt,
                    }))
                  : item.media,
              }
            : item
        )
      );
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } catch (error) {
      setProfilePosts((previous) => previous.filter((item) => item.id !== tempId));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setComposerError(
        error instanceof Error ? error.message : "We couldn't publish your post."
      );
      if (trimmed) setDraft(trimmed);
    }
  };

  /**
   * Deletes one of this member's own posts from the profile list.
   *
   * Only wired up for the owner, so it can only ever target a post the viewer
   * wrote (the API checks that again). The card goes first and is put back on
   * failure. The posts tile and the "Showing N posts" footer both read the
   * list's own length, so they follow it down without a second count — while a
   * page remains the tile keeps its "+" and stays honest about being a floor.
   */
  const handleProfileDelete = async (postId: string) => {
    const removed = profilePosts.find((post) => post.id === postId);
    setComposerError(null);
    setProfilePosts((previous) => previous.filter((post) => post.id !== postId));
    try {
      const response = await fetch(`/api/posts?id=${encodeURIComponent(postId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete failed");
    } catch {
      if (removed) {
        setProfilePosts((previous) =>
          previous.some((post) => post.id === postId)
            ? previous
            : [...previous, removed].sort(
                (left, right) =>
                  new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
              ),
        );
      }
      setComposerError("We couldn't delete that post. It's still here.");
    }
  };

  /**
   * Saves an edit to one of this profile's own posts, optimistically.
   *
   * The same shape as the delete above: the change is shown as soon as the form
   * closes, and a failed save puts the post back — text, audience and "Edited"
   * mark together — while the banner says so. The list's own order does not
   * move, because editing never changes when a post was published.
   */
  const handleProfileUpdate = async (postId: string, changes: PostEdit) => {
    const previous = profilePosts.find((post) => post.id === postId);
    setComposerError(null);
    setProfilePosts((current) =>
      current.map((post) =>
        post.id === postId
          ? {
              ...post,
              content: changes.content,
              visibility: changes.visibility,
              editedAt: new Date().toISOString(),
            }
          : post,
      ),
    );
    try {
      const response = await fetch("/api/posts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, ...changes }),
      });
      if (!response.ok) throw new Error("Update failed");
    } catch {
      if (previous) {
        setProfilePosts((current) =>
          current.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  content: previous.content,
                  visibility: previous.visibility,
                  editedAt: previous.editedAt,
                }
              : post,
          ),
        );
      }
      setComposerError("We couldn't save your changes. Your post is unchanged.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-0">
      <ProfileHeader
        user={{
          name: displayName,
          username,
          avatarUrl: avatarUrl ?? authAvatarUrl,
          bio: profileDetails.bio || null,
          location: profileDetails.location || null,
          joinedAt: profileDetails.joinedAt || null,
        }}
        cover={cover}
        isOwner={isOwnProfile}
        followersCount={stats?.followers}
        followingCount={stats?.following}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onEditCover={() => setCoverDialogOpen(true)}
        onEditProfile={() => router.push("/settings")}
        profileUserId={isOwnProfile ? null : profileUserId}
        initialFollowing={isFollowing}
        onFollowChange={(following, followers) => {
          setIsFollowing(following);
          setStats((previous) =>
            previous
              ? {
                  ...previous,
                  // The server's own total when it sent one, otherwise step the
                  // count by the change the button just made.
                  followers: followers ?? Math.max(0, previous.followers + (following ? 1 : -1)),
                }
              : previous,
          );
        }}
        onMessage={() => setMessageOpen(true)}
      />

      {/* Stats Bar — every tile opens the list it counts. */}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-b-xl border-x border-b border-surface-border bg-surface-border -mt-px">
        <button
          type="button"
          onClick={() => setActiveTab("posts")}
          aria-label={`Show posts by ${displayName}: ${postCount}`}
          className="bg-card py-3 text-center transition-colors hover:bg-surface-light-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <p className="text-lg font-bold text-navy-800">{postCount}</p>
          <p className="text-xs text-muted-foreground">Posts</p>
        </button>
        <button
          type="button"
          onClick={() => setMemberList("followers")}
          aria-label={`Followers of ${displayName}: ${stats ? stats.followers.toLocaleString() : "unknown"}. Open list`}
          className="bg-card py-3 text-center transition-colors hover:bg-surface-light-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <p className="text-lg font-bold text-navy-800">
            {stats ? stats.followers.toLocaleString() : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Followers</p>
        </button>
        <button
          type="button"
          onClick={() => setMemberList("following")}
          aria-label={`Members ${displayName} follows: ${stats ? stats.following.toLocaleString() : "unknown"}. Open list`}
          className="bg-card py-3 text-center transition-colors hover:bg-surface-light-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <p className="text-lg font-bold text-navy-800">
            {stats ? stats.following.toLocaleString() : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Following</p>
        </button>
      </div>

      {/* Tab Navigation + Content */}
      <Card className="mt-4 overflow-hidden rounded-xl shadow-sm">
          {/* Sections, not panels-with-triggers. These were six `TabsContent`s
              under a `Tabs` that rendered no `TabsList` — the switcher is the
              header's own row of buttons and the tiles above, both outside this
              tree — so Radix named every panel after a trigger that does not
              exist: six references to nothing, and six `tabpanel`s with no tab.
              What the audit's `dangling-label` rule reads is a reference, so the
              reference is what had to go: the active section is simply drawn. */}
          {activeTab === "posts" && (
            <div className="p-4 space-y-4">
              {isOwnProfile && (
                <>
                  {composerError && (
                    <div
                      role="alert"
                      className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                    >
                      <span>
                        {composerError}
                        {draft ? " Your text has been put back in the composer." : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => setComposerError(null)}
                        aria-label="Dismiss error"
                        className="shrink-0 rounded-md p-1 text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <PostComposer
                    user={user}
                    onSubmit={handleProfilePost}
                    draft={draft}
                    onDraftUsed={() => setDraft(null)}
                  />
                </>
              )}
              {postsLoading ? (
                <div className="space-y-3" aria-label="Loading posts" aria-busy="true">
                  {Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
                </div>
              ) : postsError ? (
                <EmptyState
                  icon={<RefreshCw className="h-8 w-8" />}
                  title="Posts unavailable"
                  description={postsError}
                  action={<Button variant="outline" size="sm" onClick={() => setMediaReloadKey((key) => key + 1)}>Try again</Button>}
                />
              ) : profilePosts.length > 0 ? (
                <>
                  {profilePosts.map((post) => {
                    const media = post.media?.find((item) => item.type.toLowerCase().startsWith("image") || item.type.toLowerCase().startsWith("video"));
                    return <PostCard key={post.id} id={post.id} author={{ name: post.author.name || displayName, username: post.author.username || username, avatar: post.author.avatarUrl || avatarUrl || authAvatarUrl || undefined }} content={post.content || ""} image={media?.url} mediaType={media?.type} time={formatPostTime(post.createdAt)} likes={0} liked={post.viewerLiked} comments={0} shares={0} visibility={post.visibility ?? undefined} edited={Boolean(post.editedAt)} onReactionSettled={(type) => setProfilePosts((current) => current.map((row) => (row.id === post.id ? { ...row, viewerLiked: type === "like" } : row)))} onDelete={isOwnProfile && !post.id.startsWith("pending-") ? handleProfileDelete : undefined} onUpdate={isOwnProfile && !post.id.startsWith("pending-") ? handleProfileUpdate : undefined} />;
                  })}

                  {(postsHasMore || postsMoreError) && (
                    <div>
                      {postsMoreError && (
                        <p role="alert" className="mb-2 text-sm text-destructive">
                          {postsMoreError}
                        </p>
                      )}
                      {postsHasMore && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => void loadMorePosts()}
                          disabled={postsLoadingMore}
                          aria-label={`Load more posts by ${displayName}`}
                        >
                          {postsLoadingMore ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading…
                            </>
                          ) : (
                            "Load more posts"
                          )}
                        </Button>
                      )}
                      <p
                        role="status"
                        aria-live="polite"
                        className="mt-2 text-center text-xs text-muted-foreground"
                      >
                        Showing {profilePosts.length}{postsHasMore ? "+" : ""}{" "}
                        {profilePosts.length === 1 ? "post" : "posts"}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState
                  title="No posts yet"
                  description={
                    isOwnProfile
                      ? "Posts you share will appear here on your profile."
                      : "This member has not posted yet."
                  }
                />
              )}
            </div>
          )}

          {/* About Tab */}
          {activeTab === "about" && (
            <div className="p-6 space-y-6">
              <section>
                <h3 className="mb-3 text-sm font-semibold text-navy-800">Intro</h3>
                <p className="text-sm text-muted-foreground">{profileDetails.bio || "This member has not added a bio yet."}</p>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold text-navy-800">Details</h3>
                <div className="space-y-2">
                  {profileDetails.location && <div className="flex items-center gap-3 text-sm"><MapPin className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Lives in:</span><span className="font-medium text-navy-800">{profileDetails.location}</span></div>}
                  {profileDetails.joinedAt && <div className="flex items-center gap-3 text-sm"><Calendar className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Joined:</span><span className="font-medium text-navy-800">{profileDetails.joinedAt}</span></div>}
                  {!profileDetails.location && !profileDetails.joinedAt && <p className="text-sm text-muted-foreground">No profile details added yet.</p>}
                </div>
              </section>
            </div>
          )}

          {/* Friends Tab */}
          {activeTab === "friends" && (
            <div className="p-6">
              <EmptyState title="Friends are coming soon" description="Friend connections will appear here once you start connecting with people." />
            </div>
          )}

          {/* Photos Tab */}
          {activeTab === "photos" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-navy-800">Photos</h3>
                <Button variant="ghost" size="sm" className="text-brand-blue text-xs">See all</Button>
              </div>
              {mediaLoading ? (
                <div className="grid grid-cols-3 gap-2" aria-label="Loading photos">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="aspect-square rounded-lg" />
                  ))}
                </div>
              ) : mediaError ? (
                <EmptyState
                  icon={<ImageIcon className="h-8 w-8" />}
                  title="Photos unavailable"
                  description={mediaError}
                  action={<Button variant="outline" size="sm" onClick={() => setMediaReloadKey((key) => key + 1)}>Try again</Button>}
                />
              ) : photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt={photo.altText || "Profile photo"}
                      loading="lazy"
                      className="aspect-square w-full rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity"
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<ImageIcon className="h-8 w-8" />}
                  title="No photos yet"
                  description={
                    isOwnProfile
                      ? "Photos you share in posts will appear here."
                      : "This member has not shared any photos yet."
                  }
                />
              )}
            </div>
          )}

          {/* Videos Tab */}
          {activeTab === "videos" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-navy-800">Videos</h3>
                <Button variant="ghost" size="sm" className="text-brand-blue text-xs">See all</Button>
              </div>
              {mediaLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Loading videos">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <Skeleton key={index} className="aspect-video rounded-lg" />
                  ))}
                </div>
              ) : mediaError ? (
                <EmptyState
                  icon={<Video className="h-8 w-8" />}
                  title="Videos unavailable"
                  description={mediaError}
                  action={<Button variant="outline" size="sm" onClick={() => setMediaReloadKey((key) => key + 1)}>Try again</Button>}
                />
              ) : videos.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {videos.map((video) => (
                    <div key={video.id} className="rounded-lg border border-surface-border overflow-hidden hover:shadow-md transition-shadow">
                      <div className="aspect-video bg-ink-800">
                        <video
                          src={video.url}
                          controls
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium">{video.altText || "Profile video"}</p>
                        <p className="text-xs text-muted-foreground">
                          Shared {new Date(video.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Video className="h-8 w-8" />}
                  title="No videos yet"
                  description={
                    isOwnProfile
                      ? "Videos you share in posts will appear here."
                      : "This member has not shared any videos yet."
                  }
                />
              )}
            </div>
          )}

          {/* More Tab */}
          {activeTab === "cover" && isOwnProfile && (
            <div className="p-4">
              <CoverStudio />
            </div>
          )}

          {activeTab === "more" && (
            <div className="p-6 space-y-4">
              <h3 className="text-sm font-semibold text-navy-800">More sections</h3>
              <div className="grid grid-cols-2 gap-3">
                {["Sports", "Music", "Movies", "Books", "Games", "Travel"].map((section) => (
                  <div key={section} className="p-3 rounded-lg border border-surface-border hover:bg-surface-light-blue transition-colors cursor-pointer">
                    <p className="text-sm font-medium text-navy-800">{section}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">No items yet</p>
                  </div>
                ))}
              </div>
            </div>
          )}
      </Card>

      <MemberListDialog
        open={memberList !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setMemberList(null);
            setFollowEvent(null);
          }
        }}
        userId={profileUserId}
        mode={memberList ?? "followers"}
        ownerName={displayName}
        total={memberList === "following" ? stats?.following : stats?.followers}
        viewerId={user.id}
        event={followEvent}
      />

      <CoverEditDialog
        open={coverDialogOpen}
        onOpenChange={setCoverDialogOpen}
        currentCoverUrl={cover.coverUrl}
        currentCoverVideoUrl={cover.coverVideoUrl}
        // The editor keeps this as the cover to fall back to, so opening it and
        // saving without picking anything no longer clears an existing photo.
        initialCoverUrl={cover.coverUrl}
        coverVideoTemplateName={coverVideoTemplateName}
        coverVideoPictureCount={coverVideoPictureCount}
        onSave={handleCoverSave}
        onRemoveVideo={handleRemoveCoverVideo}
        onClearCover={handleClearCover}
      />

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Message {displayName}</DialogTitle>
            <DialogDescription>
              Send a direct message to {displayName}. Your conversation opens in Messages.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              placeholder={`Write to ${displayName}...`}
              aria-label={`Message to ${displayName}`}
              rows={4}
              autoFocus
            />
            {messageError && (
              <p role="alert" className="text-sm text-red-600">
                {messageError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMessageOpen(false)} disabled={messageSending}>
              Cancel
            </Button>
            <Button onClick={handleSendMessage} disabled={messageSending || messageDraft.trim().length === 0}>
              {messageSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary, as on the search page. The
 * profile reads `?user=` and `?username=` so a follow notification and the QR
 * share link can open another member's profile.
 */
export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
