import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Online/offline was a green dot and a grey dot, and nothing else: the colour
 * was the entire message, which also happens to be the pair a reader with a
 * red-green deficiency is most likely to lose. The words are now always in the
 * markup — hidden when the caller does not want them on screen — and the dot is
 * marked decorative so it cannot be announced as nothing in particular.
 *
 * The presence hook is stubbed rather than driven: it reads a WebSocket that
 * never connects in this suite, and what is under test is what this component
 * renders from the answer, not where the answer comes from.
 */
const presence = vi.hoisted(() => ({ online: true, lastSeen: "2 hours ago" as string | null }));

vi.mock("@/hooks/use-presence", () => ({
  usePresence: () => ({
    isUserOnline: () => presence.online,
    formatLastSeen: () => presence.lastSeen,
  }),
}));

import { OnlineStatus } from "@/components/realtime/online-status";

describe("OnlineStatus", () => {
  test("says online even when the dot is all that is drawn", () => {
    presence.online = true;
    const html = renderToStaticMarkup(<OnlineStatus userId="someone" />);
    expect(html).toContain("Online");
    // Hidden from sight, not from a screen reader.
    expect(html).toContain("sr-only");
  });

  test("says when they were last seen instead", () => {
    presence.online = false;
    presence.lastSeen = "2 hours ago";
    const html = renderToStaticMarkup(<OnlineStatus userId="someone" />);
    expect(html).toContain("Last seen 2 hours ago");
    expect(html).not.toContain(">Online<");
  });

  test("says offline rather than last-seen-unknown", () => {
    // With no presence to go on, "Last seen Unknown" is what a straight
    // interpolation produced — and it only became visible copy the moment the
    // words started to be announced at all.
    presence.online = false;
    presence.lastSeen = null;
    const html = renderToStaticMarkup(<OnlineStatus userId="someone" />);
    expect(html).toContain("Offline");
    expect(html).not.toContain("Last seen");
    expect(html).not.toContain("Unknown");
  });

  test("shows the same words rather than announcing something else", () => {
    presence.online = true;
    const html = renderToStaticMarkup(<OnlineStatus userId="someone" showText />);
    expect(html).toContain("Online");
    // Visible, so nothing needs hiding.
    expect(html).not.toContain("sr-only");
  });

  test("keeps the dot out of the announcement", () => {
    presence.online = true;
    const html = renderToStaticMarkup(<OnlineStatus userId="someone" />);
    // A coloured dot has no text, so leaving it exposed only adds noise.
    expect(html).toMatch(/<span aria-hidden="true"[^>]*rounded-full/);
  });
});
