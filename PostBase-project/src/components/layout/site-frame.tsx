"use client";

import { usePathname } from "next/navigation";
import { MainNav } from "@/components/layout/main-nav";
import { BottomNav } from "@/components/layout/bottom-nav";

export function SiteFrame({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/design" || pathname?.startsWith("/design/"))
    return <>{children}</>;
  if (pathname === "/login") {
    return <main>{children}</main>;
  }

  return (
    <>
      <MainNav />
      <main className={pathname === "/feed" ? "community-feed-frame mx-auto max-w-7xl px-4 pt-4 pb-24 md:px-6 md:pb-10" : "mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-6"}>
        {children}
      </main>
      {footer}
      <BottomNav />
    </>
  );
}
