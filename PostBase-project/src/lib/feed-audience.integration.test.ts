/**
 * The feed's audience behaviour, exercised as whole flows.
 *
 * The unit tests in `feed-audience.test.ts` pin each decision on its own. These
 * drive the *sequence* a reader actually causes — a follow arrives, an unfollow
 * arrives, a group membership comes or goes, an edit narrows a post — through
 * the real exported functions, and assert on what the reader ends up seeing.
 * That is where the rules meet:
 * a revealed post can later be narrowed, an unfollow can arrive for an author
 * whose cards came from an earlier reveal, and a recheck must not disturb
 * anything it was not asked about.
 *
 * What stands in for the world is a fake `GET /api/posts`, since this repo has
 * no test database and no DOM environment. It answers the two shapes the feed
 * uses — `?authorId=` (the reveal) and `?ids=` (the recheck) — and applies the
 * same audience rule the server applies: the fake calls `canReadPost`, the
 * in-process half of the rule that `visiblePostsCondition` renders to SQL, so it
 * cannot drift away from what the endpoint would return. The SQL's own shape is
 * pinned by compiling it in `post-visibility.test.ts`.
 *
 * The harness mirrors the handlers in `src/app/(main)/feed/page.tsx` —
 * `revealAuthorPosts`, `revalidateVisiblePosts`, `applyFollowChange` and the
 * `posts` UPDATE handler — including the order they do things in, because the
 * order is part of the behaviour (drop before recheck, merge after measuring).
 */
import { describe, expect, it } from "vitest";
import {
  followLossEffect,
  groupLossEffect,
  groupRevealNoticeMessage,
  mergeRevealedPosts,
  newestFirst,
  revealNoticeMessage,
  visibilityChangeNeedsRecheck,
  type AudiencePost,
} from "./feed-audience";
import { canReadPost, type PostAudience } from "@/lib/post-audiences";

interface ApiPost extends AudiencePost {
  author: { id: string; name?: string; username?: string };
  visibility: PostAudience;
  /** Set on a post published as a Page, whose audience follows that Page. */
  page?: { id: string; name?: string; username?: string } | null;
  /** Set on a post published into a group, whose audience is its members. */
  group?: { id: string; name?: string } | null;
}

/**
 * A card as the feed holds it. Its audience is optional because a card can be on
 * screen without the client having been told what it is — the whole reason a
 * recheck exists — while the endpoint always states one.
 */
interface CardPost extends AudiencePost {
  author: { id: string; name?: string; username?: string };
  visibility?: PostAudience;
}

// ---------------------------------------------------------------------------
// The fake world and the fake endpoint
// ---------------------------------------------------------------------------

class World {
  private readonly edges = new Set<string>();
  /** Follow edges to Pages, which are a different table on purpose. */
  private readonly pageEdges = new Set<string>();
  /** Memberships, which are a third edge again — `group_members`. */
  private readonly memberships = new Set<string>();
  readonly posts: ApiPost[] = [];

  follow(follower: string, following: string) {
    this.edges.add(`${follower}->${following}`);
  }

  unfollow(follower: string, following: string) {
    this.edges.delete(`${follower}->${following}`);
  }

  isFollowing(follower: string, following: string) {
    return this.edges.has(`${follower}->${following}`);
  }

  followPage(user: string, page: string) {
    this.pageEdges.add(`${user}->${page}`);
  }

  unfollowPage(user: string, page: string) {
    this.pageEdges.delete(`${user}->${page}`);
  }

  isFollowingPage(user: string, page: string) {
    return this.pageEdges.has(`${user}->${page}`);
  }

  joinGroup(user: string, group: string) {
    this.memberships.add(`${user}@${group}`);
  }

  leaveGroup(user: string, group: string) {
    this.memberships.delete(`${user}@${group}`);
  }

  isMember(user: string, group: string) {
    return this.memberships.has(`${user}@${group}`);
  }

  /** The groups a viewer belongs to, which is what a `group` post is gated on. */
  groupsFor(user: string) {
    const ids = new Set<string>();
    for (const key of this.memberships) {
      const [member, group] = key.split("@");
      if (member === user) ids.add(group);
    }
    return ids;
  }

