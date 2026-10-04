/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  DRIFT_SAMPLE_LIMIT,
  driftWarning,
  reportDrift,
  type FileFingerprint,
} from "@/test/checkout-watch";
// Importing the global setup proves it loads; calling its `setup`/`teardown`
// would fingerprint the real tree, which is what the run itself does.
import * as suiteDrift from "@/test/suite-drift";
// The config as *source*, so the registration can be asserted without a run.
import configSource from "../../vitest.config.ts?raw";

/**
 * Tests for the suite-level drift warning.
 *
 * The watch exists so a source-reading failure can be told apart from a real one:
 * when the checkout moves mid-run, a guard may be describing a tree that is
 * already gone. Its two halves are pinned here — what the warning says, and that
 * it is actually wired into the run — because a watcher that is silently
 * unregistered is indistinguishable from a quiet checkout.
 */

const snap = (entries: Record<string, string>): FileFingerprint => new Map(Object.entries(entries));

describe("driftWarning", () => {
  it("names the moved files and why the run cannot be trusted", () => {
    const warning = driftWarning(["src/app/page.tsx", "src/lib/db.ts"]);

    expect(warning).toContain("2 source file(s) moved");
    expect(warning).toContain("src/app/page.tsx");
    expect(warning).toContain("src/lib/db.ts");
    // The sentence that makes the warning useful: it tells the reader what to do.
    expect(warning).toContain("already gone");
    expect(warning).toContain("Re-run on a checkout no one else is writing");
  });

  it("samples the paths when there are more than it will print", () => {
    const changed = Array.from({ length: DRIFT_SAMPLE_LIMIT + 5 }, (_, i) => `src/f${i}.ts`);
    const warning = driftWarning(changed);

    expect(warning).toContain(`src/f${DRIFT_SAMPLE_LIMIT - 1}.ts`);
    expect(warning).not.toContain(`src/f${DRIFT_SAMPLE_LIMIT}.ts`);
    expect(warning).toContain(`…and 5 more`);
    // The count is always the true one, even when the list is cut.
    expect(warning).toContain(`${DRIFT_SAMPLE_LIMIT + 5} source file(s) moved`);
  });
});

describe("reportDrift", () => {
  it("says nothing when the tree held still", () => {
    const written: string[] = [];
    const changed = reportDrift(
      snap({ "a.ts": "1:1" }),
      snap({ "a.ts": "1:1" }),
      (message) => written.push(message),
    );

    expect(changed).toEqual([]);
    expect(written).toEqual([]);
  });

  it("warns once, and returns what moved", () => {
    const written: string[] = [];
    const changed = reportDrift(
      snap({ "a.ts": "1:1" }),
      snap({ "a.ts": "1:2" }),
      (message) => written.push(message),
    );

    expect(changed).toEqual(["a.ts"]);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("a.ts");
  });
});

describe("the suite-level drift watch", () => {
  it("is registered as Vitest's globalSetup, not a per-file setup", () => {
    // Without this the watch never runs, and every run looks like a still tree.
    expect(configSource, "globalSetup must point at the drift watch").toMatch(
      /globalSetup\s*:\s*\[[^\]]*suite-drift\.ts/,
    );
    // The per-file setup stays where it was; the watch is a second mechanism.
    expect(configSource, "setupFiles must still load the per-file setup").toMatch(
      /setupFiles\s*:\s*\[[^\]]*setup\.ts/,
    );
  });

  it("exports both halves of the setup lifecycle", () => {
    expect(typeof suiteDrift.setup).toBe("function");
    expect(typeof suiteDrift.teardown).toBe("function");
  });
});
