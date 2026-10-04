import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving a Cover Studio configuration, driven through the handler.
 *
 * A save uploads each photo, builds the stored config from the uploaded URLs and
 * writes it to `profiles.cover_config` — and, crucially, writes
 * `coverVideoUrl: null` in the same update, so a still cover and a published clip
 * can never both be set. The `backgroundPhoto` is resolved by index against the
 * uploaded URLs, with a null fallback so an out-of-range index cannot point the
 * banner at a photo that was never uploaded.
 *
 * It also removes every photo the **replaced** config held, read before the
 * write — a save with no new photos still replaces the old config, so this is
 * also the path that clears a photo-only animated cover. That is the largest
 * cleanup of the profile routes: a config can hold up to 24 objects.
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

import { POST } from "./route";
import { profiles } from "@/lib/db/schema";
import { assertStorageConfigured, deleteStoredObjects, putObject } from "@/lib/r2";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const OLD_PHOTO_ONE = "https://test.r2.dev/covers/member-1/old-1.png";
const OLD_PHOTO_TWO = "https://test.r2.dev/covers/member-1/old-2.png";

/** The smallest config the route's own validation accepts. */
const VALID_CONFIG = {
  templateId: "aurora-waves",
  colorPalette: ["#000000", "#ffffff", "#ff0000"],
  motion: { rows: 3, speed: 1, direction: "left", transition: "fade", animation: "wave" },
};

function imageFile(name: string) {
  return new File(["photo-bytes"], name, { type: "image/png" });
}

function saveRequest(config: unknown, photos: File[] = []) {
  const form = new FormData();
  form.append("config", typeof config === "string" ? config : JSON.stringify(config));
  for (const photo of photos) form.append("photos", photo);
  return new Request("http://localhost/api/profile/cover-config", { method: "POST", body: form });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("POST /api/profile/cover-config", () => {
  it("stores every photo and writes the config with the video cleared", async () => {
    fakeDb.selectReturns(profiles, [{ coverConfig: null }]);

    const response = await POST(
      saveRequest(VALID_CONFIG, [imageFile("one.png"), imageFile("two.png")]),
    );

    expect(response.status).toBe(201);
    expect(putObject).toHaveBeenCalledTimes(2);
    const { coverConfig } = await response.json();
    expect(coverConfig.photos).toHaveLength(2);
    expect(coverConfig.photos[0]).toContain("/covers/member-1/");
    // Index 0 by default, so the banner points at a photo that was uploaded.
    expect(coverConfig.backgroundPhoto).toBe(coverConfig.photos[0]);
    // The same object is written, with the video turned off in the same update:
    // a saved still cover and a playing clip must not both be set.
    expectGatedSequence("writes", [
      { table: "profiles", values: { coverConfig, coverVideoUrl: null } },
    ]);
    // The first config a member saves replaces nothing, so no object is offered.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([]);
  });

  it("removes every photo the replaced config held", async () => {
    fakeDb.selectReturns(profiles, [
      { coverConfig: { templateId: "aurora-waves", photos: [OLD_PHOTO_ONE, OLD_PHOTO_TWO] } },
    ]);

    const response = await POST(saveRequest(VALID_CONFIG, [imageFile("new.png")]));

    expect(response.status).toBe(201);
    // The two objects the old config pointed at, offered up together. The new
    // photo is not in the list — it is the one now in use.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([
      OLD_PHOTO_ONE,
      OLD_PHOTO_TWO,
    ]);
  });

  it("leaves backgroundPhoto null when the chosen index has no photo", async () => {
    fakeDb.selectReturns(profiles, [{ coverConfig: null }]);

    const response = await POST(saveRequest({ ...VALID_CONFIG, backgroundPhotoIndex: 5 }));

    expect(response.status).toBe(201);
    const { coverConfig } = await response.json();
    // No photos were sent and the index points past the end: the fallback is
    // null rather than an undefined slot the banner would try to render.
    expect(coverConfig.backgroundPhoto).toBeNull();
  });

  it("refuses an invalid configuration before uploading anything", async () => {
    // The route logs the parse failure before answering; that is the expected
    // path here, so its line is kept out of the run's output.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(
        saveRequest({ ...VALID_CONFIG, colorPalette: ["#000000"] }, [imageFile("one.png")]),
      );

      expect(response.ok).toBe(false);
      expect(putObject).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses more photos than the ceiling allows", async () => {
    const tooMany = Array.from({ length: 25 }, (_, index) => imageFile(`${index}.png`));

    const response = await POST(saveRequest(VALID_CONFIG, tooMany));

    expect(response.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a photo that is not an image before uploading anything", async () => {
    const notAnImage = new File(["notes"], "notes.txt", { type: "text/plain" });

    const response = await POST(saveRequest(VALID_CONFIG, [notAnImage]));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "File type not allowed" });
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a config that is not JSON with the route's own message", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(saveRequest("not json"));

      // The parse failure is translated into the route's message rather than
      // leaking the JSON parser's own text to the caller.
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Cover configuration must be valid JSON" });
      expect(putObject).not.toHaveBeenCalled();
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });

  it("answers 503 for photos when storage is not configured", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Photo storage is not configured");
    });

    const response = await POST(saveRequest(VALID_CONFIG, [imageFile("one.png")]));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Photo storage is not configured" });
    // Nothing is uploaded and nothing is written.
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });
});
