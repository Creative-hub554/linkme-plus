/**
 * The apply contract: how an approved collect-budget proposal becomes the
 * checked-in baselines file.
 *
 * One place for everything the proposer, the apply launcher, the `collect-apply`
 * workflow, and the nightly job's settlement step have to agree on:
 *
 *   1. `renderBaselines` — the canonical source of
 *      `.freebuff/collect-budget-baselines.mjs`. The recorder writes it, and a
 *      test compares the committed file to it, so the file that is checked in
 *      and the file the recorder would write cannot drift. It lives here, in
 *      plain ESM, rather than in `src/test/collect-budget.ts`, because the apply
 *      launcher runs on bare Node with no TypeScript toolchain — and the file it
 *      writes has to be byte-identical to the recorder's.
 *
 *   2. the proposal *payload* — a hidden HTML comment the proposer appends to the
 *      comment it posts, carrying the exact values the run earned. The apply
 *      step reads them back out of the comment body rather than re-measuring, so
 *      what a reviewer approved is what gets applied, on whatever machine the
 *      approval happens to run.
 *
 *   3. `applyProposal` — the tighten-only merge of a payload onto the committed
 *      file. It mirrors the recorder's direction (a value may only fall), so a
 *      stale or edited payload can never *loosen* a gate; and it takes the import
 *      margin from the committed file rather than from the payload, because the
 *      margin is hand-set rather than measured and is not the payload's to move.
 *
 *   4. the three *markers*, and the reading that turns them into days — the nightly
 *      job's settlement step (`--settle-collect` in
 *      `.freebuff/coverage-trend.mjs`) asks `proposalPostedAt` and
 *      `proposalAnswer` which of a pull request's comments is the proposal and
 *      which is the reply that answered it, so the marker a poster writes and the
 *      marker a recorder looks for are one declaration rather than two that could
 *      drift apart.
 *
 *   5. the reply's own *outcome* — the status the apply job declares in the reply it
 *      posts (`APPLY_STATUS_OPEN`, written by the `collect-apply` workflow), read
 *      back by `applyOutcomeIn`. A settlement record has to say what the reply did
 *      to the proposal, and the one thing it may not do is guess: a refusal is not
 *      an adoption, so the word the recorder writes into the runbook is the word the
 *      reply itself declared. A reply that declares nothing (one the job posted
 *      before this vocabulary existed) reads as the plain answer it always was,
 *      which is why `applyOutcomeIn` answers `null` rather than inventing a word.
 *
 * A payload that would raise a value is *refused*, not clamped. The two failure
 * modes are worth telling apart: the recorder's ratchet is deliberately safe to
 * run blindly, while this one is driven by a comment a person wrote — so an
 * attempt to loosen a gate should be loud rather than quietly dropped.
 *
 * Mirrors `.freebuff/collect-budget-soft.mjs`: a small pure module both the
 * reporter and the CI runner import, so the contract between them is a function
 * under test rather than two copies of a string that drift apart.
 */

/**
 * The command a reviewer replies with to apply a proposal.
 *
 * A token rather than a button because it has to survive being typed by hand on
 * a comment, and because the workflow only has the comment's text to match on.
 */
export const APPLY_COMMAND = "/collect-apply";

/** The HTML comment that identifies the proposal comment, so it updates in place. */
export const PROPOSAL_MARKER = "<!-- collect-budget-proposal -->";

/**
 * The HTML comment that identifies this workflow's own reply, so a second
 * approval updates the first reply rather than stacking a new one.
 *
 * Must not contain the apply command: the workflow matches on that command in a
 * comment's text, and a reply that quoted it would arm the trigger again.
 */
export const APPLY_REPLY_MARKER = "<!-- collect-budget-apply -->";

