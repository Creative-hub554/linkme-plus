// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountSurface, cleanupSurfaces, type MountedSurface } from "@/test/render";
import { pageComponentModules, readPageSources, resolveModule } from "@/test/module-index";
import { moduleExports } from "@/test/source-scan";
import { stubFetch as stubFetchEndpoints, type FetchRecorder, type StubPayload } from "@/test/stub-fetch";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where this file's close-out leaves its coverage stamp for the CI runner's
 * close to read: the dated runbook bullet the close appends folds the same
 * line the `afterAll` below prints, so a full gate's record carries the
 * guard's coverage as the chrome and the pages move.
 *
 * Resolved from the `import.meta.url` *string* rather than `new URL(…)` for
 * the reason `module-index.ts` states: this file runs under jsdom, whose own
 * `URL` class is not Node's, and `fileURLToPath` rejects a URL it did not
 * build with `The URL must be of scheme file`.
 */
const coverageStampPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.freebuff/.rendered-links-coverage.txt",
);

/**
 * The check that keeps every rendered link honest about where it points.
 *
 * A link is an advertisement, and an advertisement is a promise: click it and
 * a page is there. That promise broke once already — seven footer links to
 * pages that did not exist — and nothing in the suite could see it, because
 * every existing test asks what a surface *renders* and none asks where what
 * it renders *goes*.
 *
 * Both halves of this file mount real surfaces, read every internal `href` off
 * the rendered anchors, and resolve each one against the app's own route
 * table: the `page.tsx` leaves under `src/app`, which are the same table the
 * server answers 200 from and 404 from. A link to `/careers` passes exactly
 * when `/careers` is a route the app serves, which is the claim the click
 * makes.
 *
 *   - **The chrome** (`every link the chrome advertises`) mounts the footer
 *     and the navs — signed in, signed out, and with the account menu, the
 *     mobile panel and the notification panel *open*, because their links are
 *     mounted only while open, so a closed render cannot see them.
 *   - **The data** (`every link the data renders`) mounts every page the app
 *     serves, with `fetch` stubbed to the canned payloads the neighbouring
 *     a11y audit uses, so the links the *data* produces — a group card's
 *     `/groups/${id}`, a Page card's `/pages/${username}`, a notification's
 *     `/profile?user=` — are judged as the reader receives them: after the
 *     requests have settled, not before the data has arrived.
 *
 * At close-out the file prints what it judged — each chrome surface's link
 * count, and the totals across the page mounts — so a run log shows the
 * guard's coverage moving as the chrome and the pages change. The counts are
 * a reading, not a floor: nothing fails on them. Growing is a bigger guard;
 * shrinking is what a surface that stopped advertising links looks like, and
 * it is worth a look either way.
 *
 * It is deliberately not an HTTP fetch. A fetch needs a running dev server in
 * the CI loop and re-asks the middleware's auth redirects a question they
 * answer differently per session; the route table is the oracle a 404 is
 * computed from, read straight from the filesystem, and it cannot time out.
 * Whether each page *renders well* once reached is the neighbouring audit's
 * subject (`rendered-a11y.test.tsx`); this file's subject is that nothing a
 * reader can click points at nothing.
 */

/**
 * The signed-in state the header cases read; mutable so the signed-out case
 * can flip it.
 *
 * The two auth states are two objects built once, and a case picks one: a mock
 * that builds a fresh object per call gives the component a new `user` on
 * every render, so an effect keyed on it never settles — the exact hang the
 * a11y suite's own mocks are written to avoid, and the reason these are
 * constants rather than a factory.
 */
const mocks = vi.hoisted(() => {
  const user = { id: "user-1", email: "theo@example.com", name: "Theo Wu" };
  return {
    pathname: "/feed",
    isAuthenticated: true,
    authIn: { isAuthenticated: true, isLoading: false, user, session: null },
    authOut: { isAuthenticated: false, isLoading: false, user: null, session: null },
    session: { session: { user }, loading: false, user },
    // One object per test, handed back unchanged: a mock that builds a fresh
    // value per call gives Link a new identity to react to on every render.
    params: new URLSearchParams(""),
    // Dynamic route segments, which `useParams` reads. Separate from `params`
    // above, which is a `useSearchParams` value.
    routeParams: {} as Record<string, string>,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => mocks.params,
  useParams: () => mocks.routeParams,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => (mocks.isAuthenticated ? mocks.authIn : mocks.authOut),
}));

