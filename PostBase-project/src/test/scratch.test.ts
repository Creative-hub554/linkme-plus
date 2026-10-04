import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeScratchDir, removeScratchDir } from "./scratch";

/**
 * The contract here is a negative one — a cleanup that cannot fail a suite — so most of these
 * cases are about what it does *not* do.
 *
 * What is deliberately not arranged: the retry. It is Node's documented backoff for
 * `EBUSY`/`EPERM`/`ENOTEMPTY` on a recursive removal, and a lingering handle cannot be built
 * portably to drive it — Node opens files with `FILE_SHARE_DELETE`, so an open handle does not
 * block the delete on Windows, and POSIX never blocks it. A reason no retry can help stands in
 * for one below, and it reaches the branch that matters: the removal did not succeed, and the
 * hook that called it is not handed a throw.
 */

describe("the scratch directory a suite builds", () => {
  it("makes a fresh directory under the temp dir, named for the caller", () => {
    const dir = makeScratchDir("scratch-probe-");
    const sibling = makeScratchDir("scratch-probe-");

    expect(existsSync(dir)).toBe(true);
    expect(dir.startsWith(tmpdir())).toBe(true);
    expect(dir).toContain("scratch-probe-");
    // Two suites asking for the same prefix must not be handed one tree.
    expect(sibling).not.toBe(dir);

    removeScratchDir(dir);
    removeScratchDir(sibling);
  });

  it("removes the directory and everything under it", () => {
    const dir = makeScratchDir("scratch-nested-");
    mkdirSync(join(dir, "deep", "deeper"), { recursive: true });
    writeFileSync(join(dir, "deep", "deeper", "payload.json"), "{}", "utf8");

    removeScratchDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("does not throw, or say anything, for a directory that is already gone", () => {
    const dir = makeScratchDir("scratch-gone-");
    removeScratchDir(dir);
    const reported: string[] = [];

    expect(() => removeScratchDir(dir, (message) => reported.push(message))).not.toThrow();

    // Removal is idempotent and quiet: a second call is not a failure to report.
    expect(reported).toEqual([]);
  });

  it("reports a removal that fails rather than throwing out of the hook that called it", () => {
    const reported: string[] = [];
    // A path the filesystem will not remove however often it is asked. It stands in for the
    // lingering handle this module exists for; what it proves is the branch, not the errno.
    const unremovable = `unremovable${String.fromCharCode(0)}path`;

    expect(() =>
      removeScratchDir(unremovable, (message) => reported.push(message)),
    ).not.toThrow();

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("[scratch]");
    expect(reported[0]).toContain("could not be removed");
  });
});
