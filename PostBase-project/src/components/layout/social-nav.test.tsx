// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { socialNavItems } from "@/lib/nav-items";

/**
 * The strip is the whole of the navigation between the four surfaces under
 * Social, so two things are worth pinning: that it appears where it is the only
 * way between them, and that it stays out of the way everywhere else. The path
 * is a mutable stub rather than a constant because "everywhere else" is half of
 * the claim.
 */
const mocks = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import { SocialNav } from "@/components/layout/social-nav";

function html() {
  return renderToStaticMarkup(<SocialNav />);
}

beforeEach(() => {
  mocks.pathname = "/feed";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SocialNav", () => {
  test("offers every Social surface, on every Social path", () => {
    for (const path of ["/feed", "/groups", "/groups/abc", "/pages", "/pages/new", "/messages"]) {
      mocks.pathname = path;
      const markup = html();
      for (const item of socialNavItems) {
        expect(markup, `${item.label} is missing on ${path}`).toContain(`href="${item.href}"`);
      }
    }
  });

  test("says which surface the reader is on, and says it once", () => {
    mocks.pathname = "/groups";
    const markup = html();
    expect(markup.match(/aria-current="page"/g)?.length).toBe(1);
    expect(markup.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "").toContain('href="/groups"');
  });

  test("names the group it links to, so the landmark is not anonymous", () => {
    // A `nav` without a name is announced as "navigation" among however many
    // others the page has; this one is the only way between four surfaces.
    expect(html()).toContain('aria-label="Social"');
  });

  test("treats a Page's own address as the Pages tab", () => {
    // `/pages/<username>` is a Page rather than the directory, and the tab that
    // got the reader there is the one that should stay lit.
    mocks.pathname = "/pages/northwind_studio";
    const markup = html();
    expect(markup.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "").toContain('href="/pages"');
  });

  test("renders nothing at all outside Social", () => {
    // The header already says Marketplace or Jobs, and a tab strip about Social
    // on the settings page would be furniture with no subject.
    for (const path of ["/marketplace", "/jobs", "/profile", "/settings", "/search"]) {
      mocks.pathname = path;
      expect(html(), `${path} rendered a Social strip`).not.toContain("aria-label=\"Social\"");
    }
  });
});
