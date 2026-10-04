"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageComposer } from "@/components/pages/page-composer";
import { PageEditDialog } from "@/components/pages/page-edit-dialog";
import { PageFollowButton } from "@/components/pages/page-follow-button";
import { PostCard } from "@/components/social/post-card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatPostTime } from "@/lib/post-time";
import { Flag, Loader2, Lock, Pencil } from "lucide-react";

interface PageSummary {
  id: string;
  username: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  category?: string | null;
}

interface PagePostMedia {
  url: string;
  type: string;
}

interface PagePost {
  id: string;
  content?: string | null;
  createdAt: string;
  visibility?: string | null;
  editedAt?: string | null;
  commentCount?: number;
  reactionCount?: number;
  media?: PagePostMedia[];
}

/**
 * A Page: a public account's own page.
 *
 * Everything a reader is shown here is the *Page's* identity, including the
 * posts — the API returns the admin who published each one as `author` (they
 * own the row), but the Page is what the post was published as and what a reader
 * should see, so the page's identity is what gets passed to `PostCard`. That is
 * also why the composer exists only for an admin: the Page speaks, and only the
 * people who run it may speak for it. The role comes from the server rather than
 * from comparing ids, because a Page can have more than one admin.
 *
 * A reader with no connection to the Page — no role, not following — meets it
 * rather than opening it: the identity above is shown, the posts are not, and
 * the way in is the follow control the gate is built around. Following is the
 * whole of the lock, so it opens where the reader is standing: nothing is
 * refetched to discover that they are allowed in. The gate is not a privacy
 * boundary — the audience rule is, and it stays the thing that decides what a
 * reader may read. This decides what a reader is shown.
 */