// The nav imports `signOut` and the pages read the session; the real client
// reaches for Supabase and settles its state outside any act, which is the
// same reason the a11y suite replaces both here. The session is the signed-in
// shape the pages gate their render on — a null one is how the settings page
// renders nothing at all.
vi.mock("@/lib/auth-client", () => ({
  useSession: () => mocks.session,
  signOut: () => {},
}));

vi.mock("@/utils/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        mfa: { listFactors: async () => ({ data: { totp: [] }, error: null }) },
      },
    }),
  };
});

// The messages page mounts the presence indicator, whose real hook opens a
// WebSocket the stubbed browser cannot answer — error noise on every run. The
// seam is the same one the hook's own tests mock: a connected socket that says
// nothing.
vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({ isConnected: true, send: () => {}, lastMessage: null }),
}));

/**
 * The bell is mounted for real — it is in the nav, and its panel's
 * destinations are data-driven links like any other. What is replaced is the
 * provider under it, so no socket is opened and the panel opens with
 * notifications whose destinations this file can judge: one aimed at a post,
 * one at the actor behind a follow, which are the two destination shapes
 * `notificationDestination` produces.
 */
const mocksNotifications = vi.hoisted(() => ({
  unreadCount: 2,
  notifications: [
    {
      id: "n1",
      type: "reaction",
      message: "maya_designs reacted to your post",
      userId: "user-1",
      targetType: "post",
      targetId: "post-1",
      read: false,
      createdAt: "2026-09-25T09:00:00.000Z",
    },
    {
      id: "n2",
      type: "follow",
      message: "maya_designs started following you",
      userId: "user-1",
      sourceUserId: "user-2",
      read: false,
      createdAt: "2026-09-25T09:05:00.000Z",
    },
  ],
  isConnected: true,
  markAsRead: () => {},
  markAllAsRead: () => {},
  clearNotification: () => {},
  addNotification: () => {},
}));

vi.mock("@/components/providers/notification-provider", () => ({
  useNotifications: () => mocksNotifications,
}));

/**
 * The canned payloads, the same shapes the a11y audit answers its endpoints
 * with, so both files judge the same populated states.
 */
const listing = {
  id: "listing-1",
  title: "Vintage camera",
  price: 240,
  imageUrl: "https://cdn.example/camera.jpg",
  location: "Singapore",
  sellerName: "Maya Chen",
  categoryId: "90000000-0000-4000-8000-000000000001",
  categoryName: "Electronics",
  createdAt: "2026-09-20T09:00:00.000Z",
};

const job = {
  id: "job-1",
  title: "Product designer",
  company: { name: "Northwind" },
  location: "Remote",
  remoteStatus: "remote",
  jobType: "Full-time",
  salaryMin: 90000,
  salaryMax: 120000,
  createdAt: "2026-09-20T09:00:00.000Z",
};

const group = {
  id: "group-1",
  name: "Creative Builders",
  description: "People who make things",
  memberCount: 42,
  isMember: false,
  categoryId: "90000000-0000-4000-8000-000000000002",
  categoryName: "Design",
  category: "Design",
};

const page = {
  id: "page-1",
  username: "northwind_studio",
  name: "Northwind Studio",
  description: "A studio that makes things.",
  avatarUrl: null,
  coverUrl: null,
  category: null,
  createdAt: "2026-09-20T09:00:00.000Z",
};

/** A row of the Pages directory, which is a list shaped differently from a Page. */
const pageListItem = {
  id: page.id,
  username: page.username,
  name: page.name,
  description: page.description,
  avatarUrl: null,
  category: "Design",
  followers: 4,
};

const conversation = {
  id: "conversation-1",
  otherMember: { userId: "user-2", name: "Maya Chen" },
  lastMessage: { content: "See you then", createdAt: "2026-09-20T09:00:00.000Z" },
};

const post = {
  id: "post-1",
  content: "A post with one image",
  createdAt: "2026-09-20T09:00:00.000Z",
  visibility: "public",
  commentCount: 1,
  reactionCount: 2,
  author: { id: "user-2", name: "Maya Chen", username: "maya_designs", avatarUrl: null },
  media: [{ url: "https://cdn.example/photo.jpg", type: "image/jpeg" }],
};

