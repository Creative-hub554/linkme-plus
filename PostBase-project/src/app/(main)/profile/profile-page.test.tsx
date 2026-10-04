// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The profile page, driven through its tabs and controls.
 *
 * The rendered audit proves the page can mount with a member on it; this is the
 * handlers behind it. The composer publishes optimistically (and hands the text
 * back on failure), the posts footer pages the next cursor, the photos and
 * videos tabs each fetch their own media, the message dialog opens a
 * conversation, and deleting one of the owner's own posts goes through the
 * card's menu. The realtime channel is a no-op — the live paths are a different
 * subject.
 */
const mocks = vi.hoisted(() => ({
  user: { id: "user-1", email: "theo@example.com", name: "Theo Wu" },
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(""),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, isLoading: false }),
}));

vi.mock("@/utils/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return { createClient: () => ({ channel: () => channel, removeChannel: () => {} }) };
});

const profile = {
  user: {
    id: "user-1",
    displayName: "Theo Wu",
    username: "theo",
    bio: "Visual designer",
    location: "Singapore",
    createdAt: "2020-03-01T00:00:00.000Z",
    avatarUrl: null,
    coverUrl: null,
    coverVideoUrl: null,
    coverConfig: null,
    shortVideoCoverConfig: null,
  },
  stats: { followers: 4, following: 5 },
  isFollowing: false,
};

function profilePost(id: string, content: string, media: unknown[] = []) {
  return {
    id,
    content,
    createdAt: "2026-09-20T09:00:00.000Z",
    visibility: "public",
    editedAt: null,
    author: { id: "user-1", name: "Theo Wu", username: "theo", avatarUrl: null },
    media,
  };
}

const firstPage = { data: [profilePost("post-1", "My first post")], pagination: { nextCursor: "cursor-1" } };
const secondPage = { data: [profilePost("post-2", "My older post")], pagination: { nextCursor: null } };

