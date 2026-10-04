// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface, withSurfaceProviders } from "@/test/render";
import {
  json,
  stubFetch as stubFetchEndpoints,
  type FetchRecorder,
} from "@/test/stub-fetch";
import { useTheme } from "@/components/providers/theme-provider";
import { ThemeSync } from "@/components/providers/theme-sync";
import { ACCENT_STORAGE_KEY } from "@/lib/theme";

/**
 * The wiring, not the rule.
 *
 * `theme.test.ts` settles *which* accent wins when the two places disagree; this
 * settles that the winner is then actually applied, that the loser is actually
 * sent, and — the case nothing else can reach — that signing out lets go of it.
 * That last one cannot be exercised by hand: signing out of the running app
 * ends the session the preview browser is using, and there is no way back in.
 *
 * The session is the only stub. `ThemeProvider` is the real one and the accent
 * is read back out of its context, so what is asserted is the value that would
 * reach `<html>`, and the browser's storage is the one `setup.ts` installs.
 */
const state = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    user: state.user,
    isAuthenticated: state.user !== null,
    isLoading: false,
  }),
}));

/** Reads the applied accent back out of the provider. */
function AccentProbe() {
  const { accent } = useTheme();
  return <span data-testid="accent">{accent}</span>;
}

function surface() {
  return (
    <>
      <ThemeSync />
      <AccentProbe />
    </>
  );
}

function accentOf(ui: ReturnType<typeof mountSurface>) {
  return ui.container.querySelector('[data-testid="accent"]')?.textContent ?? null;
}

/** Every request the sync made, so "did it publish?" is answerable. */
function stubPreferences(
  handler: (method: string) => { status: number; body: unknown },
): FetchRecorder {
  return stubFetchEndpoints({
    "/api/preferences": (request) => {
      const { status, body } = handler(request.method);
      return json(body, status);
    },
  });
}

beforeEach(() => {
  state.user = { id: "user-1" };
  window.localStorage.clear();
});

afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("ThemeSync", () => {
  test("applies the account's accent over the device's, and caches it", async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "violet");
    const { calls } = stubPreferences(() => ({ status: 200, body: { appearance: { accent: "emerald" } } }));

    const ui = mountSurface(surface(), { providers: "theme" });
    // The accent arrives from the account, so wait for it rather than for a
    // fixed thirty milliseconds: a sleep long enough today is one that is too
    // short on a busy machine or behind a chained request.
    await ui.waitFor(() => accentOf(ui) === "emerald", {
      description: "the account's accent to be adopted",
    });
    expect(accentOf(ui)).toBe("emerald");
    // Cached for the next first paint, which is what keeps a reload from
    // showing the default accent for a frame before the fetch returns.
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("emerald");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("publishes the device's accent when the account has none", async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "violet");
    const { calls } = stubPreferences(() => ({ status: 200, body: { appearance: {} } }));

    const ui = mountSurface(surface(), { providers: "theme" });
    // The publish is a second request, chained behind the read, so the PUT
    // appearing is the whole of what this test waits on.
    await ui.waitFor(() => calls.some((call) => call.method === "PUT"), {
      description: "the device's accent to be published",
    });
    expect(accentOf(ui)).toBe("violet");
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.body).toEqual({ accent: "violet" });
  });

  test("lets the accent go on sign-out, so the next person cannot inherit it", async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "rose");
    const { calls } = stubPreferences(() => ({ status: 200, body: { appearance: { accent: "rose" } } }));

    const ui = mountSurface(surface(), { providers: "theme" });
    expect(accentOf(ui), "the device's stored accent is applied").toBe("rose");

    // Sign out. Without this the next sign-in on this browser would find no
    // account value, and the "publish" branch would put the previous member's
    // accent on *their* profile.
    state.user = null;
    await ui.render(withSurfaceProviders(surface(), "theme"));
    await ui.waitFor(() => accentOf(ui) === "blue", {
      description: "the accent to be let go on sign-out",
    });

    expect(accentOf(ui)).toBe("blue");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("blue");
    // Nothing was sent on sign-out: there is no account to send it to.
    expect(calls.filter((call) => call.method === "PUT")).toEqual([]);
  });

  test("leaves the device's accent alone when the account cannot be read", async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "amber");
    const { calls } = stubPreferences(() => ({ status: 503, body: { error: "temporarily unavailable" } }));

    const ui = mountSurface(surface(), { providers: "theme" });
    // The claim here is an *absence* — nothing is adopted and nothing is
    // published — so there is no arrival to wait for. The GET is fired
    // synchronously on mount, so waiting on it would be no evidence that the
    // 503 was handled at all.
    await ui.settle(30); // settle-on-purpose: an absence, not an arrival
    // Not adopted (there is nothing to adopt) and not published (we do not
    // know whether the account has a value worth keeping).
    expect(accentOf(ui)).toBe("amber");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });
});
