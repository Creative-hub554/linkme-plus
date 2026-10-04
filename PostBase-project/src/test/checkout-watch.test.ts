import { describe, expect, it } from "vitest";
import { changedFiles, runOnQuietTree, type FileFingerprint } from "@/test/checkout-watch";

/**
 * The tests for the checkout watcher `lint-baseline.test.ts` leans on.
 *
 * That test runs `tsc` and ESLint over the whole project, and this checkout is
 * shared: a whole-project check can straddle another writer's save and report a
 * finding about code that is already gone. The watcher is what turns that into a
 * check taken again on a still tree, so its two decisions are pinned here — what
 * counts as "the tree moved", and how many times the check is taken before the
 * result is handed back with the drift on it.
 *
 * The snapshots are injected rather than read from disk, so the retry is
 * exercised on made-up fingerprints and never has to touch a file.
 */

const snap = (entries: Record<string, string>): FileFingerprint => new Map(Object.entries(entries));

describe("changedFiles", () => {
  it("is empty when every fingerprint is the same", () => {
    const before = snap({ "a.ts": "1:1", "b.tsx": "2:2" });
    expect(changedFiles(before, snap({ "a.ts": "1:1", "b.tsx": "2:2" }))).toEqual([]);
  });

  it("reports a rewritten, an added and a removed file, in order", () => {
    const before = snap({ "a.ts": "1:1", "gone.ts": "5:5" });
    const after = snap({ "a.ts": "1:2", "added.ts": "3:3" });
    expect(changedFiles(before, after)).toEqual(["a.ts", "added.ts", "gone.ts"]);
  });
});

describe("runOnQuietTree", () => {
  it("takes one run when the tree holds still", async () => {
    let runs = 0;
    const result = await runOnQuietTree(
      () => {
        runs += 1;
        return "ok";
      },
      { snapshot: () => snap({ "a.ts": "1:1" }) },
    );

    expect(result).toEqual({ value: "ok", drift: [] });
    expect(runs).toBe(1);
  });

  it("takes the check again while the tree keeps moving", async () => {
    // Every run advances the fingerprint, so no run ever sees a still tree; the
    // last value is handed back and the drift says why it cannot be trusted.
    let move = 0;
    let runs = 0;
    const result = await runOnQuietTree(
      () => {
        runs += 1;
        move += 1;
        return runs;
      },
      { snapshot: () => snap({ "a.ts": `1:${move}` }), attempts: 2 },
    );

    expect(runs).toBe(2);
    expect(result.value).toBe(2);
    expect(result.drift).toEqual(["a.ts"]);
  });

  it("stops at the first run that sees a still tree", async () => {
    let n = 0;
    let runs = 0;
    const result = await runOnQuietTree(
      () => {
        runs += 1;
        if (runs === 1) n += 1; // the first run straddles a save; the second does not
        return "done";
      },
      { snapshot: () => snap({ "a.ts": `1:${n}` }), attempts: 5 },
    );

    expect(runs).toBe(2);
    expect(result).toEqual({ value: "done", drift: [] });
  });
});
