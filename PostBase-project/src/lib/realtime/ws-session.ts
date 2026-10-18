import { createClient } from "@supabase/supabase-js";

/**
 * Who is knocking at `/ws`, decided from the session cookie rather than from
 * anything the client says about itself.
 *
 * Every HTTP door in this app already authenticates through the Supabase
 * session in the request cookies — middleware refreshes it, API routes read it
 * — and `/ws` used to skip all of that: it trusted a `userId` query parameter,
 * so any caller could open a socket that spoke as somebody else. This module is
 * the same question asked of the upgrade itself: which member's session does
 * this handshake carry, verified against the auth server, and does it match the
 * id the client is claiming?
 *
 * It is deliberately runtime-agnostic — no Next, no Vite, no Workers imports —
 * because the same check must run in the two places that answer the door: the
 * Vite plugin in development (Node) and `worker/index.ts` in production
 * (workerd). Both are thin adapters around {@link authenticateWsUpgrade}: one
 * writes an HTTP status line to a raw socket, the other returns a `Response`;
 * the decision itself lives here, once.
 */

/** Supabase coordinates, as they arrive from env in either runtime. */
export interface WsSessionConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

/** The verdict: the verified member, or the HTTP refusal to open the door. */
export type WsSessionDecision =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; message: string };

/** One handshake's worth of evidence. `verifyUser` is a test seam. */
export interface WsSessionCheck {
  /** The raw `Cookie` header of the upgrade request, or null. */
  cookieHeader: string | null;
  /** The `userId` the client asked to speak as, if any. */
  claimedUserId?: string | null;
  config?: WsSessionConfig;
  /** Overrides the network check; tests inject a fake here. */
  verifyUser?: (accessToken: string) => Promise<string | null>;
}

export type WsSessionAuthenticator = (check: WsSessionCheck) => Promise<WsSessionDecision>;

/**
 * The Supabase session cookie's key: `sb-<project-ref>-auth-token`, optionally
 * followed by `.0`, `.1`, … for the chunked form (a session JSON comfortably
 * over the single-cookie size limit splits across chunks — the shape this
 * project's own cookies are in).
 */
const SINGLE_COOKIE = /^(sb-[A-Za-z0-9_-]+-auth-token)$/;
const CHUNKED_COOKIE = /^(sb-[A-Za-z0-9_-]+-auth-token)\.(\d+)$/;

/** A Supabase session as the cookie stores it — only the field we need is typed. */
interface StoredSession {
  access_token?: unknown;
}

function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

/**
 * The session JSON's envelope, exactly as `@supabase/ssr` wrote it: an exact
 * single cookie wins; otherwise chunks `.0`, `.1`, … are joined in order,
 * stopping at the first gap — the same rule the library's own reader uses, so
 * a half-written set of chunks reads as absent rather than as somebody else.
 */
function assembleSessionValue(cookies: Map<string, string>): string | null {
  for (const [name, value] of cookies) {
    if (SINGLE_COOKIE.test(name)) return value;
  }

  const bases = new Map<string, Map<number, string>>();
  for (const [name, value] of cookies) {
    const match = name.match(CHUNKED_COOKIE);
    if (!match) continue;
    const chunks = bases.get(match[1]) ?? new Map<number, string>();
    chunks.set(Number(match[2]), value);
    bases.set(match[1], chunks);
  }
  for (const chunks of bases.values()) {
    let joined = "";
    for (let index = 0; chunks.has(index); index += 1) {
      joined += chunks.get(index);
    }
    if (joined) return joined;
  }
  return null;
}

/** base64url → text, portable across Node, workerd, and the browser alike. */
function decodeBase64Url(input: string): string | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const binary = atob(withPadding);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The envelope → the access token, tolerating both encodings the library has
 * written: `base64-<base64url(JSON)>` (the default today) and raw JSON (the
 * `raw` encoding option). Anything that parses to a string token is accepted
 * here — *accepted*, not trusted: the token itself is verified server-side
 * before any identity is believed.
 */
function readAccessToken(envelope: string): string | null {
  const attempts: Array<() => string | null> = [
    () => {
      const payload = envelope.startsWith("base64-") ? envelope.slice("base64-".length) : envelope;
      return decodeBase64Url(payload);
    },
    () => envelope,
    () => decodeBase64Url(envelope),
  ];
  for (const attempt of attempts) {
    const decoded = attempt();
    if (decoded === null) continue;
    try {
      const session = JSON.parse(decoded) as StoredSession;
      if (typeof session.access_token === "string" && session.access_token) {
        return session.access_token;
      }
    } catch {
      // not this encoding; try the next
    }
  }
  return null;
}

/** The session cookie's access token, straight from a raw `Cookie` header. */
export function readSessionAccessToken(cookieHeader: string | null | undefined): string | null {
  const envelope = assembleSessionValue(parseCookieHeader(cookieHeader));
  if (!envelope) return null;
  return readAccessToken(envelope);
}

/**
 * Ask Supabase who this token really is. The token is sent as an explicit
 * bearer to `GET /auth/v1/user`, which validates its signature and expiry at
 * the auth server — a forged cookie is a forged token and comes back refused.
 *
 * Deliberately *not* `getSession()`: that path can refresh an expired session,
 * and a refresh from here would rotate the refresh token without anywhere to
 * persist it (an upgrade response carries no `Set-Cookie`), quietly risking the
 * browser's own next refresh. An expired access token at the door means 401,
 * and the client's polling fallback keeps the app alive until the middleware
 * refreshes the cookie on the next ordinary request.
 */
async function verifyWithSupabase(
  accessToken: string,
  config: WsSessionConfig,
): Promise<string | null> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(
      "ws-session: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not available; refusing the /ws handshake",
    );
    return null;
  }
  try {
    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * The door's verdict for one upgrade. Fails closed at every branch: no
 * session, a token the auth server won't stand behind, or a verification
 * that throws all end as 401; a session that belongs to someone other than the
 * id being claimed ends as 403 — the two kept distinct so an impersonation
 * attempt is visible in logs as itself, not as a logged-out visitor.
 */
export const authenticateWsUpgrade: WsSessionAuthenticator = async (check) => {
  const accessToken = readSessionAccessToken(check.cookieHeader);
  if (!accessToken) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  const verify =
    check.verifyUser ??
    ((token: string) => verifyWithSupabase(token, check.config ?? {}));

  let userId: string | null = null;
  try {
    userId = await verify(accessToken);
  } catch {
    userId = null;
  }
  if (!userId) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  if (check.claimedUserId && check.claimedUserId !== userId) {
    return {
      ok: false,
      status: 403,
      message: "Session does not match the requested user",
    };
  }

  return { ok: true, userId };
};
