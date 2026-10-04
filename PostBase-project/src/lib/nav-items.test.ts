import { describe, expect, test } from "vitest";
import { isNavItemActive, mainNavItems, socialNavItems } from "@/lib/nav-items";

/**
 * The navigation has one list because it is drawn in three places — the header,
 * the phone's bottom bar and the Social strip — and a destination that the
 * header offers but the bottom bar does not is a bug this file is here to catch.
 */
describe("mainNavItems", () => {
  test("is Social, Marketplace and Jobs, in that order", () => {
    expect(mainNavItems.map((item) => item.label)).toEqual(["Social", "Marketplace", "Jobs"]);
  });

  test("is what a nav item is drawn from", () => {
    // Every item has to be able to render itself: a label for the text, an icon
    // for the glyph and at least one prefix to compare a path against.
    for (const item of mainNavItems) {
      expect(item.label.trim().length, `${item.href} has no label`).toBeGreaterThan(0);
      expect(item.icon, `${item.href} has no icon`).toBeTruthy();
      expect(item.matches.length, `${item.href} matches nothing`).toBeGreaterThan(0);
      expect(item.matches, `${item.href} is not where it goes`).toContain(item.href);
    }
  });

  test("keeps the surfaces that used to be items out of the header", () => {
    // Groups, Pages and Messages are inside Social now, and the cover studio is a
    // section of the profile. None of them may come back as a destination of its
    // own — though `/groups` and its siblings are still *matched* by Social,
    // which is how the header stays lit while a reader is in one of them.
    const hrefs = mainNavItems.map((item) => item.href);
    for (const gone of ["/groups", "/pages", "/messages", "/cover-studio"]) {
      expect(hrefs, `${gone} is a destination in the main navigation`).not.toContain(gone);
    }
  });
});

describe("socialNavItems", () => {
  test("is the four surfaces under Social, in the order the strip draws them", () => {
    expect(socialNavItems.map((item) => item.label)).toEqual([
      "Feed",
      "Groups",
      "Pages",
      "Messages",
    ]);
  });

  test("covers exactly the paths Social stands for", () => {
    // The strip's reach and the header's Social item have to be the same set: a
    // path with a strip but no lit header, or the other way round, would be a
    // reader being told two different things.
    const social = mainNavItems.find((item) => item.label === "Social");
    expect(social?.matches).toEqual(socialNavItems.map((item) => item.href));
  });
});

describe("isNavItemActive", () => {
  const social = mainNavItems[0];
  const marketplace = mainNavItems[1];
  const jobs = mainNavItems[2];

  test("keeps Social lit everywhere inside Social", () => {
    for (const path of ["/feed", "/groups", "/pages", "/messages", "/groups/abc", "/pages/new"]) {
      expect(isNavItemActive(path, social), `${path} does not light Social`).toBe(true);
    }
  });

  test("does not light Social anywhere else", () => {
    for (const path of ["/marketplace", "/jobs", "/profile", "/settings", "/", "/search"]) {
      expect(isNavItemActive(path, social), `${path} lights Social`).toBe(false);
    }
  });

  test("matches on path boundaries, not on prefixes of words", () => {
    // The bug a bare `startsWith` has: `/marketplaces` and `/jobs-board` are not
    // the Marketplace and the Jobs board, and a route that merely begins with
    // the same letters must not light the item.
    expect(isNavItemActive("/marketplaces", marketplace)).toBe(false);
    expect(isNavItemActive("/jobs-board", jobs)).toBe(false);
    expect(isNavItemActive("/feeds", social)).toBe(false);
    // But a path *under* an item is that item.
    expect(isNavItemActive("/marketplace/listing-1", marketplace)).toBe(true);
    expect(isNavItemActive("/jobs/123", jobs)).toBe(true);
  });

  test("reads a trailing slash as the same place", () => {
    expect(isNavItemActive("/jobs/", jobs)).toBe(true);
    expect(isNavItemActive("/jobs", jobs)).toBe(true);
  });

  test("lights exactly one main item, whatever the path", () => {
    const paths = [
      "/feed",
      "/groups",
      "/groups/abc",
      "/pages/new",
      "/pages/some-page",
      "/messages",
      "/marketplace",
      "/jobs",
      "/profile",
      "/",
    ];
    for (const path of paths) {
      const lit = mainNavItems.filter((item) => isNavItemActive(path, item));
      // A reader is in one place, and the header says so in one place. `/` and
      // the member's own pages belong to no item, which is why the count may be
      // zero as well.
      expect(lit.length, `${path} lights ${lit.length} items`).toBeLessThanOrEqual(1);
    }
  });
});
