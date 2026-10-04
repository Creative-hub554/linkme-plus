"use client";

import { useEffect, useState } from "react";
import { ToggleButton } from "@/components/ui/toggle-button";
import { Loader2, UserCheck, UserPlus } from "lucide-react";

interface PageFollowButtonProps {
  /** The Page to follow. Required: the button writes to the API. */
  pageId: string;
  initialFollowing?: boolean;
  /** New state, plus the Page's follower total when the server reported one. */
  onChange?: (following: boolean, followers?: number) => void;
  size?: "default" | "sm" | "lg";
  /**
   * The Page's name, for the accessible name. "Follow" on its own does not say
   * what is being followed, and a Page can sit beside other named Pages.
   */
  subjectName?: string | null;
}

/**
 * Follow / Following for a Page.
 *
 * The same component contract as `FollowButton` — one boolean drives the words
 * and `ToggleButton` derives the fill and `aria-pressed` from it together — and
 * the same optimistic write with a rollback. What differs is only the endpoint:
 * a Page is not a member, so this posts to `/api/pages/follow`, and the two
 * routes are separate for the same reason `page_follows` is a separate table.
 */
export function PageFollowButton({
  pageId,
  initialFollowing = false,
  onChange,
  size = "sm",
  subjectName,
}: PageFollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A list reuses this button for different Pages.
  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing, pageId]);

  const handleClick = async () => {
    if (pending) return;

    const next = !following;
    setFollowing(next);
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/pages/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The intended state, not a toggle: a stale view must not unfollow.
        body: JSON.stringify({ pageId, following: next }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || !payload) throw new Error("Follow request failed");

      const settled = Boolean(payload.following);
      setFollowing(settled);
      onChange?.(settled, typeof payload.followers === "number" ? payload.followers : undefined);
    } catch {
      setFollowing(!next);
      setError("We couldn't update that follow. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <ToggleButton
        pressed={following}
        size={size}
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        aria-label={subjectName ? `${following ? "Unfollow" : "Follow"} ${subjectName}` : undefined}
        title={error ?? undefined}
      >
        {pending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : following ? (
          <UserCheck className="mr-1 h-4 w-4" />
        ) : (
          <UserPlus className="mr-1 h-4 w-4" />
        )}
        {following ? "Following" : "Follow"}
      </ToggleButton>
      <span role="status" aria-live="polite" className="sr-only">
        {error ?? ""}
      </span>
    </>
  );
}
