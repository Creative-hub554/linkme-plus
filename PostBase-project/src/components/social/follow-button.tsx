"use client";

import { useEffect, useState } from "react";
import { ToggleButton } from "@/components/ui/toggle-button";
import { Loader2, UserCheck, UserPlus } from "lucide-react";

interface FollowButtonProps {
  /** Member to follow. Required: the button writes to the API. */
  userId: string;
  initialFollowing?: boolean;
  /** New state, plus the target's follower total when the server reported one. */
  onChange?: (following: boolean, followers?: number) => void;
  size?: "default" | "sm" | "lg";
  /**
   * Whose follow button this is, for the accessible name. A row in a list of
   * members otherwise announces a bare "Follow" with no idea who it applies to.
   */
  subjectName?: string | null;
}

/**
 * Follow / Following, backed by the API.
 *
 * The click is optimistic so the button responds immediately, and it is rolled
 * back if the request fails — the state flipping back is the feedback. It sends
 * the *intended* state rather than relying on the server to toggle, so a stale
 * view can never unfollow somebody by accident.
 */
export function FollowButton({
  userId,
  initialFollowing = false,
  onChange,
  size = "sm",
  subjectName,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A list of results reuses this button for different people.
  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing, userId]);

  const handleClick = async () => {
    if (pending) return;

    const next = !following;
    setFollowing(next);
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/users/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, following: next }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || !payload) throw new Error("Follow request failed");

      const settled = Boolean(payload.following);
      setFollowing(settled);
      onChange?.(
        settled,
        typeof payload.followers === "number" ? payload.followers : undefined,
      );
    } catch {
      setFollowing(!next);
      setError("We couldn't update that follow. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {/* The fill and `aria-pressed` come from `following` together — the state
          is one boolean, so the button cannot look followed while saying it is
          not. The words change with it too, which is the other half of the
          announcement. */}
      <ToggleButton
        pressed={following}
        size={size}
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        aria-label={
          subjectName
            ? `${following ? "Unfollow" : "Follow"} ${subjectName}`
            : undefined
        }
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
