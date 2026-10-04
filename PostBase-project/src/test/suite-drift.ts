import { fileURLToPath } from "node:url";
import { projectSourceSnapshot, reportDrift, SOURCE_ROOTS, type FileFingerprint } from "./checkout-watch";

/**
 * The suite-level drift watch, registered as Vitest's `globalSetup`.
 *
 * Every per-file check that reads source can straddle another writer's save, and
 * each one says so on its own — but a *failure* can come from a file the check
 * never knew was moving. This watches the whole run instead: one fingerprint
 * before the first test file, one after the last, and a warning naming what moved
 * if the two differ. That warning is what lets a reader tell a source-reading
 * failure caused by a changing checkout apart from a real one, up front, without
 * having to reason about mtimes per test.
 *
 * `globalSetup` runs once in Vitest's own process, which is the only place with a
 * view across every worker and file — `afterAll` belongs to one file, and the
 * files run in parallel. It never fails the run: the checkout moving is a fact
 * about the environment, not a defect in the code, so this reports and gets out
 * of the way. The retrying checks in `lint-baseline.test.ts` still do their own
 * per-check work.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The fingerprint taken before the run; empty until `setup` fills it. */
let before: FileFingerprint = new Map();

export async function setup(): Promise<void> {
  before = projectSourceSnapshot(projectRoot);
  console.log(
    `[checkout-drift] watching ${before.size} files under ${SOURCE_ROOTS.join(", ")} for writes; ` +
      "any change during the run is reported at the end.",
  );
}

export async function teardown(): Promise<void> {
  reportDrift(before, projectSourceSnapshot(projectRoot));
}
