"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavItemActive, socialNavItems } from "@/lib/nav-items";

/**
 * The four surfaces under Social, and the way between them.
 *
 * Social is one destination in the main navigation and four places to be, so the
 * header cannot say which one a reader is in — this strip does, right under it,
 * and only there. Everywhere else it renders nothing: the header already says
 * Marketplace or Jobs, and a strip about Social on the settings page would be
 * noise. That is also why this decides for itself rather than being mounted per
 * page — a page that forgot to render it would be a page with no way back.
 *
 * The addresses are the ones the surfaces already had, so nothing here is a
 * redirect, a bookmark stops working, or a deep link to a conversation or a Page
 * changes shape.
 */
export function SocialNav() {
  const pathname = usePathname();
  const onSocial = socialNavItems.some((item) => isNavItemActive(pathname, item));
  if (!onSocial) return null;

  return (
    <nav
      aria-label="Social"
      className="sticky top-14 z-40 mb-4 border-b border-surface-border bg-card/95 backdrop-blur"
    >
      {/* Scrolls rather than wraps on a narrow screen: a strip that became two
          rows would push the content down every time it grew. Tabs keep a 44px
          target, so the row is comfortably finger-height on a phone. */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {socialNavItems.map((item) => {
          const isActive = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              // The same "you are here" the header and the phone bar announce.
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
                isActive
                  ? "border-brand-blue text-brand-blue"
                  : "border-transparent text-navy-600 hover:border-navy-200 hover:text-navy-800",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