  /**
   * The audience rule as the server applies it: the very function
   * `visiblePostsCondition` is rendered from, not a second reading of it. Both
   * edges are looked up, because which one gates the post is a property of the
   * post — the rule decides that, and this only reports what the world holds.
   */
  canRead(viewer: string, post: ApiPost) {
    return canReadPost(
      viewer,
      {
        authorId: post.author.id,
        pageId: post.page?.id ?? null,
        groupId: post.group?.id ?? null,
        visibility: post.visibility,
      },
      {
        author: this.isFollowing(viewer, post.author.id),
        page: post.page ? this.isFollowingPage(viewer, post.page.id) : false,
      },
      this.groupsFor(viewer),
    );
  }

  readableBy(viewer: string) {
    return this.posts.filter((post) => this.canRead(viewer, post));
  }
}

/**
 * What the client holds is a copy, never the server's own object — the wire is
 * JSON. Without this the two would share objects, and mutating the world's post
 * would silently change the mounted card too, closing the very `visibility`
 * change a test is trying to observe.
 */
function clonePost(post: ApiPost): ApiPost {
  return { ...post, author: { ...post.author } };
}

let postSeq = 0;

function post(init: {
  author: string;
  name?: string;
  visibility?: PostAudience;
  createdAt?: string;
  id?: string;
  /** The Page it was published as, when it was. */
  page?: string;
  /** The group it was published into, when it was. */
  group?: string;
}): ApiPost {
  postSeq += 1;
  const createdAt = init.createdAt ?? `2026-09-${String(10 + (postSeq % 20)).padStart(2, "0")}T12:00:00.000Z`;
  return {
    id: init.id ?? `post-${postSeq}`,
    createdAt,
    visibility: init.visibility ?? "public",
    author: { id: init.author, name: init.name ?? init.author, username: init.author },
    page: init.page ? { id: init.page, name: init.page, username: init.page } : null,
    group: init.group ? { id: init.group, name: init.group } : null,
  };
}

/** `GET /api/posts`, answering the two shapes the feed calls. */
class FakeApi {
  constructor(
    private readonly world: World,
    private readonly viewerId: string,
  ) {}

  async get(params: {
    authorId?: string;
    groupId?: string;
    ids?: string[];
  }): Promise<{ data: ApiPost[] }> {
    const readable = this.world.readableBy(this.viewerId);
    if (params.authorId) {
      return {
        data: readable
          .filter((post) => post.author.id === params.authorId)
          .sort(newestFirst)
          .map(clonePost),
      };
    }
    if (params.groupId) {
      return {
        data: readable
          .filter((post) => post.group?.id === params.groupId)
          .sort(newestFirst)
          .map(clonePost),
      };
    }
    const wanted = new Set(params.ids ?? []);
    return {
      data: readable.filter((post) => wanted.has(post.id)).sort(newestFirst).map(clonePost),
    };
  }
}

// ---------------------------------------------------------------------------
// The harness: the feed's handlers, replayed
// ---------------------------------------------------------------------------

interface FollowChange {
  follower_id: string;
  following_id: string;
  added: boolean;
}

interface GroupChange {
  user_id: string;
  group_id: string;
  added: boolean;
}

class Feed {
  posts: CardPost[] = [];
  notice: { message: string; postId: string } | null = null;
  /** Every `?ids=` recheck, in order, so a flow can be checked for extra work. */
  readonly rechecks: string[][] = [];
  readonly reveals: string[] = [];

  private readonly api: FakeApi;

  constructor(
    readonly world: World,
    readonly viewerId: string,
  ) {
    this.api = new FakeApi(world, viewerId);
  }

  get visibleIds() {
    return this.posts.map((post) => post.id);
  }

  /** Loads what the reader may see, as the first page of the feed would. */
  load() {
    this.posts = this.world.readableBy(this.viewerId).sort(newestFirst).map(clonePost);
    return this;
  }

  /** Mirrors `revealAuthorPosts`. */
  async revealAuthorPosts(authorId: string) {
    this.reveals.push(authorId);
    const { data } = await this.api.get({ authorId });
    if (data.length === 0) return;

    const known = new Set(this.posts.map((post) => post.id));
    const fresh = data.filter((post) => !known.has(post.id));
    if (fresh.length === 0) return;

    this.posts = mergeRevealedPosts(this.posts, data);
    const lead = fresh[0];
    this.notice = {
      message: revealNoticeMessage(
        lead.author.name ?? lead.author.username ?? "they",
        fresh.length,
      ),
      postId: lead.id,
    };
  }