/**
 * The outcome words the reply can declare, in the order the apply job's own cases state them: the two
 * that adopted the proposal (`applied`, and `unchanged` where the recorded baselines already sit at or
 * below what it proposed), the two where the values never landed (`drift`, `unverified`), the two where
 * there was nothing to apply (`refused`, the payload would have raised a gate; `no-payload`, the comment
 * carried none), and the two ways the job could not act at all (`fork`, no branch of this repository to
 * open a follow-up against; `unknown`, the approval could not be applied for a reason the reply does not
 * state).
 *
 * The vocabulary is the record's, not just the poster's: a settlement's outcome word is one of these (or
 * the reader's own `answered` for a reply that declares nothing, or `closed unanswered` for a request
 * nobody replied to), so a word added here is a word the runbook's head can read back — which is what
 * keeps a later night from recording the same proposal twice. `src/test/collect-budget.test.ts` holds the
 * two ends together: every word the workflow's reply step can assign is one of these.
 */
export const APPLY_STATUSES = [
  "applied",
  "unchanged",
  "no-payload",
  "refused",
  "drift",
  "unverified",
  "fork",
  "unknown",
];

/**
 * The two statuses that mean the proposal was *adopted*: the values were written and a follow-up stands
 * (`applied`), or they needed no writing because the recorded baselines already sit at or below what was
 * proposed (`unchanged`). Everything else in `APPLY_STATUSES` is a reply that left the gates where they
 * were, and the distinction is the whole point of recording the word: a settlement that reads `refused`
 * is not one that reads `applied`.
 */
const ADOPTED_STATUSES = ["applied", "unchanged"];

/**
 * The hidden marker a reply declares its own outcome in.
 *
 * A comment rather than a line of prose, for the reason every marker in this file is one: the reply's
 * sentences are the reviewer's to rewrite, and a reader that matched on them would read a different
 * outcome the day somebody reworded one. The word inside it is the workflow's own `STATUS` (its `fork`
 * branch and its fallback included), so what a reviewer reads on the pull request and what the runbook
 * records come from one value.
 */
export const APPLY_STATUS_MARKER = "collect-budget-apply-status";

/**
 * How that declaration opens in a reply body — the prefix the reply writes and `applyOutcomeIn` reads.
 *
 * Exported because both sides have to spell it: the workflow composes the reply in shell (no module call
 * there — the job installs nothing), so `src/test/collect-budget.test.ts` pins the workflow's source
 * against this constant, and the reader below is the only other place the shape appears.
 */
export const APPLY_STATUS_OPEN = `<!-- ${APPLY_STATUS_MARKER} `;

/**
 * The key inside the hidden payload comment.
 *
 * Its own marker, not the proposal's: the proposal marker is what the workflow
 * greps to find the comment, and must stay a stable, single line. The payload is
 * the machine-readable half, and is parsed rather than grepped.
 */
export const PROPOSAL_STATE_MARKER = "collect-budget-proposal-state";

/** The doc comment at the top of the generated baseline file. */
const BASELINE_HEADER = `/**
 * The collect-budget baselines: the recorded inputs the collect-time reporter
 * enforces, in one place.
 *
 * \`importBaselines\` and \`softThreshold\` are recorded — \`npm run collect:record\`
 * measures a run and lowers either one the run beat, never raises it, so both
 * gates only ever tighten:
 *
 *   - \`importBaselines\` — each tracked scanner's low-water import cost. A file's
 *     import of that scanner must stay within \`importMarginMs\` of it.
 *   - \`softThreshold\` — the fraction of its collect budget at which a file stops
 *     being merely interesting and starts being a warning, kept a margin above
 *     the tightest file the recording run saw.
 *
 * \`importMarginMs\` is the fixed margin the import gate keeps over each
 * \`importBaselines\` entry. It is hand-set on purpose: it is about how much noise
 * a single import can absorb, not about what the machine measured.
 *
 * Generated — do not edit \`importBaselines\` or \`softThreshold\` by hand. \`npm
 * run collect:record\` rewrites them, and a hand-edit fails the freshness test in
 * \`src/test/collect-budget.test.ts\`. To loosen a gate deliberately, edit this
 * file and say why in the commit.
 *
 * Mirrors the coverage pair whose shape it borrows: \`coverage-thresholds.mjs\`
 * holds the backstop and \`coverage-headroom.mjs\` fails the build when the margin
 * over it is too thin. Here the recorded values are the backstops.
 */`;