/** What each endpoint answers with, so the populated states are what get judged. */
const CANNED: Record<string, StubPayload> = {
  "/api/marketplace": { data: [listing] },
  "/api/jobs": { data: [job] },
  "/api/groups": {
    data: [group],
    group,
    stats: { members: group.memberCount },
    isMember: true,
  },
  "/api/search": {
    results: { users: [{ id: "user-2", username: "maya_designs", displayName: "Maya Chen", isFollowing: false }] },
  },
  "/api/messages": { conversations: [conversation] },
  "/api/notifications": { notifications: mocksNotifications.notifications, unreadCount: 2 },
  "/api/posts": { data: [post], pagination: { nextCursor: null } },
  "/api/pages": {
    pages: [pageListItem],
    page,
    stats: { followers: 3, posts: 1 },
    isFollowing: false,
    role: "admin",
  },
  "/api/posts/comments": { data: [] },
  "/api/posts/counts": { data: [] },
  "/api/users": {
    user: {
      id: "user-2",
      username: "maya_designs",
      displayName: "Maya Chen",
      bio: "Visual designer",
      avatarUrl: null,
      coverUrl: null,
      coverVideoUrl: null,
      coverConfig: null,
      followerCount: 4,
      followingCount: 4,
      postCount: 1,
      isFollowing: false,
    },
  },
};

/**
 * Wait until a surface has stopped asking for things.
 *
 * The a11y suite's readiness rule, applied to link reading: a page judged
 * before its data has arrived advertises only its skeleton, and the check
 * would pass over the very links it exists to judge. No request open, *and*
 * none started for several looks — a page that renders and then fetches again
 * behind it (the feed and the profile both do) is momentarily idle between
 * those two requests, and reading its links there is reading a half-built
 * page.
 */
async function settleRequests(ui: MountedSurface, requests: FetchRecorder) {
  let seen = -1;
  let unchanged = 0;
  await ui.waitFor(
    () => {
      if (requests.open > 0 || requests.started !== seen) {
        seen = requests.started;
        unchanged = 0;
        return false;
      }
      unchanged += 1;
      return unchanged >= 8;
    },
    { timeout: 2000, description: "the stubbed requests to go quiet" },
  );
}

/**
 * The routes the app serves, read the way the framework reads them.
 *
 * A route's url is its directory, so the leaf filename is dropped and route
 * groups are filtered out — the same arithmetic `rendered-a11y.test.tsx` uses,
 * copied here rather than imported because that file keeps its helpers local.
 * Only pages that default-export something count, so an empty `page.tsx` is
 * not a route a click lands on.
 */
