import { permanentRedirect } from "next/navigation";

/**
 * The namespaced spelling of the old sign-in address — `/auth/login`, the shape
 * an app under a parent path would have used. The app's own namespaced route is
 * `/auth/callback`, so this lives beside it and forwards to `/login`, the
 * standalone sign-in page (`/auth` is a namespace here, not a page: the route
 * group that carries the layout is `(auth)`, not this directory).
 *
 * The forward answers 308, not 307: this was a public spelling — indexed, saved,
 * printed — so the mapping is a fact, not a session-shaped claim. `redirect`
 * would keep every browser asking the question the move already answered.
 */
export default function AuthLoginForwardPage() {
  permanentRedirect("/login");
}
