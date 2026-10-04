import { eq, isNull, type SQL } from "drizzle-orm";
import { posts } from "@/lib/db/schema";

/**
 * The conditions that select a member's own posts — the ones they wrote as
 * themselves, for their own timeline.
 *
 * A Page's post is authored by the member who pressed publish; that is what
 * `author_id` records and what the edit and delete checks compare against. But
 * the post's voice is the Page's, not the member's, so a profile that filtered
 * on authorship alone would fill a Page admin's timeline with things they never
 * said. Both conditions belong here together: the person is named by the first,
 * and ruled out as the Page by the second.
 *
 * Nothing is lost by excluding them — a Page's posts are still read back through
 * `?pageId=<id>` on the Page, and still reach the feed, where the card is
 * labelled with the Page.
 *
 * Returned as a list so a caller can spread it into its own stack of `where`
 * conditions without a second combine step.
 */
export function authoredByMember(authorId: string): SQL[] {
  return [eq(posts.authorId, authorId), isNull(posts.pageId)];
}
