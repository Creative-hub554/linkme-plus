import { AppChrome } from "@/components/layout/app-chrome";

/**
 * The static pages' shell.
 *
 * About, terms, privacy and the rest keep the same public chrome they had while
 * it lived in the root layout — header, page well, footer, bottom bar — now
 * coming from `AppChrome`. The auth route group is the only one that declines
 * the chrome; these pages keep it, sharing one composition with `(site)` and
 * `(main)` instead of three copies of it.
 */
export default function StaticLayout({ children }: { children: React.ReactNode }) {
  return <AppChrome>{children}</AppChrome>;
}
