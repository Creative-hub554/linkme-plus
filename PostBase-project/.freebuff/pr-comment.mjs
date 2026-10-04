#!/usr/bin/env node
/**
 * Posts a generated Markdown summary as a sticky pull-request comment.
 *
 *   node .freebuff/pr-comment.mjs \
 *     --body .freebuff/collect-gates.md \
 *     --marker '<!-- collect-budget-summary -->' \
 *     --label 'Collect-budget summary comment' \
 *     --producer 'Publish collect-budget summary'
 *
 *   node .freebuff/pr-comment.mjs \
 *     --text "$body" \
 *     --marker '<!-- collect-budget-apply -->' \
 *     --label 'Collect-budget apply reply' \
 *     --producer 'Reply on the pull request'
 *
 * Every pull-request comment the workflows post goes through here: the three
 * comment steps in `.github/workflows/ci.yml` — the collect-budget summary, the
 * coverage-threshold proposal and the collect-budget proposal — which each
 * rendered a Markdown file and then handed `gh` its path, and the apply job's
 * reply in `.github/workflows/collect-apply.yml`, whose text it builds in the step.
 * It was four copies of the same shell, and the copies had already drifted: the
 * summary step checked its file before sending it and the two proposal steps did
 * not, so a `gh` failure on a path that was not there read as success under
 * `continue-on-error` and left the comment missing with nothing on the page saying
 * why. One implementation reads better than four, and this one is executable — the
 * guard is a function with tests rather than a line of YAML four tests grep for.
 *
 * The body comes from `--body` (a path a renderer wrote) or from `--text` (markdown a step
 * composed in shell), exactly one of the two. Both are read *here* and posted as `gh`'s raw
 * field `-f body=…`, not as `-F body=@path`: `-F` is the form in which `gh` opens the file
 * itself, which is precisely the read the redaction below has to happen before, and a body
 * that starts with `@` cannot be mistaken for a path either way. `--text` may be empty — an
 * empty reply *is* the case the guard below exists for, so it is announced rather than
 * refused as a bad invocation.
 *
 * Four things it refuses to assume:
 *
 *   - **That there is anything to post.** A missing, empty, or whitespace-only body
 *     — file or text — is announced on the run page (`$GITHUB_STEP_SUMMARY`) instead
 *     of being handed to `gh`, so the one outcome nobody can see — a comment that
 *     never arrived — always has a line saying it was skipped and why. That mirrors
 *     the nightly job's treatment of a report it never got, and it *exits 1* as well:
 *     a summary nobody wrote is a broken run rather than an acceptable outcome, and the
 *     note is the explanation where the exit code is what makes it count.
 *   - **That the post it does make arrives.** A `gh` that refuses is announced on the
 *     run page as well as on stderr. The step does go red, but it is a
 *     `continue-on-error` step in a job that is otherwise green, so a line in a log
 *     nobody opens was the whole of what a reviewer saw. The note names the command and
 *     `gh`'s status, and — the part a failure does not tell you by itself — what the
 *     pull request looks like now: a failed `PATCH` leaves the *previous* comment
 *     standing, which reads as the current summary until someone notices the date on
 *     it, where a failed `POST` leaves no comment at all.
 *   - **That this is a pull request.** `GITHUB_REPOSITORY` and `PR` name the target;
 *     without them the API URL would be a well-formed request to nowhere, so their
 *     absence is a usage error rather than a silently malformed post.
 *   - **That the body is fit to publish.** It goes through `.freebuff/redact.mjs` — the same
 *     vocabulary the runner's stage details, the drift alarm's diff and the nightly report
 *     are scrubbed with — so a name that looks like a secret, a URL with credentials in its
 *     userinfo, or a private key written out is collapsed to `<redacted>` before `gh` sees
 *     it. This is the artifact with the widest audience of the four, and it was the one of
 *     them that published the renderer's file *unread*: the earlier shape of this script
 *     handed `gh` the path and let it open the file, which is why a body is now read here
 *     and sent as a raw field. A body that needed scrubbing says so on the run page, with how
 *     many substitutions and without their text, and the run's artifact keeps what the
 *     renderer wrote — the comment is the published form of it, and the two are allowed to
 *     differ in exactly this direction. What was removed is filed rather than lost: the
 *     substitutions go into a record written **beside the body** (`<body>.redactions.json`,
 *     inside the artifact upload's reach), so a reviewer can compare the comment against the
 *     artifact entry by entry — while the note on the run page and the comment itself keep
 *     counting and never name. A composed `--text` reply gets no record, because there is no
 *     body file to compare it against and inventing one would put the secret in the checkout
 *     instead of in an artifact.
 *
 * A lookup that fails is not treated as a failure of the step: it costs a duplicate
 * comment before it costs the comment, which is the right trade. But it is the one
 * outcome here that is neither a green run nor a loss — the step goes green and the
 * pull request may end up with two marked comments — so the run page says it too,
 * *after* the fallback post has landed, in the past tense, because that is the only
 * reading a reviewer can act on.
 *
 * Exit codes, which answer one question — *is the comment on the pull request?* — because
 * that is what the job can act on: 0 when it is there; 1 when it is not, for either reason
 * this script knows of (nothing to post, or a `gh` that could not be started); `gh`'s own
 * status when `gh` ran and refused; and 2 for an invocation this refused to act on at all,
 * which is a broken workflow rather than an unposted comment. `continue-on-error: true`
 * keeps a failure here from stopping the drift and coverage checks that follow, so a non-zero
 * exit is not the end of the job by itself: `.freebuff/comment-gate.mjs` reads each step's
 * outcome at the end and fails the job, which is what stops a run that never posted a comment
 * from finishing green. Every one of these is announced on the run page too, so the page a
 * reviewer reads and the verdict that failed the job cannot disagree about what happened.
 *
 * A **dry run** (`--dry-run`) travels the same path — parse, read, scrub, payload — and stops
 * before the first `gh` call, printing what it would have sent and the run-page notes it would
 * have written instead of making either. It exits 0, because a rehearsal that posted nothing has
 * not lost a comment, and it leaves the run page untouched, because the point is to look without
 * changing anything. The one part of the path it cannot rehearse is the marker lookup — that *is*
 * a `gh` call — so it says the verb is undecided and names both rather than guessing `POST` and
 * being wrong half the time.
 *
 * There is a second, softer check on the same body. `redact.mjs` also finds the runs that look like
 * a generated key and are claimed by no rule — long, mixed-case, digit-bearing, with the digits
 * through the letters rather than gathered at the end — and those are **not** hidden: an uncertain
 * shape is exactly the wrong thing to collapse, so the run page is told instead of the comment
 * being changed. This is the one note here that names a value it was suspicious of, and it is
 * deliberate: the comment is already carrying the run, so a note that withheld it would hide the
 * thing it is about. It is a ⚠️ and the exit code stays 0 — a suspect is a question for a person,
 * and the status still answers only the question the job gate reads.
 *
 * The marker is a flag rather than something read out of the body: the marker is
 * what identifies the *previous* comment, and a marker derived from the text would
 * move with the text — a reordered first line would post a second comment instead
 * of updating the one already there. `src/test/collect-budget.test.ts` holds each
 * step's `--body`/`--marker` pair beside the constant of the script that writes it.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { redact, suspectTokens } from "./redact.mjs";

export const USAGE =
  "usage: pr-comment.mjs (--body <path> | --text <markdown>) --marker <marker> " +
  "--label <name> --producer <step name> [--dry-run]";

/** The flags this accepts, and the ones it cannot do without. */
const FLAGS = ["body", "marker", "label", "producer", "text", "dry-run"];
const REQUIRED = ["marker", "label", "producer"];

