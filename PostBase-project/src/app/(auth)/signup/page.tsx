import { permanentRedirect } from "next/navigation";

/**
 * An old sign-up address.
 *
 * A bookmark is not a thing to break because the auth pages became standalone,
 * so this forwards to `/register`, the page that owns account creation — the
 * same way `/cover-studio` forwards to the profile tab.
 *
 * The forward answers 308, not 307: this was a public spelling — indexed, saved,
 * printed — so the mapping is a fact, not a session-shaped claim. `redirect`
 * would keep every browser asking the question the move already answered.
 */
export default function SignUpForwardPage() {
  permanentRedirect("/register");
}
