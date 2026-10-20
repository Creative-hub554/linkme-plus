import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The presigned-upload route, driven through the handler.
 *
 * The browser no longer uses this route — the bucket sends no CORS headers, so a
 * direct PUT is refused, and the browser goes through `/api/posts/media` and its
 * siblings instead. It stays for anything outside a browser, so what it must not
 * do is hand out a signed URL it could not sign: the two storage failures are a
 * `503` when storage is unconfigured and a `500` when signing fails, and neither
 * answers with an `uploadUrl`. The validation in front of them (type, size) is
 * pinned because it is the only thing standing between a caller and a signature
 * for a file the app would never accept.
 */
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: "member-1" } }),
    },
  },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    assertStorageConfigured: vi.fn(),
    getPresignedUploadUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
  };
});

import { POST } from "./route";
import { assertStorageConfigured, getPresignedUploadUrl, ALL_ALLOWED_TYPES } from "@/lib/r2";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/uploads", () => {
  it("returns a signed URL and the key it points at", async () => {
    const response = await POST(
      jsonRequest({
        filename: "photo.png",
        contentType: "image/png",
        purpose: "post",
        // The declared size is required now — it is the length the signature enforces.
        size: 2 * 1024 * 1024,
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.key).toContain("posts/member-1/");
    expect(payload.uploadUrl).toBe(`https://signed.example/${payload.key}`);
    expect(payload.publicUrl).toBe(`https://test.r2.dev/${payload.key}`);
    // The size rides into the signature call: the helper signs Content-Length with it, so the
    // bucket — not this endpoint's trust in a number — is what refuses a differently-sized PUT.
    expect(vi.mocked(getPresignedUploadUrl)).toHaveBeenCalledWith(
      expect.stringContaining("posts/member-1/"),
      "image/png",
      2 * 1024 * 1024,
    );
  });

  it("refuses a request with no size, signing nothing", async () => {
    // A missing size is the shape of an unbounded URL: Content-Length is signed, so nothing
    // signed without one is never minted — the refusal is this endpoint's and nothing else's.
    const response = await POST(
      jsonRequest({ filename: "photo.png", contentType: "image/png", purpose: "post" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Filename, content type and a positive file size are required",
    });
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("refuses sizes that are not positive safe integers, signing nothing", async () => {
    // The helper would throw on these — failing the request with a 500 whose message is an
    // internal invariant — but a caller that declares a broken size is a bad request, named as
    // one, before anything reaches the signer.
    for (const size of [0, -1, 1.5, "two megabytes"]) {
      const response = await POST(
        jsonRequest({ filename: "photo.png", contentType: "image/png", purpose: "post", size }),
      );

      expect(response.status, JSON.stringify({ size })).toBe(400);
      expect(await response.json()).toEqual({
        error: "Filename, content type and a positive file size are required",
      });
    }
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("refuses a request with no filename or content type, signing nothing", async () => {
    const response = await POST(jsonRequest({ filename: "photo.png" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Filename and content type are required" });
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("refuses a disallowed content type, naming the allowed list", async () => {
    const response = await POST(
      jsonRequest({ filename: "script.sh", contentType: "application/x-sh", size: 1024 }),
    );

    expect(response.status).toBe(400);
    // The refusal is the sentence the caller reads: the type is refused, and
    // the allowed list is right there in the message — not a bare 400 a
    // sibling guard's refusal could double for.
    expect(await response.json()).toEqual({
      error: `File type not allowed. Allowed: ${ALL_ALLOWED_TYPES.join(", ")}`,
    });
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("refuses a file over the size limit for its type", async () => {
    const response = await POST(
      jsonRequest({
        filename: "huge.png",
        contentType: "image/png",
        size: 11 * 1024 * 1024,
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("answers 503, signing nothing, when storage is not configured", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID");
    });

    const response = await POST(
      jsonRequest({ filename: "photo.png", contentType: "image/png", size: 2 * 1024 * 1024 }),
    );

    expect(response.status).toBe(503);
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("answers 500, with no uploadUrl, when signing fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error("signing failed"));
    try {
      const response = await POST(
        jsonRequest({ filename: "photo.png", contentType: "image/png", size: 2 * 1024 * 1024 }),
      );

      expect(response.status).toBe(500);
      // No signed URL is better than one that does not work — the caller would
      // push bytes at it and see a failure it could not explain.
      expect(await response.json()).toEqual({ error: "Failed to generate upload URL" });
    } finally {
      silence.mockRestore();
    }
  });
});
