import { SocialNav } from "@/components/layout/social-nav";
import { PresenceProvider } from "@/components/providers/presence-provider";

/**
 * The app's signed-in pages.
 *
 * It exists for two reasons: the Social strip, and the channel the page's
 * presence reads share. Mounting the strip here means the four Social surfaces
 * (and the Pages sub-routes) get it without four copies of the same import,
 * and the pages that are not part of Social get nothing at all — the strip
 * decides that itself. The provider wraps both, because every presence
 * surface lives under this layout too: the strip, the conversation column, a
 * thread header's indicator, a member listing's rows. They read one socket and
 * one roster beat between them through it, and a page with none of them (the
 * marketplace, settings) claims nothing and holds no connection. Everything
 * else about these pages, including the header and the phone's bottom bar, is
 * drawn by the root layout.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <PresenceProvider>
      <SocialNav />
      {children}
    </PresenceProvider>
  );
}
