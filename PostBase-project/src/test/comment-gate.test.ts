/**
 * `.freebuff/comment-gate.mjs` — the step that turns a failed comment step into a red job.
 *
 * Every comment step in `ci.yml` is `continue-on-error: true`, which is deliberate: a comment
 * that could not be posted must not stop the drift check, the coverage-mutation check or the
 * artifact uploads that follow it. The price is that the job stayed green, and the run page's
 * note was then the only sign anything was wrong — on a page a green check sends nobody to
 * read. So the poster's exit status answers *is the comment on the pull request*, this reads
 * that answer back per step from `steps.<id>.outcome`, and the job is failed when a step that
 * ran did not post.
 *
 * Followed the way `pr-comment.test.ts` follows the poster: the real script, spawned, with
 * `GITHUB_STEP_SUMMARY` pointed at a file this test reads back. *Which* outcomes a job passes
 * is the workflow's business and is pinned in `src/test/collect-budget.test.ts`; what the gate
 * makes of them is here.
 *
 * The pair of outcomes this turns on is `success`/`skipped` against `failure`/`cancelled`, and
 * the tests below keep them apart on both sides, because the gate's one fatal failure mode is
 * a verdict that reads as a pass: an outcome word it does not recognize is a refused
 * invocation rather than a step it assumes was fine.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateAnnouncement,
  parseEntries,
  unposted,
  UsageError,
} from "../../.freebuff/comment-gate.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = join(projectRoot, ".freebuff", "comment-gate.mjs");

/** The heading the run page carries when the job fails for an unposted comment. */
const HEADING = "## Comments — ❌ a comment this run owed was not posted";

/** A directory, a run page, and a runner that spawns the real gate in it. */
function harness() {
  const dir = mkdtempSync(join(tmpdir(), "comment-gate-"));
  const summary = join(dir, "run-page.md");
  return {
    dir,
    summary,
    run: (args: string[], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary, ...env },
      }),
    summaryText: () => (existsSync(summary) ? readFileSync(summary, "utf8") : ""),
  };
}

describe("the verdict it passes", () => {
  it("passes when every step posted, and says how many were owed", () => {
    const { run, summaryText } = harness();

    const result = run(["Probe comment=success", "Probe reply=success"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("every step that owed a comment posted one (2 of 2; 0 not owed)");
    // Nothing to report is nothing to write: the run page is for the loss, and this is not one.
    expect(summaryText()).toBe("");
  });

  it("passes a step that ran and posted nothing, and one that was never owed a comment", () => {
    // The distinction the gate exists to make, and the reason it takes a list rather than a
    // count: `skipped` is a fact about the run — a fork's pull request, whose token cannot
    // comment, or a proposal the proposer did not earn — while `failure` is a comment this run
    // did owe. Reading one as the other would either fail every fork or pass every loss.
    const { run, summaryText } = harness();

    const result = run(["Probe comment=success", "Probe reply=skipped"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("(1 of 2; 1 not owed)");
    expect(summaryText()).toBe("");
  });

  it("passes a job where no comment was owed at all", () => {
    const { run, summaryText } = harness();

    const result = run(["Probe reply=skipped"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("(0 of 1; 1 not owed)");
    expect(summaryText()).toBe("");
  });
});

describe("the verdict it fails", () => {
  it("fails the job when a step ran and posted nothing", () => {
    const { run, summaryText } = harness();

    const result = run(["Probe comment=success", "Probe reply=failure"]);

    // 1, which is what makes the job red: the step itself was `continue-on-error`, so this is
    // the only thing standing between a missing comment and a green check mark.
    expect(result.status).toBe(1);
    // The annotation is what the checks list shows beside the red step; the line under it is
    // for the log, which is where a reader ends up when the annotation is all they saw.
    expect(result.stderr).toContain("::error title=Probe reply::");
    expect(result.stderr).toContain("comment-gate: Probe reply — the step ran and no comment");
    expect(summaryText()).toContain(HEADING);
    expect(summaryText()).toContain("- **Probe reply** — the step ran and no comment was posted");
    // The step that posted is not named: the note is a list of what is missing.
    expect(summaryText()).not.toContain("- **Probe comment**");
  });

  it("names every step that owed a comment, in the order it was given them", () => {
    const { run, summaryText } = harness();

    const result = run(["Probe comment=failure", "Probe reply=success", "Probe third=failure"]);

    expect(result.status).toBe(1);
    const page = summaryText();
    expect(page).toContain("- **Probe comment**");
    expect(page).toContain("- **Probe third**");
    expect(page.indexOf("- **Probe comment**")).toBeLessThan(page.indexOf("- **Probe third**"));
  });

  it("treats a cancelled step as a comment that did not arrive", () => {
    // The one outcome that is neither a posted comment nor a step that was never owed one, so
    // it cannot be read as either: it failed to post, and the wording says the step never got
    // there rather than that it tried and was refused.
    const { run, summaryText } = harness();

    const result = run(["Probe reply=cancelled"]);

    expect(result.status).toBe(1);
    expect(summaryText()).toContain("- **Probe reply** — the step was cancelled before it could post");
  });
});

describe("the invocation it refuses", () => {
  it.each([
    ["no entries at all", [], "at least one <label>=<outcome> is required"],
    ["an entry with no outcome", ["Probe comment"], "needs a label"],
    ["an entry with no label", ["=success"], "needs a label"],
    ["an outcome Actions does not produce", ["Probe comment=nope"], "does not produce"],
    ["an outcome in the wrong case", ["Probe comment=Success"], "does not produce"],
  ])("refuses %s rather than reading it as a pass", (_case, args, message) => {
    const { run, summaryText } = harness();

    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("usage: comment-gate.mjs");
    // And nothing was published: a refused invocation is not a verdict about a run.
    expect(summaryText()).toBe("");
  });
});

describe("the pieces it is read through", () => {
  it("splits an entry at its last `=`, so a label may contain one", () => {
    expect(parseEntries(["Probe comment=success"])).toEqual([
      { label: "Probe comment", outcome: "success" },
    ]);
    expect(parseEntries(["a=b=failure"])).toEqual([{ label: "a=b", outcome: "failure" }]);
    expect(() => parseEntries([])).toThrow(UsageError);
    expect(() => parseEntries(["Probe comment="])).toThrow(UsageError);
    expect(() => parseEntries(["Probe comment=passed"])).toThrow(UsageError);
  });

  it("keeps only the entries that mean a comment did not arrive", () => {
    const entries = parseEntries([
      "a=success",
      "b=skipped",
      "c=failure",
      "d=cancelled",
    ]);

    expect(unposted(entries).map((entry) => entry.label)).toEqual(["c", "d"]);
    expect(unposted([])).toEqual([]);
  });

  it("writes the run-page note around the labels and their outcomes", () => {
    // The consequence rather than the diagnosis: each comment step's own note above says what
    // went wrong with it, and this says what the job did about it — which is why the two notes
    // are matched by label in `collect-budget.test.ts`.
    const note = gateAnnouncement([
      { label: "Probe comment", outcome: "failure" },
      { label: "Probe reply", outcome: "cancelled" },
    ]);

    expect(note).toContain(HEADING);
    expect(note).toContain("- **Probe comment** — the step ran and no comment was posted");
    expect(note).toContain("- **Probe reply** — the step was cancelled before it could post");
    expect(note).toContain("this is the step that turns that into a red job");
  });
});
