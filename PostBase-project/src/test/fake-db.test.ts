import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { comments, pages, posts } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "./fake-db";

/**
 * The fake `@/lib/db`'s record of the predicates a route wrote.
 *
 * A route test asserts through this seam, so the seam's own alignment rule has
 * to hold: `selectWheres`/`selectParams` track `reads`, and the new
 * `updateWheres`/`updateParams`/`deleteWheres`/`deleteParams` track `writes` and
 * `deletes`. Without a test here, a break in that alignment would quietly weaken
 * every route test that leans on it, which is the one failure mode a recorded
 * predicate must not have.
 */

beforeEach(() => {
  resetFakeDb();
});

describe("update predicate capture", () => {
  it("renders a soft delete's ownership `where` and its bound parameters", async () => {
    fakeDb.updateReturns(comments, [{ id: "comment-1" }]);

    await fakeDb
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(and(eq(comments.id, "comment-1"), eq(comments.authorId, "author-1")))
      .returning();

    // The table and the payload are still what `writes` records...
    expect(fakeDb.writes).toEqual([
      { table: "comments", values: { deletedAt: expect.any(Date) } },
    ]);
    // ...and the predicate is now readable, index-aligned with it: the row id is
    // the shape, the session's id the value the ownership narrowed to.
    expect(fakeDb.updateWheres[0]).toContain('"comments"."id" = $1');
    expect(fakeDb.updateWheres[0]).toContain('"comments"."author_id" = $2');
    expect(fakeDb.updateParams[0]).toEqual(["comment-1", "author-1"]);
  });

  it("keeps insert slots empty so `updateWheres` stays aligned with `writes`", async () => {
    fakeDb
      .insertReturns(posts, [{ id: "post-1" }])
      .updateReturns(pages, [{ id: "page-1" }]);

    await fakeDb.insert(posts).values({ title: "A post" }).returning();
    await fakeDb.update(pages).set({ name: "Renamed" }).where(eq(pages.id, "page-1"));

    expect(fakeDb.writes.map((write) => write.table)).toEqual(["posts", "pages"]);
    // The insert has no `where`, so its slot is the empty string; the update's
    // predicate lands on the matching index.
    expect(fakeDb.updateWheres[0]).toBe("");
    expect(fakeDb.updateParams[0]).toEqual([]);
    expect(fakeDb.updateWheres[1]).toContain('"pages"."id" = $1');
    expect(fakeDb.updateParams[1]).toEqual(["page-1"]);
  });

  it("records `\"\"` for an unfiltered update", async () => {
    fakeDb.updateReturns(pages, []);

    await fakeDb.update(pages).set({ name: "Every page" });

    expect(fakeDb.updateWheres).toEqual([""]);
    expect(fakeDb.updateParams).toEqual([[]]);
  });

  it("does not record an update that rejected", async () => {
    fakeDb.failNextUpdate(comments, new Error("database unavailable"));

    await expect(
      fakeDb.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, "comment-1")),
    ).rejects.toThrow("database unavailable");

    expect(fakeDb.writes).toEqual([]);
    expect(fakeDb.updateWheres).toEqual([]);
    expect(fakeDb.updateParams).toEqual([]);
  });
});

describe("delete predicate capture", () => {
  it("renders the `where` and parameters of each delete", async () => {
    await fakeDb.delete(posts).where(eq(posts.pageId, "page-1"));
    await fakeDb.delete(pages).where(eq(pages.id, "page-1"));

    expect(fakeDb.deletes).toEqual(["posts", "pages"]);
    expect(fakeDb.deleteWheres[0]).toContain('"posts"."page_id" = $1');
    expect(fakeDb.deleteParams[0]).toEqual(["page-1"]);
    expect(fakeDb.deleteWheres[1]).toContain('"pages"."id" = $1');
    expect(fakeDb.deleteParams[1]).toEqual(["page-1"]);
  });

  it("records `\"\"` for an unfiltered delete", async () => {
    await fakeDb.delete(posts);

    expect(fakeDb.deletes).toEqual(["posts"]);
    expect(fakeDb.deleteWheres).toEqual([""]);
    expect(fakeDb.deleteParams).toEqual([[]]);
  });

  it("does not record a delete that rejected", async () => {
    // The seam the un-save's 500 rides: a rejected delete is a write that did
    // not happen, so it leaves the same silence an update's rejection does.
    fakeDb.failNextDelete(posts, new Error("database unavailable"));

    await expect(fakeDb.delete(posts).where(eq(posts.id, "post-1"))).rejects.toThrow(
      "database unavailable",
    );

    expect(fakeDb.deletes).toEqual([]);
    expect(fakeDb.deleteWheres).toEqual([]);
    expect(fakeDb.deleteParams).toEqual([]);
  });
});

describe("reset", () => {
  it("clears the predicate arrays along with the rest", async () => {
    fakeDb.updateReturns(pages, []).selectReturns(posts, []);
    await fakeDb.update(pages).set({ name: "x" }).where(eq(pages.id, "page-1"));
    await fakeDb.delete(pages).where(eq(pages.id, "page-1"));

    resetFakeDb();

    expect(fakeDb.reads).toEqual([]);
    expect(fakeDb.writes).toEqual([]);
    expect(fakeDb.deletes).toEqual([]);
    expect(fakeDb.selectWheres).toEqual([]);
    expect(fakeDb.selectParams).toEqual([]);
    expect(fakeDb.updateWheres).toEqual([]);
    expect(fakeDb.updateParams).toEqual([]);
    expect(fakeDb.deleteWheres).toEqual([]);
    expect(fakeDb.deleteParams).toEqual([]);
  });
});
