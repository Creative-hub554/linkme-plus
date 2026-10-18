"use client";

import { useSession } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { usePresenceFlags } from "@/hooks/use-presence-flags";

/** Faces the strip draws before the rest of the online members are not shown. */
const SHOWN = 8;

/**
 * The member listing that took the Social strip's tabs' place: the members
 * who are actually here, as avatars with names and a live dot each.
 *
 * **Who is here is not this strip's question to answer any more — it reads the
 * one answer.** The roster, the socket's snapshot and the frames that move it
 * all live in {@link usePresenceFlags}, the hook a listing's rows and a lone
 * indicator read too; this strip contributes the slice it has room for and the
 * faces, from the same roster those rows were judged against. It used to keep
 * a copy of those halves here, and two copies of "who is here" is exactly how
 * one surface ends up showing a member green while another shows them grey.
 *
 * The strip asks a narrower question than a listing does: an idle avatar under
 * "Online now" is a promise the listing should not make, so the flagged-offline
 * rows are dropped before the slice draws — and with nobody left under that
 * heading, no listing at all, rather than an empty one.
 *
 * It renders nothing signed out, for the same reason the chat bubble does
 * not: the API would answer a visitor 401, and a list that only ever fails is
 * furniture, not information. A failed beat or a silent socket keeps whatever
 * is already shown rather than replacing it — a roster one request older is
 * more useful than no listing at all.
 */
export function OnlineNow() {
  const { session } = useSession();
  const userId = session?.user?.id;
  // One ask for every surface that reads it — the strip included, so the
  // listing, the conversation column and this row of faces are readings of the
  // same roster and the same socket rather than three opinions.
  const { roster, isOnline } = usePresenceFlags(true);

  // Only the members who are actually here: the socket decides while there is
  // one, the roster's flags stand in when there is not — and the faces come
  // from that roster, in its online-first order, so this slice takes the first
  // faces of the live members and cannot cut one off the end to show somebody
  // who is not here.
  const present = (roster ?? []).filter((member) => isOnline(member.userId) === true);
  if (!userId || present.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-l border-surface-border pl-3">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">Online now</span>
      <ul className="flex items-center gap-3">
        {present.slice(0, SHOWN).map((member) => {
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
                  "Maya Chen Online" rather than an orphaned status — and only
                  members who cleared the window are ever in this list, so the
                  words never have to say anything else. */}
              <StatusIndicator label="Online" tone="success" size="sm" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
