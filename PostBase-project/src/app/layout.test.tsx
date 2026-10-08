import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * The root layout is the app's one shell: `<html>`/`<body>`, the providers the
 * whole tree sits inside, and the blocking theme script. Every provider and
 * chrome piece is mocked here, so the test reads this file's own composition —
 * the script is in `<head>`, the providers wrap the children, and the nav,
 * footer and bottom bar are all present.
 */
vi.mock("@/components/layout/main-nav", () => ({ MainNav: () => <nav data-testid="main-nav" /> }));
vi.mock("@/components/layout/bottom-nav", () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <footer data-testid="footer" /> }));
// The bubble reads the auth context through `useAuth`, which this file's
// `auth-provider` mock does not export — so, like every other chrome piece, it
// is mocked to its testid and the composition is what is judged.
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

  it("renders the document shell around the children and the chrome", () => {
    const html = render(<p>page body</p>);

    expect(html).toContain('<html lang="en"');
    expect(html).toContain('<body class="min-h-screen bg-surface-light-blue">');
    expect(html).toContain("<p>page body</p>");
    expect(html).toContain('data-testid="main-nav"');
    expect(html).toContain('data-testid="bottom-nav"');
    expect(html).toContain('data-testid="footer"');
    expect(html).toContain('data-testid="chat-bubble"');
  });

  it("applies the theme before first paint with the blocking init script", () => {
    const html = render(<p>page body</p>);
    // The script is the pre-paint theme application; it has to be inline in the
    // document, not deferred to an effect.
    expect(html).toContain(THEME_INIT_SCRIPT);
    expect(html.indexOf(THEME_INIT_SCRIPT)).toBeLessThan(html.indexOf("<body"));
  });
});
