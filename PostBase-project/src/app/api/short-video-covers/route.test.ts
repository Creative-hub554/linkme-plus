import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Publishing a Cover Studio clip, driven through the handler.
 *
 * The request does two writes of very different importance. The **profile**
 * update is the publish — it sets `coverVideoUrl` and clears `coverConfig` so the
 * banner plays the clip — and a failure there is a failure of the request. The
 * **`short_video_covers` insert** is history: it is best-effort, wrapped so a
 * schema that has not caught up with the migration cannot take an otherwise
 * published cover down with it. That asymmetry is the thing to pin, and it is
 * exactly the kind of failure path no hand-run check reaches: the tests make the
 * history insert fail and assert the request still answers `201` with
 * `coverId: null` while the profile was really written.
 *
 * Storage is the other side: the clip, the profile photo and every picture are
 * uploaded before any row is touched, so an upload that fails must leave no
 * profile write behind — the banner must not switch to a clip that is not there.
 */
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("@/test/fake-db");
  return {
    db: fakeDb,
    withDbRetry: (operation: () => unknown) => operation(),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: "member-1" } }),
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
  };
});

import { POST } from "./route";
import { profiles, shortVideoCovers } from "@/lib/db/schema";
import { putObject } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence, expectGatedUpdate } from "@/test/expect-gated";

function videoFile() {
  return new File(["video-bytes"], "cover.webm", { type: "video/webm" });
}

function photoFile() {
  return new File(["photo-bytes"], "me.png", { type: "image/png" });
}

type CoverFields = Record<string, string | File | File[] | null>;

function publishRequest(overrides: CoverFields = {}) {
  const fields: CoverFields = {
    video: videoFile(),
    profilePhoto: photoFile(),
    templateId: "aurora-waves",
    speed: "normal",
    aspectRatio: "9:16",
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  return new Request("http://localhost/api/short-video-covers", { method: "POST", body: form });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
});

describe("POST /api/short-video-covers", () => {
  it("publishes the clip even when the history row cannot be written", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextInsert(shortVideoCovers, new Error('relation "short_video_covers" does not exist'));
    try {
      const response = await POST(publishRequest());

      // The profile is the publish, so the request succeeded…
      expect(response.status).toBe(201);
      const payload = await response.json();
      // …with no history id, because the insert that would have produced it was
      // the part that failed — and that failure was swallowed on purpose.
      expect(payload.coverId).toBeNull();
      expect(payload.videoUrl).toContain("/short-video-covers/member-1/");
      // The profile really was written: the clip plays and the legacy animated
      // cover is cleared. The failed insert is *not* in the writes, because a
      // write that rejected never happened.
      expectGatedSequence("writes", ["profiles"]);
      expectGatedUpdate(profiles, {
        first: true,
        values: expect.objectContaining({
          coverConfig: null,
          shortVideoCoverConfig: expect.any(Object),
        }),
      });
    } finally {
      silence.mockRestore();
    }
  });

  it("records the history row and returns its id when the insert works", async () => {
    fakeDb.insertReturns(shortVideoCovers, [{ id: "cover-1" }]);

    const response = await POST(publishRequest());

    expect(response.status).toBe(201);
    expect((await response.json()).coverId).toBe("cover-1");
    expectGatedSequence("writes", ["profiles", "short_video_covers"]);
  });

  it("fails the request and writes no profile when the clip cannot be stored", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(putObject).mockRejectedValueOnce(new Error("network unreachable"));
    try {
      const response = await POST(publishRequest());

      // The banner must not switch to a clip that was never stored.
      expect(response.ok).toBe(false);
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a request with no rendered clip", async () => {
    const response = await POST(publishRequest({ video: null }));

    expect(response.status).toBe(400);
    // The refusal is the guard's own, not a `TypeError` from reading `.size`
    // off `null` — which is what the catch answers with if this check is lost.
    expect(await response.json()).toEqual({ error: "A rendered cover video is required" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a clip that is not a video file", async () => {
    const response = await POST(
      publishRequest({ video: new File(["bytes"], "cover.txt", { type: "text/plain" }) }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A rendered cover video is required" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses an empty or oversized clip", async () => {
    const empty = await POST(
      publishRequest({ video: new File([], "cover.webm", { type: "video/webm" }) }),
    );
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "The cover video must be under 25 MB" });

    const oversized = await POST(
      publishRequest({ video: new File([new Uint8Array(26 * 1024 * 1024)], "cover.webm", { type: "video/webm" }) }),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "The cover video must be under 25 MB" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a profile photo that is not an image, or is missing", async () => {
    const wrong = await POST(
      publishRequest({ profilePhoto: new File(["bytes"], "me.txt", { type: "text/plain" }) }),
    );
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "A profile photo is required" });

    const missing = await POST(publishRequest({ profilePhoto: null }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "A profile photo is required" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses an empty or oversized profile photo", async () => {
    const empty = await POST(
      publishRequest({ profilePhoto: new File([], "me.png", { type: "image/png" }) }),
    );
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Profile photo must be under 10 MB" });

    const oversized = await POST(
      publishRequest({
        profilePhoto: new File([new Uint8Array(11 * 1024 * 1024)], "me.png", { type: "image/png" }),
      }),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "Profile photo must be under 10 MB" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses a background video that is not a video", async () => {
    const response = await POST(
      publishRequest({ backgroundVideo: new File(["bytes"], "bg.txt", { type: "text/plain" }) }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Background video must be a valid video" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses more pictures than the ceiling allows", async () => {
    const photos = Array.from(
      { length: 13 },
      (_, index) => new File(["bytes"], `p${index}.png`, { type: "image/png" }),
    );

    const response = await POST(publishRequest({ photos }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "You can use up to 12 pictures" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
  });

  it("refuses a picture that is not an image, or is too large", async () => {
    const wrong = await POST(
      publishRequest({ photos: [new File(["bytes"], "p.txt", { type: "text/plain" })] }),
    );
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "Pictures must be images under 10 MB" });

    const oversized = await POST(
      publishRequest({
        photos: [new File([new Uint8Array(11 * 1024 * 1024)], "p.png", { type: "image/png" })],
      }),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "Pictures must be images under 10 MB" });
    expect(vi.mocked(putObject)).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });
});
