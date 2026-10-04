"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FollowButton } from "@/components/social/follow-button";
import { RefreshCw, Users } from "lucide-react";

export type MemberListMode = "followers" | "following";

/** The fields a list row needs; matches `GET /api/users/follow`. */
export interface MemberSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isFollowing: boolean;
}

/**
 * A follow change that touches the member whose list is open.
 *
 * `added` is carried by the database trigger rather than inferred from the
 * totals: a list needs to know the direction, and guessing it from the last
 * count it saw is wrong for exactly the events that matter (two changes between
 * renders, or a count corrected by anything else).
 */
export interface MemberListEvent {
  /** Monotonic, so two identical events still both apply. */
  seq: number;
  /** The member who joined or left the list. */
  memberId: string;
  added: boolean;
}

interface MemberListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Member whose list is shown. */
  userId: string | null;
  mode: MemberListMode;
  /** Whose list it is, for the heading. */
  ownerName?: string | null;
  /** Live total from the profile, so the heading agrees with the tile. */
  total?: number;
  /** Viewer's own id: their row is shown as "You" instead of a Follow button. */
  viewerId?: string | null;
  /** Latest follow event for this member, from the profile's subscription. */
  event?: MemberListEvent | null;
}

const PAGE_SIZE = 20;

export function MemberListDialog({
  open,
  onOpenChange,
  userId,
  mode,
  ownerName,
  total,
  viewerId,
  event,
}: MemberListDialogProps) {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Member whose row is being fetched after a live addition. The count moves
   * before the row can, so this is what keeps "Showing 0 of 1" from being
   * rendered next to "No followers yet" while that fetch is in flight.
   */
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);

  const title = mode === "followers" ? "Followers" : "Following";
  // "Following of Maya Chen" is not a sentence anyone would write.
  const heading = ownerName
    ? mode === "followers"
      ? `Followers of ${ownerName}`
      : `Members ${ownerName} follows`
    : title;
  /** Guards against a slow first page overwriting a newer one. */
  const requestRef = useRef(0);

  const loadFirstPage = useCallback(async () => {
    if (!userId) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/users/follow?userId=${encodeURIComponent(userId)}&type=${mode}&limit=${PAGE_SIZE}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Unable to load that list");
      const payload = await response.json();
      if (request !== requestRef.current) return;
      setMembers(Array.isArray(payload.data) ? payload.data : []);
      setCursor(payload.pagination?.nextCursor ?? null);
      // A fresh page supersedes any row that was still being fetched.
      setPendingAdd(null);
    } catch {
      if (request !== requestRef.current) return;
      setError("We couldn't load that list right now.");
      setMembers([]);
      setCursor(null);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [mode, userId]);

  // Opening the dialog loads the list; so does switching which list it is.
  useEffect(() => {
    if (!open || !userId) return;
    void loadFirstPage();
  }, [loadFirstPage, open, userId]);

  // Closing drops nothing: the rows are refetched on the next open, which also
  // re-reads the head of the list.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestRef.current += 1;
      setMembers([]);
      setCursor(null);
      setError(null);
      setPendingAdd(null);
    }
    onOpenChange(nextOpen);
  };

  const loadMore = async () => {
    if (!userId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/users/follow?userId=${encodeURIComponent(userId)}&type=${mode}&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Unable to load more");
      const payload = await response.json();
      setMembers((previous) => {
        const seen = new Set(previous.map((member) => member.id));
        return [...previous, ...(payload.data ?? []).filter((member: MemberSummary) => !seen.has(member.id))];
      });
      setCursor(payload.pagination?.nextCursor ?? null);
    } catch {
      setError("We couldn't load more of that list right now.");
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Applies a live follow change to the open list.
   *
   * A row is fetched by id rather than the whole list being refetched: the
   * order is newest-relationship-first, so an addition belongs at the top
   * wherever the reader has scrolled to, and a removal is a row we already know
   * the id of. Refetching page one would throw away any pages they loaded.
   */
  useEffect(() => {
    if (!open || !event) return;

    if (!event.added) {
      setMembers((previous) => previous.filter((member) => member.id !== event.memberId));
      return;
    }

    let cancelled = false;
    setPendingAdd(event.memberId);
    const addMember = async () => {
      try {
        // A summary rather than a whole profile: the row needs a name and an
        // avatar, while resolving a profile also ensures the viewer's own
        // profile exists and counts followers, which is most of the wait before
        // the row appears.
        const response = await fetch(
          `/api/users/brief?ids=${encodeURIComponent(event.memberId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error("Unable to load that member");
        const payload = await response.json();
        const row: MemberSummary | undefined = payload?.data?.[0];
        if (cancelled || !row?.id) return;
        const member: MemberSummary = {
          id: row.id,
          username: row.username ?? "member",
          displayName: row.displayName ?? row.username ?? "Member",
          avatarUrl: row.avatarUrl ?? null,
          bio: row.bio ?? null,
          isFollowing: Boolean(row.isFollowing),
        };
        setMembers((previous) =>
          previous.some((existing) => existing.id === member.id) ? previous : [member, ...previous]
        );
      } catch {
        // A member we could not fetch is one row missing until the list is
        // reopened; the count in the heading has already moved either way.
      } finally {
        if (!cancelled) setPendingAdd((current) => (current === event.memberId ? null : current));
      }
    };
    void addMember();
    return () => {
      cancelled = true;
    };
  }, [event, open]);

  const shown = members.length;
  const totalLabel =
    typeof total === "number" ? `Showing ${shown} of ${total.toLocaleString()}` : `Showing ${shown}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="border-b border-surface-border px-5 py-4">
          <DialogTitle className="text-base">{heading}</DialogTitle>
          <DialogDescription aria-live="polite">
            {typeof total === "number" && total > 0
              ? totalLabel
              : mode === "followers"
              ? "Members who follow this profile."
              : "Members this profile follows."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-3 p-5" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : error && members.length === 0 ? (
            <EmptyState
              icon={<RefreshCw className="h-8 w-8" />}
              title={`${title} unavailable`}
              description={error}
              action={
                <Button variant="outline" size="sm" onClick={() => void loadFirstPage()}>
                  Try again
                </Button>
              }
            />
          ) : members.length === 0 && pendingAdd ? (
            <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading a new member">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ) : members.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title={mode === "followers" ? "No followers yet" : "Not following anyone yet"}
              description={
                mode === "followers"
                  ? "When somebody follows this profile, they will appear here."
                  : "The profiles this member follows will appear here."
              }
            />
          ) : (
            <ul className="divide-y divide-surface-border">
              {members.map((member) => {
                const isViewer = Boolean(viewerId) && member.id === viewerId;
                return (
                  <li key={member.id} className="flex items-center gap-3 px-5 py-3">
                    <Link
                      href={`/profile?user=${encodeURIComponent(member.id)}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Avatar className="h-10 w-10">
                        {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
                        <AvatarFallback>{(member.displayName || "M")[0]}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-navy-800">
                          {member.displayName}
                          {isViewer && <span className="ml-1 text-xs text-muted-foreground">· You</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{member.username}
                        </span>
                        {member.bio && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {member.bio}
                          </span>
                        )}
                      </span>
                    </Link>
                    {!isViewer && (
                      <FollowButton
                        userId={member.id}
                        initialFollowing={member.isFollowing}
                        subjectName={member.displayName}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {(cursor || (error && members.length > 0)) && (
          <div className="border-t border-surface-border px-5 py-3">
            {error && members.length > 0 && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {cursor && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
