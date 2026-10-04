import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mainNavItems } from "@/lib/nav-items";

/**
 * The doors the signed-out nav withholds, proven to bounce.
 *
 * `/feed` is one of them — the Social module's entry, the item the signed-out
 * bottom-nav case pins by its absence (`src/test/rendered-links.test.tsx`).
 * But the routes here are not written down: they are **derived** from the nav
 * itself — every `mainNavItems` entry carrying `requiresAuth` — so the two
 * lists that must agree cannot drift apart. The nav's flag is a promise that
 * a signed-out reader clicking the item would be bounced; the middleware's
 * `protectedRoutes` is where that promise is kept. Neither side imports the
 * other, so the promise is held from outside: this file takes the nav's list
 * as the given and the middleware's *behaviour* as the oracle — no exported
 * constant, no list comparison — so a new flagged module arrives with its
 * bounce asserted automatically, protection removed from a flagged route reds
 * the bounce case, and protection added to an advertised one reds the
 * pass-through case.
 *
 * The chain from a typed URL to a bounce has two links, and the two existing
 * middleware tests each hold one of them with the other mocked away:
 * `src/middleware.test.ts` holds the delegation and the matcher's static
 * skips (with `updateSession` mocked), and
 * `src/utils/supabase/middleware.test.ts` holds the redirect logic (a mocked
 * session, `/feed` named inside a loop of protected paths). What nothing held
 * is the end-to-end shape through the real entry — that the matcher still
 * runs the middleware on the routes the nav omits, and that the real chain
 * answers a signed-out request for each with the redirect to `/login` and a
 * signed-in one with a pass. Both read through `src/middleware.ts` itself
 * here, with only Supabase mocked.
 *
 * Only the matcher's *positive* side is asserted: Next compiles the matcher
 * with its own anchored path semantics, so a raw `RegExp` cannot honestly
 * reproduce its exclusions — but a route the pattern no longer matches
 * anywhere is a route the middleware no longer runs on, and that is the side
 * the doors depend on.
 *
 * The derivation is scoped to `mainNavItems` — the module doors the header,
 * the mobile panel and the bottom bar render. `socialNavItems` is the strip
 * *between* those modules' surfaces, shown only where the middleware already
 * guards; its unflagged `/messages` (a protected route reached from inside
 * protected surfaces) is why its flags mean "which tab is lit", not "what a
 * visitor may browse".
 */

const getUser = vi.fn(async () => ({ data: { user: null as { id: string } | null } }));

const createServerClient = vi.fn(
  (_url: string, _key: string, options: { cookies: { getAll(): unknown; setAll(c: unknown[]): void } }) => {
    // Exercise both handlers as the real client would: read the request's
    // cookies and push a refresh back through `setAll`.
    options.cookies.getAll();
    options.cookies.setAll([{ name: "sb-token", value: "refreshed", options: { path: "/" } }]);
    return { auth: { getUser } };
  },
);

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) =>
    (createServerClient as (...inner: unknown[]) => unknown)(...args),
}));

import { config, middleware } from "./middleware";

/** The doors the nav withholds from a visitor, and the ones it advertises. */
const doors = mainNavItems.filter((item) => item.requiresAuth).map((item) => item.href);
const openDoors = mainNavItems.filter((item) => !item.requiresAuth).map((item) => item.href);

beforeEach(() => {
  getUser.mockClear();
  getUser.mockResolvedValue({ data: { user: null } });
  createServerClient.mockClear();
});

describe("the doors the signed-out nav refuses to advertise", () => {
  it("derives a non-empty door list, and the matcher still runs the middleware on each", () => {
    // Vacuity is the derivation's one failure mode: with no flagged item, this
    // file would loop over nothing and pass. The list-level pins in
    // `nav-items.test.ts` hold the flag itself; this says it again where the
    // loops below need it.
    expect(
      doors.length,
      "no mainNavItems item carries requiresAuth — the door list this file derives is empty",
    ).toBeGreaterThan(0);

    // The link the delegation test cannot see: if an edit exempted a door
    // here, Next would never call the middleware, the bounce below would
    // still pass as a unit case, and the typed URL would land on the page
    // unauthenticated. The protected match is a prefix, so a deep link rides
    // it too.
    const pattern = new RegExp(config.matcher[0]);
    for (const door of [...doors, `${doors[0]}/post-1`]) {
      expect(pattern.test(door), `${door} should reach the middleware`).toBe(true);
    }
  });

  it("every door the nav withholds turns a signed-out reader around to /login", async () => {
    for (const door of [...doors, `${doors[0]}/post-1`]) {
      const response = await middleware(new NextRequest(`http://localhost${door}`));
      expect(response.status, `${door} should bounce a visitor`).toBe(307);
      expect(response.headers.get("location"), `${door} should name the login door`).toBe(
        "http://localhost/login",
      );
    }
  });

  it("every door the nav advertises lets a signed-out reader through", async () => {
    // The reverse half of the promise: the nav advertising a door the
    // middleware bounces is the original broken promise — a link a visitor is
    // offered that turns them away. Marketplace and Jobs are the product's
    // public discovery; if the middleware ever started protecting one while
    // the nav still advertises it, this is the case that says so.
    expect(
      openDoors.length,
      "no open door to check — the main nav lists nothing public",
    ).toBeGreaterThan(0);
    for (const door of openDoors) {
      const response = await middleware(new NextRequest(`http://localhost${door}`));
      expect(response.status, `${door} should let a visitor through`).toBe(200);
      expect(response.headers.get("location"), `${door} should not bounce a visitor`).toBeNull();
    }
  });

  it("a signed-in reader is not caged by the doors", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "member-1" } } });
    for (const door of doors) {
      const response = await middleware(new NextRequest(`http://localhost${door}`));
      expect(response.status, `${door} should pass a member`).toBe(200);
      expect(response.headers.get("location"), `${door} should not redirect a member`).toBeNull();
    }
  });
});
