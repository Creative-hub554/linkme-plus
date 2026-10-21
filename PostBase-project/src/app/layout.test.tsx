import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * The root layout is the *document* shell now, and deliberately nothing more:
 * `<html>`/`<body>`, the blocking theme script, and the two providers every
 * route group sits inside — theme and auth. The chrome (nav, page well, footer,
 * bottom bar, chat bubble) and the notification/realtime providers moved out of
 * it into `AppChrome`, which each non-auth layout mounts; the auth layout mounts
 * none of it, so a sign-in screen is no longer surrounded by the application's
 * own header. These tests pin what the root still does and — as much as an
 * absence can be pinned — what it has stopped doing, so the chrome cannot
 * creep back under a signing-in reader.
 */
vi.mock("@/components/layout/main-nav", () => ({ MainNav: () => <nav data-testid="main-nav" /> }));
vi.mock("@/components/layout/bottom-nav", () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock("@/components/chat/chat-bubble", () => ({ ChatBubble: () => <div data-testid="chat-bubble" /> }));
// A provider mock returns its children directly rather than JSX, because the
// factory runs before any module-level helper could be defined.
vi.mock("@/components/auth-provider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/providers/notification-provider", () => ({
  NotificationProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/providers/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/providers/theme-sync", () => ({ ThemeSync: () => null }));
vi.mock("@/components/providers/room-provider", () => ({
  RoomProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="room-provider">{children}</div>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));

import RootLayout, { metadata } from "./layout";

function render(children: ReactNode) {
  return renderToStaticMarkup(<RootLayout>{children}</RootLayout>);
}

describe("the root layout", () => {
  it("describes the app", () => {
    expect(metadata.title).toContain("LinkMe+");
    expect(typeof metadata.description).toBe("string");
  });

  it("renders the document shell around the children and nothing else", () => {
    const html = render(<p>page body</p>);

    expect(html).toContain('<html lang="en"');
    expect(html).toContain('<body class="min-h-screen bg-surface-light-blue">');
    expect(html).toContain("<p>page body</p>");
  });

  it("carries no app chrome of its own", () => {
    const html = render(<p>page body</p>);

    // What `AppChrome` would draw — absent here because the root is the one
    // shell even the standalone auth pages pass through.
    expect(html).not.toContain('data-testid="main-nav"');
    expect(html).not.toContain('data-testid="bottom-nav"');
    expect(html).not.toContain('data-testid="footer"');
    expect(html).not.toContain('data-testid="chat-bubble"');
    expect(html).not.toContain('data-testid="room-provider"');
  });

  it("applies the theme before first paint with the blocking init script", () => {
    const html = render(<p>page body</p>);
    // The script is the pre-paint theme application; it has to be inline in the
    // document, not deferred to an effect.
    expect(html).toContain(THEME_INIT_SCRIPT);
    expect(html.indexOf(THEME_INIT_SCRIPT)).toBeLessThan(html.indexOf("<body"));
  });
});
