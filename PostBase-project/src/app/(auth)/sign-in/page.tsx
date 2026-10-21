import { permanentRedirect } from "next/navigation";

/**
 * The dashed spelling of the old sign-in address — `/sign-in`, the shape search
 * engines and typed urls reach for as often as `/signin`. It forwards to the
 * standalone sign-in page, the same way `/signin` does; the two exist so an old
 * link forwards however the hand that wrote it spelled the words.
 *
 * The forward answers 308, not 307: this was a public spelling — indexed, saved,
 * printed — so the mapping is a fact, not a session-shaped claim. `redirect`
 * would keep every browser asking the question the move already answered.
 */
export default function SignInDashedForwardPage() {
  permanentRedirect("/login");
}