/** The flags that are switches rather than values: present or absent, and nothing else. */
const BOOLEAN_FLAGS = ["dry-run"];

/**
 * The seams the tests drive it through, named rather than guessed at.
 *
 * `PR_COMMENT_GH` is the executable to call instead of `gh` — a stub that records
 * its argv, so the posting path can be exercised without a token or a network. The
 * rest are the environment the workflow already supplies.
 */
const ENV = {
  gh: "PR_COMMENT_GH",
  repo: "GITHUB_REPOSITORY",
  pr: "PR",
  summary: "GITHUB_STEP_SUMMARY",
};

/**
 * The command to call, and the argv to put in front of its own.
 *
 * `gh` unless the seam names something else, and a path to JavaScript is run with
 * the running Node rather than executed directly: a stub is how the posting path is
 * tested without a token, and a Windows checkout cannot exec a `.mjs` at all.
 */
function ghCommand() {
  const gh = process.env[ENV.gh] ?? "gh";
  return /\.(mjs|cjs|js)$/i.test(gh)
    ? { command: process.execPath, prefix: [gh] }
    : { command: gh, prefix: [] };
}

/** An invocation this will not act on: refused out loud rather than guessed at. */
export class UsageError extends Error {}

/**
 * The flag values, or a `UsageError` naming the first thing wrong.
 *
 * Both `--flag value` and `--flag=value` are accepted: the workflow writes the
 * former, a person at a shell may write either. An unknown flag is refused rather
 * than ignored, because the one thing that would otherwise happen is a step that
 * looks like it posted something while one of its arguments went unread.
 */
