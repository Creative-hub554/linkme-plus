"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Search, Menu, X, LogOut, LogIn, UserPlus, Settings, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DisclosureButton } from "@/components/ui/disclosure-button";
import { ThemeMenuItems } from "@/components/layout/theme-menu-items";
import { ThemeChoiceGroup } from "@/components/shared/theme-choice-group";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { signOut } from "@/lib/auth-client";
import { NotificationBell } from "@/components/realtime/notification-bell";
import { AuthTransitionOverlay } from "@/components/auth/auth-transition-overlay";
import { isNavItemActive, mainNavItems, visibleNavItems } from "@/lib/nav-items";

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const avatarUrl = user?.image ?? user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? undefined;
  const displayName = user?.name ?? user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "User";

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    await signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <>
      {signingOut && <AuthTransitionOverlay mode="logout" />}
      <header className="sticky top-0 z-50 w-full border-b border-surface-border bg-card/95 shadow-[0_1px_8px_rgba(26,32,52,0.04)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-blue text-white font-bold text-sm">
            L+
          </div>
          <span className="text-lg font-bold tracking-tight text-navy-800">LinkMe<span className="text-brand-purple">+</span></span>
        </Link>

        {/* Desktop Nav. Members see all three modules; a visitor sees the two
            that are theirs to browse — the rule lives in nav-items, not here. */}
        <nav className="hidden md:flex items-center gap-1">
          {visibleNavItems(mainNavItems, isAuthenticated).map((item) => {
              const isActive = isNavItemActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // Where the reader already is, said rather than only tinted.
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-blue/10 text-brand-blue"
                      : "text-navy-600 hover:bg-navy-50 hover:text-navy-800"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          ) : isAuthenticated ? (
            <>
              {/* A link, not a button: this one leaves the page. */}
              <IconButton label="Search" href="/search" className="hidden md:flex">
                <Search className="h-4 w-4" />
              </IconButton>
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={avatarUrl} alt={displayName} />
                      <AvatarFallback>{displayName[0] || "U"}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium">{displayName}</p>
                      <p className="text-xs text-muted-foreground">{user?.email}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile">Profile</Link>
                  </DropdownMenuItem>
                  {/* The shelf the heart writes to. A member-only page behind
                      the account's own menu, like Profile and Settings — the
                      middleware turns a typed URL around the same way. */}
                  <DropdownMenuItem asChild>
                    <Link href="/marketplace/saved">
                      <Heart className="mr-2 h-4 w-4" />
                      Saved listings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/pages/new">Create a Page</Link>
                  </DropdownMenuItem>
                  {/* The studio lives on the profile now, as a tab of the member's
                      own — this is the shortcut to it rather than a page of its
                      own, which is why it names the tab it lands on. */}
                  <DropdownMenuItem asChild>
                    <Link href="/profile?tab=cover">Cover studio</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* Switching the theme without leaving the page. The items are
                      their own component so that `useTheme` is only reached
                      while this menu is on screen — see its own comment. */}
                  <ThemeMenuItems />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Sign Up</Button>
              </Link>
            </div>
          )}

          {/* Mobile menu button. The swap between a hamburger and an × is the
              whole of what said whether the panel below was open, and the button
              had no name at all, so it announced nothing but "button". The
              panel's `id` and the open state are passed once, in one place, and
              the component writes both attributes. */}
          <DisclosureButton
            open={mobileOpen}
            controls="mobile-nav"
            label={mobileOpen ? "Close menu" : "Open menu"}
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </DisclosureButton>
        </div>
      </div>

      {/* Mobile Nav. The panel opens for everyone: a visitor's hamburger used
          to be a control that opened nothing. What it lists follows the
          session — the public modules and the theme for all, and the account's
          own door where one exists. */}
      {mobileOpen && (
        <div id="mobile-nav" className="md:hidden border-t border-surface-border bg-card">
          <nav className="flex flex-col p-2">
            {visibleNavItems(mainNavItems, isAuthenticated).map((item) => {
              const isActive = isNavItemActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-blue/10 text-brand-blue"
                      : "text-navy-600 hover:bg-navy-50"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            {/* The theme, reachable on a phone. The desktop nav reaches the
                same three choices through the account menu, and that menu is
                not in this panel — so they sit here in the open rather than
                behind a second layer. The panel stays open on a choice on
                purpose: it is drawn from the same tokens as the page, so the
                change is visible right here, and closing on it would hide the
                only feedback there is. */}
            <div className="border-t mt-2 px-3 pb-1 pt-3">
              <ThemeChoiceGroup />
            </div>
            {isAuthenticated ? (
              <div className="border-t mt-2 pt-2">
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 w-full"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="border-t mt-2 pt-2">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-navy-600 hover:bg-navy-50"
                >
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-brand-blue hover:bg-brand-blue/10"
                >
                  <UserPlus className="h-4 w-4" />
                  Sign Up
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
      </header>
    </>
  );
}