  /** Mirrors `revalidateVisiblePosts`. */
  async revalidateVisiblePosts(ids: string[]) {
    this.rechecks.push(ids);
    const { data } = await this.api.get({ ids });
    const returned = new Set(data.map((post) => post.id));
    this.posts = this.posts.filter((post) => !ids.includes(post.id) || returned.has(post.id));
  }

  /** Mirrors `applyFollowChange`, including ignoring a payload that isn't ours. */
  async applyFollowChange(payload: Partial<FollowChange> | null | undefined) {
    if (payload?.follower_id !== this.viewerId) return;
    const following = payload.following_id;
    if (!following || typeof payload.added !== "boolean") return;

    if (payload.added) {
      await this.revealAuthorPosts(following);
      return;
    }

    const { drop, recheck } = followLossEffect(this.posts, following);
    const dropped = new Set(drop);
    this.posts = this.posts.filter((post) => !dropped.has(post.id));
    if (recheck.length > 0) await this.revalidateVisiblePosts(recheck);
  }

  /** Mirrors `revealGroupPosts`. */
  async revealGroupPosts(groupId: string) {
    this.reveals.push(groupId);
    const { data } = await this.api.get({ groupId });
    if (data.length === 0) return;

    const known = new Set(this.posts.map((post) => post.id));
    const fresh = data.filter((post) => !known.has(post.id));
    if (fresh.length === 0) return;

    this.posts = mergeRevealedPosts(this.posts, data);
    const lead = fresh[0];
    this.notice = {
      message: groupRevealNoticeMessage(lead.group?.name ?? "the group", fresh.length),
      postId: lead.id,
    };
  }

  /** Mirrors `applyGroupChange`, including ignoring a payload that isn't ours. */
  async applyGroupChange(payload: Partial<GroupChange> | null | undefined) {
    if (payload?.user_id !== this.viewerId) return;
    const groupId = payload.group_id;
    if (!groupId || typeof payload.added !== "boolean") return;

    if (payload.added) {
      await this.revealGroupPosts(groupId);
      return;
    }

    const { drop, recheck } = groupLossEffect(this.posts, groupId);
    const dropped = new Set(drop);
    this.posts = this.posts.filter((post) => !dropped.has(post.id));
    if (recheck.length > 0) await this.revalidateVisiblePosts(recheck);
  }

  /** Mirrors the `postgres_changes` UPDATE handler for one row. */
  async applyPostUpdate(row: {
    id: string;
    author_id: string;
    visibility?: PostAudience;
    deleted_at?: string | null;
  }) {
    if (row.deleted_at) {
      this.posts = this.posts.filter((post) => post.id !== row.id);
      return;
    }
    if (row.visibility === undefined) return;

    const mounted = this.posts.find((post) => post.id === row.id);
    this.posts = this.posts.map((post) =>
      post.id === row.id ? { ...post, visibility: row.visibility as PostAudience } : post,
    );

    if (
      visibilityChangeNeedsRecheck({
        isViewerOwnPost: row.author_id === this.viewerId,
        mounted,
        nextVisibility: row.visibility,
      })
    ) {
      await this.revalidateVisiblePosts([row.id]);
    }
  }
}

const VIEWER = "viewer";
const AUTHOR = "author";

/** A world with one member and their three posts, none of which the viewer follows. */
function scenario() {
  const world = new World();
  world.posts.push(
    post({ id: "public-1", author: AUTHOR, visibility: "public", createdAt: "2026-09-20T10:00:00Z" }),
    post({ id: "followers-1", author: AUTHOR, visibility: "followers", createdAt: "2026-09-21T10:00:00Z" }),
    post({ id: "private-1", author: AUTHOR, visibility: "private", createdAt: "2026-09-22T10:00:00Z" }),
  );
  const feed = new Feed(world, VIEWER).load();
  return { world, feed };
}

// ---------------------------------------------------------------------------
// Following reveals posts
// ---------------------------------------------------------------------------

