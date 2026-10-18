// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { useTypingAnnouncer } from "./use-typing-announcer";

/**
 * The composer's half of the typing indicator — the two frames and the
 * timing between them.
 *
 * The hook is driven through a probe that hands back its methods, with a fake
 * `send` in place of the socket and fake timers in place of the clock: what is
 * under test is *when* a frame goes out — the first keystroke announces,
 * continuing keystrokes refresh on a beat rather than per press, a pause
 * sends the stop, and every way the announcement can end sends exactly one
 * stop, only if an announcement was made.
 */
const send = vi.fn();
let latest: ReturnType<typeof useTypingAnnouncer> | null = null;

function Probe({ conversationId }: { conversationId: string | null }) {
  latest = useTypingAnnouncer(send, conversationId);
  return null;
}

function mountAnnouncer(conversationId: string | null = "c1") {
  return mountSurface(<Probe conversationId={conversationId} />, { providers: "none" });
}

/** The frames sent so far, parsed. */
function frames(): { type: string; conversationId?: string }[] {
  return send.mock.calls.map(([message]) => message);
}

beforeEach(() => {
  vi.useFakeTimers();
  send.mockClear();
  latest = null;
});

afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTypingAnnouncer", () => {
  test("announces the first keystroke at once, and refreshes on a beat rather than per press", () => {
    mountAnnouncer();

    act(() => latest!.onType());
    expect(frames()).toEqual([{ type: "typing", conversationId: "c1" }]);

    // A typist keeps typing inside the refresh window: no flood of frames.
    act(() => {
      vi.advanceTimersByTime(500);
      latest!.onType();
      latest!.onType();
    });
    expect(frames()).toEqual([{ type: "typing", conversationId: "c1" }]);

    // Past the beat — but still typing, so before the quiet window closes —
    // a refresh keeps the listener's memory of them alive.
    act(() => {
      vi.advanceTimersByTime(2999);
      latest!.onType();
    });
    expect(frames()).toEqual([
      { type: "typing", conversationId: "c1" },
      { type: "typing", conversationId: "c1" },
    ]);
  });

  test("sends stop-typing once the typist goes quiet", () => {
    mountAnnouncer();

    act(() => latest!.onType());
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(frames()).toEqual([
      { type: "typing", conversationId: "c1" },
      { type: "stop-typing", conversationId: "c1" },
    ]);
  });

  test("release ends the announcement now — and only once", () => {
    mountAnnouncer();

    act(() => latest!.onType());
    act(() => latest!.release());
    act(() => latest!.release());

    expect(frames()).toEqual([
      { type: "typing", conversationId: "c1" },
      { type: "stop-typing", conversationId: "c1" },
    ]);
  });

  test("sends no stop for an announcement that was never made", () => {
    mountAnnouncer();

    act(() => latest!.release());

    expect(frames()).toEqual([]);
  });

  test("switching conversations stops the old thread's announcement before starting the new one", async () => {
    const ui = mountAnnouncer("c1");
    act(() => latest!.onType());

    await ui.render(<Probe conversationId="c2" />);
    act(() => latest!.onType());

    expect(frames()).toEqual([
      { type: "typing", conversationId: "c1" },
      { type: "stop-typing", conversationId: "c1" },
      { type: "typing", conversationId: "c2" },
    ]);
  });

  test("says nothing at all while there is no conversation to say it for", () => {
    mountAnnouncer(null);

    act(() => latest!.onType());
    act(() => latest!.release());

    expect(frames()).toEqual([]);
  });
});
