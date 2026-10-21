import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The static pages' group mounts `AppChrome`, the same composition `(site)` and
 * `(main)` mount — about/term pages keep the public header and footer they
 * always had, while the auth group alone declines it. Mocked to a testid so the
 * assertion is about this layout's wiring, not the chrome's internals.
 */
vi.mock("@/components/layout/app-chrome", () => ({
  AppChrome: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-chrome">{children}</div>
  ),
}));

import StaticLayout from "./layout";

describe("the static layout", () => {
  it("renders the children inside AppChrome", () => {
    const html = renderToStaticMarkup(<StaticLayout><p>about page</p></StaticLayout>);

    expect(html).toContain('data-testid="app-chrome"');
    expect(html).toContain("about page");
    expect(html.indexOf('data-testid="app-chrome"')).toBeLessThan(html.indexOf("about page"));
  });
});
