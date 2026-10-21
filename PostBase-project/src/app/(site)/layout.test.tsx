import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The landing page's group mounts `AppChrome` — the same composition the
 * signed-in app and the static pages mount — judged here through the mocked
 * chrome pieces, so the test reads the layout's own wiring rather than any
 * component's internals.
 */
vi.mock("@/components/layout/app-chrome", () => ({
  AppChrome: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-chrome">{children}</div>
  ),
}));

import SiteLayout from "./layout";

describe("the site layout", () => {
  it("renders the children inside AppChrome", () => {
    const html = renderToStaticMarkup(<SiteLayout><p>landing</p></SiteLayout>);

    expect(html).toContain('data-testid="app-chrome"');
    expect(html).toContain("landing");
    expect(html.indexOf('data-testid="app-chrome"')).toBeLessThan(html.indexOf("landing"));
  });
});
