import type { Plugin } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { RoomHub, type HubSocket } from "./room-hub";
import {
  authenticateWsUpgrade,
  type WsSessionAuthenticator,
  type WsSessionConfig,
} from "./ws-session";

/**
 * `/ws` under `vinext dev`, where there is no Durable Object to answer it.
 *
 * The production door is `WebSocketRoom`, reached through wrangler's binding;
 * development runs the whole app in one Node process — Vite's own — so this
 * plugin takes the upgrade on Vite's HTTP server and runs the same
 * {@link RoomHub} that class does. One protocol, two runtimes, no copy of the
 * rules to keep in step.
 *
 * The door itself is the same in both: the handshake must carry a valid
 * Supabase session cookie, and the `userId` in the query may only be the
 * session's own — checked by {@link authenticateWsUpgrade}, the exact function
 * `worker/index.ts` runs in production. Here the refusal is an HTTP status
 * line written to the raw socket, because no WebSocket exists yet to close.
 *
 * Vite's HMR socket is listening on the same event: it only acts on its own
 * `vite-hmr` subprotocol at its own path, and this handler only acts on
 * `/ws`, so each leaves the other's upgrades alone.
 */
export interface DevWebSocketOptions {
  /** Supabase coordinates for the real check, fed from Vite's loaded env. */
  supabase?: WsSessionConfig;
  /** The check itself; tests inject a fake so no test reaches an auth server. */
  authenticate?: WsSessionAuthenticator;
}

export function devWebSocketPlugin(options: DevWebSocketOptions = {}): Plugin {
  const authenticate = options.authenticate ?? authenticateWsUpgrade;
  return {
    name: "dev-websocket-hub",
    configureServer(server) {
      const hub = new RoomHub();
      const wss = new WebSocketServer({ noServer: true });
      const httpServer = server.httpServer;
      if (!httpServer) return;

      httpServer.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== "/ws") return;

        void (async () => {
          const decision = await authenticate({
            cookieHeader: request.headers.cookie ?? null,
            claimedUserId: url.searchParams.get("userId"),
            config: options.supabase,
          });
          if (!decision.ok) {
            const status = decision.status === 401 ? "401 Unauthorized" : "403 Forbidden";
            socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
            return;
          }

          wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
            const room = url.searchParams.get("room") || "global";
            const adapter: HubSocket = {
              send: (data) => ws.send(data),
            };
            // The id the hub records is the session's, never the query's —
            // the two were only allowed to agree, not to differ.
            hub.connect(adapter, decision.userId, room);
            ws.on("message", (data) => hub.receive(adapter, data.toString()));
            ws.on("close", () => hub.close(adapter));
            ws.on("error", () => hub.close(adapter));
          });
        })().catch(() => {
          socket.destroy();
        });
      });
    },
  };
}