/**
 * The exact source of `.freebuff/collect-budget-baselines.mjs` for a set of
 * baselines.
 *
 * The recorder writes this, the apply step writes it, and a test compares it to
 * the committed file, so the checked-in baselines cannot drift from what either
 * writer would produce — the same contract `npm run skill:index` keeps for its
 * generated index.
 */
export function renderBaselines(committed) {
  const rows = Object.keys(committed.importBaselines)
    .sort()
    .map((tracked) => `  ${JSON.stringify(tracked)}: ${committed.importBaselines[tracked]},`)
    .join("\n");
  return (
    `${BASELINE_HEADER}\n\n` +
    `export const importMarginMs = ${committed.importMarginMs};\n\n` +
    `export const softThreshold = ${committed.softThreshold};\n\n` +
    `export const importBaselines = {\n${rows}\n};\n`
  );
}

/** Whether a value is a plain object, not an array or null. */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a real, finite number. */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The hidden, machine-readable half of a proposal comment: the values the run
 * earned, so the apply step can use exactly them.
 *
 * JSON in an HTML comment, so it renders as nothing but survives being posted,
 * edited, and read back. Only the two *recorded* values are carried — the import
 * margin is hand-set, so it is not the payload's to propose.
 */
export function renderProposalState(applied) {
  const payload = JSON.stringify({
    softThreshold: applied.softThreshold,
    importBaselines: applied.importBaselines,
  });
  return `<!-- ${PROPOSAL_STATE_MARKER} ${payload} -->`;
}

/**
 * The payload a proposal comment carries, or null when it carries none.
 *
 * Null is the answer for every way this can go wrong — no marker, an unterminated
 * comment, JSON that does not parse, a shape that is not the two recorded values —
 * because the only caller is deciding whether to apply, and "there is nothing
 * trustworthy here" is one state, not five. A malformed payload is never a crash
 * on a public pull request.
 */
