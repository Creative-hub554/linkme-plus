import handler from "vinext/server/app-router-entry";
import { runWithDb } from "../src/lib/db";

// The Durable Object class must be exported from the Worker entry for
// wrangler.jsonc's `WebSocketRoom` binding to resolve; nothing else imports it.
export { WebSocketRoom } from "../src/lib/durable-objects/websocket-room";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // A Worker request may not reuse sockets opened by an earlier request, so
    // the database client is scoped to this request instead of living in a
    // module-level pool (see src/lib/db/index.ts).
    return runWithDb(() => handler.fetch(request, env, ctx));
  },
};

export default worker;
