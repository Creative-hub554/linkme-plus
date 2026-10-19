#!/usr/bin/env node
/**
 * Fails a job when the settlement section states a crossing line the records do not produce, and writes
 * the record of that verdict into the night's artifact.
 *
 *   node .freebuff/wait-drift-gate.mjs \
 *     --drift .ci/wait-drift-lines.md \
 *     --set "Settled-wait drift=${{ steps.settle-floor.outputs.wait-drift-set }}" \
 *     --runbook .freebuff/run.md \
 *     --request "${{ steps.settle-floor.outputs.open-request }}" \
 *     --comment .ci/wait-drift-repair.md \
 *     --retract .ci/wait-drift-retract.md \
 *     --end .ci/wait-drift-end.md \
 *     --record .ci/wait-drift.md \
 *     --summary .ci/summary.md \
 *     "Settled-wait drift=${{ steps.settle-floor.outputs.wait-drift }}"
 *
 * The settle step is `continue-on-error: true`, and that is deliberate: it is the night's recording
 * aid, and a settlement it could not write must not take the run page, the risen-wait comment and the
 * artifact down with it. But the same step also *judges* the record it renders — the section's drift
 * block is a finding about the crossings the runbook holds, and a level nothing has held is not
 * something a night may leave standing quietly. So the judgement travels as the count the module that
 * made it published on `$GITHUB_OUTPUT` (`wait-drift`), and this reads that back: the step that turns
 * a finding inside a tolerated step into the job's verdict, exactly as `comment-gate.mjs` does for a
 * comment that never arrived.
 *
 * Three values, and the difference between them is why this reads a count rather than a flag:
 *
 *   - empty — the settle step was skipped, or read no record at all. Nothing was judged, so nothing
 *     fails here and nothing is written: the record's own check is the trend step's, which reads the
 *     runbook whatever the settle step did.
 *   - `0` — the record was read and every crossing line it holds is one these settlements produce.
 *     The ordinary night.
 *   - a positive whole number — that many lines the settlements cannot produce. The night fails, and
 *     the section the settle step rendered is where each of them is named, with the repair.
 *
 * Anything else — a negative number, a fraction, a word — is refused with exit 2 rather than read as
 * a pass, for `comment-gate.mjs`'s reason: a value this does not recognize would otherwise make a
 * gate that can never fail, which is the one failure mode a gate must not have.
 *
 * ## The record it leaves behind
 *
 * A verdict taken at the end of a run is read by whoever opens that run, and a run page is read once
 * and rolls away. A refuted crossing line is a *finding about the runbook* — a line a person edits, in
 * a file other nights read back — so it is exactly the kind of thing somebody has to be able to re-read
 * months later, when the only thing left is the artifact the night uploaded. So the verdict is written
 * as a record of its own:
 *
 *   - `--record <path>` writes it to a file, which is what the night's artifact carries.
 *   - `--summary <path>` appends the same text to the report's own review summary, so a reader of
 *     `.ci/summary.md` — the file that *is* the review of a night — meets the finding without having
 *     to know which of the artifact's files to open.
 *   - `--drift "<label>=<path>"` is a block a settle step published through the module's own `--drift`:
 *     the lines themselves, in the words the run page states them in, quoted into the record under the
 *     label they belong to. One per judged record, because the night watches more than one series and
 *     quoting one kind's lines under the other's name would be worse than quoting none. It is read
 *     best-effort, and a file that is missing costs that record its quote and never the verdict.
 *   - `--comment <path>` is the same verdict said where a *person* is. The record above is a file in an
 *     artifact and the annotation is a line on the checks list, and neither reaches an inbox; the
 *     repair this finding asks for is an edit to `.freebuff/run.md` by hand, so the night leaves the
 *     finding as a comment on the one request it still has open (`.freebuff/pr-comment.mjs` posts it,
 *     gated on `reported` below so a comment that never arrived still fails the night). It names each
 *     refuted record and quotes that record's block, because a comment is read on its own and the first
 *     leg the arithmetic fails is the whole of what a reader needs. Nothing is written when nothing is
 *     refuted — the poster's step is then `skipped` rather than posting an empty body, which is the
 *     difference `.freebuff/comment-gate.mjs` reads.
 *   - `--set "<label>=<line>; <line>"` is the lines each record is refuted *by*, as the settle step that
 *     judged it named them (`wait-drift-set`), and `--runbook <path>` is the record of what earlier
 *     nights have already said. Together they are the dedupe below, and they are the one pair a caller
 *     that leaves a comment has to hand over.
 *
 * ## The comment is said once
 *
 * A refuted record fails the night on the first night it stands and on every night after, which is right:
 * the repair is a person's edit to the runbook, and a red run is how the night says the finding is still
 * there. A *comment* is a different thing. It is the only channel here that reaches somebody who is not
 * looking at this run, and a nightly restatement of it is a week of the same comment on the request the
 * night has open — for a record broken for a week, seven notifications saying one thing, which is how a
 * channel stops being read. So the comment is an *event*: it is left once per refuted line, and the night
 * says it again only when a line it has not reported joins the record.
 *
 * That is the shape the risen wait's comment already has, and it is deduped the same way — on what has
 * already been said, out of the runbook — so the two channels cannot come to disagree about what a
 * person has been told. The identity of a refuted line is the one the section and the artifact name it
 * by (`#502 on 2026-10-09`, `the collect-budget wait on 2026-10-09`), published beside the count by the
 * step that judged it; the record of what has been said is a line this module appends to the runbook
 * (`.freebuff/run.md`) after it has written the body the poster reads, which is `coverage-trend`'s own
 * rule for a crossing: the record states what the night did rather than what it meant to. The night's
 * commit carries it back, which is why this step sits above that commit rather than at the end of the
 * job — a report line that died with the runner would make the next night say it all again.
 *
 * A comment is rendered when the night has a line to report *or* a line the standing comment names has
 * left the record, and the body names the whole current finding rather than only the new lines: a reader
 * meeting the comment fresh needs the record as it stands, and a reader who met the previous one is told in
 * so many words which lines moved — the ones that joined the finding (`joinedNote`) and the ones that are
 * gone (`repairedNote`). Neither half is legible from the body alone: a line more reads as one the last
 * version happened not to list and a line fewer as one somebody struck, so both directions are stated where
 * the finding is, and only where a comment already stood for a line to join or leave. It is **one comment per
 * request, kept current** — the body carries `RECORD_COMMENT_MARKER` and the step that posts it finds that
 * marker rather than creating a
 * second, so the pull request never accumulates copies of a finding it has already been told. What that
 * costs is stated plainly: a line joining a standing refutation rewrites the comment and notifies nobody,
 * where a fresh post would have. It is bought back by the retraction below, which can only be a single
 * defined action if there is a single comment to retract.
 *
 * ## The retraction
 *
 * A refuted record is repaired by an edit to the runbook — the line is re-derived from the settlements or
 * deleted so the next rise says the crossing again — and on the night that edit lands, the comment the
 * night left is the only thing on the pull request still saying the record is broken. A comment that
 * outlives its finding is worse than no comment: it reads as a standing red, and the next person to open
 * the request has no way to tell it from a live one. So the same night that judges the record repairs the
 * comment: `--retract <path>` renders a short note — the lines this comment named, when they left, and
 * that the night stops failing for them — and the step below rewrites the marked comment with it. The
 * marker is kept in the retraction body, so a *later* refutation of the same lines finds the same comment
 * and rewrites it again rather than posting a second one.
 *
 * A repair that takes out *some* of the lines the comment names is the same fact with a finding still
 * attached to it, and it is said in the body rather than in a note of its own — there is one comment and one
 * body per night, and the night still has something to report. So the report says which lines it has stopped
 * naming (`repairedNote`), and the runbook records them beside the report line, so the file a reviewer greps
 * says a partial repair landed as plainly as the night that ended a whole finding does. Without that
 * sentence the comment is merely one line shorter, which is indistinguishable from an edit — and the person
 * this whole channel exists for is the one who acted on the last version.
 *
 * A line *joining* a standing refutation is the same asymmetry the other way round, and it is said in the
 * body beside it (`joinedNote`) for the same reason: the finding did not start tonight, it grew, and a
 * reader of the previous body — the person who acted on that one — has no way to tell the line that is new
 * from the lines that were already there. The dedupe above is what makes the sentence say something: the
 * body is written on this night *because* a line it has not reported joined the record, so the arrival is
 * never the whole of what changed by accident. Neither sentence is owed on the first night of a finding,
 * where no comment stood for anything to join or leave and the bullets and the quoted blocks state it in
 * full.
 *
 * ## The comment whose request has ended
 *
 * The comment this step keeps current is written to a pull request, and that request is answered by somebody
 * else — merged, or closed unanswered — which is a fact about the *thread* rather than about the finding. The
 * fact is not asked of GitHub: the settle step reads that answer and the runbook states it as the request's own
 * settlement line, which this step already reads for everything else — so the ending is *read*
 * (`settledRequest`, through the reader of the module that writes those lines, `coverage-trend.mjs`) and the
 * night needs no network call of its own to be right about it. The question is asked of *both* kinds of line,
 * and that is what makes it an answer about where the comment is rather than about how the request was raised:
 * a comment is written to a pull request and either kind of request can sit on one, so a comment left anywhere
 * — on a request whose ending only the other kind records — is read as ended either way. Which endings say so
 * is that module's own vocabulary and not this file's: a floor proposal's line is the request's own life, while
 * a collect proposal's is the ending of an ask left as a comment, where a reply leaves the pull request
 * standing and only the close ends both.
 *
 * **And the ending is said *into* that comment now, once, rather than only on the night's own surfaces.** A
 * comment on such a request is **not standing** (it is `holds` that the comparisons below are scoped to, while
 * `settled` keeps the ending itself), so nothing about the *finding* is maintained there: neither the repair
 * sentence nor the retraction is written into it — a retraction has nothing to take down on a request that
 * ended, and the finding has somewhere better to go — and a line still refuted is reported afresh on the
 * request this night has open, in a *new* comment carrying the same marker, whose own body says why it is new
 * (`movedNote`, so that a reader meets an explanation rather than a comment out of nowhere); a night with no
 * request open owes the finding and says so; and a night whose record is repaired has nothing to retract, the
 * verdict being the record's. What the night *does* write is the one thing a reader of that comment cannot
 * otherwise learn without opening the run page: that the thread is over. `--end <path>` renders
 * `endingComment` — the request, the runbook's own word and date for its ending, what the comment reported, and
 * what the night did with the finding instead — and the step below rewrites the marked comment with it,
 * `--update-only` because that comment is the one this job left there and an ending must not put a *new* comment
 * on a request nobody will read. It is written once per ending, and the runbook is what makes that true: the
 * same append-only record keeps the line (`recordEnded`, the third head below), so a later night reads that
 * comment as the ending it already carries and stays quiet — while an ending that says something *else*, a
 * request that closed, came back and closed again, is news and is written again. A red that outlives its
 * finding is the defect this comment channel exists to make impossible, and a red left on a thread nobody will
 * read is the same defect one step further out: the artifact's record, the run page and the log carry
 * `endedNote` for a reader who never opens the comment, and the comment carries the ending for a reader who
 * never opens the run page.
 *
 * The retraction is owed on the night every line the standing comment names has left the record — and
 * only when the record each of those lines belongs to was judged this night, which is the whole of why
 * the ledger carries labels: a night where one settle step did not run says nothing about the lines that
 * step's record was about, so it neither reports nor retracts them and the finding waits for a night that
 * judged it.
 *
 * The record of all of this is the runbook, in three heads of this module's own:
 *
 *   - `- **<night> — refuted crossing line reported on #<request>: <label>=<line>; ….**`, written where
 *     the body the poster reads exists. The lines it names are what the standing comment says, so a
 *     later report line *replaces* them rather than adding to them — which is what makes the file the
 *     answer to "what is on the pull request now" rather than a log of everything ever said.
 *   - `- **<night> — refuted crossing line retracted on #<request>: <label>=<line>; ….**`, written where
 *     the retraction body exists *or* where the night's report stopped naming the lines: they have left the
 *     comment, and a line that is later refuted again is not standing any more and is therefore reported
 *     afresh. A night that both reports a finding and loses one of the lines it used to name writes both
 *     lines, the report first — the walk a later night makes reads them in order, and either order arrives
 *     at the same answer, since a report replaces and a retraction takes out.
 *   - `- **<night> — refuted crossing line comment ended on #<request>: the request was <outcome> on
 *     <date>.**`, written where the ending body exists. It replaces what the comment said because it *is*
 *     what the comment says now: the walk below answers with no lines for it, and with the request it names,
 *     which is how a night whose pull request came *back* knows the comment carrying the ending is the one to
 *     rewrite with the finding again.
 *
 * `reported` and `retract` on `$GITHUB_OUTPUT` are the two things the steps below cannot work out for
 * themselves. `reported=true` only when a refutation body was written, and `retract=<request>` only when a
 * retraction body was — the request being the one the comment stands on, which is where it was written and
 * not necessarily the request this night has open. `comment-request=<request>` is where the poster puts a
 * refutation body: the standing comment's request if there is one, so an update stays on the request the
 * finding was first reported on rather than moving to whatever is open tonight. `ended-request=<request>` is
 * where the third poster puts the ending: the request the comment stands on when the runbook says its thread
 * is over, empty on every night there is no ending to write — which is every night the comment is the
 * finding's and the `comment-request` above is the one that matters.
 *
 * The record is written on the ordinary night too, and that is the point of writing it rather than
 * only a failure note: a night in which the check held and a night in which it never ran are the two
 * things a later reader has to be able to tell apart, and an absent file says neither. Nothing judged
 * writes nothing at all — the same omission the settlement section makes when a night recorded no
 * settlements — so the file's *presence* means a verdict was taken, and its heading says which verdict.
 *
 * The label each entry carries is the name the run page calls the finding, so the announcement below
 * and the section that carries the lines are read under one name.
 *
 * Exit codes: 0 when no judged record is refuted (a night that retracts a repaired comment is one of
 * these, and is still green), 1 when one is, and 2 on an invocation it will not act on — no entries at
 * all, an entry that is not `<label>=<count>`, a count that is not a whole number of lines, a flag with no
 * path, a `--drift`/`--set` naming a record this does not judge, a `--today` that is not a date, a
 * `--request` that is not a request number, a comment or a retraction asked for without the lines and the
 * record they are held against, a `--runbook` it cannot read, or a
 * `--record`/`--summary`/`--comment`/`--retract`/`--end`/`--runbook` it could not write.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { proposalThreadEnding } from "./coverage-trend.mjs";

export const USAGE =
  'usage: wait-drift-gate.mjs [--drift "<label>=<path>"]... [--set "<label>=<lines>"]... ' +
  '[--runbook <path>] [--request <number>] [--today <date>] [--record <path>] [--summary <path>] ' +
  '[--comment <path>] [--retract <path>] [--end <path>] "<label>=<count>" [<label>=<count> ...]';

/**
 * The marker the night's own comment carries, and the handle every later night finds it by.
 *
 * A hidden HTML comment, the shape `.github/workflows/ci.yml`'s threshold proposal already uses, so a
 * reader sees the body and not the machine's business. It is a constant here rather than a flag because
 * two things have to agree about it and both of them are in this file's gift: the body this module
 * renders, and the `--marker` the poster and the retraction step look it up with. Those two steps carry
 * the literal, and `src/test/coverage-low-water.test.ts` holds the literal to this export, so a body and
 * a lookup that drifted apart fail the suite rather than quietly posting a second comment.
 */
