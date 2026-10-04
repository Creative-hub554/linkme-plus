import { describe, expect, test } from "vitest";
import {
  followLossEffect,
  groupLossEffect,
  groupRevealNoticeMessage,
  mergeRevealedPosts,
  newestFirst,
  revealNoticeMessage,
  visibilityChangeNeedsRecheck,
  type AudiencePost,
} from "@/lib/feed-audience";

/** A card, with only the fields the audience rules look at. */
function post(
  id: string,
  authorId: string,
  visibility: string | null | undefined,
  createdAt = "2026-09-20T12:00:00.000Z",
  extra: Partial<AudiencePost> = {},
): AudiencePost {
  return { id, author: { id: authorId }, visibility, createdAt, ...extra };
}

describe("following a member reveals their posts", () => {
  test("adds the posts the list does not already hold", () => {
    const held = post("a", "author", "public", "2026-09-20T12:00:00.000Z");
    const revealed = post("b", "author", "followers", "2026-09-21T12:00:00.000Z");

    const merged = mergeRevealedPosts([held], [revealed]);
    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
  });

  test("keeps the list newest-first, so an older reveal lands in its own place", () => {
    const newer = post("newer", "author", "public", "2026-09-22T12:00:00.000Z");
    const middle = post("middle", "author", "public", "2026-09-21T12:00:00.000Z");
    const older = post("older", "author", "followers", "2026-09-20T12:00:00.000Z");

    const merged = mergeRevealedPosts([newer, middle], [older]);
    expect(merged.map((item) => item.id)).toEqual(["newer", "middle", "older"]);
    // The whole point: an older reveal is not pushed to the top of the feed.
    expect(merged[merged.length - 1].id).toBe("older");
  });

  test("never doubles a post the list gained while the request was in flight", () => {
    const held = post("a", "author", "public");
    const alsoFetched = post("a", "author", "followers");

    const merged = mergeRevealedPosts([held], [alsoFetched]);
    expect(merged).toHaveLength(1);
  });

  test("ignores a repeat inside the fetched page itself", () => {
    const once = post("a", "author", "followers");
    const merged = mergeRevealedPosts([], [once, { ...once }]);
    expect(merged.map((item) => item.id)).toEqual(["a"]);
  });

  test("hands back the same list when there is nothing to add", () => {
    const held = [post("a", "author", "public")];
    expect(mergeRevealedPosts(held, [])).toBe(held);
    expect(mergeRevealedPosts(held, [post("a", "author", "public")])).toBe(held);
  });

  test("names the member and counts the cards in the status it shows", () => {
    expect(revealNoticeMessage("Theo Wu", 1)).toBe("Following Theo Wu added 1 post to your feed.");
    expect(revealNoticeMessage("Theo Wu", 6)).toBe("Following Theo Wu added 6 posts to your feed.");
  });

  test("names the group and counts the cards in the status it shows", () => {
    expect(groupRevealNoticeMessage("Denver Runners", 1)).toBe(
      "Joining Denver Runners added 1 post to your feed.",
    );
    expect(groupRevealNoticeMessage("Denver Runners", 4)).toBe(
      "Joining Denver Runners added 4 posts to your feed.",
    );
  });
});

describe("leaving a group drops its cards", () => {
  const inGroup = { group: { id: "group-1" } };

  test("drops a group card belonging to that group", () => {
    const posts = [post("a", "them", "group", undefined, inGroup)];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: ["a"], recheck: [] });
  });

  test("leaves another group's card where it is", () => {
    const posts = [post("a", "them", "group", undefined, { group: { id: "group-2" } })];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: [], recheck: [] });
  });

  test("leaves a card that carries no group alone", () => {
    const posts = [post("a", "them", "group"), post("b", "them", "followers")];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: [], recheck: [] });
  });

  test("keeps a public card that happens to name a group", () => {
    // A public post is readable by anyone, so a membership was never what was
    // showing it.
    const posts = [post("a", "them", "public", undefined, inGroup)];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: [], recheck: [] });
  });

  test("asks the API about a group card whose audience it cannot settle", () => {
    const posts = [post("unknown", "them", null, undefined, inGroup)];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: [], recheck: ["unknown"] });
  });

  test("separates that group's cards from the rest in the same list", () => {
    const posts = [
      post("in", "them", "group", undefined, inGroup),
      post("out", "them", "group", undefined, { group: { id: "group-2" } }),
      post("plain", "them", "public"),
    ];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: ["in"], recheck: [] });
  });

  test("skips an optimistic card, which no membership is holding up", () => {
    const posts = [
      post("pending-1", "them", "group", undefined, { ...inGroup, pending: true }),
    ];
    expect(groupLossEffect(posts, "group-1")).toEqual({ drop: [], recheck: [] });
  });
});

