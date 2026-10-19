import { describe, expect, it } from "vitest";

import { expectHeld, readSource } from "./doc-freshness";

/**
 * The seed's reply loop writes comment ids as `commentId(postIndex * 3 +
 * replyIndex)` over the twelve newest posts, with a *random* reply count of
 * one to three. The mapping is sparse by construction: a post's block is
 * three wide, but only the first `replyCount` indices of it are written, so
 * whether an index like `1` or `4` names a real comment depends on this run's
 * deterministic draw of `pseudoRandom(777)` — it did not for `commentId(1)`,
 * which `trustReportRows`' first comment report named while the loop never
 * wrote it, leaving a pending queue row whose excerpt was permanently "no
 * longer available".
 *
 * These cases hold the pin the seed now states: every comment target its
 * trust rows name is one the derivation above really writes. The derivation
 * is re-run here rather than imported because the loop lives inline in
 * `seed.ts`; the pins that anchor it to the source are held first, so a
 * rework of the loop—or of the seed constants these numbers mirror—fails this
 * suite by name rather than silently passing against a different shape.
 *
 * Deliberately outside the hold: the *content* of the comments and the exact
 * dates they carry (live reads, not bytes), and the moderation actions'
 * targets except the one comment (`removedCommentId`), whose existence the
 * "threads agree with the record" story needs as much as a report's.
 *
 * This is not the live seed run: it claims the loop's *shape*, which is the
 * property the queues read, not that a database is seeded.
 */

const seed = readSource("src/lib/db/seed.ts");

/** The source facts the derivation below mirrors, held byte-exact. */
const PINS: Record<string, string> = {
  // The reply-id mapping the derivation re-runs, and the draw that feeds it.
  mapping: "id: commentId(postIndex * 3 + replyIndex),",
  // The loop's window: the twelve newest planned posts, and its random
  // reply count of one to three.
  window: "planned.slice(0, 12)",
  replyCount: "const replyCount = 1 + Math.floor(replyRandom() * 3);",
  // The draw's seed: change it and every comment id below moves.
  draw: "const replyRandom = pseudoRandom(777);",
  // The removed reply is a target the trust actions name through its own
  // constant, so that constant's index is part of the same contract.
  removed: "const removedCommentId = commentId(3);",
};

describe("the seed's reply ids against the comments its trust rows target", () => {
  it("is anchored: the facts the derivation re-runs still say so in seed.ts", () => {
    for (const needle of Object.values(PINS)) {
      expectHeld(needle, seed, "src/lib/db/seed.ts");
    }
  });

  it("writes every comment index the trust reports and the removal name", () => {
    // The reply loop, re-run from the pinned draw constants: the same
    // `pseudoRandom` shape seed.ts uses, the same twelve-post window, the
    // same one-to-three random counts, collecting every id the loop writes.
    function pseudoRandom(seedValue: number): () => number {
      let state = (seedValue + 1) * 0x6d2b79f5;
      return () => {
        state = (state + 0x9e3779b9) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const commentId = (index: number) =>
      `33000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

    const written = new Set<string>();
    const random = pseudoRandom(777);
    for (let postIndex = 0; postIndex < 12; postIndex += 1) {
      const replyCount = 1 + Math.floor(random() * 3);
      for (let replyIndex = 0; replyIndex < replyCount; replyIndex += 1) {
        written.add(commentId(postIndex * 3 + replyIndex));
      }
    }

    // The sparse map is the point: the same draw leaves holes, and naming
    // one is the bug this suite holds shut.
    expect([...written]).not.toContain(commentId(1));
    expect([...written]).toContain(commentId(3)); // the removed reply
    expect([...written]).toContain(commentId(4)); // report 5's dismissed target
    expect([...written]).toContain(commentId(10)); // report 2's pending target
  });

  it("targets only comments the loop writes, in both trust edges", () => {
    // The two rows-arrays that name comment ids by hand — the trust reports
    // and the trust actions — sliced out so the hold does not reach the
    // reply loop itself, whose calls generate the ids rather than target
    // them. Every literal `commentId(n)` inside the slices, plus the
    // `removedCommentId` constant the actions name, must be an id the
    // derivation above proves written.
    const reportsSlice = seed.slice(
      seed.indexOf("const trustReportRows = ["),
      seed.indexOf("const trustActionRows = ["),
    );
    const actionsSlice = seed.slice(
      seed.indexOf("const trustActionRows = ["),
      seed.indexOf('label: "trust reports"'),
    );
    const commentSlice = seed.slice(
      seed.indexOf("const removedCommentId"),
      seed.indexOf("await writeEdge({\n    label: \"comments\""),
    );

    function pseudoRandom(seedValue: number): () => number {
      let state = (seedValue + 1) * 0x6d2b79f5;
      return () => {
        state = (state + 0x9e3779b9) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const commentId = (index: number) =>
      `33000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

    const written = new Set<string>();
    const random = pseudoRandom(777);
    for (let postIndex = 0; postIndex < 12; postIndex += 1) {
      const replyCount = 1 + Math.floor(random() * 3);
      for (let replyIndex = 0; replyIndex < replyCount; replyIndex += 1) {
        written.add(commentId(postIndex * 3 + replyIndex));
      }
    }

    for (const slice of [reportsSlice, actionsSlice, commentSlice]) {
      for (const match of slice.matchAll(/commentId\((\d+)\)/g)) {
        const target = commentId(Number(match[1]));
        expect(
          { written: written.has(commentId(Number(match[1]))), target, slice: slice.slice(0, 40) },
        ).toEqual({ written: true, target, slice: slice.slice(0, 40) });
      }
    }
    // The actions reach one comment target through the removed-reply
    // constant rather than a literal call; its index is pinned above and
    // asserted written here so the slice-based hold cannot miss it.
    expect(written.has(commentId(3)), "removedCommentId is a comment the loop writes").toBe(true);
  });
});