export default function PageView() {
  const params = useParams<{ username: string }>();
  const username = Array.isArray(params?.username) ? params.username[0] : params?.username ?? "";

  const [page, setPage] = useState<PageSummary | null>(null);
  const [followers, setFollowers] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [posts, setPosts] = useState<PagePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const loadPosts = useCallback(async (pageId: string) => {
    const response = await fetch(`/api/posts?pageId=${encodeURIComponent(pageId)}&limit=20`);
    if (!response.ok) throw new Error("Failed to load the Page's posts");
    const payload = await response.json();
    setPosts(Array.isArray(payload?.data) ? payload.data : []);
  }, []);

  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const response = await fetch(`/api/pages?username=${encodeURIComponent(username)}`);
      if (response.status === 404) {
        setMissing(true);
        setPage(null);
        return;
      }
      if (!response.ok) throw new Error("Failed to load this Page");
      const payload = await response.json();
      setPage(payload.page);
      setFollowers(payload?.stats?.followers ?? 0);
      setIsFollowing(Boolean(payload?.isFollowing));
      setRole(payload?.role ?? null);
      // A gated reader's posts are not requested at all. Asking and discarding
      // would be the same picture on screen and a needless request behind it —
      // and the server's answer would be public posts the gate is about to hide.
      if (payload?.role || payload?.isFollowing) {
        await loadPosts(payload.page.id);
      } else {
        setPosts([]);
      }
    } catch {
      setError("We couldn't load this Page. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [username, loadPosts]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12" aria-busy="true" aria-label="Loading Page">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Page...
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          icon={<Flag className="h-8 w-8" />}
          title="Page not found"
          description="No Page is using that address. It may have been renamed or removed."
          action={
            <Link href="/pages">
              <Button variant="outline">Browse Pages</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? "We couldn't load this Page."}
        </p>
      </div>
    );
  }

  const isAdmin = role === "admin";
  // No role and no follow edge: the reader has no relationship with this Page,
  // so they get its identity and the way to follow it. Any role at all opens it
  // — a Page's team may be more than its admins, and only the admin may edit or
  // post, which the composer and the Edit control already say separately.
  const gated = !role && !isFollowing;
  const follow = (following: boolean, total?: number) => {
    setIsFollowing(following);
    if (typeof total === "number") setFollowers(total);
    // The gate's edge is the audience rule's edge: a `followers` post becomes
    // readable exactly while this is true, in both directions, and the server
    // decides which posts that is. Following is therefore what makes the list
    // appear the first time, not a refresh of a list already there.
    void loadPosts(page.id);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Card className="overflow-hidden">
        {page.coverUrl && (
          <div className="h-32 w-full bg-ink-800 sm:h-40">
            {/* Decorative: the Page's name is the heading right below it. */}
            <img src={page.coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16 shrink-0 ring-2 ring-brand-blue/10">
              <AvatarImage src={page.avatarUrl ?? undefined} alt={`${page.name} profile picture`} />
              <AvatarFallback className="bg-brand-blue/10 text-lg font-semibold text-brand-blue">
                {page.name[0]}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold text-navy-800">{page.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm text-muted-foreground">@{page.username}</span>
                {page.category && <Badge variant="secondary">{page.category}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {followers} follower{followers === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Only an admin of this Page may change it, and the role comes
                  from the server — the same source the composer's gate reads. */}
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="mr-1 h-4 w-4" />
                  Edit Page
                </Button>
              )}
              {/* One follow control on the page, never two: while the gate is up
                  it lives in the gate, where the copy explains what following
                  does, rather than beside a heading that is still hiding the
                  posts it would open. */}
              {!gated && (
                <PageFollowButton
                  pageId={page.id}
                  initialFollowing={isFollowing}
                  subjectName={page.name}
                  onChange={follow}
                />
              )}
            </div>
          </div>
          {page.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-navy-700">{page.description}</p>
          )}
          {isAdmin && (
            <p className="mt-3 text-xs font-medium text-muted-foreground">
              You are an admin of this Page.
            </p>
          )}
        </CardContent>
      </Card>

      {gated && (
        <Card className="mt-4">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Lock className="h-8 w-8 text-brand-blue/60" aria-hidden="true" />
            <h2 className="text-base font-semibold text-navy-800">
              Follow {page.name} to see its posts
            </h2>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              {page.name} shares with the people who follow it. Follow it and its posts appear
              here.
            </p>
            <PageFollowButton
              pageId={page.id}
              initialFollowing={isFollowing}
              subjectName={page.name}
              onChange={follow}
            />
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="mt-4">
          <CardContent className="p-4 sm:p-5">
            <PageComposer pageId={page.id} pageName={page.name} onPosted={() => loadPosts(page.id)} />
          </CardContent>
        </Card>
      )}

      {/* Nothing at all for a gated reader: the gate above is the whole of their
          page, and an empty state under it would read as "this Page has nothing"
          rather than "you are not following it". */}
      {!gated && (
        <section className="mt-4 space-y-4" aria-label={`Posts by ${page.name}`}>
          {posts.length === 0 ? (
            <EmptyState
              icon={<Flag className="h-8 w-8" />}
              title="No posts yet"
              description={`${page.name} hasn't published anything yet.`}
            />
          ) : (
            posts.map((post) => {
              const media = post.media?.find(
                (item) =>
                  item.type.toLowerCase().startsWith("image") || item.type.toLowerCase().startsWith("video"),
              );
              return (
                <PostCard
                  key={post.id}
                  id={post.id}
                  // The Page is the author a reader sees. The member who pressed
                  // publish is recorded on the row, not shown here.
                  author={{ name: page.name, username: page.username, avatar: page.avatarUrl ?? undefined }}
                  content={post.content ?? ""}
                  image={media?.url}
                  mediaType={media?.type}
                  time={formatPostTime(post.createdAt)}
                  likes={post.reactionCount ?? 0}
                  comments={post.commentCount ?? 0}
                  shares={0}
                  visibility={post.visibility ?? undefined}
                  edited={Boolean(post.editedAt)}
                />
              );
            })
          )}
        </section>
      )}

      {isAdmin && (
        <PageEditDialog
          pageId={page.id}
          name={page.name}
          description={page.description ?? null}
          avatarUrl={page.avatarUrl ?? null}
          coverUrl={page.coverUrl ?? null}
          open={editing}
          onOpenChange={setEditing}
          // Merged rather than refetched: the dialog has just been told what
          // the server stored, so a request here could only race it.
          onSaved={(patch) => setPage((current) => (current ? { ...current, ...patch } : current))}
        />
      )}
    </div>
  );
}
