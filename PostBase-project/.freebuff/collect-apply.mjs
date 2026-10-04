/**
 * The apply contract: how an approved collect-budget proposal becomes the
 * checked-in baselines file.
 *
 * One place for everything the proposer, the apply launcher, and the
 * `collect-apply` workflow have to agree on:
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
