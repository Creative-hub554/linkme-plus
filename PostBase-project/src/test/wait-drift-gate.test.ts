/**
 * `.freebuff/wait-drift-gate.mjs` — the step that turns a refuted settlement record into a red job.
 *
 * The settle step is `continue-on-error: true`, and that is the doctrine the comment steps share: a
 * night must still record, comment and upload whatever the record turns out to say. What that step
 * cannot do is take the night's verdict — a red there would mean the history stopped accruing, which
 * is a different fact from a crossing line these settlements cannot produce — so the finding travels
 * as the count the module published on its `wait-drift` output and this reads it back.
 *
 * Followed the way `comment-gate.test.ts` follows its own: the real script, spawned, with
 * `GITHUB_STEP_SUMMARY` pointed at a file this test reads back. *That* the workflow wires the step to
 * the settle step's output is pinned in `src/test/coverage-low-water.test.ts`; what the gate makes of
 * the value it is handed is here.
 *
 * Two cases at the end follow the *pairs* instead: the bodies this step writes are handed to
 * `.freebuff/pr-comment.mjs` with a stub `gh`, because each pair is one action in the workflow — the
 * gate composes the note (and the ending of a thread that is over) and publishes the request it goes
 * on, the poster rewrites the marked comment there — and either step's own suite would stay green if
 * the two stopped agreeing about the file, the request, or the marker the poster finds the comment by.
 *
 * …and another drives the *writer* beside this step, over one runbook: the settle step and the gate, each
 * invoked the way the job invokes it, with the values the writer actually published handed to the reader.
 * The count this gate judges is published by a step this suite never runs, so a renamed output, a block
 * file the two stopped agreeing on or a line identity that stopped travelling would leave this file's own
 * cases and that module's green — which is what that case is for.
 *
 * The distinction this turns on is empty against `0`: an empty count is a step that never judged a
 * record (it was skipped, or it could not read one), while `0` is a record that was read and holds
 * nothing refuted. And the one fatal failure mode a gate must not have — a value it does not
 * understand reading as a pass — is a refused invocation here, not a verdict.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// The job the two steps are read out of, as text, the way `coverage-low-water.test.ts` reads it: the
// invocations, the paths and the outputs the case at the end drives are the file's rather than a copy.
import nightlySource from "../../.github/workflows/nightly.yml?raw";
// The writer's own record of a crossing: the line it appends is read back with the module's own reader
// and moved with the module's own builder, so the fixture cannot drift from the shape the runbook is
// read in either.
import { waitCrossing, waitCrossings } from "../../.freebuff/coverage-trend.mjs";
import {
  endedNote,
  gateAnnouncement,
  options,
  parseEntries,
  RECORD_COMMENT_MARKER,
  recordReport,
  recordRetraction,
  refuted,
  repairComment,
  settledRequest,
  standingComment,
  UsageError,
  verdictRecord,
} from "../../.freebuff/wait-drift-gate.mjs";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = join(projectRoot, ".freebuff", "wait-drift-gate.mjs");

/** The heading the run page carries when the night fails over the record. */
const HEADING = "## Settled-wait record — ❌ a crossing line the settlements do not produce";

/** …and the one the artifact's record carries on the ordinary night. */
const HELD_HEADING = "## Settled-wait record — ✅ no crossing line the settlements do not produce";

/**
 * The block the settle step publishes through `.freebuff/coverage-trend.mjs --drift`, as that module
 * writes it — the lines, in the sentences the run page states them in. Written by hand rather than by
 * spawning the settle mode: what this gate does with the file is the question here, and the block's own
 * rendering is pinned in `coverage-low-water.test.ts`, where the night that produces it runs.
 */
const BLOCK = [
  "#### A crossing line the records do not produce",
  "",
  "The runbook's record of the crossings a comment has already been about (`.freebuff/run.md`) is the",
  "bar this job's own decision is written in.",
  "",
  "- **#604 on 2026-11-05** — the records hold no night whose middle is 6 night(s), so the crossing it",
  "  states never happened.",
  "",
  // …and its close: the block is where the *repair* is stated, which is the reason the night's comment
  // does not restate it — the two surfaces word one line once, and both quote this.
  "The repair is the record's: re-derive the line from the settlements, or delete it and let the next",
  "rise say the crossing again.",
  "",
].join("\n");

/** The line the block above refutes, as the settle step publishes it beside its own count. */
const REFUTED_LINE = "#604 on 2026-11-05";

/** A runbook with something in it, so the place a report line takes in the file is visible. */
const RUNBOOK = ["# Runbook", "", "The record the nights were read against.", ""].join("\n");

/** The label the settle step publishes its count under, which every line below is paired with. */
const LABEL = "Settled-wait drift";

/**
 * The two lines this module appends to the runbook, spelled here as the *module* spells them.
 *
 * Written as builders rather than imported from it on purpose: the shape is the half of the dedupe the
 * two runners have to agree on — the gate writes the line and, on a later night, reads its own line back
 * to decide whether the comment has already been said — so a shape that moved without this suite moving
 * would quietly re-post every night. The literal is asserted once, below, and the rest of the file reads
 * through these.
 */
const reportLine = (night: string, request: string, ...lines: string[]) =>
  `- **${night} — refuted crossing line reported on #${request}: ${lines.join("; ")}.**`;
const retractLine = (night: string, request: string, ...lines: string[]) =>
  `- **${night} — refuted crossing line retracted on #${request}: ${lines.join("; ")}.**`;

/**
 * A floor proposal that has been answered, as `.freebuff/coverage-trend.mjs` records it in the runbook.
 *
 * The line the gate reads to learn that the request a comment stands on has ended. Written as a literal for
 * the reason the two builders above are: what the two modules have to agree on is the shape, and
 * `coverage-low-water.test.ts` pins the same line where it is *written*. This is the fixture half of one
 * agreement rather than a second copy of a rule — the gate itself reads it through that module's own
 * reader.
 */
const settledLine = (night: string, request: string, outcome: string, nights: number) =>
  `- **${night} — floor proposal #${request}: ${outcome} after ${nights} night${nights === 1 ? "" : "s"}.**`;

/**
 * The other kind's line: a collect-budget proposal left on that pull request, as the same module records it.
 *
 * The two kinds are the two halves of the question the gate asks — is the pull request a comment sits on still
 * there — and they answer it differently, which is the whole of what this line brings to the suite: a floor
 * proposal's line *is* the request, so any of them ends the thread, while a collect proposal's is the ending of
 * an ask left as a comment, where a reply ends the ask and `closed unanswered` is the close. Written as a
 * literal for the reason the line above is, and the collect head is pinned where it is written, in
 * `coverage-low-water.test.ts`.
 */
const collectSettledLine = (night: string, request: string, outcome: string, nights: number) =>
  `- **${night} — collect-budget proposal on #${request}: ${outcome} after ${nights} night${
    nights === 1 ? "" : "s"
  }.**`;

/**
 * …and the module's *other* record of a thread ending: the pull request behind that ask, gone after the ask
 * was answered.
 *
 * A collect ask can be answered weeks before the pull request it sits on goes away, so the settlement line
 * states the ask's ending and nothing about the request's — which is why the gate has to read this line as
 * well, and why a comment there is safe from a rewrite only because of it. Written as a literal for the same
 * reason as the two lines above, head only, and pinned where it is *written* (`coverage-low-water.test.ts`)
 * rather than here.
 */
const closeLine = (date: string, request: string) =>
  `- **${date} — the pull request behind collect-budget proposal #${request} closed, after the ask there ` +
  "was answered.**";

/**
 * …and the module's *correction* of that close: the pull request behind the ask, open again.
 *
 * The third shape the module writes about a thread, and the one this read had to learn to take the *last*
 * word about a request rather than the bleakest: a close that a later night recorded a reopening for is not
 * the end of anything, so a comment on that thread is one to rewrite again — which is what separates the
 * record from a permanent claim. Written as a literal for the same reason as the three lines above, head
 * only, and the two nouns it can name the request by are one head (`THREAD_NOUNS`): a floor proposal can be
 * reopened exactly as one left on somebody else's pull request can, so a correction is read for either kind.
 */
const reopenLine = (
  night: string,
  request: string,
  closed: string,
  noun = "the pull request behind collect-budget proposal",
) => `- **${night} — ${noun} #${request} reopened, after the close recorded for ${closed}.**`;

/** One line of a record, as the `--set` flag and these runbook lines both spell it. */
const named = (line: string) => `${LABEL}=${line}`;

/**
 * One step's YAML block, found by its `name:`, so the case that drives a pair reads like the file does.
 *
 * Read out of `nightly.yml`'s text rather than restated, because the agreement between the two steps at
 * the end of this file *is* the flags, the paths and the outputs they pass between them: a copy here
 * would be edited alongside a rename and go on passing while the job it describes stopped working.
 */
function stepBlock(name: string): string {
  const marker = `      - name: ${name}`;
  const start = nightlySource.indexOf(marker);
  expect(start, `the nightly job has no step named ${name}`).toBeGreaterThan(-1);
  const next = nightlySource.indexOf("\n      - name: ", start + marker.length);
  return nightlySource.slice(start, next === -1 ? nightlySource.length : next);
}

/**
 * The shell a step runs, and nothing a comment above the next step says.
 *
 * A `run:` block's body is the lines indented past it, while the prose paragraphs *between* two steps are
 * indented shallower — so reading on until the indentation drops is what keeps a neighbouring step's
 * comment out of the argv below, which would otherwise be parsed as flags.
 */
