import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteStoredObjects, keyBelongsToUser, keyFromPublicUrl, replacedObjectUrl } from "./r2";

/**
 * `deleteStoredObjects`' Drive half asks the mapping table which Drive-shaped
 * URLs are this app's own before deleting anything — so the table is faked at
 * its module seam here, while the Drive client talks to a stubbed `fetch`.
 * Only `db` is mocked; the allow-list decision itself is the real code.
 */
const archiveDb = vi.hoisted(() => ({
  rows: [] as Array<{ newUrl: string; driveFileId: string }>,
  failWith: null as Error | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          archiveDb.failWith ? Promise.reject(archiveDb.failWith) : Promise.resolve(archiveDb.rows),
      }),
    }),
  },
}));

/**
 * The two decisions that stand between a stored URL and a `DeleteObjectCommand`.
 *
 * Neither of these talks to storage, and that is the point of testing them here:
 * `deleteStoredObjects`' R2 half cannot be exercised without a bucket or a
 * mocked SDK, but the question it asks before deleting anything is pure, and it
 * is the question that can actually destroy somebody's file. `keyFromPublicUrl`
 * decides whether a URL is one of ours at all — media rows hold whatever they
 * were handed, and seeded demo posts point at arbitrary external hosts, so a
 * guessed key would delete something unrelated to the app — while
 * `replacedObjectUrl` decides whether a write displaced anything, which is what
 * a Page's photo and cover replacement is built on.
 *
 * The Drive half of `deleteStoredObjects` *is* exercised directly, at the end
 * of this file: it deletes only what the `archived_objects` mapping table
 * vouches for, and never throws.
 *
 * `PUBLIC_URL` is `https://test.r2.dev` from `src/test/setup.ts` — read at module
 * load, which is why the fixture values below are that prefix rather than
 * something local.
 */
const OURS = "https://test.r2.dev";

describe("keyFromPublicUrl", () => {
  it("recovers the key from one of our own public URLs", () => {
    expect(keyFromPublicUrl(`${OURS}/avatars/page-1/1790-abc.png`)).toBe("avatars/page-1/1790-abc.png");
  });

  it("strips a query or fragment a URL may have picked up", () => {
    // Stored URLs are written without either, so a URL that gained one is still
    // the same object rather than a reason to skip the delete.
    expect(keyFromPublicUrl(`${OURS}/covers/page-1/1790-abc.png?v=2`)).toBe(
      "covers/page-1/1790-abc.png",
    );
    expect(keyFromPublicUrl(`${OURS}/covers/page-1/1790-abc.png#top`)).toBe(
      "covers/page-1/1790-abc.png",
    );
  });

  it("refuses a URL that is not ours, rather than guessing a key from it", () => {
    // The seeded demo posts are exactly this case, and it is the one deletion
    // that could do real damage outside the app.
    for (const url of [
      "https://cdn.example.com/photo.jpg",
      // A host that merely starts with our own prefix's text is still foreign.
      `${OURS}.evil.example.com/photo.jpg`,
      `${OURS}`,
      `${OURS}/`,
      "",
      null,
      undefined,
    ]) {
      expect(keyFromPublicUrl(url)).toBeNull();
    }
  });
});

describe("keyBelongsToUser", () => {
  it("accepts a key under the member's own folder, whatever the folder", () => {
    for (const folder of ["posts", "avatars", "covers", "short-video-covers"]) {
      expect(keyBelongsToUser(`${folder}/member-1/1790-abc.png`, "member-1")).toBe(true);
    }
  });

  it("refuses a key under anybody else's folder", () => {
    expect(keyBelongsToUser("posts/member-2/1790-abc.png", "member-1")).toBe(false);
  });

  it("compares the whole member segment, not a prefix of it", () => {
    // `member-10` starts with `member-1`, so a `startsWith` check would let one
    // member process another's uploads whose id merely begins the same way.
    expect(keyBelongsToUser("posts/member-10/1790-abc.png", "member-1")).toBe(false);
  });

  it("refuses a key too short to hold a member segment", () => {
    for (const key of ["photo.png", "posts", "posts/member-1"]) {
      expect(keyBelongsToUser(key, "member-1")).toBe(false);
    }
  });

  it("refuses the member id when it is not the second segment", () => {
    expect(keyBelongsToUser("posts/someone/member-1/photo.png", "member-1")).toBe(false);
    expect(keyBelongsToUser("posts/../member-1/photo.png", "member-1")).toBe(false);
  });
});

