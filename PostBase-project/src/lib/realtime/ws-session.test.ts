import { afterEach, describe, expect, test, vi } from "vitest";
import { authenticateWsUpgrade, readSessionAccessToken } from "./ws-session";

/**
 * The handshake's identity: where a `/ws` caller's userId comes from, and the
 * refusals that keep it honest.
 *
 * The cookie shapes here are the ones this project's own browser actually
 * sends — a single `sb-<ref>-auth-token` cookie carrying
 * `base64-<base64url(JSON)>`, and the chunked `.0`/`.1` form a session bigger
 * than the single-cookie size limit splits into. Verification is injected as a
 * fake in most tests (one seam, no auth server in the suite); the last block
 * exercises the real default against a stubbed `fetch`, so the wiring to
 * Supabase's `GET /auth/v1/user` is asserted too.
 */

const PROJECT_REF = "selorshhkdpydjtypgfq";
const COOKIE_KEY = `sb-${PROJECT_REF}-auth-token`;

/** The envelope as `@supabase/ssr` writes it with the default encoding. */
function sessionEnvelope(accessToken: string): string {
  const json = JSON.stringify({ access_token: accessToken, refresh_token: "refresh-1" });
  return `base64-${Buffer.from(json, "utf8").toString("base64url")}`;
}

function sessionCookie(accessToken: string): string {
  return `${COOKIE_KEY}=${sessionEnvelope(accessToken)}`;
}

/** A verifier that stands in for the auth server and records what it was asked. */
function verifier(userId: string | null) {
  return vi.fn(async (_accessToken: string) => userId);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the /ws handshake's verdict", () => {
  test("refuses a caller with no session cookie, without asking the auth server", async () => {
    const verifyUser = verifier("u1");

    const decision = await authenticateWsUpgrade({ cookieHeader: null, verifyUser });

    expect(decision).toEqual({ ok: false, status: 401, message: "Unauthorized" });
    expect(verifyUser).not.toHaveBeenCalled();
  });

  test("refuses a cookie jar with no session in it", async () => {
    const verifyUser = verifier("u1");

    const decision = await authenticateWsUpgrade({
      cookieHeader: `other=1; ${COOKIE_KEY}.flow-abc-code-verifier=xyz`,
      verifyUser,
    });

    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.status).toBe(401);
    expect(verifyUser).not.toHaveBeenCalled();
  });

  test("refuses an envelope that decodes to no access token", async () => {
    const decision = await authenticateWsUpgrade({
      cookieHeader: `${COOKIE_KEY}=not-a-session-at-all`,
      verifyUser: verifier("u1"),
    });

    expect(decision).toEqual({ ok: false, status: 401, message: "Unauthorized" });
  });

  test("refuses when the auth server will not stand behind the token", async () => {
    const decision = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("expired-or-forged"),
      verifyUser: verifier(null),
    });

    expect(decision).toEqual({ ok: false, status: 401, message: "Unauthorized" });
  });

  test("fails closed when verification itself blows up", async () => {
    const decision = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok"),
      verifyUser: vi.fn(async () => {
        throw new Error("auth server unreachable");
      }),
    });

    expect(decision).toEqual({ ok: false, status: 401, message: "Unauthorized" });
  });

  test("admits the session's own id — with or without the client claiming it", async () => {
    const verifyUser = verifier("user-7");

    const unclaimed = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok-123"),
      verifyUser,
    });
    expect(unclaimed).toEqual({ ok: true, userId: "user-7" });

    const agreeing = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok-123"),
      claimedUserId: "user-7",
      verifyUser,
    });
    expect(agreeing).toEqual({ ok: true, userId: "user-7" });

    // And the token that was verified is the one in the cookie, not anything
    // supplied by the caller.
    expect(verifyUser).toHaveBeenCalledWith("tok-123");
  });

  test("refuses a claim on somebody else's id as 403, not as a logged-out visitor", async () => {
    const decision = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok-123"),
      claimedUserId: "user-9",
      verifyUser: verifier("user-7"),
    });

    expect(decision).toEqual({
      ok: false,
      status: 403,
      message: "Session does not match the requested user",
    });
  });
});

describe("the session cookie, in the shapes a browser sends it", () => {
  test("reads the chunked .0/.1 form across the join", async () => {
    const envelope = sessionEnvelope("tok-chunked");
    const cut = Math.floor(envelope.length / 2);
    const cookieHeader = [
      `${COOKIE_KEY}.0=${envelope.slice(0, cut)}`,
      `${COOKIE_KEY}.1=${envelope.slice(cut)}`,
    ].join("; ");

    const verifyUser = verifier("user-7");
    const decision = await authenticateWsUpgrade({ cookieHeader, verifyUser });

    expect(decision).toEqual({ ok: true, userId: "user-7" });
    expect(verifyUser).toHaveBeenCalledWith("tok-chunked");
  });

  test("treats a half-written set of chunks as absent rather than as a session", async () => {
    const envelope = sessionEnvelope("tok-chunked");
    const cut = Math.floor(envelope.length / 2);
    // `.1` exists but `.1`'s predecessor sequence is broken by a missing middle
    // chunk — the library's own reader stops at the first gap, and so do we.
    const cookieHeader = [
      `${COOKIE_KEY}.0=${envelope.slice(0, cut)}`,
      `${COOKIE_KEY}.2=${envelope.slice(cut)}`,
    ].join("; ");

    expect(readSessionAccessToken(cookieHeader)).toBeNull();
  });

  test("accepts the raw-JSON encoding the library's other mode writes", async () => {
    const raw = JSON.stringify({ access_token: "tok-raw", refresh_token: "r" });

    expect(readSessionAccessToken(`${COOKIE_KEY}=${raw}`)).toBe("tok-raw");
  });

  test("ignores everything else in the cookie jar", () => {
    expect(readSessionAccessToken("theme=dark; locale=en")).toBeNull();
    expect(readSessionAccessToken(null)).toBeNull();
    expect(readSessionAccessToken("")).toBeNull();
  });
});

describe("the default verification, against a stubbed auth server", () => {
  const config = {
    supabaseUrl: "https://example-project.supabase.co",
    supabaseAnonKey: "anon-key",
  };

  test("sends the cookie's token to /auth/v1/user and believes the answer", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "user-42", aud: "authenticated", role: "authenticated" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const decision = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok-real"),
      config,
    });

    expect(decision).toEqual({ ok: true, userId: "user-42" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example-project.supabase.co/auth/v1/user");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-real");
    expect(headers.apikey).toBe("anon-key");
  });

  test("treats the auth server's refusal as no session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 401, msg: "invalid JWT" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const decision = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok-forged"),
      config,
    });

    expect(decision).toEqual({ ok: false, status: 401, message: "Unauthorized" });
  });

  test("refuses closed — and says why — when the Supabase coordinates are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const decision = await authenticateWsUpgrade({
      cookieHeader: sessionCookie("tok"),
      config: {},
    });

    expect(decision).toEqual({ ok: false, status: 401, message: "Unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
