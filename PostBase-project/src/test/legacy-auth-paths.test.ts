import { describe, expect, test, vi } from "vitest";
import { pageComponentModules } from "@/test/module-index";

/**
 * The policy the six legacy auth forwarders were added to serve, held on its own.
 *
 * `rendered-a11y.test.tsx` pins the six *existing* forwarders one by one; this file
 * is the net under them. The risk is not that one of the six drifts — the a11y pins
 * hold that — but that a **seventh** spelling appears and nobody notices it: a new
 * legacy path is easy to add ("we already have a redirect folder") and nothing
 * stops its target from being wherever its author reached for first. So this check
 * does three things:
 *
 * 1. It derives every route the filesystem could possibly carry the family from a
 *    deliberately **wide** matcher (see `looksLikeLegacyAuth`), not from a list, so
 *    `sign-in`, `sign.in`, `SignUp` and `auth/signin` are all swept up without the
 *    roster being asked to imagine them first.
 * 2. It holds that set exactly to `ROSTER` — both halves: a legacy-shaped route
 *    missing from the roster fails (a new variant must be decided, not drift), and
 *    a roster entry the filesystem no longer serves fails too, so an entry cannot
 *    quietly describe a route that was deleted.
 * 3. For every rostered *forwarder* it mounts the page and asserts the redirect it
 *    throws carries the route's declared target — and that the target is one of the
 *    two standalone pages. That is the sentence the request asked for: a new legacy
 *    variant pointing somewhere other than `/login` or `/register` goes red, both
 *    when the target is wrong *and* when it is merely unlisted.
 */

/**
 * The urls a route module serves, read from where it sits rather than from its
 * name — the same structural read `rendered-a11y.test.tsx` makes, restated here so
 * this file's own claims do not depend on importing a test file's internals. A
 * route's url is its *directory*; the leaf filename is dropped, and parenthesised
 * segments — route groups like `(auth)` — are organisation only, so they are
 * filtered out rather than matched with a regex.
 */