function postsEndpoint(options: { postStatus?: number; appendStatus?: number } = {}): StubEndpoint {
  return (request) => {
    if (request.method === "POST") {
      if (options.postStatus && options.postStatus >= 400) {
        return new Response(JSON.stringify({ error: "no" }), { status: options.postStatus });
      }
      return new Response(
        JSON.stringify({ post: { id: "published-1", createdAt: "2026-09-27T00:00:00.000Z", visibility: "public" }, media: [] }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (request.method === "PUT") return new Response(JSON.stringify({}), { status: 200 });
    if (request.method === "DELETE") {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (request.query.get("cursor")) {
      if (options.appendStatus && options.appendStatus >= 400) {
        return new Response(JSON.stringify({ error: "no" }), { status: options.appendStatus });
      }
      return secondPage;
    }
    return firstPage;
  };
}

const mediaEndpoint: StubEndpoint = { url: "https://cdn.example/uploaded.png", type: "image/png" };

/** The other member the message tests open. */
const mayaProfile = {
  user: { ...profile.user, id: "user-2", displayName: "Maya Chen", username: "maya" },
  stats: { followers: 9, following: 9 },
  isFollowing: false,
};

async function mountProfile(
  endpoints: Record<string, StubEndpoint> = {},
  search = "",
): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  mocks.searchParams = new URLSearchParams(search);
  const requests = stubFetch({
    "/api/users": { user: profile.user, stats: profile.stats, isFollowing: false },
    "/api/posts": postsEndpoint(),
    "/api/posts/media": mediaEndpoint,
    "/api/messages": { conversationId: "conv-9" },
    ...endpoints,
  });
  const { default: ProfilePage } = await import("@/app/(main)/profile/page");
  const ui = mountSurface(<ProfilePage />, { providers: "theme+tooltip" });
  return { ui, requests };
}

function buttonWithText(ui: MountedSurface, text: string): HTMLElement | null {
  // Exact, after trimming: "Post" must not match the "Posts" tab beside it.
  return (
    ([...ui.container.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === text,
    ) as HTMLElement | undefined) ?? null
  );
}

/** A control in a portal — a dialog's Send button lives on the body, not the container. */
function buttonInDocument(text: string): HTMLElement | null {
  return (
    ([...document.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").trim() === text,
    ) as HTMLElement | undefined) ?? null
  );
}

/** The first card's options menu, opened the way a reader opens it. */
async function openPostMenu(ui: MountedSurface) {
  const trigger = document.querySelector('[aria-label="More post options"]');
  if (!trigger) throw new Error("the first card rendered no options menu");
  await ui.pointerDown(trigger as HTMLElement);
  await ui.waitFor(
    () => [...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.includes("Delete post")),
    { description: "the post options menu" },
  );
}

/** A menu item in the portal, by its text. */
function menuItem(text: string): HTMLElement {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!item) throw new Error(`no menu item ${text}`);
  return item as HTMLElement;
}

/** A member whose profile has both a photo cover and a published cover video. */
const coverProfile = {
  user: {
    ...profile.user,
    coverUrl: "https://cdn.example/cover.png",
    coverVideoUrl: "https://cdn.example/cover.mp4",
  },
  stats: profile.stats,
  isFollowing: false,
};

function openTab(ui: MountedSurface, label: string) {
  const nav = ui.container.querySelector("nav[aria-label=\"Profile sections\"]");
  const button = [...(nav?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no ${label} tab`);
  return ui.click(button as HTMLElement);
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mocks.push.mockClear();
  mocks.replace.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:post") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
});

describe("the profile page", () => {
  test("shows the member's posts and pages in the next one", async () => {
    const { ui } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the first page of posts",
    });
    await ui.click(ui.byName("Load more posts by Theo Wu"));
    await ui.waitFor(() => ui.container.textContent?.includes("My older post") ?? false, {
      description: "the next page of posts",
    });
    // The footer is only there while another page remains.
    expect(ui.container.querySelector('[aria-label="Load more posts by Theo Wu"]')).toBeNull();
  });

  test("says so when a further page fails", async () => {
    const { ui } = await mountProfile({ "/api/posts": postsEndpoint({ appendStatus: 500 }) });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the first page",
    });
    await ui.click(ui.byName("Load more posts by Theo Wu"));
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't load more posts") ?? false, {
      description: "the load-more failure",
    });
    // The posts already loaded stay put.
    expect(ui.container.textContent).toContain("My first post");
  });

  test("publishes from the profile composer", async () => {
    const { ui, requests } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    const textarea = ui.container.querySelector("textarea") as HTMLTextAreaElement;
    await ui.focus(textarea);
    await ui.type(textarea, "A profile thought");
    await ui.click(buttonWithText(ui, "Post") as HTMLElement);
    await ui.waitFor(() => requests.calls.some((call) => call.method === "POST" && call.pathname === "/api/posts"), {
      description: "the publish request",
    });
    expect(ui.container.textContent).toContain("A profile thought");
  });

  test("hands the text back when a profile publish fails", async () => {
    const { ui } = await mountProfile({ "/api/posts": postsEndpoint({ postStatus: 500 }) });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    const textarea = ui.container.querySelector("textarea") as HTMLTextAreaElement;
    await ui.focus(textarea);
    await ui.type(textarea, "This one will not land");
    await ui.click(buttonWithText(ui, "Post") as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't publish your post") ?? false, {
      description: "the publish failure",
    });
    expect((ui.container.querySelector("textarea") as HTMLTextAreaElement).value).toContain("This one will not land");
  });

  test("loads the photos tab", async () => {
    const { ui } = await mountProfile({
      "/api/posts": (request) => {
        if (request.method !== "GET") return new Response(JSON.stringify({}), { status: 200 });
        if (request.query.get("limit") === "100") {
          return {
            data: [
              profilePost("post-1", "Mine", [
                { id: "m1", url: "https://cdn.example/one.png", type: "image/png", altText: "One", createdAt: "2026-09-20T09:00:00.000Z" },
              ]),
            ],
            pagination: { nextCursor: null },
          };
        }
        return request.query.get("cursor") ? secondPage : firstPage;
      },
    });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await openTab(ui, "Photos");
    await ui.waitFor(() => ui.container.querySelector('img[alt="One"]') !== null, {
      description: "the photo the media fetch returned",
    });
  });

  test("loads the videos tab", async () => {
    const { ui } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await openTab(ui, "Videos");
    await ui.waitFor(() => ui.container.textContent?.includes("No videos yet") ?? false, {
      description: "the videos tab",
    });
  });

  test("shows the about, friends and more sections", async () => {
    const { ui } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await openTab(ui, "About");
    expect(ui.container.textContent).toContain("Visual designer");
    await openTab(ui, "Friends");
    expect(ui.container.textContent).toContain("Friends are coming soon");
    await openTab(ui, "More");
    expect(ui.container.textContent).toContain("More sections");
  });

  test("opens the cover studio from the cover tab", async () => {
    const { ui } = await mountProfile({}, "tab=cover");
    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Filter templates by category"]') !== null,
      { description: "the cover studio" },
    );
  });

  test("sends the first message of a conversation", async () => {
    const { ui, requests } = await mountProfile(
      {
        "/api/users": mayaProfile,
        "/api/users/follow": { following: true, followers: 10 },
      },
      "user=user-2",
    );
    await ui.waitFor(() => ui.container.textContent?.includes("Maya Chen") ?? false, {
      description: "the other member's profile",
    });
    await ui.click(buttonWithText(ui, "Message") as HTMLElement);
    await ui.waitFor(() => document.querySelector('[aria-label="Message to Maya Chen"]') !== null, {
      description: "the message box",
    });
    await ui.type(document.querySelector('[aria-label="Message to Maya Chen"]') as HTMLTextAreaElement, "Hello there");
    await ui.click(buttonInDocument("Send") as HTMLElement);
    await ui.waitFor(() => mocks.push.mock.calls.length > 0, { description: "the conversation to open" });
    expect(mocks.push).toHaveBeenCalledWith("/messages?c=conv-9");
    expect(requests.calls.some((call) => call.pathname === "/api/messages" && call.method === "POST")).toBe(true);
  });

  test("explains a failed message", async () => {
    const { ui } = await mountProfile(
      {
        "/api/users": mayaProfile,
        "/api/users/follow": { following: true, followers: 10 },
        // A handler, not a bare `Response`: a plain value is answered as JSON
        // 200 by the stub, so only a handler carries a non-2xx status through.
        "/api/messages": () => new Response(JSON.stringify({ error: "no" }), { status: 500 }),
      },
      "user=user-2",
    );
    await ui.waitFor(() => ui.container.textContent?.includes("Maya Chen") ?? false, {
      description: "the other member's profile",
    });
    await ui.click(buttonWithText(ui, "Message") as HTMLElement);
    await ui.waitFor(() => document.querySelector('[aria-label="Message to Maya Chen"]') !== null, {
      description: "the message box",
    });
    await ui.type(document.querySelector('[aria-label="Message to Maya Chen"]') as HTMLTextAreaElement, "Hello there");
    await ui.click(buttonInDocument("Send") as HTMLElement);
    await ui.waitFor(() => document.body.textContent?.includes("couldn't send that message") ?? false, {
      description: "the send failure",
    });
  });

  test("opens the member list from a stats tile", async () => {
    const { ui } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await ui.click(ui.byName("Followers of Theo Wu: 4. Open list"));
    await ui.waitFor(() => document.body.textContent?.includes("Followers of Theo Wu") ?? false, {
      description: "the member list dialog",
    });
  });

  test("opens someone else's profile from a link", async () => {
    const { ui } = await mountProfile(
      {
        "/api/users": {
          user: { ...profile.user, id: "user-2", displayName: "Maya Chen", username: "maya" },
          stats: { followers: 9, following: 9 },
          isFollowing: false,
        },
      },
      "user=user-2",
    );
    await ui.waitFor(() => ui.container.textContent?.includes("Maya Chen") ?? false, {
      description: "the other member's profile",
    });
    // Their own composer is not shown, but their posts tab is.
    expect(ui.container.textContent).not.toContain("What's on your mind?");
  });

  test("deletes an owned post, after confirming", async () => {
    const { ui, requests } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Delete post"));
    await ui.waitFor(() => buttonInDocument("Delete post") !== null, { description: "the confirm dialog" });
    await ui.click(buttonInDocument("Delete post") as HTMLElement);
    await ui.waitFor(() => !(ui.container.textContent?.includes("My first post") ?? false), {
      description: "the deleted card to leave the list",
    });
    expect(requests.calls.some((call) => call.method === "DELETE" && call.pathname === "/api/posts")).toBe(true);
    // With the last post gone the footer gives way to the empty state.
    expect(ui.container.textContent).toContain("No posts yet");
  });

  test("puts a post back when deleting it fails", async () => {
    const { ui } = await mountProfile({
      "/api/posts": (request) => {
        if (request.method === "DELETE") return new Response(JSON.stringify({ error: "no" }), { status: 500 });
        if (request.method === "POST") return new Response(JSON.stringify({}), { status: 200 });
        return request.query.get("cursor") ? secondPage : firstPage;
      },
    });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Delete post"));
    await ui.waitFor(() => buttonInDocument("Delete post") !== null, { description: "the confirm dialog" });
    await ui.click(buttonInDocument("Delete post") as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't delete that post") ?? false, {
      description: "the delete failure",
    });
    expect(ui.container.textContent).toContain("My first post");
  });

  test("edits an owned post", async () => {
    const { ui, requests } = await mountProfile();
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Edit post"));
    const field = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    await ui.waitFor(() => field !== null, { description: "the edit form" });
    await ui.type(field, "My edited profile post");
    await ui.click(buttonInDocument("Save changes") as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("My edited profile post") ?? false, {
      description: "the edited card",
    });
    expect(requests.calls.some((call) => call.method === "PUT" && call.pathname === "/api/posts")).toBe(true);
  });

  test("puts an edit back when saving it fails", async () => {
    const { ui } = await mountProfile({
      "/api/posts": (request) => {
        if (request.method === "PUT") return new Response(JSON.stringify({ error: "no" }), { status: 500 });
        if (request.method === "POST") return new Response(JSON.stringify({}), { status: 200 });
        return request.query.get("cursor") ? secondPage : firstPage;
      },
    });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Edit post"));
    const field = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    await ui.waitFor(() => field !== null, { description: "the edit form" });
    await ui.type(field, "My edited profile post");
    await ui.click(buttonInDocument("Save changes") as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't save your changes") ?? false, {
      description: "the update failure",
    });
    expect(ui.container.textContent).toContain("My first post");
  });

  test("saves the cover from the editor", async () => {
    const { ui, requests } = await mountProfile({ "/api/users": coverProfile });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await ui.click(buttonWithText(ui, "Edit cover") as HTMLElement);
    await ui.waitFor(() => buttonInDocument("Save cover") !== null, { description: "the cover editor" });
    await ui.click(buttonInDocument("Save cover") as HTMLElement);
    await ui.waitFor(() => requests.calls.some((call) => call.method === "PUT" && call.pathname === "/api/users"), {
      description: "the cover save",
    });
  });

  test("removes the published cover video from the editor", async () => {
    const { ui, requests } = await mountProfile({
      "/api/users": coverProfile,
      "/api/profile/cover-video": () => new Response(JSON.stringify({}), { status: 200 }),
    });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await ui.click(buttonWithText(ui, "Edit cover") as HTMLElement);
    await ui.waitFor(() => buttonInDocument("Remove video") !== null, { description: "the cover editor" });
    await ui.click(buttonInDocument("Remove video") as HTMLElement);
    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "DELETE" && call.pathname === "/api/profile/cover-video"),
      { description: "the video removal" },
    );
  });

  test("removes the whole cover from the editor", async () => {
    const { ui, requests } = await mountProfile({
      "/api/users": coverProfile,
      "/api/profile/cover": () => new Response(JSON.stringify({}), { status: 200 }),
    });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await ui.click(buttonWithText(ui, "Edit cover") as HTMLElement);
    await ui.waitFor(() => buttonInDocument("Remove cover") !== null, { description: "the cover editor" });
    await ui.click(buttonInDocument("Remove cover") as HTMLElement);
    await ui.waitFor(
      () => requests.calls.some((call) => call.method === "DELETE" && call.pathname === "/api/profile/cover"),
      { description: "the cover removal" },
    );
  });

  test("reports a failed cover removal in the editor", async () => {
    const { ui } = await mountProfile({
      "/api/users": coverProfile,
      "/api/profile/cover": () => new Response(JSON.stringify({ error: "Cover is stuck" }), { status: 500 }),
    });
    await ui.waitFor(() => ui.container.textContent?.includes("My first post") ?? false, {
      description: "the profile",
    });
    await ui.click(buttonWithText(ui, "Edit cover") as HTMLElement);
    await ui.waitFor(() => buttonInDocument("Remove cover") !== null, { description: "the cover editor" });
    await ui.click(buttonInDocument("Remove cover") as HTMLElement);
    await ui.waitFor(() => document.body.textContent?.includes("Cover is stuck") ?? false, {
      description: "the removal failure in the editor",
    });
  });
});
