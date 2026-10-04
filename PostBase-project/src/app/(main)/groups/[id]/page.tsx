"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GroupComposer } from "@/components/groups/group-composer";
import { PostCard } from "@/components/social/post-card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatPostTime } from "@/lib/post-time";
import { Loader2, Lock, Users } from "lucide-react";

interface GroupSummary {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  visibility?: string | null;
}

interface GroupPostMedia {
  url: string;
  type: string;
}

interface GroupPost {
  id: string;
  content?: string | null;
  createdAt: string;
  visibility?: string | null;
  editedAt?: string | null;
  commentCount?: number;
  reactionCount?: number;
  media?: GroupPostMedia[];
  author?: { name?: string | null; username?: string | null; avatarUrl?: string | null };
}

/**
 * A group: the members' own place to post.
 *
 * The counterpart of the Page view, and deliberately not the same. A Page speaks
 * as itself and only its admins may make it speak; a group is its members, so
 * any of them may post, and every post is attributed to the person who wrote it
 * rather than to the group. The audience is not chosen either — a post published
 * here is one the group can read, which is what publishing here means.
 *
 * Membership is the whole of the gate. A group's posts come back from the
 * membership arm of the audience rule, so a non-member is not shown a list with
 * a lock drawn over it: they are shown no list, and told the one thing that would
 * give them one. A private group cannot even be described to a non-member — that
 * is the group route's own check — so this page only ever renders the notice for
 * a public one.
 */
export default function GroupView() {
  const params = useParams<{ id: string }>();
  const groupId = Array.isArray(params?.id) ? params.id[0] : params?.id ?? "";

  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [members, setMembers] = useState(0);
  const [isMember, setIsMember] = useState(false);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const loadPosts = useCallback(async (id: string) => {
    const response = await fetch(`/api/posts?groupId=${encodeURIComponent(id)}&limit=20`);
    if (!response.ok) throw new Error("Failed to load the group's posts");
    const payload = await response.json();
    setPosts(Array.isArray(payload?.data) ? payload.data : []);
  }, []);

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const response = await fetch(`/api/groups?id=${encodeURIComponent(groupId)}`);
      if (response.status === 404 || response.status === 403) {
        // A private group answers 403 to a non-member, and both are "there is
        // nothing here you may see" from this page's point of view.
        setMissing(true);
        setGroup(null);
        return;
      }
      if (!response.ok) throw new Error("Failed to load this group");
      const payload = await response.json();
      setGroup(payload.group);
      setMembers(payload?.stats?.members ?? 0);
      const member = Boolean(payload?.isMember);
      setIsMember(member);
      // Only a member has a list to read: the audience rule admits a group post
      // to its members alone, so anybody else would be making the trip for an
      // empty answer.
      if (member) {
        await loadPosts(payload.group.id);
      } else {
        setPosts([]);
      }
    } catch {
      setError("We couldn't load this group. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [groupId, loadPosts]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMembership = async () => {
    if (!group || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const response = await fetch("/api/groups/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update membership");
      const member = Boolean(payload.member);
      setIsMember(member);
      setMembers((current) => Math.max(0, current + (member ? 1 : -1)));
      // Joining is what makes the posts readable, so the list is read *then* —
      // and leaving is what takes it away again, so the same call empties it.
      if (member) {
        await loadPosts(group.id);
      } else {
        setPosts([]);
      }
    } catch (membershipError) {
      setJoinError(
        membershipError instanceof Error ? membershipError.message : "Unable to update membership",
      );
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12" aria-busy="true" aria-label="Loading group">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading group...
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="Group not found"
          description="This group may have been removed, or it may only be visible to its members."
          action={
            <Link href="/groups">
              <Button variant="outline">Browse groups</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? "We couldn't load this group."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Card className="overflow-hidden">
        {group.coverUrl && (
          <div className="h-32 w-full bg-ink-800 sm:h-40">
            {/* Decorative: the group's name is the heading right below it. */}
            <img src={group.coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16 shrink-0 ring-2 ring-brand-purple/10">
              <AvatarFallback className="bg-brand-purple/10 text-lg font-semibold text-brand-purple">
                {group.name[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold text-navy-800">{group.name}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" aria-hidden="true" />
                {members.toLocaleString()} member{members === 1 ? "" : "s"}
              </p>
            </div>
            {/* One control per action: a member's way out lives here, and a
                stranger's way in lives in the notice below, where the copy
                explains what joining does. Two buttons reading "Join group"
                would also be two controls a reader cannot tell apart. */}
            {isMember && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void toggleMembership()}
                disabled={joining}
              >
                {joining && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Leave group
              </Button>
            )}
          </div>
          {group.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-navy-700">
              {group.description}
            </p>
          )}
          {joinError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {joinError}
            </p>
          )}
        </CardContent>
      </Card>

      {isMember && (
        <Card className="mt-4">
          <CardContent className="p-4 sm:p-5">
            <GroupComposer groupId={group.id} groupName={group.name} onPosted={() => loadPosts(group.id)} />
          </CardContent>
        </Card>
      )}

      {/* A non-member's whole page is the group's identity and the way in: the
          posts above are not withheld for effect, they are unreadable. */}
      {isMember ? (
        <section className="mt-4 space-y-4" aria-label={`Posts in ${group.name}`}>
          {posts.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No posts yet"
              description={`Nobody has posted in ${group.name} yet. Start the conversation.`}
            />
          ) : (
            posts.map((post) => {
              const media = post.media?.find(
                (item) =>
                  item.type.toLowerCase().startsWith("image") ||
                  item.type.toLowerCase().startsWith("video"),
              );
              return (
                <PostCard
                  key={post.id}
                  id={post.id}
                  // The member who wrote it, which is who a group post is by: a
                  // group speaks in the voices of the people in it.
                  author={{
                    name: post.author?.name ?? "A member",
                    username: post.author?.username ?? "member",
                    avatar: post.author?.avatarUrl ?? undefined,
                  }}
                  content={post.content ?? ""}
                  image={media?.url}
                  mediaType={media?.type}
                  time={formatPostTime(post.createdAt)}
                  likes={post.reactionCount ?? 0}
                  comments={post.commentCount ?? 0}
                  shares={0}
                  visibility={post.visibility ?? undefined}
                  groupName={group.name}
                  edited={Boolean(post.editedAt)}
                />
              );
            })
          )}
        </section>
      ) : (
        <Card className="mt-4">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Lock className="h-8 w-8 text-brand-purple/60" aria-hidden="true" />
            <h2 className="text-base font-semibold text-navy-800">
              Join {group.name} to see its posts
            </h2>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              This is a place for its members. Join it and the conversation appears here.
            </p>
            <Button onClick={() => void toggleMembership()} disabled={joining}>
              {joining && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Join group
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
