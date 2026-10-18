"use client";

import { useId, useState } from "react";
import { SmilePlus } from "lucide-react";
import { DisclosureButton } from "@/components/ui/disclosure-button";
import {
  CHAT_REACTIONS,
  chatReactionEmoji,
  chatReactionLabel,
  type ChatReactionType,
  type MessageReactionSummary,
} from "@/lib/chat-reactions";

interface MessageReactionsProps {
  /** The standing of each emoji on this message, as the thread read sent it. */
  reactions: MessageReactionSummary[];
  /** One press of a type — chip or picker — is one of these. */
  onToggle: (type: ChatReactionType) => void;
  /** A toggle in flight: the chips stand still until its answer lands. */
  disabled?: boolean;
}

/**
 * What a message has gathered, and the door to adding to it.
 *
 * The chips are toggles, not badges: `aria-pressed` says whether the reader is
 * part of the count beside their emoji, and the name spells both the count and
 * the press's outcome — so the state a sighted reader sees in the ring is the
 * state a screen reader announces, from one string. The picker is a
 * disclosure rather than a hover: a reaction you can only reach with a mouse
 * is a reaction half the members cannot give, and the open state is reported
 * by the same component that carries it (see `DisclosureButton`).
 *
 * The emoji is drawn `aria-hidden` under a name that spells it in words —
 * glyph-first controls otherwise announce nothing but "button".
 */
export function MessageReactions({
  reactions,
  onToggle,
  disabled = false,
}: MessageReactionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerId = useId();

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const label = chatReactionLabel(reaction.type);
        return (
          <button
            key={reaction.type}
            type="button"
            aria-pressed={reaction.mine}
            aria-label={`${label} reaction, ${reaction.count} ${
              reaction.count === 1 ? "reaction" : "reactions"
            } — ${reaction.mine ? "remove your reaction" : "add your reaction"}`}
            onClick={() => onToggle(reaction.type as ChatReactionType)}
            disabled={disabled}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
              reaction.mine
                ? "border-brand-blue bg-brand-blue/10"
                : "border-surface-border bg-background/60"
            } ${disabled ? "opacity-60" : "hover:bg-surface-light-blue"}`}
          >
            <span aria-hidden="true">{chatReactionEmoji(reaction.type)}</span>
            <span aria-hidden="true">{reaction.count}</span>
          </button>
        );
      })}
      <DisclosureButton
        open={pickerOpen}
        controls={pickerId}
        label="React to message"
        disabled={disabled}
        onClick={() => setPickerOpen((open) => !open)}
        className="h-6 w-6 text-muted-foreground"
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </DisclosureButton>
      {pickerOpen && (
        <div
          id={pickerId}
          role="group"
          aria-label="Choose a reaction"
          className="flex items-center gap-0.5 rounded-full border border-surface-border bg-background px-1 py-0.5"
        >
          {CHAT_REACTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              aria-label={`React with ${option.label}`}
              disabled={disabled}
              onClick={() => {
                setPickerOpen(false);
                onToggle(option.type);
              }}
              className="rounded-full p-1 text-sm leading-none transition-colors hover:bg-surface-light-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <span aria-hidden="true">{option.emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
