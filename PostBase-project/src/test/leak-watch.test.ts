/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CHECKOUT,
  LEAK_SAMPLE_LIMIT,
  TRIPWIRE_KEY,
  dirtyWrites,
  inCheckout,
  leakMessage,
  needingGit,
  recordedWrites,
  type RecordedWrite,
} from "@/test/leak-watch";
import { makeScratchDir, removeScratchDir } from "@/test/scratch";
// The wiring as *source*: the tripwire is only as good as the two places that
// install it — the preload the config hands the pool, and the hook `setup.ts`
// registers. The module's own behaviour is driven below.
import configSource from "../../vitest.config.ts?raw";
import preloadSource from "./leak-watch-preload.mjs?raw";
import setupSource from "./setup.ts?raw";

/**
 * Tests for the suite's write tripwire.
 *
 * The tripwire exists because a fixture once leaked out of its scratch directory
 * and was written into the checkout — silently, over a tracked file — and the suite
 * stayed green while `git status` did not. Three things have to hold for it to catch
 * that: a *named* `node:fs` import has to be recorded (which is why the recording
 * half is a preload and not a setup-file patch), a recorded path has to be judged by
 * the tree the file leaves behind rather than by the write itself (or every probe a
 * test builds and removes would fail its own file), and the two halves have to stay
 * wired to the run.
 *
 * The write made here is the leak's shape — a path that was meant to be scratch and
 * came out relative, so it lands in the checkout — and it is removed again in a
 * `finally`, which is also what keeps this test from tripping the very guard it is
 * testing. Both the file's own verdict and the explicit `dirtyWrites` call below go
 * quiet for exactly that reason.
 */

describe("inCheckout", () => {
  it("is true for a path inside the checkout, at any depth", () => {
    expect(inCheckout(path.join(CHECKOUT, "src", "test", "render.tsx"))).toBe(true);
    expect(inCheckout(path.join(CHECKOUT, "ci-suspect-pin.mjs"))).toBe(true);
  });

  it("is false outside it, including for a sibling whose name starts the same", () => {
    expect(inCheckout(path.join(CHECKOUT, "..", "elsewhere", "file.mjs"))).toBe(false);
    expect(inCheckout(`${CHECKOUT}${path.sep}..${path.sep}sibling${path.sep}file.mjs`)).toBe(false);
    expect(inCheckout(`${path.dirname(CHECKOUT)}${path.sep}${path.basename(CHECKOUT)}-copy${path.sep}f.mjs`)).toBe(
      false,
    );
    // Nothing writes to the directory itself, and calling it "inside" would blame
    // every write for the tree it holds.
    expect(inCheckout(CHECKOUT)).toBe(false);
  });
});

describe("the tripwire's record", () => {
  it("records a write into the checkout, through a named import, and ignores the scratch directory", () => {
    // The name is unique per process so this file cannot collide with another run of
    // the suite, and dot-prefixed so it stays out of a directory listing.
    const probe = path.join(CHECKOUT, ".freebuff", `.leak-watch-probe-${process.pid}.mjs`);
    const scratch = makeScratchDir("leak-watch-test-");
    const outside = path.join(scratch, "not-the-checkout.mjs");
    try {
      // `writeFileSync` above is a *named* import, which is the case a patch
      // installed from a setup file cannot see: Node binds it from the `node:fs`
      // namespace it keeps, built before any setup file runs. Recording this write
      // is what proves the preload is the thing being tested.
      writeFileSync(probe, "export const probe = 1;\n", "utf8");
      writeFileSync(outside, "export const probe = 1;\n", "utf8");

      const recorded = recordedWrites();
      const entry = recorded.find((candidate) => candidate.path === probe);
      expect(entry, `the write to ${probe} was not recorded`).toBeDefined();
      expect(entry?.op).toBe("write");
      // Nothing was there before it, which is what lets a transient write skip git.
      expect(entry?.existed).toBe(false);
      // The scratch directory is outside the checkout, so nothing about it is this
      // process's dirt — the guard's whole reason for existing is that a test's own
      // fixtures are not in the tree.
      expect(recorded.some((candidate) => candidate.path === outside)).toBe(false);
    } finally {
      rmSync(probe, { force: true });
      removeScratchDir(scratch);
    }
  });
});

/** One recorded write, as the filter sees it. */
function entry(file: string, existed: boolean): RecordedWrite {
  return { path: file, op: "write", existed };
}

describe("needingGit", () => {
  it("drops a path that was created and is gone again — the probe a test removes", () => {
    expect(needingGit([entry("/checkout/probe.mjs", false)], () => false)).toEqual([]);
  });

  it("keeps a survivor, a rewrite and a deletion", () => {
    const kept = needingGit(
      [
        entry("/checkout/leaked.mjs", false),
        entry("/checkout/tracked.mjs", true),
        entry("/checkout/deleted.mjs", true),
      ],
      (file) => file !== "/checkout/deleted.mjs",
    );

    expect(kept.map((item) => item.path)).toEqual([
      "/checkout/leaked.mjs",
      "/checkout/tracked.mjs",
      "/checkout/deleted.mjs",
    ]);
  });
});

