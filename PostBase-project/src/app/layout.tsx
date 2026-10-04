import "@/lib/weak-ref-polyfill";
import type { Metadata } from "next";
import { MainNav } from "@/components/layout/main-nav";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { AuthProvider } from "@/components/auth-provider";
import { NotificationProvider } from "@/components/providers/notification-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeSync } from "@/components/providers/theme-sync";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinkMe+ | Your people. Your next move.",
  description:
    "LinkMe+ brings your community, creativity, marketplace, and career into one beautifully simple place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `suppressHydrationWarning` is for this element only. The script below
    // adds `class="dark"` and `data-accent` to `<html>` before React hydrates,
    // so the node React finds is deliberately not the one it last rendered and
    // the attribute check would otherwise report a mismatch on every dark page.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * The theme, applied before the first paint.
         *
         * It has to be a blocking inline script in the document itself — an
         * effect runs after the server's light HTML has painted, which is the
         * white flash this exists to remove. It reads the same storage keys the
         * `ThemeProvider` writes and applies the same class and attribute, so
         * the two agree and there is nothing for the provider to correct.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-surface-light-blue">
        <ThemeProvider>
          <AuthProvider>
            {/* Renders nothing. It is here, inside `AuthProvider` and inside
                `ThemeProvider`, because it is the one place both the account
                and the applied accent can be read — see its own comment. */}
            <ThemeSync />
            <NotificationProvider>
              {/* One tooltip provider for the whole app. Radix needs it above every
                  tooltip, and a single one also means hovering one control is enough
                  for the next tooltip to open without waiting again. */}
              <TooltipProvider>
                <MainNav />
                <main className="mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-6">{children}</main>
                <Footer />
                <BottomNav />
              </TooltipProvider>
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
