// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The strip on Social's pages, and the listing that now sits where three of
 * its tabs used to be.
 *
 * Two claims this file pins. The strip still appears on every Social path and
 * nowhere else — visibility follows the Social *module* rather than the tabs,
 * which is precisely what keeps it on the pages whose tabs were removed. And
 * the tabs are down to Feed: Groups, Pages and Messages are gone as links, not
 * merely unlit, so a strip that still shipped those destinations would mean
 * the removal never happened.
 *
 * The listing itself is judged in its own file (`online-now.test.tsx`); here
 * it is mocked to a testid so this file reads the strip's composition.
 */
const mocks = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/components/realtime/online-now", () => ({
  OnlineNow: () => <span data-testid="online-now" />,
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
  test("offers Feed, and none of the tabs that were removed", () => {
    const markup = html();
    expect(markup).toContain('href="/feed"');

    for (const gone of ["/groups", "/pages", "/messages"]) {
      expect(markup, `${gone} is still a tab in the strip`).not.toContain(`href="${gone}"`);
    }
    for (const label of ["Groups", "Pages", "Messages"]) {
      expect(markup, `the strip still says ${label}`).not.toContain(`>${label}<`);
    }
  });

  test("shows the online listing where the tabs used to be, on every Social path", () => {
    for (const path of ["/feed", "/groups", "/groups/abc", "/pages", "/pages/new", "/messages"]) {
      mocks.pathname = path;
      const markup = html();
      expect(markup, `${path} has no strip`).toContain('aria-label="Social"');
      expect(markup, `${path} has no online listing`).toContain('data-testid="online-now"');
    }
  });

  test("lights the Feed tab on the feed, and claims no tab it does not have", () => {
    mocks.pathname = "/feed";
    const onFeed = html();
    expect(onFeed.match(/aria-current="page"/g)?.length).toBe(1);
    expect(onFeed.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "").toContain('href="/feed"');

    // On a path whose tab no longer exists, the strip says nothing rather than
    // lighting Feed for it — the header is what announces Social from here.
    mocks.pathname = "/groups";
    expect(html()).not.toContain('aria-current="page"');
  });

  test("names the landmark, so it is not announced as one navigation among many", () => {
    expect(html()).toContain('aria-label="Social"');
  });

  test("renders nothing at all outside Social", () => {
    // The header already says Marketplace or Jobs, and a strip about Social on
    // the settings page would be furniture with no subject.
    for (const path of ["/marketplace", "/jobs", "/profile", "/settings", "/search"]) {
      mocks.pathname = path;
      expect(html(), `${path} rendered a Social strip`).not.toContain('aria-label="Social"');
    }
  });
});
