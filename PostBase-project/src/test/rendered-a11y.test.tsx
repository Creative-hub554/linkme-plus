/// <reference types="vite/client" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useEffect } from "react";
import type * as React from "react";
import {
  componentModuleLoaders,
  pageComponentModules,
  readPageSources,
  readRouteSources,
  readRouteTestFiles,
  resolveModule,
} from "@/test/module-index";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import {
  exportedHttpMethods,
  moduleExports,
  reExportSpecifiers,
  type ModuleResolver,
} from "@/test/source-scan";
import {
  stubFetch as stubFetchEndpoints,
  type FetchRecorder,
  type StubPayload,
} from "@/test/stub-fetch";
import {
  describeHeadingViolations,
  describeStateViolations,
  describeUnnamed,
  headingViolations,
  reachableControls,
  stateViolations,
  unnamedControls,
} from "@/test/a11y";

/**
 * The audit that would have caught the nameless mobile menu button.
 *
 * That was an icon-only `<Button>` in the nav with no `aria-label` and no text,
 * so it announced "button" and nothing else — and it survived a careful,
 * deliberate sweep of every `aria-label` in the app, because a sweep of
 * `aria-label`s cannot see a control that has none. This renders the real
 * surfaces and asks the question directly: is there any control a reader can
 * reach but not name?
 *
 * It asks a second question in the same pass, because a second render of every
 * page costs seconds and the two belong together: having named a control, does
 * it say what it is doing? That half covers the state conventions — a named
 * group of options must say which one is chosen, and a control that owns a
 * region must say whether it is open. See `stateViolations` for what is
 * checkable this way and what is not.
 *
 * It is a *rendered* check, which is the point — the name depends on runtime
 * state (an `aria-label` that resolves to an empty string, a control whose text
 * comes from data that arrived empty) — but it is also why it can only cover
 * the surfaces it mounts. What it renders is stated below rather than implied.
 *
 * The environment is a stub in two places, both of which are setup rather than
 * subject: `fetch` answers the endpoints with canned payloads, so the populated
 * states are what get audited, and the three modules that reach for a session
 * (auth, the auth client, and the Supabase browser client) are replaced. What is
 * asserted is only what the components themselves render.
 */
/**
 * Every mocked value is created **once** and handed back unchanged.
 *
 * This is not tidiness. A mock that builds a fresh object per call gives the
 * component a new `user` on every render, so an effect keyed on it — `useEffect(
 * () => …, [user])`, which is how several pages load their data — never settles:
 * the effect runs, sets state, the re-render hands it a new `user`, and it runs
 * again. The first version of this file did exactly that and the communities
 * page hung until the test timed out, which is a genuine class of bug the app
 * could have too: a context provider that does not memoise its value.
 */
const mocks = vi.hoisted(() => {
  const user = { id: "user-1", email: "theo@example.com", name: "Theo Wu" };
  const auth = { isAuthenticated: true, isLoading: false, user, session: null };
  const session = { session: { user }, loading: false, user };
  const router = {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    prefetch: () => {},
  };
  const navigation = {
    pathname: "/feed",
    params: new URLSearchParams(""),
    // Where a page sent a `redirect(...)`. A page that forwards has no render to
    // audit, but the address it forwards to is still something to check.
    redirects: [] as string[],
  };
  // Dynamic route segments, which `useParams` reads. Separate from
  // `navigation.params` above, which is a `useSearchParams` value.
  const routeParams: Record<string, string> = {};
  const notifications = {
    unreadCount: 3,
    notifications: [
      {
        id: "n1",
        type: "follow",
        message: "maya_designs started following you",
        userId: "user-1",
        read: false,
        createdAt: "2026-09-25T09:00:00.000Z",
      },
    ],
    isConnected: true,
    markAsRead: () => {},
    markAllAsRead: () => {},
    clearNotification: () => {},
    addNotification: () => {},
  };

  return { auth, session, router, navigation, routeParams, notifications };
});

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.navigation.pathname,
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.navigation.params,
  useParams: () => mocks.routeParams,
  // Recorded and then thrown, as Next does: a redirect is not a render, and the
  // throw is what stops the page from going on to render anything.
  redirect: (url: string) => {
    mocks.navigation.redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

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

// The bell lives in the nav, which is one of the surfaces below, and its real
// provider opens a Realtime socket. The audit wants the bell *with a count*, so
// the provider answers with one instead of being left out.
vi.mock("@/components/providers/notification-provider", () => ({
  useNotifications: () => mocks.notifications,
}));

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

/** What each endpoint answers with, so the populated states are what get audited. */
const CANNED: Record<string, StubPayload> = {
  "/api/marketplace": { data: [listing] },
  // The saved shelf answers the flag contract pointed the other way: only the
  // member's saved rows, each carrying `isSaved: true` — the same field the
  // grid's cards read, so a card cannot tell which read fed it.
  "/api/marketplace/saved": { data: [{ ...listing, isSaved: true }] },
  "/api/jobs": { data: [job] },
  // The list is `data`; the detail page reads the same route as `group`, with
  // its stats and whether the viewer is a member. Both in one answer because
  // the app has one endpoint for them, and the audit renders both views.
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
  "/api/notifications": { notifications: [], unreadCount: 3 },
  "/api/posts": { data: [post], pagination: { nextCursor: null } },
  // A Page the viewer administers, so the composer is on screen and has to be
  // judged too — and the directory the same endpoint feeds, so a list is on
  // screen rather than the empty state.
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
 * What the stub has been asked for: how many requests were made, how many are
 * still open, and which of them the canned payloads actually answered.
 *
 * Kept so a surface can be *waited for* rather than slept on. Round-counting is
 * not a readiness condition, and the way it fails is quiet: with a slow-enough
 * stub this file audited a `settings` page that had rendered nothing at all —
 * zero controls, zero characters — and passed, because an audit of an empty
 * document finds no unnamed control in it. A green check that inspected nothing
 * is worse than a red one.
 *
 * `answered` is the second half of that: a surface that was handed canned data
 * has data, so it has to say what that data puts on screen. A request the stub
 * has no canned answer for proves nothing either way and is not recorded — the
 * admin dashboard and the composer read several of those, and the point here is
 * not "did it call something" but "was it given something to show".
 */
let requests: FetchRecorder = { calls: [], started: 0, open: 0, answered: [] };

function stubFetch() {
  // Reassigned rather than mutated: a fresh recorder per test, which `audit`
  // and `settleRequests` then read. What a path with no canned answer gets is
  // the shared default — an empty 200 — which is why the unanswered count is a
  // pathname the stub *did* answer and not merely every request made.
  requests = stubFetchEndpoints(CANNED);
}

/**
 * Wait until a surface has stopped asking for things.
 *
 * Two conditions together, because either alone is wrong. No request open: one
 * the surface is still waiting for would mean its state has not arrived. And no
 * request started for `quiet` looks: a surface that renders a page and then
 * fetches the feed behind it — which the feed and the profile both do — is
 * momentarily idle *between* those two requests, and judging it there is judging
 * a half-built page.
 *
 * This is why the wait is on the stub and not on the clock: the chained request
 * is issued in the same turn the first one is answered in, so it is registered
 * before the next look, and the wait ends when the chain ends — however long it
 * took and however many links it had.
 */
async function settleRequests(
  ui: MountedSurface,
  { quiet = 8, timeout = 2000 } = {},
) {
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
      return unchanged >= quiet;
    },
    { timeout, description: "the stubbed requests to go quiet" },
  );
}

/**
 * Renders a surface, lets its stubbed requests settle, and reports every control
 * a reader could reach but not name.
 *
 * The whole document is searched, not the mount container: Radix renders menus,
 * tooltips and dialogs into a portal on `document.body`, and a control in a
 * portal is exactly the one an eye-level check misses.
 */
interface AuditOptions {
  /** Bring a surface to another state before it is judged — an open composer. */
  interact?: (ui: MountedSurface) => Promise<void>;
  /**
   * A string only this surface's data can put on screen — a listing's title, a
   * conversation's last message, the Page's name.
   *
   * It has to appear *inside the surface*, meaning the mount container, not the
   * whole document: the document also holds the nav's chrome, other mounts and
   * every portal, and a string that merely happens to be on the page is not the
   * surface's data having arrived. Portalled content is the one thing this does
   * not see, and none of the strings here live in a portal — every surface with
   * data renders it where it is mounted.
   *
   * Required of every surface here that shows anything that arrived, which is
   * all of them except the nav, the bottom nav, the marketing page, the composer
   * on its own and the admin dashboard: those read no endpoint the stub above
   * has an answer for, so what arrived for them is nothing and the guard below is
   * all that can be said about them.
   */
  shows?: string;
  /**
   * Whether the readiness check demands a control *specifically*. Default true.
   * `false` accepts a rendered control **or** rendered text — what a page that
   * is pure prose, or a component that is a single icon-bearing control or a
   * line of copy, can offer. It is still not satisfied by an empty document, so
   * the relaxation cannot be used to skip the check.
   */
  requiresControl?: boolean;
  /**
   * Whether the surface is a whole page, and so has to read as one: exactly one
   * `h1`, and no level skipped on the way down. Off by default, because most of
   * what is mounted above is a fragment of a page — a nav, a composer — and
   * "one h1" is a claim about a page and not about a toolbar.
   */
  structure?: boolean;
  /**
   * Whether a surface that was handed canned data has to declare a `shows`.
   * Default true, because a page with a case is a place where the data check can
   * be stated. The component cases below turn it off: a component has no case of
   * its own to declare against, and the question they ask is about names.
   */
  requiresShows?: boolean;
}