describe("replacedObjectUrl", () => {
  it("reports the URL a write has displaced", () => {
    expect(replacedObjectUrl(`${OURS}/avatars/page-1/old.png`, `${OURS}/avatars/page-1/new.png`)).toBe(
      `${OURS}/avatars/page-1/old.png`,
    );
    // Clearing a photo on purpose displaces it just the same.
    expect(replacedObjectUrl(`${OURS}/covers/page-1/old.png`, null)).toBe(
      `${OURS}/covers/page-1/old.png`,
    );
  });

  it("reports nothing when there was nothing there", () => {
    // The first photo a Page ever gets replaces an empty column.
    for (const previous of [null, undefined, ""]) {
      expect(replacedObjectUrl(previous, `${OURS}/avatars/page-1/first.png`)).toBeNull();
      expect(replacedObjectUrl(previous, null)).toBeNull();
    }
  });

  it("reports nothing for a field the write never mentioned", () => {
    // A partial update's absent key: `undefined` means "leave this column
    // alone", so the object is still the one the row points at and must not be
    // offered up. This is the state `PUT /api/pages` sends when it renames a Page
    // without touching its images, and getting it wrong would delete a photo on
    // every rename.
    expect(replacedObjectUrl(`${OURS}/avatars/page-1/kept.png`, undefined)).toBeNull();
  });

  it("reports nothing when the same URL is written again", () => {
    // The rail the key generator cannot give: if a new upload ever resolved to
    // the key already stored, deleting it would remove the file the row is
    // showing — so an equal URL is never treated as displaced.
    const same = `${OURS}/avatars/page-1/same.png`;
    expect(replacedObjectUrl(same, same)).toBeNull();
    // And the near-miss that is not equal, so the guard cannot pass by always
    // returning nothing.
    expect(replacedObjectUrl(same, `${OURS}/avatars/page-1/other.png`)).toBe(same);
  });
});

/**
 * The archive's other home: URLs the hourly pass wrote into rows point at
 * Google Drive now, and deleting the row must delete the file there too — but
 * only files this app put there. The mapping table is the allow-list, and the
 * tests below are the ones that keep a pasted stranger's Drive link from ever
 * becoming a delete on the operator's credentials.
 */
describe("deleteStoredObjects, the Drive half", () => {
  const DRIVE_LH3 = "https://lh3.googleusercontent.com/d/abc123";

  function configureDrive() {
    vi.stubEnv("GDRIVE_CLIENT_ID", "client-id");
    vi.stubEnv("GDRIVE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GDRIVE_REFRESH_TOKEN", "refresh-token");
  }

  /** A `fetch` that answers the token endpoint and Drive's delete endpoint. */
  function stubDriveFetch() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.includes("oauth2.googleapis.com")) {
          return Response.json({ access_token: "token", expires_in: 3600 });
        }
        if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request: ${url}`);
      }) as typeof fetch,
    );
    return calls;
  }

  beforeEach(() => {
    archiveDb.rows = [];
    archiveDb.failWith = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("deletes only the archived files the mapping table records", async () => {
    configureDrive();
    archiveDb.rows = [{ newUrl: DRIVE_LH3, driveFileId: "drive-77" }];
    const calls = stubDriveFetch();

    const deleted = await deleteStoredObjects([
      DRIVE_LH3,
      // The right shape but no row vouches for it — a client-injected URL
      // must not become a delete of somebody else's file.
      "https://lh3.googleusercontent.com/d/unrecorded",
      // A stranger's download link, same rule.
      "https://drive.google.com/uc?export=download&id=stranger",
      // A plain foreign URL, skipped as it always was.
      "https://cdn.example.com/photo.jpg",
    ]);

    expect(deleted).toEqual(["drive:drive-77"]);
    const deletes = calls.filter((call) => call.url.startsWith("https://www.googleapis.com/drive/v3/files/"));
    expect(deletes.map((call) => call.url)).toEqual([
      "https://www.googleapis.com/drive/v3/files/drive-77",
    ]);
    expect(new Headers(deletes[0].init?.headers).get("Authorization")).toBe("Bearer token");
  });

  it("leaves archived URLs alone when Drive is not configured", async () => {
    // No GDRIVE_* in the environment: the file stays where it is, and the
    // request that deleted the row still succeeds — the warning is the whole
    // acknowledgement.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubDriveFetch();

    const deleted = await deleteStoredObjects([DRIVE_LH3]);

    expect(deleted).toEqual([]);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GDRIVE_* is not configured"));
  });

  it("fails toward not deleting when the mapping table cannot be read", async () => {
    configureDrive();
    archiveDb.failWith = new Error("db down");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubDriveFetch();

    const deleted = await deleteStoredObjects([DRIVE_LH3]);

    expect(deleted).toEqual([]);
    // No token was even fetched: an unreadable allow-list is no permission
    // to delete anything.
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("left in place"), expect.any(Error));
  });

  it("keeps R2 deletes away from Drive even when Drive is configured", async () => {
    configureDrive();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubDriveFetch();

    // The R2 half fails in this environment (no real bucket is configured) —
    // logged, never thrown — and the assertion is about what Drive never sees.
    await deleteStoredObjects([`${OURS}/posts/member-1/a.png`]);

    expect(calls).toEqual([]);
  });
});