export const RECORD_COMMENT_MARKER = "<!-- refuted-settled-wait-record -->";

/** The run page is told about a failed job here, in the same place the settle steps' own notes go. */
const ENV = { summary: "GITHUB_STEP_SUMMARY" };

/** The flags this reads a value from; every other token is a `<label>=<count>` entry. */
const FLAGS = [
  "--drift",
  "--set",
  "--runbook",
  "--request",
  "--today",
  "--record",
  "--summary",
  "--comment",
  "--retract",
  "--end",
];

/** An invocation this will not act on: refused out loud rather than read as a pass. */
export class UsageError extends Error {}

/** A count a step can publish: a whole number of lines, zero included. */
function isCount(value) {
  return value === "" || /^[0-9]+$/.test(value);
}

/**
 * The invocation, split into the paths it was given and the entries it judges.
 *
 * The entries are positional — `<label>=<count>`, as before — while the flags each take a path, so the
 * one thing that must not happen is a path being read as an entry: `--record .ci/wait-drift.md` would
 * otherwise be judged as a record named `--record .ci/wait-drift` holding a `.md`. A flag may be
 * written `--flag <path>` or `--flag=<path>`, and one with no path at all is refused rather than
 * quietly ignored, since a run that asked for a file and got none is a workflow edit to fix.
 *
 * **`--drift` repeats, one per judged record, and names the label it belongs to** —
 * `--drift "<label>=<path>"`, the block the settle step published for that record's kind. The pairing
 * is by label rather than by position, because the night has more than one series now and a record that
 * quoted the wrong kind's lines would be worse than one that quoted none: a `--drift` naming a label no
 * entry carries is refused, and so is a second one for the same label. The label may contain no `=`, and
 * the path may: the split is at the *first* one, since the label is a name this file is read under and
 * the path is whatever the step wrote.
 *
 * **`--set` is the same pairing for the *lines* themselves** — `--set "<label>=<line>; <line>"`: the
 * identity each refuted line is named by on the run page and in the artifact (`waitDriftWhere` — a
 * request and a night, or the series and a night), as the step that judged it published them. They are
 * what the comment is deduped against, so they travel beside the count rather than being read back out
 * of the block: the block is prose, and this module does not read another module's sentences. The list
 * may be *empty* — a record that was judged and holds nothing refuted says so with the same flag — and a
 * second `--set` for one label is refused, for `--drift`'s reason. The split is at the first `=` and the
 * lines are split on `;`.
 *
 * @param {string[]} argv
 * @returns {{ values: Record<string, string>, drifts: { label: string, path: string }[],
 *   sets: { label: string, lines: string[] }[], entries: string[] }}
 */
