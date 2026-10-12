import handler from "vinext/server/app-router-entry";
import { runWithDb } from "../src/lib/db";
import { createDriveClient, driveConfigFromEnv } from "../src/lib/gdrive";
import {
  createBindingStorage,
  createDbExec,
  createDbStore,
  runArchivePass,
} from "../src/lib/media-archive";
import { PUBLIC_URL } from "../src/lib/r2";
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

  // The media archive's hourly pass (wrangler.jsonc's cron, the reason the
  // trigger exists at all): move everything R2 has held for longer than the
  // grace period to Google Drive, rewrite the database to point at it there,
  // and leave the bucket holding only the app's last three days of uploads.
  //
  // The pass decides for itself what to do with a half-configured setup —
  // no GDRIVE_* secrets means one log line and nothing moved — so deploying
  // this handler is safe before the consent dance has been run.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const driveConfig = driveConfigFromEnv({
      GDRIVE_CLIENT_ID: env.GDRIVE_CLIENT_ID,
      GDRIVE_CLIENT_SECRET: env.GDRIVE_CLIENT_SECRET,
      GDRIVE_REFRESH_TOKEN: env.GDRIVE_REFRESH_TOKEN,
      GDRIVE_FOLDER_ID: env.GDRIVE_FOLDER_ID,
    });

    await runWithDb(() =>
      runArchivePass({
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
      }),
    );
  },
};

/** A positive integer out of an env var, or the default when it is not one. */
function countFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default worker;
