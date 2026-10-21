import { PlatformTransition } from "@/components/layout/platform-transition";
import { SocialNav } from "@/components/layout/social-nav";
import { AppChrome } from "@/components/layout/app-chrome";
import { PresenceProvider } from "@/components/providers/presence-provider";

/**
 * The app's signed-in pages.
 *
 * The chrome — header, page well, footer, bottom bar, chat bubble and the
 * providers they read — now lives in `AppChrome` rather than the root layout,
 * and comes back to this group from there. What remains the group's own work is
 * three things: the Social strip, the channel the page's presence reads share,
 * and the transition a section change is covered by. Mounting the strip here
 * means the four Social surfaces (and the Pages sub-routes) get it without four
 * copies of the same import, and the pages that are not part of Social get
 * nothing at all — the strip decides that itself. The provider wraps both of
 * them, because every presence surface lives under this layout too: the strip,
 * the conversation column, a thread header's indicator, a member listing's rows.
 * They read one socket and one roster beat between them through it, and a page
 * with none of them (the marketplace, settings) claims nothing and holds no
 * connection.
 *
 * The transition belongs here for the same reason the strip does: this layout
 * is the one thing every section under it shares, so it is the one place that
 * sees a reader move from Social to the marketplace or to a profile without
 * either page having to ask for a curtain over its own arrival. Both render
 * inside `AppChrome`'s slot, which is where the root layout's page well put
 * them before the chrome was extracted — the strip's sticky offset and the
 * transition's fixed veil are unchanged by the move.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <PresenceProvider>
      <AppChrome>
        <PlatformTransition />
        <SocialNav />
        {children}
      </AppChrome>
    </PresenceProvider>
  );
}
