import { describe, expect, it } from "vitest";
import {
  CHAT_REACTIONS,
  applyReactionToggle,
  chatReactionEmoji,
  chatReactionLabel,
  isChatReactionType,
} from "./chat-reactions";

/**
 * The vocabulary and the toggle arithmetic, pinned where they live.
 *
 * The vocabulary is the contract three readers share — the API accepts only
 * what it names, the picker offers only what it names, the chip draws only what
 * it names — so its shape is held rather than described. The arithmetic is the
 * pure half of a press: one reaction per member per message, so a press moves
 * the reader off whatever they held and onto what they pressed.
 */
describe("the chat reaction vocabulary", () => {
  it("offers distinct types, each with words and a glyph", () => {
    const types = CHAT_REACTIONS.map((option) => option.type);
    expect(new Set(types).size).toBe(types.length);
    for (const option of CHAT_REACTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.emoji.length).toBeGreaterThan(0);
      expect(isChatReactionType(option.type)).toBe(true);
    }
  });

  it("refuses a type it cannot draw — the post's words included", () => {
    expect(isChatReactionType("like")).toBe(false);
    expect(isChatReactionType("")).toBe(false);
    expect(isChatReactionType(42)).toBe(false);
    expect(isChatReactionType(null)).toBe(false);
  });

  it("falls back to the stored type for a row the vocabulary does not know", () => {
    // A reaction written before a type was retired must still read: the words
    // and the glyph both degrade to what is stored rather than to nothing.
    expect(chatReactionLabel("like")).toBe("like");
    expect(chatReactionEmoji("like")).toBe("like");
  });
});

describe("the arithmetic a confirmed toggle leaves behind", () => {
  it("puts the reader on a type they had not pressed", () => {
    expect(applyReactionToggle([], "heart", true)).toEqual([
      { type: "heart", count: 1, mine: true },
    ]);
  });

  it("joins a count without touching the other types", () => {
    const current = [
      { type: "heart", count: 2, mine: false },
      { type: "fire", count: 1, mine: false },
    ];
    expect(applyReactionToggle(current, "heart", true)).toEqual([
      { type: "heart", count: 3, mine: true },
      { type: "fire", count: 1, mine: false },
    ]);
  });

  it("takes the reader off a repeated press, leaving what the others gave", () => {
    const current = [
      { type: "heart", count: 2, mine: true },
      { type: "fire", count: 1, mine: false },
    ];
    // The reader's heart comes off; the counterpart's stays — the count drops
    // by one rather than to nothing.
    expect(applyReactionToggle(current, "heart", false)).toEqual([
      { type: "heart", count: 1, mine: false },
      { type: "fire", count: 1, mine: false },
    ]);
  });

  it("drops the type entirely when the reader was its only one", () => {
    expect(
      applyReactionToggle([{ type: "heart", count: 1, mine: true }], "heart", false),
    ).toEqual([]);
  });

  it("moves the reader from one type to another — never mine twice", () => {
    // The replace the server does, applied to the list on screen: the press
    // was on fire while the reader still held a heart, so the heart loses
    // their count and the fire gains it.
    const current = [
      { type: "heart", count: 3, mine: true },
      { type: "fire", count: 1, mine: false },
    ];
    const next = applyReactionToggle(current, "fire", true);
    expect(next).toEqual([
      { type: "heart", count: 2, mine: false },
      { type: "fire", count: 2, mine: true },
    ]);
    expect(next.filter((entry) => entry.mine)).toHaveLength(1);
  });

  it("leaves the caller's list untouched — the next press reads the last verdict", () => {
    const current = [{ type: "heart", count: 1, mine: true }];
    applyReactionToggle(current, "heart", false);
    expect(current).toEqual([{ type: "heart", count: 1, mine: true }]);
  });
});
