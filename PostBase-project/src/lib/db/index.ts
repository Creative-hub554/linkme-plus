import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '"' || first === "'") && last === first
    ? trimmed.slice(1, -1)
    : trimmed;
}

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const configuredConnectionString = normalizeEnvValue(runtimeEnv.DATABASE_URL);

if (!configuredConnectionString) {
  throw new Error("DATABASE_URL is not configured");
}

function applyTransactionPooler(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    // Local development should use Supabase's transaction pooler. The session
    // pooler on 5432 frequently refuses long-lived desktop-dev connections.
    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "5432") {
      url.port = "6543";
      return url.toString();
    }
  } catch {
    // Let postgres-js report malformed connection strings with its normal error.
  }
  return connectionString;
}

const connectionString = applyTransactionPooler(configuredConnectionString);

// Supavisor tears down idle pools after ~2 minutes and can silently drop
// sockets. A single connection (max: 1) means one stuck connect attempt
// blocks every other query behind it, so keep a small pool and recycle
// connections before they can go stale. Prepared statements stay off
// (required by transaction poolers).
function createClient() {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 15,
    max_lifetime: 300,
    connect_timeout: 10,
    prepare: false,
  });
}

type AppDb = ReturnType<typeof createDb>;

function createDb() {
  return drizzle(createClient(), { schema });
}

// Cloudflare Workers invalidate a TCP socket when the request that opened it
// ends, so a module-level pool works only for the first request in an isolate
// and every later query fails with "Cannot perform I/O on behalf of a different
// request". Each request therefore gets its own client, published through
// AsyncLocalStorage: `runWithDb` opens the scope in the Worker fetch handler,
// and the `db` proxy below resolves the current request's instance. Outside a
// request scope (tests, scripts, the production build) the store is empty and
// the proxy falls back to a module-level instance, which is the behaviour those
// environments have always had.
const requestDb = new AsyncLocalStorage<() => AppDb>();

const fallbackDb = createDb();

export const db: AppDb = new Proxy(fallbackDb, {
  get(_target, property) {
    const instance = (requestDb.getStore() ?? (() => fallbackDb))();
    const value = Reflect.get(instance, property, instance);
    // `$client` is the one function-valued property that must not be bound. It is
    // drizzle's own escape hatch to the driver, and postgres.js's client *is* a
    // function — the tagged template — whose properties (`end`, `unsafe`, `begin`,
    // `listen`) are how it is used; `Function.prototype.bind` returns a function
    // without them. Binding this one therefore made `db.$client.end(...)` throw
    // `db.$client.end is not a function`, which is a script crashing *after* its work
    // has landed: how `npm run db:seed` came to exit 1 over a seed that succeeded, and
    // why the pool's `end` is reached through the proxy at all. Only methods need their
    // receiver, and the driver's client is not one of them.
    if (property === "$client") return value;
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/**
 * Run `operation` with a fresh database client scoped to this request. The
 * client is created lazily on first use so requests that never touch the
 * database (static assets) allocate nothing, and it is never closed explicitly:
 * workerd tears the sockets down with the request context that owns them.
 */
export function runWithDb<T>(operation: () => T): T {
  let instance: AppDb | undefined;
  return requestDb.run(() => (instance ??= createDb()), operation);
}

function hasTransientCode(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(String(candidate.code))) return true;
  if (hasTransientCode(candidate.cause)) return true;
  if (Array.isArray(candidate.errors) && candidate.errors.some(hasTransientCode)) return true;
  return false;
}

/** Retry only network-level database failures; SQL and constraint errors fail fast. */
export async function withDbRetry<T>(operation: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!hasTransientCode(error) || attempt >= attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 500 * 2 ** attempt)));
    }
  }
}