function runBlock(step: string): string {
  const lines = step.split("\n");
  const at = lines.findIndex((line) => line.trim() === "run: |");
  expect(at, "the step has no `run:` block").toBeGreaterThan(-1);
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !/^ {10,}\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/**
 * The argv a step hands a module, as that step's own shell would read it: `\` continuations joined, a
 * quoted word one token whatever spaces it holds (the `--set` entries do), and the quotes off.
 *
 * The first token is the module the step names, which the cases below resolve against the project root
 * rather than against a working directory: the flags are left exactly as the step spells them, so the
 * paths they name are the ones the two steps have to agree on.
 */
function argvOf(step: string, module: string): string[] {
  const invocation = `node ${module}`;
  const at = step.indexOf(invocation);
  expect(at, `the step never runs ${module}`).toBeGreaterThan(-1);
  const tokens =
    step
      .slice(at + "node ".length)
      .replace(/\\\r?\n/g, " ")
      .match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) => token.replace(/^["']|["']$/g, ""));
}

/** Every `--flag <value>` pair an invocation states, in the order it states them. */
function flagValues(argv: string[], flag: string): string[] {
  return argv.filter((_token, index) => argv[index - 1] === flag);
}

/** The values a step published, as the file `$GITHUB_OUTPUT` names holds them. */
function outputsOf(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const equals = line.indexOf("=");
    if (equals > 0) values[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return values;
}

/** A directory, a run page, and a runner that spawns the real gate in it. */
function harness() {
  const dir = mkdtempSync(join(tmpdir(), "wait-drift-gate-"));
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
  it("passes a record that was read and holds nothing refuted", () => {
    const { run, summaryText } = harness();

    const result = run(["Settled-wait drift=0"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "no crossing line the settlements do not produce (1 of 1 judged; 0 not judged)",
    );
    // Nothing to report is nothing to write: the run page is for the finding, and this is not one.
    expect(summaryText()).toBe("");
  });

  it("passes a step that judged nothing, and says so rather than counting it as a record", () => {
    // The distinction the gate exists to make: an empty output is the settle step skipped, or one that
    // read no record at all — nothing was judged, so nothing fails here. The record's own check is the
    // trend step's, which reads the runbook whatever the settle step did.
    const { run, summaryText } = harness();

    const result = run(["Settled-wait drift="]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("(0 of 1 judged; 1 not judged)");
    expect(summaryText()).toBe("");
  });

  it("passes a job where several records were handed to it and none is refuted", () => {
    const { run } = harness();

    const result = run(["Settled-wait drift=0", "Other record="]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("(1 of 2 judged; 1 not judged)");
  });
});

describe("the verdict it fails", () => {
  it("fails the job when the record states a line the settlements cannot produce", () => {
    const { run, summaryText } = harness();

    const result = run(["Settled-wait drift=1"]);

    // 1, which is what makes the job red: the step that found it was `continue-on-error`, so this is
    // the only thing standing between a refuted record and a green check mark.
    expect(result.status).toBe(1);
    // The annotation is what the checks list shows beside the tolerated step's own note; the line
    // under it is for the log, which is where a reader ends up when the annotation is all they saw.
    expect(result.stderr).toContain("::error title=Settled-wait drift::");
    expect(result.stderr).toContain("the settlement record states 1 crossing line");
    expect(result.stderr).toContain(
      "wait-drift-gate: Settled-wait drift — 1 crossing line the settlements cannot produce",
    );
    expect(summaryText()).toContain(HEADING);
    expect(summaryText()).toContain(
      "- **Settled-wait drift** — 1 crossing line the record holds that these settlements cannot " +
        "produce; the section the settle step rendered names each of them and the repair.",
    );
    // …and the consequence is what this says, not the diagnosis: the section the settle step rendered
    // carries the lines and the repair, and this points at it rather than restating them.
    expect(summaryText()).toContain("this is the step that turns that finding into a red job");
  });

  it("counts the lines it is told about, and says which record holds them", () => {
    const { run, summaryText } = harness();

    const result = run(["Settled-wait drift=3"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error title=Settled-wait drift::");
    expect(result.stderr).toContain("3 crossing lines");
    expect(summaryText()).toContain("- **Settled-wait drift** — 3 crossing lines");
  });

  it("names every record that is refuted, in the order it was given them", () => {
    const { run, summaryText } = harness();

    const result = run(["First record=1", "Second record=0", "Third record=2"]);

    expect(result.status).toBe(1);
    const page = summaryText();
    expect(page).toContain("- **First record**");
    expect(page).toContain("- **Third record**");
    // The one that judged a clean record is not named: the note is a list of what is wrong.
    expect(page).not.toContain("- **Second record**");
    expect(page.indexOf("- **First record**")).toBeLessThan(page.indexOf("- **Third record**"));
  });
});

/**
 * The record the verdict leaves behind — the half of this step that outlives the run.
 *
 * A verdict read once is not one kept: the run page rolls away, while a refuted crossing line is a
 * finding about the runbook, a file people edit and somebody re-reads months later. So the gate writes
 * the verdict into the night's artifact (`--record`) and appends the same text to the review summary
 * the artifact carries (`--summary`), quoting the block the settle step published (`--drift`) so that
 * the lines are in the file rather than only pointed at.
 */
describe("the record it leaves in the artifact", () => {
  it("writes the night's verdict where a reader months later meets it", () => {
    const { dir, summary, run, summaryText } = harness();
    // The run page and the artifact's review summary are two files, and the night writes both: the
    // announcement on the page a reviewer of the run opens, the record in the file that outlives it.
    const page = join(dir, "night-run-page.md");
    const lines = join(dir, "wait-drift-lines.md");
    const record = join(dir, "wait-drift.md");
    writeFileSync(lines, BLOCK);
    // What the publish step already put in the review summary earlier in the job: the record is a
    // *section* of a night's review, appended after the gate's own report rather than replacing it.
    const report = "## Nightly full CI gate — ✅ all 11 stage(s) passed\n";
    writeFileSync(summary, report);

    const result = run(
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--record",
        record,
        "--summary",
        summary,
        "Settled-wait drift=1",
      ],
      { GITHUB_STEP_SUMMARY: page },
    );

    expect(result.status, result.stderr).toBe(1);
    const text = readFileSync(record, "utf8");
    // The verdict, the name the run page calls the finding, the sentence that says why a decided step
    // cannot have been the one to stop the night — and then the lines themselves, quoted from the block
    // the settle step published, because this file is read on its own.
    expect(text).toContain(HEADING);
    expect(text).toContain(
      "- **Settled-wait drift** — 1 crossing line the record holds that these settlements cannot " +
        "produce; the section the settle step rendered names each of them and the repair.",
    );
    expect(text).toContain("this is the step that turns that finding into a red job");
    // …then the lines, under the label the verdict is read by: one block per record, so a night with
    // two series cannot quote one kind's lines under the other's name.
    expect(text).toContain("### Settled-wait drift");
    expect(text).toContain("#### A crossing line the records do not produce");
    expect(text).toContain("#604 on 2026-11-05");
    // …and the summary is the review with the record after it, not the record alone.
    expect(summaryText()).toBe(`${report}\n${text}`);
    // The run page keeps the announcement it always had: a pointer at the section, since the page a
    // reviewer of *this* run opens has the section on it.
    expect(readFileSync(page, "utf8")).toContain(HEADING);
    expect(readFileSync(page, "utf8")).not.toContain("#604 on 2026-11-05");
    // The log says where the file went, since the run page is not where it is read.
    expect(result.stderr).toContain(`the verdict record to ${record}`);
  });

  it("records the night the check held, rather than leaving the artifact to say nothing", () => {
    // The two states a later reader has to tell apart are "the record was read and held" and "the step
    // never judged anything", and an absent file says neither. So the ordinary night is written down
    // too — and the block the settle step did *not* publish is not quoted into it.
    const { dir, summary, run, summaryText } = harness();
    const record = join(dir, "wait-drift.md");

    const result = run([
      "--drift",
      `Settled-wait drift=${join(dir, "never-written.md")}`,
      "--record",
      record,
      "--summary",
      summary,
      "Settled-wait drift=0",
    ]);

    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(record, "utf8");
    expect(text).toContain(HELD_HEADING);
    expect(text).toContain(
      "- **Settled-wait drift** — 0 crossing lines: every line the record holds is one these " +
        "settlements produce.",
    );
    expect(text).toContain("nothing about it failed");
    expect(text).not.toContain("#### A crossing line the records do not produce");
    expect(summaryText()).toBe(`\n${text}`);
    expect(result.stdout).toContain("the verdict record to " + record);
  });

  it("writes nothing at all when the settle step never judged the record", () => {
    // An empty count is a step that did not run: there is no verdict to keep, so the file's absence is
    // what a reader meets — and it means exactly this, not a night that passed quietly.
    const { dir, summary, run, summaryText } = harness();
    const record = join(dir, "wait-drift.md");
    const report = "## Nightly full CI gate — ✅ all 11 stage(s) passed\n";
    writeFileSync(summary, report);

    const result = run(["--record", record, "--summary", summary, "Settled-wait drift="]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(record)).toBe(false);
    expect(summaryText()).toBe(report);
    expect(result.stdout).toContain("(0 of 1 judged; 1 not judged)");
    expect(result.stdout).not.toContain("the verdict record to");
  });

  it("points at the section instead when the block it would quote was not published", () => {
    // Two ways of having no lines to quote, and the record says which, because a silent omission would
    // read exactly like a night with nothing to quote — and the lines are still reachable, in the
    // section the settle step rendered into the same artifact.
    const { dir, run } = harness();
    const record = join(dir, "wait-drift.md");
    const missing = join(dir, "never-written.md");

    const named = run([
      "--drift",
      `Settled-wait drift=${missing}`,
      "--record",
      record,
      "Settled-wait drift=2",
    ]);
    expect(named.status).toBe(1);
    expect(readFileSync(record, "utf8")).toContain("### Settled-wait drift");
    expect(readFileSync(record, "utf8")).toContain(
      `The lines are not quoted here: ${missing} held nothing to quote, so the section the settle `,
    );

    const unnamed = run(["--record", record, "Settled-wait drift=1"]);
    expect(unnamed.status).toBe(1);
    expect(readFileSync(record, "utf8")).toContain(
      "The lines are not quoted here: no `--drift` file was named for this record",
    );
  });

  it("quotes each record's own block under its own name", () => {
    // The night watches two series, and both records can be refuted in one run: the floor's crossings
    // and the collect proposals'. Each block is quoted under the label its own count was published
    // under, and the pairing is by label rather than by position precisely so that this cannot come to
    // quote one kind's lines under the other's name.
    const { dir, run } = harness();
    const record = join(dir, "wait-drift.md");
    const floor = join(dir, "floor-drift.md");
    const collect = join(dir, "collect-drift.md");
    writeFileSync(floor, BLOCK);
    writeFileSync(collect, "#### A collect proposal no night raised\n\n#612 on 2026-11-05\n");

    const result = run([
      "--drift",
      `Settled-wait drift=${floor}`,
      "--drift",
      `Collect-wait drift=${collect}`,
      "--record",
      record,
      "Settled-wait drift=1",
      "Collect-wait drift=2",
    ]);

    expect(result.status, result.stderr).toBe(1);
    const text = readFileSync(record, "utf8");
    // Two sections, each under the label its count is announced under, each holding that record's lines
    // and nothing of the other's.
    expect(text).toContain("### Settled-wait drift");
    expect(text).toContain("### Collect-wait drift");
    const floorAt = text.indexOf("### Settled-wait drift");
    const collectAt = text.indexOf("### Collect-wait drift");
    expect(floorAt).toBeGreaterThan(-1);
    expect(collectAt).toBeGreaterThan(floorAt);
    expect(text.slice(floorAt, collectAt)).toContain("#604 on 2026-11-05");
    expect(text.slice(floorAt, collectAt)).not.toContain("#612 on 2026-11-05");
    expect(text.slice(collectAt)).toContain("#612 on 2026-11-05");
    expect(text.slice(collectAt)).not.toContain("#604 on 2026-11-05");
  });

  it("refuses a block named for a record the invocation does not judge", () => {
    // A `--drift` names the label it belongs to, so a name nothing carries is a mis-wired step: quoting
    // it would put one record's lines under a label the run never judged, and dropping it silently would
    // leave the record saying its block was never published when it was.
    const { run, summaryText } = harness();

    const result = run(["--drift", "Other drift=d.md", "Settled-wait drift=1"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("names a record this invocation does not judge");
    expect(summaryText()).toBe("");
  });

  it("renders the night's comment on the same verdict, and nothing at all when nothing is refuted", () => {
    // The record is a file in an artifact and the annotation a line in a checks list, and neither reaches a
    // person — while the repair this finding asks for is an edit to `.freebuff/run.md` by hand. So the same
    // verdict is rendered a second time, as the body of the night's comment, and it has to stand on its own:
    // which record is refuted, the line itself, and what to do about it.
    const { dir, run } = harness();
    const record = join(dir, "wait-drift.md");
    const comment = join(dir, "wait-drift-repair.md");
    const lines = join(dir, "wait-drift-lines.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(runbook, RUNBOOK);

    const red = run([
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      `Settled-wait drift=${REFUTED_LINE}`,
      "--runbook",
      runbook,
      // …and where it goes on a night no comment stands yet, which is the one night the gate cannot read
      // the request off the runbook: a refutation reported nowhere reaches nobody.
      "--request",
      "604",
      "--record",
      record,
      "--comment",
      comment,
      "--today",
      "2026-11-06",
      "Settled-wait drift=1",
    ]);

    expect(red.status, red.stderr).toBe(1);
    const body = readFileSync(comment, "utf8");
    // The marker the poster and the retraction step below look the comment up by — the export itself, so
    // a body whose first line moved fails here before the workflow can post a second comment a night; the
    // two lookups in the workflow are held to the same literal in `coverage-low-water.test.ts`.
    expect(body).toContain(RECORD_COMMENT_MARKER);
    expect(body).toContain("## The settled-wait record is refuted — a crossing line the settlements");
    expect(body).toContain("- **Settled-wait drift** — 1 crossing line the settlements cannot produce.");
    expect(body).toContain("### Settled-wait drift");
    expect(body).toContain("#604 on 2026-11-05");
    // The repair reaches the comment through the block it quotes rather than as a sentence of the gate's
    // own — `coverage-trend` writes that close, and a comment that restated it would be the third wording
    // of one instruction. The close says what this surface adds: the night stays red, and where the kept
    // verdict is.
    expect(body).toContain(
      "The repair is the record's: re-derive the line from the settlements, or delete it and let the next",
    );
    expect(body).toContain(
      "The night keeps failing until the record is repaired — each block above names the line it refutes",
    );
    // …and it is the *night's* comment rather than the record under another name: the record's own framing
    // — why the file exists, what it means that it is written on a green night too — belongs to the file,
    // and a comment has to be readable by somebody who has not read this module.
    expect(body).not.toContain("This is written down rather than left to the absence of a file");
    expect(body).not.toContain("The lines are quoted below as well");
    expect(readFileSync(record, "utf8")).toContain("The lines are quoted below as well");
    // The log says where both files went, since neither is read on the run page.
    expect(red.stderr).toContain(`the verdict record to ${record}`);
    expect(red.stderr).toContain(`the night's comment to ${comment}`);
    // …and the night that said it is recorded, which is the whole of what keeps the comment an event: the
    // runbook is where a later night reads what has already been reported, and the line is written where
    // the crossings are written — a blank line, then the bullet, which is the shape `coverage-trend`'s own
    // crossing lines have.
    const said = readFileSync(runbook, "utf8");
    expect(said).toContain(reportLine("2026-11-06", "604", named(REFUTED_LINE)));
    expect(said.endsWith(`\n\n${reportLine("2026-11-06", "604", named(REFUTED_LINE))}\n`)).toBe(true);

    // A night the check *held*: no body at all, which is what keeps the poster's step `skipped` rather
    // than posting a comment that says nothing — and nothing recorded either, since there is nothing this
    // night said.
    const heldComment = join(dir, "held-repair.md");
    const held = run([
      "--comment",
      heldComment,
      "--set",
      "Settled-wait drift=",
      "--runbook",
      runbook,
      "Settled-wait drift=0",
    ]);

    expect(held.status, held.stderr).toBe(0);
    expect(existsSync(heldComment)).toBe(false);
    expect(held.stderr).not.toContain("the night's comment to");

    // …and a night the settle step never judged: nothing judged is no verdict, so no comment either.
    const none = join(dir, "none-repair.md");
    const unjudged = run([
      "--comment",
      none,
      "--set",
      "Settled-wait drift=",
      "--runbook",
      runbook,
      "Settled-wait drift=",
    ]);

    expect(unjudged.status, unjudged.stderr).toBe(0);
    expect(existsSync(none)).toBe(false);
    // Neither night wrote a report line: the record of what has been said is written by the step that says
    // it, and both these nights had nothing to say.
    expect(readFileSync(runbook, "utf8")).toBe(said);
  });

  it("refuses a comment it could not write, with the verdict itself still kept", () => {
    // A file the step was asked for and did not write is the invocation being refused, which is not the
    // same fact as a refuted record — and the record is the *first* write, so a comment that could not be
    // rendered leaves the night's verdict exactly where it would have been: in the artifact and on the
    // checks list, with the loss named as the comment's.
    const { dir, run } = harness();
    const record = join(dir, "wait-drift.md");

    const runbook = join(dir, "run.md");
    writeFileSync(runbook, RUNBOOK);

    const result = run([
      "--record",
      record,
      "--comment",
      join(dir, "no-such-directory", "wait-drift-repair.md"),
      "--set",
      `Settled-wait drift=${REFUTED_LINE}`,
      "--runbook",
      runbook,
      "--request",
      "604",
      "Settled-wait drift=1",
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot write");
    expect(result.stderr).toContain("::error title=Settled-wait drift::");
    expect(readFileSync(record, "utf8")).toContain(HEADING);
    // …and nothing was reported: a comment that was never written is not a night that said the finding, so
    // the record of what has been said is untouched and the next night says it again.
    expect(readFileSync(runbook, "utf8")).toBe(RUNBOOK);
  });

  it("refuses a record it could not write, with the finding itself still stated", () => {
    // The file is asked for, so a run that could not write it did not do what it was asked: exit 2 is
    // the invocation being refused, which is not the same fact as a refuted record. But the finding was
    // judged before any file was opened — the same order `coverage-trend`'s own `--output` has — so a
    // write that could not happen does not also hide the refutation from the log and the checks list.
    // Both facts are red; the night stops either way.
    const { dir, run } = harness();

    const result = run([
      "--record",
      join(dir, "no-such-directory", "wait-drift.md"),
      "Settled-wait drift=1",
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot write");
    expect(result.stderr).toContain("::error title=Settled-wait drift::");
    expect(result.stderr).not.toContain("the verdict record to");
  });
});

describe("the invocation it refuses", () => {
  it.each([
    ["no entries at all", [], "at least one <label>=<count> is required"],
    ["an entry with no count", ["Settled-wait drift"], "needs a label"],
    ["an entry with no label", ["=1"], "needs a label"],
    ["a word where a count belongs", ["Settled-wait drift=refuted"], "does not name a count of lines"],
    ["a negative count", ["Settled-wait drift=-1"], "does not name a count of lines"],
    ["a fraction", ["Settled-wait drift=1.5"], "does not name a count of lines"],
    ["a count with a currency mark", ["Settled-wait drift=$1"], "does not name a count of lines"],
  ])("refuses %s rather than reading it as a pass", (_case, args, message) => {
    const { run, summaryText } = harness();

    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("usage: wait-drift-gate.mjs");
    // And nothing was published: a refused invocation is not a verdict about a run.
    expect(summaryText()).toBe("");
  });
});

describe("the pieces it is read through", () => {
  it("splits an entry at its last `=`, so a label may contain one", () => {
    expect(parseEntries(["Settled-wait drift=1"])).toEqual([
      { label: "Settled-wait drift", count: "1" },
    ]);
    expect(parseEntries(["a=b=2"])).toEqual([{ label: "a=b", count: "2" }]);
    expect(() => parseEntries([])).toThrow(UsageError);
    expect(() => parseEntries(["Settled-wait drift="])).not.toThrow();
    expect(() => parseEntries(["Settled-wait drift=two"])).toThrow(UsageError);
  });

  it("keeps only the entries that mean the record is refuted", () => {
    const entries = parseEntries(["a=0", "b=", "c=2"]);

    expect(refuted(entries).map((entry) => entry.label)).toEqual(["c"]);
    expect(refuted([])).toEqual([]);
  });

  it("takes the flags' paths out of the entries it judges", () => {
    // The two halves of an invocation that would otherwise be read as one: a path is not a
    // `<label>=<count>`, and a gate that judged `--record .ci/wait-drift.md` as a record named
    // `--record .ci/wait-drift` holding a `.md` would refuse every wired run. Both spellings of a flag
    // are read, and one with no path is refused rather than dropped.
    expect(options(["--record", "out.md", "Settled-wait drift=1"])).toEqual({
      values: {
        record: "out.md",
        summary: "",
        comment: "",
        retract: "",
        end: "",
        runbook: "",
        request: "",
        today: "",
      },
      drifts: [],
      sets: [],
      entries: ["Settled-wait drift=1"],
    });
    expect(
      options([
        "--record=out.md",
        "--summary",
        "s.md",
        "--comment",
        "c.md",
        "--drift",
        "a=one.md",
        "--drift=b=two.md",
        "a=1",
        "b=",
      ]),
    ).toEqual({
      values: {
        record: "out.md",
        summary: "s.md",
        comment: "c.md",
        retract: "",
        end: "",
        runbook: "",
        request: "",
        today: "",
      },
      drifts: [
        { label: "a", path: "one.md" },
        { label: "b", path: "two.md" },
      ],
      sets: [],
      entries: ["a=1", "b="],
    });
    // …and a `--set` carries the lines a record is refuted by, paired with its label the same way — an
    // *empty* list included, which is a record that was judged and holds nothing refuted rather than a
    // flag with nothing in it. The lines are split on `;` and trimmed, so the spelling the module publishes
    // (`a; b`) and one a person typed are read alike.
    expect(
      options([
        "--set",
        "a=one;  two ,three",
        "--set=b=",
        "--runbook",
        "run.md",
        "--today",
        "2026-11-06",
        "a=1",
        "b=0",
      ]),
    ).toEqual({
      values: {
        record: "",
        summary: "",
        comment: "",
        retract: "",
        end: "",
        runbook: "run.md",
        request: "",
        today: "2026-11-06",
      },
      drifts: [],
      sets: [
        { label: "a", lines: ["one", "two ,three"] },
        { label: "b", lines: [] },
      ],
      entries: ["a=1", "b=0"],
    });
    // …and the request is the one flag whose value may be *empty*, because a night with no request open is
    // a real night rather than a mis-wired step: the finding is then owed instead of said, which is what
    // the settle mode already does for a crossing it has nowhere to be said on. A value that is not a
    // request number is refused here rather than reaching a URL later.
    expect(options(["--request", "", "a=0"]).values.request).toBe("");
    expect(options(["--request", "612", "a=0"]).values.request).toBe("612");
    expect(() => options(["--request", "last night", "a=0"])).toThrow(
      "'--request last night' is not a request number",
    );
    // …and the third body a night can ask for, the ending written into a comment whose request is over: a
    // flag like the two above, held to the same rule about its path — a caller that asked for the body and
    // handed over nowhere to write it is a workflow edit to fix rather than a night that leaves the ending
    // unsaid.
    expect(options(["--end", "end.md", "a=0"]).values.end).toBe("end.md");
    expect(options(["--end=end.md", "a=0"]).values.end).toBe("end.md");
    expect(() => options(["--end"])).toThrow(UsageError);
    expect(() => options(["--end=", "a=0"])).toThrow(UsageError);
    expect(() => options(["--end", "", "a=0"])).toThrow(UsageError);
    expect(() => options(["--set", "one; two", "a=1"])).toThrow(UsageError);
    expect(() => options(["--set", "a=one", "--set", "a=two", "a=1"])).toThrow(UsageError);
    expect(options([]).entries).toEqual([]);
    expect(() => options(["--record"])).toThrow(UsageError);
    expect(() => options(["--record="])).toThrow(UsageError);
    // A `--drift` with no record to belong to, or with nothing after its name, is refused rather than
    // read as a path — the label is what the block is quoted under, and there is no second guess to make.
    expect(() => options(["--drift", "lines.md", "a=1"])).toThrow(UsageError);
    expect(() => options(["--drift", "a=", "a=1"])).toThrow(UsageError);
    expect(() => options(["--drift", "a=one.md", "--drift", "a=again.md", "a=1"])).toThrow(UsageError);
    // …and the entries that survive the split are the ones the judgment is made over.
    expect(refuted(parseEntries(options(["--record", "out.md", "a=0", "b=2"]).entries))).toEqual([
      { label: "b", count: "2" },
    ]);
  });

  it("holds the record's three parts in the order a later reader needs them", () => {
    // Built rather than only spawned, because this is the shape the artifact and the review summary
    // both carry: the verdict, a bullet per judged record, and the quote of the block the settle step
    // published — with `null`, not an empty record, when nothing was judged.
    const red = verdictRecord(parseEntries(["Settled-wait drift=1"]), {
      quotes: [{ label: "Settled-wait drift", lines: BLOCK, path: "d.md" }],
    });

    expect(red).not.toBeNull();
    expect(red).toContain(HEADING);
    expect(red).toContain("- **Settled-wait drift** — 1 crossing line");
    expect(red).toContain("#604 on 2026-11-05");
    expect(red!.indexOf(HEADING)).toBeLessThan(red!.indexOf("#604 on 2026-11-05"));
    expect(red!.indexOf("- **Settled-wait drift**")).toBeLessThan(
      red!.indexOf("this is the step that turns that finding into a red job"),
    );
    // A quote a record's label does not match is not rendered at all: the verdict is the count, and a
    // record that held has no lines for anything to quote.
    expect(
      verdictRecord(parseEntries(["a=0"]), { quotes: [{ label: "a", lines: BLOCK, path: "d.md" }] }),
    ).not.toContain("#### A crossing line the records do not produce");
    expect(
      verdictRecord(parseEntries(["a=1"]), { quotes: [{ label: "other", lines: BLOCK, path: "d.md" }] }),
    ).toContain("no `--drift` file was named for this record");
    // Nothing judged is no record at all — the file's absence is the fourth state, and the one a night
    // the settle step was skipped leaves.
    expect(verdictRecord(parseEntries(["Settled-wait drift="]))).toBeNull();
    expect(verdictRecord(parseEntries(["a=", "b="]), { quotes: [] })).toBeNull();
  });

  it("words the night's comment around the labels and the blocks it was handed", () => {
    // Read directly, because a comment body is a *document*: `null` when nothing is refuted — that is what
    // keeps a poster `skipped` — one section per refuted label, only the refuted ones, and the record's own
    // sentence for a block that was never published.
    expect(repairComment([])).toBeNull();
    expect(repairComment(parseEntries(["a="]))).toBeNull();
    const body = repairComment(parseEntries(["a=1", "b=0"]), {
      quotes: [{ label: "a", lines: BLOCK, path: "d.md" }],
    });

    expect(body).toContain("- **a** — 1 crossing line the settlements cannot produce.");
    expect(body).not.toContain("- **b**");
    expect(body).toContain("### a");
    expect(body).toContain("#604 on 2026-11-05");
    expect(repairComment(parseEntries(["a=1"]))).toContain(
      "The lines are not quoted here: no `--drift` file was named for this record",
    );
    // …and a line the last version named that this one does not is *said*, not merely dropped: the body is
    // the only place a person who acted on the previous one can learn that their repair landed while the
    // rest of the finding stands, and a body one line shorter is what an edit by somebody else looks like.
    const partial = repairComment(parseEntries(["a=1"]), {
      gone: [{ label: "a", line: "#604 on 2026-11-05" }],
    });

    expect(partial).toContain(
      "**The record no longer holds `#604 on 2026-11-05`** — it was repaired since this comment was left",
    );
    expect(partial).toContain("What is left below is still refuted.");
    expect(partial!.indexOf("no longer holds")).toBeLessThan(partial!.indexOf("- **a**"));
    // Two lines read as two, and the sentence is absent rather than empty when nothing is gone.
    expect(
      repairComment(parseEntries(["a=1"]), {
        gone: [
          { label: "a", line: "#604 on 2026-11-05" },
          { label: "a", line: "#612 on 2026-11-05" },
        ],
      }),
    ).toContain("**The record no longer holds `#604 on 2026-11-05`, `#612 on 2026-11-05`** — they were");
    expect(body).not.toContain("no longer holds");
    // …and the *arrival* is said the same way, for the reader on the other side of the same edit: a line
    // this night refutes that the last body did not name looks exactly like one it simply listed, so the
    // body names it where the gone lines are named. The two sentences are told apart by their own verbs and
    // can stand together, since a night can gain a line and lose one — the arrival first, which is also
    // the order the bullets below them are read in.
    const joined = repairComment(parseEntries(["a=1"]), {
      joined: [{ label: "a", line: "#612 on 2026-11-05" }],
    });

    expect(joined).toContain(
      "**The record now also holds `#612 on 2026-11-05`** — it was refuted since this comment was " +
        "left, so this comment names it too.",
    );
    expect(joined).not.toContain("no longer holds");
    expect(joined!.indexOf("now also holds")).toBeLessThan(joined!.indexOf("- **a**"));
    // Two lines read as two, and the sentence is absent rather than empty when nothing joined.
    expect(
      repairComment(parseEntries(["a=2"]), {
        joined: [
          { label: "a", line: "#604 on 2026-11-05" },
          { label: "a", line: "#612 on 2026-11-05" },
        ],
      }),
    ).toContain("**The record now also holds `#604 on 2026-11-05`, `#612 on 2026-11-05`** — they were");
    // …and a night that both gains a line and loses one says both, which is the one body where the two
    // sentences are read as a pair: the arrival above the loss, whose closing clause then leads into the
    // bullets.
    const bothWays = repairComment(parseEntries(["a=1"]), {
      joined: [{ label: "a", line: "#700 on 2026-11-05" }],
      gone: [{ label: "a", line: "#604 on 2026-11-05" }],
    });

    expect(bothWays).toContain("**The record now also holds `#700 on 2026-11-05`**");
    expect(bothWays).toContain("**The record no longer holds `#604 on 2026-11-05`**");
    expect(bothWays!.indexOf("now also holds")).toBeLessThan(bothWays!.indexOf("no longer holds"));
    expect(body).not.toContain("now also holds");
  });

  it("writes the run-page note around the labels and their counts", () => {
    const note = gateAnnouncement([
      { label: "First record", count: "1" },
      { label: "Third record", count: "2" },
    ]);

    expect(note).toContain(HEADING);
    expect(note).toContain("1 crossing line the record holds");
    expect(note).toContain("- **Third record** — 2 crossing lines");
    expect(note).toContain("this is the step that turns that finding into a red job");
  });

  it("reads what the comment says now out of the runbook, by this module's own lines", () => {
    // The reader and the writer of one line, which is the half of the dedupe that is not a run: the head is
    // this module's own — `coverage-trend` reads the runbook's crossings and settlements by *theirs*, so a
    // report line changes no arithmetic anywhere — and what a stray bullet costs is nothing at all. The
    // reader's answer is the whole of what the comment currently says, not a log of what was ever said.
    const crossing =
      "- **2026-11-05 — settled wait on #502: the median reached 6 nights, past the 5 it had held since " +
      "2026-10-05.**";
    const settlement = "- **2026-11-05 — settled #502: answered after 6 night(s).**";
    const one = (line: string) => [{ label: LABEL, line }];

    // The other steps' lines are not this module's: a runbook with crossings and settlements in it is a
    // runbook no comment stands on, and a comment the night cannot find is one it says afresh.
    expect(standingComment(`${crossing}\n${settlement}\n`)).toBeNull();
    expect(standingComment("")).toBeNull();
    // A report names the request the comment is on and the lines it says are refuted — and a *later* report
    // replaces it, because the body it recorded named the record as it stood that night rather than only
    // what was new: the last line is the answer to what the comment says now.
    const first = recordReport(RUNBOOK, {
      entries: one(REFUTED_LINE),
      request: "612",
      night: "2026-11-06",
    }).text;
    expect(standingComment(first)).toEqual({ request: "612", entries: one(REFUTED_LINE) });
    const two = recordReport(first, {
      entries: one("#612 on 2026-11-05"),
      request: "612",
      night: "2026-11-07",
    }).text;
    expect(standingComment(two)).toEqual({ request: "612", entries: one("#612 on 2026-11-05") });
    // …and a retraction takes the lines it names out of what stands rather than clearing the lot, so a night
    // that took one of two lines out leaves the other one standing; when the last of them goes the comment
    // is gone, which is the state the next refutation reports afresh from.
    const partial = recordRetraction(two, {
      entries: one("the collect-budget wait on 2026-11-05"),
      request: "612",
      night: "2026-11-08",
    }).text;
    expect(standingComment(partial)).toEqual({ request: "612", entries: one("#612 on 2026-11-05") });
    const cleared = recordRetraction(two, {
      entries: one("#612 on 2026-11-05"),
      request: "612",
      night: "2026-11-08",
    }).text;
    expect(standingComment(cleared)).toBeNull();
    // …a retraction naming another request is ignored rather than applied, so a line somebody pasted from
    // another pull request cannot take down a comment it was never about.
    expect(
      standingComment(
        recordRetraction(two, { entries: one("#612 on 2026-11-05"), request: "9", night: "2026-11-08" })
          .text,
      ),
    ).toEqual({ request: "612", entries: one("#612 on 2026-11-05") });
    // …and a bullet that parses as neither head is skipped: the runbook is a file people edit, and a line
    // somebody reworded is a claim this cannot read.
    expect(
      standingComment(`- **2026-11-06 — refuted crossing line reported: ${REFUTED_LINE}.**`),
    ).toBeNull();
    // The two lines land where `coverage-trend` puts its own: a blank line, then the bullet.
    expect(recordReport("# Runbook\n", { entries: one(REFUTED_LINE), request: "612", night: "2026-11-06" }).text).toBe(
      `# Runbook\n\n${reportLine("2026-11-06", "612", named(REFUTED_LINE))}\n`,
    );
    expect(
      recordRetraction("# Runbook\n", { entries: one(REFUTED_LINE), request: "612", night: "2026-11-07" })
        .text,
    ).toBe(`# Runbook\n\n${retractLine("2026-11-07", "612", named(REFUTED_LINE))}\n`);
    // …and the words themselves, once, in the shape the module writes: a reader greps the runbook for
    // these, and a later night arrives at its own line by them.
    expect(reportLine("2026-11-06", "612", named(REFUTED_LINE))).toBe(
      "- **2026-11-06 — refuted crossing line reported on #612: Settled-wait drift=#604 on 2026-11-05.**",
    );
    expect(retractLine("2026-11-07", "612", named(REFUTED_LINE))).toBe(
      "- **2026-11-07 — refuted crossing line retracted on #612: Settled-wait drift=#604 on 2026-11-05.**",
    );
  });

  it("reads the ending of the thread a comment stands on, out of whichever kind's line records it", () => {
    // The fact that decides whether a comment is one to rewrite at all, and it is not the comment's own: a
    // request somebody else answers is answered in the runbook, as that request's own settlement line —
    // which is why this reads through `coverage-trend.mjs`'s reader rather than by a pattern of its own. A
    // comment is written to a *pull request*, so the question is about the thread, and either kind's line can
    // be the one that answers it: a floor proposal's line is the request's own life, and a collect proposal's
    // is the ending of an ask left as a comment, where only `closed unanswered` is a close. The states are
    // told apart here: the request this comment is on, a request whose thread ended, and one this says nothing
    // about.
    const one = (line: string) => [{ label: LABEL, line }];
    const reported = recordReport(RUNBOOK, { entries: one(REFUTED_LINE), request: "604", night: "2026-11-06" }).text;
    const merged = `${reported}${settledLine("2026-11-07", "604", "merged", 2)}\n\n`;

    expect(settledRequest(merged, "604")).toEqual({
      date: "2026-11-07",
      number: "604",
      outcome: "merged",
      nights: 2,
    });
    // …the other ending a floor proposal has, and the one the night has to be able to name…
    expect(settledRequest(`${reported}${settledLine("2026-11-07", "604", "closed", 1)}\n\n`, "604")).toMatchObject({
      number: "604",
      outcome: "closed",
    });
    // …and the *other* kind's close, which is an ending for the same reason: the pull request went away with
    // the ask on it, so there is no thread left for a comment to be rewritten into. A comment left anywhere
    // is what this answers for, which is why the kind the request was raised as cannot be the filter.
    expect(
      settledRequest(`${reported}${collectSettledLine("2026-11-07", "604", "closed unanswered", 3)}\n\n`, "604"),
    ).toEqual({ date: "2026-11-07", number: "604", outcome: "closed unanswered", nights: 3 });
    // …where a *reply* of that kind is not one, however it was worded: it ends the ask and leaves the pull
    // request standing, so a comment on it is still one a later night may have to rewrite.
    for (const word of ["applied", "refused", "answered"]) {
      expect(settledRequest(`${reported}${collectSettledLine("2026-11-07", "604", word, 2)}\n\n`, "604")).toBeNull();
    }
    // …and the file's other record of a thread ending, which no settlement word of this kind states: the pull
    // request itself, closed after the ask on it was answered. It answers with the day it closed, the word
    // `closed`, and the ask's own age out of the settlement line the close is about.
    expect(
      settledRequest(
        `${reported}${collectSettledLine("2026-11-07", "604", "applied", 2)}\n\n${closeLine("2026-11-09", "604")}\n`,
        "604",
      ),
    ).toEqual({ date: "2026-11-09", number: "604", outcome: "closed", nights: 2 });
    // …a close of a request this comment is not on is nothing, and a close with no settlement beside it — a
    // file somebody has edited, since the writer only ever writes one for an answered ask — is still an
    // ending, with no age to state.
    expect(settledRequest(`${reported}${closeLine("2026-11-09", "700")}\n`, "604")).toBeNull();
    expect(settledRequest(`${reported}${closeLine("2026-11-09", "604")}\n`, "604")).toEqual({
      date: "2026-11-09",
      number: "604",
      outcome: "closed",
      nights: null,
    });
    // …and the file's correction of it, which is why the two statements are read in order rather than either
    // being taken alone: a request somebody reopened is a place a person is again, so the record's word that
    // the thread is gone is one GitHub has contradicted — and a comment on it is one a later night may have
    // to rewrite. What it corrects is *every* ending the file holds for that number, because each of them is
    // a word about the same pull request: this kind's `closed unanswered`, the close record above, and a floor
    // proposal's settlement (whose own noun the same head reads, a request this job raised being reopenable
    // exactly as somebody else's is).
    const answered = `${reported}${collectSettledLine("2026-11-07", "604", "applied", 2)}\n\n`;
    const corrected = `${answered}${closeLine("2026-11-09", "604")}\n\n${reopenLine("2026-11-15", "604", "2026-11-09")}\n`;

    expect(settledRequest(corrected, "604")).toBeNull();
    expect(
      settledRequest(`${answered}${settledLine("2026-11-07", "604", "merged", 2)}\n\n${reopenLine("2026-11-15", "604", "2026-11-07")}\n`, "604"),
    ).toBeNull();
    expect(
      settledRequest(
        `${answered}${settledLine("2026-11-07", "604", "merged", 2)}\n\n${reopenLine("2026-11-15", "604", "2026-11-07", "floor proposal")}\n`,
        "604",
      ),
    ).toBeNull();
    expect(
      settledRequest(`${answered}${collectSettledLine("2026-11-07", "604", "closed unanswered", 3)}\n\n${reopenLine("2026-11-15", "604", "2026-11-07")}\n`, "604"),
    ).toBeNull();
    // …a correction of another request is nothing to this one, and one with no close before it — a file
    // somebody has edited — is still the last word about that thread: the rule the file's own order gives the
    // two heads, rather than one about which statement is the stronger.
    expect(
      settledRequest(`${answered}${closeLine("2026-11-09", "604")}\n\n${reopenLine("2026-11-15", "700", "2026-11-09")}\n`, "604"),
    ).toMatchObject({ date: "2026-11-09", outcome: "closed" });
    expect(settledRequest(`${answered}${reopenLine("2026-11-15", "604", "2026-11-09")}\n`, "604")).toBeNull();
    // …and the close that follows a correction is the ending, dated by the later day: the request came back
    // and went away again, so the word that stands is the one the file states last.
    expect(settledRequest(`${corrected}${closeLine("2026-11-20", "604")}\n`, "604")).toEqual({
      date: "2026-11-20",
      number: "604",
      outcome: "closed",
      nights: 2,
    });
    // …a request nobody has answered, and one the file says nothing about — the two cases a comment is
    // still standing in, so neither may read as an ending.
    expect(settledRequest(`${reported}${settledLine("2026-11-07", "700", "merged", 3)}\n\n`, "604")).toBeNull();
    expect(
      settledRequest(`${reported}${collectSettledLine("2026-11-07", "700", "closed unanswered", 3)}\n\n`, "604"),
    ).toBeNull();
    expect(settledRequest(reported, "604")).toBeNull();
    expect(settledRequest(RUNBOOK, "604")).toBeNull();
    expect(settledRequest("", "604")).toBeNull();
    // …and the last line the file holds wins where both kinds state one for the same number, as the report
    // walk's own rule does: a settlement is written once, so the later statement is the later answer.
    expect(
      settledRequest(`${merged}${collectSettledLine("2026-11-09", "604", "closed unanswered", 4)}\n`, "604"),
    ).toMatchObject({ date: "2026-11-09", outcome: "closed unanswered" });
    // …a night with no comment standing asks nothing, whatever the file holds.
    expect(settledRequest(merged, "")).toBeNull();
  });

  it("says a comment whose request has ended rather than quietly leaving it alone", () => {
    // The night's own sentence about the one comment it does not touch, and the body's when the finding has
    // to be said somewhere else: both are what separates "this thread is over" from "the finding went
    // away", which is how the same facts read if nothing says them.
    const settled = { number: "604", outcome: "merged", date: "2026-11-07" };

    expect(endedNote(settled, "Nothing is open tonight.")).toBe(
      "**The comment stands on #604, which the runbook records as merged on 2026-11-07** — the thread " +
        "ended with the request, so this night does not rewrite it: nobody will read it there. Nothing is " +
        "open tonight.",
    );
    // The verdict the artifact keeps carries it on both readings — the red night and the green one a
    // retraction night leaves — after the bullets and before the sentence that says why this file exists.
    const red = verdictRecord(parseEntries(["a=1"]), {
      ended: endedNote(settled, "The finding is said afresh on #700."),
    })!;

    expect(red).toContain("**The comment stands on #604, which the runbook records as merged on 2026-11-07**");
    expect(red.indexOf("**The comment stands on #604")).toBeGreaterThan(red.indexOf("- **a**"));
    expect(red.indexOf("**The comment stands on #604")).toBeLessThan(
      red.indexOf("this is the step that turns that finding into a red job"),
    );
    const green = verdictRecord(parseEntries(["a=0"]), {
      ended: endedNote(settled, "There is nothing to retract."),
    })!;

    expect(green).toContain(HELD_HEADING);
    expect(green).toContain("**The comment stands on #604");
    // …and an ordinary night, where no comment stands on a request that ended, carries none of it. The run
    // page's block is the module's own and unchanged — the sentence joins it as an appended note, which the
    // night the finding is still refuted is asserted end to end below.
    expect(verdictRecord(parseEntries(["a=1"]))).not.toContain("The comment stands on");
    expect(gateAnnouncement([{ label: "a", count: "1" }])).not.toContain("The comment stands on");
    // The body is a *new* comment rather than a rewrite of the one that stands, and says so; the two
    // sentences about lines moving are not owed with it, since nothing has joined or left a thread that
    // ended.
    const body = repairComment(parseEntries(["a=1"]), { settled })!;

    expect(body).toContain(
      "**The comment that last said this stands on #604, which the runbook records as merged on " +
        "2026-11-07** — so it is left where it is and the finding is said here instead.",
    );
    expect(body).not.toContain("no longer holds");
    expect(body).not.toContain("now also holds");
    expect(repairComment(parseEntries(["a=1"]))).not.toContain("The comment that last said this");
  });
});

describe("the comment it says once", () => {
  /**
   * One night's invocation of the real gate against a runbook and a set of refuted lines.
   *
   * The night is a parameter because a *sequence* of nights is what half of these cases are about: the
   * dedupe, the repair and the re-report are each a fact about a night read after another one, and a
   * suite that could only run the same night twice could not tell them apart in the runbook.
   */
  function night(args: string[], dir: string, out: string, today = "2026-11-06") {
    return spawnSync(process.execPath, [script, ...args, "--today", today], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: out },
    });
  }

  it("says a refuted line on the night it appears and leaves the next night nothing to post", () => {
    // The failure mode this exists for, and it is not the verdict: a record left refuted for a week fails
    // the night on all seven, which is what a red run is for. It is the *comment* — the one channel that
    // reaches somebody who is not looking at this run — and seven notifications saying one thing is how a
    // channel stops being read. So the line is an event: said once, and said again only when a line joins
    // it. The verdict is unchanged either way: both nights are red, and both keep the record.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-once-"));
    const lines = join(dir, "wait-drift-lines.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(runbook, RUNBOOK);
    const first = join(dir, "first-repair.md");
    const second = join(dir, "second-repair.md");
    const args = (comment: string) => [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      `Settled-wait drift=${REFUTED_LINE}`,
      "--runbook",
      runbook,
      "--request",
      "604",
      "--comment",
      comment,
      "Settled-wait drift=1",
    ];

    const said = night(args(first), dir, join(dir, "output-first"));

    expect(said.status, said.stderr).toBe(1);
    expect(existsSync(first)).toBe(true);
    expect(readFileSync(runbook, "utf8")).toContain(
      reportLine("2026-11-06", "604", named(REFUTED_LINE)),
    );
    // The two facts the poster works from: that this night has a body to post, and which request it goes
    // on — the one the comment *stands* on, which on the first night of a refutation is the one this night
    // had open. A body that moved to whatever request happened to be open tonight would leave the comment
    // it was meant to update behind.
    expect(readFileSync(join(dir, "output-first"), "utf8")).toContain(
      "reported=true\ncomment-request=604\n",
    );
    const recorded = readFileSync(runbook, "utf8");

    const again = night(args(second), dir, join(dir, "output-second"));

    expect(again.status, again.stderr).toBe(1);
    expect(existsSync(second)).toBe(false);
    expect(again.stdout).toContain("already names every line this night refutes (1)");
    // Nothing said, so nothing recorded — and the poster's fact is `false` rather than absent, which is the
    // distinction between a night with nothing to post and a step that never ran.
    expect(readFileSync(runbook, "utf8")).toBe(recorded);
    expect(readFileSync(join(dir, "output-second"), "utf8")).toContain("reported=false");
  });

  it("says it again when a line joins the refutation, and when a line is re-derived", () => {
    // The line that joins is the event, and it is why the comment is not simply edited in place: an edit
    // notifies nobody. A re-derived line is the same thing from the other side — the repair moves a line
    // rather than deleting it, so the identity the settle step publishes changes with it (`#604 on
    // 2026-11-05` against `#604 on 2026-12-01`) and the night says the new line.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-joins-"));
    const lines = join(dir, "wait-drift-lines.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(runbook, RUNBOOK);
    const out = join(dir, "output");
    const args = (want: string, comment: string) => [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      `Settled-wait drift=${want}`,
      "--runbook",
      runbook,
      "--request",
      "604",
      "--comment",
      comment,
      "Settled-wait drift=1",
    ];

    const one = night(args(REFUTED_LINE, join(dir, "one.md")), dir, out);

    expect(one.status, one.stderr).toBe(1);
    // Nothing stood before it, so the body states the finding and accounts for nothing: neither sentence
    // is owed where there was no comment for a line to join or leave.
    expect(readFileSync(join(dir, "one.md"), "utf8")).not.toContain("now also holds");
    expect(readFileSync(join(dir, "one.md"), "utf8")).not.toContain("no longer holds");
    const joined = join(dir, "two.md");
    const both = night(args(`${REFUTED_LINE}; #612 on 2026-11-05`, joined), dir, out);

    expect(both.status, both.stderr).toBe(1);
    expect(existsSync(joined)).toBe(true);
    const recorded = readFileSync(runbook, "utf8");
    expect(recorded).toContain(
      reportLine("2026-11-06", "604", named(REFUTED_LINE), named("#612 on 2026-11-05")),
    );
    // The body says *which* line joined, in a sentence of its own, and not merely that the finding grew:
    // the line is otherwise only in the quote when its own block happens to be the one published, and a
    // reader who has already read the last body has no reason to compare counts. The other sentence is
    // absent, since nothing the comment named has left it.
    const grew = readFileSync(joined, "utf8");

    expect(grew).toContain(`**The record now also holds \`#612 on 2026-11-05\`** — it was refuted`);
    expect(grew).toContain("so this comment names it too.");
    expect(grew).not.toContain("no longer holds");
    expect(grew.indexOf("now also holds")).toBeLessThan(grew.indexOf("- **Settled-wait drift**"));
    // …and the same body does not name the line it already named as though it were new: only the line
    // that joined is named in the sentence.
    expect(grew.slice(0, grew.indexOf("- **Settled-wait drift**"))).not.toContain(REFUTED_LINE);

    // …and a night whose refutation *shrank* is the same edit from the other side: the line the comment
    // names that its record no longer holds is written out of the body, so a comment stops naming a line
    // the settlements produce again — the half of the pair that keeps a standing comment honest without
    // ending it. It is still a red night, because a line is still refuted.
    const shrunk = join(dir, "three.md");
    const quiet = night(args("#612 on 2026-11-05", shrunk), dir, out);

    expect(quiet.status, quiet.stderr).toBe(1);
    expect(existsSync(shrunk)).toBe(true);
    expect(readFileSync(runbook, "utf8")).not.toBe(recorded);
    expect(readFileSync(runbook, "utf8")).toContain(
      reportLine("2026-11-06", "604", named("#612 on 2026-11-05")),
    );
    // …and it is the *loss* that sentence names, with no arrival claimed for the line the last body
    // already named — the two directions are told apart by which sentence is written, not by a verb inside
    // one of them.
    const lost = readFileSync(shrunk, "utf8");

    expect(lost).toContain(`**The record no longer holds \`${REFUTED_LINE}\`**`);
    expect(lost).not.toContain("now also holds");

    // …and a line the record holds under another night is a line nobody has been told about.
    const moved = join(dir, "four.md");
    const rederived = night(args("#604 on 2026-12-01", moved), dir, out);

    expect(rederived.status, rederived.stderr).toBe(1);
    expect(existsSync(moved)).toBe(true);
    expect(readFileSync(runbook, "utf8")).toContain(
      reportLine("2026-11-06", "604", named("#604 on 2026-12-01")),
    );
    // …and it is the one night that is both at once: the re-derived line has joined the finding while the
    // line it replaced has left it, so the body carries both sentences — the arrival above the loss, the
    // order the bullets below them are then read in.
    const movedBody = readFileSync(moved, "utf8");

    expect(movedBody).toContain("**The record now also holds `#604 on 2026-12-01`**");
    expect(movedBody).toContain("**The record no longer holds `#612 on 2026-11-05`**");
    expect(movedBody.indexOf("now also holds")).toBeLessThan(movedBody.indexOf("no longer holds"));
  });

  it("rewrites the standing comment into the note that the repair landed, and is green for it", () => {
    // The end of the pair, and the whole of what the retraction exists for: the repair is an edit to
    // `.freebuff/run.md`, the comment the night left is the one thing on the request still saying the record
    // is broken, and the night that reads the record repaired is the night that says so where it said the
    // finding. It is a *green* night — nothing is refuted any more — which is why the note is rendered by
    // the same step that takes the verdict rather than by the branch that fails the job.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-retract-"));
    const lines = join(dir, "wait-drift-lines.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(runbook, RUNBOOK);
    const refuting = (comment: string) => [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      `Settled-wait drift=${REFUTED_LINE}`,
      "--runbook",
      runbook,
      "--request",
      "604",
      "--comment",
      comment,
      "Settled-wait drift=1",
    ];
    // The repaired night: a record that was read and holds nothing refuted, so the count is `0` and the
    // lines are the *empty* list — which is not the same as a night the settle step never judged.
    const repaired = (comment: string, retract: string) => [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      "Settled-wait drift=",
      "--runbook",
      runbook,
      "--request",
      "604",
      "--comment",
      comment,
      "--retract",
      retract,
      "Settled-wait drift=0",
    ];

    expect(night(refuting(join(dir, "red.md")), dir, join(dir, "red-output")).status).toBe(1);
    const body = join(dir, "green.md");
    const note = join(dir, "retract.md");
    const greenOutput = join(dir, "green-output");
    const green = night(repaired(body, note), dir, greenOutput, "2026-11-07");

    expect(green.status, green.stderr).toBe(0);
    // Nothing is refuted, so there is no refutation body at all: the poster's step is `skipped` on this
    // night, which is the value a night that owed no comment has to have rather than a poster that ran.
    expect(existsSync(body)).toBe(false);
    expect(readFileSync(greenOutput, "utf8")).toContain("reported=false");
    // …and the retraction names the request the comment *stands* on rather than the one this night has
    // open, which is the only way the step below can find the comment it has to rewrite.
    expect(readFileSync(greenOutput, "utf8")).toContain("retract=604");
    const said = readFileSync(note, "utf8");
    // The marker stays in the body, so the comment is still where a later night looks: a fresh refutation
    // of the same lines rewrites this note rather than leaving it beside a second comment.
    expect(said).toContain(RECORD_COMMENT_MARKER);
    expect(said).toContain("## The settled-wait record is repaired");
    expect(said).toContain(`\`${REFUTED_LINE}\` is no longer in the record`);
    expect(said).toContain("read on #604");
    // The log says where the note went, since a rewritten comment is not visible on this run's page.
    expect(green.stdout).toContain("the comment on #604 is rewritten to say the record is repaired");
    // …and the ending is recorded in the runbook the night's commit carries back, in the same shape the
    // report is: written where the body exists, because what it records is what the comment now says.
    expect(readFileSync(runbook, "utf8")).toContain(
      retractLine("2026-11-07", "604", named(REFUTED_LINE)),
    );

    // …and the line is reportable again: the retraction took it out of what stands, so a night that reads
    // it refuted afresh says it afresh — which is the whole reason the note is a rewrite rather than a
    // deletion, and the reason a report line *replaces* the standing lines rather than adding to them.
    const again = night(refuting(join(dir, "again.md")), dir, join(dir, "again-output"), "2026-11-08");

    expect(again.status, again.stderr).toBe(1);
    expect(readFileSync(join(dir, "again-output"), "utf8")).toContain("reported=true");
    expect(readFileSync(runbook, "utf8")).toContain(
      reportLine("2026-11-08", "604", named(REFUTED_LINE)),
    );
  });

  it("retracts only when the last line the comment names is gone from a record this night judged", () => {
    // Three nights that a naive reading would all answer "nothing stands, so retract" — and none of them
    // is that night. The retraction is the *ending* of a finding, so it is owed only when the finding has
    // actually ended: while a line is still refuted the comment is the live red, and a line whose record
    // this night never read has no status at all — the settle step was skipped, and a finding is not
    // repaired by the night that did not look.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-not-owed-"));
    const lines = join(dir, "wait-drift-lines.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(runbook, RUNBOOK);
    const firstNight = [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      `Settled-wait drift=${REFUTED_LINE}`,
      "--runbook",
      runbook,
      "--request",
      "604",
      "--comment",
      join(dir, "red.md"),
      "Settled-wait drift=1",
    ];

    expect(night(firstNight, dir, join(dir, "red-output")).status).toBe(1);

    // A line still refuted: the comment is not a stale red, it is the live one, and the night's body is a
    // report rather than a retraction even though it is rewriting the same comment.
    const standing = join(dir, "standing.md");
    const live = night(
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        `Settled-wait drift=${REFUTED_LINE}`,
        "--runbook",
        runbook,
        "--request",
        "604",
        "--comment",
        join(dir, "quiet.md"),
        "--retract",
        standing,
        "Settled-wait drift=1",
      ],
      dir,
      join(dir, "live-output"),
    );

    expect(live.status, live.stderr).toBe(1);
    expect(existsSync(standing)).toBe(false);
    expect(readFileSync(join(dir, "live-output"), "utf8")).toContain("retract=\n");

    // A record this night never judged: the line's status is unknown, so it is neither reported nor
    // retracted on the strength of this run — the finding waits for a night that looked, and the log says
    // exactly that rather than claiming the comment still stands for a reason this night can see.
    const unread = night(
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        "Settled-wait drift=",
        "--runbook",
        runbook,
        "--request",
        "604",
        "--comment",
        join(dir, "unread-body.md"),
        "--retract",
        join(dir, "unread.md"),
        "Settled-wait drift=",
      ],
      dir,
      join(dir, "unread-output"),
    );

    expect(unread.status, unread.stderr).toBe(0);
    expect(existsSync(join(dir, "unread.md"))).toBe(false);
    expect(readFileSync(join(dir, "unread-output"), "utf8")).toContain("retract=\n");
    expect(unread.stdout).toContain(
      "the comment on #604 stands and names nothing this night can see is gone",
    );
  });

  it("says which line a partial repair took out, and keeps the finding that is left", () => {
    // The third shape of a repair, and the one with no note of its own: the comment names two lines, the
    // record comes back holding one of them, and the night is still red for it — so there is nothing to
    // retract and something to report, and the line that left has to be said *inside* the body. Without
    // that sentence the comment is the previous one with a line missing, which reads as a hand edit rather
    // than as somebody's repair having landed while the rest stands.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-partial-"));
    const lines = join(dir, "wait-drift-lines.md");
    // The block the *second* night's settle step would publish, for the line that night refutes: with the
    // two blocks distinct, the body's own quote becomes the assertion that the gone line is named nowhere
    // but in the sentence about it.
    const second = join(dir, "wait-drift-lines-2.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(second, BLOCK.replace(/#604 on 2026-11-05/g, "#612 on 2026-11-05"));
    writeFileSync(runbook, RUNBOOK);
    const args = (drift: string, want: string, comment: string, retract: string) => [
      "--drift",
      `Settled-wait drift=${drift}`,
      "--set",
      `Settled-wait drift=${want}`,
      "--runbook",
      runbook,
      "--request",
      "604",
      "--comment",
      comment,
      "--retract",
      retract,
      "Settled-wait drift=1",
    ];

    // The night both lines are reported on, which is the comment the night below shortens.
    expect(
      night(
        args(lines, `${REFUTED_LINE}; #612 on 2026-11-05`, join(dir, "both.md"), join(dir, "both-note.md")),
        dir,
        join(dir, "both-output"),
      ).status,
    ).toBe(1);

    const body = join(dir, "partial.md");
    const note = join(dir, "partial-note.md");
    const partial = night(args(second, "#612 on 2026-11-05", body, note), dir, join(dir, "partial-output"));

    expect(partial.status, partial.stderr).toBe(1);
    expect(existsSync(body)).toBe(true);
    // No note at all: something is still refuted, so the ending is not owed — and the output the poster
    // reads says so rather than leaving a value its condition could trip over.
    expect(existsSync(note)).toBe(false);
    expect(readFileSync(join(dir, "partial-output"), "utf8")).toContain("retract=\n");
    const said = readFileSync(body, "utf8");
    const tail = said.slice(said.indexOf("- **Settled-wait drift**"));

    // The line that left is said once, before the finding it left behind…
    expect(said).toContain(`**The record no longer holds \`${REFUTED_LINE}\`**`);
    expect(said).toContain("What is left below is still refuted.");
    expect(said.indexOf("no longer holds")).toBeLessThan(said.indexOf("- **Settled-wait drift**"));
    // …the count is tonight's rather than the last version's…
    expect(tail).toContain("- **Settled-wait drift** — 1 crossing line the settlements cannot produce.");
    // …and below the sentence the body names the surviving line and not the one that left.
    expect(tail).toContain("#612 on 2026-11-05");
    expect(tail).not.toContain(REFUTED_LINE);
    // The runbook holds both facts, the report first and the subtraction beside it…
    const recorded = readFileSync(runbook, "utf8");
    const reported = reportLine("2026-11-06", "604", named("#612 on 2026-11-05"));
    const retracted = retractLine("2026-11-06", "604", named(REFUTED_LINE));

    expect(recorded).toContain(reported);
    expect(recorded).toContain(retracted);
    expect(recorded.indexOf(reported)).toBeLessThan(recorded.indexOf(retracted));
    // …so a later night reads the right answer from it, which is the half a paragraph cannot do: what the
    // comment names now is what the record refutes, so the night after this one has nothing to say — the
    // subtraction having been written down does not make the repaired line news again.
    const quiet = night(
      args(second, "#612 on 2026-11-05", join(dir, "quiet.md"), join(dir, "quiet-note.md")),
      dir,
      join(dir, "quiet-output"),
      "2026-11-07",
    );

    expect(quiet.status, quiet.stderr).toBe(1);
    expect(existsSync(join(dir, "quiet.md"))).toBe(false);
    expect(existsSync(join(dir, "quiet-note.md"))).toBe(false);
    expect(readFileSync(join(dir, "quiet-output"), "utf8")).toContain("reported=false");
    expect(readFileSync(runbook, "utf8")).toBe(recorded);
  });

  it("refuses a comment it cannot dedupe, and keeps the verdict it was handed", () => {
    // A comment that cannot tell whether the finding has been said is a comment that says itself again
    // every night, which is the state this exists to end — so the two things it is deduped against are
    // asked for, and the refusal is the invocation's rather than the record's: nothing is written, and the
    // finding is still stated. A caller taking only the verdict is not held to either, since the verdict is
    // the count's and the record and the summary are the judgment kept.
    const { dir, run, summaryText } = harness();
    const runbook = join(dir, "run.md");
    writeFileSync(runbook, RUNBOOK);

    const noRunbook = run(["--comment", join(dir, "c.md"), "Settled-wait drift=1"]);
    expect(noRunbook.status).toBe(2);
    expect(noRunbook.stderr).toContain("--comment needs --runbook");
    expect(summaryText()).toContain(HEADING);
    // The retraction is held to the same pair, and for a sharper reason: it cannot be *rendered* without the
    // record that says what the comment names, and a run that asked for the note and got none would leave
    // the stale red this whole pair exists to end.
    const noRunbookRetract = run(["--retract", join(dir, "r.md"), "Settled-wait drift=0"]);
    expect(noRunbookRetract.status).toBe(2);
    expect(noRunbookRetract.stderr).toContain("--retract needs --runbook");
    // …and the ending, for the same reason the retraction is: what it writes is a sentence about the record's
    // own words for a request, so a night asked for one without the record it is read out of has nothing to
    // write and nowhere to have read it from.
    const noRunbookEnd = run(["--end", join(dir, "e.md"), "Settled-wait drift=1"]);
    expect(noRunbookEnd.status).toBe(2);
    expect(noRunbookEnd.stderr).toContain("--end needs --runbook");
    expect(readFileSync(runbook, "utf8")).toBe(RUNBOOK);

    const noLines = run([
      "--comment",
      join(dir, "c.md"),
      "--runbook",
      runbook,
      "Settled-wait drift=1",
    ]);
    expect(noLines.status).toBe(2);
    expect(noLines.stderr).toContain("is refuted but no --set named the lines it is refuted by");

    const unreadable = run([
      "--comment",
      join(dir, "c.md"),
      "--set",
      `Settled-wait drift=${REFUTED_LINE}`,
      "--runbook",
      join(dir, "no-such-directory", "run.md"),
      "Settled-wait drift=1",
    ]);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toContain("cannot read");

    // …and the rest are refused whether or not a comment was asked for: a list of lines under no verdict,
    // a record named twice, and a night this cannot write into the record it reads.
    expect(run(["--set", "Other record=#1 on 2026-11-05", "Settled-wait drift=0"]).stderr).toContain(
      "names a record this invocation does not judge",
    );
    expect(
      run(["--set", "Settled-wait drift=#604 on 2026-11-05", "--set", "Settled-wait drift=#1", "Settled-wait drift=0"])
        .stderr,
    ).toContain("was given two --set lists");
    expect(run(["--today", "last night", "Settled-wait drift=0"]).stderr).toContain("is not a date");
    // Nothing was written by any of them, and the verdict is untouched: a refused invocation is not a
    // verdict about a run, and the runbook it read is the runbook it leaves.
    expect(readFileSync(runbook, "utf8")).toBe(RUNBOOK);
  });
});

/**
 * The comment whose request has ended — the one state in which the night is right *not* to rewrite.
 *
 * A refuted-record comment stands on a pull request, and somebody else answers the request on it: it is
 * merged, or closed unanswered. The thread is over, and the night's whole reason to touch the comment is to
 * tell a person something — so neither the retraction nor the repair sentence is written into it, and the
 * night says why on the surfaces it owns instead. Which kind's line records that ending is not the night's
 * business: a comment left anywhere has a pull request under it, and the two kinds are read together, with
 * each kind's line meaning what that kind's vocabulary says about the thread — a floor proposal is over
 * whether it was merged or dropped, and a collect proposal's ask ends with a reply that leaves the pull
 * request standing, so only its close ends both. What makes the answer *stable* is where the fact comes from:
 * the settlement line the settle step wrote the night it read GitHub is still in the runbook the night after,
 * carried back by the same commit as everything else, so no night has to record anything for the next one to
 * reach the same answer — and a request that is answered is answered for good.
 */
describe("the comment whose request has ended", () => {
  /** One night over one runbook, with the run page the gate can append to. */
  function night(dir: string, args: string[], out: string, today = "2026-11-08") {
    return spawnSync(process.execPath, [script, ...args, "--today", today], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, "run-page.md") },
    });
  }

  /**
   * A runbook in which a comment stands on a request that has since been answered.
   *
   * The report line is this module's own writer and the settlement is the line
   * `.freebuff/coverage-trend.mjs` writes — the gate reads the second through that module's reader, so this
   * fixture is the two halves of one agreement rather than a second copy of either rule. `settled` is *which*
   * kind's line records the ending, the floor kind's by default: a comment stands on a pull request, and the
   * two kinds' lines say different things about one, so a case that is about the read rather than about the
   * night has to choose.
   */
  function answered(
    dir: string,
    outcome: string,
    request = "604",
    nights = 2,
    settled = settledLine,
  ) {
    const runbook = join(dir, "run.md");
    const reported = recordReport(RUNBOOK, {
      entries: [{ label: LABEL, line: REFUTED_LINE }],
      request,
      night: "2026-11-06",
    }).text;

    writeFileSync(runbook, `${reported}${settled("2026-11-07", request, outcome, nights)}\n\n`);
    return runbook;
  }

  /** The night that owes nothing: a record that was read and holds no line these settlements cannot make. */
  function repaired(
    runbook: string,
    { request = "604", body, note, record }: { request?: string; body: string; note: string; record: string },
  ) {
    return [
      "--set",
      "Settled-wait drift=",
      "--runbook",
      runbook,
      "--request",
      request,
      "--comment",
      body,
      "--retract",
      note,
      "--record",
      record,
      "Settled-wait drift=0",
    ];
  }

  it("leaves the comment alone on a green night, and says so where a green night is read", () => {
    // The night the retraction is owed, on a request that has already ended. A note there would be read by
    // nobody, while "the record is repaired" is exactly what this night did establish — so it goes where a
    // green night's reading lives, the artifact, and the log says the third thing it can say on such a
    // night, which is neither a rewrite nor silence.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ended-green-"));
    const runbook = answered(dir, "merged");
    const body = join(dir, "green.md");
    const note = join(dir, "green-note.md");
    const record = join(dir, "verdict.md");
    const before = readFileSync(runbook, "utf8");
    const green = night(dir, repaired(runbook, { body, note, record }), join(dir, "output"));

    expect(green.status, green.stderr).toBe(0);
    // Nothing is written at all: not the retraction — a thread that ended is not a place to tell a person a
    // finding is over — and not the comment it would have been written into.
    expect(existsSync(body)).toBe(false);
    expect(existsSync(note)).toBe(false);
    // …and the two entries the poster's step reads say the night owes nothing, which is what keeps it
    // `skipped` rather than red: a red gate here would fail the job over a comment nobody was owed.
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("reported=false");
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("retract=\n");
    expect(green.stdout).toContain(
      "the comment on #604 stands on a request the runbook records as merged on 2026-11-07",
    );
    expect(green.stdout).not.toContain("is rewritten to say the record is repaired");
    // The artifact carries the fact beside its verdict, which is where a green night is read a month later…
    const verdict = readFileSync(record, "utf8");

    expect(verdict).toContain(HELD_HEADING);
    expect(verdict).toContain(
      "**The comment stands on #604, which the runbook records as merged on 2026-11-07**",
    );
    expect(verdict).toContain("The red this comment carried is not taken down either");
    // …and the runbook is byte-identical, which is the half a sentence cannot do: the settlement line *is*
    // the state, so nothing has to be recorded for the next night to read the same answer.
    expect(readFileSync(runbook, "utf8")).toBe(before);

    // The control is the same night with the comment's request unanswered: the retraction is written, so
    // what this case is about is the ending rather than the shape of the night.
    const control = mkdtempSync(join(tmpdir(), "wait-drift-ended-control-"));
    const plain = join(control, "run.md");

    writeFileSync(
      plain,
      recordReport(RUNBOOK, {
        entries: [{ label: LABEL, line: REFUTED_LINE }],
        request: "604",
        night: "2026-11-06",
      }).text,
    );
    const plainNight = night(
      control,
      repaired(plain, {
        body: join(control, "green.md"),
        note: join(control, "green-note.md"),
        record: join(control, "verdict.md"),
      }),
      join(control, "output"),
    );

    expect(plainNight.status, plainNight.stderr).toBe(0);
    expect(readFileSync(join(control, "green-note.md"), "utf8")).toContain(
      "## The settled-wait record is repaired",
    );
    expect(plainNight.stdout).toContain("the comment on #604 is rewritten to say the record is repaired");
  });

  it("reports a line still refuted afresh on tonight's request, not into the thread that ended", () => {
    // The half that matters more: the finding is not withdrawn. Its comment cannot be rewritten, so the
    // night says it where a person is — a comment of its own on the request open tonight, carrying the same
    // marker and explaining in its body why it is new — and the runbook moves with it, so the night after is
    // quiet rather than reporting the same lines again on the request it just used.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ended-afresh-"));
    const runbook = answered(dir, "closed");
    const lines = join(dir, "wait-drift-lines.md");
    const body = join(dir, "afresh.md");
    const note = join(dir, "afresh-note.md");
    const record = join(dir, "verdict.md");

    writeFileSync(lines, BLOCK);
    const args = (comment: string) => [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      "Settled-wait drift=#612 on 2026-11-05",
      "--runbook",
      runbook,
      "--request",
      "700",
      "--comment",
      comment,
      "--retract",
      note,
      "--record",
      record,
      "Settled-wait drift=1",
    ];

    const red = night(dir, args(body), join(dir, "output"));

    expect(red.status, red.stderr).toBe(1);
    expect(existsSync(body)).toBe(true);
    // No retraction: the comment it would be a note about is one nothing stands on any more.
    expect(existsSync(note)).toBe(false);
    // The body is a comment of its own and says why, rather than reading as a finding discovered tonight.
    expect(readFileSync(body, "utf8")).toContain(
      "**The comment that last said this stands on #604, which the runbook records as closed on " +
        "2026-11-07**",
    );
    // …it goes to the request this night has open, which is where the poster looks for it…
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("reported=true\ncomment-request=700\n");
    // …and the night's own surfaces name the comment it did not touch, the record and the run page both.
    const verdict = readFileSync(record, "utf8");

    expect(verdict).toContain(
      "**The comment stands on #604, which the runbook records as closed on 2026-11-07**",
    );
    expect(verdict).toContain("The finding is reported afresh on #700");
    expect(readFileSync(join(dir, "run-page.md"), "utf8")).toContain("**The comment stands on #604");
    expect(red.stderr).toContain(
      "the comment on #604 stands on a request the runbook records as closed on 2026-11-07 and is left as " +
        "it is",
    );
    // The file's answer to what the comment says now moves with the comment: the fresh one stands on #700.
    const recorded = readFileSync(runbook, "utf8");

    expect(recorded).toContain(reportLine("2026-11-08", "700", named("#612 on 2026-11-05")));
    // …and the night after it has nothing to say, which is the half a body cannot do: the same night over
    // the runbook the last one left is quiet, so the finding is said once per channel rather than nightly.
    const quiet = night(dir, args(join(dir, "quiet.md")), join(dir, "quiet-output"), "2026-11-09");

    expect(quiet.status, quiet.stderr).toBe(1);
    expect(existsSync(join(dir, "quiet.md"))).toBe(false);
    expect(readFileSync(join(dir, "quiet-output"), "utf8")).toContain("reported=false");
    expect(readFileSync(runbook, "utf8")).toBe(recorded);

    // The control is the same night over a runbook whose request nobody has answered: the body is a rewrite
    // of the comment it stands on — #604, the request the runbook names — and carries no word about a move,
    // so the ending is what decides both where the finding is said and what the body says about itself.
    const control = mkdtempSync(join(tmpdir(), "wait-drift-ended-afresh-control-"));
    const plain = join(control, "run.md");
    const controlLines = join(control, "wait-drift-lines.md");
    const controlBody = join(control, "afresh.md");

    writeFileSync(controlLines, BLOCK);
    writeFileSync(
      plain,
      recordReport(RUNBOOK, {
        entries: [{ label: LABEL, line: REFUTED_LINE }],
        request: "604",
        night: "2026-11-06",
      }).text,
    );
    const plainNight = night(
      control,
      [
        "--drift",
        `Settled-wait drift=${controlLines}`,
        "--set",
        "Settled-wait drift=#612 on 2026-11-05",
        "--runbook",
        plain,
        "--request",
        "700",
        "--comment",
        controlBody,
        "--retract",
        join(control, "note.md"),
        "--record",
        join(control, "verdict.md"),
        "Settled-wait drift=1",
      ],
      join(control, "output"),
    );

    expect(plainNight.status, plainNight.stderr).toBe(1);
    expect(readFileSync(join(control, "output"), "utf8")).toContain("comment-request=604");
    expect(readFileSync(controlBody, "utf8")).not.toContain("The comment that last said this");
  });

  it("owes the finding rather than handing it to a thread that ended", () => {
    // The third shape: the comment cannot be rewritten and no request is open tonight to say the finding on
    // instead. That is the settle mode's own rule for a crossing with nowhere to go — owed rather than
    // spent — and the night says which of the two it is rather than leaving a reader to tell a missing file
    // from a quiet night. Its control is the same night with the request unanswered, which reports the
    // finding on the open request exactly as it always has.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ended-owed-"));
    const runbook = answered(dir, "merged");
    const lines = join(dir, "wait-drift-lines.md");
    const body = join(dir, "owed.md");
    const note = join(dir, "owed-note.md");
    const record = join(dir, "verdict.md");

    writeFileSync(lines, BLOCK);
    const args = [
      "--drift",
      `Settled-wait drift=${lines}`,
      "--set",
      "Settled-wait drift=#612 on 2026-11-05",
      "--runbook",
      runbook,
      "--request",
      "",
      "--comment",
      body,
      "--retract",
      note,
      "--record",
      record,
      "Settled-wait drift=1",
    ];
    const before = readFileSync(runbook, "utf8");
    const red = night(dir, args, join(dir, "output"));

    expect(red.status, red.stderr).toBe(1);
    expect(existsSync(body)).toBe(false);
    expect(existsSync(note)).toBe(false);
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("reported=false");
    expect(red.stderr).toContain(
      "the comment on #604 stands on a request the runbook records as merged on 2026-11-07 — not " +
        "rewritten, and nothing written to",
    );
    expect(readFileSync(record, "utf8")).toContain("Nothing is open tonight to say it on");
    // Nothing was recorded either: there is no comment the file's answer could have moved to.
    expect(readFileSync(runbook, "utf8")).toBe(before);

    // The control is the same night over a runbook whose request nobody has answered: the finding is owed
    // for the other reason — no comment stands to update and nothing is open to say it on — and the log
    // says that one instead, so the sentence above is about the ending rather than about silence.
    const control = mkdtempSync(join(tmpdir(), "wait-drift-ended-owed-control-"));
    const plain = join(control, "run.md");

    writeFileSync(
      plain,
      recordReport(RUNBOOK, {
        entries: [{ label: LABEL, line: REFUTED_LINE }],
        request: "604",
        night: "2026-11-06",
      }).text,
    );
    const plainNight = night(
      control,
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        "Settled-wait drift=#612 on 2026-11-05",
        "--runbook",
        plain,
        "--request",
        "",
        "--comment",
        join(control, "owed.md"),
        "--retract",
        join(control, "owed-note.md"),
        "--record",
        join(control, "verdict.md"),
        "Settled-wait drift=1",
      ],
      join(control, "output"),
    );

    expect(plainNight.status, plainNight.stderr).toBe(1);
    // …with no settlement in the file the same night writes the comment it always wrote — the one that
    // stands, on #604 — and says nothing about a request having ended, so the ending is the whole reason the
    // night above wrote nothing at all.
    expect(existsSync(join(control, "owed.md"))).toBe(true);
    expect(readFileSync(join(control, "output"), "utf8")).toContain("comment-request=604");
    expect(plainNight.stderr).not.toContain("stands on a request the runbook records as");
  });

  it("leaves the comment alone for the other kind's ending, and only where that line is a close", () => {
    // The same three nights over a runbook whose ending the *other* kind's line records: the comment stands
    // on a pull request whose ask was left elsewhere, and that ask's settlement is the only line in the file
    // that says the pull request went away. A comment left anywhere has to be safe from a rewrite into that
    // thread, so the night reads it as an ending at all. What it may *not* read as one is the same kind's
    // line declaring a reply: that ends the ask and leaves the pull request standing, and the control at the
    // bottom is the night that then rewrites the comment exactly as it always has.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ended-collect-"));
    const runbook = answered(dir, "closed unanswered", "604", 2, collectSettledLine);
    const body = join(dir, "green.md");
    const note = join(dir, "green-note.md");
    const record = join(dir, "verdict.md");
    const before = readFileSync(runbook, "utf8");
    const green = night(dir, repaired(runbook, { body, note, record }), join(dir, "output"));

    expect(green.status, green.stderr).toBe(0);
    // Nothing is written: not the retraction — the request is over, so there is nobody to tell — and not the
    // body it would have been written into. The two outputs keep both poster steps `skipped`.
    expect(existsSync(body)).toBe(false);
    expect(existsSync(note)).toBe(false);
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("reported=false");
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("retract=\n");
    expect(green.stdout).toContain(
      "the comment on #604 stands on a request the runbook records as closed unanswered on 2026-11-07",
    );
    // …the artifact carries the fact with the runbook's own word for it, which is the one surface a month
    // later has of a night that wrote nothing…
    expect(readFileSync(record, "utf8")).toContain(
      "**The comment stands on #604, which the runbook records as closed unanswered on 2026-11-07**",
    );
    // …and the file is byte-identical, so the next night reaches the same answer without anything recorded.
    expect(readFileSync(runbook, "utf8")).toBe(before);

    // …the refuted night is the half that keeps this from being a silence: the finding is said afresh on the
    // request this night has open, in a body that names the comment it left behind.
    const red = mkdtempSync(join(tmpdir(), "wait-drift-ended-collect-red-"));
    const redRunbook = answered(red, "closed unanswered", "604", 2, collectSettledLine);
    const lines = join(red, "wait-drift-lines.md");

    writeFileSync(lines, BLOCK);
    const redNight = night(
      red,
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        "Settled-wait drift=#612 on 2026-11-05",
        "--runbook",
        redRunbook,
        "--request",
        "700",
        "--comment",
        join(red, "afresh.md"),
        "--retract",
        join(red, "afresh-note.md"),
        "--record",
        join(red, "verdict.md"),
        "Settled-wait drift=1",
      ],
      join(red, "output"),
    );

    expect(redNight.status, redNight.stderr).toBe(1);
    expect(readFileSync(join(red, "output"), "utf8")).toContain("reported=true\ncomment-request=700\n");
    expect(readFileSync(join(red, "afresh.md"), "utf8")).toContain(
      "**The comment that last said this stands on #604, which the runbook records as closed unanswered " +
        "on 2026-11-07**",
    );
    expect(readFileSync(redRunbook, "utf8")).toContain(
      reportLine("2026-11-08", "700", named("#612 on 2026-11-05")),
    );

    // The control: the same green night over a runbook whose collect line declares a *reply*. The pull
    // request is still there and the comment is one to rewrite, so the retraction is written as on any night
    // — which is what separates this read from "any settlement of the number ends the thread".
    const control = mkdtempSync(join(tmpdir(), "wait-drift-collect-reply-"));
    const reply = answered(control, "applied", "604", 2, collectSettledLine);
    const rewritten = night(
      control,
      repaired(reply, {
        body: join(control, "green.md"),
        note: join(control, "green-note.md"),
        record: join(control, "verdict.md"),
      }),
      join(control, "output"),
    );

    expect(rewritten.status, rewritten.stderr).toBe(0);
    expect(readFileSync(join(control, "green-note.md"), "utf8")).toContain(
      "## The settled-wait record is repaired",
    );
    expect(rewritten.stdout).toContain("the comment on #604 is rewritten to say the record is repaired");
  });

  it("leaves the comment alone where the runbook records the request's own close, weeks after the answer", () => {
    // The state the close record exists for, end to end: the ask was answered — a word that says nothing
    // about the pull request — and the request has since gone. A comment on it must not be rewritten either,
    // and the settlement line alone would not have said so.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ended-closed-"));
    const runbook = join(dir, "run.md");
    const reported = recordReport(RUNBOOK, {
      entries: [{ label: LABEL, line: REFUTED_LINE }],
      request: "604",
      night: "2026-11-06",
    }).text;

    writeFileSync(
      runbook,
      `${reported}${collectSettledLine("2026-11-07", "604", "applied", 2)}\n\n${closeLine("2026-11-09", "604")}\n`,
    );
    const body = join(dir, "green.md");
    const note = join(dir, "green-note.md");
    const record = join(dir, "verdict.md");
    const before = readFileSync(runbook, "utf8");
    const green = night(dir, repaired(runbook, { body, note, record }), join(dir, "output"));

    expect(green.status, green.stderr).toBe(0);
    // Nothing is written: not the retraction, and not the body it would have been written into. The two
    // outputs keep both poster steps `skipped`, and the day the sentence names is the *close's*, not the
    // answer's — which is what tells this case apart from the one below.
    expect(existsSync(body)).toBe(false);
    expect(existsSync(note)).toBe(false);
    expect(readFileSync(join(dir, "output"), "utf8")).toContain("retract=\n");
    expect(green.stdout).toContain(
      "the comment on #604 stands on a request the runbook records as closed on 2026-11-09",
    );
    expect(readFileSync(record, "utf8")).toContain(
      "**The comment stands on #604, which the runbook records as closed on 2026-11-09**",
    );
    expect(readFileSync(runbook, "utf8")).toBe(before);

    // The control is the same night with the close line left out — the file as it stood the day the ask was
    // answered, with the request still open. The retraction is written, so what this case turns on is the
    // *close* rather than an answered ask.
    const control = mkdtempSync(join(tmpdir(), "wait-drift-answered-open-"));
    const open = join(control, "run.md");

    writeFileSync(open, `${reported}${collectSettledLine("2026-11-07", "604", "applied", 2)}\n\n`);
    const openNight = night(
      control,
      repaired(open, {
        body: join(control, "green.md"),
        note: join(control, "green-note.md"),
        record: join(control, "verdict.md"),
      }),
      join(control, "output"),
    );

    expect(openNight.status, openNight.stderr).toBe(0);
    expect(readFileSync(join(control, "green-note.md"), "utf8")).toContain(
      "## The settled-wait record is repaired",
    );
    expect(openNight.stdout).toContain("the comment on #604 is rewritten to say the record is repaired");
  });

  it("rewrites the comment again where the runbook records the request as reopened", () => {
    // The other direction of the same correction, and the one that separates a *record* from a permanent
    // claim: the request recorded as gone and since reopened is a place a person is again, so the comment on
    // it is one to rewrite — the case above with one line appended, which is what makes the reopening rather
    // than the close the cause. Its control is the night that finds the close still standing, and its third
    // night is the correction being corrected in turn: closed a second time, the thread is over again and the
    // day the sentence names is the *later* close's, because the record's latest word is what stands.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-reopened-"));
    const runbook = join(dir, "run.md");
    const reported = recordReport(RUNBOOK, {
      entries: [{ label: LABEL, line: REFUTED_LINE }],
      request: "604",
      night: "2026-11-06",
    }).text;
    const answered = `${reported}${collectSettledLine("2026-11-07", "604", "applied", 2)}\n\n`;
    const closed = `${answered}${closeLine("2026-11-09", "604")}\n`;
    const back = join(dir, "green-note.md");

    writeFileSync(runbook, `${closed}\n${reopenLine("2026-11-15", "604", "2026-11-09")}\n`);
    const green = night(
      dir,
      repaired(runbook, {
        body: join(dir, "green.md"),
        note: back,
        record: join(dir, "verdict.md"),
      }),
      join(dir, "output"),
    );

    expect(green.status, green.stderr).toBe(0);
    // The comment is a place a person is again, so the night writes the retraction it writes on any night…
    expect(readFileSync(back, "utf8")).toContain("## The settled-wait record is repaired");
    expect(green.stdout).toContain("the comment on #604 is rewritten to say the record is repaired");
    // …and it says nothing about an ending, which is the whole of what the case above turns on.
    expect(green.stdout).not.toContain("stands on a request the runbook records as");
    expect(readFileSync(join(dir, "verdict.md"), "utf8")).not.toContain("The comment stands on");

    // The control: the same night over the same file with the correction left off — the close standing on
    // its own, which writes nothing and names that close's day.
    const control = mkdtempSync(join(tmpdir(), "wait-drift-closed-still-"));
    const stillClosed = join(control, "run.md");

    writeFileSync(stillClosed, closed);
    const held = night(
      control,
      repaired(stillClosed, {
        body: join(control, "green.md"),
        note: join(control, "green-note.md"),
        record: join(control, "verdict.md"),
      }),
      join(control, "output"),
    );

    expect(held.status, held.stderr).toBe(0);
    expect(existsSync(join(control, "green-note.md"))).toBe(false);
    expect(held.stdout).toContain(
      "the comment on #604 stands on a request the runbook records as closed on 2026-11-09",
    );

    // …and the third night: closed a second time after the correction, so the thread is over again and the
    // word the night names is the later close's. The correction moves the record's answer; it does not retire
    // the question.
    const again = mkdtempSync(join(tmpdir(), "wait-drift-reclosed-"));
    const twice = join(again, "run.md");

    writeFileSync(
      twice,
      `${closed}\n${reopenLine("2026-11-15", "604", "2026-11-09")}\n\n${closeLine("2026-11-20", "604")}\n`,
    );
    const reclosed = night(
      again,
      repaired(twice, {
        body: join(again, "green.md"),
        note: join(again, "green-note.md"),
        record: join(again, "verdict.md"),
      }),
      join(again, "output"),
    );

    expect(reclosed.status, reclosed.stderr).toBe(0);
    expect(existsSync(join(again, "green-note.md"))).toBe(false);
    expect(reclosed.stdout).toContain(
      "the comment on #604 stands on a request the runbook records as closed on 2026-11-20",
    );
  });
});

/**
 * The ending written *into* the comment itself — the half the night cannot leave to the run page.
 *
 * The comment is the one surface here a person meets without opening anything, so a comment left on a thread
 * that has ended is the one place the runbook's own word for the ending reaches a reader: `--end` renders it
 * (`endingComment`) and the poster rewrites the marked comment with it, `--update-only` because that comment is
 * the one this job left there. The writing is an event exactly as the finding is, and the runbook is what makes
 * that true — the same append-only file keeps the ending (`recordEnded`), so a later night reads the comment as
 * carrying it and stays quiet, while an ending that says something *else* is news and is written again. The
 * four nights below are the shapes: both bodies at once, the ending on a night the record holds, the ending
 * that has moved, and the finding written back when the request comes back.
 */
describe("the ending written into that comment", () => {
  /**
   * One night over one runbook, with the three bodies the workflow asks for and the request it has open.
   *
   * The paths are fixed per directory rather than returned, because half of these cases are about a *second*
   * night over the same file: what the night after writes is asserted by comparing the bytes the first one
   * left, and a fresh path per night would make a body written again invisible.
   */
  function night(
    dir: string,
    runbook: string,
    out: string,
    { request = "700", wanted = REFUTED_LINE, count = "1", today = "2026-11-08" } = {},
  ) {
    const lines = join(dir, "wait-drift-lines.md");

    writeFileSync(lines, BLOCK);
    const body = join(dir, "repair.md");
    const note = join(dir, "retract.md");
    const end = join(dir, "ending.md");
    const record = join(dir, "verdict.md");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        `Settled-wait drift=${wanted}`,
        "--runbook",
        runbook,
        "--request",
        request,
        "--comment",
        body,
        "--retract",
        note,
        "--end",
        end,
        "--record",
        record,
        `Settled-wait drift=${count}`,
        "--today",
        today,
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, "run-page.md") },
      },
    );

    return { body, note, end, record, result };
  }

  /** A runbook whose comment on #604 stands on a request that has since been answered. */
  function ended(dir: string, { outcome = "merged", request = "604" } = {}) {
    const runbook = join(dir, "run.md");
    const reported = recordReport(RUNBOOK, {
      entries: [{ label: LABEL, line: REFUTED_LINE }],
      request,
      night: "2026-11-06",
    }).text;

    writeFileSync(runbook, `${reported}${settledLine("2026-11-07", request, outcome, 2)}\n\n`);
    return runbook;
  }

  it("writes the ending into the comment on the request that ended, and the finding afresh beside it", () => {
    // Both bodies on one night, which is the shape the workflow is wired for: the ending goes to the request
    // whose thread is over and the finding goes to the one this night has open. Neither is a rewrite of the
    // other's comment, and the two are the whole reason the pair of poster steps exists.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ending-both-"));
    const runbook = ended(dir);
    const output = join(dir, "output");
    const { body, note, end, record, result } = night(dir, runbook, output);

    expect(result.status, result.stderr).toBe(1);
    // The finding is a *new* comment on tonight's request, and it says why it is new — the same body a night
    // without an ending writes, and the whole of what the ended thread costs the finding.
    expect(readFileSync(body, "utf8")).toContain(
      "**The comment that last said this stands on #604, which the runbook records as merged on 2026-11-07**",
    );
    // …and the ending goes into the comment that stands on the request that ended: the mark stays in it, the
    // reader is told the thread is over in the record's own words, and what that comment reported is named so
    // a person meeting it months later knows what it was for.
    const said = readFileSync(end, "utf8");

    expect(said).toContain(RECORD_COMMENT_MARKER);
    expect(said).toContain("## Settled-wait record — the thread this comment reported is over");
    expect(said).toContain("the runbook records #604 as **merged on 2026-11-07**");
    expect(said).toContain(`\`${REFUTED_LINE}\``);
    expect(said).toContain("The finding is reported afresh on #700");
    expect(said).toContain("if this request is reopened");
    // No retraction: the comment a note would be about is one nothing stands on any more, so the ending body is
    // what that poster step is handed instead.
    expect(existsSync(note)).toBe(false);
    // Three outputs, and the third is the new one — the ending's request is where its poster looks.
    const published = readFileSync(output, "utf8");

    expect(published).toContain("reported=true\ncomment-request=700\n");
    expect(published).toContain("retract=\n");
    expect(published).toContain("ended-request=604\n");
    // …and the night's own surfaces say it, on both readings: the sentence names the ending *and* that it was
    // written, which is the difference between this night and the one that only reads.
    const verdict = readFileSync(record, "utf8");

    expect(verdict).toContain(
      "**The comment stands on #604, which the runbook records as merged on 2026-11-07**",
    );
    expect(verdict).toContain("this night rewrites it with that ending");
    expect(verdict).toContain("The finding is reported afresh on #700");
    expect(readFileSync(join(dir, "run-page.md"), "utf8")).toContain("**The comment stands on #604");
    // The log says where each body went, since none of them is visible on this run's page: the finding's to the
    // request this night has open, and the ending's to the request that ended and to the file the poster reads.
    expect(result.stderr).toContain(
      "the comment on #604, which the runbook records as merged on 2026-11-07, is rewritten with that " +
        `ending to ${end}`,
    );
    expect(result.stderr).toContain(`the night's comment to ${body} (on #700)`);

    // The runbook holds both facts, and their *order* is the half a sentence cannot do: the ending is what that
    // comment says now, and the report is what the comment this night left carries — so the report is the
    // file's last word, which is what keeps the night after from rewriting the fresh comment it just wrote.
    const recorded = readFileSync(runbook, "utf8");
    const endLine =
      "- **2026-11-08 — refuted crossing line comment ended on #604: the request was merged on 2026-11-07.**";
    const reported = reportLine("2026-11-08", "700", named(REFUTED_LINE));

    expect(recorded).toContain(endLine);
    expect(recorded).toContain(reported);
    expect(recorded.indexOf(endLine)).toBeLessThan(recorded.indexOf(reported));

    // …and the night after is quiet, which is the whole of the "once": the report the last night wrote is what
    // the walk answers with, so there is no body to put up and no ending to say again. Byte-identical, because
    // the settlement line *is* the state — nothing has to be recorded for the next night's answer to be this.
    const saidBefore = readFileSync(end, "utf8");
    const bodyBefore = readFileSync(body, "utf8");
    const quiet = night(dir, runbook, join(dir, "quiet-output"), { today: "2026-11-09" });

    expect(quiet.result.status, quiet.result.stderr).toBe(1);
    expect(readFileSync(end, "utf8")).toBe(saidBefore);
    expect(readFileSync(body, "utf8")).toBe(bodyBefore);
    expect(readFileSync(join(dir, "quiet-output"), "utf8")).toContain("reported=false");
    expect(readFileSync(join(dir, "quiet-output"), "utf8")).toContain("ended-request=\n");
    expect(readFileSync(runbook, "utf8")).toBe(recorded);
  });

  it("writes the ending on a night the record holds, where nothing else is owed", () => {
    // The ending owed on its own: the record was read and holds nothing refuted, so there is no body to put up
    // and no retraction to write — while the comment on the request that ended is still the one surface saying
    // a red nobody there can read. It is written, and it is the *only* thing this night writes.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ending-green-"));
    const runbook = ended(dir);
    const output = join(dir, "output");
    const { body, note, end, result } = night(dir, runbook, output, { count: "0", wanted: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(body)).toBe(false);
    expect(existsSync(note)).toBe(false);
    const said = readFileSync(end, "utf8");

    expect(said).toContain("the runbook records #604 as **merged on 2026-11-07**");
    expect(said).toContain("The red this comment carried is replaced by that ending");
    const published = readFileSync(output, "utf8");

    expect(published).toContain("reported=false");
    expect(published).toContain("retract=\n");
    expect(published).toContain("ended-request=604\n");
    // The file states the ending and nothing else — no retraction line, because nothing was retracted: the red
    // the comment carried is replaced by the ending rather than taken down.
    const recorded = readFileSync(runbook, "utf8");

    expect(recorded).toContain(
      "- **2026-11-08 — refuted crossing line comment ended on #604: the request was merged on 2026-11-07.**",
    );
    expect(recorded).not.toContain("refuted crossing line retracted");
    expect(recorded).not.toContain(reportLine("2026-11-08", "700"));
    expect(result.stdout).toContain("is rewritten with the ending");

    // …and the night after it writes nothing at all: the comment already carries the ending the record states,
    // so the same run over the same file is quiet, and it says which of the two quiet nights this is.
    const already = readFileSync(end, "utf8");
    const again = night(dir, runbook, join(dir, "quiet-output"), {
      count: "0",
      wanted: "",
      today: "2026-11-09",
    });

    expect(again.result.status, again.result.stderr).toBe(0);
    expect(readFileSync(end, "utf8")).toBe(already);
    expect(readFileSync(runbook, "utf8")).toBe(recorded);
    expect(again.result.stdout).toContain("already carries the ending");
  });

  it("writes the ending again where the record's word about the thread has moved", () => {
    // The other direction of the once: the comment carries *an* ending and the record now states a different
    // one — the pull request went away, came back and went away again — so what is on the comment is the stale
    // claim and the night says the record's latest word instead. The day the sentence names is the later
    // close's, because that is the file's last statement about the thread.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ending-moved-"));
    const runbook = join(dir, "run.md");
    const reported = recordReport(RUNBOOK, {
      entries: [{ label: LABEL, line: REFUTED_LINE }],
      request: "604",
      night: "2026-11-06",
    }).text;
    const answeredAsk = `${reported}${collectSettledLine("2026-11-07", "604", "applied", 2)}\n\n`;

    writeFileSync(runbook, `${answeredAsk}${closeLine("2026-11-09", "604")}\n`);
    const first = night(dir, runbook, join(dir, "first-output"), { count: "0", wanted: "" });

    expect(first.result.status, first.result.stderr).toBe(0);
    expect(readFileSync(first.end, "utf8")).toContain("the runbook records #604 as **closed on 2026-11-09**");

    const before = readFileSync(runbook, "utf8");

    writeFileSync(
      runbook,
      `${before}\n${reopenLine("2026-11-15", "604", "2026-11-09")}\n\n${closeLine("2026-11-20", "604")}\n`,
    );
    const second = night(dir, runbook, join(dir, "second-output"), {
      count: "0",
      wanted: "",
      today: "2026-11-21",
    });

    expect(second.result.status, second.result.stderr).toBe(0);
    expect(readFileSync(second.end, "utf8")).toContain("the runbook records #604 as **closed on 2026-11-20**");
    expect(readFileSync(runbook, "utf8")).toContain(
      "- **2026-11-21 — refuted crossing line comment ended on #604: the request was closed on 2026-11-20.**",
    );

    // …and the third night, over the same file, is quiet: the comment now carries the record's own latest word
    // about the thread, and the correction is what moved it rather than the question being asked again.
    const after = readFileSync(second.end, "utf8");
    const third = night(dir, runbook, join(dir, "third-output"), {
      count: "0",
      wanted: "",
      today: "2026-11-22",
    });

    expect(third.result.status, third.result.stderr).toBe(0);
    expect(readFileSync(second.end, "utf8")).toBe(after);
    expect(third.result.stdout).toContain("already carries the ending");
  });

  it("writes the finding back into that comment when the request comes back", () => {
    // The case the marker staying in the ending body exists for: a request the record once called over and
    // GitHub has since reopened is a place a person is again, so the comment carrying its ending is the one to
    // write the finding into — the ending in it is the stale claim, and the mark is there to find it by.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ending-back-"));
    const runbook = ended(dir);
    const first = night(dir, runbook, join(dir, "first-output"), { count: "0", wanted: "" });

    expect(first.result.status, first.result.stderr).toBe(0);
    expect(readFileSync(first.end, "utf8")).toContain("the runbook records #604 as **merged on 2026-11-07**");

    const before = readFileSync(runbook, "utf8");

    writeFileSync(runbook, `${before}\n${reopenLine("2026-11-15", "604", "2026-11-07", "floor proposal")}\n`);
    const back = night(dir, runbook, join(dir, "back-output"), { today: "2026-11-16" });

    expect(back.result.status, back.result.stderr).toBe(1);
    // The finding is a rewrite of that comment rather than a new one — `comment-request` is the request it
    // *stands* on — and nothing about lines having joined or left is claimed, because the comment it rewrites
    // carries no lines at all.
    const written = readFileSync(back.body, "utf8");

    expect(written).toContain(RECORD_COMMENT_MARKER);
    expect(written).not.toContain("no longer holds");
    expect(written).not.toContain("now also holds");
    expect(written).not.toContain("The comment that last said this");
    expect(readFileSync(join(dir, "back-output"), "utf8")).toContain("reported=true\ncomment-request=604\n");
    expect(readFileSync(join(dir, "back-output"), "utf8")).toContain("ended-request=\n");
    // No second ending: the request the comment stands on is open again, so there is nothing to say about its
    // thread — and the runbook moves the comment back to the finding with a report line, which is what the walk
    // answers with from here.
    expect(readFileSync(back.end, "utf8")).toBe(readFileSync(first.end, "utf8"));
    expect(readFileSync(runbook, "utf8")).toContain(
      reportLine("2026-11-16", "604", named(REFUTED_LINE)),
    );
    expect(back.result.stderr).not.toContain("comment ended on");

    // …and the night after that is quiet on the same terms as any standing comment: the report names the line
    // it just refuted, so the night has nothing to say.
    const recorded = readFileSync(runbook, "utf8");
    const quiet = night(dir, runbook, join(dir, "quiet-output"), { today: "2026-11-17" });

    expect(quiet.result.status, quiet.result.stderr).toBe(1);
    expect(readFileSync(join(dir, "quiet-output"), "utf8")).toContain("reported=false");
    expect(readFileSync(runbook, "utf8")).toBe(recorded);
  });
});

/**
 * The steps the job runs as a *pair*: each case drives both of them over one directory, because each pair
 * is one action split across two steps and either half's own cases stay green when the two stop agreeing —
 * a body one step writes and the other is not handed, a request published under a name the poster does
 * not read, a count read back by a gate the settle step never fed.
 */
describe("the pair the workflow runs", () => {
  /**
   * The `gh` the poster calls instead of the real one: it records its argv, then answers the listing.
   *
   * The same seam `pr-comment.test.ts` drives the poster through, kept here rather than imported because
   * what this case needs from `gh` is one comment id — the marked comment the night the finding was
   * reported left on the request, which is the comment the retraction is supposed to rewrite.
   */
  const GH = [
    'import { appendFileSync } from "node:fs";',
    "const args = process.argv.slice(2);",
    'appendFileSync(process.env.GH_LOG, `${JSON.stringify(args)}\\n`);',
    'if (args.includes("--jq")) process.stdout.write(process.env.GH_LOOKUP ?? "");',
    "",
  ].join("\n");

  /** One night's invocation of the real gate, with the output file the poster's gate reads. */
  function night(dir: string, args: string[], out: string, today = "2026-11-06") {
    return spawnSync(process.execPath, [script, ...args, "--today", today], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: join(dir, out) },
    });
  }

  it("rewrites the marked comment with the night's own note, on the request the gate published", () => {
    // The two steps are one action: the verdict step renders the note and names the request the comment
    // stands on, and the poster rewrites that comment with the file it wrote. Each half is covered on its
    // own above and in `pr-comment.test.ts`, and neither would notice the seam going wrong — a body the
    // poster is not handed, a request the poster is not told, or a marker the lookup greps for that the
    // body no longer carries are all invisible to a suite that drives one script at a time. So this case
    // runs the whole path over one directory: report the finding, repair the record, post the note.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-pair-"));
    const lines = join(dir, "wait-drift-lines.md");
    const runbook = join(dir, "run.md");
    writeFileSync(lines, BLOCK);
    writeFileSync(runbook, RUNBOOK);

    // The night the finding is reported, which is what leaves a comment on the request for the night
    // below to take down again.
    const red = night(
      dir,
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        `Settled-wait drift=${REFUTED_LINE}`,
        "--runbook",
        runbook,
        "--request",
        "604",
        "--comment",
        join(dir, "repair.md"),
        "Settled-wait drift=1",
      ],
      "red-output",
    );

    expect(red.status, red.stderr).toBe(1);
    expect(existsSync(join(dir, "repair.md"))).toBe(true);

    // …and the night the record comes back repaired, which owes the note instead of a body: the count is
    // `0`, the lines are the empty list, and where the note goes is read off the standing comment the
    // runbook now holds rather than off this night's request.
    const note = join(dir, "retract.md");
    const green = night(
      dir,
      [
        "--drift",
        `Settled-wait drift=${lines}`,
        "--set",
        "Settled-wait drift=",
        "--runbook",
        runbook,
        "--request",
        "604",
        "--comment",
        join(dir, "green.md"),
        "--retract",
        note,
        "Settled-wait drift=0",
      ],
      "green-output",
      "2026-11-07",
    );

    expect(green.status, green.stderr).toBe(0);
    expect(existsSync(join(dir, "green.md"))).toBe(false);
    // The step's two facts, parsed the way the workflow's `if:` and `env:` read them rather than restated:
    // no body to post, and a request to rewrite the note on. Nothing is written to the poster's step when
    // the first is `false` and the second is empty, which is the whole of why the pair is gated that way.
    const published = readFileSync(join(dir, "green-output"), "utf8");
    const reported = /^reported=(.*)$/m.exec(published)?.[1] ?? "";
    const request = /^retract=(.*)$/m.exec(published)?.[1] ?? "";

    expect(reported).toBe("false");
    expect(request).toBe("604");

    // …and the poster, spawned the way the workflow's step is: `--update-only`, the marker the comment is
    // found by, the body the gate just wrote, and the request the gate just published.
    const stub = join(dir, "gh-stub.mjs");
    writeFileSync(stub, GH);
    const ghLog = join(dir, "gh.log");
    const summary = join(dir, "summary.md");
    const posted = spawnSync(
      process.execPath,
      [
        join(projectRoot, ".freebuff", "pr-comment.mjs"),
        "--update-only",
        "--marker",
        RECORD_COMMENT_MARKER,
        "--body",
        note,
        "--label",
        "Repaired settled-wait record",
        "--producer",
        "Retract the refuted record that was repaired",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: "o/r",
          PR: request,
          GH_TOKEN: "x",
          PR_COMMENT_GH: stub,
          GH_LOG: ghLog,
          GH_LOOKUP: "42\n",
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );

    expect(posted.status, posted.stderr).toBe(0);
    const calls = readFileSync(ghLog, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as string[]);
    const listing = calls.find((call) => call.includes("--jq")) ?? [];
    const write = calls.find((call) => !call.includes("--jq")) ?? [];
    // One rewrite and no creation: the note is an edit of the comment the finding was reported on, which is
    // the whole reason this pair can be taken down at all — a `POST` here would leave the red standing
    // beside a note about a repair nobody was told about.
    expect(write[2]).toBe("PATCH");
    expect(write[3]).toBe("repos/o/r/issues/comments/42");
    // …on the request the gate published, which is the one the comment stands on.
    expect(listing[1]).toBe(`repos/o/r/issues/${request}/comments`);
    // …with the gate's own file, byte for byte: not a second rendering of it, and not a path each step
    // spells for itself.
    expect(write[5]).toBe(`body=${readFileSync(note, "utf8")}`);
    // …and the half of the pair that has to agree for any of this to work: the marker the lookup greps for
    // is the marker the body opens with, read out of the body rather than from a constant, because a body
    // and a lookup that drifted apart post a second comment every night while both steps' suites stay
    // green.
    const marker = /^<!-- .* -->$/m.exec(readFileSync(note, "utf8"))?.[0] ?? "";

    expect(marker).toBe(RECORD_COMMENT_MARKER);
    expect(listing.join(" ")).toContain(`contains("${marker}")`);
    // …and a retraction that landed is not news: the run page carries nothing, which is what makes the ✅
    // note the poster writes when it finds no comment worth reading.
    expect(existsSync(summary) ? readFileSync(summary, "utf8") : "").toBe("");
  });

  it("writes the ending into the marked comment on the request that ended, and nowhere else", () => {
    // The third poster, and the pair whose request is not this night's: `ended-request` names the request the
    // standing comment is on — one this night may not have open, and one a person may never open again — so
    // the ending is only worth writing if it lands on *that* request's comment, found by the marker the body
    // keeps. Each half is covered on its own in `pr-comment.test.ts` and in the describe above; neither would
    // notice the two steps drifting apart, which is what this case is for.
    const verdict = argvOf(
      runBlock(stepBlock("Fail on a crossing line the records do not produce")),
      ".freebuff/wait-drift-gate.mjs",
    );
    const endingStep = stepBlock("Comment the ending on the request that ended");
    const poster = argvOf(runBlock(endingStep), ".freebuff/pr-comment.mjs");

    // The file the poster is handed is the file the verdict step was told to write: one path, spelled once, so
    // a night that renamed either would post a body that does not exist or leave the ending in a file no poster
    // reads — and the other two bodies are files of their own, which is what keeps a poster from putting up what
    // another step wrote for another purpose.
    const endPath = flagValues(verdict, "--end")[0];

    expect(endPath, "the verdict step names no ending body").toBeTruthy();
    expect(flagValues(poster, "--body")).toEqual([endPath]);
    expect(endPath).not.toBe(flagValues(verdict, "--comment")[0]);
    expect(endPath).not.toBe(flagValues(verdict, "--retract")[0]);
    // …and the comment is *found* rather than posted: the ending rewrites the comment the red was left on, so a
    // fresh post here would leave that red standing beside the ending that replaces it.
    expect(poster).toContain("--update-only");
    expect(flagValues(poster, "--marker")).toEqual([RECORD_COMMENT_MARKER]);
    // …on the request the verdict step published as the ended one, read out of the step rather than restated
    // here: a renamed output substitutes as the empty value below, which is exactly how the poster would behave
    // — a lookup on nothing at all, and a green step over a red nobody took down.
    const requestExpr = /\n\s+PR: \$\{\{ steps\.([\w-]+)\.outputs\.([\w-]+) \}\}/.exec(endingStep);

    expect(requestExpr?.[1], "the ending step posts on another step's output").toBe("wait-drift");

    // The night, in a directory shaped like the checkout: the runbook the step names, the block the settle step
    // publishes for the record, and the files under `.ci/` the night is told it may write.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-ending-pair-"));

    mkdirSync(join(dir, ".ci"), { recursive: true });
    mkdirSync(join(dir, ".freebuff"), { recursive: true });
    const runbook = flagValues(verdict, "--runbook")[0];
    const settledDrift = flagValues(verdict, "--drift").find((value) => value.startsWith(`${LABEL}=`));
    const blockPath = (settledDrift ?? "").slice(LABEL.length + 1);

    expect(blockPath, "the verdict step quotes no block for this record").toBeTruthy();
    // A comment the night before left on #604, whose request has since been answered — and this night's own
    // request, #700, which is where a *finding* would go and emphatically not where the ending does.
    const reported = recordReport(RUNBOOK, {
      entries: [{ label: LABEL, line: REFUTED_LINE }],
      request: "604",
      night: "2026-11-06",
    }).text;

    writeFileSync(join(dir, runbook), `${reported}${settledLine("2026-11-07", "604", "merged", 2)}\n\n`);
    writeFileSync(join(dir, blockPath), BLOCK);
    const green = night(
      dir,
      [
        "--drift",
        settledDrift ?? "",
        "--set",
        `${LABEL}=`,
        "--runbook",
        runbook,
        "--request",
        "700",
        "--comment",
        flagValues(verdict, "--comment")[0],
        "--retract",
        flagValues(verdict, "--retract")[0],
        "--end",
        endPath,
        "--record",
        flagValues(verdict, "--record")[0],
        "--summary",
        flagValues(verdict, "--summary")[0],
        `${LABEL}=0`,
      ],
      "output",
      "2026-11-08",
    );

    expect(green.status, green.stderr).toBe(0);
    const published = outputsOf(readFileSync(join(dir, "output"), "utf8"));

    // The night's whole statement: the record holds, so there is no finding and nothing to retract — and the
    // ending is on #604, the request the comment stands on, rather than on the #700 this night has open.
    expect(published["reported"]).toBe("false");
    expect(published["retract"]).toBe("");
    expect(published["ended-request"]).toBe("604");
    // The other two bodies are not written at all, which is the half the poster steps cannot see: a night that
    // wrote them anyway would still post nothing, and the files would be the only sign it had.
    expect(existsSync(join(dir, flagValues(verdict, "--comment")[0]))).toBe(false);
    expect(existsSync(join(dir, flagValues(verdict, "--retract")[0]))).toBe(false);
    const ending = join(dir, endPath);

    expect(existsSync(ending), "the night owed an ending and wrote none").toBe(true);
    // …and the request the poster will look on is the value the verdict step published under the name the ending
    // step reads it by.
    const request = requestExpr === null ? "" : (published[requestExpr[2]] ?? "");

    expect(request, "the ending step reads a request the verdict step does not publish").toBe("604");

    // The poster, spawned as the workflow's step is: its own argv, its own request, and a `gh` that records what
    // it was asked to do.
    const stub = join(dir, "gh-stub.mjs");
    writeFileSync(stub, GH);
    const ghLog = join(dir, "gh.log");
    const summary = join(dir, "poster-page.md");
    const posted = spawnSync(process.execPath, [join(projectRoot, poster[0]), ...poster.slice(1)], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "o/r",
        PR: request,
        GH_TOKEN: "x",
        PR_COMMENT_GH: stub,
        GH_LOG: ghLog,
        GH_LOOKUP: "42\n",
        GITHUB_STEP_SUMMARY: summary,
      },
    });

    expect(posted.status, posted.stderr).toBe(0);
    const calls = readFileSync(ghLog, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as string[]);
    const listing = calls.find((call) => call.includes("--jq")) ?? [];
    const writes = calls.filter((call) => !call.includes("--jq"));

    // One comment is touched and nothing is created: the ending is an edit of the comment the red stands on, and
    // a `POST` here would leave that red beside a note about a thread nobody is reading.
    expect(writes).toHaveLength(1);
    // …on the request that ended, which is the whole of what is read off the verdict step's output.
    expect(listing[1]).toBe("repos/o/r/issues/604/comments");
    expect(writes[0][2]).toBe("PATCH");
    expect(writes[0][3]).toBe("repos/o/r/issues/comments/42");
    // …with the verdict step's own file, byte for byte rather than a second rendering of it.
    expect(writes[0][5]).toBe(`body=${readFileSync(ending, "utf8")}`);
    // …and the marker the lookup greps for is the marker the body opens with: the ending is written into the very
    // comment the red is found by, so a marker missing from the body — or one spelled differently — leaves a later
    // night's lookup finding nothing, green, over a red that was never taken down.
    const marker = /^<!-- .* -->$/m.exec(readFileSync(ending, "utf8"))?.[0] ?? "";

    expect(marker).toBe(RECORD_COMMENT_MARKER);
    expect(listing.join(" ")).toContain(`contains("${marker}")`);
    // The one fact the poster cannot check, and the reason the comment is worth touching at all: the thread is
    // over, in the record's own word and date for it.
    expect(readFileSync(ending, "utf8")).toContain(
      "the runbook records #604 as **merged on 2026-11-07**",
    );
    // …and an ending that landed is not news: the run page carries nothing, on the retraction's own terms — the ✅
    // note is what a *poster* writes when it found no comment worth reading.
    expect(existsSync(summary) ? readFileSync(summary, "utf8") : "").toBe("");
  });

  it("drives the settle step and this gate over one runbook, from the job's own two steps", () => {
    // The writer and the reader as the job runs them, both invocations read out of `nightly.yml` — and
    // the reader handed the values the writer *actually* published rather than fixtures. That is the one
    // agreement neither half's own cases can keep: this suite judges a count it was handed, and the settle
    // suite judges a record nothing reads back, so a renamed output, a block file the two stopped sharing
    // or a line identity that stopped travelling leaves both of them green.
    const writer = argvOf(
      runBlock(stepBlock("Record the floor proposals that have been answered")),
      ".freebuff/coverage-trend.mjs",
    );
    const reader = argvOf(
      runBlock(stepBlock("Fail on a crossing line the records do not produce")),
      ".freebuff/wait-drift-gate.mjs",
    );

    // The script this suite spawns is the one the step names, and the paths the two steps share are the
    // next half: one runbook between them, and — through the label the count is read under — the block
    // the writer publishes for this record is the file the reader quotes for it.
    expect(join(projectRoot, reader[0])).toBe(script);
    const runbook = flagValues(writer, "--runbook")[0];
    const blocks = flagValues(writer, "--drift");
    expect(runbook, "the settle step names no runbook").toBeTruthy();
    expect(flagValues(reader, "--runbook")).toEqual([runbook]);
    const count = reader.find((token) =>
      /\$\{\{\s*steps\.settle-floor\.outputs\.wait-drift\s*\}\}$/.test(token),
    );
    expect(count, "the verdict step reads no count off the settle step").toBeDefined();
    const label = (count ?? "").split("=")[0];
    const block = flagValues(reader, "--drift").find((value) => value.startsWith(`${label}=`));
    expect(block?.slice(label.length + 1)).toBe(blocks[0]);

    // The settlements the step's own `gh pr list` would have written, at the path the step writes them
    // to, and the runbook it reads: three answers whose ages are 1, 4 and 6 nights, so the middle of the
    // ages is 1, then 2.5, then 4 — a rise past a level the history had held, which is the crossing the
    // writer records — and one request still open, which is the only place a finding can be said at all.
    const dir = mkdtempSync(join(tmpdir(), "wait-drift-settle-pair-"));
    mkdirSync(join(dir, ".ci"), { recursive: true });
    mkdirSync(join(dir, ".freebuff"), { recursive: true });
    const answered = (number: number, created: string, closed: string | null) => ({
      number,
      createdAt: created,
      closedAt: closed,
      mergedAt: closed,
    });
    writeFileSync(
      join(dir, flagValues(writer, "--settled")[0]),
      JSON.stringify([
        answered(601, "2026-09-01T02:20:00Z", "2026-09-02T06:00:00Z"),
        answered(602, "2026-09-03T02:20:00Z", "2026-09-07T06:00:00Z"),
        answered(603, "2026-09-08T02:20:00Z", "2026-09-14T06:00:00Z"),
        answered(605, "2026-09-15T02:20:00Z", null),
      ]),
    );
    writeFileSync(join(dir, runbook), "# The runbook\n\n");

    /** One step's run, as the job runs it: the flags verbatim, in a directory shaped like the checkout. */
    const runStep = (argv: string[], out: string, summary: string) =>
      spawnSync(process.execPath, [join(projectRoot, argv[0]), ...argv.slice(1)], {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(dir, out),
          GITHUB_STEP_SUMMARY: join(dir, summary),
        },
      });

    // What the writer published on a night, and the reader's argv with those values substituted for each
    // `${{ … }}` — the handover itself. A name the writer stopped publishing substitutes as the empty
    // string, which is what the workflow would hand over and what the gate reads as a step that never
    // judged; the names asked for are asserted below rather than left to fail open that way.
    let published: Record<string, string> = {};
    const referenced = new Set<string>();
    const read = (out: string) => (published = outputsOf(readFileSync(join(dir, out), "utf8")));
    const withValues = (argv: string[]) =>
      argv.map((token) =>
        token.replace(
          /\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}/g,
          (_whole, step: string, name: string) => {
            // The collect step never ran tonight, and the workflow's own expression for a step that did
            // not is empty — the value this gate leaves unjudged, and a real state of a real night.
            if (step !== "settle-floor") return "";
            referenced.add(name);
            return published[name] ?? "";
          },
        ),
      );

    // The night the record is filed: the writer's own run over a list whose newest answers cross the
    // level on record, so the crossing line it appends is one it wrote itself — and then the verdict on
    // that same record, which is the agreement in the direction nothing is wrong in.
    const filed = runStep(writer, "night-one-output", "night-one-summary.md");

    expect(filed.status, filed.stderr).toBe(0);
    read("night-one-output");
    expect(published["wait-drift"]).toBe("0");
    // …the request the night still has open, which is where a finding can reach a person at all…
    expect(published["open-request"]).toBe("605");
    // …and, with every line the record holds producible, no line named and no block published.
    expect(published["wait-drift-set"]).toBe("");
    expect(existsSync(join(dir, blocks[0])), "a night with nothing to state publishes no block").toBe(false);
    // The line the writer wrote, read back with the module's own reader and rebuilt with its own builder
    // rather than matched by a pattern here: what the next night refutes is what this one recorded.
    const crossings = waitCrossings(readFileSync(join(dir, runbook), "utf8"));
    expect(crossings).toHaveLength(1);
    const recorded = waitCrossing({
      ...crossings[0],
      kind: crossings[0].kind === "collect" ? "collect" : "floor",
    });
    if (recorded === null) throw new Error("the runbook's crossing no longer reads as one");
    expect(readFileSync(join(dir, runbook), "utf8")).toContain(recorded.line);

    const green = runStep(withValues(reader), "verdict-one-output", "verdict-one-summary.md");

    expect(green.status, green.stderr).toBe(0);
    read("verdict-one-output");
    // The held verdict is written too, and the poster's step is told there is nothing to post: an absent
    // body and a `reported` of `false` are the two halves of a night nothing was wrong with.
    expect(readFileSync(join(dir, flagValues(reader, "--record")[0]), "utf8")).toContain(
      "## Settled-wait record — ✅ no crossing line the settlements do not produce",
    );
    expect(published["reported"]).toBe("false");
    expect(existsSync(join(dir, flagValues(reader, "--comment")[0]))).toBe(false);

    // A person repairs the file by hand — the case this check exists for — by moving the line the writer
    // itself wrote to a middle no night of the series has, built with the module's own builder so the
    // fixture cannot drift from the shape the runbook is read in either.
    const edited = waitCrossing({
      ...recorded,
      kind: recorded.kind === "collect" ? "collect" : "floor",
      latest: recorded.latest + 5,
    });
    if (edited === null) throw new Error("the fixture no longer makes a crossing");
    const filedRunbook = readFileSync(join(dir, runbook), "utf8");
    writeFileSync(join(dir, runbook), filedRunbook.replace(recorded.line, edited.line));

    // …and the next night runs both steps again over that runbook: the writer judges its own record and
    // says which line is refuted, and the reader takes the count, the line and the request from it.
    const refuting = runStep(writer, "night-two-output", "night-two-summary.md");

    expect(refuting.status, refuting.stderr).toBe(0);
    read("night-two-output");
    expect(published["wait-drift"]).toBe("1");
    // The line travels in the identity every surface of the night names it by — the request the crossing
    // was said on, and the night it was recorded — and it is the line this *same* writer wrote.
    const line = published["wait-drift-set"];
    expect(line).toBe(`#${recorded.number} on ${recorded.date}`);
    // …and as the block, in the very file the reader's step was told to open, which is what the next
    // night's record and comment then quote.
    const blockText = readFileSync(join(dir, blocks[0]), "utf8");
    expect(blockText).toContain(`**${line}**`);
    // The names the reader's step asks the writer for are the ones it publishes: a renamed output would
    // substitute as the empty value and read here as a night the settle step never judged.
    expect([...referenced].sort()).toEqual(["open-request", "wait-drift", "wait-drift-set"]);

    const red = runStep(withValues(reader), "verdict-two-output", "verdict-two-summary.md");

    expect(red.status, red.stderr).toBe(1);
    read("verdict-two-output");
    // The verdict the reader took and the count the writer published are one answer, which is the whole
    // of what this case is about: the gate fails the night over exactly the record the settle step says
    // is refuted — and it fails it *only* there, so a green night above is a green verdict too.
    expect(published["reported"]).toBe("true");
    // …saying it on the request the writer published as the one still open, which is the only channel
    // this job has for a finding about a file a person edits by hand, and with nothing to retract.
    expect(published["comment-request"]).toBe("605");
    expect(published["retract"]).toBe("");
    // …and it quotes the writer's own block, byte for byte, under the label it paired that file with: the
    // reader re-renders nothing, so a line the writer reworded is a line the record and the comment carry.
    const record = readFileSync(join(dir, flagValues(reader, "--record")[0]), "utf8");
    const comment = readFileSync(join(dir, flagValues(reader, "--comment")[0]), "utf8");
    for (const text of [record, comment]) {
      expect(text).toContain(blockText.trim());
      expect(text).toContain(`**${line}**`);
    }
    expect(record).toContain(`### ${label}`);
    expect(record).toContain(`- **${label}** — 1 crossing line the record holds`);
    // …and the record the night keeps for tomorrow is keyed on that same identity, because the dedupe
    // compares *lines*: a writer that spelled one and a reader that recorded another would say the
    // finding again on every night it stands.
    expect(readFileSync(join(dir, runbook), "utf8")).toContain(`${label}=${line}`);
    // The night's own annotation names the same line in the same identity, so the checks list the writer
    // writes and the verdict the reader takes cannot describe one line two ways.
    expect(refuting.stdout).toContain(`${line} — `);
  });
});