describe("following a member reveals their posts", () => {
  it("shows only the public post before the follow", () => {
    const { feed } = scenario();
    expect(feed.visibleIds).toEqual(["public-1"]);
  });

  it("brings the followers-only post on screen when the edge is added", () => {
    const { world, feed } = scenario();

    world.follow(VIEWER, AUTHOR);
    return feed
      .applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true })
      .then(() => {
        expect(feed.visibleIds).toEqual(["followers-1", "public-1"]);
        // `private` is the author's alone, edge or no edge.
        expect(feed.visibleIds).not.toContain("private-1");
      });
  });

  it("announces what arrived, naming the member and counting the cards", async () => {
    const { world, feed } = scenario();
    world.follow(VIEWER, AUTHOR);

    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });

    expect(feed.notice).toEqual({
      message: "Following author added 1 post to your feed.",
      postId: "followers-1",
    });
  });

  it("stays quiet, and changes nothing, when the follow reveals no new card", async () => {
    const { world, feed } = scenario();
    world.follow(VIEWER, AUTHOR);

    // First reveal puts the post on screen; the second has nothing to add.
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });
    feed.notice = null;
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });

    expect(feed.notice).toBeNull();
    expect(feed.visibleIds).toEqual(["followers-1", "public-1"]);
  });

  it("places a revealed post by date rather than on top", async () => {
    const { world, feed } = scenario();
    // A newer public post by somebody else is already on screen.
    world.posts.push(post({ id: "other-new", author: "someone-else", createdAt: "2026-09-25T10:00:00Z" }));
    feed.load();
    expect(feed.visibleIds).toEqual(["other-new", "public-1"]);

    world.follow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });

    // The revealed post is older, so it lands where a fetched page would put it.
    expect(feed.visibleIds).toEqual(["other-new", "followers-1", "public-1"]);
  });

  it("ignores a follow report about somebody else's graph", async () => {
    const { world, feed } = scenario();
    world.follow(VIEWER, AUTHOR);

    await feed.applyFollowChange({ follower_id: "someone-else", following_id: AUTHOR, added: true });

    expect(feed.visibleIds).toEqual(["public-1"]);
    expect(feed.reveals).toEqual([]);
  });

  it("ignores a payload that carries no direction, rather than guessing one", async () => {
    const { world, feed } = scenario();
    world.follow(VIEWER, AUTHOR);

    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR });

    expect(feed.visibleIds).toEqual(["public-1"]);
    expect(feed.reveals).toEqual([]);
    expect(feed.rechecks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unfollowing drops them
// ---------------------------------------------------------------------------

describe("unfollowing a member drops their followers-only cards", () => {
  async function revealed() {
    const built = scenario();
    built.world.follow(VIEWER, AUTHOR);
    await built.feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });
    expect(built.feed.visibleIds).toEqual(["followers-1", "public-1"]);
    return built;
  }

  it("removes the card at once, with no round trip", async () => {
    const { world, feed } = await revealed();

    world.unfollow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    expect(feed.visibleIds).toEqual(["public-1"]);
    // Nothing a card could settle by itself is sent to the API.
    expect(feed.rechecks).toEqual([]);
  });

  it("leaves the member's public post alone", async () => {
    const { world, feed } = await revealed();
    world.unfollow(VIEWER, AUTHOR);

    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    expect(feed.visibleIds).toContain("public-1");
  });

  it("asks the API about a card whose audience it cannot settle", async () => {
    const { world, feed } = await revealed();
    // A card the client holds without a known audience: not `public`, not
    // `followers`, so the drop list cannot claim it and the API has to answer.
    feed.posts = feed.posts.map((post) =>
      post.id === "public-1" ? { ...post, visibility: undefined } : post,
    );
    // It really is a `followers` post, so losing the edge puts it out of reach.
    world.posts.find((post) => post.id === "public-1")!.visibility = "followers";

    world.unfollow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    expect(feed.rechecks).toEqual([["public-1"]]);
    expect(feed.visibleIds).toEqual([]);
  });

  it("keeps a card it cannot settle when the API cannot answer", async () => {
    const { world, feed } = await revealed();
    feed.posts = feed.posts.map((post) =>
      post.id === "public-1" ? { ...post, visibility: undefined } : post,
    );
    world.posts.find((post) => post.id === "public-1")!.visibility = "followers";
    world.unfollow(VIEWER, AUTHOR);

    // A recheck that fails must remove nothing: the card comes back next load
    // rather than vanishing on a guess.
    feed.revalidateVisiblePosts = async () => {};
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    // The `followers` card is settled locally and still goes; the unsettled one
    // waits for an answer it never got.
    expect(feed.visibleIds).toEqual(["public-1"]);
  });

  it("reaches the right member's cards only", async () => {
    const { world, feed } = await revealed();
    world.posts.push(post({ id: "other-followers", author: "someone-else", visibility: "followers" }));
    world.follow(VIEWER, "someone-else");
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: "someone-else", added: true });

    world.unfollow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    expect(feed.visibleIds).toContain("other-followers");
    expect(feed.visibleIds).not.toContain("followers-1");
  });
});

