import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Taking down the published Cover Studio video, driven through the handler.
 *
 * The route clears `coverVideoUrl` (which is what stops the banner playing) and
 * `shortVideoCoverConfig` with it, so a template and picture list cannot outlive
 * the clip they describe. It deliberately **does not** clear `coverUrl`: the
 * banner falls back to the member's photo cover, and the test asserts the photo
 * column is absent from the write rather than merely unchanged.
 *
 * It also keeps the stored video and its `short_video_covers` row on purpose —
 * the row is the record of what was published, and removing the object would
 * leave that record pointing at nothing. That is a *stated* exception to the
 * app's storage cleanup, not a gap, and it is why this route is the one profile
 * media route whose leaving an object behind is correct.
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

import { DELETE } from "./route";
import { profiles } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "@/test/fake-db";
import { expectGatedNone, expectGatedSequence } from "@/test/expect-gated";

const request = () => new Request("http://localhost/api/profile/cover-video", { method: "DELETE" });

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("DELETE /api/profile/cover-video", () => {
  it("clears the video and its config, leaving the photo cover alone", async () => {
    fakeDb.updateReturns(profiles, [{ id: "profile-1" }]);

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ coverVideoUrl: null });
    // `coverUrl` is deliberately absent: the banner falls back to the photo, so
    // a member who uploaded both does not lose the still cover with the clip.
    expectGatedSequence("writes", [
      { table: "profiles", values: { coverVideoUrl: null, shortVideoCoverConfig: null } },
    ]);
  });

  it("answers 404 when the profile row is not there", async () => {
    fakeDb.updateReturns(profiles, []);

    const response = await DELETE(request());

    expect(response.status).toBe(404);
  });

  it("requires a session", async () => {
    session.userId = null;

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expectGatedNone("writes");
  });

  it("answers 500 when the update fails, writing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNextUpdate(profiles, new Error("database unavailable"));
    try {
      const response = await DELETE(request());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Unable to remove the cover video" });
      expectGatedNone("writes");
    } finally {
      silence.mockRestore();
    }
  });
});
