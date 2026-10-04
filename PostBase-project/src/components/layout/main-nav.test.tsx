import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The nav's search control sat in the header with **no behaviour at all** for a
 * while — a placeholder that already carried a name and a hint, so it looked
 * more functional than it was. The decision to wire it up rather than delete it
 * is what this file holds: the control is an address, not a glyph.
 *
 * Three modules are stubbed to get the nav to render, and none of them is what
 * is under test. The nav reaches for the session, and the session reaches for
 * the Supabase client; the bell reaches for the notifications provider, which
 * throws without a provider above it. Mocking the bell keeps both out of this
 * process — a real render would drag a Supabase browser client and a Realtime
 * socket into a test about an `href`. What is asserted is only what the nav
 * itself writes.
 */
// Mutable rather than constant: which item the header marks as current is the
// whole of what the last two tests below are about, and one of them has to be
// able to ask from a different page than the other.
const mocks = vi.hoisted(() => ({ pathname: "/feed" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  mocks.pathname = "/feed";
});

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { email: "theo@example.com", name: "Theo Wu" },
  }),
}));

vi.mock("@/components/realtime/notification-bell", () => ({
  NotificationBell: () => <span data-bell="" />,
}));

import { MainNav } from "@/components/layout/main-nav";
import { mainNavItems } from "@/lib/nav-items";

function navHtml() {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MainNav />
    </TooltipProvider>,
  );
}

describe("MainNav", () => {
  test("sends the search control to the search page as a link", () => {
    // The whole anchor and its attributes, rather than a pattern over the page:
    // the order attributes come out in is React's to decide, and a `href`
    // anywhere on a page that also says "Search" would prove nothing.
    const anchor = navHtml().match(/<a[^>]*aria-label="Search"[^>]*>/)?.[0] ?? "";
    // An address on an anchor, so it can be middle-clicked, opened in a new tab
    // and announced as a link — none of which a `<button>` with a route `push`
    // can do.
    expect(anchor).toContain('href="/search"');
  });

  test("does not leave the search control as a button with nothing behind it", () => {
    const html = navHtml();
    expect(html).not.toMatch(/<button[^>]*aria-label="Search"/);
  });

  test("renders the control the nav is checked against at all", () => {
    // Without this, both assertions above would pass on a nav that rendered no
    // search control — the failure mode that started all of this.
    expect(navHtml()).toContain('aria-label="Search"');
  });

  test("says which item is the page the reader is already on", () => {
    const html = navHtml();
    // The stubbed path is `/feed`, so exactly one item is current.
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "").toContain('href="/feed"');
  });

  test("does not mark the other items as the page", () => {
    const html = navHtml();
    const marketplace = html.match(/<a[^>]*href="\/marketplace"[^>]*>/)?.[0] ?? "";
    expect(marketplace).not.toContain("aria-current");
  });

  test("offers exactly the three modules, and nothing that moved under Social", () => {
    const html = navHtml();
    for (const item of mainNavItems) {
      expect(html, `${item.label} is missing from the header`).toContain(`href="${item.href}"`);
    }
    // The four that used to sit beside them: three are Social's own surfaces and
    // one is a section of the profile. A header that still linked them would be
    // offering two ways to the same place.
    for (const gone of ["/groups", "/pages", "/messages", "/cover-studio"]) {
      expect(html, `${gone} is still in the header`).not.toContain(`href="${gone}"`);
    }
  });

  test("still says which module the reader is in from inside Social", () => {
    // Groups is not a header item any more, but a reader there is still in
    // Social — the header says so rather than going blank.
    mocks.pathname = "/groups";
    const html = navHtml();
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "").toContain('href="/feed"');
  });

  test("names the mobile menu button and says whether the panel is open", () => {
    // It used to be a nameless button that swapped a hamburger for an × — the
    // icon was the only thing that said whether the panel was open.
    const button = navHtml().match(/<button[^>]*aria-label="Open menu"[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-controls="mobile-nav"');
  });
});
