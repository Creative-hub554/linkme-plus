import handler from "vinext/server/app-router-entry";
import { runWithDb } from "../src/lib/db";
import { createDriveClient, driveConfigFromEnv } from "../src/lib/gdrive";
import {
  createBindingStorage,
  createDbExec,
  createDbStore,
  runArchivePass,
} from "../src/lib/media-archive";
import {
  createEvictionStorage,
  createEvictionStore,
  evictionPrefixes,
  runEvictionPass,
} from "../src/lib/media-eviction";
import { PUBLIC_URL } from "../src/lib/r2";
import { setWorkerR2Bucket } from "../src/lib/r2-bucket";
import { RoomHub, type HubSocket } from "../src/lib/realtime/room-hub";
import { authenticateWsUpgrade } from "../src/lib/realtime/ws-session";

// The Durable Object class must be exported from the Worker entry for
// wrangler.jsonc's `WebSocketRoom` binding to resolve; nothing else imports it.
export { WebSocketRoom } from "../src/lib/durable-objects/websocket-room";

// The `/ws` door without a Durable Object: host a hub in the Worker isolate
// and serve the upgrade straight from `fetch`. Sockets never outlive their
// request, but the hub itself lives as long as the isolate does, and its
// `close` events keep departed members from lingering in the room list —
// so rooms stay correct inside one isolate and simply do not exchange
// presence across isolates. That is the degradation a platform without a
// Durable-Object runtime gets, warned once at startup, not every request.
const inlineHub = new RoomHub({ onPresence: () => {} });
let inlineHubWarned = false;
function serveWebSocketInline(userId: string, room: string): Response {
  if (!inlineHubWarned) {
    inlineHubWarned = true;
    console.warn(
      "[ws] no WEBSOCKET_ROOM binding — serving /ws inline (presence is per-isolate)",
    );
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const socket: HubSocket = { send: (data) => server.send(data) };
  server.addEventListener("message", (event) => {
    inlineHub.receive(socket, event.data as string);
  });
  server.addEventListener("close", () => inlineHub.close(socket));
  inlineHub.connect(socket, userId, room);
  return new Response(null, { status: 101, webSocket: client });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Storage ops resolve the platform's R2 bucket through the binding slot,
    // not through S3-API credentials: a hosted runtime carries no upload
    // credentials, and the binding is the capability the platform gives. The
    // Node fallback (dev server, scripts) reaches storage differently and is
    // configured in `@/lib/r2`'s own comments.
    setWorkerR2Bucket(env.UPLOADS);
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

      const headers = new Headers(request.headers);
      headers.delete("Cookie");

      // The Durable Object room is optional by configuration: the deploy target
      // this repo publishes through provides no Durable-Object runtime, and the
      // binding is absent from wrangler.jsonc on purpose, so its projection onto
      // the Env type is read through the optional lens rather than a declared
      // property that stopped existing.
      const webSocketRoom = (env as { WEBSOCKET_ROOM?: DurableObjectNamespace }).WEBSOCKET_ROOM;
      if (!webSocketRoom) {
        // No Durable Object on this runtime: the same session-verified
        // handshake is answered by the in-isolate hub above.
        return serveWebSocketInline(
          decision.userId,
          url.searchParams.get("room") || "global",
        );
      }

      const verifiedUrl = new URL(url);
      verifiedUrl.searchParams.set("userId", decision.userId);
      return webSocketRoom.get(webSocketRoom.idFromName("global")).fetch(
        new Request(verifiedUrl, { method: request.method, headers }),
      );
    }

    // A Worker request may not reuse sockets opened by an earlier request, so
    // the database client is scoped to this request instead of living in a
    // module-level pool (see src/lib/db/index.ts).
    return runWithDb(() => handler.fetch(request, env, ctx));
  },

  // The media cron (wrangler.jsonc's `17 * * *`), two passes in order:
  //
  // 1. **Eviction** reclaims uploads no post or comment ever referenced —
  //    the files a client uploaded and then never published, and the demo
  //    assets a re-seed stopped pointing at. It runs first because its
  //    grace window is the shorter one: an orphan deleted here never
  //    reaches the archive, which would otherwise ship it to Drive and
  //    keep it there forever.
  // 2. **The archive** moves everything R2 has held for longer than its grace
  //    period to Google Drive, rewrites the database to point at it there,
  //    and leaves the bucket holding only the app's last three days of
  //    uploads.
  //
  // Each pass decides for itself what to do with a half-configured setup —
  // no GDRIVE_* secrets means one log line and nothing moved, no
  // R2_PUBLIC_URL means the eviction pass declines — so deploying this
  // handler is safe before the consent dance has been run.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const driveConfig = driveConfigFromEnv({
      GDRIVE_CLIENT_ID: env.GDRIVE_CLIENT_ID,
      GDRIVE_CLIENT_SECRET: env.GDRIVE_CLIENT_SECRET,
      GDRIVE_REFRESH_TOKEN: env.GDRIVE_REFRESH_TOKEN,
      GDRIVE_FOLDER_ID: env.GDRIVE_FOLDER_ID,
    });

    await runWithDb(async () => {
      await runEvictionPass({
        storage: createEvictionStorage(env.UPLOADS),
        store: createEvictionStore(),
        config: {
          publicUrlBase: PUBLIC_URL,
          // Every folder the pass covers, each derived from the same rule
          // its writers derive their keys with: the post folder for
          // `/api/posts/media` and presigned uploads, the seed folder for
          // the demo seeder — the one putObject caller outside a route.
          prefixes: evictionPrefixes(),
          // 24 hours is a generous publish window for an upload, and it must
          // stay below ARCHIVE_GRACE_DAYS (3) or orphans reach Drive first,
          // where this pass can no longer see them.
          graceHours: countFromEnv(env.EVICT_GRACE_HOURS, 24),
          // Deletes are one call each — far cheaper than the archive's ~15
          // Drive calls per file — so this batch can be larger.
          batchLimit: countFromEnv(env.EVICT_BATCH_LIMIT, 50),
          dryRun: env.EVICT_DRY_RUN === "1" || env.EVICT_DRY_RUN === "true",
          now: new Date(),
        },
        log: (message) => console.log(message),
      });

      return runArchivePass({
        storage: createBindingStorage(env.UPLOADS),
        drive: driveConfig ? createDriveClient(driveConfig) : null,
        store: createDbStore(),
        exec: createDbExec(),
        config: {
          publicUrlBase: PUBLIC_URL,
          graceDays: countFromEnv(env.ARCHIVE_GRACE_DAYS, 3),
          // Ten objects an hour keeps the pass well inside a cron
          // invocation's subrequest and CPU budgets even when every one of
          // them is a 100 MB video; raise it in the secrets to drain a large
          // backlog faster.
          batchLimit: countFromEnv(env.ARCHIVE_BATCH_LIMIT, 10),
          dryRun: env.ARCHIVE_DRY_RUN === "1" || env.ARCHIVE_DRY_RUN === "true",
          now: new Date(),
        },
        log: (message) => console.log(message),
      });
    });
  },
};

/** A positive integer out of an env var, or the default when it is not one. */
function countFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default worker;
