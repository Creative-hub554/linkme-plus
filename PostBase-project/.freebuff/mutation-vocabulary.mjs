/**
 * The survivor vocabularies every mutation sweep speaks, declared once.
 *
 * Each tree-editing sweep stamps every survivor it reports with a `kind`, and each
 * sweep declares the words those kinds can carry — the guard sweep over
 * `STRIKE_WORDS`, the preflight sweep and the coverage launcher over their own
 * `SURVIVOR_WORDS` tables. Those tables used to live beside the sweep that read
 * them, which meant the two-way refusal (a stamp no word covers, a word nothing
 * stamps) and the suites' spelling pins had to be re-declared per sweep, and a
 * fourth sweep inherited none of it: it would copy the pattern by hand, and the
 * copies could then drift one from another.
 *
 * So the words live here, and a sweep that means to report survivors imports its
 * table and gets three things without restating any of them:
 *
 *   - the table itself, imported under its local name (`as SURVIVOR_WORDS`), so
 *     every sentence the sweep prints about its own vocabulary keeps its spelling;
 *   - `vocabularyHoles`, the two-way comparison the start-up refusal acts on,
 *     which is one function because it is one contract: the set a sweep stamps
 *     and the set its report declares must be the same set, and either side can
 *     break on its own;
 *   - the suites' holds, which read these tables from this file and each sweep's
 *     stamps from the sweep, so a word renamed on either side reds a case.
 *
 * What deliberately stays in each sweep: the stamp scan (what counts as a stamp is
 * the sweep's own shape — a `kind:` literal, a `KIND_*` constant, an entry's
 * resolution through `strikeKind`) and the refusal itself (a survivor object
 * shaped to that sweep's payload). This module holds the words and the comparison;
 * the sweeps hold how they are broken and how that is reported.
 *
 * The three tables are three tables on purpose, not one: the guard sweep's words
 * describe *families* a strike belongs to (`what`, `pin`), the preflight's pair a
 * report mark with a reason, and the coverage launcher's are the report marks the
 * runner copies verbatim into its stage details. A sweep adding a table here names
 * it for itself (`FOURTH_SURVIVOR_WORDS`) and imports it under the local name its
 * report already speaks.
 */

/**
 * The guard sweep's self-mutation families: the word every reader of a survivor
 * speaks — the report looks a family's words up (`STRIKE_WORDS[kind].what` and
 * `.pin`), the `--json` survivor carries the kind, and the runner groups and
 * counts by it. `strikeKind` stays in the sweep: it is the one place a stamp is
 * resolved (`limb` for a detector struck at one limb, the entry's own `kind`
 * otherwise, `self` for a helper that names none), and this table is the one
 * place a word is declared.
 */
export const STRIKE_WORDS = {
  self: { what: "the helper", pin: "helper" },
  convention: { what: "the detector", pin: "detector" },
  limb: { what: "one limb of the detector", pin: "limb of the detector" },
  runner: { what: "a check in the runner", pin: "check in the runner" },
  lock: { what: "the leaked-mutation check", pin: "leaked-mutation refusal" },
  ratchet: { what: "the declared-table ratchet", pin: "declared-table ratchet" },
};

/**
 * The preflight sweep's survivor words: the mark its report prints and the reason
 * it carries, one pair per kind. A stamp with no word is a survivor the report
 * counts nowhere — its buckets filter on exactly these words — and a word with no
 * stamp is a repair the report claims and nothing can reach.
 */
export const PREFLIGHT_SURVIVOR_WORDS = {
  survived: { mark: "SURVIVED", why: "a test passed with the branch broken, so nothing pins it" },
  broken: { mark: "UNCHECKED", why: "the mutation could not be applied, so the branch is not swept" },
};

/**
 * The coverage launcher's survivor words: the marks its buckets print, which the
 * runner's `mutation-coverage` stage copies verbatim into the details it reports.
 */
export const COVERAGE_SURVIVOR_WORDS = {
  survived: "SURVIVED WEAKENING",
  broken: "CHECK BROKEN",
};

/**
 * Why each coverage bucket exists, one sentence per word: the human report reads
 * it as the bucket's sub-heading and the payload carries the survivor's own
 * `detail`, so the two cannot come to mean different things — the sentence is the
 * table's, not a second copy.
 */
export const SURVIVOR_WHY = {
  survived: "a gate's own test file did not notice the weakening",
  broken: "the check could not say whether the gate is load-bearing",
};

/**
 * The two ways a sweep's stamps and its declared words can disagree, computed
 * once here because the contract is once: the tables the sweep declares are held
 * to the set of words its own source stamps, both directions.
 *
 *   - `unnamed` — a stamp no word covers: every reader of such a survivor is
 *     wrong at once, and the report counts it under nothing.
 *   - `unspoken` — a declared word nothing stamps: the report claims a bucket no
 *     survivor can ever fill.
 *
 * `words` is the sweep's table (its keys are the declared words); `stamps` is the
 * iterable of words the sweep's own scan found in stamp position. Both halves are
 * returned whole, in declaration order, so a refusal can name every hole in one
 * pass rather than exiting on the first.
 */
export function vocabularyHoles(words, stamps) {
  const stamped = new Set(stamps);
  return {
    unnamed: [...stamped].filter((kind) => !(kind in words)),
    unspoken: Object.keys(words).filter((word) => !stamped.has(word)),
  };
}

/**
 * The fourth sweep's words: `mutation-example.mjs`, kept as the minimal end-to-end proof that a
 * sweep inherits the machinery by importing this module — a table named for itself (the rule the
 * header above states), the same two words the other survivor sweeps speak, and nothing else.
 * The sweep it feeds runs no mutation, so its refusal is a demonstration rather than a gate: it
 * exists to carry the `broken` stamp a clean two-word vocabulary needs, and to show the
 * inheritance arriving in one import line — refusal, table and holds, none restated.
 */
export const FOURTH_SURVIVOR_WORDS = {
  survived: { mark: "SURVIVED", why: "the fourth sweep's own bucket, spoken from the shared table" },
  broken: { mark: "UNCHECKED", why: "the demonstration refusal's own kind" },
};

/**
 * The fifth sweep's words: the same two words every sweep speaks, named for the sweep
 * that reads them. The scaffold declared this table beside the fourth's; the sweep's own
 * prose is the operator's to own.
 */
export const FIFTH_SURVIVOR_WORDS = {
  survived: { mark: "SURVIVED", why: "the fifth sweep's own bucket, spoken from the shared table" },
  broken: { mark: "UNCHECKED", why: "the demonstration refusal's own kind" },
};
