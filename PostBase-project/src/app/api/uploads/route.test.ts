import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The general-purpose upload route, driven through the handler.
 *
 * The route takes a multipart form and stores the bytes in the same request
 * that carries them — what replaced the two-step presign contract whose browser
 * PUT could never leave the preflight (no CORS headers on the bucket) and
 * whose minting needed S3 credentials the platform binding has replaced. The
 * pins are the contract a client now builds against: the file is validated
 * against its own bytes before storage is touched, the answer carries the
 * `url`/`key` pair the caller records, and the two storage failures stay
 * distinct — a `503` when storage is unconfigured, a `500` (with no `url`)
 * when the object cannot be written.
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
    putObject: vi.fn(async () => {}),
  };
});

import { POST, GET } from "./route";
import { assertStorageConfigured, putObject, MAX_IMAGE_SIZE, MAX_DOCUMENT_SIZE } from "@/lib/r2";

function imageFile(name = "photo.png", type = "image/png") {
  return new File(["photo-bytes"], name, { type });
}

function uploadRequest(file?: File, purpose?: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  if (purpose) form.append("purpose", purpose);
  return new Request("http://localhost/api/uploads", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/uploads", () => {
  it("stores the file under the purpose's folder and answers with the URL to record", async () => {
    const response = await POST(uploadRequest(imageFile(), "avatar"));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.key).toContain("avatars/member-1/");
    expect(payload.url).toBe(`https://test.r2.dev/${payload.key}`);
    expect(payload.contentType).toBe("image/png");
    expect(payload.purpose).toBe("avatar");
    expect(vi.mocked(putObject)).toHaveBeenCalledOnce();
    expect(vi.mocked(putObject)).toHaveBeenCalledWith(
      expect.stringContaining("avatars/member-1/"),
      expect.any(File),
      "image/png",
    );
  });

  it("defaults the purpose to post", async () => {
    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.key).toContain("posts/member-1/");
    expect(payload.purpose).toBe("post");
  });

  it("refuses a request with no file, without reaching storage", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(400);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses a disallowed type before storing it", async () => {
    const response = await POST(uploadRequest(new File(["bytes"], "notes.txt", { type: "text/plain" })));

    expect(response.status).toBe(400);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses a file over the size limit for its type", async () => {
    const oversized = new Uint8Array(MAX_IMAGE_SIZE + 1);
    const response = await POST(
      uploadRequest(new File([oversized], "huge.png", { type: "image/png" }), "post"),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("answers 503, storing nothing, when storage is not configured", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Cloudflare R2 storage is not configured: missing R2_ACCOUNT_ID");
    });

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("not configured");
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("answers 500, with no URL, when the object cannot be written", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(putObject).mockRejectedValueOnce(new Error("network unreachable"));
    try {
      const response = await POST(uploadRequest(imageFile()));

      expect(response.status).toBe(500);
      // No `url` in the body: there is no object behind one, and a client that
      // recorded it would store a dead attachment.
      expect(await response.json()).toEqual({ error: "Failed to upload that file" });
    } finally {
      silence.mockRestore();
    }
  });
});

describe("GET /api/uploads", () => {
  it("publishes the allowed types and the per-kind size ceilings", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.maxSizes).toEqual({
      image: MAX_IMAGE_SIZE,
      video: expect.any(Number),
      document: MAX_DOCUMENT_SIZE,
    });
    expect(payload.purposes).toContain("post");
  });
});
