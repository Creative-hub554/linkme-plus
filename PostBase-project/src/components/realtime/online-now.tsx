"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";

/** One member as the roster answers them: who they are, and whether they are here. */
interface OnlineMember {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  online: boolean;
}

/** How often the strip beats — a third of the server's freshness window. */
const HEARTBEAT_MS = 30_000;
/** Faces the strip draws before the rest of the roster is simply not shown. */
const SHOWN = 8;

/**
 * The member listing that took the Social strip's tabs' place: who is around,
 * as avatars with names and a status each.
 *
 * The listing is the heartbeat as much as the render — every interval it posts
 * to `/api/presence`, which counts the reader in *and* answers with the
 * roster, so what is on screen is always the answer to the beat that just
 * happened. It renders nothing signed out, for the same reason the chat
 * bubble does not: the API would answer a visitor 401, and a list that only
 * ever fails is furniture, not information.
 *
 * A failed beat keeps whatever is already shown rather than replacing it —
 * a roster one request older is more useful than no listing at all — and with
 * nothing to show yet there is no half-drawn block in the strip.
 */
export function OnlineNow() {
  const { session } = useSession();
  // The id, not the session object: a client is free to hand back a fresh
  // reference on every render, and an effect keyed on that would beat, render,
  // beat again — a loop whose only visible symptom is a browser asking this
  // endpoint over and over. The id is the thing that actually changes.
  const userId = session?.user?.id;
  const [members, setMembers] = useState<OnlineMember[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const beat = async () => {
      try {
        const response = await fetch("/api/presence", { method: "POST", cache: "no-store" });
        if (!response.ok) throw new Error("The roster did not answer");
        const payload = (await response.json()) as { users?: OnlineMember[] };
        if (!cancelled && Array.isArray(payload.users)) setMembers(payload.users);
      } catch {
        // The last roster stays on screen; only the beat itself is lost.
      }
    };

    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  if (!userId || members.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-l border-surface-border pl-3">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">Online now</span>
      {/* The roster arrives online-first, so this slice cannot cut a live
          member off the end to show an idle one. */}
      <ul className="flex items-center gap-3">
        {members.slice(0, SHOWN).map((member) => {
          const name = member.displayName ?? "Member";
          return (
            <li key={member.userId} className="flex items-center gap-1.5">
              <Avatar className="h-6 w-6">
                {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
                <AvatarFallback className="text-[10px]">{name[0]}</AvatarFallback>
              </Avatar>
              <span className="max-w-[6rem] truncate text-xs text-navy-700">{name}</span>
              {/* The dot is a colour; this is what says which one. The words
                  sit after the name, so a reader taking the list in order gets
                  "Maya Chen Online" rather than an orphaned status. */}
              <StatusIndicator
                label={member.online ? "Online" : "Offline"}
                tone={member.online ? "success" : "neutral"}
                size="sm"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
