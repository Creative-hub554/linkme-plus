import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workerd-native SigV4 signer, exercised with WebCrypto's real hashing.
 *
 * The signature itself is pinned through a fixed clock — a request signed at a
 * known date has exactly one serialization — plus the shapes the whole
 * construction exists to guarantee: the bucket path is the virtual-host path
 * (the signed thing, not a URL parameter), the canonical request has the fixed
 * header set an unused payload hash accompanies, and every part of the signed
 * scope comes from the deployment's own variables. The probe results are then
 * about status mapping only: a 200 is health, and every other answer — a 403
 * for wrong credentials included — is one failure shape from outside.
 */
import { checkR2Bucket, signR2HeadRequest } from "./r2-sigv4";

const env = vi.hoisted(() => ({
  R2_ACCOUNT_ID: "acct-123",
  R2_ACCESS_KEY_ID: "key-abc",
  R2_SECRET_ACCESS_KEY: "secret-xyz",
}));

beforeEach(() => {
  Object.assign(process.env, env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signR2HeadRequest", () => {
  it("signs the virtual-host bucket path with the fixed canonical header set", async () => {
    const request = await signR2HeadRequest("my-bucket", new Date("2026-10-21T00:00:00Z"));

    expect(request.method).toBe("HEAD");
    expect(request.url).toBe("https://acct-123.r2.cloudflarestorage.com/my-bucket");
    expect(request.headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(request.headers["x-amz-date"]).toBe("20261021T000000Z");
    expect(request.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=key-abc\/20261021\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("produces a stable signature for a fixed clock and inputs", async () => {
    const first = await signR2HeadRequest("my-bucket", new Date("2026-10-21T00:00:00Z"));
    const second = await signR2HeadRequest("my-bucket", new Date("2026-10-21T00:00:00Z"));

    expect(first.headers.authorization).toBe(second.headers.authorization);
  });

  it("changes the signature when the minute changes", async () => {
    const first = await signR2HeadRequest("my-bucket", new Date("2026-10-21T00:00:00Z"));
    const second = await signR2HeadRequest("my-bucket", new Date("2026-10-21T00:01:00Z"));

    expect(first.headers.authorization).not.toBe(second.headers.authorization);
    expect(second.headers["x-amz-date"]).toBe("20261021T000100Z");
  });

  it("changes the signature with the bucket, the one variable of the path", async () => {
    const first = await signR2HeadRequest("bucket-a", new Date("2026-10-21T00:00:00Z"));
    const second = await signR2HeadRequest("bucket-b", new Date("2026-10-21T00:00:00Z"));

    expect(first.headers.authorization).not.toBe(second.headers.authorization);
    expect(second.url).toContain("/bucket-b");
  });

  it("refuses to sign without the deployment's variables", async () => {
    const before = process.env.R2_ACCOUNT_ID;
    delete (process.env as Record<string, string | undefined>).R2_ACCOUNT_ID;
    try {
      await expect(signR2HeadRequest("my-bucket")).rejects.toThrow("Cloudflare R2 signing is not configured");
    } finally {
      (process.env as Record<string, string | undefined>).R2_ACCOUNT_ID = before;
    }
  });
});

describe("checkR2Bucket", () => {
  function stubFetch(implementation: (input: RequestInfo | URL) => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(implementation));
  }

  it("is healthy on a 200 and measures the round-trip", async () => {
    stubFetch(async () => new Response(null, { status: 200 }));

    const result = await checkR2Bucket("my-bucket");

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps a 403 — wrong credentials — to unreachable, not healthy", async () => {
    stubFetch(async () => new Response(null, { status: 403 }));

    const result = await checkR2Bucket("my-bucket");

    expect(result).toMatchObject({ ok: false, error: "unreachable" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps a 404 for a bucket that is not there to unreachable", async () => {
    stubFetch(async () => new Response(null, { status: 404 }));

    const result = await checkR2Bucket("my-bucket");

    expect(result).toMatchObject({ ok: false, error: "unreachable" });
  });

  it("maps a network failure to unreachable", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await checkR2Bucket("my-bucket");

    expect(result).toMatchObject({ ok: false, error: "unreachable" });
  });

  it("never reports healthy on a non-200 status", async () => {
    for (const status of [301, 400, 403, 404, 500, 503]) {
      stubFetch(async () => new Response(null, { status }));
      const result = await checkR2Bucket("my-bucket");
      expect(result.ok, `status ${status}`).toBe(false);
    }
  });
});
