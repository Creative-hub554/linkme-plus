import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The post media upload, driven through the handler, with an eye on what happens
 * when storage is not there.
 *
 * This is the path the composer's attachments actually take (`/api/posts/media`,
 * not the presigned `/api/uploads`, because the bucket sends no CORS headers for
 * a browser PUT). The route has two distinct storage failures and they are
 * answered differently on purpose: storage that is **not configured** is a `503`
 * with the configuration message, while a `putObject` that fails is a `500` with
 * a plain one — and in neither case is a URL reported, because there is no object
 * behind it. A client that recorded a URL from a failed upload would store a dead
 * attachment, the same reason a `blob:` URL is never persisted.
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

import { POST } from "./route";
import { assertStorageConfigured, putObject } from "@/lib/r2";

function imageFile(name = "photo.png", type = "image/png") {
  return new File(["photo-bytes"], name, { type });
}

function uploadRequest(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/posts/media", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/posts/media", () => {
  it("stores the file and answers with the URL the post should record", async () => {
    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(201);
    const payload = await response.json();
    // Keyed by the member under the post folder, and the public URL is the one
    // the post is told to store — never a blob or a local path.
    expect(payload.key).toContain("posts/member-1/");
    expect(payload.url).toBe(`https://test.r2.dev/${payload.key}`);
    expect(payload.type).toBe("image/png");
    expect(vi.mocked(putObject)).toHaveBeenCalledOnce();
  });

  it("refuses a request with no file, without reaching storage", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(400);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses a disallowed type before storing it", async () => {
    const response = await POST(uploadRequest(imageFile("notes.txt", "text/plain")));

    expect(response.status).toBe(400);
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("answers 503, storing nothing, when storage is not configured", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Cloudflare R2 storage is not configured: missing R2_BUCKET_NAME");
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