export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new UsageError(`unexpected argument '${token}'`);
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (!FLAGS.includes(name)) throw new UsageError(`unknown flag --${name}`);
    // A switch, not a value: `--dry-run` is either there or it is not, and the `--dry-run=true`
    // form would be a setting nothing reads — refused rather than ignored, like an unknown flag.
    if (BOOLEAN_FLAGS.includes(name)) {
      if (equals !== -1) throw new UsageError(`--${name} does not take a value`);
      values.set(name, true);
      continue;
    }
    const value = equals === -1 ? argv[(index += 1)] : token.slice(equals + 1);
    // `--text` is allowed to be empty on purpose: nothing to post is what the run page
    // announces, and a step whose reply came out blank is that case, not a bad invocation.
    const empty = value === undefined || (value === "" && name !== "text");
    if (empty) throw new UsageError(`--${name} needs a value`);
    values.set(name, value);
  }
  for (const name of REQUIRED) {
    if (!values.has(name)) throw new UsageError(`--${name} is required`);
  }
  const sources = ["body", "text"].filter((name) => values.has(name));
  if (sources.length === 0) throw new UsageError("--body or --text is required");
  if (sources.length > 1) throw new UsageError("--body and --text are alternatives; give one");
  return {
    body: values.get("body"),
    text: values.get("text"),
    marker: values.get("marker"),
    label: values.get("label"),
    producer: values.get("producer"),
    dryRun: values.get("dry-run") === true,
  };
}

/**
 * The id of the comment the marker found, from `gh api … --jq` output.
 *
 * `--paginate` prints one id per matching comment per page, and only the first is
 * wanted: a pull request that somehow acquired two marked comments is still
 * updated in place at the oldest one rather than accumulating a third. Blank lines
 * are skipped, so a trailing newline is not mistaken for an id.
 */