function routePath(file: string): string {
  const segments = file.replace(/^\.\.\/app\//, "").split("/");
  segments.pop(); // the leaf filename — `page.tsx`
  const path = segments
    .filter((segment) => segment !== "" && !segment.startsWith("("))
    .join("/");
  return `/${path}`;
}

function servedRoutes(): Set<string> {
  return new Set(
    Object.entries(readPageSources())
      .filter(([file, source]) => moduleExports({ path: file, source }, resolveModule).default)
      .map(([file]) => routePath(file)),
  );
}

/**
 * Whether `base` — an href without its query or hash — is one of `routes`.
 *
 * Exact match first; then a segment-wise match against the dynamic routes,
 * where a `[segment]` in the route stands for anything. The data's links are
 * exactly this shape — `/groups/${id}` against `/groups/[id]` — so without
 * the dynamic case every card link in the app would read as a 404 and teach
 * the wrong lesson.
 */
function servesRoute(routes: ReadonlySet<string>, base: string): boolean {
  if (routes.has(base)) return true;
  const wanted = base.split("/").filter(Boolean);
  if (wanted.length === 0) return false;
  return [...routes].some((route) => {
    const have = route.split("/").filter(Boolean);
    return (
      have.length === wanted.length &&
      have.every((segment, i) =>
        (segment.startsWith("[") && segment.endsWith("]")) || segment === wanted[i],
      )
    );
  });
}

/**
 * Every internal href rendered inside `root`, in document order.
 *
 * Internal means it starts with `/` and not `//` — mailto:, tel: and the
 * external addresses are not this check's subject, and a protocol-relative
 * url is not internal either. Kept whole (query and hash included): the
 * failure below reports the href as written, and the base is derived only
 * when the route is looked up.
 */
function renderedHrefs(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>("a[href]")]
    .map((anchor) => anchor.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/") && !href.startsWith("//"));
}

/**
 * The judgement itself: every href in `hrefs` must be a route `routes` serves.
 *
 * Deduplicated, so a repeated link is judged once, and reported per surface —
 * a fix starts in one file, not in seven.
 */
function expectAllServed(routes: ReadonlySet<string>, surface: string, hrefs: string[]) {
  const dead = [...new Set(hrefs)].filter((href) => {
    const base = href.split(/[?#]/)[0] || "/";
    return !servesRoute(routes, base);
  });
  expect(
    dead,
    `${surface} advertises ${dead.length} destination(s) the app does not serve — a click there is a 404:`,
  ).toEqual([]);
}

/**
 * The coverage stamp, and the judgement that fills it.
 *
 * Every real case judges its surface through here, so the counts printed at
 * close-out are exactly what the assertions saw: the surface's own rendered
 * internal hrefs, deduplicated. The machinery case below calls
 * `expectAllServed` directly — a fixture's links are not the app's coverage.
 *
 * Recording happens before the assertion, so a red run still prints what the
 * guard audited on its way to the red.
 */
const chromeCoverage = new Map<string, Set<string>>();
const dataCoverage = new Map<string, Set<string>>();

function judgeSurface(
  routes: ReadonlySet<string>,
  surface: string,
  hrefs: string[],
  { data = false }: { data?: boolean } = {},
) {
  const registry = data ? dataCoverage : chromeCoverage;
  const seen = registry.get(surface) ?? new Set<string>();
  for (const href of hrefs) seen.add(href);
  registry.set(surface, seen);
  expectAllServed(routes, surface, hrefs);
}

afterAll(() => {
  if (chromeCoverage.size === 0 && dataCoverage.size === 0) return;
  const parts: string[] = [];
  if (chromeCoverage.size > 0) {
    const chrome = [...chromeCoverage].map(([surface, seen]) => `${surface} ${seen.size}`).join(", ");
    // flat() does not flatten Sets — each value must be spread by hand, or
    // the union silently becomes a set of sets and reads as the surface count.
    const union = new Set([...chromeCoverage.values()].flatMap((seen) => [...seen])).size;
    parts.push(`chrome — ${chrome} (${union} unique destinations)`);
  }
  if (dataCoverage.size > 0) {
    const union = new Set([...dataCoverage.values()].flatMap((seen) => [...seen])).size;
    // The wording is chosen for the convention guard that keeps test files off
    // the raw rendering primitive: it scans prose as code, so this template
    // must not spell the primitive's call shape in its text.
    parts.push(`data — ${dataCoverage.size} page mounts, ${union} unique destinations`);
  }
  const stamp = `rendered-links coverage: ${parts.join(" | ")}`;
  console.log(stamp);
  // The same line, left where the CI runner's close reads it: the dated bullet
  // the close appends to the runbook folds the stamp in. Fail-silent on
  // purpose — the console line above is the stamp's primary channel, and a
  // tree that cannot host the sidecar costs the bullet one line, never the
  // suite a test.
  try {
    writeFileSync(coverageStampPath, `${stamp}\n`, "utf8");
  } catch {
    // The runner reads the file only when it is there; without it the bullet
    // simply omits the line, and the console stamp above is the primary channel.
    return;
  }
});

describe("every link the chrome advertises", () => {
  beforeEach(() => {
    mocks.pathname = "/feed";
    mocks.isAuthenticated = true;
  });

  afterEach(() => {
    // Unmount before anything clears the body: a Radix portal is a child of
    // the body, and emptying the body first makes React's own teardown throw.
    cleanupSurfaces();
  });

  test("the footer points only at routes the app serves", async () => {
    const routes = servedRoutes();
    expect(routes.size, "no routes were discovered — the check would prove nothing").toBeGreaterThan(0);

    // A plain render: no providers, no session, no menus — and the fourteen
    // links that are the reason this file exists.
    const { Footer } = await import("@/components/layout/footer");
    const footer = mountSurface(<Footer />, { providers: "none" });
    const hrefs = renderedHrefs(footer.container);
    expect(hrefs.length, "the footer rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the footer", hrefs);
  });

  test("the signed-in header points only at routes the app serves", async () => {
    const routes = servedRoutes();
    const { MainNav } = await import("@/components/layout/main-nav");
    // theme+tooltip, as the a11y suite mounts the nav: the mobile panel reads
    // the theme, and the panel is one of the states judged below.
    const header = mountSurface(<MainNav />, { providers: "theme+tooltip" });
    const hrefs = renderedHrefs(header.container);
    expect(hrefs.length, "the signed-in header rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the signed-in header", hrefs);
  });

  test("the opened account menu points only at routes the app serves", async () => {
    const routes = servedRoutes();
    const { MainNav } = await import("@/components/layout/main-nav");
    const header = mountSurface(<MainNav />, { providers: "theme+tooltip" });

    // The menu's links exist only while it is open, so the at-rest case above
    // cannot see them. A menu that failed to open would leave this judging the
    // header again and passing for that reason — the green that means nothing,
    // which the wait below refuses.
    const trigger = header.container.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
    expect(trigger, "the signed-in header rendered no account menu to open").not.toBeNull();
    await header.pointerDown(trigger!);
    await header.waitFor(() => document.querySelector('[role="menu"]') !== null, {
      description: "the account menu to open",
    });

    // Scoped to the menu itself: Radix portals it into the body, and its
    // links are exactly the ones only this case can see. The header's own
    // links belong to the at-rest cases, and a per-surface count that
    // included them would count them twice.
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu, "the account menu opened, but rendered no menu element").not.toBeNull();
    const hrefs = renderedHrefs(menu!);
    expect(hrefs.length, "the opened account menu rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the opened account menu", hrefs);
  });

  test("the opened mobile panel points only at routes the app serves", async () => {
    const routes = servedRoutes();
    const { MainNav } = await import("@/components/layout/main-nav");
    const header = mountSurface(<MainNav />, { providers: "theme+tooltip" });

    // Same shape as the menu: the panel is mounted only while it is open, and
    // the wait is what says it really opened.
    const menu = header.container.querySelector<HTMLElement>('[aria-controls="mobile-nav"]');
    expect(menu, "the header rendered no mobile panel to open").not.toBeNull();
    await header.click(menu!);
    await header.waitFor(() => document.querySelector("#mobile-nav") !== null, {
      description: "the mobile panel to open",
    });

    // Scoped to the panel, same attribution as the menu: the header's own
    // links are the at-rest cases' business.
    const panel = document.querySelector<HTMLElement>("#mobile-nav");
    expect(panel, "the mobile panel opened, but rendered no panel element").not.toBeNull();
    const hrefs = renderedHrefs(panel!);
    expect(hrefs.length, "the opened mobile panel rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the opened mobile panel", hrefs);
  });

  test("the opened notification panel points only at routes the app serves", async () => {
    const routes = servedRoutes();
    const { MainNav } = await import("@/components/layout/main-nav");
    const header = mountSurface(<MainNav />, { providers: "theme+tooltip" });

    // The bell's destinations are data-driven links (`/feed?post=…`,
    // `/profile?user=…`) and the panel is mounted only while it is open. The
    // provider above answers with one notification of each destination shape,
    // so both are on screen to be judged.
    const bell = header.container.querySelector<HTMLElement>('[aria-controls="notification-panel"]');
    expect(bell, "the header rendered no notification bell to open").not.toBeNull();
    await header.click(bell!);
    await header.waitFor(() => document.querySelector("#notification-panel") !== null, {
      description: "the notification panel to open",
    });

    // Scoped to the panel: its two destination shapes are the point of the
    // case, and the header's own links are already judged at rest.
    const panel = document.querySelector<HTMLElement>("#notification-panel");
    expect(panel, "the notification panel opened, but rendered no panel element").not.toBeNull();
    const hrefs = renderedHrefs(panel!);
    expect(hrefs.length, "the opened notification panel rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the opened notification panel", hrefs);
  });

  test("the bottom nav points only at routes the app serves", async () => {
    const routes = servedRoutes();
    const { BottomNav } = await import("@/components/layout/bottom-nav");
    const bottom = mountSurface(<BottomNav />, { providers: "none" });
    const hrefs = renderedHrefs(bottom.container);
    expect(hrefs.length, "the bottom nav rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the bottom nav", hrefs);
  });

  test("the Social strip points only at routes the app serves", async () => {
    const routes = servedRoutes();
    const { SocialNav } = await import("@/components/layout/social-nav");
    // It renders nothing off Social, which is one of the four surfaces; the
    // stub path is `/feed` so the strip is actually on screen to be judged.
    const social = mountSurface(<SocialNav />, { providers: "none" });
    const hrefs = renderedHrefs(social.container);
    expect(hrefs.length, "the Social strip rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the Social strip", hrefs);
  });

  test("the signed-out header points only at routes the app serves", async () => {
    const routes = servedRoutes();
    // The links a visitor is offered are a different set from a member's.
    mocks.isAuthenticated = false;
    const { MainNav } = await import("@/components/layout/main-nav");
    const visitor = mountSurface(<MainNav />, { providers: "theme+tooltip" });
    const hrefs = renderedHrefs(visitor.container);
    expect(hrefs.length, "the signed-out header rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the signed-out header", hrefs);
  });

  test("the signed-out mobile panel opens and points only at routes the app serves", async () => {
    const routes = servedRoutes();
    // The hamburger used to be a dead control for a visitor: the panel itself
    // was gated on the session, so the button announced itself and then
    // opened nothing. This case is the proof that the panel opens signed out
    // and that what it offers a visitor is only doors the app actually serves.
    mocks.isAuthenticated = false;
    const { MainNav } = await import("@/components/layout/main-nav");
    const visitor = mountSurface(<MainNav />, { providers: "theme+tooltip" });

    // Same shape as the signed-in panel: mounted only while open, so the wait
    // is what says it really opened.
    const menu = visitor.container.querySelector<HTMLElement>('[aria-controls="mobile-nav"]');
    expect(menu, "the header rendered no mobile panel to open").not.toBeNull();
    await visitor.click(menu!);
    await visitor.waitFor(() => document.querySelector("#mobile-nav") !== null, {
      description: "the signed-out mobile panel to open",
    });

    // Scoped to the panel, same attribution as its signed-in twin: the
    // header's own links are the at-rest case's business.
    const panel = document.querySelector<HTMLElement>("#mobile-nav");
    expect(panel, "the signed-out mobile panel opened, but rendered no panel element").not.toBeNull();
    const hrefs = renderedHrefs(panel!);
    expect(hrefs.length, "the signed-out mobile panel rendered no links to check").toBeGreaterThan(0);
    judgeSurface(routes, "the signed-out mobile panel", hrefs);
  });

  test("the signed-out bottom nav points only at routes the app serves, and never at the door that bounces", async () => {
    const routes = servedRoutes();
    // The bar draws the same list the header does, through the same session
    // rule — so a visitor is offered a different set, and the filter is the
    // point of this case: Social is a feed of follows whose door redirects a
    // visitor to login, and a bar that advertises a bounce is the same dead
    // end as one that 404s. The judgement below pins what a visitor IS
    // offered; the absence pin is what says the bar stopped offering the door
    // that bounces — without it, a filter that stopped reading the session
    // would pass this case identically to the signed-in one, "judging" a
    // visitor a bar that is not theirs.
    mocks.isAuthenticated = false;
    const { BottomNav } = await import("@/components/layout/bottom-nav");
    const bottom = mountSurface(<BottomNav />, { providers: "none" });
    const hrefs = renderedHrefs(bottom.container);
    expect(hrefs.length, "the signed-out bottom nav rendered no links to check").toBeGreaterThan(0);
    expect(
      hrefs,
      "the signed-out bottom nav still advertises Social — the one module a visitor is bounced from",
    ).not.toContain("/feed");
    judgeSurface(routes, "the signed-out bottom nav", hrefs);
  });

  test("the machinery itself flags a link to nowhere, and honours dynamic routes", () => {
    // A guard only ever run against a clean tree is a guard never shown to
    // work: a destination with no route behind it has to turn the check red.
    expect(() =>
      expectAllServed(new Set(["/feed"]), "a surface", ["/not-a-route"]),
    ).toThrow(/does not serve/);
    // …and the matcher must not invent 404s: an exact route serves, a query or
    // hash rides along, and a dynamic segment stands for whatever a link names.
    const routes = new Set(["/feed", "/pages/[username]"]);
    expectAllServed(routes, "a surface", ["/feed", "/pages/anything?tab=cover", "/feed#top"]);
  });
});

/**
 * Every page the app serves, enumerated from disk and loaded on demand — the
 * same discovery the a11y audit's skeletal floor uses, so a page added
 * tomorrow is judged here without this file being told about it.
 */
const pageModules = new Map(
  Object.entries(pageComponentModules()).map(([file, load]) => [routePath(file), load]),
);

/**
 * The one page a mount cannot reach, and why it is allowed to have none.
 *
 * `/cover-studio` is a `redirect(...)`: it throws before there is anything to
 * render, so there are no rendered links to read — and the address it forwards
 * to is pinned by the a11y suite's own case.
 */
const UNMOUNTABLE: Record<string, string> = {
  "/cover-studio": "a redirect to the profile's cover tab — nothing renders, so there is nothing to read",
};

/**
 * The link the data puts on screen for a route that reads a canned endpoint —
 * the statement that the data arrived, without which a page that rendered its
 * skeleton alone would pass for the wrong reason.
 *
 * Only where a link is the data's own doing is one pinned: the group card's
 * address on the communities directory, and the Page card's on the Pages
 * directory. Pages whose data renders no links at all (the listing, post and
 * job cards carry none — their titles are text, their actions buttons) are
 * still judged for whatever else they render, and the render guard below is
 * what says they rendered at all.
 */
const PINNED_HREF: Record<string, string> = {
  "/groups": `/groups/${group.id}`,
  "/pages": `/pages/${page.username}`,
};

describe("every link the data renders", () => {
  let requests: FetchRecorder;

  beforeEach(() => {
    mocks.pathname = "/feed";
    mocks.params = new URLSearchParams("");
    mocks.routeParams = {};
    requests = stubFetchEndpoints(CANNED);
  });

  afterEach(() => {
    cleanupSurfaces();
  });

  describe.each([...pageModules.keys()].filter((route) => !(route in UNMOUNTABLE)).sort())(
    "the %s page as its data renders it",
    (route) => {
      test("settles, renders, and every link it renders resolves", async () => {
        // The route segments the dynamic pages read, set before the import so
        // the page sees them on first render; the search page renders its
        // results only for a query.
        if (route === "/groups/[id]") mocks.routeParams.id = group.id;
        if (route === "/pages/[username]") mocks.routeParams.username = page.username;
        if (route === "/search") mocks.params = new URLSearchParams("q=maya");

        const load = pageModules.get(route);
        if (!load) throw new Error(`no module was found for ${route}`);
        const { default: PageComponent } = await load();

        const ui = mountSurface(<PageComponent />, { providers: "theme+tooltip" });
        try {
          // Waited for, not slept on: the links the data produces exist only
          // after the stub's answers have rendered, including the ones a page
          // fetches behind its first render.
          await settleRequests(ui, requests);

          // The render guard: a page that rendered neither controls nor text
          // has nothing to judge and would pass for nothing. Portals are read
          // with the body below, but the page itself has to have rendered.
          const rendered =
            ui.container.textContent?.trim().length ?? 0;
          expect(
            rendered,
            `${route} rendered neither text nor anything to read — the mount is not the page the app serves`,
          ).toBeGreaterThan(0);

          // The data-arrival pin, where the data is links.
          const pinned = PINNED_HREF[route];
          if (pinned !== undefined) {
            expect(
              renderedHrefs(ui.container).join("\n"),
              `${route} never rendered the link its data produces ("${pinned}") — the canned answer did not arrive, and nothing below was really judged`,
            ).toContain(pinned);
          }

          // The judgement. Read from the body, not the container: a page
          // portals dialogs and menus into it, and a link in a portal is
          // exactly the one an eye-level check misses.
          const hrefs = renderedHrefs(document.body);
          judgeSurface(servedRoutes(), `the ${route} page`, hrefs, { data: true });
        } finally {
          ui.unmount();
        }
      });
    },
  );
});