function routePath(file: string): string {
  const segments = file.replace(/^..\/app\//, "").split("/");
  segments.pop();
  return `/${segments.filter((segment) => segment !== "" && !segment.startsWith("(")).join("/")}`;
}

/**
 * Whether a route's path could plausibly be a spelling of the auth family.
 *
 * Deliberately wider than the six spellings in `ROSTER`: the path is normalised by
 * lowercasing and stripping `-`, `_` and spaces (so `sign-in`, `SignIn` and
 * `sign_in` all reduce the same way), and any path *containing* one of the family's
 * roots (`signin`, `signup`, `signon`, `login`, `logon`, `register`) matches — so
 * `auth/signin`, `login-screen` or a future `sign-up-v2` are all swept up even
 * though nobody has written them yet, and the roster check below is what demands a
 * decision for each. That is the safe direction for a catch-all: it errs toward
 * naming a route the family has to own. What it cannot see is a root that is not
 * on the list at all — a genuinely novel door (`/entrance`, `/membar`) one human
 * will have to recognise; this file says that plainly rather than pretending the
 * matcher is clairvoyant.
 */
function looksLikeLegacyAuth(route: string): boolean {
  const normalized = route.toLowerCase().replace(/[-_ ]/g, "");
  return ["signin", "signup", "signon", "login", "logon", "register"].some((base) =>
    normalized.includes(base),
  );
}

/**
 * The routes the auth family currently serves, each with its decision recorded.
 *
 * The two standalone pages are the destinations the forwarders may name: they
 * render themselves and are pinned by their own suites, so they carry no forward
 * assertion here — their *existence* in this roster is what makes roster equality
 * mean something. The six forwarders each declare `target`, the exact url the a11y
 * pins hold and this file re-holds through the real `redirect` call.
 */
const ROSTER: Record<string, { target?: string; why: string }> = {
  "/login": { why: "a standalone sign-in page — the destination the sign-in spellings forward to" },
  "/register": {
    why: "a standalone registration page — the destination the sign-up spellings forward to",
  },
  "/signin": { target: "/login", why: "legacy sign-in spelling, kept as a forwarder" },
  "/sign-in": { target: "/login", why: "legacy sign-in spelling, kept as a forwarder" },
  "/auth/login": { target: "/login", why: "legacy sign-in spelling, kept as a forwarder" },
  "/signup": { target: "/register", why: "legacy sign-up spelling, kept as a forwarder" },
  "/sign-up": { target: "/register", why: "legacy sign-up spelling, kept as a forwarder" },
  "/auth/register": { target: "/register", why: "legacy sign-up spelling, kept as a forwarder" },
};

/** The redirect goes through the same seam Next uses, recorded the way the a11y suite records it: pushed, then thrown as an unrenderable stop. The kind travels beside the url so the *code* a forward answers with is held too — 308 for every forwarder here, because these were public spellings whose move search engines must learn once (a regression to `redirect`'s 307 is exactly the regression nothing else would notice). */
const { redirects, kinds } = vi.hoisted(() => ({
  redirects: [] as string[],
  kinds: [] as string[],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    kinds.push("temporary");
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: (url: string) => {
    kinds.push("permanent");
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const pageLoaders = new Map(
  Object.entries(pageComponentModules()).map(([file, load]) => [routePath(file), load]),
);
const legacyShaped = [...pageLoaders.keys()]
  .filter(looksLikeLegacyAuth)
  .sort();

describe("the legacy auth spellings", () => {
  const served = new Set(legacyShaped);
  const rostered = Object.keys(ROSTER);

  const missingFromRoster = legacyShaped.filter((route) => !(route in ROSTER));
  const staleEntries = rostered.filter((route) => !served.has(route));

  /**
   * Exact set equality, said twice so a reader sees which bank the failure is on.
   * Together they are the ratchet: a new spelling cannot join the app without a
   * decision recorded beside its target, and a deleted spelling cannot leave a
   * decision describing a route that no longer exists.
   */
  test("every legacy-shaped route the app serves is on the roster", () => {
    if (missingFromRoster.length > 0) {
      throw new Error(
        `the app now serves auth-shaped route(s) with no decision recorded: ` +
          `${missingFromRoster.join(", ")}. Either make it forward to /login or /register ` +
          `and add it to ROSTER with a target, or record why it is not a forwarder.`,
      );
    }
  });

  test("every rostered spelling is still a route the app serves", () => {
    if (staleEntries.length > 0) {
      throw new Error(
        `ROSTER describes auth-shaped route(s) the filesystem no longer serves: ` +
          `${staleEntries.join(", ")}. Remove the entries, or restore the routes.`,
      );
    }
  });

  test("the roster and the filesystem agree exactly", () => {
    expect(legacyShaped, "the served legacy-shaped route").toEqual(rostered.sort());
  });

  /**
   * Each forwarder, mounted. The assertion runs through the real page module, so
   * this holds the behaviour the router performs: where the redirect goes, not what
   * the file's text says. The double check — target recorded *and* the word the
   * mock puts on the throw present — is what keeps a forwarder whose `redirect`
   * ask was renamed or silenced from passing as green here.
   */
  describe.each(rostered.filter((route) => ROSTER[route].target))(
    "the %s forwarder",
    (route) => {
      const target = ROSTER[route].target as string;

      test(`forwards to ${target}, which the standalone pages serve`, async () => {
        // The target itself is held: a roster entry pointing at a page the app does
        // not serve would strand a reader at a 404, which is a worse outcome than
        // the one the forwarder was written to fix. Inherently wrong if the two
        // destinations ever leave the roster — the set-equality test above reds.
        expect(target in ROSTER && ROSTER[target].target === undefined).toBe(true);

        const load = pageLoaders.get(route);
        if (!load) throw new Error(`no page module was found for ${route}`);
        redirects.length = 0;
        kinds.length = 0;
        // The default export is typed only as `ComponentType`, so the call is made
        // through the signature the forwarder actually has: a no-props function
        // body that calls `redirect` before returning anything.
        const { default: Forwarder } = (await load()) as { default: () => void };
        expect(() => Forwarder()).toThrow(/NEXT_REDIRECT/);
        expect(redirects).toEqual([target]);
        // Answered 308, not 307: these were public spellings — indexed, saved,
        // printed — so the move must be a permanent mapping, and a forward
        // silently re-typed back to `redirect` is the exact regression no url
        // assertion would see.
        expect(kinds).toEqual(["permanent"]);
      });
    },
  );
});
