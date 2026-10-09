import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The signed-in layout exists to compose the two things every page under it
 * needs a copy of once: the Social strip — so the Social surfaces and the Pages
 * sub-routes all get it — and the shared presence channel the strip and the
 * page's own presence reads answer through together. The strip decides for
 * itself which paths show it, so the layout's job is to render both, in the
 * right relation to each other and to the children, which is what this pins.
 */
vi.mock("@/components/layout/social-nav", () => ({
  SocialNav: () => <nav data-testid="social-nav">Social</nav>,
}));

// Mocked so the wiring is visible in the markup: the real provider renders no
// DOM of its own, so a rendered assertion could not tell it was there. What it
// *does* — one socket for every consumer asking through it — is its own test.
vi.mock("@/components/providers/presence-provider", () => ({
  PresenceProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="presence-provider">{children}</div>
  ),
}));

import MainLayout from "./layout";

function render(children: ReactNode) {
  return renderToStaticMarkup(<MainLayout>{children}</MainLayout>);
}

describe("the main layout", () => {
  it("renders the Social strip and the page's own children", () => {
    const html = render(<p>hello</p>);
    expect(html).toContain('data-testid="social-nav"');
    expect(html).toContain("<p>hello</p>");
    // The strip is above the children.
    expect(html.indexOf("social-nav")).toBeLessThan(html.indexOf("<p>hello</p>"));
    // Both are inside the shared channel: the provider is what makes the
    // strip's presence reads and the page's one connection instead of two, so
    // it has to wrap *both* of them, not sit beside either.
    expect(html).toContain('data-testid="presence-provider"');
    expect(html.indexOf("presence-provider")).toBeLessThan(html.indexOf("social-nav"));
    expect(html.indexOf("presence-provider")).toBeLessThan(html.indexOf("<p>hello</p>"));
  });
});
