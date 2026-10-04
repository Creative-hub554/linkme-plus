import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The image-processing route, driven through the handler up to the point sharp
 * would run.
 *
 * Three things are worth pinning before any pixels are touched. The `key` is a
 * client-supplied object path this route both reads and writes beside, so it must
 * be the caller's own (`posts/member-1/…`): a key under another member's folder,
 * or one too short to hold a member segment, is refused `403` **before** the
 * object is fetched — the route would otherwise be a cross-tenant read oracle
 * and a way to write derived assets into somebody else's prefix. A key that
 * names no object is its own answer — `404 File not found` — rather than the
 * generic `500` a thrown SDK error would give; that distinction is the difference
 * between "you asked for something that is not there" and "we broke", and nothing
 * else in the route draws it. And a `send` that *fails* is a `500`, with nothing
 * written: the derived-size assets are created inside the loop, so a failure
 * before the loop must not leave a partial set behind. Storage that is not
 * configured is the last path, a `503`.
 *
 * `r2Client` is replaced by a bare `{ send }` so the route's `GetObjectCommand`
 * is never actually sent; the real client, `BUCKET_NAME`, `IMAGE_SIZES` and
 * `getPublicUrl` are kept so the code under test is the route's own.
 */
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: "member-1" } }),
    },
  },
}));

const r2 = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    assertStorageConfigured: vi.fn(),
    putObject: vi.fn(async () => {}),
    r2Client: { send: r2.send },
  };
});

import { POST } from "./route";
import { assertStorageConfigured, putObject } from "@/lib/r2";

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/media/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/media/process", () => {
  it("refuses a request with no key, reading nothing", async () => {
    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(r2.send).not.toHaveBeenCalled();
  });

  it("refuses a non-string key, reading nothing", async () => {
    const response = await POST(jsonRequest({ key: 123 }));

    expect(response.status).toBe(400);
    expect(r2.send).not.toHaveBeenCalled();
  });

  it("refuses a key under another member's folder, reading nothing", async () => {
    const response = await POST(jsonRequest({ key: "posts/member-2/photo.png" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You can only process your own uploads" });
    // Refused before storage is touched at all: no fetch, no derived write, and
    // not even the configuration assertion — the key is checked first.
    expect(r2.send).not.toHaveBeenCalled();
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expect(vi.mocked(assertStorageConfigured)).not.toHaveBeenCalled();
  });

  it("refuses a key that names no member folder at all", async () => {
    // Too short to hold a member segment, or a traversal that never resolves to
    // the caller's own folder: each is refused rather than treated as the
    // caller's.
    for (const key of ["photo.png", "posts/photo.png", "posts/../member-1/photo.png"]) {
      const response = await POST(jsonRequest({ key }));

      expect(response.status, key).toBe(403);
    }
    expect(r2.send).not.toHaveBeenCalled();
  });

  it("answers 404 when the key names no object", async () => {
    // A successful send whose body is empty is how a missing object arrives here.
    r2.send.mockResolvedValueOnce({});

    const response = await POST(jsonRequest({ key: "posts/member-1/gone.png" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "File not found" });
    // Nothing derived is written for an object that is not there.
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("answers 500, writing nothing, when fetching the object fails", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    r2.send.mockRejectedValueOnce(new Error("access denied"));
    try {
      const response = await POST(jsonRequest({ key: "posts/member-1/secret.png" }));

      expect(response.status).toBe(500);
      expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    } finally {
      silence.mockRestore();
    }
  });

  it("answers 503, reading nothing, when storage is not configured", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Cloudflare R2 storage is not configured: missing R2_BUCKET_NAME");
    });

    const response = await POST(jsonRequest({ key: "posts/member-1/photo.png" }));

    expect(response.status).toBe(503);
    expect(r2.send).not.toHaveBeenCalled();
  });
});
