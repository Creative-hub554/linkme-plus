// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHECKOUT, TRIPWIRE_KEY, recordedWrites } from "@/test/leak-watch";
import { makeScratchDir, removeScratchDir } from "@/test/scratch";

/**
 * The tripwire in the environment that is not the node one — the one it broke.
 *
 * `setup.ts` loads `leak-watch.ts` in *every* environment, and the module's first
 * version worked out the checkout from `import.meta.url`. In a jsdom worker Vitest
 * transforms that file like any other test module, where `import.meta.url` is not a
 * `file:` URL `fileURLToPath` will take — so the import threw and fifty-nine jsdom
 * suites failed to *collect*, none of them about this module and none of them
 * about anything they changed. The checkout is the process's working directory now;
 * these cases exist so the same mistake fails one named file instead of every DOM
 * suite. They also show the record is reachable, and a named `node:fs` import is
 * recorded, in this environment rather than only in the node ones.
 *
 * The writes below are removed in a `finally` for the reason every transient probe
 * here is: what the tripwire judges is the tree the file leaves behind, and a probe
 * that is gone again answers clean.
 */
describe("the tripwire in a jsdom worker", () => {
  it("loads, and reads the checkout as this project's directory", () => {
    // The cost of the trap: this has to be the real directory, not the empty string
    // a failed read-back would leave and not Vite's transformed URL.
    expect(path.isAbsolute(CHECKOUT)).toBe(true);
    expect(CHECKOUT).toBe(process.cwd());
    expect(existsSync(path.join(CHECKOUT, "package.json"))).toBe(true);
    expect(existsSync(path.join(CHECKOUT, "src", "test", "leak-watch.ts"))).toBe(true);
  });

  it("was installed by the preload, and records this environment's writes", () => {
    expect(
      (globalThis as unknown as Record<PropertyKey, unknown>)[TRIPWIRE_KEY],
      "the preload did not leave its record on globalThis in a jsdom worker",
    ).toBeDefined();

    const probe = path.join(CHECKOUT, ".freebuff", `.leak-watch-jsdom-${process.pid}.mjs`);
    const scratch = makeScratchDir("leak-watch-jsdom-");
    const outside = path.join(scratch, "not-the-checkout.mjs");
    try {
      writeFileSync(probe, "export const probe = 1;\n", "utf8");
      writeFileSync(outside, "export const probe = 1;\n", "utf8");

      const recorded = recordedWrites().map((entry) => entry.path);
      expect(recorded, "a named node:fs import was not recorded under jsdom").toContain(probe);
      // The scratch directory is outside the checkout, so it is not this process's
      // dirt however a test wrote it — the guard's whole premise.
      expect(recorded).not.toContain(outside);
    } finally {
      rmSync(probe, { force: true });
      removeScratchDir(scratch);
    }
  });
});
