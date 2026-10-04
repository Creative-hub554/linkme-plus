import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The signed-in layout exists for one reason: to mount the Social strip once so
 * the Social surfaces and the Pages sub-routes all get it. The strip decides for
 * itself which paths show it, so the layout's only job is to render it above its
 * children — which is what this pins.
 */
vi.mock("@/components/layout/social-nav", () => ({
  SocialNav: () => <nav data-testid="social-nav">Social</nav>,
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
  });
});