export function options(argv) {
  const values = {
    record: "",
    summary: "",
    comment: "",
    retract: "",
    end: "",
    runbook: "",
    request: "",
    today: "",
  };
  const drifts = [];
  const sets = [];
  const entries = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const flag = FLAGS.find((name) => token === name || token.startsWith(`${name}=`));
    if (flag === undefined) {
      entries.push(token);
      continue;
    }
    const inline = token !== flag;
    const value = inline ? token.slice(flag.length + 1) : argv[index + 1];
    // …except `--request`, whose empty value is the night with no request open — see its own branch.
    if ((value === undefined || value === "") && flag !== "--request") {
      throw new UsageError(`'${token}' needs a path`);
    }
    if (!inline) index += 1;
    if (flag === "--drift") {
      const equals = value.indexOf("=");
      const label = equals === -1 ? "" : value.slice(0, equals);
      const path = equals === -1 ? "" : value.slice(equals + 1);
      if (label === "" || path === "") {
        throw new UsageError(
          `'${value}' does not name the record its lines are for — write '--drift "<label>=<path>"'`,
        );
      }
      if (drifts.some((drift) => drift.label === label)) {
        throw new UsageError(`'${label}' was given two --drift files — a record has one block of lines`);
      }
      drifts.push({ label, path });
      continue;
    }
    // The request is the one flag whose value may be *empty*: a night with no request open is a real
    // night, and `--request ""` is how the workflow spells it — the finding is then owed rather than
    // said, which is the settle mode's own rule for a crossing with nowhere to go. A value that is not a
    // request number is refused here rather than reaching a URL later.
    if (flag === "--request") {
      if (value !== "" && !/^[0-9]+$/.test(value)) {
        throw new UsageError(`'--request ${value}' is not a request number`);
      }
      values.request = value;
      continue;
    }
    if (flag === "--set") {
      const equals = value.indexOf("=");
      const label = equals === -1 ? "" : value.slice(0, equals);
      const named = equals === -1 ? "" : value.slice(equals + 1);
      if (label === "") {
        throw new UsageError(
          `'${value}' does not name the record its lines are for — write '--set "<label>=<lines>"'`,
        );
      }
      if (sets.some((set) => set.label === label)) {
        throw new UsageError(`'${label}' was given two --set lists — a record's lines are named once`);
      }
      sets.push({
        label,
        lines: named
          .split(";")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
      });
      continue;
    }
    values[flag.slice(2)] = value;
  }
  return { values, drifts, sets, entries };
}

/**
 * The entries, as `{ label, count }`, or a `UsageError` naming the first thing wrong.
 *
 * The label is everything before the **last** `=`, as `comment-gate.mjs` reads its own entries: a
 * label may carry any punctuation, and the count is always the last word.
 *
 * @param {string[]} argv
 * @returns {{ label: string, count: string }[]}
 */
export function parseEntries(argv) {
  if (argv.length === 0) {
    throw new UsageError("at least one <label>=<count> is required");
  }
  return argv.map((token) => {
    const equals = token.lastIndexOf("=");
    const label = equals === -1 ? "" : token.slice(0, equals);
    const count = equals === -1 ? "" : token.slice(equals + 1);
    if (label === "") {
      throw new UsageError(`'${token}' needs a label — write '<label>=<count>'`);
    }
    if (!isCount(count)) {
      throw new UsageError(
        `'${token}' does not name a count of lines — expected a whole number, or nothing at all ` +
          "where the step that would have judged the record never ran",
      );
    }
    return { label, count };
  });
}

/**
 * The entries that mean the record states a line the settlements do not produce.
 *
 * An empty count is not one of them, and that is the whole of the judgment this gate makes: whether
 * the step ran is a fact about the run — it is `skipped`, or the workflow edited — while whether a
 * line is producible is the count the module published.
 *
 * @param {{ label: string, count: string }[]} entries
 */
export function refuted(entries) {
  return entries.filter((entry) => entry.count !== "" && Number(entry.count) > 0);
}

/**
 * The three heads this module's own lines are read by, and which nothing else in the project reads.
 *
 * They are deliberately heads of their own: `coverage-trend` reads the runbook's crossings and
 * settlements by *theirs* and cannot see these lines at all, so appending one changes no arithmetic
 * anywhere — the runbook's drift check reads a bar built from crossings, and none of a report, a
 * retraction or an ending is a crossing, a settlement or a reading. Each names the request the comment
 * stands on, because that is where a later night has to go to find it again — and the third names the
 * ending itself, because that is what tells a night invited back to a comment that it has one to correct.
 */
const REPORT_HEAD = /^- \*\*\d{4}-\d{2}-\d{2} — refuted crossing line reported on #([0-9]+): (.+)\.\*\*$/;
const RETRACT_HEAD = /^- \*\*\d{4}-\d{2}-\d{2} — refuted crossing line retracted on #([0-9]+): (.+)\.\*\*$/;
const ENDED_HEAD =
  /^- \*\*\d{4}-\d{2}-\d{2} — refuted crossing line comment ended on #([0-9]+): the request was (.+) on (\d{4}-\d{2}-\d{2})\.\*\*$/;

/**
 * The lines a report line names, as `<label>=<line>` entries — the spelling the `--set` flag uses, so one
 * rule reads both and a label may contain anything but the `=` it is split at.
 */
function commentEntries(text) {
  return text
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const equals = entry.indexOf("=");
      return { label: equals === -1 ? "" : entry.slice(0, equals), line: entry.slice(equals + 1) };
    })
    .filter((entry) => entry.label !== "" && entry.line !== "");
}

/** Whether one entry of a list is one line of one record. */
function sameLine(one, other) {
  return one.label === other.label && one.line === other.line;
}

/**
 * Whether an ending a comment already carries is the ending the runbook states now.
 *
 * The two are the same ending only when both halves are: a request the record calls closed and now calls
 * merged is a different outcome, and one that closed, came back and closed again is a different day — either
 * is news, and the night writes the ending again rather than leaving the older word on the comment. `undefined`
 * is never the same ending: a comment that carries none is one this has not been written into yet.
 *
 * @param {undefined|{ outcome: string, date: string }} carried the ending the comment carries, if any
 * @param {{ outcome: string, date: string }} settled the ending the runbook states now
 */
function sameEnding(carried, settled) {
  return carried !== undefined && carried.outcome === settled.outcome && carried.date === settled.date;
}

/**
 * What the night's comment currently says, read out of the runbook: `{ request, entries }`, or `null`
 * when no comment stands.
 *
 * Read from the *record* rather than from the requests themselves: the question is not what some comment
 * on GitHub says but what this job last told somebody, and the runbook is where that is kept — the same
 * file the settlements and the crossings live in, for the same reason. A lookup of the night's own
 * comments would make the night's decision depend on a network call that can fail and on a comment
 * somebody may have edited in the meantime; and the retraction does its own lookup anyway, where the
 * marker has to be found for real before anything can be rewritten.
 *
 * The walk is a small state machine, and the states are the whole point:
 *
 *   - a **report** line *replaces* what stands, because the body it recorded names the record as it
 *     stood that night rather than only what was new — so the last one is the answer.
 *   - a **retraction** line takes the lines it names out of what stands, and clears the comment when
 *     nothing is left; a retraction naming another request is ignored rather than applied, so a line
 *     somebody pasted from elsewhere cannot clear a comment it was not about. A retraction for a comment
 *     that carries an *ending* is ignored for the same reason: an ending names no lines, so there is
 *     nothing for one to take out, and reading it as a clear would lose the state instead.
 *   - an **ended** line replaces what stands as the report does, because it is what the comment says now:
 *     it answers with the request and with **no lines** — the request because the night a pull request comes
 *     *back* has to rewrite the comment that carries the ending, and no lines because a comment whose body
 *     is the ending names no finding for the sentences below to compare against. So the next refutation of
 *     the same lines is a rewrite of *that* comment rather than a difference nothing has joined, and the
 *     ending is not written a second time while it still says the same thing. The ending it carries is kept
 *     (`ended`) so that a request which closed, came back and closed again — a different day, or a different
 *     word — is news rather than a repeat.
 *   - a line that parses as neither is skipped: the runbook is a file people edit, and a bullet somebody
 *     reworded is a claim this cannot read.
 *
 * @param {string} text the runbook's text
 * @returns {null | { request: string, entries: { label: string, line: string }[],
 *   ended?: { outcome: string, date: string } }}
 */
