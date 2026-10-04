// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, type MountedSurface } from "@/test/render";
import { stubFetch as stubFetchEndpoints, type FetchRecorder } from "@/test/stub-fetch";

/**
 * The cover studio's new home, judged where it now lives.
 *
 * It used to be `/cover-studio`, a destination in the main navigation beside
 * Marketplace and Jobs — which made a member's own cover look like a module of
 * the app. It is a tab of the profile now, and two things about that are worth
 * pinning: that the tab opens it, and that the tab is only there on your own
 * profile. The studio writes *your* cover, so on somebody else's it would be a
 * door into the wrong room.
 */
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(""),
  routeParams: {} as Record<string, string>,
  router: { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} },
  user: { id: "user-1", email: "theo@example.com", name: "Theo Wu" },
}));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.routeParams,
  useRouter: () => mocks.router,
  usePathname: () => "/profile",
  useSearchParams: () => mocks.params,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: mocks.user }),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ session: { user: mocks.user }, loading: false, user: mocks.user }),
  signOut: () => {},
}));

// The profile subscribes to its own Realtime channel; the socket is setup rather
// than subject here, so it is replaced the same way the a11y file replaces it.
vi.mock("@/utils/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return {
    createClient: () => ({
      channel: () => channel,
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }) },
    }),
  };
});

const PROFILE = {
  id: "user-1",
  username: "theo_wu",
  displayName: "Theo Wu",
  bio: "Builds things",
  avatarUrl: null,
  coverUrl: null,
  coverVideoUrl: null,
  coverConfig: null,
  followerCount: 2,
  followingCount: 3,
  postCount: 0,
  isFollowing: false,
};

/** The member whose profile is being asked for, which is not always the viewer. */
const OTHER = { ...PROFILE, id: "user-2", username: "maya_designs", displayName: "Maya Chen" };

function stubFetch(): FetchRecorder {
  return stubFetchEndpoints({
    "/api/users": (request) => {
      const askedFor = request.query.get("id") ?? request.query.get("user");
      return { user: askedFor === mocks.user.id ? PROFILE : OTHER };
    },
    "/api/posts": { data: [], pagination: { nextCursor: null } },
  });
}

async function renderProfile() {
  const { default: ProfilePage } = await import("@/app/(main)/profile/page");
  const ui = mountSurface(<ProfilePage />);
  // The tab bar is the profile having rendered: it is the header, and the header
  // is drawn from the session rather than from an answer.
  await ui.waitFor(
    () => ui.container.querySelector("nav[aria-label='Profile sections']") !== null,
    { description: "the profile header to render" },
  );
  return ui;
}

/** The tab whose own words are these, or `null` when there is none. */
function tabReading(ui: MountedSurface, label: string) {
  return (
    [...ui.container.querySelectorAll("nav[aria-label='Profile sections'] button")].find(
      (button) => (button.textContent ?? "").trim() === label,
    ) as HTMLElement | undefined
  );
}

/**
 * Wait until the studio itself is on screen, rather than assuming it landed in
 * the same render as the click that asked for it.
 *
 * Today the studio mounts synchronously — a tab is a `setState`, and `click()`
 * flushes it inside `act()` — so this returns on the first poll. It is written
 * as a wait anyway because the assertion that follows is about something
 * *arriving*: if the studio is ever code-split, moved behind a Suspense boundary,
 * or gated on a request, a test that asserted straight after the click would go
 * on passing until the machine was busy and then fail as a flake. Waiting on the
 * header text makes that dependency explicit and keeps the test honest either way.
 */
async function waitForStudio(ui: MountedSurface) {
  await ui.waitFor(() => (ui.container.textContent ?? "").includes("LinkMe+ Cover Studio"), {
    description: "the cover studio to render",
  });
}

afterEach(() => {
  // Unmount before the body is cleared: a portal is a child of the body, and
  // emptying the body first makes React's own teardown throw.
  cleanupSurfaces();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  mocks.params = new URLSearchParams("");
});

describe("the profile's cover studio tab", () => {
  test("opens the studio where the member's own cover is", async () => {
    stubFetch();
    const ui = await renderProfile();
    const tab = tabReading(ui, "Cover studio");
    expect(tab, "the owner's profile offers the Cover studio tab").not.toBeUndefined();
    expect(tab!.getAttribute("aria-current")).toBeNull();

    await ui.click(tab as HTMLElement);

    // The studio's own header copy: the tab is a section, and the section is
    // the studio rather than a link to it.
    await waitForStudio(ui);
    expect(tabReading(ui, "Cover studio")!.getAttribute("aria-current")).toBe("page");
  });

  test("opens on the address the old studio route forwards to", async () => {
    // `/cover-studio` is a `redirect("/profile?tab=cover")` now, so this is what
    // a bookmark of the old address actually renders.
    mocks.params = new URLSearchParams("tab=cover");
    stubFetch();
    const ui = await renderProfile();
    await waitForStudio(ui);
  });

  test("is not offered on somebody else's profile, and the address cannot open it", async () => {
    // Another member's profile, asked for the cover tab directly. The studio
    // writes the signed-in member's cover, so the parameter is refused rather
    // than opening a section the tab bar does not offer.
    mocks.params = new URLSearchParams("user=user-2&tab=cover");
    stubFetch();
    const ui = await renderProfile();
    expect(tabReading(ui, "Cover studio"), "a stranger's profile offered the studio").toBeUndefined();
    expect(ui.container.textContent).not.toContain("LinkMe+ Cover Studio");
    // The sections that describe the member whose profile this is remain.
    expect(tabReading(ui, "Posts")).not.toBeUndefined();
  });
});