// ---------------------------------------------------------------------------
// A Page's followers-only post belongs to the Page's followers
// ---------------------------------------------------------------------------

describe("a Page's followers-only post", () => {
  const PAGE = "page-1";

  /** One member, one Page they run, and a post the Page published. */
  function pageScenario() {
    const world = new World();
    world.posts.push(
      post({ id: "page-followers", author: AUTHOR, page: PAGE, visibility: "followers" }),
    );
    return { world, feed: new Feed(world, VIEWER).load() };
  }

  it("is not readable by a follower of the admin who published it", () => {
    const { world, feed } = pageScenario();
    world.follow(VIEWER, AUTHOR);
    feed.load();

    // The edge that matters is the one to the Page. Following the admin — even
    // though they are the row's author — must not open the Page's post.
    expect(feed.visibleIds).toEqual([]);
  });

  it("is readable by a follower of the Page, who need not follow the admin", () => {
    const { world, feed } = pageScenario();
    world.followPage(VIEWER, PAGE);
    feed.load();

    expect(feed.visibleIds).toEqual(["page-followers"]);
    expect(world.isFollowing(VIEWER, AUTHOR)).toBe(false);
  });

  it("stays on screen when the reader stops following the admin", async () => {
    const { world, feed } = pageScenario();
    world.follow(VIEWER, AUTHOR);
    world.followPage(VIEWER, PAGE);
    feed.load();
    expect(feed.visibleIds).toEqual(["page-followers"]);

    world.unfollow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    // Losing that edge is not what was showing the card, so the card stays —
    // and it was the API that said so, not the client's guess.
    expect(feed.visibleIds).toEqual(["page-followers"]);
    expect(feed.rechecks).toEqual([["page-followers"]]);
  });

  it("leaves the list when the Page edge goes", () => {
    const { world, feed } = pageScenario();
    world.followPage(VIEWER, PAGE);
    feed.load();
    expect(feed.visibleIds).toEqual(["page-followers"]);

    world.unfollowPage(VIEWER, PAGE);
    feed.load();

    expect(feed.visibleIds).toEqual([]);
  });

  it("never reaches a reader with no edge at all", () => {
    const { world, feed } = pageScenario();
    expect(feed.visibleIds).toEqual([]);
    expect(world.readableBy(VIEWER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// An edit that narrows an audience removes the card
// ---------------------------------------------------------------------------

describe("an edit that narrows an audience takes the card away", () => {
  it("removes a mounted card when the post goes private", async () => {
    const { world, feed } = scenario();
    expect(feed.visibleIds).toContain("public-1");

    world.posts.find((post) => post.id === "public-1")!.visibility = "private";
    await feed.applyPostUpdate({ id: "public-1", author_id: AUTHOR, visibility: "private" });

    expect(feed.visibleIds).toEqual([]);
    expect(feed.rechecks).toEqual([["public-1"]]);
  });

  it("keeps a card narrowed to followers while the reader still follows", async () => {
    const { world, feed } = scenario();
    world.follow(VIEWER, AUTHOR);

    world.posts.find((post) => post.id === "public-1")!.visibility = "followers";
    await feed.applyPostUpdate({ id: "public-1", author_id: AUTHOR, visibility: "followers" });

    expect(feed.visibleIds).toContain("public-1");
  });

  it("removes a card narrowed to followers once the reader does not follow", async () => {
    const { world, feed } = scenario();

    world.posts.find((post) => post.id === "public-1")!.visibility = "followers";
    await feed.applyPostUpdate({ id: "public-1", author_id: AUTHOR, visibility: "followers" });

    expect(feed.visibleIds).not.toContain("public-1");
  });

  it("leaves the reader's own post alone however it is narrowed", async () => {
    const world = new World();
    world.posts.push(post({ id: "mine", author: VIEWER, visibility: "public" }));
    const feed = new Feed(world, VIEWER).load();

    world.posts[0].visibility = "private";
    await feed.applyPostUpdate({ id: "mine", author_id: VIEWER, visibility: "private" });

    expect(feed.visibleIds).toEqual(["mine"]);
    // The reader's own post is never at risk, so it costs no request.
    expect(feed.rechecks).toEqual([]);
  });

  it("does not spend a request on a content-only edit", async () => {
    const { feed } = scenario();

    await feed.applyPostUpdate({ id: "public-1", author_id: AUTHOR, visibility: "public" });

    expect(feed.rechecks).toEqual([]);
  });

  it("does not re-add anything when a post widens", async () => {
    const { world, feed } = scenario();
    world.follow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });
    const before = feed.visibleIds;

    // A widening happens to a post the reader could already see, or could not
    // have been shown at all — either way there is nothing to bring in.
    await feed.applyPostUpdate({ id: "public-1", author_id: AUTHOR, visibility: "public" });

    expect(feed.visibleIds).toEqual(before);
    expect(feed.reveals).toEqual([AUTHOR]);
  });
});

// ---------------------------------------------------------------------------
// The three rules composed
// ---------------------------------------------------------------------------

describe("the three rules together", () => {
  it("walk a post through reveal, then narrowing, then unfollow", async () => {
    const { world, feed } = scenario();

    // Revealed by a follow.
    world.follow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });
    expect(feed.visibleIds).toEqual(["followers-1", "public-1"]);

    // Its author narrows it to just themselves.
    world.posts.find((post) => post.id === "followers-1")!.visibility = "private";
    await feed.applyPostUpdate({ id: "followers-1", author_id: AUTHOR, visibility: "private" });
    expect(feed.visibleIds).toEqual(["public-1"]);

    // And the follow edge goes; the public post is all that is left.
    world.unfollow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });
    expect(feed.visibleIds).toEqual(["public-1"]);
  });

  it("never shows a card the API would not return", async () => {
    const { world, feed } = scenario();

    world.follow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: true });
    await feed.applyPostUpdate({ id: "public-1", author_id: AUTHOR, visibility: "private" });
    world.unfollow(VIEWER, AUTHOR);
    await feed.applyFollowChange({ follower_id: VIEWER, following_id: AUTHOR, added: false });

    // After every step, what is on screen is a subset of what the endpoint would
    // hand this reader — the invariant the whole design rests on.
    const readable = new Set(world.readableBy(VIEWER).map((post) => post.id));
    for (const id of feed.visibleIds) expect(readable.has(id)).toBe(true);
    // And nothing the reader may not see is left holding a place.
    expect(readable.has("private-1")).toBe(false);
    expect(feed.visibleIds).not.toContain("private-1");
  });
});

