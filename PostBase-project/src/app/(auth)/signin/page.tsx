import { permanentRedirect } from "next/navigation";

/**
 * An old sign-in address.
 *
 * The app moved its sign-in screens to `/login` and `/register`, but an address
 * a bookmark can hold is not a thing to break because the auth pages became
 * standalone (`(auth)/layout.tsx` is that separation's layout). This forwards —
 * the URL the old path carried nothing in, and its destination is the page that
 * owns sign-in — the same way `/cover-studio` forwards to the profile tab.
 *
 * The forward answers 308, not 307: this was a public spelling — indexed, saved,
 * printed — so the mapping is a fact, not a session-shaped claim. `redirect`
 * would keep every browser asking the question the move already answered.
 */
export default function SignInForwardPage() {
  permanentRedirect("/login");
}