export function parseProposalState(body) {
  if (typeof body !== "string") return null;
  const open = `<!-- ${PROPOSAL_STATE_MARKER} `;
  const start = body.indexOf(open);
  if (start === -1) return null;
  const end = body.indexOf("-->", start + open.length);
  if (end === -1) return null;
  let parsed;
  try {
    parsed = JSON.parse(body.slice(start + open.length, end).trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isFiniteNumber(parsed.softThreshold)) return null;
  if (parsed.softThreshold <= 0 || parsed.softThreshold >= 1) return null;
  if (!isRecord(parsed.importBaselines)) return null;
  for (const value of Object.values(parsed.importBaselines)) {
    if (!isFiniteNumber(value) || value < 0) return null;
  }
  return { softThreshold: parsed.softThreshold, importBaselines: parsed.importBaselines };
}

/**
 * The oldest comment on a pull request whose body carries `marker`, as the comment itself.
 *
 * Shared by the three readers below, and the sharing is the point: a proposal, the reply that answers
 * it and the outcome that reply declares are one question asked of one list — is there a comment
 * carrying *this* marker on it, and what did the oldest of them say — so the walk that finds them is
 * one implementation rather than three that could come to disagree about which comment counts. The
 * **oldest** marked comment is the one that matters, never the newest: the poster updates the earliest
 * id its marker finds and posts a second comment only when that lookup failed, so a pull request
 * carrying two proposals carries one proposal and one duplicate of it — the age a reviewer is reading
 * is the age of the question, and the duplicate is the older one's copy. The same rule makes the
 * earliest reply the answer: a second approval updates the reply already there rather than stacking a
 * new one.
 *
 * The whole comment comes back — its `body` beside its day — because the outcome a reply declares is
 * read out of the *same* comment that dates it: reading the earliest reply's day off one comment and its
 * status off another would be two answers to one question.
 *
 * `gh pr list --json number,closedAt,comments` is the shape this reads: each comment with its `body`
 * and the `createdAt` it was posted at. A comment with no body, no readable `createdAt`, or an entry
 * that is not one is skipped rather than guessed at — the readers that follow are deciding whether a
 * request was answered and what that answer was, and a question about a comment nobody could read has
 * no answer in it. `null` is one state: no marked comment at all, whether the list was empty, the pull
 * request had nothing on it, or the entry was not a pull request.
 */
function markedComment(pull, marker) {
  const comments = Array.isArray(pull?.comments) ? pull.comments : [];
  const marked = comments
    .filter((comment) => comment !== null && typeof comment === "object")
    .filter((comment) => typeof comment.body === "string" && comment.body.includes(marker))
    .filter((comment) => typeof comment.createdAt === "string" && comment.createdAt !== "")
    .sort((left, right) =>
      left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0,
    );
  return marked.length === 0 ? null : { body: marked[0].body, createdAt: marked[0].createdAt };
}

/** The oldest marked comment's day, or `null` when there is none this can read a day off. */
function markedCommentAt(pull, marker) {
  return markedComment(pull, marker)?.createdAt ?? null;
}

/**
 * When the job first proposed a tightening on a pull request, or `null` when it never did.
 *
 * This is the day the age of a collect proposal is counted from, and it is deliberately the
 * *comment's* own `createdAt` rather than the pull request's `createdAt`: a proposal is posted when
 * the pull request's collect time is first measured to have moved, which can be days into a branch
 * that was opened for something else — and a request the job raised on Tuesday was not ignored on
 * Monday. A pull request the job never proposed anything on answers `null`, which is what keeps
 * every pull request in the nightly job's list from becoming a record of nothing.
 *
 * @param {object} pull one pull request as `gh pr list --json number,closedAt,comments` states it
 */
export function proposalPostedAt(pull) {
  return markedCommentAt(pull, PROPOSAL_MARKER);
}

/**
 * When a proposal on a pull request was answered, or `null` while it stands unanswered.
 *
 * The answer is the apply job's own reply — `APPLY_REPLY_MARKER`, posted on the pull request the
 * proposal was made on — and not the follow-up pull request that reply opened, which is a request
 * with its own life and its own merges. What this records is how long *this* job's question sat
 * unanswered, and the reply is the moment somebody read it: it is posted whether the payload applied,
 * was refused, or came from a fork. This answers only *when* somebody read it; what the reply did with
 * the proposal is `proposalAnswer`'s, which reads the same comment's declared outcome, and a caller that
 * records a settlement wants both — a reply is a day and an outcome, not a day. The *earliest* reply is
 * the answer, for the reason the oldest proposal is the proposal: a second approval updates the reply
 * that is already there rather than stacking a new one, so a pull request carrying two of them carries
 * one answer and a second reading of it.
 *
 * @param {object} pull one pull request as `gh pr list --json number,closedAt,comments` states it
 */
export function proposalAnsweredAt(pull) {
  return markedCommentAt(pull, APPLY_REPLY_MARKER);
}

/**
 * The outcome a reply declares, as the word a settlement record can hold.
 *
 * The word the apply job wrote into its own reply (`APPLY_STATUS_OPEN`), read back here so the runbook
 * records what the reply *did* rather than only that somebody replied — the distinction the record was
 * missing: a proposal the job refused to apply and one it adopted both read as `answered`, which is the
 * one thing a settlement table of proposals must not say, since the whole reason the reply carries a
 * status is that "the ask was read" and "the tightening landed" are different facts.
 *
 * Three answers, because a reply can be three things. The declared word when it is one of
 * `APPLY_STATUSES`. `"unknown"` when the reply carries the marker and a word this vocabulary does not
 * hold — including an empty one, which is a declaration the job got wrong rather than the absence of
 * one — because a word nothing can interpret is closer to "the reply did not say" than to any status,
 * and mapping it to a status this module knows would be inventing the outcome. And `null` when the reply
 * carries no marker at all: one the job posted before this vocabulary existed, whose sentences are the
 * answer and whose outcome the reader has no business asserting. `null` is deliberately not `"unknown"`
 * — the caller writes its own word for it, the same `answered` every record of such a reply has read as,
 * so the older records keep meaning what they always meant.
 *
 * @param {unknown} text a comment's body, or anything a caller had in hand
 */
export function applyOutcomeIn(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf(APPLY_STATUS_OPEN);
  if (start === -1) return null;
  const end = text.indexOf("-->", start + APPLY_STATUS_OPEN.length);
  if (end === -1) return null;
  const declared = text.slice(start + APPLY_STATUS_OPEN.length, end).trim();
  return APPLY_STATUSES.includes(declared) ? declared : "unknown";
}

/**
 * Whether a declared outcome is one that *adopted* the proposal.
 *
 * The one judgement a reader of these records cannot make for itself by comparing strings: `applied` and
 * `unchanged` are the two replies where the tightening stands (written, or already in place), and every
 * other word is a reply that left the gates alone — a refusal, a pin that would not record the file, a
 * check that disagreed, a fork with no branch to open, a comment with nothing to apply, an outcome
 * nobody could read. Kept here rather than in the page that counts them, so the vocabulary and its
 * meaning are one declaration.
 *
 * @param {unknown} status a word `applyOutcomeIn` answered
 */
export function applyAdopted(status) {
  return ADOPTED_STATUSES.includes(status);
}

/**
 * A proposal's answer: when the reply landed, and the outcome it declared.
 *
 * `{ at, status }` — the day the reply was posted and the word it declared, with `status` possibly
 * `null` for a reply that declares none — or `null` while nothing has answered the proposal. Both halves
 * come off the *same* comment (`markedComment`'s earliest reply), which is why this is not two calls: the
 * day and the outcome are one answer, and reading them off different comments would be a record dated by
 * one reply and described by another.
 *
 * @param {object} pull one pull request as `gh pr list --json number,closedAt,comments` states it
 */
export function proposalAnswer(pull) {
  const reply = markedComment(pull, APPLY_REPLY_MARKER);
  if (reply === null) return null;
  return { at: reply.createdAt, status: applyOutcomeIn(reply.body) };
}

/**
 * Merge an approved payload onto the committed baselines, tightening only.
 *
 * Each tracked module drops to the payload's value only if that is *below* the
 * committed one, and the soft threshold likewise; a value the payload leaves
 * equal is not a change. A payload that would raise either throws: the recorder's
 * ratchet can be left to run unattended, but this one acts on a comment, so an
 * attempt to loosen a gate is refused where a person can see it rather than
 * absorbed into a silent no-op.
 *
 * `changed` is what decides whether anything is written at all, which is also
 * what makes a second approval of the same proposal a no-op rather than a second
 * commit.
 */
export function applyProposal(committed, proposed) {
  const importBaselines = { ...committed.importBaselines };
  for (const [tracked, value] of Object.entries(proposed.importBaselines)) {
    if (!isFiniteNumber(value) || value < 0) {
      throw new Error(`refusing a malformed baseline for ${tracked}: ${JSON.stringify(value)}`);
    }
    const current = importBaselines[tracked];
    if (current !== undefined && value > current) {
      throw new Error(`refusing to raise ${tracked} from ${current} to ${value}`);
    }
    if (current === undefined || value < current) importBaselines[tracked] = value;
  }

  if (!isFiniteNumber(proposed.softThreshold) || proposed.softThreshold <= 0) {
    throw new Error(`refusing a malformed softThreshold: ${JSON.stringify(proposed.softThreshold)}`);
  }
  if (proposed.softThreshold > committed.softThreshold) {
    throw new Error(
      `refusing to raise softThreshold from ${committed.softThreshold} to ${proposed.softThreshold}`,
    );
  }

  const softThreshold = Math.min(committed.softThreshold, proposed.softThreshold);
  const changed =
    softThreshold !== committed.softThreshold ||
    Object.keys(importBaselines).length !== Object.keys(committed.importBaselines).length ||
    Object.entries(importBaselines).some(
      ([tracked, value]) => committed.importBaselines[tracked] !== value,
    );

  return {
    baselines: { importMarginMs: committed.importMarginMs, softThreshold, importBaselines },
    changed,
  };
}
