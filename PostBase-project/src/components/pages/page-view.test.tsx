// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import {
  json,
  stubFetch as stubFetchEndpoints,
  type FetchRecorder,
} from "@/test/stub-fetch";

/**
 * The Page view, judged on the three things that are its own rather than the
 * API's: whose identity a post carries, who is offered the composer, and what a
 * follow sends.
 *
 * The first is the subtle one. The API returns each post's `author` as the
 * *member* who pressed publish — they own the row, so edits and deletes keep
 * working — and the Page beside it. A view that rendered `author` would credit
 * every post to whoever happened to be signed in, which is exactly the bug this
 * pins: the admin's name must not appear anywhere on the Page.
 */
const mocks = vi.hoisted(() => ({
  routeParams: { username: "northwind_studio" } as Record<string, string>,
  router: { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} },
}));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.routeParams,
  useRouter: () => mocks.router,
  usePathname: () => "/pages/northwind_studio",
  useSearchParams: () => new URLSearchParams(""),
}));

const PAGE = {
  id: "page-1",
  username: "northwind_studio",
  name: "Northwind Studio",
  description: "A studio that makes things.",
  avatarUrl: null,
  coverUrl: null,
  category: null,
};

const POST = {
  id: "post-1",
  content: "A post from the Page",
  createdAt: "2026-09-20T09:00:00.000Z",
  visibility: "public",
  commentCount: 1,
  reactionCount: 2,
  media: [],
  author: { id: "user-1", name: "Maya Chen", username: "maya_designs", avatarUrl: null },
};

/** A `followers` post the Page published, readable once the viewer follows it. */
const FOLLOWERS_POST = {
  ...POST,
  id: "post-2",
  content: "Only the Page's followers see this",
  visibility: "followers",
};

/**
 * A control whose own visible words are these — a button named from its content
 * rather than by an `aria-label`. Read from the document, because a Radix dialog
 * portals its content out of the mount container.
 */
function buttonReading(root: ParentNode, text: string) {
  const element = [...root.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!element) throw new Error(`no button reading "${text}" was rendered`);
  return element as HTMLButtonElement;
}

/** Every request the view made, so a test can ask what was *sent*. */
function stubFetch({
  role = "admin" as string | null,
  followers = 3,
  isFollowing = false,
  posts = () => [POST] as unknown[],
} = {}): FetchRecorder {
  return stubFetchEndpoints(
    {
      // What the upload route answers: the url it just stored.
      "/api/pages/image": (request) => {
        const kind = request.form?.get("kind") ?? null;
        return { kind, url: `https://cdn.test/${String(kind)}.png` };
      },
      // One path, two answers: a `PUT` returns the row it just wrote, a `GET`
      // reads the Page and the viewer's relation to it.
      "/api/pages": (request) => {
        if (request.method === "PUT") {
          const body = request.body as { name: string; description: string };
          return { page: { ...PAGE, name: body.name, description: body.description } };
        }
        return { page: PAGE, stats: { followers, posts: 1 }, isFollowing, role };
      },
      "/api/pages/follow": (request) => {
        const following = (request.body as { following: boolean }).following;
        return json({ following, followers: following ? followers + 1 : followers - 1 }, 201);
      },
      "/api/posts": () => ({ data: posts(), pagination: { nextCursor: null } }),
    },
    // A path this Page does not read is a 404, so a route it should not have
    // called fails as a missing thing rather than answering an empty 200.
    { fallback: () => json({}, 404) },
  );
}