describe("unfollowing a member drops their followers-only cards", () => {
  test("drops a followers-only card by that member", () => {
    const { drop, recheck } = followLossEffect([post("a", "them", "followers")], "them");
    expect(drop).toEqual(["a"]);
    expect(recheck).toEqual([]);
  });

  test("leaves a public card by that member where it is", () => {
    const { drop, recheck } = followLossEffect([post("a", "them", "public")], "them");
    expect(drop).toEqual([]);
    expect(recheck).toEqual([]);
  });

  test("leaves every other member's cards alone", () => {
    const posts = [post("a", "someone-else", "followers"), post("b", "someone-else", "public")];
    expect(followLossEffect(posts, "them")).toEqual({ drop: [], recheck: [] });
  });

  test("asks the API about an audience a card cannot settle", () => {
    const posts = [
      post("unknown", "them", null),
      post("missing", "them", undefined),
      post("private", "them", "private"),
    ];
    const { drop, recheck } = followLossEffect(posts, "them");
    expect(drop).toEqual([]);
    expect(recheck).toEqual(["unknown", "missing", "private"]);
  });

  test("rechecks a Page's followers-only card rather than dropping it", () => {
    // The edge that admits a reader to a Page's `followers` post is the one to
    // the Page, so losing the edge to its admin settles nothing about it. It is
    // rechecked instead of kept, because a card must never be the authority on
    // what a reader may see.
    const posts = [post("page-post", "them", "followers", undefined, { page: { id: "page-1" } })];
    const { drop, recheck } = followLossEffect(posts, "them");
    expect(drop).toEqual([]);
    expect(recheck).toEqual(["page-post"]);
  });

  test("separates one member's two voices in the same list", () => {
    const posts = [
      post("as-themselves", "them", "followers", "2026-09-20T12:00:00.000Z"),
      post("as-their-page", "them", "followers", "2026-09-21T12:00:00.000Z", {
        page: { id: "page-1" },
      }),
    ];
    expect(followLossEffect(posts, "them")).toEqual({
      drop: ["as-themselves"],
      recheck: ["as-their-page"],
    });
  });

  test("a Page's public post is still no work at all", () => {
    const posts = [post("page-public", "them", "public", undefined, { page: { id: "page-1" } })];
    expect(followLossEffect(posts, "them")).toEqual({ drop: [], recheck: [] });
  });

  test("skips an optimistic card, which no follow edge is holding up", () => {
    const posts = [post("pending-1", "them", "followers", "2026-09-20T12:00:00.000Z", { pending: true })];
    expect(followLossEffect(posts, "them")).toEqual({ drop: [], recheck: [] });
  });

  test("takes the newest-first ordering from one shared rule", () => {
    const older = post("older", "a", "public", "2026-09-20T12:00:00.000Z");
    const newer = post("newer", "a", "public", "2026-09-21T12:00:00.000Z");
    expect([older, newer].sort(newestFirst).map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("an edit that narrows an audience takes the card away", () => {
  const mounted = { visibility: "public" };

  test("re-checks a changed audience on a post that is not the reader's own", () => {
    expect(
      visibilityChangeNeedsRecheck({
        isViewerOwnPost: false,
        mounted,
        nextVisibility: "private",
      }),
    ).toBe(true);
    expect(
      visibilityChangeNeedsRecheck({
        isViewerOwnPost: false,
        mounted,
        nextVisibility: "followers",
      }),
    ).toBe(true);
  });

  test("never re-checks the reader's own post, whatever its audience becomes", () => {
    expect(
      visibilityChangeNeedsRecheck({
        isViewerOwnPost: true,
        mounted,
        nextVisibility: "private",
      }),
    ).toBe(false);
    expect(
      visibilityChangeNeedsRecheck({
        isViewerOwnPost: true,
        mounted: { visibility: undefined },
        nextVisibility: "followers",
      }),
    ).toBe(false);
  });

  test("does nothing when the post is not on screen", () => {
    expect(
      visibilityChangeNeedsRecheck({ isViewerOwnPost: false, mounted: undefined, nextVisibility: "private" }),
    ).toBe(false);
  });

  test("does nothing when the audience did not change", () => {
    expect(
      visibilityChangeNeedsRecheck({
        isViewerOwnPost: false,
        mounted: { visibility: "followers" },
        nextVisibility: "followers",
      }),
    ).toBe(false);
  });

  test("cannot judge a row that carries no audience", () => {
    expect(
      visibilityChangeNeedsRecheck({ isViewerOwnPost: false, mounted, nextVisibility: null }),
    ).toBe(false);
    expect(
      visibilityChangeNeedsRecheck({ isViewerOwnPost: false, mounted, nextVisibility: undefined }),
    ).toBe(false);
  });
});