export function pickCommentId(stdout) {
  const line = String(stdout ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? "";
}

/**
 * A run-page block: the loss as a heading, then the lines that explain it.
 *
 * Both notes below say the same three things — what did not arrive, why, and which step
 * to open — so they are laid out the same way, and a reader learns one shape.
 */
function note(heading, lines) {
  return ["", heading, "", ...lines, ""].join("\n");
}

/**
 * What the run page says when there was nothing to post.
 *
 * Written as the page reads it: the loss first, then the step to look at. The file
 * is named because that is what the reader has to match against the log above.
 */
export function announcement({ source, label, producer }) {
  return note(`## ${label} — ❌ nothing to post`, [
    `The '${producer}' step ${source}, so the pull-request comment was`,
    "skipped rather than posted empty. Check that step's log on this run.",
  ]);
}

/**
 * How the announcement names what was missing, for the source this was given.
 *
 * An absent `body` is the text source: there was no path to name, because the step was
 * meant to compose the reply rather than write a file.
 *
 * @param {{ body?: string }} source
 */
export function missingSource({ body }) {
  return body === undefined ? "produced no reply text" : `left no \`${body}\``;
}

/**
 * What the run page says when `gh` refused a post it was asked to make.
 *
 * The other half of the same worry as `announcement`, and deliberately a different note:
 * a body that never arrived is not a *rejected* body, and a page that answered a refused
 * post with “was not written, or was empty” would send the reader to look for a file that
 * was there. What a failure does not say by itself is what is on the pull request now —
 * a failed `PATCH` leaves the previous comment standing (stale, which reads as current
 * until someone checks it, and is the trap this note exists to name), while a failed
 * `POST` leaves none at all.
 *
 * `status` is `null` for a `gh` that could not be started, which is a runner problem
 * rather than a refusal and is the one case where `gh` itself said nothing.
 *
 * @param {{ label: string, producer: string, command: string, verb: string, url: string,
 *   status: number | null, detail?: string }} failure
 */
export function failureAnnouncement({ label, producer, command, verb, url, status, detail = "" }) {
  const state =
    verb === "PATCH"
      ? "The comment the marker found is untouched, so the pull request still shows what " +
        "the last successful run posted."
      : "No comment was left on the pull request at all.";
  const why = status === null ? "could not be started" : `failed with exit ${status}`;
  const where =
    status === null
      ? "The step is red on this run, and the reason it could not start is above."
      : "The step is red on this run, so `gh`'s own message is in the log above.";
  return note(`## ${label} — ❌ the comment was not posted`, [
    `The '${producer}' step ran \`${command} api -X ${verb} ${url}\`, which ${why}` +
      `${detail ? ` (${detail})` : ""}. ${state}`,
    where,
  ]);
}

/** Append a note to the run page, when the run has one to append to. */
function onRunPage(text) {
  const summary = process.env[ENV.summary];
  if (summary) appendFileSync(summary, text);
}

/**
 * Where the notes go: the run page in a real run, stdout in a dry run.
 *
 * A dry run has to leave the run page exactly as it found it, so the notes it would have
 * published are the ones it prints instead — same text, different reader, a person at a shell
 * rather than a reviewer on the pull request. Choosing the sink once, here, is what lets the
 * branch below that decides *what* to say be the same code either way.
 */
function pageWriter(args) {
  if (!args.dryRun) return onRunPage;
  return (text) => {
    process.stdout.write(`pr-comment: dry run — the run page would say:${text}`);
  };
}

/** The body's text, or `""` when the file is missing or has nothing but whitespace. */
function readBody(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Where the record of a body's redactions goes: beside the body, under a name derived from it.
 *
 * The record maps the posted comment back onto the artifact, so it ships with the artifact and
 * is named for what it maps — `collect-gates.md` becomes `collect-gates.redactions.json`. It is
 * derived rather than given as a flag on purpose: a path a step had to name separately is a path
 * a step can forget, and the workflow's artifact list and this derivation are held together by a
 * test rather than by a convention. A body whose last segment has no extension keeps its whole
 * name and gains the suffix, and a dot-file keeps its leading dot (`proposal.md`, `.env`).
 *
 * @param {string} body
 */
export function recordPathFor(body) {
  const text = String(body);
  const slash = text.lastIndexOf("/");
  const base = text.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0
    ? `${text.slice(0, slash + 1)}${base.slice(0, dot)}.redactions.json`
    : `${text}.redactions.json`;
}

/**
 * The record of what was replaced, written beside the body so it rides in the same artifact.
 *
 * This is the file the reader of a `<redacted>` marker needs and cannot get from either artifact
 * alone: the comment holds the marker and no value, the artifact holds the value and no marker,
 * and only this says which span the two differ by and which rule took it. It is deliberately
 * **not** on the pull request or the run page — the note there counts and points here — because
 * those are read by more people than the artifact is.
 *
 * A write that fails does not fail the step: the comment is already on the pull request, and the
 * exit status answers only whether it arrived. The failure is reported on stderr and the note
 * simply goes without a record path, rather than promising a file that is not there.
 *
 * @param {{ body: string, posted: string, substitutions: { rule: string, matched: string,
 *   replacement: string }[] }} record
 * @returns {string | null} the path written, or `null` when it could not be written.
 */
function writeRecord({ body, posted, substitutions }) {
  const path = recordPathFor(body);
  const record = { body, posted, redactions: substitutions.length, substitutions };
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    return path;
  } catch (error) {
    console.error(
      `pr-comment: could not write the redaction record to ${path} — ${error.message}; ` +
        "the comment is unaffected",
    );
    return null;
  }
}

/**
 * What the run page says when the body had to be scrubbed before it could be posted.
 *
 * A ⚠️ rather than a ❌ for the same reason the duplicate is: the comment is on the pull
 * request, the step succeeded, and the run is not owed anything. What the reader is owed is the
 * explanation for a `<redacted>` they can see in the comment they just read — the alternative
 * was a silent substitution, which reads as a renderer that lost a name.
 *
 * It counts rather than names: the names are exactly what was removed, so listing them would
 * publish the thing this exists to hide. Which substitutions they were is in the record written
 * beside the body, so the note points there rather than repeating it.
 *
 * @param {{ label: string, producer: string, redactions: number, record?: string | null }}
 *   scrubbed  `record` is the path of the record that was filed, or absent when there is none
 *   (a `--text` reply) or it could not be written; the note names it only when it is real.
 */
export function redactionAnnouncement({ label, producer, redactions, record }) {
  const lines = [
    `The '${producer}' step's body needed ${redactions} substitution${redactions === 1 ? "" : "s"}`,
    "before it could go up: a name that looks like a secret, a URL carrying credentials, or a",
    "private key written out. Each was replaced with `<redacted>`, and the comment was posted",
    "with the substitutions in place — the run's artifact keeps the body as it was written.",
  ];
  if (record) {
    lines.push(
      "",
      `What was replaced is recorded in \`${record}\`, beside that body in the run's artifact, so`,
      "the posted comment and the artifact can be compared substitution by substitution.",
    );
  }
  return note(`## ${label} — ⚠️ the comment was redacted before posting`, lines);
}

/** How many runs the suspect note below will name before it counts the rest. */
export const SUSPECT_LIMIT = 5;

/**
 * What the run page says when the body carries a run that might be a secret and no rule claims it.
 *
 * The counterpart of `redactionAnnouncement`, and it names what it found for the reason that one
 * counts: the redaction note withholds a value this script *removed*, so naming it would publish
 * the very thing it just hid, while this one is about a value the comment is **already carrying** —
 * withholding it would hide the thing the note is about and leave the reader nothing to act on.
 * Each note says the one thing a person has to do about it: one says a name was changed, this one
 * says a run may be a key that should never have gone out.
 *
 * It reads the text that is about to be posted, so a run the rules already took is not here: this is
 * a question about the comment, not about the file.
 *
 * @param {{ label: string, producer: string, suspects: string[] }} found
 */
export function suspectAnnouncement({ label, producer, suspects }) {
  const one = suspects.length === 1;
  const shown = suspects.slice(0, SUSPECT_LIMIT);
  const rest = suspects.length - shown.length;
  return note(`## ${label} — ⚠️ the body carries a run that may be a secret`, [
    `The '${producer}' step's body carries ${suspects.length} run${one ? "" : "s"} long and mixed`,
    `enough to be a generated key, and no rule here claims ${one ? "its" : "their"} shape — so`,
    `${one ? "it was" : "they were"} **not** redacted, and the comment is carrying ${one ? "it" : "them"}.`,
    "",
    "The rules hide what they are sure of; a shape they cannot be sure of is shown to a person",
    "instead, because hiding a word that was never a secret costs more than it saves. Check each",
    "one, and rotate anything that should not have been published.",
    "",
    ...shown.map((token) => `- \`${token}\``),
    ...(rest > 0 ? [`- …and ${rest} more.`] : []),
  ]);
}

/**
 * What the run page says when the lookup failed and the fallback post landed anyway.
 *
 * The third kind of note, and the only one that reports neither a loss nor a failure:
 * the step succeeded, so it is a warning (⚠️) rather than a ❌, and what it describes is
 * a fact about the pull request — a second marked comment — which is the run page's
 * subject rather than the log's. The alternative was to leave a reader who notices two
 * sticky comments with nothing to read, which is exactly the state this file exists to
 * stop happening.
 *
 * The wording is past tense on purpose, and so is the place it is written from: see
 * `main`, which announces only once the post has landed. A lookup that failed *and* a
 * fallback post that failed leave no duplicate to explain, and the failure note is the
 * only diagnosis that case needs.
 *
 * @param {{ label: string, producer: string, pr: string, lookup: string }} lost
 */
export function lookupAnnouncement({ label, producer, pr, lookup }) {
  return note(`## ${label} — ⚠️ the previous comment could not be looked up`, [
    `The '${producer}' step ${lookup}, so a new comment was posted rather than the one`,
    `the marker would have found. If a marked comment was already on #${pr}, the pull`,
    "request now shows two of them.",
    "",
    "The step stays green, and `gh`'s own message is in the log above. Delete the older",
    "of the two, and the next run has one comment to update.",
  ]);
}

/**
 * The id of the marked comment already on the pull request, and how the lookup went.
 *
 * A lookup that fails is a warning rather than a `UsageError`: the step's job is to
 * leave the reviewer a comment, and a transient listing failure should cost a
 * duplicate before it costs the comment itself. Both halves of that deal are kept — it
 * says so on stderr, where the log reader is, and hands the reason back so `main` can
 * put the same fact on the run page, where the duplicate it may have cost is visible.
 *
 * @returns {{ id: string, lookup: string }} the id the marker found (`""` for none), and
 *   a clause naming what went wrong (`""` for a clean lookup).
 */
function findComment(gh, { repo, pr, marker }) {
  const result = spawnSync(
    gh.command,
    [
      ...gh.prefix,
      "api",
      `repos/${repo}/issues/${pr}/comments`,
      "--paginate",
      "--jq",
      `.[] | select(.body | contains(${JSON.stringify(marker)})) | .id`,
    ],
    { encoding: "utf8" },
  );
  if (result.error) {
    console.error(
      `pr-comment: could not run ${gh.command} — ${result.error.message}; posting a new comment`,
    );
    return { id: "", lookup: `could not run \`${gh.command}\`` };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    console.error(
      `pr-comment: could not list the comments on #${pr} (exit ${result.status})` +
        `${detail ? ` — ${detail}` : ""}; posting a new comment`,
    );
    return {
      id: "",
      lookup: `could not list the comments on #${pr} (the lookup exited ${result.status})`,
    };
  }
  return { id: pickCommentId(result.stdout), lookup: "" };
}

/**
 * Rehearse the whole post without making any of it: no lookup, no `gh`, no run-page line.
 *
 * What a dry run can and cannot say is worth being plain about. It can say what the payload
 * would be and whether the body needed scrubbing, because those are decisions this script makes
 * on its own; it cannot say whether the comment would be created or updated, because that is the
 * marker lookup's answer and the lookup *is* a `gh` call. The line naming both verbs is that
 * honest half-answer, where showing a guessed `POST` alone would be wrong half the time.
 *
 * The notes it would publish go to stdout through the same `page` a real run appends through,
 * so the wording read here is the wording a reviewer would have read there — including the line
 * naming the record it would have filed, which is the one thing here a rehearsal deliberately
 * does not write. Nothing is written at all: no comment, no run-page line, no record.
 *
 * @returns {number} always 0: a rehearsal posted nothing, so nothing is missing, and the exit
 *   status stays out of the job gate's way — see `main` for the exit-code contract.
 */
function dryRun({ args, repo, pr, payload, substitutions, suspects, page }) {
  console.log(
    "pr-comment: dry run — no `gh` command was run and nothing was written: no comment, " +
      "no run-page line, and no redaction record.",
  );
  console.log(`pr-comment: dry run — the payload it would send: ${payload.join(" ")}`);
  console.log(
    "pr-comment: dry run — the verb is the marker lookup's answer and the lookup is skipped: " +
      `\`-X POST repos/${repo}/issues/${pr}/comments\`, or ` +
      `\`-X PATCH repos/${repo}/issues/comments/<id>\` when the marker finds a comment.`,
  );
  // The one note a dry run can know: the scrub happens here, before `gh`, so a body that would
  // have been changed says so. The duplicate note cannot appear — no lookup ran to fail — and
  // neither can the failure note, because nothing was attempted. The record path is named rather
  // than written, which is what makes the printed note identical to the one a real run files.
  if (substitutions.length > 0) {
    page(
      redactionAnnouncement({
        ...args,
        redactions: substitutions.length,
        record: args.body === undefined ? null : recordPathFor(args.body),
      }),
    );
  }
  // The warning is a note like any other, so a rehearsal prints it in full — the tokens and all,
  // which is what a person running the dry run needs to see to decide whether they are real.
  if (suspects.length > 0) page(suspectAnnouncement({ ...args, suspects }));
  return 0;
}

/**
 * `0` when the comment is on the pull request, `1` when it is not and this script knows why,
 * `2` for an invocation it refused to act on, `gh`'s own status when `gh` ran and refused.
 */
function main(argv) {
  const args = parseArgs(argv);
  const repo = process.env[ENV.repo] ?? "";
  const pr = process.env[ENV.pr] ?? "";
  if (!repo || !pr) {
    throw new UsageError(`${ENV.repo} and ${ENV.pr} must both be set (the workflow supplies them)`);
  }

  // Where the notes go: the run page for a real run, stdout for a dry run.
  const page = pageWriter(args);

  const written = args.body === undefined ? args.text : readBody(args.body);
  // Scrubbed before the guard, not after: the emptiness the guard judges is the emptiness of
  // what would actually be posted. Every rule replaces a match with a marker, so a body that
  // was not blank cannot become blank here.
  const { text: readable, substitutions } = redact(written);
  if (readable.trim() === "") {
    const what = args.body === undefined ? "the reply text" : args.body;
    console.log(`pr-comment: ${what} was not written, or was empty — nothing to post.`);
    page(announcement({ ...args, source: missingSource(args) }));
    // A rehearsal reports the same miss a real run would, but exits 0: nothing was owed, because
    // nothing was attempted, and a dry run that failed the job gate would be a trap rather than a
    // rehearsal. The line says what the real run's code would be, so the verdict is not lost.
    if (args.dryRun) {
      console.log(
        "pr-comment: dry run — nothing was sent; a real run would exit 1, which the job's gate " +
          "reads as a lost comment.",
      );
      return 0;
    }
    // 1, not 0: the run page's note is the explanation, and this is the fact the job is
    // judged on — `.freebuff/comment-gate.mjs` fails the job for a step whose outcome is
    // `failure`, and a run that owed a comment and posted none must not pass.
    return 1;
  }
  // One shape for both sources — the raw field — because the body is read above to be
  // redacted, and `-F body=@path` is the form in which `gh` does that reading itself.
  const payload = ["-f", `body=${readable}`];
  // Scanned on what would be posted rather than on what was read, so a run a rule already took is
  // gone and only the survivors are named: this is a question about the comment, not about the file.
  const suspects = suspectTokens(readable);
  // Before the lookup, because the lookup is a `gh` call: a rehearsal reports the payload and the
  // notes it can know and leaves the verb to the real run, which is the honest half-answer.
  if (args.dryRun) return dryRun({ args, repo, pr, payload, substitutions, suspects, page });

  const gh = ghCommand();
  const { id, lookup } = findComment(gh, { repo, pr, marker: args.marker });
  const verb = id ? "PATCH" : "POST";
  const url = id ? `repos/${repo}/issues/comments/${id}` : `repos/${repo}/issues/${pr}/comments`;
  const result = spawnSync(gh.command, [...gh.prefix, "api", "-X", verb, url, ...payload], {
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`pr-comment: could not run ${gh.command} — ${result.error.message}`);
    // Not 2: that exit code is the steps' contract for an invocation this refused to act
    // on, and this one *tried* — the runner is what failed, so it is a plain red step.
    page(
      failureAnnouncement({
        ...args,
        command: gh.command,
        verb,
        url,
        status: null,
        detail: result.error.message,
      }),
    );
    return 1;
  }
  if (result.status !== 0) {
    console.error(
      `pr-comment: ${verb} ${url} failed (exit ${result.status}) — the comment was not posted`,
    );
    // The step goes red either way; this is what makes the failure visible where a
    // reviewer is already looking, which is the run page and not the step log.
    page(
      failureAnnouncement({
        ...args,
        command: gh.command,
        verb,
        url,
        status: result.status,
      }),
    );
    return result.status ?? 1;
  }
  console.log(`pr-comment: ${verb} ${url} from ${args.body ?? "the reply text"}`);
  // Both notes below describe a post that has landed, which is why they are written here
  // rather than beside the body: a run whose post failed as well is already answered by the
  // failure above, and neither of these is true of a comment that is not on the pull request.
  if (substitutions.length > 0) {
    console.error(
      `pr-comment: ${substitutions.length} substitution(s) made before posting — the comment ` +
        "carries `<redacted>` where the body named a secret.",
    );
    // Filed here, beside the other post-landed notes, and only for a `--body` post: the record is
    // the map between the comment and the artifact, so it belongs where the artifact's raw text
    // is. A reply composed in the step has no such file, and writing one would put a secret in the
    // checkout rather than in an artifact. `record` is the path written, or null on a failed
    // write, and the note names it only when it is really there.
    const record =
      args.body === undefined
        ? null
        : writeRecord({ body: args.body, posted: `${verb} ${url}`, substitutions });
    page(redactionAnnouncement({ ...args, redactions: substitutions.length, record }));
  }
  // Written here with the other post-landed notes, and for the same reason: it says a *comment* is
  // carrying these, which is only true once the comment is on the pull request.
  if (suspects.length > 0) {
    console.error(
      `pr-comment: ${suspects.length} run(s) in the body look like a generated key and match no ` +
        "rule — not redacted.",
    );
    page(suspectAnnouncement({ ...args, suspects }));
  }
  if (lookup !== "") page(lookupAnnouncement({ ...args, pr, lookup }));
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`pr-comment: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 2;
  }
}