async function audit(
  surface: React.ReactNode,
  { interact, shows, requiresControl = true, structure = false, requiresShows = true }: AuditOptions = {},
) {
  // Mounted as a whole page (`theme+tooltip`): a surface may read the theme,
  // and the settings page's pickers do. The theme wraps the tooltips just as
  // the real layout has it, so the tree under audit matches the tree the reader
  // gets.

  // What the stub answers during this mount, so the checks below can tell a
  // surface that was given data from one that read nothing.
  const answeredBefore = requests.answered.length;
  const ui = mountSurface(surface, { providers: "theme+tooltip" });
  try {
    // Waited for, not counted: mount → fetch resolves → state renders → the
    // follow-up fetches (the feed and the profile each fetch again once they
    // have an answer). How many rounds that takes is the app's business, and a
    // surface judged early is judged as a skeleton and passes.
    await settleRequests(ui);
    if (interact) {
      await interact(ui);
      await settleRequests(ui);
    }
    // A surface that was handed data and did not say what that data puts on
    // screen is a case the two checks below cannot judge: the readiness check
    // only proves *something* rendered, and a nameless-control sweep finds
    // nothing wrong with a page whose one omission is the content. So this is
    // not a recommendation — a surface that reads a canned endpoint must
    // declare `shows`, and a new one that forgets fails here rather than
    // passing on the weaker checks alone.
    if (shows === undefined && requiresShows) {
      const answer = requests.answered.slice(answeredBefore);
      expect(
        answer,
        `this surface read ${answer.join(", ")} but declared no \`shows\`, so nothing checked that the data arrived`,
      ).toEqual([]);
    }

    // What the audit must have found, before it is worth reading what it did
    // not find. Both checks are here because everything after this is a search
    // for offenders, and an empty document has none: `unnamedControls(nothing)`
    // is `[]`. It is not a hypothetical — with the stub slowed, this file
    // reported success for a `settings` page that had rendered zero controls and
    // zero characters, and for a `messages` page showing only "Loading
    // conversations...".
    const reached = reachableControls(document.body).length;
    if (requiresControl) {
      expect(
        reached,
        "no control was reached, so the surface had not rendered and this pass means nothing",
      ).toBeGreaterThan(0);
    } else {
      const text = (ui.container.textContent ?? "").trim().length;
      expect(
        reached + text,
        "the surface rendered neither a control nor any text, so this pass means nothing",
      ).toBeGreaterThan(0);
    }

    if (shows !== undefined) {
      // The surface's own container, not the whole document. A check against
      // the document can be satisfied by a string that is on the page for an
      // unrelated reason — a nav label, another mount, a portal from elsewhere —
      // and then it says nothing about whether this surface's data arrived.
      expect(
        ui.container.textContent ?? "",
        `the surface's data never arrived: "${shows}" is not in the surface`,
      ).toContain(shows);
    }

    const offenders = unnamedControls(document.body);
    expect(offenders, describeUnnamed(offenders)).toEqual([]);

    const silent = stateViolations(document.body);
    expect(silent, describeStateViolations(silent)).toEqual([]);

    // The page as a document, which is the one claim the checks above cannot
    // make: they read controls, and a heading is not a control. Only a surface
    // that *is* a page asks this — a fragment has no `h1` to have exactly one of.
    if (structure) {
      const outline = headingViolations(ui.container);
      expect(outline, describeHeadingViolations(outline)).toEqual([]);
    }
  } finally {
    ui.unmount();
  }
}

/**
 * The routes the cases below cover, named as the app names them.
 *
 * Recorded while the cases are *declared* rather than while they run, so a
 * filtered run (`-t`) still knows the full set — the coverage check at the
 * bottom of the file would otherwise report every route as missing the moment
 * one matching test was all that ran.
 *
 * A route can have several cases (`/pages/[username]` has the Page itself, its
 * edit dialog and its composer's menu); it is named once, beside the first.
 */
const audited = new Set<string>();

/** States that the case being declared covers `route`. */
function covers(route: string): void {
  audited.add(route);
}

/**
 * Routes under `src/app` with no case below, and the reason each is allowed to
 * have none.
 *
 * A rounded set, not a debt list: a skeletal case is generated below for every
 * page without a bespoke one, so the only page left here is the one a mount
 * cannot reach at all. `/cover-studio` is a `redirect(...)`, which throws before
 * there is anything to render — auditing it would be auditing nothing.
 *
 * The check that reads this fails for a route that is neither audited nor named
 * here, so a new page still cannot slip past, and it fails again for an entry
 * that has stopped being a gap, so this list cannot quietly keep an allowance
 * the file no longer needs.
 */
const UNCOVERED: Record<string, string> = {
  "/cover-studio": "a redirect to the profile's cover tab — nothing renders, though where it forwards is pinned by its own case",
};

/**
 * Endpoints with no test beside them.
 *
 * The api half of the same ratchet. It is empty now: every handler under `app`
 * — the auth library's catch-all and the OAuth callback outside `/api` — has a
 * neighbour `route.test.ts`. It stays a ratchet rather
 * than being removed: an endpoint that is neither tested nor named here fails
 * the check, so a new handler arrives with a test or with an entry, and an entry
 * that has since got a test — or lost its handler — fails too, so this set can
 * only be filled honestly.
 */
const UNTESTED_API = new Set<string>();

/**
 * The url a route module serves, read from where it sits rather than from its
 * name.
 *
 * A route's url is its *directory* — `src/app/(main)/feed/page.tsx` serves
 * `/feed` — so the leaf filename is dropped structurally (the last path segment)
 * and never matched off with a regex. Route groups — `(main)`, `(auth)`,
 * `(static)` — are directories only for organisation, so a parenthesised
 * segment is filtered out. This is also why a handler's neighbour test resolves
 * to the same url: `route.test.ts` sits in the same directory as `route.ts`.
 */
