// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { TypingIndicator } from "@/components/realtime/typing-indicator";

/**
 * The typing indicator, driven by a fake websocket message.
 *
 * The component has one job: turn the last message it was handed into the line
 * a reader sees. So the test hands it messages — as a render, since the hook
 * returns a new value only when the component re-renders — and reads the words.
 * The socket itself is not the subject; the mapping from message to sentence is,
 * including the three shapes of sentence (one, two, several) and the guards for
 * a message that is for another conversation or carries the wrong field types.
 */
const mocks = vi.hoisted(() => ({
  lastMessage: null as Record<string, unknown> | null,
}));

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ lastMessage: mocks.lastMessage }),
}));

const CONVERSATION = "conversation-1";

/** Mounts the indicator, then re-renders it with whatever `lastMessage` now is. */
async function say(message: Record<string, unknown> | null, conversationId = CONVERSATION) {
  mocks.lastMessage = message;
  const ui = mountSurface(<TypingIndicator conversationId={conversationId} />, { providers: "none" });
  if (message) {
    await ui.render(<TypingIndicator conversationId={conversationId} />);
  }
  return ui;
}

afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.lastMessage = null;
});

describe("TypingIndicator", () => {
  test("renders nothing while nobody is typing", () => {
    const ui = mountSurface(<TypingIndicator conversationId={CONVERSATION} />, { providers: "none" });
    expect(ui.container.textContent).toBe("");
  });

  test("says someone is typing for a single reader", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    expect(ui.container.textContent).toContain("Someone is typing");
  });

  test("ignores a typing message for another conversation", async () => {
    const ui = await say({ type: "typing", conversationId: "elsewhere", userId: "u2", timestamp: Date.now() });
    expect(ui.container.textContent).toBe("");
  });

  test("does not add the same reader twice", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    const stamp = Date.now();
    mocks.lastMessage = { type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: stamp };
    await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    // Still one reader, so still the singular sentence.
    expect(ui.container.textContent).toContain("Someone is typing");
    expect(ui.container.textContent).not.toContain("2 people");
  });

  test("counts two readers", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    mocks.lastMessage = { type: "typing", conversationId: CONVERSATION, userId: "u3", timestamp: Date.now() };
    await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    expect(ui.container.textContent).toContain("2 people are typing");
  });

  test("says several for three or more", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    for (const userId of ["u3", "u4"]) {
      mocks.lastMessage = { type: "typing", conversationId: CONVERSATION, userId, timestamp: Date.now() };
      await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    }
    expect(ui.container.textContent).toContain("Several people are typing");
  });

  test("stops listing a reader who sends stop-typing", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    mocks.lastMessage = { type: "typing", conversationId: CONVERSATION, userId: "u3", timestamp: Date.now() };
    await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    mocks.lastMessage = { type: "stop-typing", conversationId: CONVERSATION, userId: "u2" };
    await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    expect(ui.container.textContent).toContain("Someone is typing");
  });

  test("stops listing a reader who sends a message", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    mocks.lastMessage = { type: "message", conversationId: CONVERSATION, userId: "u2" };
    await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    expect(ui.container.textContent).toBe("");
  });

  test("ignores a message with no usable reader id", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: 42, timestamp: Date.now() });
    expect(ui.container.textContent).toBe("");
  });

  test("ignores a typing message with no usable timestamp", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: "soon" });
    expect(ui.container.textContent).toBe("");
  });

  test("ignores a stop-typing message with no usable reader id", async () => {
    const ui = await say({ type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() });
    mocks.lastMessage = { type: "stop-typing", conversationId: CONVERSATION, userId: 7 };
    await ui.render(<TypingIndicator conversationId={CONVERSATION} />);
    expect(ui.container.textContent).toContain("Someone is typing");
  });

  test("drops a reader whose typing has gone stale", async () => {
    vi.useFakeTimers();
    mocks.lastMessage = {
      type: "typing",
      conversationId: CONVERSATION,
      userId: "u2",
      // Older than the five-second window the sweep enforces.
      timestamp: Date.now() - 10_000,
    };
    const ui = mountSurface(<TypingIndicator conversationId={CONVERSATION} />, { providers: "none" });
    await act(async () => {});
    // The count only moves on the sweep's tick, which is the point: a stale
    // indicator is removed by time passing, not by another message arriving.
    expect(ui.container.textContent).toContain("Someone is typing");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(ui.container.textContent).toBe("");
  });

  test("carries the caller's className on the line it renders", async () => {
    mocks.lastMessage = { type: "typing", conversationId: CONVERSATION, userId: "u2", timestamp: Date.now() };
    const ui = mountSurface(<TypingIndicator conversationId={CONVERSATION} className="mt-4" />, {
      providers: "none",
    });
    await ui.render(<TypingIndicator conversationId={CONVERSATION} className="mt-4" />);
    const line = ui.container.firstElementChild as HTMLElement | null;
    expect(line?.className).toContain("mt-4");
  });
});
