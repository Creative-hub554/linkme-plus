/**
 * The auth pages' own shell: nothing.
 *
 * This layout exists to say so. The root layout provides the document, the
 * theme and the auth session; everything else — the nav, the footer, the
 * phone's bottom bar, the chat bubble, the notification and realtime-room
 * providers — used to be mounted by the root layout around every route,
 * including these. A sign-in screen rendering the application's header, a
 * `NotificationProvider` asking the browser for permission mid-sign-in, and a
 * floating chat button over the password field were all side effects of that
 * sharing, not decisions anyone made.
 *
 * So this layout renders only the children: `AuthShell` below owns the whole
 * surface, full-viewport by its own design, and drawing the page's own logo and
 * sign-up link in its mobile header is the separation on a small screen too.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