function routePath(file: string): string {
  const segments = file.replace(/^\.\.\/app\//, "").split("/");
  segments.pop(); // the leaf filename — `page.tsx`, `route.ts`, `route.test.ts`
  const path = segments
    .filter((segment) => segment !== "" && !segment.startsWith("("))
    .join("/");
  return `/${path}`;
}

/**
 * The framework's route leaves, their source, and the path→source index that
 * re-exports are followed through all come from the shared module index
 * (`@/test/module-index`). What is added here is the route *shape*: a page has to
 * default-export a component and an api route has to export at least one method
 * handler, and a module that does not is a route that renders or answers nothing.
 */

/** Every page the app serves: a `page.tsx` whose module default-exports something. */
function discoveredRoutes(): string[] {
  return Object.entries(readPageSources())
    .filter(([file, source]) => moduleExports({ path: file, source }, resolveModule).default)
    .map(([file]) => routePath(file))
    .sort();
}

/** Every api endpoint the app serves: a `route.ts` exporting at least one method handler. */
function apiEndpoints(): string[] {
  return Object.entries(readRouteSources())
    .filter(
      ([file, source]) => exportedHttpMethods({ path: file, source }, resolveModule).length > 0,
    )
    .map(([file]) => routePath(file))
    .sort();
}

/**
 * Every api endpoint the app serves, and the ones with a test beside them.
 *
 * A handler's test is its neighbour, `route.test.ts` — the convention the ones
 * that exist already follow — so a route counts as tested only when that file is
 * there, not when some test elsewhere mentions it. The neighbour's url is the
 * directory it sits in, which is the handler's own url.
 */
function apiRouteCoverage(): { endpoints: string[]; tested: Set<string> } {
  const tested = new Set(readRouteTestFiles().map((file) => routePath(file)));
  return { endpoints: apiEndpoints(), tested };
}

/**
 * What both coverage checks are about, as a pure calculation.
 *
 * `missing` is something the app serves that is neither covered nor allowed;
 * `stale` is an allowance that is no longer needed — the thing is gone, or it has
 * since been covered. The same shape serves pages (covered by a case, allowed by
 * a stated reason) and api routes (covered by a test, allowed by `UNTESTED_API`),
 * and it is split out so both can be driven by a fixture in a test rather than
 * only by the real app — the check is worthless if an unlisted route does not
 * turn it red.
 */
function routeGaps(
  discovered: string[],
  covered: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
): { missing: string[]; stale: string[] } {
  return {
    missing: discovered.filter((route) => !covered.has(route) && !allowed.has(route)),
    stale: [...allowed].filter((route) => !discovered.includes(route) || covered.has(route)),
  };
}

/**
 * The re-exports of `sources` whose specifier names no module, as `file → specifier`.
 *
 * A re-export is an edge in the module graph, and a typo'd one is invisible to the
 * shape checks: a clause whose target cannot be followed is trusted as written, so
 * the route stays classified while pointing at nothing. Only specifiers the project
 * owns — relative and `@/` — are checked; a bare package name is not ours to place.
 */
function brokenReExports(
  sources: Record<string, string>,
  resolve: ModuleResolver,
): string[] {
  const owned = (specifier: string): boolean =>
    specifier.startsWith(".") || specifier.startsWith("@/");
  return Object.entries(sources).flatMap(([file, source]) =>
    reExportSpecifiers(source)
      .filter(owned)
      .filter((specifier) => resolve(specifier, file) === undefined)
      .map((specifier) => `${file} → ${specifier}`),
  );
}

afterEach(() => {
  // Unmount before anything clears the body: a Radix portal is a child of the
  // body, and emptying the body first makes React's own teardown throw.
  cleanupSurfaces();
});

describe("every rendered surface", () => {
  beforeEach(() => {
    stubFetch();
    // Both mocks are single objects for the whole file, so a test that sets one
    // — `?q=` for search, `?tab=` for the profile's cover, the Page's username —
    // would otherwise hand it to every test after it. Each case then says what
    // url it is auditing, which is the only way that is readable.
    mocks.navigation.params = new URLSearchParams("");
    delete mocks.routeParams.username;
    delete mocks.routeParams.id;
    // The signed-out cases below flip the session off; this hands the member
    // back to every case that follows, the same courtesy the params get.
    mocks.auth.isAuthenticated = true;
  });

  test("the nav, signed in", async () => {
    const { MainNav } = await import("@/components/layout/main-nav");
    await audit(<MainNav />);
  });

  test("the nav, signed out", async () => {
    // The visitor's header is a different surface, not a sparser one: the
    // search icon, the bell and the account menu are all absent, and in their
    // place is the Sign In / Sign Up pair — controls no signed-in case here
    // can see, so a nameless one among them would pass this file forever.
    // The flip is the same one the links guard's signed-out cases make, and
    // `beforeEach` hands the member back to the cases after these.
    mocks.auth.isAuthenticated = false;
    const { MainNav } = await import("@/components/layout/main-nav");
    // Stated rather than assumed: "Sign In" is the visitor branch's own words,
    // and the member header has none — a flip that did not take would audit
    // the member's header and pass this case unread.
    await audit(<MainNav />, { shows: "Sign In" });
  });

  test("the nav, with the account menu opened", async () => {
    // The menu's links, its separators and the theme switch are mounted only
    // while it is open, so no other case here can judge them. It opens on a
    // pointer press — Radix's menu trigger listens for `pointerdown` and not for
    // the `click()` that follows it — which is what the pointer helper is for.
    const { MainNav } = await import("@/components/layout/main-nav");
    await audit(<MainNav />, {
      interact: async (ui) => {
        const trigger = ui.container.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
        if (!trigger) throw new Error("the nav rendered no account menu to open");
        await ui.pointerDown(trigger);
        // Stated rather than assumed: a menu that did not open would leave this
        // surface judging the nav with no menu in it, and passing for that.
        await ui.waitFor(() => document.querySelector('[role="menu"]') !== null, {
          description: "the account menu to open",
        });
      },
    });
  });

  test("the nav, with the notification panel opened", async () => {
    // The panel is only mounted while it is open, so its own controls and the
    // bell's disclosure are invisible to every other surface here. Opening it is
    // the only way to judge the state the bell claims.
    const { MainNav } = await import("@/components/layout/main-nav");
    await audit(<MainNav />, {
      // The panel is what the click was for, so the notification it shows is
      // what says the panel is really open rather than merely mounted.
      shows: "started following you",
      interact: async (ui) => {
        const bell = ui.container.querySelector('[aria-controls="notification-panel"]');
        if (!bell) throw new Error("the nav rendered no disclosure to open");
        await ui.click(bell as HTMLElement);
      },
    });
  });

  test("the nav, with the mobile panel opened", async () => {
    // The theme switcher lives in the mobile panel, which is mounted only while
    // the panel is open — so it is invisible to every other case here, and to
    // every static-markup test of the nav as well. The panel's disclosure is a
    // plain button, so a real click is enough to bring it on screen.
    const { MainNav } = await import("@/components/layout/main-nav");
    await audit(<MainNav />, {
      interact: async (ui) => {
        const menu = ui.container.querySelector<HTMLElement>('[aria-controls="mobile-nav"]');
        if (!menu) throw new Error("the nav rendered no menu button to open");
        await ui.click(menu);
      },
    });
  });

  test("the nav, signed out, with the mobile panel opened", async () => {
    // The visitor's panel is where the session's door lives on a phone: the
    // Sign In / Sign Up links stand where Sign out stands for a member, and
    // the module list is the visitor's two, with the theme group below them.
    // Opened by the same real click the signed-in case uses, and stated open
    // before the audit reads it — a panel that failed to open would leave
    // this surface judging the header alone and passing for that.
    mocks.auth.isAuthenticated = false;
    const { MainNav } = await import("@/components/layout/main-nav");
    await audit(<MainNav />, {
      interact: async (ui) => {
        const menu = ui.container.querySelector<HTMLElement>('[aria-controls="mobile-nav"]');
        if (!menu) throw new Error("the nav rendered no menu button to open");
        await ui.click(menu);
        await ui.waitFor(() => document.querySelector("#mobile-nav") !== null, {
          description: "the visitor's mobile panel to open",
        });
      },
    });
  });

  test("the bottom nav", async () => {
    const { BottomNav } = await import("@/components/layout/bottom-nav");
    await audit(<BottomNav />);
  });

  test("the bottom nav, signed out", async () => {
    // The visitor's bar is the filter's doing — Social is the item a visitor
    // is not offered, and what remains is Marketplace and Jobs. The bar the
    // member gets proves nothing about the one the visitor gets: they are two
    // renderings of one list, and each state a reader can be handed gets the
    // same two questions asked of it.
    mocks.auth.isAuthenticated = false;
    const { BottomNav } = await import("@/components/layout/bottom-nav");
    await audit(<BottomNav />, {
      // Stated rather than assumed: a flip that did not take would audit the
      // member's bar and pass — a nameless-control sweep cannot tell the two
      // states apart. Social's absence in the surface is the proof that the
      // visitor's bar is the one being judged; the route-level half of that
      // pin is the links guard's own.
      interact: async (ui) => {
        expect(ui.container.querySelector('a[href="/feed"]'), "the visitor's bar offers no Social").toBeNull();
      },
    });
  });

  test("the Social strip, which is the only way between the four surfaces", async () => {
    // It draws its own four links and reads no endpoint, so the labels arriving
    // is the whole of what has to be waited for. The stub path is `/feed`, which
    // is one of the four — off Social the strip renders nothing, and an audit of
    // nothing passes for the wrong reason.
    mocks.navigation.pathname = "/feed";
    const { SocialNav } = await import("@/components/layout/social-nav");
    await audit(<SocialNav />, { shows: "Messages" });
  });

  covers("/");
  test("the marketing page", async () => {
    const { default: LandingPage } = await import("@/app/page");
    await audit(<LandingPage />);
  });

  covers("/marketplace");
  test("the marketplace, with a listing", async () => {
    const { default: MarketplacePage } = await import("@/app/(main)/marketplace/page");
    await audit(<MarketplacePage />, { shows: listing.title });
  });

  test("the marketplace, signed out, with a listing", async () => {
    // A visitor is handed this page on purpose — the nav advertises it and the
    // middleware lets it through — so the state gets the audit's two questions
    // however alike the renders are. The visitor's rows answer `isSaved: false`
    // (the route never reads the saved table without a session), so the heart
    // renders unfilled and named "Save listing" — the flag-off surface, which
    // is what a visitor is actually handed. The member case beside it pins the
    // flag-lit state, so the two states a reader can be handed are both judged.
    mocks.auth.isAuthenticated = false;
    const { default: MarketplacePage } = await import("@/app/(main)/marketplace/page");
    await audit(<MarketplacePage />, { shows: listing.title });
  });

  test("the marketplace, signed in, with a saved listing", async () => {
    // The member's list carries the viewer's own saved flags, and the card
    // starts from the row's truth: the heart is already filled and its name
    // follows the state it was handed — "Remove from saved", not "Save
    // listing" with a filled picture underneath. The flag is the route's
    // answer, not a client guess, so the canned row carries it the way the
    // route answers it, and the restore below puts the shared payload back
    // for the next case.
    const withSaved = { data: [{ ...listing, isSaved: true }] };
    const original = CANNED["/api/marketplace"];
    CANNED["/api/marketplace"] = withSaved;
    try {
      const { default: MarketplacePage } = await import("@/app/(main)/marketplace/page");
      await audit(<MarketplacePage />, {
        shows: listing.title,
        interact: async (ui) => {
          const heart = ui.container.querySelector('button[aria-label="Remove from saved"]');
          expect(heart, "a saved listing's heart is named by the state the flag put it in").toBeTruthy();
          expect(
            ui.container.querySelector('button[aria-label="Save listing"]'),
            "the unfilled name is gone while the flag is lit",
          ).toBeNull();
        },
      });
    } finally {
      CANNED["/api/marketplace"] = original;
    }
  });

  covers("/marketplace/saved");
  test("the saved listings page, with saved rows", async () => {
    // The member's shelf is rendered from the same flag contract the grid is:
    // the row carries `isSaved`, and the heart it lights is the same heart the
    // grid's cards wear — named "Remove from saved", not "Save listing",
    // because the shelf is made of saved things. A reader who lands here after
    // un-saving everywhere would see the empty state, judged beside it.
    const { default: SavedListingsPage } = await import("@/app/(main)/marketplace/saved/page");
    await audit(<SavedListingsPage />, {
      shows: listing.title,
      interact: async (ui) => {
        expect(
          ui.container.querySelector('button[aria-label="Remove from saved"]'),
          "a saved row's heart is lit by the row's own flag",
        ).toBeTruthy();
        expect(ui.container.querySelector('button[aria-label="Save listing"]')).toBeNull();
      },
    });
  });

  test("the saved listings page, with nothing saved", async () => {
    // The empty shelf is a state a reader is genuinely handed — a member who
    // un-saved their last pick lands here — and it names its way out: the
    // browse surface is one named control away. The restore puts the shelf's
    // payload back for the next case.
    const original = CANNED["/api/marketplace/saved"];
    CANNED["/api/marketplace/saved"] = { data: [] };
    try {
      const { default: SavedListingsPage } = await import("@/app/(main)/marketplace/saved/page");
      await audit(<SavedListingsPage />, {
        shows: "Nothing saved yet",
        interact: async (ui) => {
          expect(
            ui.container.textContent,
            "the empty shelf points back at the browse surface",
          ).toContain("Browse the marketplace");
        },
      });
    } finally {
      CANNED["/api/marketplace/saved"] = original;
    }
  });

  covers("/jobs");
  test("jobs, with a posting", async () => {
    const { default: JobsPage } = await import("@/app/(main)/jobs/page");
    await audit(<JobsPage />, { shows: job.title });
  });

  test("jobs, signed out, with a posting", async () => {
    // A visitor is handed this page on purpose, and their rows answer
    // `hasApplied: false` without the application read — so no "Applied"
    // badge renders and the Apply button stands alone, which is the flag-off
    // surface a visitor is actually handed. The member case beside it pins
    // the flag-lit state, so both states are judged.
    mocks.auth.isAuthenticated = false;
    const { default: JobsPage } = await import("@/app/(main)/jobs/page");
    await audit(<JobsPage />, { shows: job.title });
  });

  test("jobs, signed in, with an applied posting", async () => {
    // The member's list carries the viewer's own applied flags, and the card
    // says so in words — "Applied" beside the posting's type — because a flag
    // the reader cannot see is an answer that never reached them. The canned
    // row carries the flag the way the route answers it; the restore puts the
    // shared payload back for the next case.
    const withApplied = { data: [{ ...job, hasApplied: true }] };
    const original = CANNED["/api/jobs"];
    CANNED["/api/jobs"] = withApplied;
    try {
      const { default: JobsPage } = await import("@/app/(main)/jobs/page");
      await audit(<JobsPage />, { shows: "Applied" });
    } finally {
      CANNED["/api/jobs"] = original;
    }
  });

  test("jobs, signed in, with an application whose status is pending", async () => {
    // The list read carries the application's status beside the flag (the same
    // answer the single-job read has always given), and the card wears it in
    // words — "Pending" — because a status a reader cannot see is a status the
    // reader has to go looking for. The swap/restore keeps the shared payload
    // whole for the cases after it.
    const withStatus = { data: [{ ...job, hasApplied: true, applicationStatus: "pending" }] };
    const original = CANNED["/api/jobs"];
    CANNED["/api/jobs"] = withStatus;
    try {
      const { default: JobsPage } = await import("@/app/(main)/jobs/page");
      await audit(<JobsPage />, {
        shows: "Applied",
        interact: async (ui) => {
          expect(
            ui.container.textContent,
            "the card shows where the application stands, capitalized from the row's enum key",
          ).toContain("Pending");
          expect(ui.container.textContent).toContain("Applied");
        },
      });
    } finally {
      CANNED["/api/jobs"] = original;
    }
  });

  test("jobs, signed in, with a hired application", async () => {
    // The tail of the enum is a decision the reader most wants named: "Hired"
    // rides the same badge the "Pending" case judged, from the row's own value
    // rather than a hard-coded word — the card capitalizes whatever the list
    // read carried.
    const withHired = { data: [{ ...job, hasApplied: true, applicationStatus: "hired" }] };
    const original = CANNED["/api/jobs"];
    CANNED["/api/jobs"] = withHired;
    try {
      const { default: JobsPage } = await import("@/app/(main)/jobs/page");
      await audit(<JobsPage />, {
        shows: "Applied",
        interact: async (ui) => {
          expect(ui.container.textContent).toContain("Hired");
          expect(
            ui.container.textContent,
            "no stale state from the previous case's payload",
          ).not.toContain("Pending");
        },
      });
    } finally {
      CANNED["/api/jobs"] = original;
    }
  });

  covers("/groups");
  test("communities, with one community", async () => {
    const { default: GroupsPage } = await import("@/app/(main)/groups/page");
    await audit(<GroupsPage />, { shows: group.name });
  });

  covers("/groups/[id]");
  test("a community, as a member", async () => {
    // The route segment the page reads, set before the import so the dynamic
    // route sees it on first render. The canned answer says the viewer is a
    // member, which is the state with the most on screen: the group's posts and
    // the composer that writes them have to be judged too.
    mocks.routeParams.id = group.id;
    const { default: GroupView } = await import("@/app/(main)/groups/[id]/page");
    await audit(<GroupView />, { shows: post.content });
  });

  covers("/search");
  test("search, with a result", async () => {
    // The page renders people only for a query, so the audit gets one.
    mocks.navigation.params = new URLSearchParams("q=maya");
    const { default: SearchPage } = await import("@/app/(main)/search/page");
    await audit(<SearchPage />, { shows: "Maya Chen" });
  });

  test("search, with the people tab chosen", async () => {
    // Six tabs, and only the first is on screen when the page is met — so a
    // tab whose panel is mislabelled, or which points at nothing, is invisible
    // to the case above. Switching judges the state a reader gets after a
    // choice. "People" rather than an empty tab because Radix mounts a panel's
    // *children* only while it is the active one, so the result this case
    // declares would otherwise be unmounted the moment the tab moved.
    mocks.navigation.params = new URLSearchParams("q=maya");
    const { default: SearchPage } = await import("@/app/(main)/search/page");
    await audit(<SearchPage />, {
      shows: "Maya Chen",
      interact: async (ui) => {
        const people = [...ui.container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (tab) => tab.textContent?.trim() === "People",
        );
        if (!people) throw new Error("the search page rendered no People tab");
        await ui.mouseDown(people);
        await ui.waitFor(
          () =>
            document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ===
            "People",
          { description: "the People tab to be chosen" },
        );
      },
    });
  });

  covers("/admin");
  test("the admin dashboard", async () => {
    const { default: AdminPage } = await import("@/app/(main)/admin/page");
    await audit(<AdminPage />);
  });

  test("the admin dashboard, with the users tab chosen", async () => {
    // The pending-approvals panel is hidden until its tab is chosen, and the
    // Approve buttons on it are the reason to judge it — a reader only reaches
    // them by switching. By mouse, which is the event a tab activates on.
    const { default: AdminPage } = await import("@/app/(main)/admin/page");
    await audit(<AdminPage />, {
      interact: async (ui) => {
        const users = [...ui.container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (tab) => tab.textContent?.trim() === "Users",
        );
        if (!users) throw new Error("the admin dashboard rendered no Users tab");
        await ui.mouseDown(users);
        await ui.waitFor(
          () =>
            document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ===
            "Users",
          { description: "the Users tab to be chosen" },
        );
      },
    });
  });

  covers("/pages");
  test("the Pages directory, with a Page in it", async () => {
    const { default: PagesDirectory } = await import("@/app/(main)/pages/page");
    await audit(<PagesDirectory />, { shows: pageListItem.name });
  });

  // The cover studio used to be audited here, as a surface of its own. It is a
  // tab of the profile now, and its old address is a `redirect(...)` — a page
  // with nothing in it to audit, which throws before the audit can look. The
  // profile is audited above; its cover tab is the surface here that no longer
  // has a case of its own.

  covers("/messages");
  test("messages, with a conversation open", async () => {
    const { default: MessagesPage } = await import("@/app/(main)/messages/page");
    await audit(<MessagesPage />, { shows: conversation.lastMessage.content });
  });

  covers("/settings");
  test("settings", async () => {
    const { default: SettingsPage } = await import("@/app/(main)/settings/page");
    await audit(<SettingsPage />, { shows: "Visual designer" });
  });

  test("the settings page, with the profile-visibility select opened", async () => {
    // Radix's select mounts its options only while it is open, so this is the
    // only way the app's one `listbox` is ever judged. Opened with a real
    // pointer press on the trigger the label points at — the event the control
    // listens for, and the way a reader opens it.
    const { default: SettingsPage } = await import("@/app/(main)/settings/page");
    await audit(<SettingsPage />, {
      shows: "Visual designer",
      interact: async (ui) => {
        const trigger = ui.container.querySelector<HTMLElement>("#visibility");
        if (!trigger) throw new Error("the settings page rendered no visibility select");
        await ui.pointerDown(trigger);
      // Stated rather than assumed: if the select did not open, the audit below
      // would be judging a page with no listbox in it and passing for that
      // reason — the green that means nothing. A wait states it as well as an
      // assertion does, and it cannot be asserted too early.
        await ui.waitFor(() => document.querySelector('[role="listbox"]') !== null, {
          description: "the profile-visibility select to open",
        });
      },
    });
  });

  covers("/feed");
  test("the feed, with a post on it", async () => {
    const { default: FeedPage } = await import("@/app/(main)/feed/page");
    await audit(<FeedPage />, { shows: post.content });
  });

  covers("/profile");
  test("a profile", async () => {
    const { default: ProfilePage } = await import("@/app/(main)/profile/page");
    await audit(<ProfilePage />, { shows: post.content });
  });

  test("a profile, on the cover tab the old studio address forwards to", async () => {
    // The cover studio is a tab of the profile now, and `/cover-studio` forwards
    // to the url that names it — so this is that forward's destination, and the
    // only address the studio has left. The tab is read from the url once, on
    // mount, so the params have to be in place before the page is imported.
    mocks.navigation.params = new URLSearchParams("tab=cover");
    const { default: ProfilePage } = await import("@/app/(main)/profile/page");
    await audit(<ProfilePage />, {
      // The member's own details, which is what the header above the tab reads.
      shows: "Visual designer",
      interact: async () => {
        // Nothing to click — the tab is the url's doing — and this case needs the
        // statement more than the others do: a `?tab=` that stopped being
        // honoured would leave the audit judging the posts tab and reporting on
        // the wrong surface, which is the same kind of green as auditing an empty
        // one. The studio's controls are what nothing else here can see.
        expect(
          document.querySelector('[aria-label="Filter templates by category"]'),
          "the cover tab opened, and the studio with it",
        ).not.toBeNull();
      },
    });
  });

  covers("/pages/[username]");
  test("a Page, with an admin's composer", async () => {
    // The route segment the page reads. Set before the import so the dynamic
    // route sees it on first render.
    mocks.routeParams.username = page.username;
    const { default: PageView } = await import("@/app/(main)/pages/[username]/page");
    await audit(<PageView />, { shows: page.name });
  });

  test("a Page, with the edit dialog opened", async () => {
    // The dialog's fields, its two image buttons and its Save exist only while it
    // is open, and Radix hides the page behind it — so this is the one surface
    // where the Page's own controls are deliberately out of scope and the
    // dialog's are the whole subject.
    mocks.routeParams.username = page.username;
    const { default: PageView } = await import("@/app/(main)/pages/[username]/page");
    await audit(<PageView />, {
      shows: page.name,
      interact: async (ui) => {
        const edit = [...ui.container.querySelectorAll("button")].find((button) =>
          (button.textContent ?? "").includes("Edit Page"),
        );
        if (!edit) throw new Error("the Page rendered no Edit Page control to open");
        await ui.click(edit as HTMLElement);
        // Stated rather than assumed: a dialog that did not open would leave
        // this surface judging a page with no dialog in it, and passing for that
        // reason.
        await ui.waitFor(() => document.querySelector('[role="dialog"]') !== null, {
          description: "the Page's edit dialog to open",
        });
      },
    });
  });

  test("the Page composer's audience menu, opened", async () => {
    // The menu's options exist only while it is open, so nothing else here can
    // judge them: a group of `menuitemradio`s that must be named, and each
    // option saying whether it is the chosen one. Opened with a real pointer
    // press, which is the event Radix's menu trigger listens for.
    mocks.routeParams.username = page.username;
    const { default: PageView } = await import("@/app/(main)/pages/[username]/page");
    await audit(<PageView />, {
      shows: page.name,
      interact: async (ui) => {
        await ui.pointerDown(ui.byName("Post audience: Public"));
        // Stated rather than assumed: a menu that did not open would leave this
        // surface judging a page with no menu in it, and passing for that
        // reason.
        await ui.waitFor(() => document.querySelector('[role="menuitemradio"]') !== null, {
          description: "the audience menu to open",
        });
      },
    });
  });

  test("the composer, opened", async () => {
    // The toolbar only exists once the composer is expanded, and it is where
    // the icon-only controls are: Photo, Video, Feeling, and the audience picker.
    const { PostComposer } = await import("@/components/social/post-composer");
    await audit(<PostComposer />, {
      interact: async (ui) => {
        const field = ui.container.querySelector("textarea");
        if (!field) throw new Error("the composer rendered no textarea to open");
        await ui.focus(field);
      },
    });
  });
});

/**
 * The one page the audit cannot mount, pinned by what it does instead.
 *
 * `/cover-studio` is a `redirect(...)`: it throws before there is anything to
 * render, so no rendered check can judge it and it sits in `UNCOVERED`. The
 * address it forwards to is still a decision the app made, and this is the case
 * that holds it — the profile tab it names is exactly what the audited profile
 * case opens with `?tab=cover`.
 */
describe("the cover studio's old address", () => {
  test("forwards to the profile's cover tab", async () => {
    mocks.navigation.redirects.length = 0;
    const { default: CoverStudioPage } = await import("@/app/(main)/cover-studio/page");
    // Called rather than mounted: a redirect is not a render, and React would
    // only report the throw as a render failure. The navigation mock records the
    // target and throws the way Next does, which is what stops the page here.
    expect(() => CoverStudioPage()).toThrow(/NEXT_REDIRECT/);
    expect(mocks.navigation.redirects).toEqual(["/profile?tab=cover"]);
  });
});

/**
 * A skeletal case for every page that has no bespoke one above.
 *
 * The bespoke cases judge a surface's data and the states it can be put into;
 * this is the floor under them. Whatever pages are left over are still mounted
 * and asked the two questions every surface gets — did a control render, and
 * does anything a reader can reach lack a name — so "nobody wrote a case for
 * it" cannot mean "no audit at all". It is generated from the filesystem rather
 * than written per page, which is what lets the exception list above be a list
 * of one rather than of eight.
 *
 * It cannot stand in for a bespoke case: it declares no `shows`, so a page that
 * reads a canned endpoint fails here on purpose and asks for a real case.
 */
const pageModules = new Map(
  Object.entries(pageComponentModules()).map(([file, load]) => [routePath(file), load]),
);

/**
 * The pages with no bespoke case, worked out as the suites are collected.
 *
 * Not while the file is read: the `covers(...)` beside each bespoke case runs
 * in the same collection pass, and a page looked up before that pass has run
 * looks uncovered, so this would generate a case for every page and judge each
 * one twice. Collection is in file order, so by the time this is asked the
 * cases above have said what they cover.
 */
function skeletalRoutes(): string[] {
  return [...pageModules.keys()]
    .filter((route) => !audited.has(route) && !(route in UNCOVERED))
    .sort();
}

describe("pages with no case of their own", () => {
  describe.each(skeletalRoutes())("the %s page", (route) => {
    covers(route);
    test("renders something, and nothing unnamed in it", async () => {
      const load = pageModules.get(route);
      if (!load) throw new Error(`no module was found for ${route}`);
      const { default: Page } = await load();
      // No control is demanded: several of these are prose pages with none to
      // reach, and the text check is what says they rendered at all. Structure
      // is, because these are whole pages and that is the claim being added —
      // that a prose page reads as one, with a single subject and no gap in its
      // outline.
      await audit(<Page />, { requiresControl: false, structure: true });
    });
  });
});

/**
 * Every component module, enumerated from disk and loaded on demand, so a module
 * that fails to load is one case's problem and the components nothing mounts are
 * never read at all. `componentModuleLoaders` walks `src/components` for the
 * paths and hands back a loader per one; see it for why this is not a glob.
 */
const componentModules = componentModuleLoaders();

/** The component modules, by path, sorted so the generated cases read in order. */
const componentPaths = Object.keys(componentModules).sort();

/**
 * The exports that can be mounted, which is not every export.
 *
 * A component is exported under a capitalised name and is a function or a
 * `forwardRef`/`memo` wrapper — an object carrying React's `$$typeof`. The rest
 * of what a module exports is types, constants and helpers, and mounting one
 * would be meaningless.
 */
function componentExports(module: Record<string, unknown>): {
  name: string;
  Component: React.ComponentType;
}[] {
  const found: { name: string; Component: React.ComponentType }[] = [];

  for (const [name, value] of Object.entries(module)) {
    if (!/^[A-Z]/.test(name)) continue;
    const mountable =
      typeof value === "function" ||
      (value !== null && typeof value === "object" && "$$typeof" in value);
    if (mountable) found.push({ name, Component: value as React.ComponentType });
  }

  return found;
}

/**
 * The four ways a component can be unjudgeable on its own, and what each means.
 *
 * Every nameless control the prop-less mount turns up is one of these, not a
 * defect: the harness that mounted the component is what is missing, and saying
 * which way it is missing is what keeps the exception honest rather than a
 * blanket "skip". Two more cases are not excused at all: a component whose name
 * is a prop is mounted through `COMPONENT_HARNESSES`, and a compound sub-part is
 * mounted with its family through `COMPONENT_FAMILIES` — so `parent` is left for
 * only the few parts no family assembles.
 */
const COMPONENT_EXCEPTION_KINDS = {
  props: "reads props the harness has no way to invent",
  parent: "is part of a compound component no family above assembles",
  loads: "renders only after the browser loads its image, which jsdom never does",
  nothing: "renders nothing until it is given content to wrap",
} as const;

/**
 * The components whose name is a prop, mounted with the least a caller gives.
 *
 * A prop-less mount asks these to render a nameless control and then reports the
 * answer as a defect — `IconButton` without its `label`, a `Button` with no
 * children. Given the one thing a caller always gives, they are exactly the
 * components this audit should judge, so they are mounted through a harness
 * rather than excused.
 *
 * The harness is deliberately the *minimum*: a name and nothing else. What it
 * then checks is that the component puts that name on the control it renders
 * instead of dropping it — a real failure mode, and one a prop-less mount cannot
 * tell apart from a missing prop.
 */
const COMPONENT_HARNESSES: Record<string, (Component: React.ElementType) => React.ReactNode> = {
  "../components/ui/button.tsx#Button": (Button) => <Button>Save</Button>,
  "../components/ui/icon-button.tsx#IconButton": (IconButton) => (
    <IconButton label="Save">
      <svg aria-hidden="true" />
    </IconButton>
  ),
  "../components/ui/disclosure-button.tsx#DisclosureButton": (DisclosureButton) => (
    <DisclosureButton label="Notifications" open={false} controls="notification-panel">
      <svg aria-hidden="true" />
    </DisclosureButton>
  ),
  "../components/ui/toggle-button.tsx#ToggleButton": (ToggleButton) => (
    <ToggleButton pressed={false}>Show</ToggleButton>
  ),
  "../components/ui/switch.tsx#Switch": (Switch) => <Switch aria-label="Enable dark mode" />,
  "../components/ui/input.tsx#Input": (Input) => <Input aria-label="Email address" />,
  "../components/ui/textarea.tsx#Textarea": (Textarea) => <Textarea aria-label="Your bio" />,
  "../components/shared/filter-chip.tsx#FilterChip": (FilterChip) => (
    <FilterChip selected={false}>All</FilterChip>
  ),
  // The control's name is a prop as well, and prop-less it renders `aria-label
  // "Play undefined"` — a string that reads like a name, which is exactly how a
  // missing label would hide from this pass. Given the least a caller gives,
  // what the audit then checks is the pairing the two surfaces depend on: the
  // verb tracking the state, and the glyph hidden so the name is the words alone.
  "../components/shared/ambient-playback-button.tsx#AmbientPlaybackButton": (AmbientPlaybackButton) => (
    <AmbientPlaybackButton playing={false} setPlaying={() => {}} label="live preview" />
  ),
  // The strip's name is a prop too, and prop-less it renders an empty group —
  // even the first dot needs a `count` — which is nothing for the audit to
  // judge. Given the least a caller always gives, what it then checks is the
  // pairing that makes the strip worth having: the label reaching the group (an
  // `aria-label` on a plain `div` is ignored, which is how both of these strips
  // once had no name) and a name on every dot, one of which has no words of its
  // own because it carries no text.
  "../components/shared/scene-strip.tsx#SceneStrip": (SceneStrip) => (
    <SceneStrip
      label="Live preview slides"
      count={2}
      selected={0}
      // Named by what each dot switches to, which is what `labelFor` asks of every
      // caller — a positional name would be a name this audit passes and a reader
      // learns nothing from.
      labelFor={(index: number) => `Show “${["New ideas are taking shape.", "Find your people."][index]}”`}
      onSelect={() => {}}
      trackClassName="h-1"
      fillClassName={() => ""}
    />
  ),
};

/**
 * The compound families, mounted with their own parts so the sub-parts that
 * only exist inside a parent are judged in context rather than excused.
 *
 * Every Radix sub-part — a `DialogTitle`, a `SelectItem`, a `TabsTrigger` —
 * throws or renders nothing when mounted alone, which the individual pass above
 * reports and an exception suppresses. That suppression is honest about what it
 * cannot see (the part is unjudgeable alone) and dishonest about what it must not
 * hide (the part is unjudgeable *everywhere* if nobody ever mounts it). So each
 * family here mounts the least tree that renders its parts together and hands
 * the whole surface to the same audit.
 *
 * Each covered part names the `module#Export` key the individual pass must skip
 * and `appears` — a predicate over the mounted document that is true only when
 * that part put something in it. The predicate is what keeps `covers` from
 * outliving the harness: deleting a part from a `render` below leaves its key
 * listed, its export still found, and — without `appears` — its audit silently
 * gone. So every covered part must prove it contributed, and no covered part may
 * also be excused: covered means judged. The harness is again the *minimum* —
 * one part of each kind, named the way a caller names it — so what it checks is
 * the wiring between the parts, which is exactly what a prop-less mount of a
 * sub-part cannot see.
 *
 * A family is rendered *closed* and opened by `interact`, the reader's own
 * gesture, and both states are audited. The open state is therefore the one a
 * reader reaches, not a `forceMount`ed stand-in that renders the content while
 * skipping the interaction that is supposed to produce it.
 */

/** One part a family mounts, and how its presence is seen in the document. */
type FamilyPart = {
  /** The `module#Export` key the individual pass must skip. */
  key: string;
  /**
   * Whether this part contributed an element. Runs against `document.body`,
   * because Radix portals menus, dialogs and tooltips out of their mount and
   * onto the body — which is exactly where a dropped part would be missing.
   */
  appears: (root: Element) => boolean;
};

/** Whether any element matching `selector` has exactly this text. */
function hasText(selector: string, text: string): (root: Element) => boolean {
  return (root) =>
    [...root.querySelectorAll(selector)].some((element) => element.textContent?.trim() === text);
}

/**
 * A compound family: what it covers, how it is mounted closed, and how a reader
 * opens its disclosure.
 */
type Family = {
  /** The parts this family mounts and judges together. */
  covers: FamilyPart[];
  /** The tree as a caller mounts it — closed, which is how a reader meets it. */
  render: (parts: Record<string, React.ElementType>) => React.ReactNode;
  /**
   * The reader's own gesture that opens the family's disclosure — a key on the
   * trigger, a focus, a click. The open state is judged after this runs, so what
   * is checked is the content a reader actually gets, not a `forceMount`ed copy
   * that skips the gesture to reach it. Absent when there is no disclosure.
   */
  interact?: (ui: MountedSurface) => Promise<void>;
};

/** The one element inside the mount that `selector` names, or a loud failure. */
function triggerIn(ui: MountedSurface, selector: string): HTMLElement {
  const element = ui.container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no ${selector} inside the family to open`);
  return element;
}

const COMPONENT_FAMILIES: Record<string, Family> = {
  "../components/ui/dialog.tsx": {
    covers: [
      {
        key: "../components/ui/dialog.tsx#DialogTrigger",
        appears: (root) => root.querySelector('button[aria-haspopup="dialog"]') !== null,
      },
      // The portal's only signature is the move itself: the dialog lands as a
      // direct child of the body, where an unportalled one would sit inside the
      // mount. Nothing else distinguishes "rendered through `DialogPortal`" from
      // "rendered beside it".
      {
        key: "../components/ui/dialog.tsx#DialogPortal",
        appears: (root) =>
          [...root.children].some((child) => child.getAttribute("role") === "dialog"),
      },
      {
        key: "../components/ui/dialog.tsx#DialogOverlay",
        appears: (root) => root.querySelector('[class*="bg-black/80"]') !== null,
      },
      {
        key: "../components/ui/dialog.tsx#DialogContent",
        appears: (root) => root.querySelector('[role="dialog"]') !== null,
      },
      {
        key: "../components/ui/dialog.tsx#DialogTitle",
        appears: hasText('[role="dialog"] h2', "Rename this post"),
      },
      {
        key: "../components/ui/dialog.tsx#DialogDescription",
        appears: hasText('[role="dialog"] p', "Choose a name readers will recognise."),
      },
      {
        key: "../components/ui/dialog.tsx#DialogClose",
        appears: hasText("button", "Cancel"),
      },
    ],
    render: ({
      Dialog,
      DialogTrigger,
      DialogContent,
      DialogHeader,
      DialogTitle,
      DialogDescription,
      DialogFooter,
      DialogClose,
    }) => (
      <Dialog>
        <DialogTrigger>Rename</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename this post</DialogTitle>
            <DialogDescription>Choose a name readers will recognise.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
    // Opened by a click, as a reader opens it: Radix's dialog trigger is a
    // button whose `onClick` toggles the root, so `element.click()` reaches it.
    interact: async (ui) => {
      await ui.click(triggerIn(ui, 'button[aria-haspopup="dialog"]'));
      await ui.waitFor(() => document.querySelector('[role="dialog"]') !== null, {
        description: "the dialog to open",
      });
    },
  },
  "../components/ui/select.tsx": {
    covers: [
      {
        key: "../components/ui/select.tsx#SelectTrigger",
        appears: (root) => root.querySelector('[role="combobox"]') !== null,
      },
      // The trigger's text *is* `SelectValue`'s output, so a trigger reading
      // "Public" is its contribution and an empty trigger is its absence.
      {
        key: "../components/ui/select.tsx#SelectValue",
        appears: (root) =>
          (root.querySelector('[role="combobox"]')?.textContent ?? "").includes("Public"),
      },
      {
        key: "../components/ui/select.tsx#SelectContent",
        appears: (root) => root.querySelector('[role="listbox"]') !== null,
      },
      {
        key: "../components/ui/select.tsx#SelectItem",
        appears: (root) => root.querySelectorAll('[role="option"]').length >= 2,
      },
    ],
    render: ({ Select, SelectTrigger, SelectValue, SelectContent, SelectItem }) => (
      <Select value="public" onValueChange={() => {}}>
        <SelectTrigger aria-label="Visibility">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="public">Public</SelectItem>
          <SelectItem value="private">Only me</SelectItem>
        </SelectContent>
      </Select>
    ),
    // Opened by a real mouse press, which is what Radix's select trigger listens
    // for — and only when the pointer is a mouse, so the helper says so.
    interact: async (ui) => {
      await ui.pointerDown(triggerIn(ui, '[role="combobox"]'));
      await ui.waitFor(() => document.querySelector('[role="listbox"]') !== null, {
        description: "the select to open",
      });
    },
  },
  "../components/ui/tabs.tsx": {
    covers: [
      {
        key: "../components/ui/tabs.tsx#TabsList",
        appears: (root) => root.querySelector('[role="tablist"]') !== null,
      },
      {
        key: "../components/ui/tabs.tsx#TabsTrigger",
        appears: (root) => root.querySelectorAll('[role="tab"]').length >= 2,
      },
      {
        key: "../components/ui/tabs.tsx#TabsContent",
        appears: (root) => root.querySelectorAll('[role="tabpanel"]').length >= 1,
      },
    ],
    render: ({ Tabs, TabsList, TabsTrigger, TabsContent }) => (
      <Tabs defaultValue="reports">
        <TabsList aria-label="Admin sections">
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="reports">Reports body</TabsContent>
        <TabsContent value="users">Users body</TabsContent>
      </Tabs>
    ),
    // No disclosure to open, but the family still has a rendered state beyond
    // the first: choosing the other tab moves `aria-selected` and shows its
    // panel, and that state is audited too. By mouse, which is the route Radix
    // uses — a tab activates on `mousedown`, neither on a click nor on a
    // pointer press.
    interact: async (ui) => {
      const users = [...ui.container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (tab) => tab.textContent?.trim() === "Users",
      );
      if (!users) throw new Error("no Users tab to choose");
      await ui.mouseDown(users);
      await ui.waitFor(
        () =>
          document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ===
          "Users",
        { description: "the Users tab to be chosen" },
      );
    },
  },
  "../components/ui/dropdown-menu.tsx": {
    covers: [
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuTrigger",
        appears: (root) => root.querySelector('button[aria-haspopup="menu"]') !== null,
      },
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuContent",
        appears: (root) => root.querySelector('[role="menu"]') !== null,
      },
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuItem",
        appears: hasText('[role="menuitem"]', "Profile"),
      },
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuRadioItem",
        appears: (root) => root.querySelectorAll('[role="menuitemradio"]').length >= 2,
      },
      // Both the submenu's root and its content are proved by the same fact — a
      // second `menu` nested in the first — since `DropdownMenuSub` renders no
      // element of its own and its content is the element the nesting produces.
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuSub",
        appears: (root) => root.querySelectorAll('[role="menu"]').length >= 2,
      },
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuSubTrigger",
        appears: (root) =>
          root.querySelector('[role="menuitem"][aria-haspopup="menu"]') !== null,
      },
      {
        key: "../components/ui/dropdown-menu.tsx#DropdownMenuSubContent",
        appears: (root) => root.querySelectorAll('[role="menu"]').length >= 2,
      },
    ],
    render: ({
      DropdownMenu,
      DropdownMenuTrigger,
      DropdownMenuContent,
      DropdownMenuItem,
      DropdownMenuRadioGroup,
      DropdownMenuRadioItem,
      DropdownMenuSeparator,
      DropdownMenuSub,
      DropdownMenuSubTrigger,
      DropdownMenuSubContent,
    }) => (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup aria-label="Sort">
            <DropdownMenuRadioItem value="newest">Newest</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">Oldest</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuItem>Archive</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    // Opened by the mouse: the menu on a press, and the submenu by the pointer
    // moving onto its trigger, which is how a mouse reaches a submenu — the
    // second portal opens on hover, after a short delay `waitFor` waits out.
    interact: async (ui) => {
      await ui.pointerDown(triggerIn(ui, 'button[aria-haspopup="menu"]'));
      await ui.waitFor(() => document.querySelector('[role="menu"]') !== null, {
        description: "the menu to open",
      });
      const submenu = document.querySelector<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]');
      if (!submenu) throw new Error("no submenu trigger to open");
      await ui.hover(submenu);
      await ui.waitFor(() => document.querySelectorAll('[role="menu"]').length >= 2, {
        description: "the submenu to open",
      });
    },
  },
  "../components/ui/tooltip.tsx": {
    covers: [
      {
        key: "../components/ui/tooltip.tsx#TooltipTrigger",
        appears: (root) => root.querySelector("button[aria-describedby]") !== null,
      },
      {
        key: "../components/ui/tooltip.tsx#TooltipContent",
        appears: (root) => root.querySelector('[role="tooltip"]') !== null,
      },
    ],
    render: ({ Tooltip, TooltipTrigger, TooltipContent }) => (
      <Tooltip>
        <TooltipTrigger>Details</TooltipTrigger>
        <TooltipContent>Shown while resting on the control</TooltipContent>
      </Tooltip>
    ),
    // Opened by the pointer moving onto the control, which is the hover a
    // tooltip exists for.
    interact: async (ui) => {
      await ui.hover(triggerIn(ui, "button"));
      await ui.waitFor(() => document.querySelector('[role="tooltip"]') !== null, {
        description: "the tooltip to open",
      });
    },
  },
  "../components/ui/avatar.tsx": {
    covers: [
      // `AvatarImage` is deliberately not here: Radix mounts its `<img>` only
      // after the browser fires a load event, which jsdom never does, so it
      // contributes nothing to judge and is excused below instead.
      { key: "../components/ui/avatar.tsx#AvatarFallback", appears: hasText("span", "AL") },
    ],
    render: ({ Avatar, AvatarImage, AvatarFallback }) => (
      <Avatar>
        <AvatarImage src="/ada.png" alt="Ada Lovelace" />
        <AvatarFallback>AL</AvatarFallback>
      </Avatar>
    ),
  },
  "../components/ui/scroll-area.tsx": {
    covers: [
      {
        key: "../components/ui/scroll-area.tsx#ScrollBar",
        appears: (root) => root.querySelector("[data-orientation]") !== null,
      },
    ],
    render: ({ ScrollArea }) => (
      // `type="always"` because Radix mounts a scrollbar only once it measures
      // overflow, and jsdom lays nothing out — so the default `type` renders the
      // area and never the bar, which is not a bar that can be judged.
      <ScrollArea type="always" className="h-24">
        <p>Long content</p>
      </ScrollArea>
    ),
  },
};

/** The `module#Export` keys the individual pass must leave to a family above. */
const COVERED_BY_FAMILY = new Set(
  Object.values(COMPONENT_FAMILIES).flatMap((family) => family.covers.map((part) => part.key)),
);

/**
 * The components that cannot be judged on their own, and which way each fails.
 *
 * Keyed `module#Export` — `../components/profile/profile-cover.tsx#ProfileCover`
 * — which is the one name that is unique: several modules export an `Icon`. The
 * check below fails for a component that needs an excuse and has none, and fails
 * again for one that is excused and now renders cleanly, so this list cannot
 * quietly grow and cannot outlive its reasons.
 *
 * A component that needs props is not a gap this audit can close: the case that
 * supplies the right props belongs with the surface that renders it, and the
 * page cases above already do that for most of these.
 */
const COMPONENT_EXCEPTIONS: Record<string, keyof typeof COMPONENT_EXCEPTION_KINDS> = {
  // Needs props the harness cannot invent.
  "../components/auth/authenticator-challenge.tsx#AuthenticatorChallenge": "props",
  "../components/groups/group-card.tsx#GroupCard": "props",
  "../components/jobs/job-card.tsx#JobCard": "props",
  "../components/marketplace/listing-card.tsx#ListingCard": "props",
  "../components/pages/page-edit-dialog.tsx#PageEditDialog": "props",
  "../components/profile/profile-avatar-upload.tsx#ProfileAvatarUpload": "props",
  "../components/profile/profile-cover.tsx#ProfileCover": "props",
  "../components/profile/profile-details-card.tsx#ProfileDetailsCard": "props",
  "../components/profile/profile-header.tsx#ProfileHeader": "props",
  "../components/social/audience-icon.tsx#AudienceIcon": "props",
  "../components/social/post-card.tsx#PostCard": "props",
  "../components/social/post-edit-dialog.tsx#PostEditDialog": "props",
  "../components/social/virtual-feed-list.tsx#VirtualFeedList": "props",

  // Parts of a compound component: Radix throws without the parent that owns them.
  //
  // Most such parts are no longer excused — a `COMPONENT_FAMILIES` tree above
  // mounts them and the audit judges them in context. What is left is the few no
  // family assembles: the dropdown's bare portal (the content wraps its own, so
  // the exported wrapper is never the one a caller reaches) and the nav's theme
  // items, which read a context and live inside a menu's content.
  "../components/layout/theme-menu-items.tsx#ThemeMenuItems": "parent",
  "../components/ui/dropdown-menu.tsx#DropdownMenuPortal": "parent",

  // Renders only once the browser has loaded its image. `AvatarImage` is Radix's
  // `<img>`, which the primitive withholds until `onload` fires — and jsdom never
  // loads an image, so it writes nothing the prop-less mount could judge. Its
  // `alt` is still the name it must carry, and the family mounts it with the
  // fallback; what cannot be checked is the markup that is never rendered.
  "../components/ui/avatar.tsx#AvatarImage": "loads",

  // Renders nothing until it is given content — a wrapper, a provider, an icon.
  "../components/cover-studio/short-video-canvas.tsx#ShortVideoCanvas": "nothing",
  "../components/profile/cover-edit-dialog.tsx#CoverEditDialog": "nothing",
  "../components/profile/cover-edit-dialog.tsx#CoverImageIcon": "nothing",
  "../components/profile/dynamic-cover-canvas.tsx#DynamicCoverCanvas": "nothing",
  "../components/profile/member-list-dialog.tsx#MemberListDialog": "nothing",
  "../components/profile/profile-cover.tsx#CoverCameraIcon": "nothing",
  "../components/profile/profile-cover.tsx#CoverEditIcon": "nothing",
  "../components/providers/theme-provider.tsx#ThemeProvider": "nothing",
  "../components/providers/theme-sync.tsx#ThemeSync": "nothing",
  "../components/realtime/typing-indicator.tsx#TypingIndicator": "nothing",
  "../components/shared/empty-state.tsx#EmptyState": "nothing",
  "../components/ui/avatar.tsx#Avatar": "nothing",
  "../components/ui/badge.tsx#Badge": "nothing",
  "../components/ui/card.tsx#Card": "nothing",
  "../components/ui/card.tsx#CardContent": "nothing",
  "../components/ui/card.tsx#CardDescription": "nothing",
  "../components/ui/card.tsx#CardFooter": "nothing",
  "../components/ui/card.tsx#CardHeader": "nothing",
  "../components/ui/card.tsx#CardTitle": "nothing",
  "../components/ui/dialog.tsx#Dialog": "nothing",
  "../components/ui/dialog.tsx#DialogFooter": "nothing",
  "../components/ui/dialog.tsx#DialogHeader": "nothing",
  "../components/ui/dropdown-menu.tsx#DropdownMenu": "nothing",
  "../components/ui/dropdown-menu.tsx#DropdownMenuGroup": "nothing",
  "../components/ui/dropdown-menu.tsx#DropdownMenuRadioGroup": "nothing",
  "../components/ui/dropdown-menu.tsx#DropdownMenuSeparator": "nothing",
  "../components/ui/label.tsx#Label": "nothing",
  "../components/ui/media.tsx#MediaImage": "nothing",
  "../components/ui/select.tsx#Select": "nothing",
  "../components/ui/select.tsx#SelectGroup": "nothing",
  "../components/ui/separator.tsx#Separator": "nothing",
  "../components/ui/skeleton.tsx#Skeleton": "nothing",
  "../components/ui/status-indicator.tsx#StatusIndicator": "nothing",
  "../components/ui/tabs.tsx#Tabs": "nothing",
  "../components/ui/tooltip.tsx#Tooltip": "nothing",
  "../components/ui/tooltip.tsx#TooltipProvider": "nothing",
};

describe("components, mounted on their own", () => {
  beforeEach(() => {
    stubFetch();
    mocks.navigation.params = new URLSearchParams("");
    delete mocks.routeParams.username;
    delete mocks.routeParams.id;
    document.body.replaceChildren();
  });

  describe.each(componentPaths)("the %s module", (path) => {
    test("renders each component, or says why it cannot", async () => {
      const mod = await componentModules[path]();
      const problems: string[] = [];

      for (const { name, Component } of componentExports(mod)) {
        const key = `${path}#${name}`;
        // A part a family mounts and judges in context is not mounted here:
        // alone it cannot render at all, and it is not excused either — the
        // family below is where it is checked.
        if (COVERED_BY_FAMILY.has(key)) continue;

        const excuse = COMPONENT_EXCEPTIONS[key];
        let problem: string | null = null;

        try {
          // No control and no declaration demanded: what a component renders on
          // its own may be nothing, and it has no page case to declare against.
          // The two checks that always apply are the ones that matter here — is
          // anything reachable unnamed, and is any state drawn but unsaid. A
          // component whose name is a prop is given the least of it first, so
          // the check judges what it does with the name rather than the fact
          // that the harness omitted it.
          const harness = COMPONENT_HARNESSES[key];
          const node = harness === undefined ? <Component /> : harness(Component);
          await audit(node, { requiresControl: false, requiresShows: false });
        } catch (error) {
          problem = (error as Error).message;
        } finally {
          document.body.replaceChildren();
        }

        if (problem !== null && excuse === undefined) problems.push(`${key} — ${problem}`);
        if (problem === null && excuse !== undefined) {
          problems.push(
            `${key} — excused as "${COMPONENT_EXCEPTION_KINDS[excuse]}", but it rendered with nothing wrong; drop it`,
          );
        }
      }

      expect(problems, problems.join("\n")).toEqual([]);
    });
  });
});

/**
 * The compound families, each mounted as the tree that makes its parts render.
 *
 * The individual pass above cannot judge a Radix sub-part on its own — it throws
 * or renders nothing — and the tempting answer is an exception. That answer is
 * half right: the part cannot be judged *alone*, but it can still be judged, and
 * leaving it excused means a `DialogTitle` that lost its wiring, a `SelectItem`
 * with no text, or a `TabsList` with no name would never be seen by anything.
 *
 * So each family renders the least real tree — one of each part, named the way a
 * caller names it — and the whole surface goes to the same audit. The two
 * invariants below keep the two halves honest: a covered part is not also
 * excused (or the excuse could outlive the family), and every covered name is a
 * real export (or a rename would quietly shrink the family to nothing).
 */
describe("the compound families, mounted together", () => {
  beforeEach(() => {
    stubFetch();
    mocks.navigation.params = new URLSearchParams("");
    delete mocks.routeParams.username;
    delete mocks.routeParams.id;
    document.body.replaceChildren();
  });

  test("a part judged in a family is not also excused", () => {
    const both = Object.values(COMPONENT_FAMILIES)
      .flatMap((family) => family.covers.map((part) => part.key))
      .filter((key) => key in COMPONENT_EXCEPTIONS);
    expect(both, `covered by a family and excused anyway: ${both.join(", ")}`).toEqual([]);
  });

  describe.each(Object.keys(COMPONENT_FAMILIES))("the %s family", (path) => {
    test("opens through a reader's gesture and audits the open surface", async () => {
      const family = COMPONENT_FAMILIES[path];
      const mod = await componentModules[path]();
      const parts: Record<string, React.ElementType> = {};
      for (const { name, Component } of componentExports(mod)) parts[name] = Component;

      // `covers` is a promise that these exist; a rename that broke it would
      // silently drop the part from both passes, so it fails here instead.
      const missing = family.covers
        .map((part) => part.key)
        .filter((key) => parts[key.slice(key.indexOf("#") + 1)] === undefined);
      expect(missing, `${path} covers parts that are not exported: ${missing.join(", ")}`).toEqual([]);

      const tree = family.render(parts);

      // The closed surface first — a trigger that is named and honestly says it
      // owns nothing yet — then the open one, reached by the gesture a reader
      // would make rather than by a `forceMount` that skips it.
      await audit(tree, { requiresControl: false, requiresShows: false });
      if (family.interact) {
        await audit(tree, { requiresControl: false, requiresShows: false, interact: family.interact });
      }

      // And every covered part has to *contribute* to the open surface. The tree
      // is mounted, the same gesture performed, and each `appears` asked of the
      // document — so a part deleted from `render` while its key stayed in
      // `covers`, the one way coverage can silently stop judging anything, fails
      // here rather than passing quietly.
      const ui = mountSurface(tree, { providers: "theme+tooltip" });
      if (family.interact) await family.interact(ui);
      const absent = family.covers.filter((part) => !part.appears(document.body));
      expect(
        absent.map((part) => part.key),
        `${path}: these covered parts contributed nothing to the surface`,
      ).toEqual([]);
    });
  });
});

/**
 * The state rules above only fire on a control that *owns* a region — which
 * means they cannot see a disclosure that was rewritten to own nothing at all.
 * These two assertions are the other half: the controls the app has are asked
 * directly whether they state their state, so deleting the attribute fails here
 * rather than quietly shrinking what the audit has to check.
 */
describe("the app's disclosures", () => {
  test("each says whether the region it owns is open", async () => {
    const { MainNav } = await import("@/components/layout/main-nav");
    const ui = mountSurface(<MainNav />);

    const bell = ui.container.querySelector<HTMLElement>('[aria-controls="notification-panel"]');
    // The bell is what this reads, so the bell is what it waits for: a sleep
    // long enough today is one that is too short on a busy machine.
    await ui.waitFor(() => bell !== null, {
      description: "the nav to render a bell that names its panel",
    });
    expect(bell, "the account bar renders a bell that names its panel").not.toBeNull();
    expect(bell!.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("notification-panel")).toBeNull();

    await ui.click(bell!);
    expect(bell!.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("notification-panel")).not.toBeNull();

    const menu = ui.container.querySelector<HTMLElement>('[aria-controls="mobile-nav"]');
    expect(menu, "the nav renders a menu button that names its panel").not.toBeNull();
    expect(menu!.getAttribute("aria-expanded")).toBe("false");
  });
});

/**
 * What a menu does beyond rendering: it opens, it closes, and it can be chosen
 * from — the half of its behaviour a rendered audit cannot see.
 *
 * Leaving a menu happens three ways, and each is a promise to the reader:
 * Escape closes it, a press on the page behind it closes it, and choosing an
 * option closes it. In all three, focus returns to the control that opened it
 * rather than dropping to the top of the page and making the reader find their
 * place again — and a choice is *taken up*, which the picker says by renaming
 * itself. Opened by a real pointer press and closed by a real gesture
 * throughout, which is why `press` and the pointer helpers are worth keeping.
 */
describe("the app's menus", () => {
  /**
   * Open the menu a control owns, by the pointer press Radix listens for, and
   * wait until it is on screen. Every case below starts here, so each one says
   * only what it asserts about what happens next.
   */
  async function openMenu(ui: MountedSurface, trigger: HTMLElement) {
    await ui.pointerDown(trigger);
    await ui.waitFor(() => document.querySelector('[role="menu"]') !== null, {
      description: "the menu to open",
    });
    return document.querySelector<HTMLElement>('[role="menu"]')!;
  }

  /**
   * The nav, mounted with its account menu's trigger found but not yet opened —
   * the surface both dismissal cases start from. Mounted as a whole page
   * (`theme+tooltip`), because the menu's contents reach `useTheme`.
   */
  async function mountAccountMenu() {
    const { MainNav } = await import("@/components/layout/main-nav");
    const ui = mountSurface(<MainNav />, { providers: "theme+tooltip" });
    const trigger = ui.container.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
    await ui.waitFor(() => trigger !== null, {
      description: "the nav to render an account menu",
    });
    return { ui, trigger: trigger! };
  }

  test("a menu opened by mouse closes on Escape and hands focus back", async () => {
    const { ui, trigger } = await mountAccountMenu();
    expect(trigger.getAttribute("aria-expanded"), "the menu starts shut").toBe("false");
    expect(document.querySelector('[role="menu"]'), "nothing is on screen yet").toBeNull();

    // Sent on the menu's own control rather than on the trigger: while it is
    // open Radix has moved focus into it, and that is where a reader pressing
    // Escape would be. The event bubbles to the layer that dismisses it.
    const menu = await openMenu(ui, trigger);
    await ui.press(menu, "Escape");

    await ui.waitFor(() => trigger.getAttribute("aria-expanded") === "false", {
      description: "the account menu to close",
    });
    expect(document.querySelector('[role="menu"]'), "the menu is gone").toBeNull();
    // Handing focus back is a frame behind the close, so it is waited for
    // rather than read in the tick the menu left — otherwise the assertion
    // races Radix's own restoration and fails as a flake on a busy machine.
    await ui.waitFor(() => document.activeElement === trigger, {
      description: "focus to return to the trigger",
    });
    expect(document.activeElement, "focus is back on the trigger").toBe(trigger);
  });

  test("a menu opened by mouse closes on a press outside and hands focus back", async () => {
    // A press on the page behind the menu. Sent on the mount's own wrapper, which
    // is outside the menu and outside its trigger — so it is a dismissal rather
    // than a second toggle of the control that opened it.
    const { ui, trigger } = await mountAccountMenu();
    await openMenu(ui, trigger);
    await ui.pointerDown(ui.container);

    await ui.waitFor(() => trigger.getAttribute("aria-expanded") === "false", {
      description: "the account menu to close",
    });
    expect(document.querySelector('[role="menu"]'), "the menu is gone").toBeNull();
    // Handing focus back is a frame behind the close, so it is waited for
    // rather than read in the tick the menu left — otherwise the assertion
    // races Radix's own restoration and fails as a flake on a busy machine.
    await ui.waitFor(() => document.activeElement === trigger, {
      description: "focus to return to the trigger",
    });
    expect(document.activeElement, "focus is back on the trigger").toBe(trigger);
  });

  /**
   * The Page composer, mounted with its picker, and the audience menu opened —
   * the surface the choice and arrow cases share.
   */
  async function openAudienceMenu() {
    stubFetch();
    mocks.navigation.params = new URLSearchParams("");
    mocks.routeParams.username = page.username;
    const { default: PageView } = await import("@/app/(main)/pages/[username]/page");
    const ui = mountSurface(<PageView />, { providers: "theme+tooltip" });
    const picker = () =>
      ui.container.querySelector<HTMLElement>('[aria-label^="Post audience: "]');
    await ui.waitFor(() => picker() !== null, {
      description: "the Page composer's audience picker",
    });
    await openMenu(ui, picker()!);
    return { ui, picker };
  }

  test("the composer's audience menu takes a choice and hands focus back", async () => {
    // The third way out, and the only one that is a decision: choosing an option
    // closes the menu, hands focus back to the picker, and the picker *says* the
    // new audience. None of that is in the markup, so it is asserted here, on
    // the Page composer whose menu the surface cases already open.
    const { ui, picker } = await openAudienceMenu();
    expect(picker()!.getAttribute("aria-label"), "the picker starts on Public").toBe(
      "Post audience: Public",
    );

    const followers = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => (item.textContent ?? "").includes("Followers"),
    );
    if (!followers) throw new Error("the audience menu offered no Followers option");
    await ui.click(followers);

    // The name changing is the choice having been taken up rather than the
    // option merely having been clicked.
    await ui.waitFor(
      () => ui.container.querySelector('[aria-label="Post audience: Followers"]') !== null,
      { description: "the picker to show Followers" },
    );
    expect(document.querySelector('[role="menu"]'), "the menu is gone").toBeNull();
    // As in the two dismissal cases: the choice closing the menu and focus
    // returning to the picker are two steps, and only the first is guaranteed
    // by the wait above.
    await ui.waitFor(() => document.activeElement === picker(), {
      description: "focus to return to the picker",
    });
    expect(document.activeElement, "focus is back on the picker").toBe(picker());
  });

  test("the audience menu walks its options with the arrow keys and stays open", async () => {
    // An arrow key is a walk through the choices, not a choice. Opened by mouse,
    // Radix leaves focus on the menu itself, so the first arrow is what moves it
    // onto an option and a second is what moves it on again — and the menu is
    // still open at the end, because walking is not choosing.
    const { ui } = await openAudienceMenu();
    await ui.press(document.querySelector<HTMLElement>('[role="menu"]'), "ArrowDown");
    await ui.waitFor(
      () => document.activeElement?.getAttribute("role") === "menuitemradio",
      { description: "focus to move onto the first option" },
    );
    const first = document.activeElement as HTMLElement;

    await ui.press(first, "ArrowDown");
    await ui.waitFor(
      () =>
        document.activeElement !== first &&
        document.activeElement?.getAttribute("role") === "menuitemradio",
      { description: "focus to move on to the next option" },
    );
    const second = document.activeElement as HTMLElement;

    expect(first.textContent, "the two options are different").not.toBe(second.textContent);
    expect(document.querySelector('[role="menu"]'), "the menu is still open").not.toBeNull();
  });
});

/**
 * A surface that reads a canned endpoint and renders nothing of what came back.
 *
 * It is the shape of a page before anyone has said what its data is: a control
 * and a request, and no statement about what the answer puts on screen. Used to
 * prove the audit refuses it rather than judging it on the weaker checks.
 */
function ReadsCannedData() {
  useEffect(() => {
    void fetch("/api/marketplace");
  }, []);
  return <button type="button">Sign in</button>;
}

/**
 * The readiness guard is only worth having if removing it turns this suite red.
 *
 * It is a claim about what was *not* found — "no control here is nameless" is
 * true of a document with no controls at all — so it is the kind of check that
 * can be dropped, or quietly relaxed to `>= 0`, and keep passing everything.
 * These cases point `audit` at a surface that rendered nothing, at one whose
 * data never arrived, at one whose data is on the page but outside the surface,
 * and at one that read data but never declared `shows` — the states the guard
 * refuses, so each fails here if its check stops failing. The one about data
 * elsewhere also fails if the data check widens back to the document, and the
 * last case is the control: the same harness, one named control and the
 * expected string, so a guard that refused everything would fail too.
 */
describe("the audit's readiness guard", () => {
  beforeEach(() => {
    // The surfaces below are fixtures rather than pages, but one of them reads
    // a canned endpoint on purpose, so the stub has to be in place here too.
    stubFetch();
    // Portals are unmounted with their components, but this is the one place
    // the document's emptiness is the subject, so it is stated rather than
    // assumed.
    document.body.replaceChildren();
  });

  test("a surface that rendered nothing cannot pass", async () => {
    await expect(audit(<div />)).rejects.toThrow(/no control was reached/);
  });

  test("even where no control is demanded, an empty surface cannot pass", async () => {
    // The skeletal cases below relax the check to accept text, for pages that
    // are only prose and components that render one thing. That relaxation still
    // cannot be satisfied by nothing.
    await expect(audit(<div />, { requiresControl: false })).rejects.toThrow(
      /neither a control nor any text/,
    );
  });

  test("a surface whose data never arrived cannot pass", async () => {
    // A real, named control, so the second half is what refuses the pass rather
    // than the first: the document has something in it, but not the thing.
    await expect(
      audit(<button type="button">Sign in</button>, { shows: listing.title }),
    ).rejects.toThrow(/data never arrived/);
  });

  test("data elsewhere on the page does not stand in for the surface's own", async () => {
    // The string is on the page — in the document, outside the surface being
    // audited, as a nav label or a second mount would be. Reading the surface
    // rather than the document is the difference between a check that means
    // something and one that passes because the word is somewhere.
    //
    // Removed again in a `finally`: a node left in the body is the DOM leak the
    // scaffolding now fails a test for, and this one is the test's own, not the
    // surface's.
    const elsewhere = document.createElement("p");
    elsewhere.textContent = listing.title;
    document.body.append(elsewhere);
    try {
      await expect(
        audit(<button type="button">Sign in</button>, { shows: listing.title }),
      ).rejects.toThrow(/data never arrived/);
    } finally {
      elsewhere.remove();
    }
  });

  test("a surface that read data must say what it puts on screen", async () => {
    await expect(audit(<ReadsCannedData />)).rejects.toThrow(/declared no `shows`/);
  });

  test("a surface that rendered its data passes", async () => {
    await expect(
      audit(<button type="button">{listing.title}</button>, { shows: listing.title }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The cases above are only a guard on the app if they cover the app.
 *
 * A rendered audit is opt-in by nature — a page nobody wrote a case for is not
 * audited, and it looks exactly like a page that passed. This closes that on
 * both kinds of route the app serves: every `page.tsx` must have a case, and
 * every api `route.ts` must have a test. What is compared is what the
 * filesystem holds against what this file declares, and `routeGaps` does the
 * comparing — exercised below on fixtures as well as on the real app, because a
 * coverage check that cannot be shown to fail for an unlisted route is a green
 * light wired to nothing.
 */
describe("route coverage", () => {
  test("every route the app serves has a case, or a stated reason it does not", () => {
    const { missing, stale } = routeGaps(discoveredRoutes(), audited, new Set(Object.keys(UNCOVERED)));
    expect(
      missing,
      `no audit case and no stated reason in UNCOVERED: ${missing.join(", ")}`,
    ).toEqual([]);
    expect(
      stale,
      `UNCOVERED entries that are no longer gaps — the route is gone, or it now has a case: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  test("every api route handler has a test, or is named in UNTESTED_API", () => {
    const { endpoints, tested } = apiRouteCoverage();
    const { missing, stale } = routeGaps(endpoints, tested, UNTESTED_API);
    expect(
      missing,
      `no test beside the handler and no entry in UNTESTED_API: ${missing.join(", ")}`,
    ).toEqual([]);
    expect(
      stale,
      `UNTESTED_API entries that are no longer gaps — the handler is gone, or it now has a test: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  test("a route with neither a case nor a reason is reported", () => {
    const { missing } = routeGaps(["/feed", "/brand-new"], new Set(["/feed"]), new Set());
    expect(missing).toEqual(["/brand-new"]);
  });

  test("a reason for a route that now has a case is reported as stale", () => {
    const { stale } = routeGaps(["/feed"], new Set(["/feed"]), new Set(["/feed"]));
    expect(stale).toEqual(["/feed"]);
  });

  test("a reason for a route that no longer exists is reported as stale", () => {
    const { stale } = routeGaps(["/feed"], new Set(["/feed"]), new Set(["/gone"]));
    expect(stale).toEqual(["/gone"]);
  });

  test("every page module default-exports what renders, so no page renders nothing", () => {
    // The `page.tsx` glide tells the router this is a route; its *exports* have
    // to make it one. A page that forgot its default export is found by its own
    // source rather than counted as a route that renders nothing.
    const bare = Object.entries(readPageSources())
      .filter(([file, source]) => !moduleExports({ path: file, source }, resolveModule).default)
      .map(([file]) => routePath(file));
    expect(
      bare,
      `page.tsx modules with no default export, so nothing to render: ${bare.join(", ")}`,
    ).toEqual([]);
  });

  test("every api route module exports at least one method handler", () => {
    // The same claim for a handler: `route.ts` is only an endpoint because it
    // exports `GET`/`POST`/… — a misspelt handler is a route that answers
    // nothing, and reading the exports is what says so.
    const silent = Object.entries(readRouteSources())
      .filter(([file, source]) => exportedHttpMethods({ path: file, source }, resolveModule).length === 0)
      .map(([file]) => routePath(file));
    expect(
      silent,
      `route.ts modules exporting no HTTP method handler: ${silent.join(", ")}`,
    ).toEqual([]);
  });

  test("every re-export names a module that exists, so a typo'd path fails loudly", () => {
    const broken = brokenReExports({ ...readPageSources(), ...readRouteSources() }, resolveModule);
    expect(
      broken,
      `route/page modules whose re-export names a module that does not exist: ${broken.join(", ")}`,
    ).toEqual([]);
  });

  test("a re-export whose specifier names no module is reported", () => {
    // The check above is empty while no route re-exports, so it is exercised here
    // on fixtures: only that way is a green run saying anything at all.
    const resolve: ModuleResolver = (specifier, importer) =>
      specifier === "./impl" && importer === "app/route.ts"
        ? { path: "app/impl.ts", source: "export const GET = 1;" }
        : undefined;
    expect(
      brokenReExports({ "app/route.ts": 'export { GET } from "./impl";' }, resolve),
    ).toEqual([]);
    expect(
      brokenReExports({ "app/route.ts": 'export { GET } from "./impls";' }, resolve),
    ).toEqual(["app/route.ts → ./impls"]);
    // A bare package name and a name re-exported without `from` name no module here.
    expect(
      brokenReExports({ "app/route.ts": 'export { x } from "next/server";' }, resolve),
    ).toEqual([]);
    expect(brokenReExports({ "app/route.ts": "export { A, B as C };" }, resolve)).toEqual([]);
  });
});
