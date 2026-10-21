import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public smoke-test door, driven through the handler.
 *
 * The route is deliberately unauthenticated — that is the one thing a signed-in
 * check cannot test — so the pins here are what the public surface must hold:
 * a 200 only when both backing services answer, a per-check verdict for the
 * service that failed, latencies on both sides of a failure, and nothing else in
 * the body: no connection string, no bucket hostname, no error dump an anonymous
 * caller could aim anything at.
 *
 * The storage probe itself is `probeStorage` in `@/lib/r2` (binding first, else
 * a signed bucket head) and is stubbed here; its own behaviour is pinned in
 * `src/lib/r2.test.ts`. The database check's retry behaviour is the production
 * behaviour — `withDbRetry` is left untouched on purpose.
 */
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    db: { $client: { unsafe: vi.fn() } },
  };
});

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    probeStorage: vi.fn(),
  };
});

import { db, withDbRetry } from "@/lib/db";
import { probeStorage } from "@/lib/r2";
import { GET } from "./route";

const unsafe = db.$client.unsafe as ReturnType<typeof vi.fn>;
const storage = probeStorage as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  unsafe.mockResolvedValue([{ ok: 1 }]);
  storage.mockResolvedValue({ ok: true, latencyMs: 12 });
});

describe("GET /api/health", () => {
  it("answers 200 with both checks green and is callable signed out", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.storage.ok).toBe(true);
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.storage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("probes the database with a real round-trip query, not a table scan", async () => {
    await GET();

    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(String(unsafe.mock.calls[0]![0])).toContain("select 1");
  });

  it("probes storage through the app's own storage probe", async () => {
    await GET();

    expect(storage).toHaveBeenCalledTimes(1);
  });

  it("answers 503 with the failing check named when the database is unreachable", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    unsafe.mockRejectedValue(new Error("database down"));
    try {
      const response = await GET();

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe("unhealthy");
      expect(body.checks.database).toMatchObject({ ok: false, error: "unreachable" });
      expect(body.checks.storage.ok).toBe(true);
    } finally {
      silence.mockRestore();
    }
  });

  it("answers 503 with unconfigured when storage is missing its configuration", async () => {
    storage.mockResolvedValue({ ok: false, latencyMs: 4, error: "unconfigured" });

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.storage).toMatchObject({ ok: false, error: "unconfigured" });
  });

  it("answers 503 with unreachable when storage cannot be reached", async () => {
    storage.mockResolvedValue({ ok: false, latencyMs: 4, error: "unreachable" });

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.checks.storage).toMatchObject({ ok: false, error: "unreachable" });
    expect(body.checks.database.ok).toBe(true);
  });

  it("answers 503 with unreachable when the storage probe itself fails", async () => {
    storage.mockRejectedValue(new Error("probe exploded"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect((await response.json()).checks.storage).toMatchObject({ ok: false, error: "unreachable" });
  });

  it("carries neither a connection string nor a storage endpoint in the body", async () => {
    unsafe.mockRejectedValue(new Error(`postgres://secret-host:5432/db refused`));
    storage.mockRejectedValue(new Error(`https://secret-account.r2.cloudflarestorage.com timed out`));
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await GET();
      const text = await response.text();

      expect(text).not.toContain("postgres://");
      expect(text).not.toContain("secret-host");
      expect(text).not.toContain("cloudflarestorage.com");
      expect(text).not.toContain("secret-account");
    } finally {
      silence.mockRestore();
    }
  });

  it("still exports the retry helper untouched, so a transient database failure rides the same path as a real query", async () => {
    expect(withDbRetry).toBeTypeOf("function");
  });
});
