import {
  Home,
  ShoppingBag,
  Briefcase,
  Users,
  Flag,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * The app's navigation, in one place.
 *
 * The header, the phone's bottom bar and the Social tab strip are three
 * renderings of the same two lists, and they used to be three separate arrays —
 * which is how the bottom bar could offer a destination the header did not.
 * Everything that draws navigation reads from here.
 *
 * `matches` is separate from `href` because a nav item can stand for a whole
 * module. Social has no page of its own: it *is* the four surfaces under it, so
 * its href is the feed while its matches are all four, and it stays lit while a
 * reader is in Groups, Pages or Messages.
 */
export interface NavItem {
  /** Where the item goes when it is clicked. One of {@link matches}. */
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * The path prefixes this item stands for. A reader is "on" this item when the
   * current path is one of them or sits under it.
   */
  matches: string[];
  /**
   * Whether the destination needs a session behind it. Social is a feed of
   * follows — signed out, `/feed` redirects to login — while the marketplace
   * and jobs pages are the product's public discovery, reachable without an
   * account. Advertising a link the reader will be bounced from is the same
   * broken promise as advertising one that 404s.
   */
  requiresAuth?: boolean;
}

/** The whole of the main navigation: Social, and the two modules beside it. */
export const mainNavItems: NavItem[] = [
  {
    // Social is a module rather than a page: the feed is the door, and Groups,
    // Pages and Messages answer to the same nav item. The feed is built from
    // follows, so it is the one module a visitor cannot browse.
    href: "/feed",
    label: "Social",
    icon: Home,
    matches: ["/feed", "/groups", "/pages", "/messages"],
    requiresAuth: true,
  },
  {
    href: "/marketplace",
    label: "Marketplace",
    icon: ShoppingBag,
    matches: ["/marketplace"],
  },
  {
    href: "/jobs",
    label: "Jobs",
    icon: Briefcase,
    matches: ["/jobs"],
  },
];

/** The four surfaces under Social, and the tab strip that switches between them. */
export const socialNavItems: NavItem[] = [
  { href: "/feed", label: "Feed", icon: Home, matches: ["/feed"] },
  { href: "/groups", label: "Groups", icon: Users, matches: ["/groups"] },
  { href: "/pages", label: "Pages", icon: Flag, matches: ["/pages"] },
  { href: "/messages", label: "Messages", icon: MessageCircle, matches: ["/messages"] },
];

/**
 * The items a reader is offered, given whether they are signed in.
 *
 * The rule lives here rather than at each renderer because the header, the
 * phone bar and the mobile panel all draw the same list — three separate
 * filters is how the bottom bar ends up offering a signed-out visitor a link
 * that bounces. What a signed-out visitor may browse is the product's own
 * decision (marketplace and jobs yes, the follow feed no), so the flag on each
 * item is the whole of the policy.
 */
export function visibleNavItems(items: NavItem[], isAuthenticated: boolean): NavItem[] {
  return items.filter((item) => isAuthenticated || !item.requiresAuth);
}

/**
 * Whether the reader is currently on (or inside) this item's destination.
 *
 * Matched on path boundaries rather than with a bare `startsWith`: `/groups`
 * must not be lit by `/groups-old`, and a module's prefix must not be lit by a
 * route that merely begins with the same letters. A trailing slash is trimmed
 * for the same reason `/marketplace/` should read as `/marketplace`.
 */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return item.matches.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
