import { SocialNav } from "@/components/layout/social-nav";

/**
 * The app's signed-in pages.
 *
 * It exists for one reason: the Social strip. Mounting it here means the four
 * Social surfaces (and the Pages sub-routes) get it without four copies of the
 * same import, and the pages that are not part of Social get nothing at all —
 * the strip decides that itself. Everything else about these pages, including
 * the header and the phone's bottom bar, is drawn by the root layout.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SocialNav />
      {children}
    </>
  );
}