export function standingComment(text) {
  let standing = null;
  for (const line of String(text ?? "").split("\n")) {
    const reported = REPORT_HEAD.exec(line);
    if (reported !== null) {
      standing = { request: reported[1], entries: commentEntries(reported[2]) };
      continue;
    }
    const ended = ENDED_HEAD.exec(line);
    if (ended !== null) {
      standing = { request: ended[1], entries: [], ended: { outcome: ended[2], date: ended[3] } };
      continue;
    }
    const retracted = RETRACT_HEAD.exec(line);
    if (
      retracted === null ||
      standing === null ||
      standing.ended !== undefined ||
      retracted[1] !== standing.request
    ) {
      continue;
    }
    const gone = commentEntries(retracted[2]);
    standing.entries = standing.entries.filter(
      (entry) => !gone.some((retired) => sameLine(entry, retired)),
    );
    if (standing.entries.length === 0) standing = null;
  }
  return standing;
}

/**
 * The settlement the runbook records for the request a comment stands on — `null` while the thread that
 * comment is on still stands, and `{ date, number, outcome, nights }` once it has ended.
 *
 * A refuted-record comment is left on a request somebody else answers, and the runbook states what became of
 * every such request this job's neighbourhood leaves on a pull request: the floor proposals this job raises
 * itself, and the collect-budget proposals its sibling job leaves as comments on somebody else's, each kind's
 * line saying its own thing about the pull request under it (`coverage-trend.mjs`'s `SETTLEMENT_KINDS[*].ends`
 * is where that is decided). *Both* kinds are read — one reader of that module's own, `proposalThreadEnding` —
 * because the question is about the thread a comment sits on rather than about the kind of request that earned
 * it: the request this step is handed today is the floor settle step's `open-request`, and a comment left
 * anywhere is a comment a later night has to answer for, so the ending is asked of every settlement line the
 * file holds rather than of the kind this night happens to know about.
 *
 * It is read through `coverage-trend.mjs` rather than by a pattern here, and that is the whole point of the
 * function existing: a request's ending is that module's record — it writes the line and reads it back for the
 * settlement pages, the medians and the wait it judges — so a second head in this file would be a second answer
 * to "is this request over", free to disagree with the one the night's own history is built from, and a second
 * vocabulary of endings would be a second answer to *which* endings close a pull request.
 *
 * What it answers is the one fact about the comment this file cannot read out of the comment: whether the
 * thread it sits on still exists. A request that was merged or dropped is a place nobody will look again, and
 * so is a pull request that went away with an unanswered ask on it, so the comment is not one to rewrite and
 * not one to retract either — and the ending is not this step's to fix, which is why it has to be read from
 * the request's own record rather than from anything the comment says about itself.
 *
 * @param {string} text the runbook's text
 * @param {string} request the request number the comment stands on
 */
export function settledRequest(text, request) {
  if (request === "") return null;
  return proposalThreadEnding(text, request);
}

/**
 * The runbook with one of these lines appended — the report that makes the standing comment what it is,
 * or the retraction that takes the lines out of it.
 *
 * The shape is `coverage-trend`'s own for a crossing — a blank line between it and what came before,
 * then the bullet — so the file reads as one record kept by two steps rather than two records sharing a
 * file. `added` is the line written, kept in the shape of `recordWaitCrossing`'s return so the two
 * readers of a runbook line are called alike.
 */
function appendRunbook(text, line) {
  let next = String(text ?? "");
  if (next !== "" && !next.endsWith("\n")) next += "\n";
  if (next !== "" && !next.endsWith("\n\n")) next += "\n";
  return `${next}${line}\n`;
}

/** The lines as a report or retraction line spells them, in the order they were handed over. */
function spell(entries) {
  return entries.map((entry) => `${entry.label}=${entry.line}`).join("; ");
}

/** `text` with the night's report appended. */
export function recordReport(text, { entries, request, night }) {
  const line = `- **${night} — refuted crossing line reported on #${request}: ${spell(entries)}.**`;
  return { text: appendRunbook(text, line), added: entries };
}

/** `text` with the night's retraction appended. */
export function recordRetraction(text, { entries, request, night }) {
  const line = `- **${night} — refuted crossing line retracted on #${request}: ${spell(entries)}.**`;
  return { text: appendRunbook(text, line), added: entries };
}

/**
 * `text` with the ending the night wrote into the comment appended.
 *
 * The third head, and the one the *comment* rather than a finding is the subject of: it records that the mark
 * this job keeps on #604 now says the thread is over — which is why the walk above answers with no lines for
 * it, and why a night that finds the same request still over writes nothing more. The ending it names is kept
 * in the line (`outcome` and `date`, the runbook's own word for the request's ending, read through
 * `settledRequest`), so a request that closed, came back and closed again is a new ending rather than a repeat
 * of one already said. The `night` is the night the ending was *written*, which is not the ending's own day:
 * that day belongs to the request's record and travels in the sentence.
 */
export function recordEnded(text, { request, night, outcome, date }) {
  const line =
    `- **${night} — refuted crossing line comment ended on #${request}: the request was ${outcome} on ` +
    `${date}.**`;
  return { text: appendRunbook(text, line), added: { outcome, date } };
}

/** The lines, as the run page and the log state them. */
function lines(entry) {
  return Number(entry.count) === 1 ? "1 crossing line" : `${entry.count} crossing lines`;
}

/**
 * What one refuted record's bullet says.
 *
 * The settle step wrote the *diagnosis* — the block naming each line, in the module's own sentences —
 * and what it could not write is the consequence, because it is not the step that takes the night's
 * verdict. So the bullet says the consequence and points back at that block rather than repeating the
 * lines, which is also why the label has to be the name that finding is read under: the artifact's
 * record quotes the block under the same name.
 */
function refutedNote(entry) {
  return (
    `- **${entry.label}** — ${lines(entry)} the record holds that these settlements cannot ` +
    "produce; the section the settle step rendered names each of them and the repair."
  );
}

/** …and what one record that held says, which is a verdict too rather than an empty list. */
function heldNote(entry) {
  return (
    `- **${entry.label}** — 0 crossing lines: every line the record holds is one these settlements ` +
    "produce."
  );
}

/**
 * Why this verdict is a step of its own rather than the settle step's own exit — the sentence the run
 * page and the artifact's record share, so the two cannot come to say it differently.
 */
const CONSEQUENCE =
  "The settle step is `continue-on-error` so that a record it could not write cannot stop the run " +
  "page, the comment and the artifact; this is the step that turns that finding into a red job.";

/** …and the same fact about a night the record held, where nothing is failing. */
const HELD_CONSEQUENCE =
  "The settle step is `continue-on-error` so that a record it could not write cannot stop the run " +
  "page, the comment and the artifact; this is the verdict taken on the record it left, and " +
  "nothing about it failed — the night is not stopped for this.";

/** The heading, as the run page and the artifact's record both carry it. */
const HEADING = "## Settled-wait record — ❌ a crossing line the settlements do not produce";

/**
 * What the run page says when the job fails for one of these.
 *
 * @param {{ label: string, count: string }[]} refutedEntries
 */
export function gateAnnouncement(refutedEntries) {
  return ["", HEADING, "", ...refutedEntries.map(refutedNote), "", CONSEQUENCE, ""].join("\n");
}

/**
 * One record's block, under the label the verdict is read by: the lines themselves, or the sentence that
 * says why they are not here.
 *
 * Shared by the two renderings — the artifact's record and the night's comment — so the two cannot come to
 * word one line differently, and so the two ways of having no block to quote (no `--drift` was named for
 * this record, or the file it named held nothing) are stated the same way in both. The block is the
 * module's own text, quoted verbatim: its entries name each line and the first leg the arithmetic fails,
 * and its close states the repair.
 *
 * @param {{ label: string, count: string }} entry
 * @param {{ label: string, lines: string, path: string }|undefined} quote
 */
function quoteSection(entry, quote) {
  return [
    "",
    `### ${entry.label}`,
    "",
    quote !== undefined && quote.lines !== ""
      ? quote.lines.trim()
      : "The lines are not quoted here: " +
        (quote === undefined
          ? "no `--drift` file was named for this record, so the section the settle step rendered is " +
            "where each of them is named, with the repair."
          : `${quote.path} held nothing to quote, so the section the settle step rendered is where ` +
            "each of them is named, with the repair."),
  ];
}

/** The heading the night's comment carries: the same verdict, stated where a person is. */
const COMMENT_HEADING =
  "## The settled-wait record is refuted — a crossing line the settlements cannot produce";

