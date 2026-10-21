import { permanentRedirect } from "next/navigation";

/**
 * The namespaced spelling of the old sign-up address — `/auth/register`. It
 * forwards to `/register`, the standalone creation page, beside its `/auth/login`
 * twin and the app's own `/auth/callback` handler.
 *
 * The forward answers 308, not 307: this was a public spelling — indexed, saved,
 * printed — so the mapping is a fact, not a session-shaped claim. `redirect`
 * would keep every browser asking the question the move already answered.
 */
export default function AuthRegisterForwardPage() {
  permanentRedirect("/register");
}
