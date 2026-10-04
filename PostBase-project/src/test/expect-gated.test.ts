import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { comments, reports, users } from "@/lib/db/schema";
import { fakeDb, resetFakeDb } from "./fake-db";
import {
  expectGatedDelete,
  expectGatedInsert,
  expectGatedNone,
  expectGatedRead,
  expectGatedSequence,
  expectGatedUpdate,
} from "./expect-gated";

/**
 * The helpers that read the fake's predicate arrays. They are test-only code,
 * but a helper that silently passes is worse than no helper, so the failure
 * paths are pinned here too: a wrong table, a wrong `nth`, a wrong parameter.
 */

beforeEach(() => {
  resetFakeDb();
});

describe("expectGatedRead", () => {
  it("asserts the predicate and parameters in one call", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expectGatedRead(reports, { where: '"status" = $1', params: ["pending"] });
  });

  it("matches a RegExp predicate", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expectGatedRead(reports, { where: /"reports"\."status" = \$1/ });
  });

  it("locates the `nth` read of a table that is read twice", async () => {
    fakeDb.selectReturns(reports, []).selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));
    await fakeDb.select().from(reports).where(eq(reports.status, "resolved"));

    expectGatedRead(reports, { params: ["pending"] });
    expectGatedRead(reports, { nth: 1, params: ["resolved"] });
  });

  it("treats `where: \"\"` as an exact unfiltered assertion", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports);

    expectGatedRead(reports, { where: "" });
  });

  it("throws when the table was never read", () => {
    expect(() => expectGatedRead(reports, { where: '"status" = $1' })).toThrow(
      /expected operation #1 on "reports"/,
    );
  });

  it("throws when the parameters are different", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expect(() => expectGatedRead(reports, { params: ["resolved"] })).toThrow();
  });

  it("throws when the predicate does not match", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expect(() => expectGatedRead(reports, { where: '"status" = $9' })).toThrow();
  });

  it("requires every matcher in an array to hold", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expect(() =>
      expectGatedRead(reports, { where: ['"status" = $1', /not exists/] }),
    ).toThrow();
  });

  it("throws when `where: \"\"` is asked of a filtered read", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expect(() => expectGatedRead(reports, { where: "" })).toThrow();
  });
});

describe("expectGatedUpdate and expectGatedDelete", () => {
  it("asserts a soft delete's ownership predicate", async () => {
    fakeDb.updateReturns(comments, []);
    await fakeDb
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(and(eq(comments.id, "comment-1"), eq(comments.authorId, "author-1")));

    expectGatedUpdate(comments, {
      where: '"comments"."author_id" = $2',
      params: ["comment-1", "author-1"],
    });
  });

  it("asserts a delete's predicate", async () => {
    await fakeDb.delete(reports).where(eq(reports.id, "report-1"));

    expectGatedDelete(reports, { where: '"reports"."id" = $1', params: ["report-1"] });
  });

  it("counts only updates when locating within `writes`, not inserts", async () => {
    fakeDb.updateReturns(comments, []);
    // An insert is a `write` with no predicate; the update must still be found.
    await fakeDb.insert(reports).values({ status: "pending" });
    await fakeDb.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, "c-1"));

    expectGatedUpdate(comments, { where: '"comments"."id" = $1', params: ["c-1"] });
  });

  it("throws when the update was never made", () => {
    expect(() => expectGatedUpdate(comments, {})).toThrow(
      /expected operation #1 on "comments"/,
    );
  });

  it("throws when the update predicate is different", async () => {
    fakeDb.updateReturns(comments, []);
    await fakeDb.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, "c-1"));

    expect(() =>
      expectGatedUpdate(comments, { where: '"comments"."author_id" = $1' }),
    ).toThrow();
  });

  it("throws when the delete was never made", () => {
    expect(() => expectGatedDelete(reports, {})).toThrow(
      /expected operation #1 on "reports"/,
    );
  });

  it("throws when the delete predicate is different", async () => {
    await fakeDb.delete(reports).where(eq(reports.id, "report-1"));

    expect(() =>
      expectGatedDelete(reports, { where: '"reports"."id" = $9' }),
    ).toThrow();
  });
});

