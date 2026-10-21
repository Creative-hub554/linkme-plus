import { NextResponse } from "next/server";
import { db, withDbRetry } from "@/lib/db";
import { probeStorage } from "@/lib/r2";

/**
 * The smoke-test door: `GET /api/health` answers, without signing in, whether
 * this deployment can currently reach the two backing services a session would
 * exercise — Postgres and R2 storage. Being unauthenticated is the point: a
 * preview (or a cron, or a browser tab) needs one request that tells it whether
 * to look at logs or keep working. The price of that is that the answer carries
 * no provenance: the response names only `ok`/`unreachable`/`unconfigured` and
 * a latency, never a connection string, an endpoint, a bucket region or an
 * error dump, so the public endpoint reveals nothing an anonymous caller could
 * aim anything at.
 *
 * The database check is a `select 1` on the client the request resolves to (the
 * per-request instance the worker's scope hands out, or the module fallback
 * where there is no scope), retried for the same transient network failures a
 * real query would ride through. The storage check is `probeStorage` from
 * `@/lib/r2`: the platform's UPLOADS binding where the runtime carries it (a
 * real head round-trip needing no credentials), else the signed bucket head
 * through the WebCrypto signer — so "the env vars are set" alone is never
 * reported as healthy storage.
 */

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: "unreachable" | "unconfigured";
}

async function checkDatabase(): Promise<CheckResult> {
  const started = performance.now();
  try {
    await withDbRetry(() => db.$client.unsafe("select 1 as ok"), 3);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: "unreachable" };
  }
}

const checkStorage = async (): Promise<CheckResult> => {
  try {
    return await probeStorage();
  } catch {
    // The public endpoint always answers with a shape, never a 500: a probe
    // that throws is one more unreachable, not an unhandled rejection.
    return { ok: false, latencyMs: 0, error: "unreachable" };
  }
};

export async function GET() {
  const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
  const healthy = database.ok && storage.ok;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "unhealthy",
      checks: { database, storage },
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
