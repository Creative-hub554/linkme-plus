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
import { assertStorageConfigured, getPresignedUploadUrl } from "@/lib/r2";

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
      jsonRequest({ filename: "photo.png", contentType: "image/png", purpose: "post" }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.key).toContain("posts/member-1/");
    expect(payload.uploadUrl).toBe(`https://signed.example/${payload.key}`);
    expect(payload.publicUrl).toBe(`https://test.r2.dev/${payload.key}`);
    expect(vi.mocked(getPresignedUploadUrl)).toHaveBeenCalledOnce();
  });

  it("refuses a request with no filename or content type, signing nothing", async () => {
    const response = await POST(jsonRequest({ filename: "photo.png" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Filename and content type are required" });
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("refuses a disallowed content type", async () => {
    const response = await POST(
      jsonRequest({ filename: "script.sh", contentType: "application/x-sh" }),
    );

    expect(response.status).toBe(400);
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

    const response = await POST(jsonRequest({ filename: "photo.png", contentType: "image/png" }));

    expect(response.status).toBe(503);
    expect(vi.mocked(getPresignedUploadUrl)).not.toHaveBeenCalled();
  });

  it("answers 500, with no uploadUrl, when signing fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPresignedUploadUrl).mockRejectedValueOnce(new Error("signing failed"));
    try {
      const response = await POST(jsonRequest({ filename: "photo.png", contentType: "image/png" }));

      expect(response.status).toBe(500);
      // No signed URL is better than one that does not work — the caller would
      // push bytes at it and see a failure it could not explain.
      expect(await response.json()).toEqual({ error: "Failed to generate upload URL" });
    } finally {
      silence.mockRestore();
    }
  });
});