async function renderPage() {
  const { default: PageView } = await import("@/app/(main)/pages/[username]/page");
  // Mounted as a whole page: a post card's controls are tooltips, and without
  // the provider the real layout supplies they throw rather than render.
  const ui = mountSurface(<PageView />);
  // The Page itself, rather than a count of ticks. The view keeps its loading
  // state until *both* requests are done — the posts are fetched with the id
  // the first one returns — so the heading appearing is exactly "the Page has
  // loaded", and how long the two took is the network's business, not the
  // test's.
  await ui.waitFor(() => ui.container.querySelector("h1") !== null, {
    description: "the Page to finish loading",
  });
  return ui;
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  // Unmount before the body is cleared: a portal is a child of the body, and
  // emptying the body first makes React's own teardown throw.
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a public Page", () => {
  test("shows the Page's own identity on its posts, not the admin's", async () => {
    const ui = await renderPage();
    const text = ui.container.textContent ?? "";
    expect(text).toContain("Northwind Studio");
    expect(text).toContain("3 followers");
    // The post is the Page's. Its `author` in the payload is Maya, and her
    // name must be nowhere — that is the whole point of the Page.
    expect(text).toContain("@northwind_studio");
    expect(text).not.toContain("Maya Chen");
    expect(text).not.toContain("maya_designs");
    expect(text).toContain("A post from the Page");
  });

  test("offers the 'post as' composer and Page editing to an admin and to nobody else", async () => {
    const admin = await renderPage();
    expect(admin.container.textContent).toContain("Post as Northwind Studio");
    expect(admin.container.textContent).toContain("Edit Page");
    // Done with the admin's view; the two below mount in their own containers.
    admin.unmount();

    // Both non-admin shapes. `null` is a stranger with no role row at all; a
    // named non-admin role is the one that matters, because a rule that says
    // "has a role" rather than "is an admin" would let it through — and a Page
    // can have members who are not admins.
    for (const role of [null, "member"]) {
      vi.unstubAllGlobals();
      stubFetch({ role });
      const visitor = await renderPage();
      expect(visitor.container.textContent).not.toContain("Post as Northwind Studio");
      expect(visitor.container.textContent).not.toContain("Edit Page");
      // The follow control is for everyone; only the admin's controls are gated.
      expect(
        visitor.container.querySelector('button[aria-label="Follow Northwind Studio"]'),
      ).not.toBeNull();
      visitor.unmount();
    }
  });

  test("lets an admin rename and re-describe the Page from the Page itself", async () => {
    vi.unstubAllGlobals();
    const { calls } = stubFetch();
    const ui = await renderPage();
    expect(ui.container.querySelector("h1")?.textContent).toBe("Northwind Studio");

    await ui.click(buttonReading(ui.container, "Edit Page"));

      // The dialog is a portal, so its fields and its Save are in the document.
      // Waiting for a field rather than a tick: the dialog is Radix's, and how
      // many frames it takes to appear is not something a test can state.
      await ui.waitFor(
        () => document.querySelector('input[placeholder="e.g. Northwind Studio"]') !== null,
        { description: "the edit dialog to open" },
      );
      const name = document.querySelector<HTMLInputElement>('input[placeholder="e.g. Northwind Studio"]');
      const description = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="What is this Page about?"]',
      );
      expect(name, "the dialog renders the name field").not.toBeNull();
      expect(description, "the dialog renders the description field").not.toBeNull();

      await ui.type(name as HTMLInputElement, "Northwind Works");
      await ui.type(description as HTMLTextAreaElement, "A studio, renamed.");
      await ui.click(buttonReading(document, "Save changes"));

      // Save is a request, and closing is what follows it: waiting for the
      // dialog to go is waiting for the write to have been answered.
      await ui.waitFor(() => document.querySelector('[role="dialog"]') === null, {
        description: "the dialog to close on save",
      });

      const saved = calls.find((call) => call.body?.name === "Northwind Works");
      // The id too: the route is given the Page rather than inferring one, and a
      // missing id is how an edit would land on the wrong Page or on none.
      expect(saved?.body).toEqual({ id: "page-1", name: "Northwind Works", description: "A studio, renamed." });
      // And the Page is showing it without a refetch: the header is the Page's
      // own state, which the dialog has just been told about.
    expect(ui.container.querySelector("h1")?.textContent).toBe("Northwind Works");
    expect(ui.container.textContent).toContain("A studio, renamed.");
    expect(document.querySelector('[role="dialog"]'), "the dialog closed on save").toBeNull();
  });

  test("following sends the intended state and takes the server's new total", async () => {
    vi.unstubAllGlobals();
    const { calls } = stubFetch();
    const ui = await renderPage();
    const button = ui.container.querySelector<HTMLElement>('button[aria-label="Follow Northwind Studio"]');
    expect(button, "the Page renders a named follow control").not.toBeNull();

    await ui.click(button as HTMLElement);

    // The total is the server's answer, so it appearing is the request having
    // been sent, answered and read — which is the whole of this test's claim.
    await ui.waitFor(() => (ui.container.textContent ?? "").includes("4 followers"), {
      description: "the server's new follower total",
    });

    const follow = calls.find((call) => call.path === "/api/pages/follow");
    // The intent, not a toggle: a stale view must not unfollow by accident.
    expect(follow?.body).toEqual({ pageId: "page-1", following: true });
    // And the count is the server's, not a local ±1.
    expect(ui.container.textContent).toContain("4 followers");
  });

  test("publishes to the audience the composer's picker is set to", async () => {
    vi.unstubAllGlobals();
    const { calls } = stubFetch();
    const ui = await renderPage();
    const field = ui.container.querySelector<HTMLTextAreaElement>("textarea");
    expect(field, "the admin's composer renders a field").not.toBeNull();
    await ui.type(field as HTMLTextAreaElement, "Only for the Page's followers");

    // The picker starts on the audience a public account should default to,
    // and the Page is named in the copy about whose followers can read it.
    const picker = ui.byName("Post audience: Public");
    await ui.pointerDown(picker);
    // The menu is portalled, and Radix mounts its content as it opens, so the
    // copy is waited for rather than read in the tick the press was sent in.
    await ui.waitFor(
      () => (document.body.textContent ?? "").includes("People who follow Northwind Studio"),
      { description: "the audience menu to open" },
    );

    // Chosen by clicking the option itself. The menu also walks by keyboard,
    // but that is Radix's own behaviour and depends on where focus has landed
    // by then — this test is about which audience is published to, so it does
    // not race that. The menu is opened by a press above, as the audit surface
    // opens it too.
    const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => (item.textContent ?? "").includes("Followers"),
    );
    expect(option, "the menu offers a Followers option").not.toBeUndefined();
    await ui.click(option as HTMLElement);
    // The control renames itself to the audience it is on: that is the choice
    // having been taken up, rather than just the option having been clicked.
    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Post audience: Followers"]') !== null,
      { description: "the picker to show Followers" },
    );

    await ui.click(buttonReading(ui.container, "Publish as Northwind Studio"));
    const sent = () =>
      calls.some(
        (call) => call.path === "/api/posts" && call.body?.content === "Only for the Page's followers",
      );
    // A publish is a request, so what was sent is what this waits for.
    await ui.waitFor(sent, { description: "the post to be published" });

    const published = calls.find(
      (call) => call.path === "/api/posts" && call.body?.content === "Only for the Page's followers",
    );
    // Whose audience, and whose post: the Page published it, and it went to
    // the audience the admin chose for the Page rather than to their own.
    expect(published?.body).toEqual({
      content: "Only for the Page's followers",
      pageId: "page-1",
      visibility: "followers",
    });
  });

  test("keeps unsaved text when a photo is uploaded next to it", async () => {
    // A photo is stored the moment it is chosen, and the dialog reports that
    // back to the Page — which flows in again as a changed prop. A form that
    // re-seeded itself on that would silently discard a half-typed name, and
    // the live check is where that was actually found.
    vi.unstubAllGlobals();
    const { calls } = stubFetch();
    const ui = await renderPage();
    await ui.click(buttonReading(ui.container, "Edit Page"));
    await ui.waitFor(
      () => document.querySelector('input[placeholder="e.g. Northwind Studio"]') !== null,
      { description: "the edit dialog to open" },
    );

    const name = document.querySelector<HTMLInputElement>('input[placeholder="e.g. Northwind Studio"]');
    await ui.type(name as HTMLInputElement, "Northwind Works");

    const avatarInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(avatarInput, "the dialog renders a file input").not.toBeNull();
    const photo = new File(["photo"], "photo.png", { type: "image/png" });
    await ui.chooseFiles(avatarInput as HTMLInputElement, [photo]);

    // The upload and the notice that reports it are both answers to choosing
    // the file, and neither lands in the tick the choice was made in.
    await ui.waitFor(
      () =>
        (document.querySelector('[role="dialog"]')?.textContent ?? "").includes(
          "Page photo updated.",
        ),
      { description: "the photo upload to be reported" },
    );

    const upload = calls.find((call) => call.path === "/api/pages/image");
    expect(upload, "the photo was uploaded").toBeDefined();
    // The Page and the kind travel with the file: the route decides both what
    // to write and who is allowed to, and neither is in the url.
    expect(upload?.form?.get("pageId")).toBe("page-1");
    expect(upload?.form?.get("kind")).toBe("avatar");
    expect(upload?.form?.get("file")).toBe(photo);
    // The typed name is still there, and the upload is reported.
    expect(name?.value).toBe("Northwind Works");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Page photo updated.",
    );
  });

  test("gates a Page the reader neither runs nor follows, and does not fetch what it hides", async () => {
    vi.unstubAllGlobals();
    const { calls } = stubFetch({ role: null });
    const ui = await renderPage();
    const text = ui.container.textContent ?? "";
    // The gate, in the Page's own name: following is the whole of the lock.
    expect(text).toContain("Follow Northwind Studio to see its posts");
    // The identity above it is still the Page's — the gate is a door, not a
    // wall — and the posts behind it are nowhere on screen.
    expect(text).toContain("Northwind Studio");
    expect(text).toContain("3 followers");
    expect(text).not.toContain("A post from the Page");
    // Not asked for at all: the request would have been answered with public
    // posts the gate is about to hide.
    expect(calls.filter((call) => call.path.startsWith("/api/posts?pageId="))).toHaveLength(0);
    // And no empty state standing in for the posts, which would read as "this
    // Page has published nothing".
    expect(text).not.toContain("No posts yet");
  });

  test("has exactly one follow control whether or not the gate is up", async () => {
    // The header's follow control moves into the gate rather than being
    // duplicated beside it: two buttons reading "Follow Northwind Studio" are
    // two controls a reader cannot tell apart.
    vi.unstubAllGlobals();
    stubFetch({ role: null });
    const gated = await renderPage();
    expect(
      gated.container.querySelectorAll('button[aria-label="Follow Northwind Studio"]').length,
    ).toBe(1);
    gated.unmount();

    vi.unstubAllGlobals();
    stubFetch({ role: null, isFollowing: true });
    const follower = await renderPage();
    // Its name follows the state it is in — "Unfollow Northwind Studio" — so
    // the count is over the button, not over one of its two names.
    expect(
      follower.container.querySelectorAll(
        'button[aria-label="Follow Northwind Studio"], button[aria-label="Unfollow Northwind Studio"]',
      ).length,
    ).toBe(1);
    // A follower is through the gate: the list is read and shown.
    expect(follower.container.textContent).toContain("A post from the Page");
    expect(follower.container.textContent).not.toContain("to see its posts");
  });

  test("opens on following, without leaving the page", async () => {
    vi.unstubAllGlobals();
    let visible: unknown[] = [];
    const { calls } = stubFetch({ role: null, posts: () => visible });
    const ui = await renderPage();
    expect(ui.container.textContent).toContain("Follow Northwind Studio to see its posts");

    visible = [POST];
    await ui.click(buttonReading(ui.container, "Follow"));

    // The posts are what says the follow landed: the same call is what reads
    // them the first time, so there is nothing else to wait for.
    await ui.waitFor(
      () => (ui.container.textContent ?? "").includes("A post from the Page"),
      { description: "the gated posts to appear after following" },
    );
    expect(ui.container.textContent).not.toContain("to see its posts");
    expect(calls.filter((call) => call.path.startsWith("/api/posts?pageId="))).toHaveLength(1);
  });

  test("leaves a Page's team through the gate, whatever their role is called", async () => {
    // A Page can have members who are not admins. They run its posts, so the
    // gate must not stand in front of them — only a reader with no relationship
    // at all meets it.
    vi.unstubAllGlobals();
    stubFetch({ role: "member" });
    const ui = await renderPage();
    expect(ui.container.textContent).toContain("A post from the Page");
    expect(ui.container.textContent).not.toContain("to see its posts");
    // Still not the admin controls: a role is not the same as the admin role.
    expect(ui.container.textContent).not.toContain("Post as Northwind Studio");
    expect(ui.container.textContent).not.toContain("Edit Page");
  });

  test("re-reads the Page's posts afterwards, so what a follow opened appears", async () => {
    vi.unstubAllGlobals();
    // What the server returns once the edge exists: the public post, plus the
    // followers-only one that reading it was gated on.
    let visible: unknown[] = [POST];
    const { calls } = stubFetch({ posts: () => visible });
    const ui = await renderPage();
    expect(ui.container.textContent).toContain("A post from the Page");
    expect(ui.container.textContent).not.toContain("Only the Page's followers see this");

    visible = [FOLLOWERS_POST, POST];
    const button = ui.container.querySelector<HTMLElement>('button[aria-label="Follow Northwind Studio"]');
    await ui.click(button as HTMLElement);

    // The re-read is a second request, chained behind the follow, and the post
    // it makes readable is what says it landed.
    await ui.waitFor(
      () => (ui.container.textContent ?? "").includes("Only the Page's followers see this"),
      { description: "the followers-only post to appear" },
    );

    // The follow moved the edge the audience rule turns on, so the list is
    // re-read rather than patched — the server decides what is readable.
    expect(calls.filter((call) => call.path.startsWith("/api/posts?pageId="))).toHaveLength(2);
    expect(ui.container.textContent).toContain("Only the Page's followers see this");
  });
});