/**
 * The night's comment on the request it still has open, or `null` when nothing is refuted.
 *
 * The record this same verdict keeps is a file in an artifact and the annotation is a line in a checks
 * list, and neither
 * reaches an inbox — while the repair this finding asks for is an edit to `.freebuff/run.md` made by hand,
 * which is exactly the thing a person has to be told about rather than a page that has to be opened. So the
 * same verdict is rendered a second time, as the body of a comment on the one request this job still has
 * open, and it is deliberately not a copy of the record: the record argues for itself as a *kept* verdict
 * (why the file exists, what it means that it is written on a green night too), while a comment has to be
 * readable by somebody who has not read this module, and to say in its own first paragraph what happened,
 * which record is refuted and what the repair is.
 *
 * The lines travel with it for the reason they travel into the record: a comment is read on its own, and the
 * block it quotes names each line and the first leg the arithmetic fails. The blocks come from the same
 * `--drift` files the record quotes, through the same `quoteSection` — so the two surfaces word one line
 * once, and a block that was not published is stated as such in both rather than quoted empty in one of
 * them.
 *
 * `null` — not an empty body — when nothing is refuted: the poster's step is gated on this step's own
 * outcome, and a night that owed no comment must be `skipped` rather than posting a body that says nothing.
 *
 * @param {{ label: string, count: string }[]} refutedEntries
 * @param {{ quotes?: { label: string, lines: string, path: string }[], gone?: { label: string,
 *   line: string }[], joined?: { label: string, line: string }[], settled?: { number: string,
 *   outcome: string, date: string }|null }} [published]  `settled` is the ending of the request the last
 *   comment stands on, when there was one — the one case in which this body is not a rewrite of that
 *   comment but a comment of its own, so it says so (`movedNote`). It is never owed together with `gone` or
 *   `joined`: a comment on a request that ended is one nothing has joined or left, which is why the night is
 *   speaking to somebody new rather than to the reader of the last body.
 */
export function repairComment(
  refutedEntries,
  { quotes = [], gone = [], joined = [], settled = null } = {},
) {
  const failing = refuted(
    (Array.isArray(refutedEntries) ? refutedEntries : []).filter(
      (entry) => entry !== null && typeof entry === "object",
    ),
  );
  if (failing.length === 0) return null;
  const quoteFor = (entry) => quotes.find((quote) => quote.label === entry.label);
  return [
    RECORD_COMMENT_MARKER,
    "",
    COMMENT_HEADING,
    "",
    "`.freebuff/wait-drift-gate.mjs` read the count each settle step published for its own record, and this " +
      "night is refuted: that many crossing lines the settlements its section states cannot produce. Those " +
      "lines are the *bar* this job's own reading is written in — a comment is left, or a page says a wait " +
      "stands, while the middle of the ages is above every level on record — so a line these settlements " +
      "cannot produce is a level nothing has held, and it fails in both directions: too high and a crossing " +
      "that is really new is never said, too low and one already said is said again.",
    "",
    ...(joined.length === 0 ? [] : [joinedNote(joined), ""]),
    ...(settled === null ? [] : [movedNote(settled), ""]),
    ...(gone.length === 0 ? [] : [repairedNote(gone), ""]),
    ...failing.map((entry) => `- **${entry.label}** — ${lines(entry)} the settlements cannot produce.`),
    ...failing.flatMap((entry) => quoteSection(entry, quoteFor(entry))),
    "",
    // The repair itself is not restated here, for the reason neither rendering writes the other's words:
    // the block above ends with it in the module's own sentences, and a record whose block was not
    // published is pointed at the section that names each line with the repair. So the close says only what
    // this surface adds — that the night stays red until it is done, and where the kept verdict is.
    "The night keeps failing until the record is repaired — each block above names the line it refutes and " +
      "the repair, and the settlement section on this run's page carries the same lines beside the history " +
      "they were derived from. The same verdict is in this run's artifact (`.ci/wait-drift.md`).",
    "",
  ].join("\n");
}

/**
 * The night's sentence about the comment it did *not* touch, because the request that comment stands on has
 * ended.
 *
 * The comment is the one surface here a person meets without opening anything, and the night's whole reason
 * to touch it is to tell somebody something — so a rewrite into a request that was merged or closed is not a
 * delivery at all, it is a note handed to a closed door. That is worth *saying* rather than silently not
 * doing, because the same facts read another way say the finding was withdrawn: a comment that stops being
 * updated, with a red on it that nobody takes down, looks like something a person decided. So the sentence
 * names the request, the runbook's own word and date for its ending, and what the night did with the finding
 * instead — and it is built once, in the run, so the artifact's record and the run page cannot word it
 * differently.
 *
 * @param {{ number: string, outcome: string, date: string }} settled the request, and the runbook's own word
 *   and date for its ending, as `settledRequest` reads them
 * @param {string} instead what the night did with the finding itself
 * @param {{ written?: boolean }} [options] whether this night wrote the ending into that comment
 */
export function endedNote(settled, instead, { written = false } = {}) {
  return (
    `**The comment stands on #${settled.number}, which the runbook records as ${settled.outcome} on ` +
    `${settled.date}** — the thread ended with the request, so ` +
    (written
      ? "this night rewrites it with that ending, which is the one thing a reader there cannot learn " +
        "anywhere else, and nothing further is written into it. "
      : "this night does not rewrite it: nobody will read it there. ") +
    instead
  );
}

/**
 * The sentence a refutation body carries when lines this record refutes are ones the last body did not name.
 *
 * The inverse of the sentence below, and written for the inverse reader: the comment is rewritten whole from
 * tonight's record, so a line that has become refuted since simply appears among the ones the last version
 * listed — and unstated, that is exactly the half of this the person who acted on the previous body cannot
 * see. A line more is not a repair and it is not visibly news: without this sentence the only thing telling
 * the two apart is the number in the bullet and the block quoted under it, both of which a reader who has
 * already read the finding has no reason to look at twice. It says *which* line arrived rather than only
 * that the finding grew, because a body rewritten from tonight's record already says the rest.
 *
 * It is only owed where a comment stood: a line that arrives on a night no comment was left is a finding
 * being stated for the first time, and the bullets below state it in full.
 *
 * @param {{ label: string, line: string }[]} joined the lines this night refutes that the standing comment
 *   did not name, as the step that judged them named them
 */
function joinedNote(joined) {
  const named = joined.map((entry) => `\`${entry.line}\``).join(", ");
  const one = joined.length === 1;
  return (
    `**The record now also holds ${named}** — ${one ? "it was" : "they were"} refuted since this comment ` +
    `was left, so this comment names ${one ? "it" : "them"} too.`
  );
}

/**
 * The sentence a refutation body carries when lines it used to name have left the record.
 *
 * The comment is one comment per request and it is rewritten from tonight's record, so a line the settlements
 * produce again simply stops being named — and unstated, that is exactly the half of this a reader cannot
 * see: the body looks like the one before it with a line missing, which reads as somebody having edited the
 * finding rather than as a person's repair having landed while the rest of it stands. The ends of the two
 * directions are deliberately told differently: a night that loses *every* line has nothing left to report
 * and gets `retractionComment` instead — a body of its own, because it says the finding is over — while a
 * night that loses some of them is still a refuted record and says so, with this sentence inside it. The
 * repair is not restated here for the reason neither rendering writes the other's words: the blocks below
 * end with it in `coverage-trend`'s sentences, and what this adds is only what a reader who saw the previous
 * body needs — which lines are gone, and that what is left still fails.
 *
 * @param {{ label: string, line: string }[]} gone the lines the standing comment named that its own record
 *   no longer holds, as the step that judged it named them
 */
function repairedNote(gone) {
  const named = gone.map((entry) => `\`${entry.line}\``).join(", ");
  const one = gone.length === 1;
  return (
    `**The record no longer holds ${named}** — ${one ? "it was" : "they were"} repaired since this comment ` +
    `was left, so this comment stops naming ${one ? "it" : "them"}. What is left below is still refuted.`
  );
}

/**
 * …and the one a body carries when it is a *new* comment rather than a rewrite of the old one, which is what
 * a comment on a request that ended makes possible again.
 *
 * The finding does not get a second life out of this: it is the same record refuted by the same lines, said
 * where a person is. What a reader of the body cannot see is why a comment about a week-old finding is
 * arriving now, on a request that was not the one it was first reported on — and a body that says nothing
 * about it reads as a fresh discovery, which is the one thing it is not. So the sentence names the comment
 * that is being left behind, the runbook's own word and date for that request's ending, and the fact that
 * the finding itself has not changed.
 *
 * It is a sentence of the body's own family and, like the two above, it is never owed at the same time as
 * them: an ended comment is not standing, so nothing has joined or left it — the arrival the joined sentence
 * would state is this body itself.
 *
 * @param {{ number: string, outcome: string, date: string }} settled the request the last comment stood on,
 *   and the runbook's own word and date for its ending
 */
function movedNote(settled) {
  return (
    `**The comment that last said this stands on #${settled.number}, which the runbook records as ` +
    `${settled.outcome} on ${settled.date}** — so it is left where it is and the finding is said here ` +
    `instead. Nothing about the finding itself has changed.`
  );
}

