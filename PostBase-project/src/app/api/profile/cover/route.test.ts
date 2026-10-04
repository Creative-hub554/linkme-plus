import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The profile cover upload and removal, driven through the handler.
 *
 * `POST` stores an image, records the URL in `profiles.cover_url` and removes the
 * cover it replaced. `DELETE` is the editor's one "Remove cover" button: it
 * clears **all four** columns that fill that slot together — the photo, the
 * published video, the animated-cover config and the short-video-cover config —
 * because they are four ways of dressing the same banner and removing one would
 * leave the others to reappear. It removes the still photo and every photo the
 * animated config held, and **keeps the published video's object** on purpose:
 * the video removal route keeps the clip as the record of what was published, and
 * deleting it here would make "Remove cover" destroy history that "Remove video"
 * preserves.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

const session = vi.hoisted(() => ({ userId: "member-1" as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

vi.mock("@/lib/db/ensure-profile", () => ({
  ensureLocalUserProfile: vi.fn(async () => {}),
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

import { DELETE, POST } from "./route";
import { profiles } from "@/lib/db/schema";
import { assertStorageConfigured, deleteStoredObjects, putObject } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const OLD_COVER = "https://test.r2.dev/covers/member-1/old.png";
const CONFIG_PHOTO_ONE = "https://test.r2.dev/covers/member-1/config-1.png";
const CONFIG_PHOTO_TWO = "https://test.r2.dev/covers/member-1/config-2.png";

function imageFile(name = "cover.png", type = "image/png") {
  return new File(["cover-bytes"], name, { type });
}

function uploadRequest(file: File) {
  const form = new FormData();
  form.append("file", file);
  return new Request("http://localhost/api/profile/cover", { method: "POST", body: form });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("POST /api/profile/cover", () => {
  it("stores the image, records its URL, and removes the cover it replaced", async () => {
    fakeDb.selectReturns(profiles, [{ coverUrl: OLD_COVER }]);

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(200);
    const { coverUrl } = await response.json();
    expect(coverUrl).toContain("/covers/member-1/");
    expect(putObject).toHaveBeenCalledOnce();
    expectGatedSequence("writes", [{ table: "profiles", values: { coverUrl } }]);
    // The previous cover, read before the write displaced it.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([OLD_COVER]);
  });

  it("removes nothing when there was no cover to replace", async () => {
    fakeDb.selectReturns(profiles, [{ coverUrl: null }]);

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(200);
    // Offered as `null`: an empty column displaced nothing.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([null]);
  });

  it("refuses a file that is not an image before storing it", async () => {
    const response = await POST(uploadRequest(imageFile("cover.txt", "text/plain")));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Cover must be an image (JPG, PNG, GIF or WebP)",
    });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a request with no file at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/profile/cover", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A cover image file is required" });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("refuses an image over the size limit before storing it", async () => {
    const tooBig = new File([new Uint8Array(11 * 1024 * 1024)], "cover.png", {
      type: "image/png",
    });

    const response = await POST(uploadRequest(tooBig));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Image must be less than 10MB" });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("answers 503 when storage is not configured, before storing the image", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Photo storage is not configured");
    });

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Photo storage is not configured" });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("answers 500 when the profile write fails, deleting nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb
      .selectReturns(profiles, [{ coverUrl: OLD_COVER }])
      .failNextUpdate(profiles, new Error("database unavailable"));
    try {
      const response = await POST(uploadRequest(imageFile()));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to upload cover" });
      expect(vi.mocked(deleteStoredObjects)).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});

describe("DELETE /api/profile/cover", () => {
  it("clears every column that fills the cover slot, removing the photo objects", async () => {
    fakeDb
      .selectReturns(profiles, [
        { coverUrl: OLD_COVER, coverConfig: { photos: [CONFIG_PHOTO_ONE, CONFIG_PHOTO_TWO] } },
      ])
      .updateReturns(profiles, [{ id: "profile-1" }]);

    const response = await DELETE(new Request("http://localhost/api/profile/cover", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ coverUrl: null, coverVideoUrl: null });
    // All four together: the photo, the video, the animated config and the
    // short-video config. Leaving any behind is a removed cover that comes back.
    expectGatedSequence("writes", [
      {
        table: "profiles",
        values: {
          coverUrl: null,
          coverVideoUrl: null,
          coverConfig: null,
          shortVideoCoverConfig: null,
        },
      },
    ]);
    // The still photo and both photos the animated config held — and nothing for
    // the video, whose object is deliberately kept as the record of what was
    // published.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([
      OLD_COVER,
      CONFIG_PHOTO_ONE,
      CONFIG_PHOTO_TWO,
    ]);
  });

  it("answers 404 when the profile row is not there, removing nothing", async () => {
    fakeDb.selectReturns(profiles, []).updateReturns(profiles, []);

    const response = await DELETE(new Request("http://localhost/api/profile/cover", { method: "DELETE" }));

    expect(response.status).toBe(404);
    expect(vi.mocked(deleteStoredObjects)).not.toHaveBeenCalled();
  });

  it("answers 500 when the profile read fails, removing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextSelect(profiles, new Error("database unavailable"));
    try {
      const response = await DELETE(
        new Request("http://localhost/api/profile/cover", { method: "DELETE" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Unable to remove the cover" });
      expect(vi.mocked(deleteStoredObjects)).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
