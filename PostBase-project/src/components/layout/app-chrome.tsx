"use client";

import type { ReactNode } from "react";
import { MainNav } from "@/components/layout/main-nav";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { ChatBubble } from "@/components/chat/chat-bubble";
import { NotificationProvider } from "@/components/providers/notification-provider";
import { RoomProvider } from "@/components/providers/room-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The chrome every non-auth page shares: the header, the page well, the footer,
 * the phone's bottom bar and the floating chat bubble, wrapped in the providers
 * they read.
 *
 * It used to live in the root layout, which made it the app's *every* page's
 * chrome — `/login` and `/register` rendered the full application header, the
 * mobile bottom bar and the chat bubble around their own full-screen shell, and
 * `NotificationProvider` asked the browser for notification permission while a
 * visitor was merely signing in. Extracting it lets a layout opt into it: the
 * root layout now carries only the document shell and the theme and auth
 * providers, and each non-auth layout mounts the chrome below their children
 * route group. The auth layout mounts none of it.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  return (
    // One tooltip provider for the whole app. Radix needs it above every
    // tooltip, and a single one also means hovering one control is enough
    // for the next tooltip to open without waiting again.
    <TooltipProvider>
      <NotificationProvider>
        {/* One connection for the room every realtime surface below asks
            for: the floating bubble, the messages page and its typing
            indicator all read `global`, so they share the one socket
            this provider runs rather than each dialing their own. */}
        <RoomProvider room="global">
          <MainNav />
          <main className="mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-6">{children}</main>
          <Footer />
          <BottomNav />
          {/* Mounted last, like the bar above it: a floating door to
              messages on every page. It renders nothing until the reader
              is signed in — see the component itself. */}
          <ChatBubble />
        </RoomProvider>
      </NotificationProvider>
    </TooltipProvider>
  );
}
