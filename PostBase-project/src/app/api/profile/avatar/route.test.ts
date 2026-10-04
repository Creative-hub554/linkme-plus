import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The profile avatar upload, driven through the handler.
 *
 * The route stores the photo, records its URL on the profile and removes the
 * photo it displaced — reading the previous `avatarUrl` before the write, since
 * after it the old URL is recorded nowhere. It also has a deliberate second path:
 * if the database write cannot be made within five seconds it defers to Supabase
 * auth metadata rather than failing an upload R2 already accepted, and on that
 * path the old URL is still the one the profile points at, so its object is
 * **not** removed. These tests pin the URL that is stored and the column it is
 * written to, the replaced object that is deleted, the empty-column case that
 * deletes nothing, the deferred-write case that also deletes nothing (a write
 * that never landed leaves the old URL in use), that a non-image is refused
 * **before** anything reaches storage, and that no session is a `401`.
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

// The fallback the route takes when the profile write cannot be made. Mocked
// rather than imported (it would pull Supabase's server client into the test),
// and hoisted so a test can make its answer an error.
const supabase = vi.hoisted(() => ({
  updateUser: vi.fn(async () => ({ error: null as unknown })),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { updateUser: supabase.updateUser } })),
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

function imageFile(name = "me.png", type = "image/png") {
  return new File(["photo-bytes"], name, { type });
}

function uploadRequest(file: File) {
  const form = new FormData();
  form.append("file", file);
  return new Request("http://localhost/api/profile/avatar", { method: "POST", body: form });
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  session.userId = "member-1";
});

describe("POST /api/profile/avatar", () => {
  it("stores the photo and records its URL on the caller's profile", async () => {
    fakeDb.selectReturns(profiles, [{ avatarUrl: null }]).updateReturns(profiles, [{ id: "profile-1" }]);

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(200);
    const { avatarUrl } = await response.json();
    // Keyed by the member, under the avatar folder, and that exact URL is what
    // the profile row is given — not a second, freshly generated one.
    expect(avatarUrl).toContain("/avatars/member-1/");
    expect(putObject).toHaveBeenCalledOnce();
    expectGatedSequence("writes", [{ table: "profiles", values: { avatarUrl } }]);
    // The first photo a member ever gets replaces an empty column, so nothing
    // is offered up and the bucket is not asked to remove anything.
    expect(vi.mocked(deleteStoredObjects)).not.toHaveBeenCalled();
  });

  it("removes the photo an upload replaces", async () => {
    fakeDb
      .selectReturns(profiles, [{ avatarUrl: "https://test.r2.dev/avatars/member-1/old.png" }])
      .updateReturns(profiles, [{ id: "profile-1" }]);

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(200);
    // The previous avatar, read from the row before the write displaced it — the
    // object that would otherwise stay in the bucket forever.
    expect(vi.mocked(deleteStoredObjects)).toHaveBeenCalledWith([
      "https://test.r2.dev/avatars/member-1/old.png",
    ]);
  });

  it("does not remove the old photo when the profile write is deferred", async () => {
    // The route logs the deferral; that is the expected path here.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fakeDb
        .selectReturns(profiles, [{ avatarUrl: "https://test.r2.dev/avatars/member-1/old.png" }])
        .failNextUpdate(profiles, new Error("database unavailable"));

      const response = await POST(uploadRequest(imageFile()));

      expect(response.status).toBe(200);
      // The read found the old photo, but the write never landed — the profile
      // still points at it, so its object must stay. This is the difference from
      // the ordinary path above, and the reason the URL is only offered up after
      // the write has succeeded.
      expect(vi.mocked(deleteStoredObjects)).not.toHaveBeenCalled();
      expectGatedNone("writes");
      // And the deferred path really ran: the URL went to Supabase auth
      // metadata instead of the profile row.
      expect(supabase.updateUser).toHaveBeenCalledOnce();
    } finally {
      silence.mockRestore();
    }
  });

  it("fails loudly when the deferred metadata write fails too, still removing nothing", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.updateUser.mockResolvedValueOnce({ error: new Error("metadata rejected") });
    try {
      fakeDb
        .selectReturns(profiles, [{ avatarUrl: "https://test.r2.dev/avatars/member-1/old.png" }])
        .failNextUpdate(profiles, new Error("database unavailable"));

      const response = await POST(uploadRequest(imageFile()));

      // Both places the photo could be attached failed, so the member is told;
      // but the old photo is still the one they are shown on reload until one of
      // them succeeds, so it is not deleted on the way out either.
      expect(response.status).toBe(500);
      expect(vi.mocked(deleteStoredObjects)).not.toHaveBeenCalled();
    } finally {
      silence.mockRestore();
    }
  });

  it("refuses a file that is not an image before storing it", async () => {
    const response = await POST(uploadRequest(imageFile("notes.txt", "text/plain")));

    expect(response.status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("writes");
  });

  it("refuses a request with no file at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/profile/avatar", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A profile photo is required" });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    session.userId = null;

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(401);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("answers 503 when storage is not configured, before storing or reading anything", async () => {
    vi.mocked(assertStorageConfigured).mockImplementationOnce(() => {
      throw new Error("Cloudflare R2 storage is not configured");
    });

    const response = await POST(uploadRequest(imageFile()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cloudflare R2 storage is not configured" });
    // The upload never reaches the bucket, and the profile row is never read.
    expect(putObject).not.toHaveBeenCalled();
    expectGatedNone("reads");
    expectGatedNone("writes");
  });
});