/**
 * The comment rewritten once the request it stands on is over: the ending itself.
 *
 * The third body, and the one written for a *reader* rather than for anybody who can act. The two bodies above
 * are about the finding — one states it, the other says it is over — and both assume somebody is watching the
 * request they sit on. When that request is merged or closed, no repair this job could ask for would be read
 * there, which is why the finding is said elsewhere or owed. But the ending is the one thing a reader of that
 * comment cannot learn without opening the run page, and a red left behind on a thread nobody watches reads as
 * a standing one: a comment that stops being updated looks exactly like a comment nobody has got to. So the
 * comment is rewritten once with what the record says about its thread — the runbook's own word and date —
 * naming what it reported, where the verdict it announced is kept, and what the night did with the finding
 * instead.
 *
 * It keeps `RECORD_COMMENT_MARKER` for the reason the retraction does and one more: the marker is how a later
 * night finds this comment again, and the night that finds the pull request has *come back* has to be able to
 * write the finding into it — a thread the record once called over and GitHub reports open is a place a person
 * is, and what this body states would then be the stale claim.
 *
 * @param {{ number: string, outcome: string, date: string }} settled the request, and the runbook's own word
 *   and date for its ending, as `settledRequest` reads them
 * @param {{ label: string, line: string }[]} entries what the comment said while it was the finding's, as
 *   `standingComment` reads it — the lines it named
 * @param {string} instead what the night did with the finding itself, worded once in the run
 * @param {string} night the night this ending is written into the comment
 */
function endingComment({ settled, entries, instead, night }) {
  return [
    RECORD_COMMENT_MARKER,
    "",
    "## Settled-wait record — the thread this comment reported is over",
    "",
    `\`${night}\`: the runbook records #${settled.number} as **${settled.outcome} on ${settled.date}**, ` +
      "which is that request's own ending. Nothing written here would be read now — a reply on a request " +
      "nobody is watching reaches nobody — so the finding is not maintained here any more, and this comment " +
      "is left carrying its ending rather than a red nobody has a way to read.",
    "",
    ...(entries.length === 0
      ? []
      : [
          `What it reported was ${entries.map((entry) => `\`${entry.line}\``).join(", ")} — crossing ` +
            "lines the settlements behind the record do not produce. The verdict on them, with the derivation " +
            "and the repair, is in the artifact of the run that found it (`.ci/wait-drift.md`), which is where " +
            "a reader months later meets it.",
          "",
        ]),
    instead,
    "",
    "The same comment is rewritten rather than removed, and the mark stays in it: if this request is reopened, " +
      "the night finds it here and says the finding through it again.",
    "",
  ].join("\n");
}

/**
 * The night's comment rewritten once the lines it named are gone: the retraction.
 *
 * Written for the same reason the body above is: the comment is the one surface here a person meets
 * without opening anything, and a red that outlives its finding is read as a standing one — the next
 * person to open the request cannot tell it from a live comment, and the night meanwhile passes. So the
 * night says the ending where it said the finding.
 *
 * It is a *rewrite* rather than a deletion, and that is deliberate: the marker stays in the body, so the
 * comment is still where a later night looks and a fresh refutation of the same lines rewrites it again
 * instead of leaving this note behind beside a second comment. The finding it was about is not lost either
 * — the run that found it wrote `.ci/wait-drift.md` into that run's artifact, and this note names the run
 * the record was read on rather than pretending to know the day somebody edited the file.
 *
 * @param {{ entries: { label: string, line: string }[], request: string, night: string }} retracted the
 *   lines the comment stood for, the request it stands on, and the night that judged them gone
 */
function retractionComment({ entries, request, night }) {
  const lines = entries.map((entry) => `\`${entry.line}\``).join(", ");
  return [
    RECORD_COMMENT_MARKER,
    "",
    "## The settled-wait record is repaired — no crossing line the settlements cannot produce",
    "",
    `\`${night}\`: ${lines} ${entries.length === 1 ? "is" : "are"} no longer in the record, so the ` +
      "settlement section no longer states a crossing the settlements behind it cannot produce, and the " +
      "night stops failing for it. The repair this comment asked for was an edit to `.freebuff/run.md` — " +
      "the line re-derived from the settlements, or deleted for the next rise to say the crossing again — " +
      "so what this means is that it has landed and this is the first night that read the record since.",
    "",
    "The same comment is rewritten rather than removed, so a person who saw the red can see that it is " +
      `over. The finding it announced is in the artifact of the run that found it (\`.ci/wait-drift.md\`, ` +
      `read on #${request}). If a line these filings name is refuted again, that night says it again and ` +
      "rewrites this comment with it.",
    "",
  ].join("\n");
}

/**
 * The night's verdict on the settled-wait record, as the artifact's file and the review summary state
 * it — `null` when nothing was judged, because a run that never read a record took no verdict to keep.
 *
 * Four things, in the order a reader months later needs them: the verdict itself, one bullet per
 * record under the name the run page uses, the reason this file exists at all — the sentences that say
 * a run page rolls away while an artifact does not — and, on a refuted night, the lines themselves,
 * quoted per record from the block its settle step published (`--drift`). The bullet points at that
 * block, and a reader of this file on its own should not have to go and find it. When a record's block
 * was not published — no `--drift` named it, or the file is not there — the record says so under that
 * record's own name and points at the section instead, since a silent omission would read exactly like
 * a night with nothing to quote. A quote handed over for a record that *held* is not rendered at all:
 * the verdict is the count, and there are no lines to quote from a record nothing is wrong with.
 *
 * **One block per record, under the label the verdict is read by**, so a night with two series cannot
 * quote one kind's lines under the other's name — which is the whole reason the pairing is by label
 * rather than by position.
 *
 * `ended` is the sentence about the one thing this verdict did *not* do — rewrite the comment, because the
 * request it stands on has ended (`endedNote`) — and it belongs here rather than only on the page for the
 * reason this whole file exists: a green night's page rolls away, and what this night did with a comment
 * whose thread is over has to be readable a month later, beside the verdict that says the record is fine.
 *
 * @param {{ label: string, count: string }[]} entries every entry it was handed, judged or not
 * @param {{ quotes?: { label: string, lines: string, path: string }[], ended?: string|null }} [published]
 *   the blocks the settle steps wrote, each with the label it was published for and the path it was read
 *   from — the path only so the record can name what it looked at
 */
export function verdictRecord(entries, { quotes = [], ended = null } = {}) {
  const failing = refuted(entries);
  const judged = entries.filter((entry) => entry.count !== "");
  if (judged.length === 0) return null;
  const red = failing.length > 0;
  const quoteFor = (entry) => quotes.find((quote) => quote.label === entry.label);
  return [
    red
      ? HEADING
      : "## Settled-wait record — ✅ no crossing line the settlements do not produce",
    "",
    ...(red ? failing : judged).map(red ? refutedNote : heldNote),
    "",
    ...(ended === null ? [] : [ended, ""]),
    red ? CONSEQUENCE : HELD_CONSEQUENCE,
    "",
    red
      ? "The lines are quoted below as well, because this file is read on its own: the section each " +
        "bullet points at is a page that rolls away, and the runbook those lines live in is a file a " +
        "reader would have to go and find."
      : "This is written down rather than left to the absence of a file: a night in which the check " +
        "held and a night in which it never ran are two different things to a reader of an artifact, " +
        "and a missing file says neither.",
    ...(red ? failing.flatMap((entry) => quoteSection(entry, quoteFor(entry))) : []),
    "",
  ].join("\n");
}

/**
 * `0` when no judged record is refuted, `1` when one is.
 *
 * @param {string[]} argv
 */
