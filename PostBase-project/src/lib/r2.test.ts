import { describe, expect, it } from "vitest";
import { keyBelongsToUser, keyFromPublicUrl, replacedObjectUrl } from "./r2";

/**
 * The two decisions that stand between a stored URL and a `DeleteObjectCommand`.
 *
 * Neither of these talks to storage, and that is the point of testing them here:
 * `deleteStoredObjects` cannot be exercised without a bucket or a mocked SDK, but
 * the question it asks before deleting anything is pure, and it is the question
 * that can actually destroy somebody's file. `keyFromPublicUrl` decides whether a
 * URL is one of ours at all — media rows hold whatever they were handed, and
 * seeded demo posts point at arbitrary external hosts, so a guessed key would
 * delete something unrelated to the app — while `replacedObjectUrl` decides
 * whether a write displaced anything, which is what a Page's photo and cover
 * replacement is built on.
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
