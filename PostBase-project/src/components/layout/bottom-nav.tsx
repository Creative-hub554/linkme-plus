"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavItemActive, mainNavItems, visibleNavItems } from "@/lib/nav-items";
import { useAuth } from "@/components/auth-provider";

/**
 * The phone's bar, and the whole of the navigation on a small screen: the same
 * items the header offers, from the same list, through the same session rule.
 * Groups, Pages and Messages are not missing from it — they are inside Social,
 * and the strip under the header is what switches between them. And a signed-out
 * visitor is not offered Social here either: the feed bounces them, and a bar
 * that advertises a bounce is the same dead end as one that 404s.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-border bg-card md:hidden">
      <div className="flex items-center justify-around py-2">
        {visibleNavItems(mainNavItems, isAuthenticated).map((item) => {
          const isActive = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              // The tint alone told nobody; this is the same "you are here" the
              // desktop nav and the profile's tabs announce.
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 min-w-14 flex-col items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors",
                isActive ? "text-brand-blue" : "text-muted-foreground hover:text-navy-800"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