describe("payloads, inserts and first", () => {
  it("pins an insert's payload", async () => {
    fakeDb.insertReturns(reports, []);
    await fakeDb.insert(reports).values({ status: "pending", reason: "spam" });

    expectGatedInsert(reports, { values: { status: "pending", reason: "spam" } });
  });

  it("pins an update's payload and predicate together", async () => {
    fakeDb.updateReturns(comments, []);
    await fakeDb.update(comments).set({ content: "edited" }).where(eq(comments.id, "c-1"));

    expectGatedUpdate(comments, {
      values: { content: "edited" },
      where: '"comments"."id" = $1',
    });
  });

  it("throws when the payload is different", async () => {
    fakeDb.insertReturns(reports, []);
    await fakeDb.insert(reports).values({ status: "pending" });

    expect(() => expectGatedInsert(reports, { values: { status: "resolved" } })).toThrow();
  });

  it("accepts an asymmetric matcher for the payload", async () => {
    fakeDb.insertReturns(reports, []);
    await fakeDb.insert(reports).values({ status: "pending", createdAt: new Date() });

    expectGatedInsert(reports, { values: expect.objectContaining({ status: "pending" }) });
  });

  it("asserts the operation is the first of its kind", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));

    expectGatedRead(reports, { first: true });
  });

  it("throws when the operation is not first", async () => {
    fakeDb.selectReturns(reports, []).selectReturns(reports, []);
    await fakeDb.select().from(reports).where(eq(reports.status, "pending"));
    await fakeDb.select().from(reports).where(eq(reports.status, "resolved"));

    expect(() => expectGatedRead(reports, { nth: 1, first: true })).toThrow();
  });
});

describe("expectGatedSequence", () => {
  it("asserts the ordered reads", async () => {
    fakeDb.selectReturns(reports, []).selectReturns(comments, []);
    await fakeDb.select().from(reports);
    await fakeDb.select().from(comments);

    expectGatedSequence("reads", ["reports", "comments"]);
  });

  it("asserts the ordered deletes", async () => {
    await fakeDb.delete(comments).where(eq(comments.id, "c-1"));
    await fakeDb.delete(reports).where(eq(reports.id, "r-1"));

    expectGatedSequence("deletes", ["comments", "reports"]);
  });

  it("compares a name-only `writes` list against the tables", async () => {
    fakeDb.insertReturns(users, []).insertReturns(reports, []);
    await fakeDb.insert(users).values({ username: "ada" });
    await fakeDb.insert(reports).values({ status: "pending" });

    expectGatedSequence("writes", ["users", "reports"]);
  });

  it("compares a `{ table, values }` list against the writes themselves", async () => {
    fakeDb.updateReturns(comments, []);
    await fakeDb.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, "c-1"));

    expectGatedSequence("writes", [
      { table: "comments", values: { deletedAt: expect.any(Date) } },
    ]);
  });

  it("asserts that nothing was recorded", () => {
    expectGatedSequence("writes", []);
    expectGatedSequence("deletes", []);
    expectGatedSequence("reads", []);
  });

  it("agrees with expectGatedNone on an empty record", () => {
    expectGatedSequence("writes", []);
    expectGatedNone("writes");
  });

  it("throws on a wrong order", async () => {
    fakeDb.selectReturns(reports, []).selectReturns(comments, []);
    await fakeDb.select().from(comments);
    await fakeDb.select().from(reports);

    expect(() => expectGatedSequence("reads", ["reports", "comments"])).toThrow();
  });
});

describe("expectGatedNone", () => {
  it("passes when the record is empty", () => {
    expectGatedNone("writes");
    expectGatedNone("reads");
    expectGatedNone("deletes");
  });

  it("throws when a write was made", async () => {
    fakeDb.insertReturns(reports, []);
    await fakeDb.insert(reports).values({ status: "pending" });

    expect(() => expectGatedNone("writes")).toThrow();
  });

  it("throws when a read was made", async () => {
    fakeDb.selectReturns(reports, []);
    await fakeDb.select().from(reports);

    expect(() => expectGatedNone("reads")).toThrow();
  });

  it("throws when a delete was made", async () => {
    await fakeDb.delete(reports).where(eq(reports.id, "report-1"));

    expect(() => expectGatedNone("deletes")).toThrow();
  });
});
