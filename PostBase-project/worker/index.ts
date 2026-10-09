import handler from "vinext/server/app-router-entry";
import { runWithDb } from "../src/lib/db";
import { authenticateWsUpgrade } from "../src/lib/realtime/ws-session";

// The Durable Object class must be exported from the Worker entry for
// wrangler.jsonc's `WebSocketRoom` binding to resolve; nothing else imports it.
export { WebSocketRoom } from "../src/lib/durable-objects/websocket-room";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The WebSocket door belongs to the Durable Object, not to the app: the
    // upgrade never reaches a route, and the instance is named rather than
    // per-room because rooms are names inside one hub — every socket in the
    // deployment shares the object so a presence broadcast can cross rooms.
    //
    // It is also the one door no route guards, so the session check happens
    // right here, before the upgrade goes anywhere: no valid session cookie is
    // a 401, and a cookie belonging to a different member than the `userId` the
    // client asked to speak as is a 403. Only then is the request forwarded —
    // with the query's `userId` *overwritten* by the verified id and the
    // cookie stripped, so the object can present as nobody but the member
    // whose handshake arrived.
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const decision = await authenticateWsUpgrade({
        cookieHeader: request.headers.get("Cookie"),
        claimedUserId: url.searchParams.get("userId"),
        config: {
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
      });
      if (!decision.ok) {
        return new Response(decision.message, { status: decision.status });
      }

      const verifiedUrl = new URL(url);
      verifiedUrl.searchParams.set("userId", decision.userId);
      const headers = new Headers(request.headers);
      headers.delete("Cookie");

      const id = env.WEBSOCKET_ROOM.idFromName("global");
      return env.WEBSOCKET_ROOM.get(id).fetch(
        new Request(verifiedUrl, { method: request.method, headers }),
      );
    }

    // A Worker request may not reuse sockets opened by an earlier request, so
    // the database client is scoped to this request instead of living in a
    // module-level pool (see src/lib/db/index.ts).
    return runWithDb(() => handler.fetch(request, env, ctx));
  },
};

export default worker;
