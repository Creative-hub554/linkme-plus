// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import {
  json,
  stubFetch as stubFetchEndpoints,
  type FetchRecorder,
} from "@/test/stub-fetch";

/**
 * A group space, judged on the three things that are its own rather than the
 * API's: that a member is offered the composer and a stranger is not, that a
 * stranger's page is the way in rather than an empty room, and that a post
 * published here is attributed to the member who wrote it and labelled with the
 * group it went to.
 */
const mocks = vi.hoisted(() => ({
  routeParams: { id: "group-1" } as Record<string, string>,
  router: { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} },
}));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.routeParams,
  useRouter: () => mocks.router,
  usePathname: () => "/groups/group-1",
  useSearchParams: () => new URLSearchParams(""),
}));

const GROUP = {
  id: "group-1",
  name: "Creative Builders",
  description: "A place to build things together.",
  coverUrl: null,
  visibility: "public",
};

const POST = {
  id: "post-1",
  content: "A post from inside the group",
  createdAt: "2026-09-20T09:00:00.000Z",
  visibility: "group",
  commentCount: 0,
  reactionCount: 0,
  media: [],
  author: { id: "user-2", name: "Maya Chen", username: "maya_designs", avatarUrl: null },
};

/** Every request the page made, so a test can ask what was *asked for*. */
function stubFetch({ isMember = true, posts = () => [POST] as unknown[] } = {}): FetchRecorder {
  return stubFetchEndpoints(
    {
      "/api/groups": { group: GROUP, stats: { members: 12 }, isMember, memberRole: null },
      "/api/groups/members": () => json({ member: true }, 201),
      "/api/posts": () => ({ data: posts(), pagination: { nextCursor: null } }),
    },
    // A path this page does not read is a 404, as it is for the real route.
    { fallback: () => json({}, 404) },
  );
}

async function renderGroup() {
  const { default: GroupView } = await import("@/app/(main)/groups/[id]/page");
  const ui = mountSurface(<GroupView />);
  // The group's heading, or the notice that stands in for it when the group is
  // not there. The loading state has neither, so either one is "the page has
  // loaded" — and how long that took is the network's business, not the test's.
  await ui.waitFor(() => ui.container.querySelector("h1, h3") !== null, {
    description: "the group to finish loading",
  });
  return ui;
}

afterEach(() => {
  // Unmount before the body is cleared: a portal is a child of the body, and
  // emptying the body first makes React's own teardown throw.
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a group a member belongs to", () => {
  test("offers the composer, and names the audience as a fact rather than a choice", async () => {
    stubFetch();
    const ui = await renderGroup();
    const text = ui.container.textContent ?? "";
    expect(text).toContain("Post in Creative Builders");
    // The post's audience is the group, and the composer says so in a
    // sentence: there is no picker here to offer an audience a group post
    // could not have.
    expect(text).toContain("Members of Creative Builders can see this");
    expect(ui.container.textContent).not.toContain("Post audience");
    expect(text).toContain("Leave group");
  });

  test("publishes with the group id and no audience of its own", async () => {
    const { calls } = stubFetch();
    const ui = await renderGroup();
    const field = ui.container.querySelector<HTMLTextAreaElement>("textarea");
    expect(field, "the member's composer renders a field").not.toBeNull();
    await ui.type(field as HTMLTextAreaElement, "Built something today");

    const publish = [...ui.container.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").trim() === "Post",
    );
    expect(publish, "the composer renders a Post control").not.toBeUndefined();
    await ui.click(publish as HTMLElement);

    await ui.waitFor(
      () =>
        calls.some(
          (call) => call.path === "/api/posts" && call.body?.content === "Built something today",
        ),
      { description: "the post to be published" },
    );

    const published = calls.find(
      (call) => call.path === "/api/posts" && call.body?.content === "Built something today",
    );
    // The group, and nothing else: the audience belongs to the group rather
    // than to whatever the form was set to, and the server sets it.
    expect(published?.body).toEqual({ content: "Built something today", groupId: "group-1" });
  });

  test("shows the group's posts, credited to the members who wrote them", async () => {
    stubFetch();
    const ui = await renderGroup();
    const text = ui.container.textContent ?? "";
    expect(text).toContain("A post from inside the group");
    // A group speaks in its members' voices, so the card names the writer
    // rather than the group.
    expect(text).toContain("Maya Chen");
    expect(text).toContain("in Creative Builders");
    // And the list was read from the group's own feed, not the whole one.
    expect(text).toContain("12 members");
  });
});

describe("a group a stranger is looking at", () => {
  test("offers the way in instead of an empty room", async () => {
    const { calls } = stubFetch({ isMember: false });
    const ui = await renderGroup();
    const text = ui.container.textContent ?? "";
    expect(text).toContain("Join Creative Builders to see its posts");
    // The group's identity is still shown: the gate is a door, not a wall.
    expect(text).toContain("Creative Builders");
    expect(text).toContain("12 members");
    // No composer and no list, and no empty state pretending the group has
    // nothing in it.
    expect(text).not.toContain("Post in Creative Builders");
    expect(text).not.toContain("No posts yet");
    // The posts were never asked for: the audience rule would have answered
    // with none of them anyway.
    expect(calls.filter((call) => call.path.startsWith("/api/posts?groupId="))).toHaveLength(0);
  });

  test("reads the group's posts once joining has opened them", async () => {
    let visible: unknown[] = [];
    const { calls } = stubFetch({ isMember: false, posts: () => visible });
    const ui = await renderGroup();
    expect(ui.container.textContent).not.toContain("A post from inside the group");

    visible = [POST];
    const join = [...ui.container.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes("Join group"),
    );
    expect(join, "the gate renders a Join control").not.toBeUndefined();
    await ui.click(join as HTMLElement);

    await ui.waitFor(
      () => (ui.container.textContent ?? "").includes("A post from inside the group"),
      { description: "the group's posts to appear after joining" },
    );

    const membership = calls.find((call) => call.path === "/api/groups/members");
    expect(membership?.body).toEqual({ groupId: "group-1" });
    expect(calls.filter((call) => call.path.startsWith("/api/posts?groupId="))).toHaveLength(1);
    // The composer is the other half of what membership buys.
    expect(ui.container.textContent).toContain("Post in Creative Builders");
  });
});

describe("a group that is not there", () => {
  test("says so rather than showing an empty group", async () => {
    // A private group answers 403 to a non-member, which from here is the same
    // answer as a group that does not exist: nothing to see, and a way back.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "You must be a member to view this group" }, 403)),
    );
    const ui = await renderGroup();
    const text = ui.container.textContent ?? "";
    expect(text).toContain("Group not found");
    expect(text).toContain("Browse groups");
  });
});
