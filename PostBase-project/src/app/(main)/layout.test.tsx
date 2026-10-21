import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The signed-in layout exists to compose the things every page under it needs a
 * copy of once: the Social strip — so the Social surfaces and the Pages
 * sub-routes all get it — the shared presence channel the strip and the page's
 * own presence reads answer through together, and the veil a section change is
 * covered by. The strip decides for itself which paths show it, so the layout's
 * job is to render all of them, in the right relation to each other and to the
 * children, which is what this pins. The header, footer, bottom bar and chat
 * bubble live one level down in `AppChrome` (shared with the landing and static
 * groups), so it is mocked here — this file's subject is what the group *adds*.
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

// The chrome is the root layout's old composition, shared by three route
// groups; the app-chrome test judges that composition in full. Marked here so
// this file reads only the group's own shell decisions.
vi.mock("@/components/layout/app-chrome", () => ({
  AppChrome: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-chrome">{children}</div>
  ),
}));

// The transition reads the address, and there is no app router in a server // render of the layout — the real `usePathname` would throw rather than hand
 // back the path this assertion is written against. Stubbed to the feed so the
// markup below shows the veil naming the section the reader is already on,
// which is the state it rests in: mounted, transparent, covering nothing.
vi.mock("next/navigation", () => ({
  usePathname: () => "/feed",
}));

import MainLayout from "./layout";

function render(children: ReactNode) {
  return renderToStaticMarkup(<MainLayout>{children}</MainLayout>);
}

/** The veil's own element, read off the z-index only it carries. */
function transition(html: string) {
  return html.match(/<div[^>]*z-\[60\][^>]*>/)?.[0] ?? "";
}

describe("the main layout", () => {
  it("renders the Social strip and the page's own children", () => {
    const html = render(<p>hello</p>);
    expect(html).toContain('data-testid="app-chrome"');
    expect(html).toContain('data-testid="social-nav"');
    expect(html).toContain("<p>hello</p>");
    // The strip is above the children, inside the chrome's page well.
    expect(html.indexOf("app-chrome")).toBeLessThan(html.indexOf("social-nav"));
    expect(html.indexOf("social-nav")).toBeLessThan(html.indexOf("<p>hello</p>"));
    // Both are inside the shared channel: the provider is what makes the
    // strip's presence reads and the page's one connection instead of two, so
    // it has to wrap *both* of them, not sit beside either.
    expect(html).toContain('data-testid="presence-provider"');
    expect(html.indexOf("presence-provider")).toBeLessThan(html.indexOf("app-chrome"));
    expect(html.indexOf("presence-provider")).toBeLessThan(html.indexOf("social-nav"));
    expect(html.indexOf("presence-provider")).toBeLessThan(html.indexOf("<p>hello</p>"));
  });

  it("renders the section transition, wrapped with the rest", () => {
    const html = render(<p>hello</p>);
    // Not a mock's marker but the real component: the name it carries is the
    // section of the stubbed address, which only the component itself can write.
    const veil = transition(html);
    expect(veil, "the layout renders no veil to cover a section change with").not.toBe("");
    expect(html).toMatch(/>Feed</);
    // At rest it is mounted but transparent — it is not covering the page the
    // reader is already on, which is the whole of what the first render does.
    expect(veil).toContain("opacity-0");
    expect(veil).toContain("pointer-events-none");
    // Inside the channel and inside the chrome, and above the strip: the veil
    // is drawn over the page, never in its place.
    expect(html.indexOf("presence-provider")).toBeLessThan(html.indexOf("z-[60]"));
    expect(html.indexOf("z-[60]")).toBeLessThan(html.indexOf("social-nav"));
    expect(html.indexOf("z-[60]")).toBeLessThan(html.indexOf("<p>hello</p>"));
  });
});
