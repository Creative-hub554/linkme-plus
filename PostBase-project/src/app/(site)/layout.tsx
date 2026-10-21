import { AppChrome } from "@/components/layout/app-chrome";

/**
 * The landing page's shell.
 *
 * `/` is a public page, but it is not an auth page: its header, footer and chat
 * bubble come from the same `AppChrome` the signed-in app uses, which is why
 * the page moved into this route group when the root layout stopped carrying
 * the chrome. The route's address is untouched — route groups do not appear in
 * a URL — only the file's layout nesting changed.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <AppChrome>{children}</AppChrome>;
}
