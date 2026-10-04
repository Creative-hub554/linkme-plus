// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch, type FetchRecorder, type StubEndpoint } from "@/test/stub-fetch";

/**
 * The feed page, driven through the controls a reader actually uses.
 *
 * The rendered audit shows that the populated feed can be mounted at all; this
 * is the other half — the handlers behind the controls. Publishing walks the
 * optimistic-post path (create, confirm, or roll back and hand the text back),
 * the sentinel pages the next cursor in, the refresh button re-reads page one,
 * and the two error surfaces — a failed first page and a failed publish — say
 * what happened. The realtime subscription is a no-op channel: the live paths
 * are a separate subject, and everything here is reachable without them.
 */
const mocks = vi.hoisted(() => ({
  user: { id: "user-1", email: "theo@example.com", name: "Theo Wu" },
  replace: vi.fn(),
  searchParams: new URLSearchParams(""),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    push: vi.fn(),
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

/** jsdom has no `IntersectionObserver`, and the sentinel needs one to page in. */
class ImmediateObserver {
  #callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
    this.#callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function post(id: string, content: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content,
    createdAt: "2026-09-20T09:00:00.000Z",
    visibility: "public",
    commentCount: 0,
    reactionCount: 0,
    author: { id: "user-2", name: "Maya Chen", username: "maya_designs", avatarUrl: null },
    media: [],
    ...overrides,
  };
}

const firstPage = { data: [post("post-1", "First post"), post("post-2", "Second post")], pagination: { nextCursor: "cursor-1" } };
const secondPage = { data: [post("post-3", "Third post")], pagination: { nextCursor: null } };

/** The `/api/posts` endpoint, branching on method and cursor. */
function postsEndpoint(recorder: { postStatus?: number } = {}): StubEndpoint {
  return (request) => {
    if (request.method === "POST") {
      if (recorder.postStatus && recorder.postStatus >= 400) {
        return new Response(JSON.stringify({ error: "nope" }), { status: recorder.postStatus });
      }
      return new Response(
        JSON.stringify({ post: { id: "published-1", createdAt: "2026-09-27T00:00:00.000Z", visibility: "public" }, media: [] }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    return request.query.get("cursor") ? secondPage : firstPage;
  };
}

const mediaEndpoint: StubEndpoint = { url: "https://cdn.example/uploaded.png", type: "image/png" };

async function mountFeed(endpoints: Record<string, StubEndpoint>): Promise<{ ui: MountedSurface; requests: FetchRecorder }> {
  const requests = stubFetch({ "/api/posts": postsEndpoint(), "/api/posts/counts": { data: [] }, "/api/posts/media": mediaEndpoint, ...endpoints });
  const { default: FeedPage } = await import("@/app/(main)/feed/page");
  const ui = mountSurface(<FeedPage />, { providers: "theme+tooltip" });
  return { ui, requests };
}

/**
 * A page holding one post the *reader* wrote, so the card carries its own
 * options menu — delete and edit are only offered on your own posts.
 */
const ownFirstPage = {
  data: [
    post("own-1", "My own post", {
      author: { id: "user-1", name: "Theo Wu", username: "theo", avatarUrl: null },
    }),
    post("own-2", "My second post", {
      author: { id: "user-1", name: "Theo Wu", username: "theo", avatarUrl: null },
    }),
  ],
  pagination: { nextCursor: null },
};

function ownPostsEndpoint(options: { deleteStatus?: number; updateStatus?: number } = {}): StubEndpoint {
  return (request) => {
    if (request.method === "DELETE") {
      return options.deleteStatus && options.deleteStatus >= 400
        ? new Response(JSON.stringify({ error: "no" }), { status: options.deleteStatus })
        : new Response(JSON.stringify({}), { status: 200 });
    }
    if (request.method === "PUT") {
      return options.updateStatus && options.updateStatus >= 400
        ? new Response(JSON.stringify({ error: "no" }), { status: options.updateStatus })
        : new Response(JSON.stringify({}), { status: 200 });
    }
    return ownFirstPage;
  };
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

/** A button in a portal — the confirm and edit dialogs render on the body. */
function dialogButton(text: string): HTMLElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => (candidate.textContent ?? "").trim() === text,
  );
  if (!button) throw new Error(`no dialog button ${text}`);
  return button as HTMLElement;
}

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mocks.replace.mockClear();
  mocks.searchParams = new URLSearchParams("");
  URL.createObjectURL = vi.fn(() => "blob:post") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  vi.stubGlobal("IntersectionObserver", ImmediateObserver);
});

describe("the feed page", () => {
  test("shows the feed and pages the next cursor in", async () => {
    const { ui } = await mountFeed({});
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the first page of posts",
    });
    // The sentinel reported itself in view, so the next page is requested.
    await ui.waitFor(() => ui.container.textContent?.includes("Third post") ?? false, {
      description: "the second page of posts",
    });
    expect(ui.container.textContent).toContain("You're all caught up.");
  });

  test("publishes a post and confirms the optimistic card", async () => {
    const { ui, requests } = await mountFeed({});
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the feed",
    });
    const textarea = ui.container.querySelector("textarea") as HTMLTextAreaElement;
    await ui.focus(textarea);
    await ui.type(textarea, "A brand new thought");
    const postButton = [...ui.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Post");
    await ui.click(postButton as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("A brand new thought") ?? false, {
      description: "the published post",
    });
    expect(requests.calls.some((call) => call.pathname === "/api/posts" && call.method === "POST")).toBe(true);
  });

  test("uploads an image attachment before publishing", async () => {
    const { ui, requests } = await mountFeed({});
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the feed",
    });
    const textarea = ui.container.querySelector("textarea") as HTMLTextAreaElement;
    await ui.focus(textarea);
    const fileInput = ui.container.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement;
    await ui.chooseFiles(fileInput, [new File([new Uint8Array(8)], "shot.png", { type: "image/png" })]);
    const postButton = [...ui.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Post");
    await ui.click(postButton as HTMLElement);
    await ui.waitFor(() => requests.calls.some((call) => call.pathname === "/api/posts/media"), {
      description: "the attachment upload",
    });
  });

  test("hands the text back and explains when publishing fails", async () => {
    const { ui } = await mountFeed({ "/api/posts": postsEndpoint({ postStatus: 500 }) });
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the feed",
    });
    const textarea = ui.container.querySelector("textarea") as HTMLTextAreaElement;
    await ui.focus(textarea);
    await ui.type(textarea, "This one will not land");
    const postButton = [...ui.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Post");
    await ui.click(postButton as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't publish your post") ?? false, {
      description: "the publish failure",
    });
    // The author's text is not lost: it is handed back to the composer.
    expect((ui.container.querySelector("textarea") as HTMLTextAreaElement).value).toContain("This one will not land");
  });

  test("dismisses a publish error", async () => {
    const { ui } = await mountFeed({ "/api/posts": postsEndpoint({ postStatus: 500 }) });
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the feed",
    });
    const textarea = ui.container.querySelector("textarea") as HTMLTextAreaElement;
    await ui.focus(textarea);
    await ui.type(textarea, "Fails");
    const postButton = [...ui.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Post");
    await ui.click(postButton as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't publish your post") ?? false, {
      description: "the publish error",
    });
    await ui.click(ui.byName("Dismiss error"));
    expect(ui.container.textContent).not.toContain("couldn't publish your post");
  });

  test("re-reads page one from the refresh control", async () => {
    const { ui, requests } = await mountFeed({});
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the feed",
    });
    const refresh = [...ui.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Refresh feed"));
    await ui.click(refresh as HTMLElement);
    await ui.waitFor(() => requests.calls.filter((call) => call.pathname === "/api/posts").length >= 3, {
      description: "a refresh read",
    });
  });

  test("says the feed is unavailable and retries from the top", async () => {
    let attempt = 0;
    const { ui } = await mountFeed({
      "/api/posts": (request) => {
        if (request.method === "POST") return { post: { id: "p", createdAt: "2026-09-27T00:00:00.000Z", visibility: "public" }, media: [] };
        attempt += 1;
        return attempt === 1
          ? new Response(JSON.stringify({ error: "no" }), { status: 500 })
          : firstPage;
      },
    });
    await ui.waitFor(() => ui.container.textContent?.includes("Feed unavailable") ?? false, {
      description: "the unavailable state",
    });
    const retry = [...ui.container.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    await ui.click(retry as HTMLElement);
    await ui.waitFor(() => ui.container.textContent?.includes("First post") ?? false, {
      description: "the retry loading the feed",
    });
  });

  test("says the feed is quiet when there is nothing in it", async () => {
    const { ui } = await mountFeed({
      "/api/posts": (request) =>
        request.method === "POST"
          ? { post: { id: "p", createdAt: "2026-09-27T00:00:00.000Z", visibility: "public" }, media: [] }
          : { data: [], pagination: { nextCursor: null } },
    });
    await ui.waitFor(() => ui.container.textContent?.includes("Your feed is quiet") ?? false, {
      description: "the empty feed",
    });
  });

  test("deletes one of the reader's own posts, after confirming", async () => {
    const { ui, requests } = await mountFeed({ "/api/posts": ownPostsEndpoint() });
    await ui.waitFor(() => ui.container.textContent?.includes("My own post") ?? false, {
      description: "the own post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Delete post"));
    await ui.waitFor(() => dialogButton("Delete post") !== null, { description: "the confirm dialog" });
    await ui.click(dialogButton("Delete post"));
    await ui.waitFor(() => !(ui.container.textContent?.includes("My own post") ?? false), {
      description: "the deleted card to leave the list",
    });
    expect(requests.calls.some((call) => call.method === "DELETE" && call.pathname === "/api/posts")).toBe(true);
    // The other post is untouched.
    expect(ui.container.textContent).toContain("My second post");
  });

  test("puts a post back when deleting it fails", async () => {
    const { ui } = await mountFeed({ "/api/posts": ownPostsEndpoint({ deleteStatus: 500 }) });
    await ui.waitFor(() => ui.container.textContent?.includes("My own post") ?? false, {
      description: "the own post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Delete post"));
    await ui.waitFor(() => dialogButton("Delete post") !== null, { description: "the confirm dialog" });
    await ui.click(dialogButton("Delete post"));
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't delete that post") ?? false, {
      description: "the delete failure",
    });
    expect(ui.container.textContent).toContain("My own post");
  });

  test("edits one of the reader's own posts", async () => {
    const { ui, requests } = await mountFeed({ "/api/posts": ownPostsEndpoint() });
    await ui.waitFor(() => ui.container.textContent?.includes("My own post") ?? false, {
      description: "the own post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Edit post"));
    const field = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    await ui.waitFor(() => field !== null, { description: "the edit form" });
    await ui.type(field, "My edited post");
    await ui.click(dialogButton("Save changes"));
    await ui.waitFor(() => ui.container.textContent?.includes("My edited post") ?? false, {
      description: "the edited card",
    });
    expect(requests.calls.some((call) => call.method === "PUT" && call.pathname === "/api/posts")).toBe(true);
  });

  test("puts an edit back when saving it fails", async () => {
    const { ui } = await mountFeed({ "/api/posts": ownPostsEndpoint({ updateStatus: 500 }) });
    await ui.waitFor(() => ui.container.textContent?.includes("My own post") ?? false, {
      description: "the own post",
    });
    await openPostMenu(ui);
    await ui.click(menuItem("Edit post"));
    const field = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    await ui.waitFor(() => field !== null, { description: "the edit form" });
    await ui.type(field, "My edited post");
    await ui.click(dialogButton("Save changes"));
    await ui.waitFor(() => ui.container.textContent?.includes("couldn't save your changes") ?? false, {
      description: "the update failure",
    });
    expect(ui.container.textContent).toContain("My own post");
  });
});