describe("dirtyWrites", () => {
  it("asks nothing of git when there is nothing to ask about", () => {
    // A quiet file — or one whose only writes were removed again — must not pay for
    // a git call at all; an empty list cannot be dirty.
    expect(dirtyWrites([])).toEqual([]);
  });

  it("names a path this process wrote and left in the checkout", () => {
    const probe = path.join(CHECKOUT, ".freebuff", `.leak-watch-git-${process.pid}.mjs`);
    try {
      writeFileSync(probe, "export const probe = 1;\n", "utf8");
      // The real query, against the real repository: git is what decides dirt, and
      // `.freebuff` is not an ignored directory, so this is exactly the shape the
      // leaked fixture had.
      expect(dirtyWrites([probe])).toEqual([probe]);

      // …and the same path answers clean once the file is gone: the verdict is the
      // tree the file leaves behind, not that it wrote something.
      rmSync(probe, { force: true });
      expect(dirtyWrites([probe])).toEqual([]);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("does not call a path dirty when git ignores it", () => {
    // `.temp/` is the repository's own session scratch, ignored by name: a test
    // writing there is not dirt, and a guard with its own list of blessed
    // directories would be a second place to keep in step with `.gitignore`.
    const ignored = path.join(CHECKOUT, ".temp", `.leak-watch-ignored-${process.pid}.mjs`);
    try {
      // The directory is gitignored and so untracked: it exists in a session's
      // checkout by habit, and in a fresh clone not at all. Creating it is the
      // test's own business — the guard judges the write, not the scaffolding.
      mkdirSync(path.dirname(ignored), { recursive: true });
      writeFileSync(ignored, "export const probe = 1;\n", "utf8");
      expect(dirtyWrites([ignored])).toEqual([]);
    } finally {
      rmSync(ignored, { force: true });
    }
  });
});

describe("leakMessage", () => {
  it("names the path, says the tests are not the failure, and points at the scratch directory", () => {
    const message = leakMessage([path.join(CHECKOUT, "ci-suspect-pin.mjs")]);

    expect(message).toContain("ci-suspect-pin.mjs");
    expect(message).toContain("this file's tests wrote into the checkout and left it dirty");
    expect(message).toContain("1 path(s) git reports as changed");
    // The sentence a reader needs: the run went red with every case green.
    expect(message).toContain("The cases themselves passed: the dirt is the failure.");
    expect(message).toContain("makeScratchDir");
    expect(message).toContain("src/test/scratch.ts");
  });

  it("samples the paths when there are more than it will print", () => {
    const dirty = Array.from({ length: LEAK_SAMPLE_LIMIT + 3 }, (_, i) =>
      path.join(CHECKOUT, "leaks", `f${i}.mjs`),
    );
    const message = leakMessage(dirty);

    expect(message).toContain(`leaks/f${LEAK_SAMPLE_LIMIT - 1}.mjs`);
    expect(message).not.toContain(`leaks/f${LEAK_SAMPLE_LIMIT}.mjs`);
    expect(message).toContain("…and 3 more");
    expect(message).toContain(`${LEAK_SAMPLE_LIMIT + 3} path(s) git reports as changed`);
  });
});

describe("the tripwire's wiring", () => {
  it("loaded the recording preload in the pool, before this file ran", () => {
    // The registry is the proof it ran at all: `setup.ts` throws when it is missing,
    // so a run that got this far has a preload behind it — and this asserts the
    // registry is the module's own key rather than something else's.
    const registry = (globalThis as unknown as Record<PropertyKey, unknown>)[TRIPWIRE_KEY];
    expect(registry, "the preload did not leave its record on globalThis").toBeDefined();
  });

  it("hands the preload to the worker pool from the config", () => {
    expect(configSource, "vitest.config.ts must point execArgv at the preload").toMatch(
      /execArgv:\s*\[[^\]]*leak-watch-preload\.mjs/,
    );
    // …and the same config is the one the pool reads, not a stale copy.
    expect(configSource).toContain("setupFiles");
  });

  it("spells the record's key the same way in both halves", () => {
    // They cannot share a constant without importing the preload from the test graph
    // — which would run it again, after the namespace it has to beat was built — so
    // the spelling is pinned here instead.
    expect(preloadSource).toContain(`Symbol.for(${JSON.stringify(TRIPWIRE_KEY.description)})`);
  });

  it("installs the verdict from the per-file setup, before the file's own modules load", () => {
    expect(setupSource, "setup.ts must call watchForLeaks()").toMatch(
      /import\s*\{[^}]*watchForLeaks[^}]*\}\s*from\s*"\.\/leak-watch"/,
    );
    expect(setupSource, "setup.ts must call watchForLeaks()").toMatch(/watchForLeaks\(\);/);
    // The call sits above the setup's own shims: whatever a later line does, or a
    // test module imports, is written after the patch and therefore seen.
    const call = setupSource.indexOf("watchForLeaks();");
    const firstShim = setupSource.indexOf("if (typeof window");
    expect(call, "the verdict is never installed").toBeGreaterThan(-1);
    expect(firstShim, "the setup's shims are gone").toBeGreaterThan(-1);
    expect(call).toBeLessThan(firstShim);
  });
});
