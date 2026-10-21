import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The chrome every non-auth layout mounts, judged by its own composition: the
 * nav above the page well, the footer and phone bar below it, the bubble last,
 * and the shared room connection around all of it — chrome and children alike —
 * because the messages page below joins the socket this provider runs. Each
 * piece is mocked to its testid; what a piece does is its own test.
 */
vi.mock("@/components/layout/main-nav", () => ({ MainNav: () => <nav data-testid="main-nav" /> }));
vi.mock("@/components/layout/bottom-nav", () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock("@/components/chat/chat-bubble", () => ({ ChatBubble: () => <div data-testid="chat-bubble" /> }));
vi.mock("@/components/auth-provider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/providers/notification-provider", () => ({
  NotificationProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="notification-provider">{children}</div>
  ),
}));
vi.mock("@/components/providers/room-provider", () => ({
  RoomProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="room-provider">{children}</div>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));

import { AppChrome } from "./app-chrome";

function render(children: ReactNode) {
  return renderToStaticMarkup(<AppChrome>{children}</AppChrome>);
}

describe("AppChrome", () => {
  it("draws nav, page well, footer, bottom bar and bubble around the children", () => {
    const html = render(<p>page body</p>);

    expect(html).toContain('data-testid="main-nav"');
    expect(html).toContain("page body");
    expect(html).toContain('data-testid="footer"');
    expect(html).toContain('data-testid="bottom-nav"');
    expect(html).toContain('data-testid="chat-bubble"');
    // The children sit inside the page well, between the header and the footer.
    expect(html.indexOf('data-testid="main-nav"')).toBeLessThan(html.indexOf("page body"));
    expect(html.indexOf("page body")).toBeLessThan(html.indexOf('data-testid="footer"'));
  });

  it("wraps the shared room connection around the chrome and the children", () => {
    const html = render(<p>page body</p>);

    expect(html).toContain('data-testid="room-provider"');
    expect(html.indexOf("room-provider")).toBeLessThan(html.indexOf('data-testid="main-nav"'));
    expect(html.indexOf("room-provider")).toBeLessThan(html.indexOf("page body"));
    expect(html.indexOf("room-provider")).toBeLessThan(html.indexOf('data-testid="chat-bubble"'));
    expect(html).toContain('data-testid="notification-provider"');
  });
});