// ---------------------------------------------------------------------------
// A group's posts belong to its members
// ---------------------------------------------------------------------------

describe("a group's posts belong to its members", () => {
  const GROUP = "group-1";

  /** One member, one group the viewer has joined, and posts in and out of it. */
  function groupScenario() {
    const world = new World();
    world.posts.push(
      post({
        id: "group-old",
        author: AUTHOR,
        group: GROUP,
        visibility: "group",
        createdAt: "2026-09-20T10:00:00Z",
      }),
      post({
        id: "group-new",
        author: AUTHOR,
        group: GROUP,
        visibility: "group",
        createdAt: "2026-09-22T10:00:00Z",
      }),
      post({ id: "public-1", author: AUTHOR, visibility: "public", createdAt: "2026-09-21T10:00:00Z" }),
    );
    world.joinGroup(VIEWER, GROUP);
    return { world, feed: new Feed(world, VIEWER).load() };
  }

  it("shows the group's posts while the reader is a member", () => {
    const { feed } = groupScenario();
    expect(feed.visibleIds).toEqual(["group-new", "public-1", "group-old"]);
  });

  it("never shows them to a reader who is not a member", () => {
    const world = new World();
    world.posts.push(post({ id: "in-group", author: AUTHOR, group: GROUP, visibility: "group" }));
    const feed = new Feed(world, VIEWER).load();

    expect(feed.visibleIds).toEqual([]);
    expect(world.readableBy(VIEWER)).toEqual([]);
  });

  it("removes every one of the group's cards at once when the reader leaves", async () => {
    const { world, feed } = groupScenario();

    world.leaveGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: false });

    expect(feed.visibleIds).toEqual(["public-1"]);
    // Membership is what held the cards up, so nothing is left to the API.
    expect(feed.rechecks).toEqual([]);
  });

  it("leaves a post in another group where it is", async () => {
    const { world, feed } = groupScenario();
    world.posts.push(
      post({ id: "other-group", author: AUTHOR, group: "group-2", visibility: "group" }),
    );
    world.joinGroup(VIEWER, "group-2");
    feed.load();
    expect(feed.visibleIds).toContain("other-group");

    world.leaveGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: false });

    expect(feed.visibleIds).toContain("other-group");
    expect(feed.visibleIds).not.toContain("group-new");
  });

  it("asks the API about a group card whose audience it cannot settle", async () => {
    const { world, feed } = groupScenario();
    // A card the client holds without a known audience: not `group`, so the drop
    // list cannot claim it and the API has to answer. It really is a group post,
    // so losing the membership puts it out of reach.
    feed.posts = feed.posts.map((post) =>
      post.id === "group-new" ? { ...post, visibility: undefined } : post,
    );

    world.leaveGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: false });

    expect(feed.rechecks).toEqual([["group-new"]]);
    expect(feed.visibleIds).toEqual(["public-1"]);
  });

  it("ignores a membership report about somebody else's row", async () => {
    const { world, feed } = groupScenario();
    world.leaveGroup("someone-else", GROUP);

    await feed.applyGroupChange({ user_id: "someone-else", group_id: GROUP, added: false });

    expect(feed.visibleIds).toEqual(["group-new", "public-1", "group-old"]);
  });

  it("ignores a payload that carries no direction, rather than guessing one", async () => {
    const { world, feed } = groupScenario();
    world.leaveGroup(VIEWER, GROUP);

    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP });

    expect(feed.visibleIds).toEqual(["group-new", "public-1", "group-old"]);
    expect(feed.rechecks).toEqual([]);
  });

  it("brings the group's posts in when the membership is added", async () => {
    const world = new World();
    world.posts.push(
      post({ id: "g1", author: AUTHOR, group: GROUP, visibility: "group", createdAt: "2026-09-21T10:00:00Z" }),
      post({ id: "g2", author: AUTHOR, group: GROUP, visibility: "group", createdAt: "2026-09-22T10:00:00Z" }),
      post({ id: "public-1", author: AUTHOR, visibility: "public", createdAt: "2026-09-20T10:00:00Z" }),
    );
    const feed = new Feed(world, VIEWER).load();
    expect(feed.visibleIds).toEqual(["public-1"]);

    world.joinGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: true });

    expect(feed.visibleIds).toEqual(["g2", "g1", "public-1"]);
    expect(feed.notice).toEqual({
      message: "Joining group-1 added 2 posts to your feed.",
      postId: "g2",
    });
  });

  it("places a revealed group post by date rather than on top", async () => {
    const world = new World();
    world.posts.push(
      post({ id: "g-old", author: AUTHOR, group: GROUP, visibility: "group", createdAt: "2026-09-20T10:00:00Z" }),
      post({ id: "other-new", author: "someone-else", createdAt: "2026-09-25T10:00:00Z" }),
    );
    const feed = new Feed(world, VIEWER).load();
    expect(feed.visibleIds).toEqual(["other-new"]);

    world.joinGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: true });

    expect(feed.visibleIds).toEqual(["other-new", "g-old"]);
  });

  it("stays quiet, and changes nothing, when a join reveals no new card", async () => {
    const { feed } = groupScenario();

    // Already a member and already showing the posts; a repeat announce adds none.
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: true });

    expect(feed.notice).toBeNull();
    expect(feed.visibleIds).toEqual(["group-new", "public-1", "group-old"]);
  });

  it("never leaves a card the API would not return after a leave and rejoin", async () => {
    const { world, feed } = groupScenario();

    world.leaveGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: false });
    world.joinGroup(VIEWER, GROUP);
    await feed.applyGroupChange({ user_id: VIEWER, group_id: GROUP, added: true });

    const readable = new Set(world.readableBy(VIEWER).map((post) => post.id));
    for (const id of feed.visibleIds) expect(readable.has(id)).toBe(true);
    expect(feed.visibleIds).toEqual(["group-new", "public-1", "group-old"]);
  });
});
