/**
 * The chat's reaction vocabulary, and the arithmetic a confirmed toggle leaves
 * behind.
 *
 * One list, three readers: the API accepts only types named here, the picker
 * offers exactly these, and the chip draws the same emoji the row's `type`
 * stands for — so a reaction the server can store is one the picker can send
 * and one the chip can draw, by construction rather than by agreement.
 *
 * The stored value is the ASCII `type` (`"heart"`), not the emoji. The column
 * stays greppable and translatable, and the emoji is a rendering of the type —
 * the same line the post's `"like"` draws rather than storing a glyph.
 */
export const CHAT_REACTIONS = [
  { type: "heart", emoji: "❤️", label: "heart" },
  { type: "thumbs", emoji: "👍", label: "thumbs up" },
  { type: "laugh", emoji: "😂", label: "laughing" },
  { type: "wow", emoji: "😮", label: "surprised" },
  { type: "sad", emoji: "😢", label: "sad" },
  { type: "fire", emoji: "🔥", label: "fire" },
] as const;

export type ChatReactionType = (typeof CHAT_REACTIONS)[number]["type"];

/** Whether a value is one of the types the vocabulary can draw. */
export function isChatReactionType(value: unknown): value is ChatReactionType {
  return (
    typeof value === "string" &&
    CHAT_REACTIONS.some((option) => option.type === value)
  );
}

/** The words a screen reader says for a type; the type itself as a fallback. */
export function chatReactionLabel(type: string): string {
  return CHAT_REACTIONS.find((option) => option.type === type)?.label ?? type;
}

/** The glyph a type draws; the type itself where the vocabulary has no glyph. */
export function chatReactionEmoji(type: string): string {
  return CHAT_REACTIONS.find((option) => option.type === type)?.emoji ?? type;
}

/**
 * One emoji's standing on one message, as the thread read hands it over.
 *
 * `mine` rides with the count because the chip is a toggle: whether the press
 * adds or removes is whether the reader is already part of the number.
 */
export interface MessageReactionSummary {
  type: string;
  count: number;
  mine: boolean;
}

/**
 * The list a *confirmed* toggle leaves behind.
 *
 * One reaction per member per message, so a press is three moves at once:
 * the pressed type gains the reader (or loses them), and any *other* type the
 * reader had on this message loses them — the server's replace, applied to the
 * list the screen is holding. Pure, so the page applies the server's verdict
 * and the test reads the same function the screen does.
 */
export function applyReactionToggle(
  current: MessageReactionSummary[],
  type: string,
  reacted: boolean,
): MessageReactionSummary[] {
  // The reader's standing comes off everywhere first; a confirmed reaction
  // then puts it back on the pressed type alone.
  const withoutMine = current
    .map((entry) =>
      entry.mine ? { ...entry, count: entry.count - 1, mine: false } : entry,
    )
    .filter((entry) => entry.count > 0);

  if (!reacted) return withoutMine;

  const existing = withoutMine.find((entry) => entry.type === type);
  if (existing) {
    return withoutMine.map((entry) =>
      entry.type === type ? { ...entry, count: entry.count + 1, mine: true } : entry,
    );
  }
  return [...withoutMine, { type, count: 1, mine: true }];
}