function main(argv) {
  const { values, drifts, sets, entries: positional } = options(argv);
  const entries = parseEntries(positional);
  const failing = refuted(entries);
  const judged = entries.filter((entry) => entry.count !== "").length;
  // The night a report line is written under is this run's own date, and `--today` names another for a run
  // writing about a night other than the one it is running on — the same clock the settle steps' own
  // records read. It is held to the shape the reader recognizes, because a line this cannot parse is a
  // night that would say the same refutation again tomorrow.
  if (values.today !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) {
    throw new UsageError(`'--today ${values.today}' is not a date — write '--today <YYYY-MM-DD>'`);
  }
  // A block named for a label this invocation does not judge is a mis-wired step rather than a finding:
  // the pairing is by label, so this cannot come to quote one record's lines under another's name, and a
  // name nothing carries has nowhere to go. An *empty* count is not a refusal — that is the settle step
  // skipped, and its file is missing for the same reason — so the check is against the labels handed
  // over rather than against the ones judged.
  for (const drift of drifts) {
    if (!entries.some((entry) => entry.label === drift.label)) {
      throw new UsageError(
        `'--drift ${drift.label}=…' names a record this invocation does not judge — pass the count ` +
          "of that label as well",
      );
    }
  }
  // …and the same rule for the lines, which are paired with a record the same way: a `--set` for a name
  // nothing carries would be a list of lines under no verdict at all.
  for (const set of sets) {
    if (!entries.some((entry) => entry.label === set.label)) {
      throw new UsageError(
        `'--set ${set.label}=…' names a record this invocation does not judge — pass the count of ` +
          "that label as well",
      );
    }
  }
  // The finding is *stated* here, before anything is read or written, which is `coverage-trend`'s own
  // order for its `--output`: the judgement is made from the count, the files are what can fail, and a
  // file this could not read or write — or a comment asked for without the record it is deduped against —
  // must not also be the thing that hides the refutation from the log and the checks list. The exit code
  // below still answers for the write, since a run asked for a file it did not write did not do what it
  // was asked — and both facts are red, so the night stops either way.
  if (failing.length > 0) {
    for (const entry of failing) {
      // The annotation is what a reviewer sees in the checks list, where the tolerated step's own note
      // sits beside a job that is otherwise green; the line under it is for the log.
      console.error(
        `::error title=${entry.label}::the settlement record states ${lines(entry)} the records do not ` +
          "produce",
      );
      console.error(
        `wait-drift-gate: ${entry.label} — ${lines(entry)} the settlements cannot produce, named with ` +
          "the repair by the section the settle step rendered",
      );
    }
    const page = process.env[ENV.summary];
    if (page) appendFileSync(page, gateAnnouncement(failing));
  }
  // Each record's block, read best-effort for the reason the verdict is not read from it: the count is
  // the judgement, the block is the lines, and a file that is missing or unreadable costs that record
  // its quote rather than the verdict.
  const quotes = drifts.map((drift) => {
    let lines = "";
    try {
      lines = readFileSync(drift.path, "utf8");
    } catch {
      lines = "";
    }
    return { label: drift.label, path: drift.path, lines };
  });
  // Everything the three bodies are held against, read before a word of any of them is written: the lines
  // this night refutes, which the step that judged the record published beside its own count (`--set`), and
  // what this job's comment *currently says*, which is the runbook's own record of it (`--runbook`). A caller
  // that leaves, retracts or ends a comment has to hand over both — a comment that cannot tell whether the
  // finding has been said says itself again every night, which is the state the dedupe exists to end; a
  // retraction that cannot tell what the comment says either misses it or rewrites it on a night nothing was
  // repaired; and an ending cannot be rendered at all without the record whose words for the request it says
  // — while a caller taking only the verdict is not held to either, because the verdict is the count's and the
  // record and the summary are the judgment kept. So these are refusals about the three flags rather than
  // about the invocation as a whole.
  const wantsComment = values.comment !== "" || values.retract !== "" || values.end !== "";
  const judgedLabels = new Set(
    entries.filter((entry) => entry.count !== "").map((entry) => entry.label),
  );
  let runbook = "";
  let standing = null;
  const tonight = [];
  if (wantsComment) {
    const flag =
      values.comment !== "" ? "--comment" : values.retract !== "" ? "--retract" : "--end";
    if (values.runbook === "") {
      throw new UsageError(
        `${flag} needs --runbook — the runbook is the record of what this comment says now, and without ` +
          "it the night cannot tell a line it has already reported from one it has not",
      );
    }
    try {
      runbook = readFileSync(values.runbook, "utf8");
    } catch (error) {
      throw new UsageError(
        `cannot read ${values.runbook} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const entry of failing) {
      const set = sets.find((candidate) => candidate.label === entry.label);
      if (set === undefined || set.lines.length === 0) {
        throw new UsageError(
          `'${entry.label}' is refuted but no --set named the lines it is refuted by — the comment is ` +
            "said once, and the lines are what says whether it has been said",
        );
      }
    }
    for (const set of sets) {
      for (const line of set.lines) tonight.push({ label: set.label, line });
    }
    standing = standingComment(runbook);
  }
  // …and whether the request that comment stands on still exists, which the comment's own lines cannot say
  // and which the night cannot decide without: a floor proposal this job raised is merged or closed by
  // somebody else, and the settle step records that as that request's own settlement line in the very
  // runbook this reads — so the ending is *read* rather than asked for, and no `gh` call enters a decision
  // that has to hold overnight. `settled` keeps the ending itself, because the night has to *write* it
  // (`endingComment`) and *say* it (`endedNote`) rather than merely not act on it.
  const settled = standing === null ? null : settledRequest(runbook, standing.request);
  // …and the comment as a surface the *finding* is written into: not one whose request has ended (`settled`),
  // because nothing a finding rewrite could deliver would be read there, and not one that already carries the
  // ending (`standing.ended`), because what it says is that ending rather than lines. The statement itself is
  // kept either way — both cases still have a request the night may have to go back to: the first for the
  // ending it writes into it, the second for the night the pull request comes back.
  const holds = settled === null && standing !== null && standing.ended === undefined ? standing : null;
  // Two comparisons, both per *line* — the unit the finding is made of — and both scoped to the records
  // this night judged. A line the comment already names is not news; a line it names that its own record no
  // longer holds is the repair; and a line whose record was not judged tonight has an unknown status, so it
  // is neither reported nor retracted on the strength of this run.
  const unsaid = tonight.filter(
    (entry) => !(holds?.entries ?? []).some((named) => sameLine(entry, named)),
  );
  const stale = (holds?.entries ?? []).filter(
    (entry) => judgedLabels.has(entry.label) && !tonight.some((live) => sameLine(live, entry)),
  );
  // …and the arrival the same comparison finds, for the sentence the body carries: a line tonight refutes
  // that the standing comment does not name has *joined* the finding, and saying so is the only thing that
  // tells a reader of the previous body which line is new. Empty with no comment standing — and empty for a
  // comment whose request has ended, which is that same case for this sentence rather than an exception to
  // it: the body being written is not the one that person read, so nothing about *it* has grown.
  const joined = holds === null ? [] : unsaid;
  const night = values.today === "" ? new Date().toISOString().slice(0, 10) : values.today;
  // Where a finding body goes: the request the comment that stands on a live one is on — an update stays where
  // the finding was reported rather than moving to whatever is open tonight, which is also the only way a
  // retraction can find it again — and otherwise the request this night has open, which is where a finding
  // whose own comment's thread has ended is said afresh. The one case in between is a comment that currently
  // carries an *ending*: the request it is on has come back (`settled` is null again), so that comment is the
  // job's own on a live thread and the ending in it is the stale claim — the finding goes back there, which is
  // the only way the remark below can be true. Empty is a night with nowhere to say it, and the finding is
  // then owed rather than spent: the settle mode's own rule for a crossing with no request to be said on.
  const liveComment = holds?.request ?? (settled === null && standing !== null ? standing.request : "");
  const commentRequest = liveComment === "" ? values.request : liveComment;
  // …and the same verdict as the body of the night's comment, which is the one surface here that reaches a
  // person rather than a page: `null` when nothing is refuted, so a night that owed no comment leaves the
  // poster's step `skipped` instead of posting a body that says nothing — the distinction
  // `.freebuff/comment-gate.mjs` reads at the end of the job. It is `null` for two more reasons as well.
  // The first is the dedupe: a standing comment that already names every line this night refutes and names
  // nothing that is gone is the night doing its job quietly, and nothing is written — while the night still
  // stops, because the verdict is the count and the count has not moved. The second is the repair: a line
  // the comment names that its record no longer holds is written out of it, by this same body rendered from
  // tonight's record, so the comment stops naming a line the settlements produce again. The body names the
  // record as it stands rather than only what changed, since a reader meeting it fresh has to see the whole
  // finding — and the two changes a reader of the last version has to be told, in the body rather than by
  // comparing it against the one before: the lines the record no longer holds (a partial repair, which the
  // shorter body reads as an edit without it) and the lines it has come to hold (an arrival, which would
  // otherwise be indistinguishable from a line the last version merely listed).
  const comment =
    values.comment === "" ||
    failing.length === 0 ||
    commentRequest === "" ||
    (unsaid.length === 0 && stale.length === 0)
      ? null
      : repairComment(failing, { quotes, gone: stale, joined, settled });
  // …and the retraction, on the night the last of the lines the comment named has left the record: every
  // standing line judged gone, and nothing refuted to keep the comment standing for. Written as a body of
  // its own because it says the opposite of the one above, and the step below rewrites the same comment
  // with it.
  const retraction =
    values.retract === "" ||
    failing.length > 0 ||
    holds === null ||
    stale.length !== holds.entries.length
      ? null
      : retractionComment({ entries: holds.entries, request: holds.request, night });
  // …and whether *this* night is the one that writes the ending into that comment, which is the decision the
  // sentences below are about: owed for a comment whose request is over (`settled`) and which does not already
  // carry the same ending, and only where the caller asked for a body at all — `--end` is what makes the write
  // an action of this invocation rather than something a night that only reads is held to, exactly as the
  // retraction is owed only where `--retract` was asked for. A request that closed, came back and closed again
  // has a different day (or a different word), which is news and is written again. Nothing is *fixed* by not
  // asking, which is why the surfaces below say which of the two nights this is rather than leaving a reader
  // to tell a missing body from a night that decided against one.
  const writesEnding =
    values.end !== "" && standing !== null && settled !== null && !sameEnding(standing.ended, settled);
  // …and what the night did with the *finding*, since the comment whose thread is over is not where it goes
  // any more: built once, because two surfaces state it — the ending written into that comment (`--end`) and
  // the sentence the artifact's record and the run page carry (`endedNote`) — and two renderings of one fact
  // would be free to disagree. Which of the three shapes it is is the night's own decision rather than the
  // mechanism: the finding said afresh where there is a request to say it on, owed where there is none, or
  // nothing to carry because the record holds (where the ending rewrite is itself what takes the red down).
  const instead =
    comment !== null && commentRequest !== ""
      ? `The finding is reported afresh on #${commentRequest}, the request this night has open, and the ` +
        "comment there carries it from here."
      : failing.length === 0
        ? writesEnding
          ? "The red this comment carried is replaced by that ending rather than left standing on the " +
            "thread, and the record holds no crossing line the settlements do not produce tonight."
          : "The red this comment carried is not taken down either — a thread that ended is not a place to " +
            "take a red down — so the run page, the checks annotation and the artifact are what say it is over."
        : "Nothing is open tonight to say it on, so the finding is owed rather than spent: this run's " +
          "page, its annotation and its artifact state it, and a night with a request of its own will say " +
          "it there.";
  const ending = writesEnding
    ? endingComment({ settled, entries: standing.entries, instead, night })
    : null;
  const ended = settled === null ? null : endedNote(settled, instead, { written: writesEnding });
  const record = verdictRecord(entries, { quotes, ended });
  // …and the run page carries the same sentence, appended rather than rendered into the block above: that
  // block was written before anything was read, on purpose, so that a file this night could not open cannot
  // be the thing that hides the finding from the checks list and the log — while *this* fact is only known
  // once the runbook has been read and the night has decided what to do with the comment. So the finding is
  // stated early and the note about the comment joins it where the page's reader already is.
  if (ended !== null && failing.length > 0) {
    const page = process.env[ENV.summary];
    if (page) appendFileSync(page, `\n${ended}\n`);
  }
  // …and the runbook the night's commit carries back to the branch, composed here rather than in the writes
  // below because it is one file's history and it has to read in the order the night happened. The line says
  // what the comment now says rather than what the night meant to: a report *replaces* what stands (the body
  // names the record as it stands, so the last report is the answer to what the comment says), a retraction
  // takes the lines it names out of it, and an ending says the mark on that request now carries the ending —
  // which is what tells a later night that the walk's answer for it has no lines, and what tells the night the
  // pull request comes back that this comment is one to write the finding into again. A line *arriving* needs
  // no second line of its own: the report names tonight's whole set, so the line that joined is in it by
  // construction, and `stale` is filtered by the records this night judged, so a subtraction — like every
  // other line here — can never claim anything about a record this run did not read.
  let runbookText = runbook;
  // The ending is written *first* on a night that writes both it and a body for the finding, and the order is
  // load-bearing rather than cosmetic: the walk above answers with the last statement about a comment, so the
  // report has to be the file's last word once the finding has moved to another request — otherwise the ending
  // would be the standing answer again and every later night would rewrite the fresh comment it had already
  // left (an update, so nobody is notified, but a rewrite a night is not one rewrite).
  if (ending !== null) {
    runbookText = recordEnded(runbookText, {
      request: settled.number,
      night,
      outcome: settled.outcome,
      date: settled.date,
    }).text;
  }
  if (comment !== null) {
    const reported = recordReport(runbookText, { entries: tonight, request: commentRequest, night }).text;
    runbookText =
      stale.length === 0
        ? reported
        : recordRetraction(reported, { entries: stale, request: commentRequest, night }).text;
  } else if (retraction !== null) {
    runbookText = recordRetraction(runbookText, {
      entries: holds.entries,
      request: holds.request,
      night,
    }).text;
  }
  // …and the verdict is kept: the record the artifact carries, written on the red night and the green
  // one alike, with the review summary getting the same text rather than a second rendering of it — and,
  // where a caller asked for one, the comment a person will read. The three are one list rather than three
  // `try` blocks so that a write this could not make is refused the same way whichever file it was, and the
  // record is still the *first* of them: a night whose comment could not be written is a night whose
  // verdict was kept.
  const writes = [
    ...(record === null || values.record === ""
      ? []
      : [{ path: values.record, text: record, append: false }]),
    ...(record === null || values.summary === ""
      ? []
      : [{ path: values.summary, text: `\n${record}`, append: true }]),
    ...(comment === null ? [] : [{ path: values.comment, text: comment, append: false }]),
    ...(retraction === null ? [] : [{ path: values.retract, text: retraction, append: false }]),
    // …and the body the comment itself gets when the request under it is over, written where a caller asked
    // for one: this is a rewrite of a comment already on the request (`--update-only` at the step below), not
    // a place to say anything new, so a request that never carried this job's mark gets nothing.
    ...(ending === null ? [] : [{ path: values.end, text: ending, append: false }]),
    // …and the record of whichever of them this night wrote, in the runbook the night's commit carries back
    // to the branch — written *after* the body each line is about exists, which is `coverage-trend`'s own
    // order for a crossing and for its reason: the line says what the comment now says, so a body that never
    // reached the request leaves the next night free to write it again rather than recording a delivery that
    // did not happen. A delivery that never arrived is still a red run (the gate at the end of the job reads
    // the poster's outcome), and the finding is carried every night by the run page, the annotation and the
    // artifact whether or not a comment was left.
    ...(values.runbook === "" || runbookText === runbook
      ? []
      : [{ path: values.runbook, text: runbookText, append: false }]),
  ];
  for (const write of writes) {
    try {
      if (write.append) appendFileSync(write.path, write.text, "utf8");
      else writeFileSync(write.path, write.text, "utf8");
    } catch (error) {
      console.error(
        `wait-drift-gate: cannot write ${write.path} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 2;
    }
  }
  // …and the four things the steps below cannot work out for themselves: whether this night has a refutation
  // body to put up at all, where it goes (the request the comment stands on, which is not necessarily this
  // night's), whether there is a standing comment to retract, and which request's comment gets the ending.
  // Each is written after the files, so a night whose body could not be written claims nothing.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `reported=${comment === null ? "false" : "true"}\n` +
        `comment-request=${comment === null ? "" : commentRequest}\n` +
        `retract=${retraction === null ? "" : holds.request}\n` +
        `ended-request=${ending === null ? "" : settled.number}\n`,
    );
  }
  if (failing.length === 0) {
    console.log(
      `wait-drift-gate: no crossing line the settlements do not produce ` +
        `(${judged} of ${entries.length} judged; ${entries.length - judged} not judged)` +
        (record === null || values.record === ""
          ? "."
          : `; the verdict record to ${values.record}.`) +
        (retraction !== null
          ? `; the comment on #${holds.request} is rewritten to say the record is repaired, to ` +
            `${values.retract}`
          : ending !== null
            ? `; the comment on #${settled.number} is rewritten with the ending — the runbook records that ` +
              `request as ${settled.outcome} on ${settled.date}, so the thread it stands on is over and nothing ` +
              `further is written into it, to ${values.end}`
            : settled !== null
              ? standing !== null && standing.ended !== undefined
                ? `; the comment on #${settled.number} already carries the ending (the runbook records that ` +
                  `request as ${settled.outcome} on ${settled.date}) and nothing is written into it`
                : `; the comment on #${settled.number} stands on a request the runbook records as ` +
                  `${settled.outcome} on ${settled.date} and is left as it is`
              : holds === null
                ? ""
                : `; the comment on #${holds.request} stands and names nothing this night can see is gone`),
    );
    return 0;
  }
  if (comment === null && values.comment !== "") {
    if (commentRequest === "") {
      // Nowhere to say it: the standing comment is the only place this finding can be updated, and there is
      // none and no request open tonight. The finding is owed rather than spent — the rule the settle mode
      // keeps for a crossing it cannot say — so the night says so here and the next night says it there.
      console.error(
        (settled === null
          ? `wait-drift-gate: the record is refuted and no comment stands and no request is open — nothing ` +
            `written to ${values.comment}, so the finding waits for a night with somewhere to say it`
          : `wait-drift-gate: the record is refuted and the comment on #${settled.number} stands on a request ` +
            `the runbook records as ${settled.outcome} on ${settled.date} — not rewritten, and nothing ` +
            `written to ${values.comment}, so the finding waits for a night with a request to say it on`) +
          (ending === null ? "" : `; the ending is, to ${values.end}`),
      );
    } else {
      console.log(
        `wait-drift-gate: the comment on #${commentRequest} already names every line this night refutes ` +
          `(${tonight.length}) and names nothing that is gone — nothing written to ${values.comment}, so ` +
          "the finding is said once rather than every night it stands",
      );
    }
  }
  if (record !== null && values.record !== "") {
    console.error(
      `wait-drift-gate: the verdict record to ${values.record}` +
        (comment === null
          ? ""
          : ` and the night's comment to ${values.comment} (on #${commentRequest})`) +
        (settled === null
          ? ""
          : ending === null
            ? standing !== null && standing.ended !== undefined
              ? `; the comment on #${settled.number} already carries the ending (the runbook records that ` +
                `request as ${settled.outcome} on ${settled.date}) and is left as it is`
              : `; the comment on #${settled.number} stands on a request the runbook records as ` +
                `${settled.outcome} on ${settled.date} and is left as it is`
            : `; the comment on #${settled.number}, which the runbook records as ${settled.outcome} on ` +
              `${settled.date}, is rewritten with that ending to ${values.end}`),
    );
  }
  return 1;
}

// Only run the CLI when invoked as a script; a test imports the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`wait-drift-gate: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 2;
  }
}
