import { redirect } from "next/navigation";

/**
 * The studio used to live here, as a destination in the main navigation.
 *
 * It is a tab of the profile now, so this address forwards there rather than
 * disappearing: the link was in the header, in the feed's sidebar and inside the
 * cover dialog, and a bookmark is not a thing to break because the layout
 * changed. The tab it lands on is named in the url, so the redirect can say
 * exactly where it meant to go.
 */
export default function CoverStudioPage() {
  redirect("/profile?tab=cover");
}
