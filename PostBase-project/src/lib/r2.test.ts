import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The storage probe's two transports, in isolation from the health route.
 *
 * `probeStorage` is the health endpoint's storage check, and its order is the
 * point: when the platform's UPLOADS binding is registered (every hosted
 * runtime) the probe is a `head` against a key no object occupies — no
 * credential is read and nothing out of the bucket's S3 API is consulted at
 * all. Only a runtime without a binding falls back to the signed bucket `HEAD`
 * with the deployment's own S3 credentials, and even there the answer keeps the
 * public endpoint's shape: `ok`/`unreachable`/`unconfigured` and a latency.
 */

vi.mock("@/lib/r2-sigv4", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2-sigv4")>();
  return {
    ...actual,
    checkR2Bucket: vi.fn(),
  };
});

import { BUCKET_NAME, probeStorage } from "./r2";
import { checkR2Bucket } from "./r2-sigv4";
import { setWorkerR2Bucket, workerR2Bucket } from "./r2-bucket";

const env = vi.hoisted(() => ({
  R2_ACCOUNT_ID: "acct-123",
  R2_ACCESS_KEY_ID: "key-abc",
  R2_SECRET_ACCESS_KEY: "secret-xyz",
}));

const probe = checkR2Bucket as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // The credential path needs the deployment's variables, read at call time;
  // tests that remove them restore through `before` below.
  Object.assign(process.env, env);
  probe.mockResolvedValue({ ok: true, latencyMs: 12 });
});

describe("probeStorage", () => {

  it("probes the binding first — one head, no signature, no credential read", async () => {
    const head = vi.fn(async () => null);
    const before = workerR2Bucket();
    setWorkerR2Bucket({ head });
    try {
      const result = await probeStorage();

      expect(result.ok).toBe(true);
      expect(head).toHaveBeenCalledTimes(1);
      expect(probe).not.toHaveBeenCalled();
    } finally {
      setWorkerR2Bucket(before);
    }
  });

  it("answers unreachable when the binding round-trip fails", async () => {
    const head = vi.fn(async () => {
      throw new Error("binding refused");
    });
    const before = workerR2Bucket();
    setWorkerR2Bucket({ head });
    try {
      const result = await probeStorage();

      expect(result).toEqual(expect.objectContaining({ ok: false, error: "unreachable" }));
      expect(probe).not.toHaveBeenCalled();
    } finally {
      setWorkerR2Bucket(before);
    }
  });

  it("falls back to the signed bucket head — with the configured bucket — when no binding is registered", async () => {
    const before = workerR2Bucket();
    setWorkerR2Bucket(undefined);
    try {
      const result = await probeStorage();

      expect(result.ok).toBe(true);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe.mock.calls[0]![0]).toBe(BUCKET_NAME);
    } finally {
      setWorkerR2Bucket(before);
    }
  });

  it("carries the signed probe's failure through as unreachable", async () => {
    const before = workerR2Bucket();
    setWorkerR2Bucket(undefined);
    probe.mockResolvedValue({ ok: false, latencyMs: 4, error: "unreachable" });
    try {
      const result = await probeStorage();

      expect(result).toEqual(expect.objectContaining({ ok: false, error: "unreachable" }));
    } finally {
      setWorkerR2Bucket(before);
    }
  });

  it("answers unconfigured, not unreachable, when no transport is available at all", async () => {
    const before = workerR2Bucket();
    setWorkerR2Bucket(undefined);
    const priorAccount = process.env.R2_ACCOUNT_ID;
    delete (process.env as Record<string, string | undefined>).R2_ACCOUNT_ID;
    try {
      const result = await probeStorage();

      expect(result).toEqual(expect.objectContaining({ ok: false, error: "unconfigured" }));
      expect(probe).not.toHaveBeenCalled();
    } finally {
      setWorkerR2Bucket(before);
      (process.env as Record<string, string | undefined>).R2_ACCOUNT_ID = priorAccount;
    }
  });

  it("answers unreachable when the signed probe throws", async () => {
    const before = workerR2Bucket();
    setWorkerR2Bucket(undefined);
    probe.mockRejectedValue(new Error("signer exploded"));
    try {
      const result = await probeStorage();

      expect(result).toEqual(expect.objectContaining({ ok: false, error: "unreachable" }));
    } finally {
      setWorkerR2Bucket(before);
    }
  });
});
