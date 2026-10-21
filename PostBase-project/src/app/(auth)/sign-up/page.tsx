import { permanentRedirect } from "next/navigation";

/**
 * The dashed spelling of the old sign-up address — `/sign-up`, the shape search
 * engines and typed urls reach for as often as `/signup`. It forwards to
 * `/register`, the standalone creation page, the same way `/signup` does.
 *
 * The forward answers 308, not 307: this was a public spelling — indexed, saved,
 * printed — so the mapping is a fact, not a session-shaped claim. `redirect`
 * would keep every browser asking the question the move already answered.
 */
export default function SignUpDashedForwardPage() {
  permanentRedirect("/register");
}
