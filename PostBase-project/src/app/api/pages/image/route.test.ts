import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Page image upload, driven through the handler with a real multipart
 * request.
 *
 * This is the wiring the live bucket probe used to stand in for: upload a photo,
 * check the previous object's URL is now 404. What matters here is not that a
 * delete happens but *which* URL is offered — the one the upload displaced, read
 * from the row before the write — and that an upload by a non-admin is refused
 * before the object is ever written.
 *
 * The seams are the same as `../route.test.ts`: a scripted `@/lib/db`, an
 * `@/lib/auth` that answers with a session, and `@/lib/r2` with only its two
 * network-touching functions replaced by spies so every pure decision
 * (`generateKey`, `getPublicUrl`, `validateFile`) stays real.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "admin-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...actual,
    assertStorageConfigured: vi.fn(),
    putObject: vi.fn(async () => {}),
    deleteStoredObjects: vi.fn(async () => [] as string[]),
  };
});

import { POST } from "./route";
import { pages, pageRoles } from "@/lib/db/schema";
import { assertStorageConfigured, deleteStoredObjects, putObject } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const OLD_AVATAR = "https://test.r2.dev/avatars/page-1/1-old.png";
const OLD_COVER = "https://test.r2.dev/covers/page-1/2-old.png";

function imageFile(name = "photo.png", type = "image/png") {
  return new File(["photo-bytes"], name, { type });
}

function uploadRequest({
  pageId = PAGE_ID,
  kind = "avatar",
  file = imageFile() as File | null,
}: { pageId?: string; kind?: string; file?: File | null } = {}) {
  const form = new FormData();
  if (file) form.append("file", file);
  form.append("pageId", pageId);
  form.append("kind", kind);
  return new Request("http://localhost/api/pages/image", { method: "POST", body: form });
}

const deletion = () => vi.mocked(deleteStoredObjects);

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "admin-1";
});

describe("POST /api/pages/image", () => {
  it("removes the photo an upload replaces", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, [{ url: OLD_AVATAR }])
      .updateReturns(pages, [{ id: PAGE_ID }]);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.kind).toBe("avatar");
    // The stored URL is under the Page's own avatar folder, keyed by the Page —
    // not by the admin who uploaded it.
    expect(payload.url).toContain(`/avatars/${PAGE_ID}/`);
    expect(vi.mocked(putObject)).toHaveBeenCalledOnce();
    expect(deletion()).toHaveBeenCalledWith([OLD_AVATAR]);
  });

  it("removes the cover an upload replaces, and writes the cover column", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, [{ url: OLD_COVER }])
      .updateReturns(pages, [{ id: PAGE_ID }]);

    const response = await POST(uploadRequest({ kind: "cover" }));

    expect(response.status).toBe(200);
    expect((await response.json()).url).toContain(`/covers/${PAGE_ID}/`);
    // The read of the previous URL follows the kind: a cover upload must not be
    // handed the photo it is not replacing.
    expect(deletion()).toHaveBeenCalledWith([OLD_COVER]);
    expectGatedSequence("writes", [{ table: "pages", values: { coverUrl: expect.any(String) } }]);
  });

  it("deletes nothing for the first photo a Page gets", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, [{ url: null }])
      .updateReturns(pages, [{ id: PAGE_ID }]);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    // Still offered, but as `null`: an empty column displaced nothing.
    expect(deletion()).toHaveBeenCalledWith([null]);
  });

  it("refuses a non-admin before writing the object or the row", async () => {
    fakeDb.selectReturns(pageRoles, []);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(403);
    // The order is the point: an upload that is rejected must not leave a file
    // in the bucket, so the role is checked before `putObject`.
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expect(deletion()).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("rejects a file that is not an image before anything is written", async () => {
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await POST(uploadRequest({ file: imageFile("notes.txt", "text/plain") }));

    expect(response.status).toBe(400);
    // The refusal names the image the Page wanted, not the generic "file type
    // not allowed" a later size/shape validator would have answered with.
    expect(await response.json()).toEqual({
      error: "A Page photo must be a JPG, PNG, GIF or WebP image",
    });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("rejects a malformed page id instead of casting it into the column", async () => {
    const response = await POST(uploadRequest({ pageId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid page id" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("rejects a kind that is neither the photo nor the cover", async () => {
    const response = await POST(uploadRequest({ kind: "banner" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'An image kind of "avatar" or "cover" is required',
    });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("rejects a request with no file at all", async () => {
    const response = await POST(uploadRequest({ file: null }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "An image file is required" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("rejects an image over the size limit before writing the object", async () => {
    const tooBig = new File([new Uint8Array(11 * 1024 * 1024)], "photo.png", { type: "image/png" });

    const response = await POST(uploadRequest({ file: tooBig }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Image must be less than 10MB" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("answers 404 when the Page vanished before the row could be written", async () => {
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, [{ url: OLD_AVATAR }])
      .updateReturns(pages, []);

    const response = await POST(uploadRequest());

    // The object was written, but the row it would point from is gone: the
    // Page is answered as not found rather than pretending the upload landed.
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Page not found" });
    expect(deletion()).not.toHaveBeenCalled();
  });

  it("answers 503 when storage is not configured, before writing the object or the row", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Image storage is not configured");
    });
    fakeDb.selectReturns(pageRoles, [{ id: "role-1" }]);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Image storage is not configured" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("answers 500 when the row update fails, deleting nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(pageRoles, [{ id: "role-1" }])
      .selectReturns(pages, [{ url: OLD_AVATAR }])
      .failNextUpdate(pages, new Error("database unavailable"));
    try {
      const response = await POST(uploadRequest());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to upload that image" });
      expect(deletion()).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
