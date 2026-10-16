// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { MessageReactions } from "./message-reactions";
import { CHAT_REACTIONS } from "@/lib/chat-reactions";

/**
 * The bubble's reaction row: what a reader sees of the counts, and where a
 * press goes.
 *
 * The chips are toggles and are pinned as such — `aria-pressed` carries
 * whether the reader is part of the count beside their emoji, and the name
 * spells both the count and the press's outcome, so the ring a sighted reader
 * sees is the state a screen reader announces. The picker is a disclosure:
 * closed it is a button that says so (`aria-expanded`, `aria-controls`), open
 * it is one named button per emoji of the vocabulary — and nothing outside it.
 */
afterEach(() => {
  cleanupSurfaces();
});

function renderRow(
  props: Partial<ComponentProps<typeof MessageReactions>> = {},
): { ui: MountedSurface; onToggle: ReturnType<typeof vi.fn> } {
  const onToggle = vi.fn();
  const ui = mountSurface(
    <MessageReactions
      reactions={[{ type: "heart", count: 2, mine: false }]}
      onToggle={onToggle}
      {...props}
    />,
  );
  return { ui, onToggle };
}

function named(ui: MountedSurface, name: string) {
  return [...ui.container.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === name,
  );
}

describe("a message's reaction chips", () => {
  test("draws the count, and says the press would add the reader to it", () => {
    const { ui } = renderRow();

    const chip = named(ui, "heart reaction, 2 reactions — add your reaction");
    expect(chip).toBeDefined();
    expect(chip!.getAttribute("aria-pressed")).toBe("false");
    expect(chip!.textContent).toContain("2");
  });

  test("rings the reader's own reaction and names the press as a removal", () => {
    const { ui } = renderRow({
      reactions: [
        { type: "heart", count: 2, mine: true },
        { type: "fire", count: 1, mine: false },
      ],
    });

    const mine = named(ui, "heart reaction, 2 reactions — remove your reaction");
    expect(mine!.getAttribute("aria-pressed")).toBe("true");
    // The other type is untouched by the reader's standing on the first.
    expect(named(ui, "fire reaction, 1 reaction — add your reaction")).toBeDefined();
  });

  test("a press on a chip is that type, to the page's handler", () => {
    const { ui, onToggle } = renderRow({
      reactions: [
        { type: "heart", count: 2, mine: true },
        { type: "fire", count: 1, mine: false },
      ],
    });

    named(ui, "fire reaction, 1 reaction — add your reaction")!.click();

    expect(onToggle).toHaveBeenCalledWith("fire");
  });

  test("a type the vocabulary does not know still draws, by its stored name", () => {
    const { ui } = renderRow({ reactions: [{ type: "like", count: 1, mine: false }] });

    expect(named(ui, "like reaction, 1 reaction — add your reaction")).toBeDefined();
  });

  test("stands still while a toggle is in flight", () => {
    const { ui } = renderRow({ disabled: true });

    const chip = named(ui, "heart reaction, 2 reactions — add your reaction")!;
    const picker = named(ui, "React to message")!;
    expect(chip.hasAttribute("disabled")).toBe(true);
    expect(picker.hasAttribute("disabled")).toBe(true);
  });
});

describe("the picker a bubble opens", () => {
  test("is a disclosure: closed it says so, and controls a region of its own", async () => {
    const { ui } = renderRow();

    const trigger = named(ui, "React to message")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The region is mounted only while open — the state the attribute reports
    // is the whole truth about what is on screen.
    expect(ui.container.querySelector('[role="group"][aria-label="Choose a reaction"]')).toBeNull();

    await act(async () => {
      trigger.click();
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const region = ui.container.querySelector(
      '[role="group"][aria-label="Choose a reaction"]',
    ) as HTMLElement;
    expect(region).not.toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBe(region.id);
  });

  test("offers exactly the vocabulary, each emoji named in words", async () => {
    const { ui } = renderRow();

    await act(async () => {
      named(ui, "React to message")!.click();
    });

    for (const option of CHAT_REACTIONS) {
      expect(named(ui, `React with ${option.label}`)).toBeDefined();
    }
    expect(
      ui.container.querySelectorAll('[role="group"][aria-label="Choose a reaction"] button'),
    ).toHaveLength(CHAT_REACTIONS.length);
  });

  test("a pick is that type, and shuts the picker behind it", async () => {
    const { ui, onToggle } = renderRow();

    const trigger = named(ui, "React to message")!;
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      named(ui, "React with fire")!.click();
    });

    expect(onToggle).toHaveBeenCalledWith("fire");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(ui.container.querySelector('[role="group"][aria-label="Choose a reaction"]')).toBeNull();
  });
});
