#!/usr/bin/env node
/**
 * The CI entry point: the whole verification pass, in one job.
 *
 * Each stage is something a CI job *could* call on its own. What this adds is a
 * single place that runs them in the right order, reads the ones that speak JSON
 * through their contract rather than their rendered report, and turns a failure
 * into a short, log-first summary — the type error, the failing test, the failed
 * check, or the surviving mutant, named — so the CI log says what broke without
 * anyone scrolling a full report. It is the shape of `npm test`, `tsc` and the
 * preflight run together, with the git-diff-then-read-the-log step folded in.
 *
 * Parsing the JSON is the point for the gate stages: the formatted reports are
 * renderings whose line layout can change, while the `gate` field and the
 * survivor list are the contract. A gate that writes no JSON at all is a crashed
 * gate, and this fails on it rather than passing quietly.
 *
 * ## The stages, in order (cheapest first)
 *
 * <!-- stage-order:begin -->
 * 11 stage(s), in canonical order: `typecheck`, `runbook`, `lint`, `test`, `preflight`, `drift`, `mutation-example`, `mutation-fifth`, `mutation-coverage`, `mutation-preflight`, `mutation`.
 * <!-- stage-order:end -->
 *
 *  1. `typecheck` — `tsc --noEmit`. Seconds, and read-only: a type error makes
 *     every stage below a waste, so it goes first.
 *  2. `runbook`   — `build-contents.mjs --check --json`. Instant and read-only:
 *     the committed Contents must match the runbook's headings, so a renamed
 *     section with a stale bullet fails here rather than as a dead link.
 *  3. `lint`      — `lint-baseline.mjs --json`. Read-only, and seconds: a whole-
 *     project ESLint run where any finding fails. The suite holds the same
 *     baseline locally, but a reintroduced warning is green under `npm run
 *     lint` and only named deep inside the test report — this stage says it in
 *     one line, before the suite runs.
 *  4. `test`      — `vitest run`. The suite, reported through vitest's JSON
 *     reporter so a failure prints the failing test names, not the whole tree.
 *  5. `preflight` — `preview-preflight.mjs --json`. Read-only: is the tree ready
 *     to register a preview (deps, env, a live server).
 *  6. `drift`     — `gate-drift.mjs --json`. Instant and read-only: every file the
 *     build's verdict is made of — the runner, the stage scripts, the mutation
 *     checks and the lock they share, the redactor and the nightly report, the
 *     collect ratchet, the two vitest configs, the compiler and linter config, and
 *     the workflows themselves — is compared to the hash recorded in
 *     `.freebuff/gate-hashes.mjs`, so a file rewritten by hand (a stage with empty
 *     `inputs`, an extra suite `exclude`, a floor lowered, an `exclude` widened in
 *     `tsconfig.json`, a step deleted from a workflow, a launcher that stops calling
 *     a survivor a survivor) fails here. It runs *before* the
 *     three tree-editing stages, so the files those weaken and restore are the ones this
 *     run has already vouched for, and a script a killed run left weakened with no
 *     lock behind it (the one case the recovery below cannot reach) is named for
 *     what it is.
 *  7. `mutation-example` — `mutation-example.mjs --json`. The vocabulary smoke stage: the
 *     cheapest gate in the run — one demonstration stamp from the fourth sweep, which runs
 *     no mutation and takes no lock, so it is read-only and cacheable like the stages above.
 *     Its pre-pass (the same `vocabularyFirst` the tree-editing stages carry) reds the gate
 *     on a vocabulary hole before the run mode spawns, so the inheritance the shared
 *     vocabulary module promises is exercised every run rather than trusted.
 *  8. `mutation-fifth` — `mutation-fifth.mjs --json`. The vocabulary smoke stage the
 *     scaffold onboards: the same read-only demonstration shape as the stage above — its
 *     words declared in the shared module, its refusal a payload, its run report one
 *     demonstration stamp — with the same `vocabularyFirst` pre-pass, so a hole reds the
 *     gate before the run mode is ever spawned.
 *  9. `mutation-coverage` — `mutation-coverage.mjs --json`. It weakens each
 *     coverage gate script in place and requires that script's own test file to
 *     fail, so a coverage gate that stopped being load-bearing is a survivor
 *     here, reported the way the guard sweep below reports its own.
 * 10. `mutation-preflight` — `mutation-preflight.mjs --json`. It breaks one branch
 *     of `preview-preflight.mjs` at a time and requires that file's own tests to
 *     fail, so a mid-session check that stopped being load-bearing is a survivor
 *     here, reported the way the other two report theirs. Nineteen Vitest runs, so
 *     cheaper than the route sweep below and ordered before it.
 * 11. `mutation`  — `mutation-guards.mjs --json`. The most expensive: it mutates
 *     each route guard and catches a survivor whose neighbour test never noticed.
 *     The last three are the group that edits the working tree — one file at a time,
 *     each restored as its check ends — so they run last, and nothing else should
 *     touch the tree in that window.
 *
 * The run stops at the first failing stage by default, so a red typecheck does
 * not wait for the minutes-long suite and sweep behind it — the stages are
 * ordered cheapest first precisely so the cheapest failure is the one you pay
 * for. A detected CI environment (`CI=true`, or another CI marker) turns
 * `--keep-going` on by itself, so a scheduled job reports every problem instead
 * of only the first, while a local run stays fail-fast; `--keep-going` forces it
 * on anywhere, and `--fail-fast` restores the stop-early behavior inside CI.
 * `--max-failures=<n>` is the middle ground: keep going past a failure, but stop
 * once `n` stages have failed — enough to report several distinct problems
 * without paying for the whole suite and sweep behind them. All three answer the
 * same question (how far to go), so at most one may be asked for, and a capped
 * run does not take the CI default. A run that stops names the stages it did not
 * reach, in the report and on the summary line, rather than leaving them looking
 * passed. Either way the same one-line verdict —
 * `ci: verdict — N passed, N failed, N skipped, N unchanged, N reused, N excluded (N selected)`
 * — brackets the log: the opening line projects the run (nothing has passed or
 * failed yet, but change detection and the result cache already know which stages
 * it will not run) and the closing line reports what it did, so a long log carries
 * the counts at both ends without scrolling for them. It is a projection, not a
 * promise — a run that stops early turns stages the opener listed as `unchanged`
 * or `reused` into `skipped`. Under `--json`
 * both lines go to stderr with the rest of the progress, keeping stdout the report
 * alone. Pass `--from=<name>` to
 * start at that stage and keep the rest — the resume path after fixing what a
 * stopped run reported, since replaying the cheap stages it already passed buys
 * nothing. Pass `--only=<name>` (comma-separated) to run a subset — useful while
 * iterating, since the suite and the sweep together are minutes long. A name
 * that matches no stage is an error naming the offending token, not a silent
 * no-op, so a typo cannot narrow the gate without anyone noticing; `--from` and
 * `--only` are kept apart rather than combined, since each already answers where
 * to start and a run given both would have to guess which one wins.
 *
 * Pass `--github-annotations` to print GitHub Actions workflow commands for the
 * failing (and warning) details that name a file and line, so the first failure
 * lands on the diff instead of only in the log: GitHub renders
 * `::error file=…,line=…::…` inline, and a type error, a lint finding, a failed
 * test or a surviving mutant all carry the location to point at. The same list
 * is always available to any consumer as the `annotations` array in the `--json`
 * report, so the two are kept apart rather than combined — both spell their
 * output on stdout, and a run given both would have one corrupt the other. Any
 * name a report would publish — a detail's file, a survivor's path, an
 * annotation's `file=` — is redacted when it looks like a secret (`.env*`, `*.pem`,
 * a credentials file), because the report is uploaded and pasted where a reader
 * cannot un-see it; the count and the line are kept, only the name goes. See
 * `.freebuff/redact.mjs` for the one definition of what counts as secret.
 *
 * Pass `--changed-only` to skip a stage no changed file feeds — the minutes-long
 * sweep when no route or route test moved, say — using the working-tree diff
 * against `--diff-base` (default `HEAD`) plus the untracked files. It is
 * deliberately conservative: an unreadable diff, an empty change set, or any
 * build or config file falls back to running every stage. The flag can only skip
 * when it positively knows something changed that no stage reads; it can never
 * fail to run a stage the change could plausibly affect.
 *
 * ## Recovering what a killed run left behind
 *
 * The three tree-editing stages rewrite the working tree one file at a time, holding
 * `.freebuff/.mutation-lock.json` while they do (see `.freebuff/mutation-lock.mjs`). A
 * SIGKILL runs no handler, so a weakened coverage script or a fail-open route can outlive
 * the run that made it — and the only thing that puts it back is the check that owns the
 * lock running again, which `--skip`, `--only`, `--from` and `--changed-only` can each
 * decide not to do. Worse, the mutation stages run last, so every stage before them would
 * measure the mutated file as the real thing. So the run heals *before* its stages: a
 * stale lock is restored, one whose pid is alive is described rather than fought (another
 * check is editing this tree right now), and either way the recovery is reported — on the
 * owning stage's row when that stage runs, and otherwise as the run's own warning in the
 * log, in the `recovered` array of the `--json` report, and as a `::warning` annotation.
 * The one exception is not a warning and not a heal: a file that a later edit left
 * *carrying* the mutation rather than replacing it — the lock records the splice, so
 * recovery can tell the two apart — is a file no stage may measure, and the run refuses
 * there, before the first stage, with the recovery in its `--json` payload (`abort`).
 * The reporting flags stand outside it: `--dry-run`, `--explain-cache`, `--status` and
 * `--stages` each promise to run no stage — the first two report the lock rather than heal
 * it, `--status` answers from the pin alone, and `--stages` reads the stage declarations (it
 * writes nothing either, but for `--stages=write`, which rewrites the two generated copies of
 * the stage order and nothing else).
 *
 * The lock is only half the story, because it is only written while a *check* is running.
 * A file loosened by hand — or by a run killed so early, or so completely, that the lock
 * never got written — has no lock to recover from, and would otherwise have to be noticed
 * by eye. The `drift` stage above is the alarm for exactly that: it compares every file the
 * build's verdict is made of — this runner included — to the hash recorded in
 * `.freebuff/gate-hashes.mjs` and fails when one is not the file that was pinned. The two
 * are complementary and both needed — the recovery puts back what a run left, the alarm
 * catches what no run made.
 *
 * ## The result cache
 *
 * Iterating means running the gate again after changing one file, and the suite
 * and the sweep are the minutes-long part of it. So a stage that passes records
 * the digest of everything it reads — the files its `inputs` name (globs, or the
 * alarm's own watch rules, for the drift stage), plus the build and config files in
 * `GLOBAL_FORCE` — and a later run that finds the same
 * digest does not run it again: it is *reused*. The key is content, not a
 * timestamp, so it means the same thing on any machine and a bare `touch`
 * invalidates nothing; a miss — any input changed, or no entry at all — means the
 * stage runs. Only passes are ever cached: a failure is what you are iterating on,
 * so it always runs again with fresh evidence. A reused stage is named, not quietly
 * counted as a pass — `ci: <stage> reused — …`, its own `reused` array in the
 * report, and its own count in the verdict. The cache lives in the git-ignored
 * `.ci/cache.json` (or `CI_CACHE_FILE`), so it is a local convenience or a CI
 * job's `actions/cache` entry rather than anything committed, and a fresh checkout
 * starts cold. A pass is trusted for a week and then *expired*: a content digest
 * cannot see a dependency that drifted outside a stage's globs, so the stage runs
 * again and records afresh, and the stages that expired are named — up front
 * (`ci: re-running … — recorded pass expired`) and on each stage's own line — so a
 * run that looks like it ought to have reused one says why it did not. Add
 * `--cache-ttl=<duration>` to move that line (`30m`, `12h`, `7d`; `0` removes the
 * cap entirely). Pass `--no-cache` to neither read nor write the cache at all.
 *
 * **The cache may answer for every stage that does not edit the working tree.** The three
 * that do — the tree-editing stages, whose `editsTree` in `.freebuff/gate-drift.mjs` is the
 * `check` name their lock carries — are never reused, because their pass vouches for the tree
 * they *leave behind* rather
 * than for the inputs they were handed: the debris a killed run leaves (a weakened file
 * and its lock) is byte-identical the next time the same mutation is applied, which is
 * exactly the shape a recorded digest would call unchanged, and reusing such an entry
 * would report the gate as checked while leaving it weakened — with only that stage able
 * to put it back. Everything else is cacheable on the ordinary rule above, and a stage
 * is cacheable by default: `editsTree` is the one place a stage says it may not be, so a
 * new tree-editing check joins by naming its lock's `check` and nothing else.
 *
 * **A pass is recorded for the tree it leaves**, which is the other half of that. Each
 * turn of the loop reads the stage's key twice — immediately before the pass and
 * immediately after it — and the entry holds both: `hash`, the tree the pass left, is what
 * a later run is compared against, and `startedHash` is the tree it started from, kept so
 * a reader can see the two differ. For every stage the cache answers for they are the same
 * file contents, so the distinction costs nothing — until it is the only honest answer.
 * A check that restored a killed run's lock (see the section above) edits the very files
 * its key covers, and a stage that rewrites its own inputs, a formatter say, would
 * otherwise be reused against a tree its pass never produced. The key the *run decided*
 * against is a third reading, taken up front and before any healing; it is deliberately
 * not what gets recorded, and a healing run re-runs rather than reuses, which is the safe
 * direction.
 *
 * **An input that vanishes mid-run is a change, not a crash**, which is the same
 * asymmetry read from the other side. A stage can remove a file it reads — scratch output
 * it cleans up, a resume that skipped the stage which wrote it — and anything else can
 * take one out from under the run. Such a path must not throw out of the key: it digests
 * as *absent* (see `fileDigest`), so the key moves, which is the honest reading of a tree
 * that no longer holds what the last pass was recorded against, and the stage's row names
 * the input that went rather than the run dying over a file it was only fingerprinting.
 * The shape is versioned (`CACHE_VERSION`), so an entry written before the key
 * meant this is read as a cold cache instead of being misread as a warm one.
 *
 * When a stage that looked reusable ran anyway, `--explain-cache` says why: it
 * reports the decision the run is about to take for every selected stage — `reuse`,
 * `run` (with the reason: no recorded pass, a digest that moved, the cache off),
 * `expired`, or `unchanged` — with the files behind each key and how recently they
 * were touched, then exits without running anything, so the question costs nothing
 * to answer. It reads the same decision record the run reads, so it cannot describe
 * behavior the runner would not take; `--json` gives the same report as an object.
 * Every file behind a key is named *with the input that put it there*, and the two
 * scales that answers at are deliberately different: a stage with a handful of files
 * lists the files (`next.config.mjs ← next.config.*`), while one with more than a line
 * will carry lists its inputs and how many files each contributed — which is what makes
 * the drift stage's explanation an answer rather than a count, its inputs being the
 * alarm's watch rules, each of them a gate family. Beside the stages, `GLOBAL_FORCE` is
 * resolved once — the files behind *every* key, which no per-stage list can show — so the
 * report answers "what is behind this key?" in full rather than only in the part a stage
 * declares for itself. The same pairing is read the other way too: each selected stage also
 * carries the watch-rule *families* its key already holds a member of, with the member that
 * earned the pairing — the sibling the coverage refusal names for an uncovered file, asked
 * of a stage by name instead, so it is reachable on a tree where nothing is failing.
 * Secret-looking inputs — `.env*`,
 * `*.pem`, credential files — become a `<redacted>` marker in both forms, so the
 * explanation can be pasted into a pull request or a log without publishing a name that
 * was meant to stay out of the repo; they are redacted one entry at a time rather than
 * collapsed, so the pairing survives, and the honest count of files behind the key is
 * kept beside it. A file wrongly hidden costs a reader one lookup, while a name wrongly
 * shown is a leak, so the matcher errs toward hiding. `--dry-run` stays the shorter
 * report — the selection alone — and the two are kept apart rather than combined,
 * since each already answers "what will happen without running", and a run given both
 * would have to guess which one won.
 *
 * Pass `--skip=<name>` to leave a stage out of whatever selection the other
 * flags produced. It exists for a stage that cannot hold in the environment
 * running the gate rather than because the code is suspect: the `nightly.yml`
 * job runs the whole gate on a hosted runner, where the preview preflight could
 * never pass — it needs a live dev server and a `.env.local` on disk — so that
 * job excludes it. Because it subtracts from the selection it composes with
 * `--only` and `--from`; a name that matches no stage is refused like a `--only`
 * typo, an empty list is refused, and a `--skip` that would leave nothing to run
 * is refused too. The stages it removed are named (`ci: --skip excludes: …` and
 * the report's `excluded` array), so a green run never reads as a full pass.
 *
 * ## Flags
 *
 *   `--only=<name>[,<name>…]`                 → run only these stages
 *   `--skip=<name>[,<name>…]`                 → leave these stages out of the run
 *   `--from=<name>`                           → start at this stage, keep the rest
 *   `--keep-going`                            → run every stage, not just until the first failure (default in CI)
 *   `--fail-fast`                             → stop at the first failure even in CI
 *   `--max-failures=<n>`                      → stop after `n` failing stages
 *   `--dry-run`                               → print the selected stages, run nothing
 *   `--explain-cache`                         → report why each stage will run or be reused, then exit (secret-looking inputs redacted)
 *   `--status`                                → the pin's state, and which stage's key is behind each pinned file, then exit
 *   `--status --watch=<file-or-rule>`         → read that candidate stage input against the pin's families, answering which half-held family it would close, then exit
 *   `--stages`                                → print the stage order from the declarations, with any copy that disagrees, then exit
 *   `--stages=check`                          → the stage-order audit alone: exit 1 on a disagreement
 *   `--stages=write`                          → regenerate the two marked copies of the order
 *   `--stages=json`                           → the order and its count, for a machine
 *   `--json`                                  → one machine-readable report on stdout
 *   `--github-annotations`                    → print `::error`/`::warning` lines for CI
 *   `--changed-only`                          → skip stages no changed file feeds
 *   `--diff-base=<ref>`                       → diff against this ref (default `HEAD`)
 *   `--no-cache`                              → ignore (and do not write) the result cache
 *   `--cache-ttl=<duration>`                  → trust a recorded pass for this long (default `7d`, `0` for no cap)
 *   `--no-record`                             → leave the runbook's dated bullet unwritten (default: the close appends one, marking failures `failed`)
 *
 * Forwarded to the stage that owns them, unchanged:
 *   `--port <n>`, `--timeout <ms>`            → preflight
 *   `--file=<substr>`, `--no-fail-open`       → mutation
 *   `--limit=<n>`                             → mutation, mutation-preflight
 *
 * `--limit` is the one flag two stages read, so a slice taken with it is taken
 * for whichever of them the run selected — the two mutation sets are different
 * sizes (nineteen preflight branches beside the route sweep) and a limit that
 * only one of them honoured would silently sweep the other whole.
 *
 * ## Test seams
 *
 * Each stage's script is overridable by env var, so a test can drive any stage
 * against a stub without the real tool: `CI_TYPECHECK_SCRIPT`, `CI_RUNBOOK_SCRIPT`,
 * `CI_LINT_SCRIPT`, `CI_TEST_SCRIPT`, `CI_PREFLIGHT_SCRIPT`, `CI_DRIFT_SCRIPT`,
 * `CI_MUTATION_COVERAGE_SCRIPT`, `CI_MUTATION_PREFLIGHT_SCRIPT`, `CI_MUTATION_SCRIPT`.
 * See `src/test/ci-runner.test.ts`.
 *
 * Usage:
 *   npm run ci
 *   npm run ci -- --only=typecheck,test
 *   npm run ci -- --only=mutation --file=jobs --limit=20
 *   npm run ci -- --from=test       # resume where the last red run stopped
 *   npm run ci -- --keep-going
 *   npm run ci -- --dry-run
 *   npm run ci -- --json            # one report object on stdout for a CI system
 *   npm run ci -- --github-annotations   # inline annotations on a GitHub diff
 *   npm run ci -- --changed-only     # only the stages the working tree feeds
 *   npm run ci -- --skip=preflight   # the whole gate minus a stage this host cannot run
 *   npm run ci -- --max-failures=3   # report up to three problems, then stop
 *   npm run ci -- --no-cache         # ignore this tree's recorded passes and re-run
 *   npm run ci -- --cache-ttl=30m    # distrust a recorded pass older than half an hour
 *   npm run ci -- --explain-cache    # why each stage will run or be reused, then stop
 *   npm run ci -- --status           # where the pin stands, and the stage key behind each of its files
 *   npm run ci -- --stages           # the stage order, and every copy of it that disagrees
 *   npm run stages:check             # the same audit, alone
 *   npm run stages:lint              # the same audit over docs, workflows and the tree's own comments
 *   npm run stages:write             # regenerate the marked lines and the stage-order snapshot
 */
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { redactInput, redactInputs, redactText } from "./redact.mjs";
import { fileURLToPath } from "node:url";
// The collect-time reporter leaves its soft-gate warnings in a sidecar whose
// name and shape this module owns, so the two sides cannot drift apart.
import { SOFT_GATE_FILE, softGateDetails } from "./collect-budget-soft.mjs";
// The run report the reporter leaves. Its loose baselines are only annotated here —
// a single run never fails on one, because one reading is not evidence enough — so
// the repeated collect session's `npm run collect:stale` is what gates on them. The
// same file carries the measurement the collect-budget run summary publishes.
import { RUN_REPORT_FILE, parseRunReport, staleGateDetails } from "./collect-run.mjs";
// The lock the tree-editing checks hold while they rewrite a file, and the recovery
// that puts it back. This run heals the tree before its stages measure it, and one of
// those checks may not be among the stages at all.
import { LOCK_PATH, recoverInterruptedRun } from "./mutation-lock.mjs";
// The import closure of a gate script: the `.mjs` modules a stage's script loads,
// read out of the sources. Folded into each script-backed stage's key files below,
// so a helper a gate picks up re-keys that stage without anybody restating it in a
// second list — the same derive-don't-duplicate the stage order already runs on.
import { importClosure } from "./import-closure.mjs";
// The drift alarm, for everything this runner shares with it: the watch rules the pin is declared
// by, the stage list whose keys the family readings are taken over, and the matching and owner
// readings themselves. The drift stage below re-keys on the watch rules *themselves*, so a family
// added to them widens the stage's inputs in the same edit — never a re-pin the runner has not been
// told about — and the stage list lives there too, so the stage that owns a family is one
// declaration for the run's own report and for the alarm's diff.
import {
  DEFAULT_WATCHES,
  PIN_SELF_CHECK_STAGE,
  STAGE_NAMES,
  STAGE_TABLE,
  stageDeclaration,
  familyOwners,
  globMatch,
  inputLabel,
  matchesInput,
  manifestPath,
  ownerClause,
  compare,
  pin,
  pinFamilyRows,
  readManifest,
  ruleFor,
  stageDeclarationGaps,
} from "./gate-drift.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const here = (name) => fileURLToPath(new URL(name, import.meta.url));

/**
 * `--json` swaps the human report for a machine-readable one: progress moves to
 * stderr and stdout carries a single object — the overall gate, each stage's
 * pass/fail and summary, and the failing stage names — so a CI system can read
 * the result without parsing the rendered log. The exit code is unchanged.
 */
const JSON_OUTPUT = process.argv.includes("--json");

/**
 * Writes `text` to stdout synchronously — all of it, before returning.
 *
 * `process.stdout.write` queues through libuv, and `process.exit` does not wait
 * for a queued pipe write: on POSIX anything the pipe will not take in one go
 * (64KB by default) is dropped, which is how a runner reading a `--json` report
 * through a pipe got a document cut mid-string. `fs.writeSync` is finished when
 * it returns, on every platform, so a report followed by `process.exit` reaches
 * its reader whole.
 */
function writeStdoutSync(text) {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += writeSync(1, buffer, offset, buffer.length - offset);
    } catch (error) {
      // A full pipe retries, an interrupted write retries, and a reader that
      // closed the far end has heard enough — none of them are worth crashing on.
      if (error.code === "EPIPE") return;
      if (error.code !== "EAGAIN" && error.code !== "EINTR") throw error;
    }
  }
}

/**
 * `--github-annotations` prints GitHub Actions workflow commands for the details
 * that name a location, so the failure is annotated inline rather than only in
 * the log. It owns stdout the way `--json` does, so the two are mutually
 * exclusive (see the check beside `abort`).
 */
const GITHUB_ANNOTATIONS = process.argv.includes("--github-annotations");

/**
 * Where the runbook's dated bullet goes. A run appends one as its last act — a
 * failed run marking the failure `failed` (so the text records a red as a red,
 * exactly as the first four recorded here do by hand) — and does not duplicate:
 * a bullet whose date and verdict both already sit in the file is left alone, so
 * re-running a selection, or reading a rerun's log, does not write a second copy
 * of the same run. `CI_RECORD_RUNBOOK_FILE` points it elsewhere (the seam the
 * tests use so a run never edits the developer's own runbook), and `--no-record`
 * declines the whole step — the flag a selection slice, or a run whose caller
 * writes its own record, passes.
 */
const RECORD_RUNBOOK_FILE = process.env.CI_RECORD_RUNBOOK_FILE
  ? isAbsolute(process.env.CI_RECORD_RUNBOOK_FILE)
    ? process.env.CI_RECORD_RUNBOOK_FILE
    : join(ROOT, process.env.CI_RECORD_RUNBOOK_FILE)
  : join(ROOT, ".freebuff", "run.md");

/**
 * Where the rendered-links guard leaves its coverage stamp: one line, written
 * by the suite's own close-out while the test stage runs, cleared with the
 * stage's other artifacts at each attempt, and read at the close — folded into
 * the runbook bullet, carried in the `--json` payload as `coverageStamp`, and
 * rendered on the nightly summary. The env override is the same seam
 * `CI_RECORD_RUNBOOK_FILE` is — the tests' way to point a run at scratch rather
 * than at the tree's real stamp — and the default is a dot-file beside the
 * reporter's, transient and input to no gate.
 */
const RENDERED_LINKS_COVERAGE_FILE = process.env.CI_COVERAGE_STAMP_FILE
  ? isAbsolute(process.env.CI_COVERAGE_STAMP_FILE)
    ? process.env.CI_COVERAGE_STAMP_FILE
    : join(ROOT, process.env.CI_COVERAGE_STAMP_FILE)
  : join(ROOT, ".freebuff", ".rendered-links-coverage.txt");

/**
 * The runbook's closing bullet, appended once per run: the date and the closing
 * verdict's counts, the stages that failed when the run is red, the per-stage
 * marks for what ran, and the day's suspects when the run had any. A failed run
 * marks the failure `failed` and names its stages, so the text records a red as
 * a red exactly as the runs recorded here by hand do; the counts are the same
 * numbers `verdictLine` prints. Fail-silent by design — an unwritable runbook is
 * a note on stderr, never a verdict flipped or an exit code changed — and the
 * dedupe asks about the *whole* bullet, not its heading: the heading is the date,
 * the verdict's counts, and the outcome, and two runs can share all three while
 * recording different facts below it — a stamp one close measured and the other
 * never carried, marks from a different stage set. A heading-only check is how a
 * genuine run's record gets swallowed by an identical-looking earlier bullet, so
 * only a byte-identical record dedupes, and a dedupe is logged the way a failed
 * append is: a reader of the log tells "the record already sat there" from
 * "nothing was recorded at all".
 *
 * Answers what the close did, so the `--json` payload can carry it: `written`
 * when this run appended the bullet, `deduped` when the file already held it,
 * `declined` under `--no-record`, `slice` when the run was a selection or a
 * changed-only sweep rather than the whole gate, and `failed` when the append
 * itself failed. The slice rule is the runbook's own convention stated as code:
 * one dated bullet per full-gate run — the four this file records by hand are
 * whole `npm run ci` passes — so a `--only` probe, a `--skip` reduction, a
 * `--changed-only` sweep or a resumed `--from` tail records nothing; the verdicts
 * those runs close are diagnostics, and recording them would fill the runbook
 * with one bullet per development step rather than one per measured gate.
 */
function recordRunBullet() {
  if (process.argv.includes("--no-record")) return "declined";
  if (selected.length !== STAGES.length) return "slice";
  const date = new Date().toISOString().slice(0, 10);
  const verdict = finalVerdict().replace("ci: verdict — ", "");
  const outcome =
    failed.length === 0
      ? "all stages passed"
      : `failed: ${failed.join(", ")}`;
  const head = `- **${date} — ci verdict: ${verdict}; ${outcome}.**`;
  const marks = results
    .map(({ stage, result }) => `${stage.label} ${result.pass ? "PASS" : "FAIL"}`)
    .join(", ");
  // The rendered-links guard's stamp, when the test stage left one, rides the
  // bullet verbatim: what the guard audited is part of what a full gate
  // measured, and the dated bullets are where that reading accrues. Absent —
  // a stubbed test stage, a stage that died before the suite ran — the bullet
  // simply omits the line: the stamp is a reading, never a floor, so its
  // absence is not a failure of the close.
  const coverage = renderedLinksCoverage ?? readRenderedLinksCoverage(RENDERED_LINKS_COVERAGE_FILE);
  const lines = [
    `${head} ${marks}.`,
    ...(coverage ? [`  ${coverage}.`] : []),
    ...(pinSuspects.length > 0
      ? [
          `  Suspects: ${pinSuspects.map((suspect) => `${suspect.path} (${suspect.how})`).join(", ")}.`,
        ]
      : []),
  ];
  try {
    if (!existsSync(RECORD_RUNBOOK_FILE)) {
      mkdirSync(dirname(RECORD_RUNBOOK_FILE), { recursive: true });
    }
    const existing = existsSync(RECORD_RUNBOOK_FILE)
      ? readFileSync(RECORD_RUNBOOK_FILE, "utf8")
      : "";
    // The whole bullet — heading, marks, stamp line, suspects — is what dedupes,
    // not the heading: an earlier bullet can share this run's date, verdict, and
    // outcome while differing below the heading, and swallowing this run for the
    // resemblance would erase the one record the close exists to keep.
    const bullet = lines.join("\n");
    if (existing.includes(bullet)) {
      progress(
        `ci: nothing appended — ${relative(ROOT, RECORD_RUNBOOK_FILE)} already holds this run's bullet.`,
      );
      return "deduped";
    }
    appendFileSync(RECORD_RUNBOOK_FILE, `\n${bullet}\n`, "utf8");
    return "written";
  } catch (error) {
    console.error(
      `ci: could not record the run in ${relative(ROOT, RECORD_RUNBOOK_FILE)} — ${error.message}`,
    );
    return "failed";
  }
}

/**
 * The script a stage runs, unless an env override names another. Every stage
 * spawns a process, so there is nothing to inject into; a test needs to point a
 * stage at a stub that emits a crafted result (a payload, a type error, a test
 * report) without running the real tool.
 *
 * Each *gate* stage names its own override and its own default path in
 * `.freebuff/gate-drift.mjs` (`STAGE_TABLE`, the `script` field), so a test stubs
 * one without touching the others and there is no second place the two can
 * disagree: `CI_RUNBOOK_SCRIPT`, `CI_LINT_SCRIPT`, `CI_PREFLIGHT_SCRIPT`,
 * `CI_DRIFT_SCRIPT`, `CI_MUTATION_COVERAGE_SCRIPT`, `CI_MUTATION_PREFLIGHT_SCRIPT`,
 * `CI_MUTATION_SCRIPT`. The two stages that run a published tool instead take
 * their override here, beside the invocation it stands in for:
 * `CI_TYPECHECK_SCRIPT` and `CI_TEST_SCRIPT`.
 *
 * An absolute path (the bundled tools under `node_modules`, or a temp stub) is
 * taken as-is; a relative one resolves beside this file.
 */
const stageScript = (envName, fallback) => {
  const resolve = (path) => (isAbsolute(path) ? path : here(path));
  const override = process.env[envName];
  return resolve(override ?? fallback);
};

/** Reads a flag that may be written `--flag value` or `--flag=value`. */
function option(name) {
  const joined = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Whether a CI environment is present. `CI=true` is the convention nearly every
 * system follows (GitHub Actions also sets `GITHUB_ACTIONS`), and the other
 * markers cover the ones that do not. A falsey value (`""`, `"0"`, `"false"`)
 * counts as unset, so `CI=false npm run ci` stays a local, fail-fast run.
 */
const CI_MARKERS = [
  "CI",
  "CONTINUOUS_INTEGRATION",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
];

function inCi() {
  return CI_MARKERS.some((name) => {
    const value = process.env[name];
    return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
  });
}

/** Rebuilds a `--flag=value` spelling (the sweep's form) from either spelling. */
function valueFlag(source) {
  const value = option(source);
  return value === undefined ? [] : [`${source}=${value}`];
}

/** Runs a git command for a change-set read, answering `null` on any failure. */
function gitOutput(args) {
  const child = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return child.error || child.status !== 0 ? null : child.stdout;
}

/**
 * The paths this run treats as changed, or `null` when it cannot tell.
 *
 * `CI_CHANGED_FILES` (newline-separated) overrides the git read, so a CI system
 * can hand over its pull request's file list and a test can drive the skip with
 * no repository at all. Otherwise it is the working-tree diff against
 * `--diff-base` (default `HEAD`) plus the untracked files, so a new file counts
 * as a change; an unborn `HEAD` or a missing git answers `null`, and the caller
 * runs everything rather than guessing.
 */
function changedFiles() {
  const fromEnv = process.env.CI_CHANGED_FILES;
  if (fromEnv !== undefined) {
    return fromEnv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  const base = option("--diff-base") ?? "HEAD";
  const tracked = gitOutput(["diff", "--name-only", base]);
  const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) return null;
  return [...tracked.split("\n"), ...untracked.split("\n")]
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A short tail of a child's output, for a failure we could not parse. */
function outputTail(child, lines = 15) {
  const text = `${child.stdout ?? ""}${child.stderr ?? ""}`.trim();
  if (!text) return [];
  return [text.split(/\r?\n/).slice(-lines).join("\n")];
}

/** The project-relative, forward-slashed path a report names. */
const rel = (path) => relative(ROOT, path ?? "").split("\\").join("/");

/**
 * The matching and owner readings — `globMatch` and the `matchesInput` over it, the `inputLabel` that
 * prints a watch rule, the `sweepInput` that tells a scoped key from a whole-tree one, and the
 * `familyOwners`/`ownerClause` pair built from them — now live in `.freebuff/gate-drift.mjs` and are
 * imported above. They moved because the alarm names the stage that owns a family in its own report,
 * and the two have to answer "which key covers this file?" and "which stage should own this family?"
 * identically: one implementation is what makes that so rather than two that agree today. What stays
 * here is about this runner's cache keys rather than about the reading.
 */

/**
 * One input as the text a cache key is built from: a glob is itself, a watch rule is its two
 * fields. A widened rule has to move the key, and `JSON.stringify` would do it too — this
 * just keeps the glob-only stages' keys the same text earlier runs recorded them under.
 */
function inputText(input) {
  return typeof input === "string" ? input : `${input.dir}\u0000${input.pattern}`;
}

/**
 * A stage's entry in the alarm's stage table as source — every field it declares, with `file`
 * appended to `inputs` — so the coverage refusal's repair is a line to paste rather than a rule to
 * decode.
 */
/**
 * One stage's declaration as a line to paste, with the uncovered file appended to its `inputs`.
 *
 * Rendered in the shape the table uses — the stage's own fields in the table's own order: `name`,
 * `label`, `editsTree` and `script` when the stage carries them, then `inputs` — so the line is the
 * *whole* entry. A fragment would be worse than nothing here: a reader pasting `{ name, inputs }`
 * over an entry would drop the label every report calls the stage and the script the runner spawns,
 * and the gate would go quiet in a way no comment asked for. A literal path is a quoted string and a
 * watch rule is the `{ dir, pattern }` object it is, both through `JSON.stringify` so the escapes
 * survive a round trip into the source. It reads the *resolved* inputs — the array the run keys on —
 * so a stage that spreads `DEFAULT_WATCHES` renders the rules themselves, and the file is appended
 * rather than sorted in because the declaration's order is the stage's own and not this function's
 * to rearrange. The declaration lives in `.freebuff/gate-drift.mjs` — the alarm reads the same table
 * to name the stage that owns a family — so that is where the line goes.
 */
function stageDeclarationLine(stage, file) {
  const entries = [...(stage.inputs ?? []), file].map((input) =>
    typeof input === "string"
      ? JSON.stringify(input)
      : `{ dir: ${JSON.stringify(input.dir)}, pattern: ${JSON.stringify(input.pattern)} }`,
  );
  const fields = [`name: ${JSON.stringify(stage.name)}`];
  if (stage.label !== undefined) fields.push(`label: ${JSON.stringify(stage.label)}`);
  if (stage.editsTree !== undefined) fields.push(`editsTree: ${JSON.stringify(stage.editsTree)}`);
  if (stage.script !== undefined) {
    fields.push(
      `script: { env: ${JSON.stringify(stage.script.env)}, path: ${JSON.stringify(stage.script.path)} }`,
    );
  }
  fields.push(`inputs: [${entries.join(", ")}]`);
  return `{ ${fields.join(", ")} },`;
}

/**
 * A set of drift findings grouped by the watch rule that keys each one: the families, scariest
 * first, each with its members in the finding order, and the paths no rule names any more kept
 * apart.
 *
 * The drift stage's `inputs` *are* the pin's watch rules (see the stage below), so grouping the
 * findings by the input that names each path is the stage describing itself: which of the rules it
 * keys on moved, and how much of each. It is the same reading `matchesInput` gives the stage's own
 * key, and the same tie-break `ruleOwners` uses when two rules name one file — the first in
 * declaration order owns it — so the label a red run prints cannot disagree with the one
 * `--status` prints beside that file.
 *
 * The rules it groups by are the ones the *pin in force* records (`pinWatches`), not
 * `DEFAULT_WATCHES`: for the committed pin the two are the same list, and for the pin a
 * `GATE_HASHES_FILE` substitution names they are not — and there the recorded rules are the ones
 * that decide what is watched, so a family is named by the rule that pinned it. The alarm reads the
 * same pair in `withFamilies`, which is what keeps the two folds from disagreeing about which
 * family a path belongs to; and the exposure the order comes from (`pinFamilies`) is a reading of
 * that same resolve, so grouping against anything else would silently drop the ordering to
 * moved-count for every family whose label did not match.
 *
 * The label is asked of the *paths* rather than of a scan of the tree, on purpose: a `gone` finding
 * names a file that is no longer there to resolve, and the family a reader wants from it is the one
 * that held it, not the silence a scan of the current tree would give. A pinned path no rule names
 * any more is counted apart rather than folded into a family that does not hold it — that is a
 * different fix (the rule to re-check, not the tree to re-pin) and the reader has to be told which
 * one it is.
 *
 * **The lead is exposure, not volume**, and that is the whole reading: a family the pin's own view
 * marks at risk — one with a member behind no stage's key, or one no stage but the pin's `drift`
 * re-key holds whole — is the family whose next change nothing below will notice, so it is exactly
 * the family a red run should put first, whether one of its files moved or forty. `riskByRule` is
 * the pin's `families` view (`familyCoverage`) keyed by rule; a family it does not hold has no row
 * — the pin says nothing about a rule that pins nothing — and reads with the ordinary ones. The
 * order is the coverage view's own (unkeyed, then exposed, then the rule's name), with the count
 * after it as the tie-break a run that is green-and-flat still needs, so `--status` and a red drift
 * cannot disagree about which family is the scariest.
 *
 * One grouping, read two ways — as the summary clause (`movedFamiliesClause`) and as the headings
 * the stage's details fold under (`movedFamilyDetails`) — so the sentence and the rows cannot
 * disagree about which family a finding belongs to, how many of its members moved, or which leads.
 */
function movedFamilyGroups(findings, riskByRule = null, watches = DEFAULT_WATCHES) {
  const byLabel = new Map();
  const unnamed = [];
  for (const finding of findings) {
    const rule = ruleFor(finding.path ?? "", watches);
    if (rule === undefined) {
      unnamed.push(finding);
      continue;
    }
    const label = inputLabel(rule);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(finding);
  }
  const families = [...byLabel]
    .map(([label, members]) => ({ label, members }))
    .sort((left, right) => {
      const leftRisk = riskByRule?.get(left.label) ?? null;
      const rightRisk = riskByRule?.get(right.label) ?? null;
      return (
        (rightRisk?.unkeyed ?? 0) - (leftRisk?.unkeyed ?? 0) ||
        Number(rightRisk?.exposed ?? false) - Number(leftRisk?.exposed ?? false) ||
        right.members.length - left.members.length ||
        left.label.localeCompare(right.label)
      );
    });
  return { families, unnamed };
}

/**
 * The grouped findings as one clause for the stage's summary line: `2 watch families moved:
 * .freebuff/^coverage-.*\.mjs$ (2), .github/workflows/^.*\.ya?ml$ (1), 1 file(s) no watch rule
 * names`.
 *
 * The count first and then *where* it came from: a whole-tree re-pin leaves a long list of paths
 * behind, and the family is the part a reader can act on — it is the rule to re-check, which a list
 * of paths does not say. Only the unnamed bucket, with no family to lead with, reads as its own
 * count rather than a `0 watch families moved` that would be a claim about the pin.
 */
function movedFamiliesClause({ families, unnamed }) {
  const parts = families.map(({ label, members }) => `${label} (${members.length})`);
  if (unnamed.length > 0) parts.push(`${unnamed.length} file(s) no watch rule names`);
  if (families.length === 0) return parts.join(", ");
  const noun = families.length === 1 ? "watch family" : "watch families";
  return `${families.length} ${noun} moved: ${parts.join(", ")}`;
}

/**
 * One heading detail: a row that names the group the rows under it belong to rather than a finding
 * of its own. It carries the label as its `detail`, names no path (`name` is empty, which every
 * renderer already prints as the label alone), and is flagged `heading: true` — the one field a
 * consumer reads to tell it from a finding, most importantly the annotations, which must skip it
 * rather than put a fileless `::error` on the diff for every group. Built in one place so no
 * stage can define a heading the consumers do not recognise.
 */
function headingDetail(mark, label) {
  return { mark, name: "", detail: label, heading: true };
}

/**
 * Ordered groups of details folded into one `details` array: each group's heading, then its rows,
 * group after group. `groups` is `[{ mark, label, rows }]` — the caller decides the grouping and
 * builds both the heading's text and the rows, so the same fold serves any stage that reports many
 * rows a reader thinks of in groups: the drift stage pairs each watch rule with the findings that
 * moved under it, the lint stage pairs each file with the findings in it. This function owns the
 * one thing every consumer depends on — that a heading is a `headingDetail` (flagged, pathless) and
 * that the rows are passed through untouched — and the run's `redactResult`, the `--json` stage
 * mapping and `sanitizeReport` all carry the flag through, so the fold reaches the report a job
 * reads and the run page, not only the log.
 */
function foldedDetails(groups) {
  return groups.flatMap(({ mark, label, rows }) => [headingDetail(mark, label), ...rows]);
}

/**
 * The drift stage's grouping as `details`: each family's finding rows folded under a heading that
 * names the rule, how many of its members moved, and the stage that should own it, then the paths
 * no rule names under their own heading.
 *
 * The fold is what makes a whole-tree re-pin readable — a handful of families rather than forty
 * rows — and the labels and counts are the ones the summary clause prints, so the heading and the
 * sentence above it line up. The heading carries the repair as well as the grouping: which stage
 * measures the family, or which stage to extend when none does (`ownerClause`), so a reader who
 * follows the leading family — the one nothing below measures — is told what to do about it rather
 * than only that it moved. Each file row keeps its `kind` mark, so the change is still named one
 * file at a time.
 */
function movedFamilyDetails({ families, unnamed }, slug, ownerByRule = null) {
  const fileRow = (item) => ({
    mark: slug[item.kind] ?? "DRIFT",
    name: item.path,
    detail: item.detail,
    location: { file: item.path },
    ...(item.diff ? { diff: item.diff } : {}),
  });
  const groups = families.map(({ label, members }) => ({
    mark: "FAMILY",
    label: `${label} (${members.length})${ownerClause(label, ownerByRule)}`,
    rows: members.map(fileRow),
  }));
  if (unnamed.length > 0) {
    groups.push({
      mark: "UNNAMED",
      label: `${unnamed.length} file(s) no watch rule names`,
      rows: unnamed.map(fileRow),
    });
  }
  return foldedDetails(groups);
}

// --- Stage 1: typecheck -----------------------------------------------------

function runTypecheck() {
  const child = spawnSync(
    process.execPath,
    [stageScript("CI_TYPECHECK_SCRIPT", join(ROOT, "node_modules", "typescript", "bin", "tsc")), "--noEmit"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const text = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const errors = text.split(/\r?\n/).filter((line) => /\berror TS\d+/.test(line));
  const pass = child.status === 0 && errors.length === 0;
  return {
    pass,
    summary: pass ? "0 type error(s)" : `${errors.length} type error(s)`,
    details: errors.slice(0, 12).map((line) => {
      const text = line.trim();
      // `src/app/file.ts(1,2): error TS…` — pull the location out so an
      // annotation can point at the line rather than the whole file.
      const match = /^(.*?)\((\d+),(\d+)\)/.exec(text);
      return {
        mark: "TS",
        name: "",
        detail: text,
        ...(match
          ? { location: { file: match[1], line: Number(match[2]), column: Number(match[3]) } }
          : {}),
      };
    }),
    raw: [
      ...(errors.length > 12 ? [`… and ${errors.length - 12} more error(s)`] : []),
      // A nonzero exit with no parsed lines means tsc itself failed to run.
      ...(child.status !== 0 && errors.length === 0 ? outputTail(child) : []),
    ],
  };
}

// --- Stage 2: the vitest suite ----------------------------------------------

/**
 * The rendered-links guard's coverage stamp, if the suite left one this run.
 * Read with the same fail-silent shrug as the reporter's sidecars, and held to
 * the stamp's own prefix, so a stray file at that path cannot write a line of
 * its choosing into the runbook — a guard's reading is the only thing this
 * folds in.
 */
function readRenderedLinksCoverage(path) {
  try {
    const line = readFileSync(path, "utf8").trim();
    return line.startsWith("rendered-links coverage:") ? line : null;
  } catch {
    return null;
  }
}

/**
 * The stamp, read at the test stage's turn and kept for the close: both the
 * runbook bullet and the `--json` payload quote the *same* reading, so the
 * bullet, the report and the run page cannot disagree about what the guard
 * audited. `null` when the stage left none — a stubbed suite, a run that died
 * before the suite ran — which every consumer omits silently.
 */
let renderedLinksCoverage = null;
function captureRenderedLinksCoverage() {
  renderedLinksCoverage = readRenderedLinksCoverage(RENDERED_LINKS_COVERAGE_FILE);
  return renderedLinksCoverage;
}

/** The collect-time soft-gate warnings the reporter left, if any. */
function readSoftGate(path) {
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(payload?.warnings) ? payload.warnings : [];
  } catch {
    return [];
  }
}

/** The run report the reporter left, if any. */
function readRunReport(path) {
  try {
    return parseRunReport(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The failures the test list cannot carry: suites that failed while every test in them
 * passed, and the run's own unhandled errors.
 *
 * Vitest fails a *file* without failing any of its tests when a file-level hook throws — an
 * `afterAll` clearing a scratch tree, most often — and it fails the *process* when something
 * rejects or throws outside a test. Neither leaves a failed assertion, so the loop in
 * `runTest` sees nothing to report and the summary reads "every test passed"; and because the
 * stage registers `--reporter=json` in place of the default one, nothing printed the reason to
 * the console either. The file's own `message` and the run's `errors` are then the only places
 * it is written at all, so this reads them out: without it the verdict is a run that failed
 * with no detail under it, and the report that held the reason is deleted on the way out.
 */
function failureOutsideTests(report) {
  const brokenSuites = [];
  const unhandled = [];
  for (const file of report.testResults ?? []) {
    const assertions = file.assertionResults ?? [];
    // Only a file whose tests all passed: one that also holds a failed assertion is already
    // named by that assertion, and the file's own `message` for it is a summary of the test
    // failures rather than a reason none of them gives.
    if (file.status !== "failed" || assertions.length === 0) continue;
    if (assertions.some((assertion) => assertion.status === "failed")) continue;
    brokenSuites.push({
      path: rel(file.name),
      message:
        (file.message ?? "")
          .split(/\r?\n/)
          .find((line) => line.trim() !== "") ?? "the file failed outside its tests",
    });
  }
  for (const error of Array.isArray(report.errors) ? report.errors : []) {
    const text = typeof error === "string" ? error : (error?.message ?? "unhandled error");
    unhandled.push({
      name: typeof error === "string" ? "unhandled error" : (error?.name ?? "unhandled error"),
      message: text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "unhandled error",
    });
  }
  return { brokenSuites, unhandled };
}

/**
 * One vitest invocation: the child process and the JSON report it wrote, if any.
 * Clears the attempt's report and sidecars first, so what the caller reads after
 * the run is this attempt's — which is what makes a second attempt clean.
 */
function oneTestRun(reportPath, softPath, runReportPath) {
  if (existsSync(reportPath)) unlinkSync(reportPath);
  if (existsSync(softPath)) unlinkSync(softPath);
  if (existsSync(runReportPath)) unlinkSync(runReportPath);
  // The coverage stamp belongs to this attempt like the report does: a stale
  // copy a plain `npm test` left behind must not reach the close as this
  // run's reading.
  if (existsSync(RENDERED_LINKS_COVERAGE_FILE)) unlinkSync(RENDERED_LINKS_COVERAGE_FILE);

  const child = spawnSync(
    process.execPath,
    [
      stageScript("CI_TEST_SCRIPT", join(ROOT, "node_modules", "vitest", "vitest.mjs")),
      "run",
      "--reporter=json",
      `--outputFile=${reportPath}`,
      // The CLI replaces `reporters` from the config, so the collect-time budget
      // has to be named here too or it would not run in CI at all. It writes to
      // stderr and fails the process by exit code, which is what `child.status`
      // below already reads.
      "--reporter=./src/test/collect-budget.ts",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    // No report: the run crashed before it could write one. The caller fails loudly.
    report = null;
  } finally {
    if (existsSync(reportPath)) unlinkSync(reportPath);
  }
  return { child, report };
}

/**
 * Whether the report is one a healthy suite writes: no failed test, no suite that
 * failed outside its tests, no unhandled error. The retry's guard — a wrapper exit
 * beside a report like this is the machine, not the tests, so the stage runs the
 * suite again rather than red over it.
 */
function healthyTestReport(report) {
  if (report === null) return false;
  const { brokenSuites, unhandled } = failureOutsideTests(report);
  const unrunFiles = (report.testResults ?? []).filter(
    (file) => file.status === "failed" && (file.assertionResults ?? []).length === 0,
  ).length;
  return (
    (report.numFailedTests ?? 0) === 0 && unrunFiles === 0 && brokenSuites.length === 0 && unhandled.length === 0
  );
}

/**
 * The wrapper-only failure, named: the JSON report is a healthy suite's and the
 * exit code is red anyway. The one this checkout has caught in the act is the
 * vitest worker's RPC — `Timeout calling "onTaskUpdate"` — where every test passes
 * and the report carries no failure at all, but the wrapper still exits 1.
 */
function wrapperOnlyFailure(child, report) {
  return child.status !== 0 && healthyTestReport(report);
}

function runTest() {
  const reportPath = join(ROOT, ".freebuff", ".ci-vitest-report.json");
  // The collect-time reporter drops soft-gate warnings and the run report beside
  // the suite's own; the paths are the stage's, the clearing is each attempt's.
  const softPath = join(ROOT, ".freebuff", SOFT_GATE_FILE);
  const runReportPath = join(ROOT, ".freebuff", RUN_REPORT_FILE);
  let { child, report } = oneTestRun(reportPath, softPath, runReportPath);
  // A wrapper that died over a healthy report gets exactly one more attempt: the
  // suite is expensive and the flake is rare, so one bounded retry is the whole
  // indulgence — a genuinely broken wrapper fails again and the run reads as red
  // as before, minus the lie that any test failed.
  let retried = false;
  if (wrapperOnlyFailure(child, report)) {
    progress(
      "ci: vitest wrapper failed with every test passing (the known RPC flake) — running the suite once more",
    );
    const second = oneTestRun(reportPath, softPath, runReportPath);
    retried = true;
    child = second.child;
    report = second.report;
  }

  if (report === null) {
    // No report: the run crashed before it could write one. Fail loudly.
    return {
      pass: false,
      summary: "the suite wrote no report — it may have crashed",
      details: [],
      raw: outputTail(child),
    };
  }

  const softGate = readSoftGate(softPath);
  if (existsSync(softPath)) unlinkSync(softPath);
  // Read but *not* deleted, unlike the soft sidecar: the collect-budget run summary
  // reads the same file for the per-module measurements, and it may run after this
  // stage. Every run rewrites it, so a leftover cannot be mistaken for this run's.
  const runReport = readRunReport(runReportPath);

  // The failures the loop below cannot see, read first so they are named beside the failed
  // tests rather than leaving a summary with nothing under it.
  const { brokenSuites, unhandled } = failureOutsideTests(report);

  const files = report.testResults ?? [];
  const failedTests = [];
  const unrunFiles = [];
  for (const file of files) {
    const assertions = file.assertionResults ?? [];
    // A file with no assertions that failed is a collection/import failure.
    if (file.status === "failed" && assertions.length === 0) {
      unrunFiles.push({ path: rel(file.name), message: (file.message ?? "failed to run").split(/\r?\n/)[0] });
    }
    for (const assertion of assertions) {
      if (assertion.status === "failed") {
        failedTests.push({
          path: rel(file.name),
          title: assertion.title ?? assertion.fullName ?? "(unnamed)",
        });
      }
    }
  }

  const total = report.numTotalTests ?? 0;
  const failedCount = report.numFailedTests ?? failedTests.length + unrunFiles.length;
  const pass =
    failedCount === 0 &&
    unrunFiles.length === 0 &&
    brokenSuites.length === 0 &&
    unhandled.length === 0 &&
    child.status === 0;
  const details = [
    ...unrunFiles.map((file) => ({
      mark: "FAIL",
      name: file.path,
      detail: file.message,
      location: { file: file.path },
    })),
    ...brokenSuites.map((suite) => ({
      mark: "FAIL",
      name: suite.path,
      detail: suite.message,
      location: { file: suite.path },
    })),
    ...unhandled.map((error) => ({
      mark: "FAIL",
      name: error.name,
      detail: error.message,
    })),
    ...failedTests.map((test) => ({
      mark: "FAIL",
      name: test.path,
      detail: test.title,
      location: { file: test.path },
    })),
  ];
  // The soft gate: a file near its collect budget does not fail the run, but a
  // WARN detail prints it in the report and turns it into a `::warning`
  // annotation, so the creep is visible while the stage is still green.
  const softDetails = softGateDetails(softGate);
  // A loose baseline is only *suspected* here: a single run cannot confirm it, so
  // it still passes, and the repeated collect session is where it fails.
  const staleDetails = staleGateDetails(runReport?.stale ?? []);
  // The reasons no assertion above carries, as one clause. "Every test passed" is true of all
  // of them, and on its own it is the whole problem: the reader is told the run failed and
  // given nothing to look at, so the summary names the files and errors instead.
  const causes = [
    ...(brokenSuites.length > 0
      ? [`${brokenSuites.length} file(s) failed without a failing test`]
      : []),
    ...(unhandled.length > 0 ? [`${unhandled.length} unhandled error(s)`] : []),
  ].join(", ");
  const summary = pass
    ? `${total} test(s) passed in ${files.length} file(s)` +
      (softDetails.length > 0 ? ` — ${softDetails.length} near the collect budget` : "") +
      (staleDetails.length > 0 ? ` — ${staleDetails.length} loose baseline(s)` : "") +
      (retried ? " — after one retry for a wrapper-only failure" : "")
    : failedCount > 0
      ? `${failedCount} of ${total} test(s) failed`
      : causes !== ""
        ? `every test passed, but the run failed — ${causes}`
        : retried
          ? "every test passed, but the run failed — see below (a retry failed the same way: the wrapper, not the tests)"
          : // Nothing in the report explains it, so it is the collect-time budget: a
            // reporter fails the process rather than any test, and its own words are what
            // "below" names.
            "every test passed, but the run failed — see below";
  return {
    pass,
    summary,
    details: [...details.slice(0, 20), ...softDetails, ...staleDetails],
    raw: [
      ...(details.length > 20 ? [`… and ${details.length - 20} more failure(s)`] : []),
      ...(child.status !== 0 && details.length === 0 ? outputTail(child) : []),
    ],
  };
}

// --- Stages 3 and 4: the JSON-emitting gates --------------------------------

/**
 * The vocabulary report a tree-editing gate's `--vocabulary` mode answers with, read as data
 * when the mode itself is not the shape this runner understands.
 *
 * Every tree-editing sweep now answers `--vocabulary --json` in the shape the cross-sweep hold
 * pinned (see `src/test/ci-runner.test.ts`): `mode: "vocabulary"`, `gate`/`exitCode`, and the
 * two hole lists — `unnamed` for stamps no declared word covers, `unspoken` for declared words
 * nothing stamps. A vocabulary hole is a refusal the sweep would reach on its own before its
 * first strike, but a run reaches it only after paying for the sweep; this is the same question
 * asked for less, and the lines it answers with are the holes themselves, one detail each — the
 * reader is told what to add or re-fit, not merely that the sweep will refuse.
 *
 * Anything the mode does not answer in that shape — a crash, a legacy stub whose `--vocabulary`
 * prints a run report, an older sweep — reads as `null` rather than as a guess. The pre-pass
 * is deliberately silent about that: the stub seam these very stages are tested through is a
 * script whose `--vocabulary` output happens not to be a vocabulary report, and a pre-pass that
 * summarised that as a broken contract would turn every stub case into a red one for a question
 * the stub was never asked. A hole must be *positively read* to fail a stage — the sweep's own
 * refusal is what speaks for every other way the mode can fail.
 */
function vocabularyHolesReport(child) {
  let payload;
  try {
    payload = JSON.parse(child.stdout ?? "");
  } catch {
    return null;
  }
  if (payload?.mode !== "vocabulary" || payload?.gate === undefined) return null;
  const unnamed = Array.isArray(payload.unnamed) ? payload.unnamed : [];
  const unspoken = Array.isArray(payload.unspoken) ? payload.unspoken : [];
  return {
    gate: payload.gate,
    exitCode: payload.exitCode,
    holes: [
      ...unnamed.map((hole) => ({
        mark: "VOCABULARY HOLE",
        name: `unnamed — ${hole.path ?? JSON.stringify(hole)}`, // a stamp no word covers
        detail: hole.kind
          ? `it stamps kind "${hole.kind}", which the sweep's table does not declare — add the word or correct the kind`
          : "a stamp the sweep's table does not declare — add the word or correct the kind",
      })),
      ...unspoken.map((word) => ({
        mark: "VOCABULARY HOLE",
        name: `unspoken — "${word}"`, // a word nothing stamps
        detail: `the sweep declares "${word}" and nothing stamps it — drop the word or add the stamp`,
      })),
    ],
  };
}

/**
 * Runs a `--json` gate and answers its pass/fail plus the lines to print.
 *
 * A gate declared `vocabularyFirst` runs its script's `--vocabulary --json` first — the
 * tree-editing sweeps' report-only mode, which answers before any anchor check, any nested-run
 * guard or any mutation — and when that read names a vocabulary hole, the stage fails on it and
 * the sweep itself is never spawned: a hole makes the sweep refuse on its own, so paying for the
 * run to reach the refusal buys nothing, and reporting the hole directly names the repair. Any
 * other answer — a clean table, a crash, a mode not the shape the runner reads — hands the stage
 * to the sweep as if the pre-pass had not run, so the sweep's own refusal is the only voice this
 * pre-pass ever silences.
 */
function runJsonGate(gate) {
  if (gate.vocabularyFirst) {
    const vocabulary = vocabularyHolesReport(
      spawnSync(process.execPath, [gate.script, "--vocabulary", "--json"], {
        cwd: ROOT,
        encoding: "utf8",
      }),
    );
    if (vocabulary !== null && vocabulary.holes.length > 0) {
      return {
        pass: false,
        summary: `vocabulary hole(s) — the ${gate.name} sweep would refuse before its first strike; it was not run`,
        details: vocabulary.holes,
        raw:
          vocabulary.gate === "fail" && vocabulary.exitCode !== 1
            ? [`--vocabulary exited ${vocabulary.exitCode}`]
            : [],
      };
    }
  }
  const child = spawnSync(process.execPath, [gate.script, "--json", ...gate.extraArgs()], {
    cwd: ROOT,
    encoding: "utf8",
  });

  let payload;
  try {
    payload = JSON.parse(child.stdout);
  } catch {
    return {
      pass: false,
      summary: "produced no JSON — the gate may have crashed",
      details: [{ mark: "FAIL", name: gate.name, detail: "no parsable JSON on stdout" }],
      raw: [child.stdout, child.stderr].filter((text) => text?.trim()).map((text) => text.trim()),
    };
  }

  const result = gate.summarize(payload);
  // A gate whose JSON says pass but which exited nonzero is a contract bug worth
  // seeing; treat the exit code as authoritative and say so.
  if (result.pass && child.status !== 0) {
    result.pass = false;
    result.summary += ` (but exited ${child.status})`;
  }
  return result;
}

/**
 * The warning details a tree-editing stage's `recovered` list earns.
 *
 * The tree-editing checks hold `.freebuff/.mutation-lock.json` while a file is mutated, and
 * each reads it on the way in: a run killed mid-mutation leaves it behind, and the next run
 * puts the file back from it. That is worth saying out loud on the run page — a
 * restored route or coverage script is a real event, and before this the only trace
 * was a line on the child's stderr, which a green stage never prints. It is a
 * *warning* rather than a failure because the run healed itself; the pass/fail below
 * is still about the check it then ran. The `WARN` prefix on the mark is what carries
 * it: it makes the nightly report list it under its own heading and turns it into a
 * `::warning` annotation rather than an error.
 *
 * The actions a run put back — `restored` and, since the shared recovery began healing an
 * absorbed mutation whose holder is dead, `absorbed-restored` — are warnings on a green
 * run, in the same way. The one action still not meant to be read as one is `absorbed`,
 * now only the state where that heal's own write did not verify — a file this run cannot
 * put back and will not vouch for (see the refusal below the recovery call). It keeps an
 * `ERR` mark rather than borrowing `WARN LOCK LEFT`, because a file holding a weakened
 * check is not a file waiting for a human to look at it; it is one this run's verdicts
 * would be lies about.
 */
function recoveryDetails(payload) {
  return (payload.recovered ?? []).map((event) => ({
    mark: { restored: "WARN RECOVERED", "absorbed-restored": "WARN RECOVERED", cleared: "WARN STALE LOCK", held: "WARN LOCK HELD", failed: "WARN LOCK LEFT", absorbed: "ERR LOCK ABSORBED" }[event.action] ?? "WARN LOCK LEFT",
    name: event.path ?? "",
    detail: event.message ?? `the lock was ${event.action ?? "dealt with"}`,
    ...(event.path ? { location: { file: event.path } } : {}),
  }));
}

/**
 * `— 1 recovered lock` (or `— 1 lock left for a human`) for a stage summary, and nothing
 * at all when the run found no lock. The two are told apart because they ask different
 * things of a reader: one says the run healed itself, the other says a file is not what
 * the lock says it should be and the lock was kept for inspection.
 */
function recoveredNote(recovered) {
  const list = recovered ?? [];
  if (list.length === 0) return "";
  const stuck = list.filter((event) =>
    ["left", "absorbed", "unreadable", "held", "failed"].includes(event.action),
  ).length;
  const healed = list.length - stuck;
  const parts = [];
  if (healed > 0) parts.push(`${healed} recovered lock${healed === 1 ? "" : "s"}`);
  if (stuck > 0) parts.push(`${stuck} lock${stuck === 1 ? "" : "s"} left for a human`);
  return ` — ${parts.join(", ")}`;
}

/**
 * A change to one of these can move any stage, so it disables the skip entirely:
 * the lockfile, the compiler and tool config, and the runner itself. Better to
 * pay for the sweep than to skip it on a dependency bump.
 */
const GLOBAL_FORCE = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "tsconfig*.json",
  "vite.config.*",
  "vitest.config.*",
  "next.config.*",
  "eslint.config.*",
  "postcss.config.*",
  // The worker's own config, by family rather than by the spelling it no longer uses: the
  // entry here read `wrangler.toml` for as long as the file has been `wrangler.jsonc`, so a
  // change to what the worker deploys as re-keyed nothing at all. The glob also reaches the
  // per-environment configs a deployment copies out of this one (`wrangler.staging.jsonc`).
  "wrangler.*",
  "vitest.mutation.config.ts",
  ".freebuff/ci.mjs",
  ".freebuff/redact.mjs",
  ".github/**",
];

/**
 * The `GLOBAL_FORCE` entries that name a file this checkout does not have, and the reason each
 * is a decision rather than a typo.
 *
 * The list above is globs, and a glob that matches nothing looks exactly like one that works: it
 * silently re-keys nothing, so the *intent* behind the entry — a change to this re-runs every
 * stage — stops being true with no line anywhere saying so. That is not hypothetical. The entry
 * for the worker's own config read `wrangler.toml` for as long as this repo has had
 * `wrangler.jsonc`, so a change to what the worker deploys as moved nothing, and one pass further
 * out the same shape hid a rule that had stopped matching a family. A dead entry is a failure
 * rather than a smell for the reason a watch rule matching no file is one: machinery that covers
 * nothing is machinery nobody has.
 *
 * So the run reports the entries that resolve to no file (`forceAbsences`, on the line about the
 * global key) and `src/test/ci-runner.test.ts` holds the reported set to this declaration — an
 * entry may be dead only if somebody wrote down why, and only while it really is dead. An entry
 * that starts resolving has to leave this map, because an exemption that outlived its reason is
 * exactly where the next `wrangler.toml` hides.
 *
 * The one entry today is a *contingency* rather than a leftover: npm resolves a shrinkwrap in
 * preference to `package-lock.json` when one exists, and `npm shrinkwrap` writes one without
 * touching `package.json` — so the day somebody commits one, the installed tree is decided by a
 * file no other entry here names and every stage has to re-key. Dropping it would be the quieter
 * mistake, since its appearance is the moment the force is for.
 */
const GLOBAL_FORCE_CONTINGENT = {
  "npm-shrinkwrap.json":
    "npm prefers a shrinkwrap over package-lock.json when one exists, and `npm shrinkwrap` " +
    "writes one without touching package.json — a lockfile this project may yet take, whose " +
    "appearance has to re-key every stage",
};

/**
 * The stage `inputs` entries that name no file in this checkout, and the reason each is a
 * decision rather than a typo.
 *
 * The stage list's half of the question `GLOBAL_FORCE_CONTINGENT` answers for the global key, and
 * for the same reason: an entry that resolves to nothing keys nothing, and nothing about it says
 * so — the stage goes on being reused across a change to the very spelling the entry was written
 * to catch. The distinction that matters is between a **contingency** and a **leftover**. A
 * contingency names a spelling this project has not taken yet that the stage *would* read, so the
 * file's appearance is exactly when the stage has to re-key; a spelling the checkout has already
 * replaced (`wrangler.toml` beside `wrangler.jsonc`), or an extension the stage's own machinery
 * has been configured not to read (`.jsx` under this `eslint.config.mjs`), can never key anything
 * and is a leftover — it belongs in neither list, and the entry itself goes.
 *
 * So an entry here has to be a contingency in that strict sense, and it has to leave the map the
 * moment a file of that name appears: an exemption that outlived its reason is exactly where the
 * next stale spelling hides. The run reports the dead entries (`inputAbsences`, on each stage's own
 * row) and `src/test/ci-runner.test.ts` holds the reported set to this declaration in **both**
 * directions, so a dead entry is a red test naming its stage rather than a line that keys nothing.
 *
 * Three today are extension families the tools do read: `tsc` compiles a `.mts`/`.cts` module the
 * moment a `.ts` root imports one — `tsconfig.json`'s `include` names roots, not imports — and
 * ESLint's flat config takes `.cjs` by default, so dropping such a file into the tree would put it
 * in front of the lint stage. The fourth is the shrinkwrap `GLOBAL_FORCE_CONTINGENT` already
 * declares, named here because the preflight reads the lockfile family too. The lint stage's
 * `.jsx` entry was there too and is *not* here: this configuration does not lint a `.jsx` file at
 * all (`eslint .` skips one, and `eslint <file>.jsx` answers "no matching configuration was
 * supplied"), so the entry could not key anything even after such a file appeared — a leftover,
 * dropped from the declaration it was in rather than excused.
 */
const INPUT_CONTINGENT = {
  "**/*.mts":
    "`tsc` compiles an imported `.mts` module even though tsconfig.json's `include` names only " +
    "`.ts`/`.tsx` roots, so this is a spelling a change could reach the typecheck stage through",
  "**/*.cts":
    "the CommonJS half of the same: an imported `.cts` module is compiled and is not in " +
    "tsconfig.json's `include` either",
  "**/*.cjs":
    "ESLint's flat config reads `.cjs` by default, so a `.cjs` file dropped in the tree is linted " +
    "and a change to it has to re-run the lint stage — checked by dropping one in and watching " +
    "`eslint .` pick it up",
  "npm-shrinkwrap.json":
    "the contingency GLOBAL_FORCE_CONTINGENT already declares, named here because the preflight " +
    "reads the lockfile family too: npm prefers a shrinkwrap over package-lock.json, and `npm " +
    "shrinkwrap` writes one without touching package.json",
};

// --- The result cache -------------------------------------------------------

/**
 * The cache file's shape. Bump it whenever a key would mean something different,
 * so an older file is read as a cold cache rather than misread as a warm one.
 *
 * At 2 the `hash` an entry records stopped being the key the run decided against and
 * became the key of the tree the pass *left* (see "A pass is recorded for the tree it
 * leaves" below), so an older entry's `hash` means something else and is not reused.
 *
 * At 3 a script-backed stage's key grew the script's import closure: the `.mjs`
 * modules the gate loads are folded into the key files beside the declared `inputs`,
 * so the same entry's `hash` now covers machinery an older key never saw. The keys
 * differ even on an unchanged tree, so an older file is a cold cache rather than a
 * warm one that lies.
 */
const CACHE_VERSION = 3;

/**
 * How long a recorded pass may be reused before it is re-run anyway. A content
 * digest cannot see a dependency that drifted *outside* a stage's globs, so an
 * entry is trusted for a week and then expired: the stage runs again and records
 * afresh. `--cache-ttl=0` removes the cap.
 */
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Where a re-run remembers what already passed. `.ci/` is git-ignored, so the
 * cache is a local convenience — or a CI job's `actions/cache` entry — rather than
 * anything committed. `CI_CACHE_FILE` points it somewhere else (the seam the tests
 * use so a run never reads the developer's own cache).
 */
const CACHE_FILE = process.env.CI_CACHE_FILE
  ? isAbsolute(process.env.CI_CACHE_FILE)
    ? process.env.CI_CACHE_FILE
    : join(ROOT, process.env.CI_CACHE_FILE)
  : join(ROOT, ".ci", "cache.json");

/**
 * Where a run leaves the pin's opening state, so a red run can name a tree that moved
 * underneath it. Written before the first stage, read once at the close: a pinned gate
 * file whose hash then differs from the tree now is a file somebody else was writing
 * while this run measured it — the shape every shared-tree red takes. It lives beside
 * the cache in git-ignored `.ci/`, and `CI_PIN_SNAPSHOT_FILE` points it somewhere else
 * (the seam the tests use so a run never reads the developer's own snapshot).
 */
const PIN_SNAPSHOT_FILE = process.env.CI_PIN_SNAPSHOT_FILE
  ? isAbsolute(process.env.CI_PIN_SNAPSHOT_FILE)
    ? process.env.CI_PIN_SNAPSHOT_FILE
    : join(ROOT, process.env.CI_PIN_SNAPSHOT_FILE)
  : join(ROOT, ".ci", "pin-snapshot.json");

/**
 * The concurrent-edit suspects, read from the snapshot the run's opening wrote. A file
 * is one when its hash, or its existence, differs between the pin as the run opened and
 * the tree as the run closed — `changed` is the ordinary drift, `gone` a pinned file
 * deleted mid-run, `unpinned` a gate file the watch rules started naming after the run
 * began. The two readings are the alarm's own (`readManifest` for the rules in force,
 * `pin` for the tree, `compare` for the diff), so this cannot disagree with the drift
 * stage about what moved; only the *when* is this run's own. No snapshot, an unreadable
 * one, or a pin that will not resolve all answer `[]` — an attribution note is never
 * worth a second failure — each saying so on stderr rather than silently.
 */
async function readPinSuspects() {
  if (!existsSync(PIN_SNAPSHOT_FILE)) return [];
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(PIN_SNAPSHOT_FILE, "utf8"));
  } catch {
    console.error(
      `ci: unreadable pin snapshot — concurrent-edit suspects not checked (${PIN_SNAPSHOT_FILE})`,
    );
    return [];
  }
  try {
    const { watches, problem } = await readManifest(manifestPath());
    if (problem) {
      console.error("ci: pin unreadable at close — concurrent-edit suspects not checked");
      return [];
    }
    const { changed, unpinned, gone } = compare(snapshot.files ?? {}, pin(null, watches));
    const suspects = [
      ...changed.map((item) => ({ path: item.path, how: "changed" })),
      ...gone.map((path) => ({ path, how: "gone" })),
      ...unpinned.map((path) => ({ path, how: "unpinned" })),
    ].sort((left, right) => left.path.localeCompare(right.path));
    // Consumed once read: the next run opens with its own snapshot, and a left-behind
    // one would suspect a tree that has since settled.
    try {
      unlinkSync(PIN_SNAPSHOT_FILE);
    } catch {
      // The next run re-reads it as its own opening state — a stale note, not a wrong pin.
    }
    return suspects;
  } catch {
    console.error("ci: pin unreadable at close — concurrent-edit suspects not checked");
    return [];
  }
}

/**
 * Directories that hold no stage input: dependencies, build output, VCS data and
 * the cache itself (which would otherwise be a stage input and feed back).
 */
const CACHE_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "coverage",
  ".ci",
]);

/** Every file under `dir` a stage's globs could match, as absolute paths. */
function sourceFiles(dir = ROOT, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!CACHE_SKIP_DIRS.has(entry.name)) sourceFiles(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

// Each file is read once per run however many stages' globs name it.
const fileDigests = new Map();

/**
 * What a file is given when it cannot be read: a file that is gone hashes as *gone*.
 *
 * A run takes its file list up front and re-reads a stage's key after its pass, so a path
 * that was there then can be gone now — a stage that removes its own scratch output, a
 * concurrent run's artifact, a resume that skipped the stage which wrote it. `readFileSync`
 * would throw straight out of the key and kill the run, which is the opposite of what a key
 * is for: the key exists to *notice* that the tree moved, and a vanished file is that
 * notice. So an unreadable path digests to this marker instead. It needs to be distinct
 * from every content digest, not descriptive — every real digest is 64 hex characters, this
 * is not — and it folds in under the file's own path like any other, so a tree missing a
 * file and a tree that never had it stay two different keys.
 */
const ABSENT_DIGEST = "\u0000absent";

/** The content digest of one file, memoized for the life of the run. */
function fileDigest(path) {
  let digest = fileDigests.get(path);
  if (digest === undefined) {
    try {
      digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    } catch {
      // Gone, unreadable, or not a file at all. Either way the key is about to say "not the
      // content that was recorded", which is the safe answer: a re-run, never a reuse.
      digest = ABSENT_DIGEST;
    }
    fileDigests.set(path, digest);
  }
  return digest;
}

// Each mtime is read once per run, and only when the cache is being explained.
const fileMtimes = new Map();

/**
 * A file's modification time in ms, memoized for the life of the run, or `null` when it
 * cannot be stat'ed — the same vanished path `fileDigest` tolerates, and for the same
 * reason: asking why a stage was not reused must not be the one thing a file another
 * writer removed can kill.
 */
function mtimeOf(path) {
  let ms = fileMtimes.get(path);
  if (ms === undefined) {
    try {
      ms = statSync(path).mtimeMs;
    } catch {
      ms = null;
    }
    fileMtimes.set(path, ms);
  }
  return ms;
}

/**
 * The most recently touched of these files, or `null` when none of them can be read.
 * The unreadable ones are dropped rather than defaulted: `Math.max` reads a `null` as 0,
 * which would report a vanished input as touched in 1970 — older than everything it was
 * meant to be compared against, and the exact opposite of what the line is for.
 */
function newestOf(files) {
  const times = files.map(mtimeOf).filter((ms) => ms !== null);
  return times.length === 0 ? null : Math.max(...times);
}

/** A digest over these files: the path and the content, so a rename counts too. */
function hashPaths(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(rel(path));
    hash.update("\0");
    hash.update(fileDigest(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** The files a stage's `inputs` name — what its key covers and what `--changed-only` reads. */
function inputFiles(files, inputs) {
  return files.filter((file) => inputs.some((input) => matchesInput(input, rel(file))));
}

/**
 * The label a report gives a key file the stage's *declaration* does not name: a module the
 * stage's script imports, folded into the key by the import closure rather than restated in
 * `inputs` by hand. The label names the derivation, because that is the honest answer to
 * "what put this file behind the key?" — and it is redacted like every other name a report
 * prints, one entry at a time.
 */
function closureInputLabel(scriptRel) {
  return redactInput(`imports of ${scriptRel}`);
}

/**
 * A script-backed stage's import closure, repo-relative — the script itself plus every
 * module it loads — memoized for the run. Declared separately from `stageKeyFiles`
 * because the closure is asked twice, from two directions: folded into the key files
 * (`stageKeyFiles`, during the run) and matched against the pin's rows (`pinnedRows`,
 * which runs before the cache's file walk exists). Both read one walk, so the two
 * reports of "which stage's key is behind this file" cannot disagree.
 */
const stageClosures = new Map();
function stageClosure(stage) {
  if (stage.script === undefined) return null;
  const memo = stageClosures.get(stage.name);
  if (memo !== undefined) return memo;
  let script;
  try {
    script = stage.script();
  } catch {
    return null;
  }
  if (typeof script !== "string") return null;
  const closure = new Set(
    importClosure(rel(script), (name) => {
      try {
        return readFileSync(join(ROOT, name), "utf8");
      } catch {
        return undefined;
      }
    }),
  );
  stageClosures.set(stage.name, closure);
  return closure;
}

/**
 * The closure files *beside* the script itself — the modules a stage's gate loads that the
 * stage's `inputs` do not have to name — sorted by name so a report lists them the same way
 * on every host. `null` when the stage runs no script or its closure cannot be read: a
 * report then carries no `imports` field rather than an empty one, which keeps "absent"
 * meaning "nothing to say" and not "the stage imports nothing".
 *
 * Both reporting paths ask for exactly this shape — the coverage refusal's sentence and the
 * `--explain-cache` report — so the two cannot name different module sets for one stage.
 */
function stageImportNames(stage) {
  const closure = stageClosure(stage);
  if (closure === null) return null;
  const scriptRel = rel(stage.script());
  return [...closure].filter((name) => name !== scriptRel).sort((a, b) => a.localeCompare(b));
}

/** A stage name's own import modules, or `null` when no stage of that name runs a script. */
function closureOf(name) {
  const stage = STAGES.find((candidate) => candidate.name === name);
  return stage === undefined ? null : stageImportNames(stage);
}

/**
 * A stage's key files: the files its `inputs` name, plus — when it declares a gate script —
 * every module that script loads.
 *
 * The closure half is the machinery invariant (`src/test/ci-runner.test.ts`) stated as the
 * mechanism itself rather than held beside it: a helper a gate script imports re-keys the
 * stage that runs it *by construction*, with no second list to keep in step. Declared
 * `inputs` are untouched — they stay the complete statement of what a stage reads, the feed
 * for the coverage suggestions, and the home for what no walk can see (the pin manifest,
 * loaded by a computed specifier). A closure file outside the caller's file list stays in
 * the key: it hashes as absent, which is the notice a key exists to give.
 */
function stageKeyFiles(stage, files) {
  const declared = inputFiles(files, stage.inputs ?? []);
  const closure = stageClosure(stage);
  if (closure === null) return declared;
  const declaredNames = new Set(declared.map((path) => rel(path)));
  const extra = [...closure]
    .filter((name) => !declaredNames.has(name))
    .map((name) => join(ROOT, name));
  return [...declared, ...extra];
}

/**
 * Which `GLOBAL_FORCE` entries resolve to nothing in a file list, and which declared-contingent
 * entries have quietly started resolving.
 *
 * Asked against the same walk the keys are built from, so the answer is about the tree a run
 * would actually key on. `undeclared` is the failure and `revived` is the stale exemption — the
 * two directions of one question, read together so neither can be satisfied by moving the other.
 * The run itself does not refuse on either: a force list naming a spelling this project has not
 * taken yet is a maintenance lie rather than a hole in a verdict, and the suite is where a lie
 * has to be repaired.
 */
function forceAbsences(files) {
  const absent = GLOBAL_FORCE.filter(
    (pattern) => !files.some((file) => globMatch(pattern, rel(file))),
  );
  const declared = Object.keys(GLOBAL_FORCE_CONTINGENT);
  return {
    absent,
    undeclared: absent.filter((pattern) => !declared.includes(pattern)),
    revived: declared.filter((pattern) => !absent.includes(pattern)),
  };
}

/**
 * Which stage `inputs` entries resolve to nothing in a file list, and which declared-contingent
 * entries have quietly started resolving.
 *
 * `forceAbsences`' question asked of every stage's own declaration, and answered in the same two
 * directions: `undeclared` is the failure and `revived` is the stale exemption, read together so
 * neither can be satisfied by moving the other. A row carries the stage as well as the entry,
 * because the repair is a stage's `inputs` — the same fact told to a reader as *which stage* is
 * keying nothing through a spelling that is not there.
 *
 * Asked against the same walk the keys are built from, so the answer is about the tree a run would
 * actually key on, and asked of every input whatever its shape: a stage's globs, and the drift
 * stage's watch rules, which resolve through the alarm's own reading of `{dir, pattern}`. The run
 * itself does not refuse on either — a stage input naming a spelling this project has not taken
 * yet is a maintenance lie rather than a hole in a verdict, and the suite is where a lie has to be
 * repaired.
 */
function inputAbsences(files) {
  const rows = [];
  for (const stage of STAGES) {
    for (const input of stage.inputs ?? []) {
      if (files.some((file) => matchesInput(input, rel(file)))) continue;
      rows.push({ stage: stage.name, input: inputLabel(input) });
    }
  }
  const declared = Object.keys(INPUT_CONTINGENT);
  const absent = [...new Set(rows.map((row) => row.input))];
  return {
    rows,
    absent,
    undeclared: absent.filter((label) => !declared.includes(label)),
    revived: declared.filter((label) => !absent.includes(label)),
  };
}

/**
 * The files a stage reads that are no longer on disk: the inputs that vanished mid-run.
 *
 * The candidates come from the run's opening walk, so a path named here and gone now is a
 * file that moved under the stage — which `fileDigest` already survives by hashing it as
 * absent. This is what lets the run *say* it, so "the tree moved" is a line on the stage's
 * row rather than something a reader has to infer from two hashes that differ.
 */
function missingInputs(stage) {
  if (cacheFiles === null || !stage.inputs) return [];
  return inputFiles(cacheFiles, stage.inputs).filter((file) => !existsSync(file));
}

/**
 * Every file behind a stage's key, each with the input that put it there, or `null` when
 * the cache is off and there is no key to explain.
 *
 * `--explain-cache` has two answers to give and they are not the same one: *which files*
 * a stage is keyed on, and *what* put them there. The second only becomes a question when
 * a stage's inputs are the alarm's watch rules, where a list of names is a list of files
 * and nothing about the eight families they fall into — which is the part a reader needs
 * when the stage ran again and they want to know what moved under it. Membership is
 * `inputFiles`' membership, file for file: the first input that matches a file in the
 * stage's own declaration order is the one that owns it, so the pairing cannot disagree
 * with the count the key was built from. The closure files the declaration does not name
 * are the ones an `imports of <script>` label marks here; `stageImportNames` renders the
 * same set whole for the reports that want the modules rather than the pairing.
 */
function matchedInputs(stage) {
  if (cacheFiles === null || !stage.inputs) return null;
  const declared = new Set(stageKeyFiles(stage, cacheFiles));
  const scriptRel = stage.script === undefined ? null : rel(stage.script());
  return [...declared].map((path) => {
    const name = rel(path);
    const input = stage.inputs.find((candidate) => matchesInput(candidate, name)) ?? null;
    // A key file the declaration does not name came in through the script's import
    // closure; it reports the derivation rather than a false input.
    const label =
      input === null
        ? scriptRel === null
          ? null
          : closureInputLabel(scriptRel)
        : inputLabel(input);
    return { path, name, input: label };
  });
}

/**
 * The pinned gate files no stage's cache key covers, and what each is allowed to be invisible
 * behind — the only way a pinned file may sit outside every key.
 *
 * Empty, and that is the point rather than an oversight: the drift stage's `inputs` *are* the
 * pin's watch rules, so every file the pin holds is behind that stage's key by construction,
 * and the build and config files `GLOBAL_FORCE` puts behind every key are behind it twice over.
 * An entry here is a declaration that a gate file may change without re-keying anything — a
 * thing to write down, with a reason, rather than to discover from a stage list that quietly
 * stopped covering it. One declaration, read by the run's refusal, the `--status` map and
 * `src/test/ci-runner.test.ts`, so the three cannot disagree about what is excused.
 */
const KEY_EXEMPT_PINNED = {};

/**
 * The rules the pin in force is watched by, or `null` when it will not resolve.
 *
 * The *manifest's* rules rather than `DEFAULT_WATCHES`. For the committed pin the two are the
 * same list — the alarm refuses a manifest that records anything else — and for the pin a
 * `GATE_HASHES_FILE` substitution names, the recorded rules are the ones that decide what is
 * watched, which is what makes this map a description of the pin rather than of one of the two
 * ways it can be declared.
 */
async function pinnedRules() {
  try {
    const { watches, problem } = await readManifest(manifestPath());
    if (problem !== null) return null;
    // The one place the pin's rules are read, so the one place the fold's reading of them can come
    // from: a family is named by the rule that pinned it, and the drift stage's headings resolve
    // against the same array the rows and the exposure view above were resolved by.
    pinWatches = watches;
    return watches;
  } catch {
    return null;
  }
}

/**
 * Whether a coverage row is the failure the run refuses on: behind no stage's `inputs`, behind
 * no `GLOBAL_FORCE` file, and not recorded as exempt. One predicate for `coverageGaps` and the
 * suggestion beside it, so the refusal and the stage it names cannot disagree about which rows
 * are at issue.
 */
function uncoveredRow(row) {
  return row.keys.length === 0 && !row.everyKey && row.exempt === null;
}

/**
 * The stage that should have been given each uncovered file, where the pin's own families point
 * at one: keyed by file, the stage and the file that earned it — the `via`.
 *
 * A suggestion rather than a verdict, and that difference is the whole design. Nothing in the
 * stage list declares which stage *reads* a file no stage names — if something did, the file
 * would not be uncovered — so the honest signal is the family the rule drew: a rule that pinned
 * seven files, six of them behind a stage's key, has plainly lost one, and that stage is the one
 * to extend. A rule whose files are all outside every key names no stage, and there the refusal
 * says so rather than guessing, because a family the stage list has never heard of is a new input
 * or an exemption rather than a stage to pick. The stage keying the most of the rule's files wins
 * — ties to the earlier stage in declaration order, the same tie-break `ruleOwners` and
 * `--explain-cache` use — and the file's own key never counts, because `uncoveredRow` has already
 * established there is none.
 *
 * The `via` is the reason the stage is being named rather than a guess of its own: it is the
 * file already behind that stage's key, so the repair reads as "put this beside that", a stage
 * and a sibling to extend it with, instead of a stage to trust on the strength of a count. When
 * a stage keys several of the rule's files the earliest by name speaks for them — the pin's own
 * scan order is the filesystem's and is not a fact about the runner, so the choice is pinned to
 * a name rather than left to whatever the directory happened to enumerate first.
 *
 * The `mates` are the stage's own `inputs` only — the files the import closure folds into
 * the key are deliberately not counted — so the sibling named here is one the reader will
 * find in the stage's `inputs` when they open the declaration, and the refusal's appended
 * `inputs` line is the whole repair rather than the start of one.
 */
function stageSuggestions(rows) {
  const byRule = new Map();
  for (const row of rows) {
    if (row.rule === null) continue;
    if (!byRule.has(row.rule)) byRule.set(row.rule, []);
    byRule.get(row.rule).push(row);
  }
  const suggested = new Map();
  for (const family of byRule.values()) {
    const gaps = family.filter(uncoveredRow);
    if (gaps.length === 0) continue;
    const counts = new Map();
    for (const stage of STAGES) {
      const mates = family.filter((row) =>
        (stage.inputs ?? []).some((input) => matchesInput(input, row.file)),
      );
      if (mates.length > 0) counts.set(stage.name, mates);
    }
    const best = [...counts].sort((left, right) => right[1].length - left[1].length)[0];
    if (best === undefined) continue;
    const via = best[1]
      .map((row) => row.file)
      .sort((left, right) => left.localeCompare(right))[0];
    for (const row of gaps) suggested.set(row.file, { stage: best[0], via });
  }
  return suggested;
}

/**
 * The watch-rule families each stage's key already holds a member of, keyed by stage name — the
 * other direction of `stageSuggestions`, asked of a tree where nothing is uncovered.
 *
 * The refusal names a stage and a sibling only when a rule has lost a file, and the question a
 * reader reaches for first is the same one asked of a *stage*: which family does this key serve,
 * and which member of it is the one already behind the key? It is answered from the pin's own
 * rows — `row.keys` is the stage list's own reading of what covers the file, so this cannot
 * disagree with the map or with `stageSuggestions` about who holds what — and the sibling is the
 * earliest by name among the family's members behind that key, the deterministic choice
 * `stageSuggestions` makes for the same reason: a key is a set, and the member that speaks for it
 * should not depend on the order a directory happened to enumerate. A stage that holds no member
 * of any family is absent, and a family no stage holds is absent from every stage — the same
 * silence the refusal keeps rather than a guess at a stage.
 */
function familyKeysByStage(rows) {
  const byStage = new Map();
  for (const row of rows) {
    if (row.rule === null) continue;
    for (const name of row.keys) {
      if (!byStage.has(name)) byStage.set(name, new Map());
      const held = byStage.get(name);
      const current = held.get(row.rule);
      if (current === undefined || row.file.localeCompare(current) < 0) {
        held.set(row.rule, row.file);
      }
    }
  }
  const families = new Map();
  for (const [name, held] of byStage) {
    families.set(
      name,
      [...held]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([rule, via]) => ({ rule, via })),
    );
  }
  return families;
}

/**
 * The one stage that answers for the *pin* rather than for a file.
 *
 * Its `inputs` are the alarm's own watch rules (`DEFAULT_WATCHES`), so it holds every pinned file
 * by construction — it is the pin checking itself, which is what makes the coverage invariant
 * enforceable: no pinned file can hide from a key, because the key that checks the pin already
 * names the rule that held it. That same construction is what keeps the invariant from seeing the
 * *next* member: a family this stage holds whole is held whole by definition, and stays held whole
 * when a rule is widened or a sibling script joins it, so the coverage map reads `covered` while
 * no stage that *measures* the file has it in `inputs` at all. Named once, in the alarm
 * (`PIN_SELF_CHECK_STAGE`), and imported above, so the family view here can say which answer is the
 * pin vouching for itself instead of counting it as a reader — and the alarm's own owner reading
 * excludes the same stage by the same name.
 */

/**
 * The pin grouped by the watch rule that pinned each file, with how many of each family's members
 * sit behind each stage's key.
 *
 * The file-by-file map answers "is this file watched?"; this answers the question a *family* asks
 * — how much of it a stage actually holds. A rule that pinned seven files with three behind the
 * coverage stage is a family that stage only half covers, and that shape is worth seeing while
 * the tree is green, because it is the same shape the refusal names the moment one member is left
 * behind nothing: the stage holding the rest is the stage to extend. Counts are of a stage's own
 * `inputs` — a file behind only `GLOBAL_FORCE` is not a stage's — so this cannot disagree with the
 * map or with the refusal about who holds what, and a member behind no stage's key at all is
 * counted apart rather than folded into a stage that does not hold it. Declaration order would
 * say nothing about which families are at risk, so the ones not fully held lead — `unkeyed`
 * first, the way `NO KEY` leads the file map — then the ones a new member would leave behind the
 * pin's own re-key, and the rest read in rule order.
 *
 * `exposed` is the pre-emptive half of the same reading, and the reason this view is worth
 * consulting before anything is red: a family no stage *other than the pin's self-check* holds
 * whole is a family where the next member the rule draws — a widened pattern, a sibling script
 * the rule already matches — is behind `drift` alone. Nothing fails: the file is pinned, it
 * re-keys the check that reads the pin, and `uncoveredRow` has no complaint to make. But no stage
 * that measures it has been told the family exists, so that is the moment to name the family in a
 * stage's `inputs` — while the tree is green, rather than once a member has fallen out of every
 * key and the refusal is the only thing left to say it.
 */
function familyCoverage(rows) {
  const byRule = new Map();
  for (const row of rows) {
    if (row.rule === null) continue;
    if (!byRule.has(row.rule)) byRule.set(row.rule, []);
    byRule.get(row.rule).push(row);
  }
  return [...byRule]
    .map(([rule, family]) => {
      const counts = new Map();
      for (const row of family) {
        for (const name of row.keys) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const stages = [...counts]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
      return {
        rule,
        members: family.length,
        stages,
        unkeyed: family.filter(uncoveredRow).length,
        // The pin's own check does not count as a stage that reads the family — see
        // `PIN_SELF_CHECK_STAGE` — so a family it alone holds whole is the family a new member
        // would land in behind nothing but the re-key that its being pinned already buys.
        exposed: !stages.some(
          (stage) => stage.name !== PIN_SELF_CHECK_STAGE && stage.count === family.length,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.unkeyed - left.unkeyed ||
        Number(right.exposed) - Number(left.exposed) ||
        left.rule.localeCompare(right.rule),
    );
}

/**
 * The pin's family view, keyed by rule — `familyCoverage` of the rows the run already resolved for
 * the coverage refusal — kept for the drift stage so a *red* run can lead with the families nothing
 * below measures (`movedFamilyGroups`), the same exposure `--status` prints.
 *
 * Assigned once, before any stage runs, from the coverage the refusal already had to read; `null`
 * when the pin will not resolve, and then a red drift falls back to moving order rather than
 * inventing a risk it could not read. Deliberately variables rather than arguments threaded
 * through the stage list: the drift stage's `summarize` reads them the way it reads everything else
 * about the run, and only the drift stage has a use for them.
 *
 * `pinOwners` is the same rows read the other way — the stage each family should be owned by
 * (`familyOwners`) — so the fold can carry the repair beside the grouping rather than only naming
 * the rule. Two readings of one resolve, so a family's lead and its repair cannot disagree about
 * which stages hold it.
 */
let pinFamilies = null;
let pinOwners = null;

/**
 * The rules the pin was resolved by, so the drift stage's fold names a family with the rule that
 * *pinned* it. `DEFAULT_WATCHES` until a pin is read, which is the committed pin's own list — and
 * the list a red drift groups by while the pin will not resolve, when there is no recorded rule to
 * read.
 */
let pinWatches = DEFAULT_WATCHES;

/**
 * A `--status --watch=` spec read the way a stage's `inputs` are read: the files a proposed input
 * would key, the pin's own family they belong to, and which of them the pin does not hold yet —
 * or the reason the spec can be read as neither.
 *
 * The two readings are the two shapes an `inputs` array actually holds. A *path or glob* is a
 * string, matched the way a glob input is matched (`globMatch`); a *watch rule* is the
 * `dir/pattern` shape `inputLabel` prints, resolved through the *alarm's own scan* (`pin`) so the
 * files it would watch are the files the pin would hold rather than this script's guess at a
 * pattern. The path reading is tried first because it is the narrower one — a rule label carries
 * the regex syntax (`^`, `\\.`, `$`) a path does not — and where the two readings can overlap (a
 * bare filename, a rule with no anchors) they name the same file, so the answer does not depend on
 * the order they are tried in.
 *
 * A spec the pin does not hold is still a candidate rather than an error: it is a *proposed* input,
 * so it comes back with the family a pin rule would put it in (when one matches) and the files it
 * would add to the pin, because naming a file in a stage's `inputs` and pinning it are two
 * different acts and a report that conflated them would be answering the wrong question.
 */
function watchCandidate(spec, rows) {
  const held = rows.map((row) => row.file);
  const read = (files) => {
    const pinned = files.filter((file) => held.includes(file));
    const owners = new Set(
      pinned.map((file) => rows.find((row) => row.file === file)?.rule ?? null),
    );
    return {
      spec,
      files,
      pinned,
      fresh: files.filter((file) => !held.includes(file)),
      // The family the pin puts these files in: the first rule in declaration order that resolves
      // a file owns it, so a rule added *beside* an existing one does not re-family what an
      // earlier rule already claimed.
      rule: owners.size === 1 ? [...owners][0] : null,
    };
  };
  const globbed = held.filter((file) => globMatch(spec, file));
  if (globbed.length > 0) return { ...read(globbed), kind: "path", label: spec, problem: null };
  // A rule is `dir/pattern`, split at the last slash the way `inputLabel` joins it; a label with
  // no slash is the project root's own, which `inputLabel` prints without one.
  const slash = spec.lastIndexOf("/");
  const rule = {
    dir: slash === -1 ? "." : spec.slice(0, slash),
    pattern: slash === -1 ? spec : spec.slice(slash + 1),
  };
  const label = inputLabel(rule);
  try {
    return {
      ...read(Object.keys(pin([manifestPath()], [rule]))),
      kind: "rule",
      label,
      problem: null,
    };
  } catch (error) {
    // A pattern that will not compile, or a directory that is not there: the same two ways the
    // alarm's own scan refuses a rule, named rather than smoothed over into "matches nothing".
    return {
      spec,
      kind: "rule",
      label,
      files: [],
      pinned: [],
      fresh: [],
      rule: null,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Which of the pin's half-held families a candidate input would close, and which it would leave
 * behind the re-key.
 *
 * A family is *closed* by the candidate when naming it in some stage's `inputs` would leave that
 * stage holding every member — the members the stage is missing are the ones the candidate would
 * key — which is the pre-emptive form of the coverage refusal's repair: the refusal names the
 * stage to extend only once a member is behind nothing at all, and this asks the same question
 * while the tree is green. Only the families the pin's own check cannot hold whole are asked
 * about (`exposed`, the mark the family block prints), and the check itself is left out of the
 * candidate stages for the reason `PIN_SELF_CHECK_STAGE` gives: `drift` holds a pinned family
 * whole by construction, so counting it would answer every question with "already closed".
 *
 * The stage named first is the one already holding part of the family — the extension the refusal
 * would name — and the stages that would only hold it whole by virtue of the candidate covering
 * every member are reported apart (`anyStage`), because "edit *this* stage" and "any stage at
 * all" are different instructions and only the first is a repair. A family the candidate cannot
 * close stays on the report with how many of its members the candidate does cover: a proposal that
 * closes one half-held family and leaves two is a half-answer, and the verdict has to say so.
 */
function watchClosures(candidate, rows, families) {
  const covered = new Set(candidate.files);
  const exposed = new Set(families.filter((family) => family.exposed).map((family) => family.rule));
  const members = new Map();
  for (const row of rows) {
    if (row.rule === null || !exposed.has(row.rule)) continue;
    if (!members.has(row.rule)) members.set(row.rule, []);
    members.get(row.rule).push(row);
  }
  const closes = [];
  const open = [];
  for (const [rule, family] of [...members].sort((left, right) => left[0].localeCompare(right[0]))) {
    const entry = {
      rule,
      members: family.length,
      covered: family.filter((row) => covered.has(row.file)).length,
    };
    const closers = STAGES.filter(
      (stage) =>
        stage.name !== PIN_SELF_CHECK_STAGE &&
        family.every((row) => row.keys.includes(stage.name) || covered.has(row.file)),
    );
    const extensions = closers.filter((stage) =>
      family.some((row) => row.keys.includes(stage.name)),
    );
    if (extensions.length > 0) {
      closes.push({ ...entry, stages: extensions.map((stage) => stage.name), anyStage: false });
    } else if (closers.length > 0) {
      // Nothing in the pin holds a member of this family, so there is no stage to extend: the
      // candidate closes it only in the sense that any stage naming it would hold all of it.
      closes.push({ ...entry, stages: [], anyStage: true });
    } else {
      open.push(entry);
    }
  }
  return { closes, open };
}

/**
 * The pin's own rows — one per file it holds — with the rule that pinned each, the stages whose
 * `inputs` name it, whether `GLOBAL_FORCE` carries it and whether it is exempt.
 *
 * Split out from `pinnedCoverage` because two reports want the same rows and different questions
 * of them: the coverage map asks which stage a gap should have been named in, and
 * `--explain-cache` asks the other direction — which family a *named stage* already holds a member
 * of — so neither should re-resolve the pin for itself, or disagree about what the pin holds.
 */
async function pinnedRows() {
  const watches = await pinnedRules();
  if (watches === null) return null;
  let files;
  try {
    files = Object.keys(pin([manifestPath()], watches));
  } catch {
    return null;
  }
  return pinFamilyRows(files, watches, [manifestPath()], STAGES)
    .map((row) => ({
      ...row,
      // A stage whose gate script imports this file also keys it — the closure half of
      // `stageKeyFiles`, which `pinFamilyRows` (the alarm's declaration reading) cannot see.
      // Read through the same memoized walk the keys fold in, so the two reports of "which
      // stage's key is behind this file" — this map and `--explain-cache`'s `matchedBy` —
      // answer from one mechanism rather than from declarations on one side and keys on the
      // other. The closure is asked before the cache's own file walk exists, so it reads the
      // scripts from disk directly and touches no run state.
      keys: STAGES.filter(
        (stage) =>
          stage.inputs.some((input) => matchesInput(input, row.file)) ||
          (stageClosure(stage)?.has(row.file) ?? false),
      ).map((stage) => stage.name),
    }))
    .map((row) => ({
      ...row,
      everyKey: GLOBAL_FORCE.some((pattern) => globMatch(pattern, row.file)),
      exempt: KEY_EXEMPT_PINNED[row.file] ?? null,
    }));
}

/**
 * Which stage's key is behind each file the pin holds, fewest keys first, or `null` when the
 * pin will not resolve.
 *
 * The question a reader asks of a *pin* rather than of a run, and the one the coverage
 * invariant states: a pinned file no stage's inputs name is behind no key at all, so a change
 * to it re-runs nothing and the pin's own verdict about it is the only thing that would move.
 * The order is the answer, not decoration — a file behind one key is the file whose change is
 * nearly invisible, so it is read first, and the files behind none lead the list.
 *
 * It is asked of the *declarations* and not of the tree on disk: `--explain-cache` describes a
 * run's keys, which cover the files that are there, while this describes the pin, whose files
 * include the one that was deleted. `GLOBAL_FORCE` is reported apart from the stages because
 * it is not one: it is the reason every key moves, and a file relying on it alone is relying
 * on a dependency bump, a `tsconfig.json` or a workflow to re-run a gate.
 *
 * The rows say which stages match a file, which rule pinned it and which files the exemptions
 * excuse, and the run refuses to start when a row is behind neither — see `coverageGaps`
 * below, which is the same question asked as a gate rather than as a report. The rule matters
 * most in that failure: "name it in a stage's inputs" is only actionable once a reader knows
 * which family the file belongs to, and the pin is the only thing that knows. The `suggested`
 * and `suggestedBy` fields carry the other half — the stage that should have named it, when the
 * rule's own family points at one (`stageSuggestions`), and the file already behind that stage's
 * key that earned it — so the repair reads as a stage to edit, with a sibling to extend it
 * beside, rather than as a family to decode.
 */
async function pinnedCoverage() {
  const rows = await pinnedRows();
  if (rows === null) return null;
  const suggested = stageSuggestions(rows);
  return rows
    .map((row) => {
      const plan = suggested.get(row.file) ?? null;
      return { ...row, suggested: plan?.stage ?? null, suggestedBy: plan?.via ?? null };
    })
    .sort(
      (left, right) => left.keys.length - right.keys.length || left.file.localeCompare(right.file),
    );
}

/** How long `node --check` gets before the check gives up on a script. Generous, because the file
 * is one a stage is about to spawn anyway: a refusal that takes longer than this is a machine in
 * trouble rather than a large script, and it is reported as a refusal either way. */
const SYNTAX_CHECK_TIMEOUT_MS = 20_000;

/**
 * The scripts the run will actually spawn that node refuses to compile, as
 * `{ file, line, message }`.
 *
 * The scope is the run's own: the same `stage.script()` reading it takes when it spawns them, so a
 * `CI_*_SCRIPT` stub stands in here exactly as it does there and a run narrowed by `--only`,
 * `--changed-only` or a cache reuse never refuses over a file it is not about to run. The bundled tools under `node_modules` are skipped —
 * they are the package's to keep loadable, not this checkout's — and so is anything that is not a
 * `.mjs` or is no longer on disk, which is the drift alarm's finding rather than a parse error.
 *
 * A stage script cut off mid-expression parses as nothing, and every stage that touches it reports
 * a *different* failure for it: the lint stage a finding in a file it never linted, the gate that
 * runs it a killed process with no JSON, the suite whose subject never loaded a wall of assertion
 * failures, and the drift alarm a pin that moved. The reader is left to work out that one
 * truncated write is the whole of it. So the run asks node itself, once, before any stage can
 * mis-attribute the breakage: `--check` is the same parser that is about to load the script, so the
 * guard's verdict and the stage's crash are one statement, said earlier and in the right place.
 *
 * The checks run in parallel, because node's start-up dominates each one and this runs before every
 * stage, cache or no cache.
 */
async function unparsableScripts(stages) {
  const scripts = [
    ...new Set(stages.map((stage) => stage.script?.()).filter((path) => typeof path === "string")),
  ].filter(
    (path) => path.endsWith(".mjs") && !rel(path).startsWith("node_modules/") && existsSync(path),
  );
  const checked = await Promise.all(
    scripts.map(async (path) => {
      const failure = await checkSyntax(path);
      return failure === null ? null : { file: rel(path), ...failure };
    }),
  );
  return checked
    .filter((item) => item !== null)
    .sort((left, right) => left.file.localeCompare(right.file));
}

/**
 * `node --check <path>`, as `{ line, message }` when node refuses the file and `null` when it
 * compiles it.
 *
 * The location comes from node's own first line (`<path>:<line>`) and the message from the
 * `SyntaxError:` line beneath it, so the guard quotes the parser rather than paraphrasing it. A
 * refusal carrying neither — a binary that could not start, a file that vanished mid-check — is
 * still a refusal: it is reported with `line: null` and its first line of stderr as the message,
 * because a script the run cannot ask about is not a script the run may assume is whole.
 */
function checkSyntax(path) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--check", path],
      { timeout: SYNTAX_CHECK_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve(null);
          return;
        }
        const lines = `${stderr ?? ""}`.split(/\r?\n/);
        const where = /^(.*):(\d+)\s*$/.exec(lines[0] ?? "");
        const named = lines.find((line) => /^[A-Za-z]*Error: /.test(line));
        resolve({
          line: where === null ? null : Number(where[2]),
          message: named ?? lines.find((line) => line.trim() !== "") ?? "node could not parse it",
        });
      },
    );
  });
}

/** One row of the coverage map, as the keys behind it — or the absence of any — are named. */
function coverageLabel(row) {
  if (row.keys.length > 0) return `${row.keys.join(", ")}${row.everyKey ? " + every key" : ""}`;
  if (row.everyKey) return "every key";
  return row.exempt === null ? "NO KEY" : "EXEMPT";
}

/** The last run's recorded passes, or an empty cache when there is no usable one. */
function loadCache() {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (parsed?.version === CACHE_VERSION && parsed.stages && typeof parsed.stages === "object") {
      return parsed;
    }
  } catch {
    // A missing, unreadable or older cache is simply a cold one; paying for a full
    // run is always the safe answer, so this is never an error.
  }
  return { version: CACHE_VERSION, stages: {} };
}

/** Writes the merged cache back, so the next run can reuse what this one proved. */
function saveCache(cache) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  } catch {
    // A cache that cannot be written only costs the next run its reuse.
  }
}

/** A compact human age, in the largest unit that fits: `8d`, `26h`, `45m`, `3s`. */
function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "an unknown age";
  for (const [unit, size] of [["d", 86400000], ["h", 3600000], ["m", 60000], ["s", 1000]]) {
    if (ms >= size) return `${Math.floor(ms / size)}${unit}`;
  }
  return "0s";
}

/**
 * Parses `--cache-ttl`: `<n>` or `<n>s|m|h|d`, with `0` (any spelling) meaning no
 * cap. Anything else answers `null`, so the caller can refuse it rather than drop a
 * cap the user believes is protecting them.
 */
function parseCacheTtl(value) {
  const text = String(value).trim();
  const match = /^(\d+)([smhd])?$/.exec(text);
  if (!match) return null;
  const size = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2] ?? "s"];
  const ms = Number(match[1]) * size;
  return ms === 0 ? Infinity : ms;
}

// What each stage *does*, by name — the one half of a stage that cannot live in the alarm's table,
// because it is this file's own code. Everything else about a stage is declared once, in
// `STAGE_TABLE` in `.freebuff/gate-drift.mjs`: the `label` every report calls it, the gate `script`
// it runs and the override a test drives that script through, the `inputs` its cache key is built
// from, and `editsTree` when its pass rewrites the working tree. `STAGES` below is that table mapped
// through this record, so this file cannot restate a label, a script or an input list — and it
// cannot reorder the pass either, since the order a run takes is the table's own. A stage declared
// there with no run here, or a run here for a stage the table does not name, fails as this file
// loads rather than at the moment a run reaches it.
//
// A stage that runs a gate script *declares* it rather than building the path inside its own `run`:
// the script is part of what the stage is — its key has to cover the script and every module that
// script reads, which is the invariant `src/test/ci-runner.test.ts` holds — and `--explain-cache`
// reports it, so a reader can see which machinery a key belongs to. The two stages without one run a
// published tool (`tsc`, `vitest`) whose machinery is pinned by the lockfile in `GLOBAL_FORCE`
// instead.
const STAGE_RUNS = {
  typecheck: runTypecheck,
  runbook: (stage) =>
      runJsonGate({
        name: "runbook",
        script: stage.script(),
        extraArgs: () => ["--check"],
        summarize(payload) {
          const upToDate = payload.gate === "pass";
          return {
            pass: upToDate,
            summary: upToDate
              ? `${payload.sections ?? 0} section(s), Contents up to date`
              : `Contents is stale (${payload.sections ?? 0} section(s))`,
            details: upToDate
              ? []
              : [
                  {
                    mark: "STALE",
                    name: "",
                    detail: payload.message ?? "a heading changed without the Contents being regenerated",
                    fix: "npm run runbook:contents, then commit the result",
                  },
                ],
          };
        },
      }),
  lint: (stage) =>
      runJsonGate({
        name: "lint",
        script: stage.script(),
        extraArgs: () => [],
        summarize(payload) {
          const findings = payload.findings ?? [];
          const pass = payload.gate === "pass";
          // ESLint reports in file order, so a flat list of `file:line:col` rows is almost a
          // grouping already — the fold makes it one, pairing each file with how many findings are
          // in it, so a reader fixing a file sees everything in that file together instead of
          // hunting for its rows among the others. Grouped over the *shown* rows, so a heading's
          // count is the rows under it and the `raw` line below still carries the total.
          const shown = findings.slice(0, 12);
          const byFile = new Map();
          for (const finding of shown) {
            if (!byFile.has(finding.file)) byFile.set(finding.file, []);
            byFile.get(finding.file).push(finding);
          }
          return {
            pass,
            summary: pass
              ? `${payload.files ?? 0} file(s), no findings`
              : payload.error
                ? "ESLint could not run"
                : `${findings.length} lint finding(s)`,
            details: foldedDetails(
              [...byFile].map(([file, rows]) => ({
                mark: "FILE",
                label: `${file} (${rows.length})`,
                rows: rows.map((finding) => ({
                  mark: finding.severity === 2 ? "ERR" : "WARN",
                  name: `${finding.file}:${finding.line}:${finding.column}`,
                  detail: `${finding.rule}: ${finding.message}`,
                  location: { file: finding.file, line: finding.line, column: finding.column },
                })),
              })),
            ),
            raw: findings.length > 12 ? [`… and ${findings.length - 12} more finding(s)`] : [],
          };
        },
      }),
  // The capture sits between the stage's run and its result so the close and
  // the payload quote the reading this run's suite left — a reused or failed
  // stage reads null/last-attempt honestly below.
  test: (stage) => {
    const result = runTest(stage);
    captureRenderedLinksCoverage();
    return result;
  },
  preflight: (stage) =>
      runJsonGate({
        name: "preflight",
        script: stage.script(),
        // The preflight takes space-separated values, so pass them through as-is.
        extraArgs() {
          const out = [];
          for (const flag of ["--port", "--timeout"]) {
            const value = option(flag);
            if (value !== undefined) out.push(flag, value);
          }
          return out;
        },
        summarize(payload) {
          const failed = (payload.checks ?? []).filter((check) => check.status === "fail");
          const warnings = (payload.checks ?? []).filter((check) => check.status === "warn");
          return {
            pass: payload.gate === "pass",
            summary:
              payload.gate === "pass"
                ? `${payload.checks?.length ?? 0} check(s), ${warnings.length} warning(s)`
                : `gate "fail", ${failed.length} check(s) failed`,
            details: [
              ...failed.map((check) => ({
                mark: "FAIL",
                name: check.name,
                detail: check.detail,
                fix: check.fix,
              })),
              ...(payload.gate === "pass"
                ? warnings.map((check) => ({ mark: "WARN", name: check.name, detail: check.detail }))
                : []),
            ],
          };
        },
      }),
  // The pinned hashes of the gate machinery, compared before the three stages that
    // rewrite part of it. Read-only and instant, so unlike those it is cacheable: nothing
    // it looks at changes when a mutation check restores what it weakened, so a recorded
    // pass is still a true statement about the tree. It goes *before* them so a script
    // loosened outside the lock — the one case no lock can recover, because no run ever
    // wrote one — is reported as drift rather than surfacing second-hand as a mutation
    // check that can no longer find its anchor. `.freebuff/gate-drift.mjs` owns the
  // manifest, its watch rules, and the `--write` that re-pins it. Its own inputs — the alarm's
  // watch rules *themselves*, plus the manifest no rule can name — are declared with the rest of
  // the stage list in `.freebuff/gate-drift.mjs`, so a family a rule watches is behind this stage's
  // key in the same edit that watches it.
  drift: (stage) =>
      runJsonGate({
        name: "drift",
        script: stage.script(),
        extraArgs: () => [],
        summarize(payload) {
          const findings = payload.findings ?? [];
          const pass = payload.gate === "pass";
          const slug = { changed: "CHANGED", unpinned: "UNPINNED", gone: "GONE" };
          // Grouped once and read twice: the summary names the families that moved, and the
          // details below fold the same rows under the same labels, so the sentence and the rows
          // cannot disagree about which family a finding belongs to. `pinFamilies` is what makes
          // the *order* the pin's own — a family nothing but the re-key measures leads the red
          // run — and a run with no pin to read simply orders by how much moved.
          const moved = movedFamilyGroups(findings, pinFamilies, pinWatches);
          return {
            pass,
            summary: pass
              ? `${payload.checked ?? 0} gate file(s) pinned, all match`
              : payload.message
                ? "the pin could not be applied"
                : `${findings.length} gate file(s) no longer match the pin — ${movedFamiliesClause(moved)}` +
                  // The alarm's refusal, when one of the moved families is behind no stage's key:
                  // the re-pin the raw line below advises is not the whole repair for those, and
                  // the summary is the one string the log, the `--json` report, the run page and
                  // the nightly comment all carry. Its sentence, so the two surfaces cannot say
                  // two different things about which families nothing measures.
                  (payload.refusal ? `. ${payload.refusal}` : ""),

            details: [
              // A manifest that could not be read, or a drifted pin, is the whole
              // finding — name it and point at the one command that answers it.
              ...(payload.message
                ? [{ mark: "FAIL", name: "", detail: payload.message }]
                : []),
              // The diff cache the alarm keeps, when this run could not write it where it
              // belongs. The pass still stands — the pin matches — but the text that run
              // matched is either somewhere the OS may clear or gone, and either way the
              // *next* drift is at risk of being hashes with no text, which is precisely the
              // reading this feature exists to replace. So it is said on the run page rather
              // than only on the CLI. A `WARN` mark is what makes it a warning detail:
              // printed on a passing stage, annotated as `::warning`, and listed under the
              // nightly summary's Warnings heading.
              //
              // A payload carrying a `stash` *and* a `warning` is the fallback case, and it
              // is deliberately not special-cased here: the warning is the fact, whatever
              // became of the text, and a consumer that read `stash` as "nothing to report"
              // would drop the one thing this stage exists to surface. What the warning says
              // is the alarm's sentence, so the two states can differ without this stage
              // knowing which one it is holding.
              //
              // The alarm's `cause` rides with it, joined rather than dropped: a warning
              // nobody can act on sends a reader to the CLI, and the reason the write was
              // refused is the one thing on the run page they can. It is its own field on
              // the payload (`--json` consumers read it apart) and one sentence here,
              // because this detail is the only string the human report, the annotation and
              // the nightly bullet have room for — and the sentence a reader gets is
              // `…could not be stashed; EEXIST: file already exists, mkdir '…' — writing to
              // .ci/gate-content`, which is the what and the why in one line.
              ...(payload.warning
                ? [
                    {
                      mark: "WARN",
                      name: "",
                      detail: payload.cause
                        ? `${payload.warning}; ${payload.cause}`
                        : payload.warning,
                    },
                  ]
                : []),
              // The loosening itself, when the alarm had the pinned text to diff against:
              // one row per gate file whose `detail` stays the one-line hash statement and
              // whose `diff` is printed under it, folded into its annotation, and fenced
              // on the nightly page. A reader deciding whether a change was meant should
              // not have to resolve a hash to find out what moved.
              //
              // The rows fold under a heading per watch family — the same grouping and the same
              // labels and counts as the summary clause above — so a whole-tree re-pin reads as a
              // few families rather than forty interchangeable paths. A pinned path no rule names
              // any more gets its own heading rather than drifting between families. The headings
              // are the family view `--status` prints, meeting the reader at the moment it matters:
              // red, with the rule to re-check standing over the files that moved under it.
              ...movedFamilyDetails(moved, slug, pinOwners),
            ],
            raw: pass
              ? []
              : ["re-pin a deliberate change with `npm run gates:pin`, and say why in the diff"],
          };
        },
      }),
  "mutation-example": (stage) =>
      runJsonGate({
        name: "mutation-example",
        // The cheapest gate in the run — and the proof that a fifth JSON gate flows through the
        // pre-pass: a vocabulary hole reds here before the sweep's run mode is ever spawned.
        vocabularyFirst: true,
        script: stage.script(),
        extraArgs: () => [],
        summarize(payload) {
          const survivors = payload.survivors ?? [];
          return {
            pass: payload.gate === "pass",
            summary:
              (payload.gate === "pass"
                ? `${payload.checked ?? 0} demonstration stamp(s) checked, no survivors`
                : `${payload.checked ?? 0} checked, ${survivors.length} survivor(s)`),
            details: survivors.map((item) => ({
              mark: `SURVIVED (${item.kind})`,
              name: item.line === null ? item.path : `${item.path}:${item.line}`,
              detail: item.detail ? `${item.descriptor} — ${item.detail}` : item.descriptor,
              location: { file: item.path },
            })),
          }; 
        },
      }),
  "mutation-fifth": (stage) =>
      runJsonGate({
        name: "mutation-fifth",
        // The scaffold's smoke stage: the same read-only demonstration shape as the stage
        // above, so the pre-pass rides every read-only vocabulary gate the table declares.
        vocabularyFirst: true,
        script: stage.script(),
        extraArgs: () => [],
        summarize(payload) {
          const survivors = payload.survivors ?? [];
          return {
            pass: payload.gate === "pass",
            summary:
              (payload.gate === "pass"
                ? `${payload.checked ?? 0} demonstration stamp(s) checked, no survivors`
                : `${payload.checked ?? 0} checked, ${survivors.length} survivor(s)`),
            details: survivors.map((item) => ({
              mark: `SURVIVED (${item.kind})`,
              name: item.line === null ? item.path : `${item.path}:${item.line}`,
              detail: item.detail ? `${item.descriptor} — ${item.detail}` : item.descriptor,
              location: { file: item.path },
            })),
          };
        },
      }),
  "mutation-coverage": (stage) =>
      runJsonGate({
        name: "mutation-coverage",
        // A vocabulary hole reds here on its own, before the launcher is ever spawned.
        vocabularyFirst: true,
        script: stage.script(),
        extraArgs: () => [],
        summarize(payload) {
          const survivors = payload.survivors ?? [];
          // The survivor's own kind says which failure this is: the gate's test
          // file did not notice the weakening, or the check could not answer at
          // all (a drifted anchor, a file that would not load, a skipped case).
          const group = { survived: "SURVIVED WEAKENING", broken: "CHECK BROKEN" };
          const recovered = recoveryDetails(payload);
          return {
            pass: payload.gate === "pass",
            summary:
              (payload.gate === "pass"
                ? `${payload.checked ?? 0} coverage gate(s) checked, no survivors`
                : `${payload.checked ?? 0} checked, ${survivors.length} survivor(s)`) +
              recoveredNote(payload.recovered),
            // The recovery comes first: it is the older event, and it is the one a
            // reader can act on (the run already put the file back).
            details: [
              ...recovered,
              ...survivors.map((item) => ({
                mark: group[item.kind] ?? `SURVIVED (${item.kind})`,
                name: item.line === null ? item.path : `${item.path}:${item.line}`,
                detail: item.detail ? `${item.descriptor} — ${item.detail}` : item.descriptor,
                location: { file: item.path },
              })),
            ],
          };
        },
      }),
  "mutation-preflight": (stage) =>
      runJsonGate({
        name: "mutation-preflight",
        // A vocabulary hole reds here on its own, before the sweep is ever spawned.
        vocabularyFirst: true,
        script: stage.script(),
        // `--limit=<n>` and nothing else: this sweep's own selector is `--only=<id>`,
        // which the runner already spends on *stages*, so a slice is taken by count.
        // `--file=` filters a different table (route mutations) and `--no-fail-open`
        // suppresses a pass this sweep does not make.
        extraArgs: () => valueFlag("--limit"),
        summarize(payload) {
          const survivors = payload.survivors ?? [];
          // The two kinds are kept apart because the repairs differ: `survived` is a
          // branch the suite stopped noticing (a test to add), `broken` is an anchor or a
          // test run the sweep could not answer at all (a table to re-fit).
          const group = { survived: "SURVIVED MUTATION", broken: "CHECK BROKEN" };
          const recovered = recoveryDetails(payload);
          return {
            pass: payload.gate === "pass",
            summary:
              (payload.gate === "pass"
                ? `${payload.checked ?? 0} preflight mutation(s) checked, no survivors`
                : `${payload.checked ?? 0} checked, ${survivors.length} survivor(s)`) +
              recoveredNote(payload.recovered),
            // The recovery comes first, for the same reason it does above: it is the older
            // event, and the one a reader can act on.
            details: [
              ...recovered,
              ...survivors.map((item) => ({
                mark: group[item.kind] ?? `SURVIVED (${item.kind})`,
                name: `${item.path}  ${item.id ?? item.descriptor}`,
                detail: item.detail ? `${item.descriptor} — ${item.detail}` : item.descriptor,
                location: { file: item.path },
              })),
            ],
          };
        },
      }),
  mutation: (stage) =>
      runJsonGate({
        name: "mutation",
        // A vocabulary hole reds here on its own, before the sweep is ever spawned.
        vocabularyFirst: true,
        script: stage.script(),
        // The sweep reads `--flag=value` (and `--no-fail-open` is a bare flag).
        extraArgs() {
          const out = [...valueFlag("--limit"), ...valueFlag("--file")];
          if (process.argv.includes("--no-fail-open")) out.push("--no-fail-open");
          return out;
        },
        summarize(payload) {
          const survivors = payload.survivors ?? [];
          // The mark a survivor carries into this stage's report, its annotations and the
          // run page, and the word its count is named by in the summary line. Both read
          // the `kind` the sweep recorded, and the families inside the sweep's own file
          // are kept apart on purpose: `self` is a test helper, `runner` is a check inside
          // the runner itself (neither a helper nor a detector), `lock` is one of the
          // answers the shared `.freebuff/mutation-lock.mjs` gives this runner and the three
          // tree-editing checks, `ratchet` is the declared-table hold in
          // `src/test/declared-strikes.ts` itself, `convention` is a
          // detector that reported nothing at all, and `limb` is one limb of one that went
          // dark while the rest of it still bites. Folding the last two together would
          // report a limb as if the whole rule were unenforced, which is a different and
          // much smaller claim.
          const group = {
            guard: "SURVIVED GUARD",
            failopen: "SURVIVED FAIL-OPEN",
            catch: "UNDRIVEN CATCH",
            self: "SURVIVED HELPER",
            runner: "SURVIVED RUNNER",
            lock: "SURVIVED LOCK",
            ratchet: "SURVIVED RATCHET",
            convention: "SURVIVED DETECTOR",
            limb: "SURVIVED DETECTOR LIMB",
            // Never a survivor: `broken` is a strike the sweep could not apply at all —
            // an anchor no longer in the file it rewrites — so it carries the preflight
            // sweep's word for the same repair, a table (here, an anchor) to re-fit.
            broken: "CHECK BROKEN",
          };
          const noun = {
            guard: "guard",
            failopen: "fail-open guard",
            catch: "undriven catch",
            self: "helper",
            runner: "runner check",
            lock: "lock check",
            ratchet: "declared-table ratchet",
            convention: "whole detector",
            limb: "detector limb",
            broken: "broken strike",
          };
          // Counted per kind, in the order above rather than in the order the sweep
          // happened to run, so the line reads the same whatever a run finds first; a
          // kind nothing survived under is left out rather than printed as a zero.
          const counted = Object.keys(noun)
            .map((kind) => [noun[kind], survivors.filter((item) => item.kind === kind).length])
            .filter(([, count]) => count > 0)
            .map(([word, count]) => `${count} ${word}`);
          const unclassified = survivors.filter((item) => !(item.kind in noun)).length;
          if (unclassified > 0) counted.push(`${unclassified} unclassified`);
          const breakdown = counted.length > 0 ? `: ${counted.join(", ")}` : "";
          // The sweep's two readings about the run *as a whole*, carried out of its
          // JSON and onto the stage line the run page renders: `thinMargin` — how many
          // detector limbs a single test case alone holds up (a count that may fall
          // and may not rise; each one is one edit from a limb going dark) — and
          // `unstruck` of `decisionSites` — how many decisions in the detectors no
          // strike reaches. Each clause rides only when the payload carries the fields,
          // so a stub, the baseline shape or a refusal prints no clause rather than a
          // zero it never measured.
          const auditNote =
            (typeof payload.thinMargin === "number"
              ? ` — ${payload.thinMargin} thin-margin limb(s)`
              : "") +
            (typeof payload.unstruck === "number" && typeof payload.decisionSites === "number"
              ? ` — ${payload.unstruck} of ${payload.decisionSites} decision(s) un-struck`
              : "");
          // A margin regression is the warning the gate stays green for — nothing is
          // broken while the one case still holds the limb — so each thin limb rides as
          // a `WARN` detail: the run page's Warnings section and a `::warning`
          // annotation, naming the detector file and the single case that notices it,
          // the same line the sweep's own THIN MARGIN section prints. It is derived
          // from the recorded margins rather than counted again, so the warning names
          // the limb instead of only its number.
          const thinLimbs =
            typeof payload.thinMargin === "number" && payload.thinMargin > 0
              ? (payload.strikes ?? []).filter((item) => item.kind === "limb" && item.margin === 1)
              : [];
          // …and the recorded baseline's own regression: the sweep carries the count
          // `.freebuff/mutation-baseline.json` ratchets (`unstruckBaseline`) beside the
          // count this run measured, and a run past it is the gap having grown. Reported
          // and not failed — the detectors still report and the gate below still passes —
          // because the ratchet (`--baseline`) owns the failure and names the decisions;
          // what the run page owes a night nobody reads the sweep's log is the warning.
          // Both numbers or neither: a payload that never saw a baseline (a stub, a tree
          // with none recorded) carries no comparison, so nothing here can fabricate one.
          const unstruckGrowth =
            typeof payload.unstruck === "number" &&
            typeof payload.unstruckBaseline === "number" &&
            payload.unstruck > payload.unstruckBaseline
              ? payload.unstruck - payload.unstruckBaseline
              : null;
          const unstruckDetail =
            unstruckGrowth === null
              ? null
              : `${payload.unstruck}${
                  typeof payload.decisionSites === "number" ? ` of ${payload.decisionSites}` : ""
                } decision(s) un-struck, past the recorded baseline of ${
                  payload.unstruckBaseline
                } by ${unstruckGrowth} — \`node .freebuff/mutation-guards.mjs --baseline\` ` +
                "names the decisions, `--write-baseline` re-records the list once strikes reach them again";
          return {
            pass: payload.gate === "pass",
            summary:
              (payload.gate === "pass"
                ? `${payload.checked ?? 0} mutation(s) checked, no survivors`
                : `${payload.checked ?? 0} checked, ${survivors.length} survivor(s)${breakdown}`) +
              recoveredNote(payload.recovered) +
              auditNote,
            details: [
              ...recoveryDetails(payload),
              ...thinLimbs.map((item) => ({
                mark: "WARN THIN MARGIN",
                name: item.path,
                detail:
                  `${item.descriptor} — one case alone notices it: ` +
                  `"${item.caughtBy[0]}" (${item.test})`,
                location: { file: item.path },
              })),
              ...(unstruckDetail === null
                ? []
                : [
                    {
                      mark: "WARN UN-STRUCK GROWTH",
                      detail: unstruckDetail,
                    },
                  ]),
              ...survivors.map((item) => ({
                mark: group[item.kind] ?? `SURVIVED (${item.kind})`,
                name: item.line === null ? item.path : `${item.path}:${item.line}`,
                // A `broken` survivor carries why in `detail` (its anchor no longer
                // occurs); every other kind's reason is its descriptor alone.
                detail: item.detail ? `${item.descriptor} — ${item.detail}` : item.descriptor,
                location: { file: item.path, ...(item.line === null ? {} : { line: item.line }) },
              })),
            ],
          };
        },
      }),
};

/**
 * The stage list: the table's declarations, each paired with the run this file declares for it.
 *
 * The order is the table's, so the list a run takes cannot be restated here, and the script each
 * entry carries is the table's `{ env, path }` resolved through `stageScript` — the same override
 * seam tests drive a stage through, declared beside the stage instead of beside the run that spawns
 * it. The two refusals below are load-time because both are mistakes a run would otherwise report
 * from the middle of its own output.
 */
const STAGES = STAGE_TABLE.map((declared) => ({
  ...declared,
  ...(declared.script === undefined
    ? {}
    : { script: () => stageScript(declared.script.env, declared.script.path) }),
  run: STAGE_RUNS[declared.name],
}));

const missingRun = STAGES.filter((stage) => stage.run === undefined).map((stage) => stage.name);
if (missingRun.length > 0) {
  throw new Error(`no run declared for the ${missingRun.join(", ")} stage(s)`);
}
const undeclaredRun = Object.keys(STAGE_RUNS).filter((name) => !STAGE_NAMES.includes(name));
if (undeclaredRun.length > 0) {
  throw new Error(`a run is declared for ${undeclaredRun.join(", ")}, which the stage table does not name`);
}

// --- GitHub annotations -----------------------------------------------------

/**
 * A stage result with every name it publishes made publishable. A failure detail
 * that names a secret-looking file — a mutation survivor, a lint finding, a test
 * file — has that name collapsed before it reaches any consumer of the result: the
 * human report, the `--json` payload the nightly job uploads, and a GitHub
 * annotation, which all read the same detail. Redacting here, at the one point a
 * result enters the run, is what keeps those four from disagreeing; a name is
 * replaced, a count or a line is not, and a detail whose prose quotes a
 * secret-looking path (`redactText`) is scrubbed too.
 */
function redactResult(result) {
  if (!result?.details) return result;
  return {
    ...result,
    summary: redactText(result.summary),
    details: result.details.map((detail) => ({
      ...detail,
      ...(detail.name ? { name: redactInput(detail.name) } : {}),
      ...(detail.detail ? { detail: redactText(detail.detail) } : {}),
      ...(detail.diff ? { diff: redactText(detail.diff) } : {}),
      ...(detail.fix ? { fix: redactText(detail.fix) } : {}),
      ...(detail.location?.file
        ? { location: { ...detail.location, file: redactInput(detail.location.file) } }
        : {}),
    })),
    ...(result.raw ? { raw: result.raw.map(redactText) } : {}),
  };
}

/**
 * The annotation a detail earns: the location to pin on the diff (when it names
 * one), a level from its mark, and its message — with the fix, if it carries
 * one. Details that name no location (a stale Contents, a failed preflight
 * check) still annotate, just without a file, so the summary carries them too.
 */
function annotationFor(stage, detail) {
  const location = detail.location ?? {};
  const warning = String(detail.mark).startsWith("WARN");
  return {
    level: warning ? "warning" : "error",
    ...(location.file ? { file: location.file } : {}),
    ...(location.line !== undefined ? { line: location.line } : {}),
    ...(location.column !== undefined ? { column: location.column } : {}),
    title: stage.label,
    // The diff rides in the message rather than becoming an annotation per line: GitHub
    // decodes the escaped newlines, so one annotation per gate file carries the change,
    // and the step's annotation count stays at one per finding.
    message: [
      detail.diff ? `${detail.detail}\n\n${detail.diff}` : detail.detail,
      ...(detail.fix ? [`(fix: ${detail.fix})`] : []),
    ].join(" "),
  };
}

/** GitHub escapes `%`, CR and LF in a workflow command's data. */
const escapeData = (text) =>
  String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** …and also `:` and `,`, which delimit a command's property list. */
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** Renders one annotation as a GitHub Actions workflow command. */
function workflowCommand(annotation) {
  const props = [];
  if (annotation.file) props.push(`file=${escapeProperty(annotation.file)}`);
  if (annotation.line !== undefined) props.push(`line=${annotation.line}`);
  if (annotation.column !== undefined) props.push(`col=${annotation.column}`);
  props.push(`title=${escapeProperty(annotation.title)}`);
  return `::${annotation.level} ${props.join(",")}::${escapeData(annotation.message)}`;
}

// --- The run ----------------------------------------------------------------

// The pass's order and names, imported from the table rather than derived again here: the audit
// below holds every copy of the order in the tree to *this* list, so there is one array to compare
// against and none beside it that a reordering could quietly disagree with.
const only = option("--only")
  ?.split(",")
  .map((name) => name.trim())
  .filter(Boolean);

/**
 * The stages `--skip` removes, in canonical order. It subtracts from whatever
 * selection the other flags produced (so it composes with `--only` and
 * `--from`), and it is meant for a stage the *host* cannot run rather than one
 * the change did not touch — `--changed-only` is the flag for the latter.
 */
const skip = option("--skip")
  ?.split(",")
  .map((name) => name.trim())
  .filter(Boolean);

// A name that is not a stage is a typo, and silently ignoring it would let a
// narrowed gate look green. Name the offending token(s) instead.
/**
 * A failure that stops the run before any stage: a usage error a person typed, or a
 * configuration the run will not vouch for. On stderr for a person, and as the JSON report
 * under `--json` with `extra` spread in, since some of these carry their own evidence.
 */
function abort(message, extra = {}) {
  if (JSON_OUTPUT) {
    writeStdoutSync(
      `${JSON.stringify({ gate: "fail", exitCode: 1, error: message, ...extra, stages: [], failed: [], skipped: [], annotations: [] }, null, 2)}\n`,
    );
  }
  console.error(`ci: ${message}`);
  process.exit(1);
}

// Both `--json` and `--github-annotations` spell their output on stdout, so
// honouring one would corrupt the other: the report would carry workflow
// commands, or the commands would be swallowed inside the JSON object.
if (GITHUB_ANNOTATIONS && JSON_OUTPUT) {
  abort(
    "--github-annotations and --json both write stdout — with --json read the report's `annotations`, or drop --json to print workflow commands",
  );
}

// The candidate `--status --watch=` is asked about: a file path or a watch rule, read but never
// applied. It is a question about the pin's family view, which only `--status` prints, so a run
// that is not asking for that view would silently ignore it rather than answer it — and a bare
// `--watch` at the end of the line reads as no value at all, which is a typo worth naming rather
// than a run that quietly answers a different question.
const watchAsked = process.argv.some((arg) => arg === "--watch" || arg.startsWith("--watch="));
const watchSpec = watchAsked ? (option("--watch") ?? "").trim() : null;
if (watchSpec !== null && !process.argv.includes("--status")) {
  abort(
    "--watch reads the pin's family view, so it needs --status — run `npm run gates:status -- --watch=<file-or-rule>`",
  );
}
if (watchSpec !== null && (watchSpec === "" || watchSpec.startsWith("--"))) {
  abort(
    `--watch needs a file path or a watch rule (dir/pattern), got ${watchSpec === "" ? "(nothing)" : watchSpec}`,
  );
}

// --- The stage order, stated once -------------------------------------------
//
// The order the stages run in is a fact about the declarations above (`STAGES`), and every other
// place that states it is a copy — the numbered list in this file's header, the runbook's account
// of the pass, the expectations in `src/test/ci-runner.test.ts`, the nightly job's own selection.
// A copy can be forgotten, and the failure is quiet: add a stage and the header still says nine,
// remove one and a test still expects it, and nothing complains, because nothing compares a copy
// to the table it copied. That table — `STAGE_TABLE` in `.freebuff/gate-drift.mjs` — is now the whole
// declaration, not only the `inputs`: a stage's label, the gate script it runs and the override a
// test drives it through, and whether its pass edits the working tree all live there too, so what is
// held here is the pass's *order and names* and the claims the entries make about themselves
// (`stageDeclarationGaps`).
//
// So the copies are made to answer to the table. Two of them are *generated* — one marked line in
// this file's header and one in the runbook, written by `--stages=write` — so the count and the
// order there cannot be typed by hand at all. The rest are *checked*: a list of stage names
// written in one of the files named below must be in canonical order relative to the others in
// it, a `N stage(s)` count on such a line must be the length of the list beside it, and the
// header's numbered enumeration must be the table. A disagreement is not a warning: the run
// **refuses to start** on one, before it opens its log, with the file, the line and both sides of
// the disagreement — the place and shape the pinned-file refusal below already uses, and for the
// same reason, because a run whose prose describes a different pass than the one it is about to
// run has told its reader something false before measuring anything.
//
// A line is read as a claim only when it speaks about the pass: a comma list of stage names is
// checked on a line that says `stage`/`stages` or that is a `--only`/`--skip`/`--from` selection,
// which is every place the pass is restated and not, say, the flag-forwarding table's "→ mutation,
// mutation-preflight" (a set, not an order, and named in its own words). Names are read by the
// last word of each comma-delimited item, so `typecheck)`, `"lint"`, `--skip=drift,` and
// `` `mutation-preflight` `` all count while `drift.mjs` and `mutation-coverage.ts` do not.
//
// `--stages` prints the order and exits (`--stages=json` for a machine, `--stages=check` to run
// the audit alone, `--stages=write` to regenerate the two generated lines), which is the fix path
// as much as the report: it answers from the declarations, so it is right on a tree this run has
// just refused. `CI_STAGE_ORDER_ROOT` points the audit at another tree, which is how its own tests
// drive a drifted copy without touching this one.

/** The markers the generated line lives between, in both files that carry one. */
const STAGE_ORDER_BEGIN = "<!-- stage-order:begin -->";
const STAGE_ORDER_END = "<!-- stage-order:end -->";

/** The heading whose numbered list enumerates the stages in this file's header. */
const STAGE_ORDER_HEADING = "## The stages, in order";

/** The one line a generated block holds: the count and the order, both derived. */
function stageOrderLine(names = STAGE_NAMES) {
  const written = names.map((name) => `\`${name}\``).join(", ");
  return `${names.length} stage(s), in canonical order: ${written}.`;
}

/** The file the stage table is declared in — where a claim about the declarations is corrected. */
const STAGE_TABLE_FILE = ".freebuff/gate-drift.mjs";

/**
 * The files whose stage-order claims this run checks, and what each one says about the pass —
 * the two that carry a generated line, the one the table itself is declared in, and the three
 * that state the order in their own words. A file that turns up missing is a finding rather than
 * a skip: every one of these is in the repository, so one that cannot be read is a watched claim
 * that went away. The table's own file is watched for the same reason as the rest — a list of
 * stages written in a comment there is a claim like any other, and it is the file a reader
 * consults when asking what the pass is — while the *declaration* is checked below by reading the
 * table rather than the file it is written in.
 */
const STAGE_ORDER_FILES = [
  { file: ".freebuff/ci.mjs", generated: true, enumerated: true },
  { file: ".freebuff/run.md", generated: true },
  { file: STAGE_TABLE_FILE },
  { file: "src/test/ci-runner.test.ts" },
  { file: "src/test/ci-runner-tree-editing.test.ts" },
  { file: ".github/workflows/nightly.yml" },
];

/** Where those files are read from: this project, or a tree a test is driving. */
const stageOrderRoot = process.env.CI_STAGE_ORDER_ROOT ?? ROOT;

/**
 * The snapshot `--stages=write` keeps beside the marked lines: the order and the count, in the
 * exact payload `--stages=json` prints, for a lint-time reader — an ESLint rule, a convention
 * guard — that must not spawn this runner once per file to learn what the table already says.
 * Written under `stageOrderRoot` like everything else this mode edits, so a test driving a
 * scratch tree never rewrites the checkout's copy, and committed rather than ignored so the
 * reader exists on a fresh clone.
 */
const STAGE_ORDER_SNAPSHOT_FILE = ".freebuff/stage-order.json";

/**
 * The stage name a comma-delimited item carries, or `null` when it carries none: a name is the
 * item's last word, so a list's first item can carry its own introduction (`have: lint`) without
 * hiding, and a file name is not a stage name (`drift.mjs` has no dotted stage in it).
 */
function stageNameIn(token) {
  const word = token.trim().split(/\s+/).pop() ?? "";
  const bare = word.replace(/^[^a-z-]+|[^a-z-]+$/g, "");
  return STAGE_NAMES.includes(bare) ? bare : null;
}

/** Every maximal comma-run of stage names on a line, in the order they are written. */
function stageNameRuns(line) {
  const runs = [];
  let run = [];
  for (const token of line.split(",")) {
    const name = stageNameIn(token);
    if (name === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(name);
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** Whether names are written in the table's own order — each one later in the pass than the last. */
function inCanonicalOrder(names) {
  const index = names.map((name) => STAGE_NAMES.indexOf(name));
  return index.every((value, position) => position === 0 || index[position - 1] < value);
}

/** A marker's text as a pattern literal, so `<!-- … -->` can be matched rather than spelled. */
function escapeMarkerText(marker) {
  return marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where a marker sits when it is a line of its own — optionally behind a block comment's `*`
 * gutter — or `null` when the file carries no such line.
 *
 * A line of its own is the whole rule, and it is what lets this file be watched by its own audit:
 * the two constants above spell the markers *inside their own declarations*, so a scan that took
 * any occurrence would read `const STAGE_ORDER_BEGIN = "…";` as a block that opens and closes on
 * one line and fail the very file that declares them.
 */
function markerLine(text, marker, from = 0) {
  const pattern = new RegExp(
    `^[ \\t]*(?:\\*[ \\t]*)?${escapeMarkerText(marker)}[ \\t]*\\r?$`,
    "gm",
  );
  pattern.lastIndex = from;
  return pattern.exec(text);
}

/** The gutter a marker line wears, so a rewrite keeps the file's own voice. */
function markerGutter(match, marker) {
  return match[0].slice(0, match[0].indexOf(marker));
}

/**
 * The text between two marker lines, with the gutter the markers wear taken back off — so a block
 * inside a block comment (` * <!-- … -->`) holds the same line as one in a Markdown file, and the
 * generated text is compared to the table rather than to the file's own margin.
 */
function stageOrderBlockBody(text, begin, end) {
  const gutter = markerGutter(begin, STAGE_ORDER_BEGIN);
  return text
    .slice(begin.index + begin[0].length, end.index)
    .split(/\r?\n/)
    .map((line) => (gutter !== "" && line.startsWith(gutter) ? line.slice(gutter.length) : line))
    .join("\n")
    .trim();
}

/** What a file's generated block holds: `absent`, `unterminated`, or the `written` line. */
function readStageOrderBlock(text) {
  const begin = markerLine(text, STAGE_ORDER_BEGIN);
  if (begin === null) return { state: "absent" };
  const afterBegin = begin.index + begin[0].length;
  const end = markerLine(text, STAGE_ORDER_END, afterBegin);
  if (end === null) {
    return { state: "unterminated", line: text.slice(0, begin.index).split(/\r?\n/).length };
  }
  return {
    state: "written",
    line: text.slice(0, begin.index).split(/\r?\n/).length,
    text: stageOrderBlockBody(text, begin, end),
  };
}

/** The numbered enumeration under the header's stage heading: its numbers and its names, in order. */
function readStageEnumeration(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(STAGE_ORDER_HEADING));
  if (start === -1) return null;
  // The list ends at the next heading, so a numbered item further down the file is somebody
  // else's list and not this one's.
  const after = lines.findIndex((line, position) => position > start && /^\s*\*\s+##\s/.test(line));
  const items = [];
  for (const line of lines.slice(start + 1, after === -1 ? undefined : after)) {
    const match = /^\s*\*\s+(\d+)\.\s+`([a-z-]+)`/.exec(line);
    if (match !== null) items.push({ number: Number(match[1]), name: match[2] });
  }
  return items;
}

/**
 * Rewrites the generated line in every file that carries one, and answers which it touched. A
 * file with no marker is left alone: the markers are the author's to place, and inventing one
 * would put a generated block somewhere nobody asked for one.
 */
function writeStageOrderBlocks(root = stageOrderRoot) {
  const rewritten = [];
  const line = stageOrderLine();
  for (const entry of STAGE_ORDER_FILES) {
    const path = join(root, entry.file);
    // A watched file that cannot be read is the audit's finding to make, not the generator's
    // crash: `--stages=write` is the repair for a drifted line, and refusing to run at all because
    // something else is missing would leave the lines it *can* fix unwritten.
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const begin = markerLine(text, STAGE_ORDER_BEGIN);
    if (begin === null) continue;
    const afterBegin = begin.index + begin[0].length;
    const end = markerLine(text, STAGE_ORDER_END, afterBegin);
    if (end === null) continue;
    if (stageOrderBlockBody(text, begin, end) === line) continue;
    const gutter = markerGutter(begin, STAGE_ORDER_BEGIN);
    writeFileSync(path, `${text.slice(0, afterBegin)}\n${gutter}${line}\n${text.slice(end.index)}`);
    rewritten.push(entry.file);
  }
  return rewritten;
}

/**
 * The line-level findings a stage-order claim in one file's text carries: a run of stage names
 * that is not the table's order, or a stated count that disagrees with its list. The "speaks"
 * filter gates both — a line only counts as a claim when it names a stage flag or says "stage" —
 * so incidental comma-separated words never read as an order claim.
 *
 * Extracted so `--watch-glob` can scan additional files — and the `--commentary` pass every
 * source file's comments — with the same two checks rather than duplicating the loop that
 * already lives in `stageOrderFindings`.
 */
function stageOrderLineFindings(text, file) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, position) => {
    const speaks = /stage/i.test(line) || /--(only|skip|from)[= ]/.test(line);
    if (!speaks) return;
    const runs = stageNameRuns(line);
    if (runs.every((run) => run.length < 2)) return;
    const outOfOrder = runs.find((run) => run.length > 1 && !inCanonicalOrder(run));
    if (outOfOrder !== undefined) {
      findings.push({
        file,
        line: position + 1,
        kind: "order",
        detail: `\`${outOfOrder.join(", ")}\` is not the canonical order`,
      });
    }
    // A single list beside a single count is the count's subject: `N stage(s): a, b, …` says N
    // is what follows. `X of Y stage(s) …` counts the run instead, so it is no claim about the
    // list and is left to the order check above.
    if (runs.length === 1 && !/\d+\s+of\s+\d+\s+stage\(s\)/.test(line)) {
      const stated = [...line.matchAll(/(\d+)\s+stage\(s\)/g)].pop();
      if (stated !== undefined && Number(stated[1]) !== runs[0].length) {
        findings.push({
          file,
          line: position + 1,
          kind: "count",
          detail: `it says ${stated[1]} stage(s) beside ${runs[0].length} name(s): ${runs[0].join(", ")}`,
        });
      }
    }
  });
  return findings;
}

/**
 * What a stage-order snapshot's text holds against the table: nothing when it is the payload
 * `--stages=json` prints, else one finding naming the disagreement — no `{ stages, count }`
 * payload at all, a count that is not its own list's length, or a list that is not the table's.
 * The comparison reads the parsed payload rather than the bytes: the file exists to be read by
 * something that will not spawn this runner (an ESLint rule, a convention guard), and such a
 * reader is lied to by the values, not by the whitespace.
 */
function stageSnapshotFindings(text, file) {
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch (error) {
    return [
      { file, line: null, kind: "snapshot", detail: `it is not valid JSON (${error.message})` },
    ];
  }
  const payload = snapshot !== null && typeof snapshot === "object" ? snapshot : {};
  const stages = payload.stages;
  const count = payload.count;
  if (!Array.isArray(stages) || typeof count !== "number") {
    return [
      {
        file,
        line: null,
        kind: "snapshot",
        detail: "it holds no `{ stages, count }` payload the lint-time reader expects",
      },
    ];
  }
  if (count !== stages.length) {
    return [
      {
        file,
        line: null,
        kind: "snapshot",
        detail: `its count says ${count} stage(s) beside ${stages.length} name(s): ${stages.join(", ")}`,
      },
    ];
  }
  const differs = stages.findIndex((name, position) => name !== STAGE_NAMES[position]);
  if (stages.length !== STAGE_NAMES.length || differs !== -1) {
    return [
      {
        file,
        line: null,
        kind: "snapshot",
        detail: `it holds "${stageOrderLine(stages)}" and the table says "${stageOrderLine()}"`,
      },
    ];
  }
  return [];
}

/**
 * Every file under `root` whose relative path matches one of `globs`, as a forward-slash
 * relative path — the additional files `--watch-glob` asks the audit to scan. A file already named
 * by `STAGE_ORDER_FILES` is skipped: it is scanned there with its own generated/enumerated checks,
 * and duplicating it would only repeat findings.
 */
function watchGlobFiles(root, globs) {
  const seen = new Set(STAGE_ORDER_FILES.map((entry) => entry.file));
  const matched = [];
  for (const abs of sourceFiles(root)) {
    const rel = relative(root, abs).replaceAll("\\", "/");
    if (seen.has(rel)) continue;
    if (globs.some((g) => globMatch(g, rel))) matched.push(rel);
  }
  return matched.sort();
}

/**
 * The directories a build, a cache or a duplicate checkout lives in — never read for a
 * stage-order claim. Each name holds a *copy* of source rather than the repository's own, so a
 * list in there belongs to an artifact, a dependency or a stale snapshot of this tree.
 */
const COMMENTARY_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "coverage",
  ".ci",
  ".coverage",
  ".temp",
  ".vitest-out",
  ".agents",
  // A full copy of this project extracted beside itself (the zip's own tree): a claim in there
  // belongs to a stale snapshot of the repository, not to this one.
  "PostBase-project",
]);

/**
 * The files a hand-written stage claim can live in: source and scripts. Documents are left to
 * `--watch-glob`, which reads them raw — a stronger check, since every comment is also readable
 * as raw text — and YAML has no JS comments to lex.
 */
const COMMENTARY_FILE = /\.(?:ts|tsx|mjs|js|cjs)$/;

/** Every file under `dir` the commentary pass reads, depth first. */
function commentaryFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (COMMENTARY_SKIP_DIRS.has(entry.name)) continue;
      commentaryFiles(join(dir, entry.name), out);
    } else if (COMMENTARY_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * The suite's own JavaScript lexer, ported — `tokenize` in `src/test/source-scan.ts` is the
 * original, and its rules are pinned there. Strings, templates and each run of identifier or
 * punctuation is one token, comments are skipped entirely (they are what `commentary` below
 * recovers), and a regexp literal tokenizes as division: the original's stated approximation,
 * a shape no comment in this tree wears. Ported rather than imported because this file is a
 * plain script the runner and the lint both execute directly, and `src/test/ci-stage-order.test.ts`
 * holds the port to the original over the same sources, so the two cannot drift into two
 * readings of what a file's prose says.
 */
function tokenize(source) {
  const tokens = [];
  let index = 0;
  const push = (start, end) => {
    tokens.push({ start, text: source.slice(start, end) });
  };
  while (index < source.length) {
    const ch = source[index];
    if (ch === "\n" || ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") {
      index += 1;
    } else if (ch === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (ch === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== ch) {
        if (source[index] === "\\") index += 1;
        index += 1;
      }
      index += 1;
      push(start, Math.min(index, source.length));
    } else if (/[A-Za-z0-9_$]/.test(ch)) {
      const start = index;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      push(start, index);
    } else {
      push(index, index + 1);
      index += 1;
    }
  }
  return tokens;
}

/**
 * The commentary of `source`: what the lexer did *not* claim as a token, in place — the file's
 * comments at their own offsets, every string and code token blanked to spaces, every newline
 * kept so a line number still points at the file.
 *
 * A stage list a *string* carries is an assertion, a fixture or captured output — the suite is
 * deliberately full of them, out of order on purpose — and code names stages one at a time, so
 * neither is a claim this pass may refuse. The claim is the one somebody wrote in prose. This
 * mirrors `commentary` in `src/test/convention-guards.ts`, which reads the same lexer the same
 * way; the probe case in `src/test/ci-stage-order.test.ts` drives both readings over one file.
 */
function commentary(source) {
  const chars = source.split("");
  for (const token of tokenize(source)) {
    const end = Math.min(token.start + token.text.length, chars.length);
    for (let at = token.start; at < end; at += 1) {
      if (chars[at] !== "\n") chars[at] = " ";
    }
  }
  return chars.join("");
}

/**
 * Every stage-order claim in the tree's *commentary* that the table contradicts, and how many
 * files were read to find them — one finding per line, through the same checks
 * `stageOrderLineFindings` gives the watched set, over commentary rather than raw bytes.
 *
 * `seen` holds the files the passes above already read — `STAGE_ORDER_FILES` raw, plus any
 * `--watch-glob` match — so nothing is scanned twice, and skipping them loses nothing: a
 * comment line's text is untouched by the blanking, so the raw pass over such a file already
 * reports every claim this one would.
 *
 * The breadth is the point: the fixed watch set holds the files somebody remembered to name,
 * and this holds every source file's prose — where a hand-written list lands in a file nobody
 * thought to add to a watch list. `scanned` rides beside the findings so emptiness can be held
 * to a tree that was really read rather than to a walk that found nothing to read.
 */
function stageCommentaryFindings(root, seen) {
  const findings = [];
  let scanned = 0;
  for (const abs of commentaryFiles(root)) {
    const rel = relative(root, abs).replaceAll("\\", "/");
    if (seen.has(rel)) continue;
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      // The walk just saw this file, so it going away before the read is the tree moving under
      // the audit — a finding, like every other watched file that cannot be read.
      findings.push({ file: rel, line: null, kind: "unreadable", detail: "the file could not be read" });
      continue;
    }
    scanned += 1;
    for (const f of stageOrderLineFindings(commentary(text), rel)) findings.push(f);
  }
  return { findings, scanned };
}

/**
 * Every stage-order claim in the watched files that the table contradicts, one finding each:
 * a generated block that is missing, unterminated or different; a numbered enumeration that is
 * not the table; a line-level list or count that disagrees with it; and — when the tree carries
 * one — the snapshot the lint-time reader loads, whose whole point is that no process compares
 * it to the table at read time. A tree that has never run `--stages=write` has no snapshot and
 * is left alone; the committed checkout's copy is verified by every pass over the checkout.
 * Empty is the only pass.
 */
function stageOrderFindings(root = stageOrderRoot, watchGlobs = []) {
  const findings = [];
  const expected = stageOrderLine();
  for (const entry of STAGE_ORDER_FILES) {
    let text;
    try {
      text = readFileSync(join(root, entry.file), "utf8");
    } catch {
      findings.push({ file: entry.file, line: null, kind: "unreadable", detail: "the file could not be read" });
      continue;
    }

    if (entry.generated) {
      const block = readStageOrderBlock(text);
      if (block.state === "absent") {
        findings.push({
          file: entry.file,
          line: null,
          kind: "generated",
          detail: `the generated stage-order line is gone (${STAGE_ORDER_BEGIN} … ${STAGE_ORDER_END})`,
        });
      } else if (block.state === "unterminated") {
        findings.push({
          file: entry.file,
          line: block.line,
          kind: "generated",
          detail: `the stage-order block opens and never closes (${STAGE_ORDER_END} is missing)`,
        });
      } else if (block.text !== expected) {
        findings.push({
          file: entry.file,
          line: block.line,
          kind: "generated",
          detail: `the generated line says "${block.text}" and the table says "${expected}"`,
        });
      }
    }

    if (entry.enumerated) {
      const items = readStageEnumeration(text);
      const names = items === null ? null : items.map((item) => item.name);
      const heading = text.slice(0, text.indexOf(STAGE_ORDER_HEADING)).split(/\r?\n/).length;
      if (names === null) {
        findings.push({
          file: entry.file,
          line: null,
          kind: "enumerate",
          detail: `the "${STAGE_ORDER_HEADING}" heading is gone`,
        });
      } else if (names.length !== STAGE_NAMES.length) {
        findings.push({
          file: entry.file,
          line: heading,
          kind: "enumerate",
          detail: `its numbered list has ${names.length} stage(s) and the table has ${STAGE_NAMES.length}`,
        });
      } else {
        const differs = names.findIndex((name, position) => name !== STAGE_NAMES[position]);
        const renumbered = items.findIndex((item, position) => item.number !== position + 1);
        if (differs !== -1) {
          findings.push({
            file: entry.file,
            line: heading,
            kind: "enumerate",
            detail: `item ${differs + 1} is \`${names[differs]}\` and the table's is \`${STAGE_NAMES[differs]}\``,
          });
        } else if (renumbered !== -1) {
          findings.push({
            file: entry.file,
            line: heading,
            kind: "enumerate",
            detail: `its items are numbered from ${items[renumbered].number} at position ${renumbered + 1}, not 1…${STAGE_NAMES.length}`,
          });
        }
      }
    }

    for (const f of stageOrderLineFindings(text, entry.file)) findings.push(f);
  }

  // …and the snapshot the lint-time reader loads — the artifact `--stages=write` keeps beside the
  // marked lines — when the tree carries one. Present means it must agree with the table: the file
  // exists precisely so no reader has to spawn this runner to learn the order, so a stale copy
  // would be believed silently by exactly the consumer it was written for.
  const snapshotPath = join(root, STAGE_ORDER_SNAPSHOT_FILE);
  if (existsSync(snapshotPath)) {
    try {
      for (const f of stageSnapshotFindings(readFileSync(snapshotPath, "utf8"), STAGE_ORDER_SNAPSHOT_FILE)) {
        findings.push(f);
      }
    } catch {
      // Present but unreadable is a finding like any other watched file that cannot be read.
      findings.push({
        file: STAGE_ORDER_SNAPSHOT_FILE,
        line: null,
        kind: "snapshot",
        detail: "the file could not be read",
      });
    }
  }

  // Additional files named by `--watch-glob`, scanned with the same line-level checks but
  // without the generated/enumerated block claims: a file with no marker carries no generated
  // line, and only the header enumeration in `*.md` holds the numbered list this run knows how
  // to read. They are only scanned by `--stages=check`, never by `--stages=write`, which edits
  // only `STAGE_ORDER_FILES` by design.
  if (watchGlobs.length > 0) {
    for (const file of watchGlobFiles(root, watchGlobs)) {
      let text;
      try {
        text = readFileSync(join(root, file), "utf8");
      } catch {
        findings.push({ file, line: null, kind: "unreadable", detail: "the file could not be read" });
        continue;
      }
      for (const f of stageOrderLineFindings(text, file)) findings.push(f);
    }
  }

  // …and the declarations own claims, which are about the table rather than about a file in the
  // tree: a label every report can name, a declared script behind its own stage's key, and the three
  // tree-editing checks last with a lock name each (`stageDeclarationGaps`, reading the table in
  // force). They are reported against the file the table is declared in, since that is where an entry
  // is corrected — and they read *that* table rather than the tree `root` names, deliberately:
  // `root` is how a test drives a drifted copy of a file, and a statement about the declarations is a
  // statement about this checkout's.
  for (const gap of stageDeclarationGaps()) {
    findings.push({ file: STAGE_TABLE_FILE, line: null, kind: gap.kind, detail: gap.detail });
  }
  return findings;
}

// `--stages` reports the order and exits, and it is deliberately the first thing answered: it reads
// the declarations, so it is the one answer that is right on a tree this run has just refused.
// `--stages=write` is the generator for the two marked lines and the lint-time snapshot,
// `--stages=check` the audit alone, and
// `--stages=json` the same order for a machine.
const stagesAsked = process.argv.some((arg) => arg === "--stages" || arg.startsWith("--stages=") );
if (stagesAsked) {
  const mode = (option("--stages") ?? "").trim();
  if (mode !== "" && !["json", "check", "write"].includes(mode)) {
    abort(`--stages takes json, check or write (got ${mode}) — or nothing, to print the order`);
  }
  // `--watch-glob=<glob>` extends the `--stages=check` audit with additional files matched by
  // the glob, beyond `STAGE_ORDER_FILES`. Comma-separated to mirror `--only`'s shape. Only
  // meaningful with `--stages=check`: `--stages=write` edits only `STAGE_ORDER_FILES` and
  // `--stages=json` emits the order, so refusing elsewhere prevents a silent no-op.
  const watchGlobArg = option("--watch-glob");
  const watchGlobs = watchGlobArg !== undefined ? watchGlobArg.split(",") : [];
  if (watchGlobs.length > 0 && mode !== "check") {
    abort(`--watch-glob only applies with --stages=check (got --stages=${mode || "print"})`);
  }
  if (watchGlobs.length > 0 && watchGlobs.some((g) => g === "")) {
    abort("--watch-glob does not accept an empty pattern — pass a glob like `docs/*.md` or `**/*.mjs`");
  }
  // `--commentary` extends the check once more, over the tree rather than over a named set:
  // every source file's *comments* are read for a stage-order claim, which is where a
  // hand-written list lands in a file nobody thought to add to a watch list. Comment-only —
  // `commentary` blanks strings and code — because an arbitrary file's raw bytes are mostly
  // fixtures and assertions carrying out-of-order lists on purpose. Like `--watch-glob` it is
  // check-only: `--stages=write` edits `STAGE_ORDER_FILES` and `--stages=json` emits the order,
  // so a flag that did nothing there would be a silent no-op rather than a refused one.
  const commentaryScan = process.argv.includes("--commentary");
  if (commentaryScan && mode !== "check") {
    abort(`--commentary only applies with --stages=check (got --stages=${mode || "print"})`);
  }
  const orderText = stageOrderLine();
  if (mode === "write") {
    const rewritten = writeStageOrderBlocks();
    for (const file of rewritten) console.log(`ci: rewrote the generated stage-order line in ${file}`);
    if (rewritten.length === 0) {
      console.log("ci: the generated stage-order lines already match the table");
    }
    // …and the snapshot the lint-time reader loads instead of spawning this runner: the same
    // payload `--stages=json` prints, rewritten only when it disagrees with the table — so a
    // write over a tree that is already right touches nothing and says nothing about it.
    const snapshotPath = join(stageOrderRoot, STAGE_ORDER_SNAPSHOT_FILE);
    const snapshot = `${JSON.stringify(
      { stages: STAGE_NAMES, count: STAGE_NAMES.length },
      null,
      2,
    )}\n`;
    const current = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : null;
    if (current !== snapshot) {
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, snapshot);
      console.log(`ci: wrote the stage-order snapshot to ${STAGE_ORDER_SNAPSHOT_FILE}`);
    }
    process.exit(0);
  }
  if (mode === "json") {
    writeStdoutSync(`${JSON.stringify({ stages: STAGE_NAMES, count: STAGE_NAMES.length }, null, 2)}\n`);
    process.exit(0);
  }
  const findings = stageOrderFindings(stageOrderRoot, watchGlobs);
  // …and, when asked, every claim in the tree's commentary — the same checks over the files
  // nobody named. The dedup is the watch-glob pass's rule applied once more: raw is a
  // superset of the commentary for the lines the two share, so re-reading a file either
  // pass already read could only repeat a finding.
  let commentaryScanned = 0;
  if (commentaryScan) {
    const seen = new Set(STAGE_ORDER_FILES.map((entry) => entry.file));
    if (watchGlobs.length > 0) {
      for (const file of watchGlobFiles(stageOrderRoot, watchGlobs)) seen.add(file);
    }
    const scan = stageCommentaryFindings(stageOrderRoot, seen);
    findings.push(...scan.findings);
    commentaryScanned = scan.scanned;
  }
  if (mode === "check") {
    const failed = findings.length > 0;
    if (JSON_OUTPUT) {
      writeStdoutSync(
        `${JSON.stringify(
          {
            stages: STAGE_NAMES,
            count: STAGE_NAMES.length,
            gate: failed ? "fail" : "pass",
            exitCode: failed ? 1 : 0,
            findings,
            // How many files the commentary pass read — carried so emptiness can be held to a
            // tree that was really read rather than to a walk that found nothing to read.
            ...(commentaryScan ? { scanned: commentaryScanned } : {}),
          },
          null,
          2,
        )}\n`,
      );
    } else {
      console.log(`ci: ${orderText}`);
      for (const finding of findings) {
        const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
        console.log(`  ${where}  ${finding.kind}: ${finding.detail}`);
      }
      console.log(
        failed
          ? `\nci: ${findings.length} stage-order claim(s) disagree with the stage table.`
          : "\nci: every stage-order claim in the tree is the table's own.",
      );
    }
    process.exit(failed ? 1 : 0);
  }
  console.log(`ci: ${orderText}`);
  for (const finding of findings) {
    const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
    console.error(`  ${where}  ${finding.kind}: ${finding.detail}`);
  }
  if (findings.length > 0) {
    console.error(
      "\nci: a run refuses to start while a copy of the order disagrees with the table — run " +
        "`node .freebuff/ci.mjs --stages=write` for the generated lines, or correct the copy.",
    );
    process.exit(1);
  }
  process.exit(0);
}

// `--status` is the pin's report, and it is two answers in one output because they belong to two
// different scripts: the alarm owns the gate files, this runner owns the stages, and only the
// runner can say *which stage's key* a pinned file is behind. The alarm's line is printed as the
// alarm wrote it — spawned, the same way the drift stage runs it — so there is one renderer of
// that sentence rather than a second one here, and the exit code is the alarm's, so this stands
// in for `gates:drift` exactly as `gate-drift.mjs --status` does. It runs no stage, and it reads
// no cache: the coverage is a question about the declarations, not about a run's keys. The map is
// read twice for that reason — once per file, and once grouped by the watch rule that pinned each
// file — because the second reading is the one that shows a family a stage only half holds, the
// shape that goes red the moment one of its members is left behind nothing — and once more for the
// candidate `--watch` names, if one was named: the same families read with a proposed stage input
// in hand, answering which of them it would close. That third reading is the only one that writes
// nothing *and* proposes nothing: it is a question about an edit, not the edit, so a reader can
// ask it before widening a stage's `inputs` rather than after the refusal has named the file.
if (process.argv.includes("--status")) {
  // The coverage spans every stage — it is a statement about the pin — so a selection that
  // narrowed the *run* would leave a map with rows missing and no sign that they were. The
  // refusal names the flag that did it rather than quietly reading the whole pin anyway.
  const selection = ["--only", "--from", "--skip", "--changed-only"].find((flag) =>
    process.argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`)),
  );
  if (selection !== undefined) {
    abort(
      `--status reports the pin and its key coverage, so it takes no stage selection (${selection}) — drop it, or run the stages instead`,
    );
  }
  // Each of the three reports and exits, so honouring one would silently drop another.
  if (process.argv.includes("--dry-run") || process.argv.includes("--explain-cache")) {
    abort("--status, --dry-run and --explain-cache each report and exit — pass only one");
  }

  // The same seam the drift stage runs the alarm through, so a redirected alarm is one decision
  // for both: a script that answers `--json` for the check answers `--status` for this.
  const alarm = spawnSync(
    process.execPath,
    [
      stageScript("CI_DRIFT_SCRIPT", "./gate-drift.mjs"),
      "--status",
      ...(JSON_OUTPUT ? ["--json"] : []),
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const text = alarm.stdout ?? "";
  // A pin that would not resolve is not a coverage map with nothing in it: the alarm has
  // already said why on its own line, and a table derived from an unreadable pin would be a
  // second, quieter answer to the same question.
  const coverage = alarm.status === 0 || alarm.status === 1 ? await pinnedCoverage() : null;
  // The same rows grouped by the watch rule that pinned each file: a second reading of one pin,
  // computed once for both forms rather than under each. And read the other way, the repair a red
  // drift's headings carry — the stage that should own each family (`familyOwners`) — said here
  // while the tree is still green, so the stage to widen is named before a member falls out of
  // every key rather than after. Stamped onto the family rather than printed from beside it: the
  // family is the unit the reader acts on, and the JSON is the machine form of the same row, so
  // the owner has to travel with it. `null` for a family no stage keys at all — the pin's own
  // `drift` re-key does not count as one, or it would own every family by construction. Both
  // readings resolve the one pin, so a family's members and its owner cannot disagree about which
  // stages hold it.
  const familyRows = coverage === null ? null : familyCoverage(coverage);
  const owners = coverage === null ? null : familyOwners(coverage, STAGES);
  const families =
    familyRows === null || owners === null
      ? null
      : familyRows.map((family) => ({ ...family, owner: owners.get(family.rule) ?? null }));
  // The `--watch` proposal — a file path or watch rule read as a candidate stage input — asked of
  // the same rows the two readings above print, so the answer cannot come from a second walk over
  // the tree. `null` when no candidate was asked for; a candidate whose spec can be read as
  // neither a path nor a rule still comes back as one, with `problem` set, so the report can say
  // why rather than quietly printing the family view alone. Nothing here writes: the pin and the
  // stage list are read, and the candidate is never applied to either.
  const candidate =
    coverage === null || watchSpec === null ? null : watchCandidate(watchSpec, coverage);
  const watch =
    candidate === null ? null : { ...candidate, ...watchClosures(candidate, coverage, families) };

  if (JSON_OUTPUT) {
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // The alarm's object is this report's spine; without it there is nothing to add the
      // coverage to, so its output goes out untouched.
    }
    writeStdoutSync(
      payload === null || coverage === null
        ? text
        : `${JSON.stringify({ ...payload, coverage, families, watch, exempt: KEY_EXEMPT_PINNED }, null, 2)}\n`,
    );
  } else {
    writeStdoutSync(text);
    if (coverage !== null) {
      const width = Math.max(0, ...coverage.map((row) => coverageLabel(row).length));
      console.log(
        `  key coverage — which stage's key is behind each pinned file (${coverage.length}, ` +
          "fewest keys first; `+ every key` is `GLOBAL_FORCE`, which re-keys every stage):",
      );
      for (const row of coverage) {
        // A file no stage's key covers says which rule put it there — and, when the rule's
        // family points at one, which stage should have named it and which file of that family
        // earned it — right on the row: the same answers the refusal gives, and the one thing a
        // reader can act on from here.
        const suggested =
          row.suggested === null ? "" : ` → ${row.suggested} (via ${row.suggestedBy})`;
        const pinnedBy =
          row.keys.length === 0 && row.rule !== null ? `  ← ${row.rule}${suggested}` : "";
        console.log(`    ${coverageLabel(row).padEnd(width)}  ${row.file}${pinnedBy}`);
      }
      const keyless = coverage.filter(
        (row) => row.keys.length === 0 && row.exempt === null,
      ).length;
      if (keyless > 0) {
        console.log(
          `  ${keyless} pinned file(s) behind no key — a change to one re-runs no stage, and ` +
            "the run refuses to start while that stands.",
        );
      }
      const excused = coverage.filter((row) => row.exempt !== null).length;
      if (excused > 0) {
        console.log(`  ${excused} pinned file(s) recorded as exempt in KEY_EXEMPT_PINNED.`);
      }
      // The same rows read the other way: per file above, per watch rule here. A stage's key holds
      // *part* of a family whenever its inputs name some of the rule's files and not the rest, and
      // that is the shape to see while the tree is green — the moment a member falls out of every
      // key it is the refusal, and the stage holding the rest is the one to extend. The rows also
      // say the *inverse* risk, the one the refusal can never name: a family no stage but the
      // pin's own `drift` re-key holds whole is a family a new member joins behind that re-key
      // alone, so the reader can widen a stage's `inputs` before that happens rather than after.
      if (families !== null && families.length > 0) {
        const familyWidth = Math.max(...families.map((family) => family.rule.length));
        console.log(
          `  family coverage — the pin grouped by the watch rule that pinned it (${families.length}, ` +
            "families with a member behind no stage's key first, then the ones a new member would " +
            "leave behind drift alone; counts are members behind a stage's own `inputs`, and each " +
            "row names the stage that should own the family):",
        );
        for (const family of families) {
          const held = family.stages.map((stage) => `${stage.name} ${stage.count}`).join(", ");
          console.log(
            `    ${family.rule.padEnd(familyWidth)}  ${family.members} member(s)` +
              (held === "" ? " — no stage holds any of them" : ` — ${held}`) +
              // The repair, in the words a red drift's headings already use: the stage to widen —
              // or the honest fact that none keys the family — is what turns the counts above into
              // an edit, and it is the one thing here a reader can act on while the tree is green.
              ownerClause(family.rule, owners) +
              (family.unkeyed > 0 ? `; ${family.unkeyed} behind no stage's key` : "") +
              // Drift holds every family whole by construction, so it is already on the row and
              // is not what this clause is warning about: the warning is that nothing *else* does.
              (family.exposed ? "; a new member would be held by drift alone" : ""),
          );
        }
      }
      // The `--watch` proposal, read against the same families and written nowhere: what a
      // candidate stage input would close, and what it would leave behind the re-key. It is the
      // family mark asked about a *concrete* edit — "is this file, named in a stage's `inputs`,
      // enough?" — so the question can be asked before the pin is widened rather than after the
      // refusal has already named a stranded file.
      if (watch !== null) {
        // A spec that could not be read at all is named as such rather than described as
        // "matching nothing", which would be a different (and false) answer.
        const read =
          watch.problem !== null
            ? ""
            : (watch.kind === "rule"
                ? watch.files.length === 0
                  ? "nothing the pin holds matches it as a path, and as a watch rule it resolves no file"
                  : `a watch rule resolving ${watch.files.length} file(s)` +
                    (watch.fresh.length > 0
                      ? `, ${watch.fresh.length} of them the pin does not hold yet`
                      : "")
                : watch.files.length === 1
                  ? "a pinned file"
                  : `a glob matching ${watch.files.length} pinned file(s)`) +
              (watch.rule === null ? "" : `; in ${watch.rule}`);
        console.log(
          read === "" ? `  watch — ${watch.label}:` : `  watch — ${watch.label} (${read}):`,
        );
        if (watch.problem !== null) {
          console.log(`    it could not be read as a path or a watch rule: ${watch.problem}`);
        }
        for (const closed of watch.closes) {
          const plural = closed.members === 1 ? "" : "s";
          console.log(
            `    closes  ${closed.rule} — ${
              closed.anyStage
                ? `it covers all ${closed.members} member${plural}, so any stage naming it would hold the family whole (no stage holds one today)`
                : `${closed.stages.join(", ")} would hold all ${closed.members} member${plural} with it in \`inputs\``
            }`,
          );
        }
        if (watch.open.length > 0) {
          console.log(
            `    leaves  ${watch.open
              .map((family) => `${family.rule} (${family.covered} of ${family.members})`)
              .join(", ")}`,
          );
        }
        const total = watch.closes.length + watch.open.length;
        const noun = total === 1 ? "family" : "families";
        console.log(
          `    verdict — ${
            total === 0
              ? "there is no family a new member would leave behind drift alone, so there is nothing to close."
              : watch.closes.length === 0
                ? `closes none of the ${total} ${noun} a new member would leave behind drift alone.`
                : watch.closes.length === total
                  ? `closes all ${total} ${noun} a new member would leave behind drift alone — nothing is left behind the re-key alone.`
                  : `closes ${watch.closes.length} of the ${total} ${noun} a new member would leave behind drift alone.`
          }`,
        );
      }
    }
  }
  process.exit(alarm.status ?? 2);
}

// Both report and exit without running a stage, and `--explain-cache` is the longer
// report of the two, so asking for both is a contradiction rather than a combination.
if (process.argv.includes("--explain-cache") && process.argv.includes("--dry-run")) {
  abort("--explain-cache and --dry-run both report and exit — pass only one");
}

// `--from=<name>` starts at a stage and keeps everything after it: the resume
// path after fixing a failure, so the stages that already passed are not replayed.
const from = option("--from")?.trim();
const fromIndex = from === undefined ? -1 : STAGE_NAMES.indexOf(from);

const unknown = only?.filter((name) => !STAGE_NAMES.includes(name)) ?? [];
if (unknown.length > 0) {
  abort(`--only names unknown stage(s): ${unknown.join(", ")} (have: ${STAGE_NAMES.join(", ")})`);
}
// A typo in `--skip` would silently leave the gate *wider* than intended, so it
// is refused the way a `--only` typo is.
const unknownSkip = skip?.filter((name) => !STAGE_NAMES.includes(name)) ?? [];
if (unknownSkip.length > 0) {
  abort(`--skip names unknown stage(s): ${unknownSkip.join(", ")} (have: ${STAGE_NAMES.join(", ")})`);
}
// `--skip=` names nothing: an empty filter reads as "I left something out" while
// changing nothing, so say so rather than run a full gate that looks partial.
if (skip !== undefined && skip.length === 0) {
  abort("--skip needs at least one stage name, e.g. --skip=preflight");
}
// An unknown `--from` that fell through to "select everything" would look like a
// successful resume while quietly re-running the whole job, so it is an error.
if (from !== undefined && fromIndex === -1) {
  abort(`--from names unknown stage: ${from} (have: ${STAGE_NAMES.join(", ")})`);
}
// Both answer "where do I start", so honouring one and ignoring the other would
// silently run a different set than either flag describes.
if (from !== undefined && only !== undefined) {
  abort(
    "--from and --only select stages two different ways — use --only to name stages, or --from to start partway through the canonical order",
  );
}

// How far a run goes after a failure is one question with three answers, so at
// most one of them may be asked for. The default is to stop at the first
// failure, because the stages are cheapest-first and the cheapest failure is the
// one you pay for; a detected CI environment turns `--keep-going` on by itself,
// so a scheduled job reports every problem instead of only the first.
const keepGoingArg = process.argv.includes("--keep-going");
const failFastArg = process.argv.includes("--fail-fast");

// `--max-failures=<n>` sits between `--fail-fast` (one) and `--keep-going` (all):
// keep going, but stop once `n` stages have failed. It is the shape a CI job
// wants when one problem is too few and the whole list is more than it needs.
const maxFailuresRaw = option("--max-failures");
// Either spelling of the flag — `--max-failures 3` or `--max-failures=3` — asks
// for the cap, so a bad value is refused rather than silently dropped.
const maxFailuresAsked = process.argv.some(
  (arg) => arg === "--max-failures" || arg.startsWith("--max-failures="),
);
let maxFailures = null;
if (maxFailuresAsked) {
  if (maxFailuresRaw === undefined || !/^\d+$/.test(maxFailuresRaw) || Number(maxFailuresRaw) < 1) {
    abort(`--max-failures needs a positive integer, got ${maxFailuresRaw ?? "(nothing)"}`);
  }
  maxFailures = Number(maxFailuresRaw);
}

// `--cache-ttl=<duration>` bounds how long a recorded pass is trusted. A content
// digest cannot see a dependency that drifted outside a stage's globs, so an entry
// past the cap is re-run rather than reused; the stages that expired are named, so
// a run that "should" have reused one says why it did not.
const cacheTtlAsked = process.argv.some(
  (arg) => arg === "--cache-ttl" || arg.startsWith("--cache-ttl="),
);
let cacheTtlMs = DEFAULT_CACHE_TTL_MS;
if (cacheTtlAsked) {
  const ttlRaw = option("--cache-ttl");
  const parsed = ttlRaw === undefined ? null : parseCacheTtl(ttlRaw);
  if (parsed === null) {
    abort(
      `--cache-ttl needs a duration like 30m, 12h or 7d (or 0 for no cap), got ${ttlRaw ?? "(nothing)"}`,
    );
  }
  cacheTtlMs = parsed;
}
/** How the cap reads in a line of output. */
const capLabel = cacheTtlMs === Infinity ? "none" : formatAge(cacheTtlMs);

if (maxFailures !== null && keepGoingArg) {
  abort("--max-failures and --keep-going ask for opposite things — pass only one");
}
if (maxFailures !== null && failFastArg) {
  abort("--max-failures and --fail-fast overlap — --max-failures=1 is fail-fast, so pass only one");
}
if (keepGoingArg && failFastArg) {
  abort("--keep-going and --fail-fast ask for opposite things — pass only one");
}

const ciDetected = inCi();
// A capped run is not the CI default: it goes on past a failure by design, so
// `keepGoing` (and the notice it prints) must not widen it back to unlimited.
const keepGoing = maxFailures === null && (keepGoingArg || (ciDetected && !failFastArg));
// How many failing stages this run tolerates before it stops: unlimited in a
// keep-going run, one in a fail-fast one, and the cap otherwise.
const failureBudget = maxFailures ?? (keepGoing ? Infinity : 1);

const base =
  fromIndex !== -1 ? STAGES.slice(fromIndex) : only ? STAGES.filter((stage) => only.includes(stage.name)) : STAGES;
// The stages `--skip` took out, in canonical order, so the report can name them
// rather than let a narrowed run read as the full gate.
const excluded = base.filter((stage) => skip?.includes(stage.name)).map((stage) => stage.name);
const selected = base.filter((stage) => !skip?.includes(stage.name));
if (selected.length === 0) {
  abort(
    excluded.length > 0
      ? `--skip excludes every selected stage (have: ${STAGE_NAMES.join(", ")})`
      : `--only selected no stage (have: ${STAGE_NAMES.join(", ")})`,
  );
}

// `--changed-only` skips a stage no changed file feeds, using the working-tree
// diff. It only ever skips when it positively knows something changed that no
// stage reads: an unreadable diff, an empty change set, or a build/config file
// all fall back to running every stage. The safe direction for a gate is to run.
const changedOnly = process.argv.includes("--changed-only");
let changed = null;
let changedTouchesAll = false;
let changeNote = "";
if (changedOnly) {
  changed = changedFiles();
  if (changed === null) {
    changedTouchesAll = true;
    changeNote = "could not read the working-tree diff";
  } else if (changed.length === 0) {
    changedTouchesAll = true;
    changeNote = "the change set is empty";
  } else if (changed.some((file) => GLOBAL_FORCE.some((pattern) => globMatch(pattern, file)))) {
    changedTouchesAll = true;
    changeNote = "a build or config file changed";
  }
}

/** Whether a changed file feeds this stage; "unknown" answers yes, the safe way. */
function stageTouched(stage) {
  if (!changedOnly || changedTouchesAll) return true;
  if (!stage.inputs || stage.inputs.length === 0) return true;
  if (changed.some((file) => stage.inputs.some((input) => matchesInput(input, file)))) return true;
  // A stage that runs a gate script is also fed by anything that script imports: the
  // closure the key folds in is the closure this reading asks about, so a change to a
  // helper the gate loads re-runs the stage rather than being skipped as unread.
  return changed.some((file) => stageKeyFiles(stage, []).some((path) => rel(path) === file));
}

const wouldRun = selected.filter((stage) => stageTouched(stage));
const wouldSkip = changedOnly ? selected.filter((stage) => !stageTouched(stage)) : [];

// `--dry-run` reports what would run and exits, so the selection is observable
// without paying for the suite and the sweep (the tests lean on this).
if (process.argv.includes("--dry-run")) {
  const names = wouldRun.map((stage) => stage.name);
  const skippedNames = wouldSkip.map((stage) => stage.name);
  if (JSON_OUTPUT) {
    writeStdoutSync(
      `${JSON.stringify({ dryRun: true, gate: "pass", exitCode: 0, stages: names, failed: [], skipped: [], annotations: [], unchanged: skippedNames, excluded, keepGoing, maxFailures }, null, 2)}\n`,
    );
  } else {
    console.log(`ci: would run ${names.length} stage(s): ${names.join(", ")}`);
    if (skippedNames.length > 0) {
      console.log(`ci: not run (nothing they read changed): ${skippedNames.join(", ")}`);
    }
    if (excluded.length > 0) {
      console.log(`ci: --skip excludes: ${excluded.join(", ")}`);
    }
    if (changedOnly && changeNote) {
      console.log(`ci: --changed-only: ${changeNote} — running every stage anyway`);
    }
  }
  process.exit(0);
}

// Under `--json` stdout is reserved for the report, so progress goes to stderr.
const progress = JSON_OUTPUT ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts);

// Every selected stage, whatever it ends up doing — the denominator the verdict
// reports, so the counts always add up to the size of the run.
const selectedTotal = selected.length + excluded.length;

// --- Reuse: a stage whose inputs are byte-identical to a passing run --------

// Each stage names the files it reads (`inputs`), and `--changed-only` already
// trusts those globs to say what a stage needs. The cache holds the same verdict:
// a stage whose inputs hash to a value that passed before is not run again, it is
// *reused*. The hash covers the content of every file the stage reads — every one,
// not only the ones that moved — plus the build and config files in
// `GLOBAL_FORCE`, so a tool config or a dependency bump invalidates every entry.
// It is still a cache: a miss (or `--no-cache`) always means "run it", and a stage
// is only ever reused on a recorded *pass* — a failure is never cached.
//
// **Every file the pin holds is behind some stage's key.** That is the one failure a cache
// cannot report on its own: a gate file no stage's inputs name is invisible to every key, so
// a change to it would leave every stage reusable and the cache would vouch for a tree
// nothing measured. It cannot happen here by construction — the drift stage's inputs *are*
// the pin's watch rules, so all thirty-six of its files are behind that stage's key, and the
// build and config files `GLOBAL_FORCE` puts behind *every* key are behind it twice over — but
// it can happen next, by a stage list that stopped covering one of them, and that is a
// decision rather than an accident. So the run **refuses to start** on a gap: `coverageGaps`
// is asked before the log opens, and a pinned file behind neither a stage's inputs nor
// `GLOBAL_FORCE` fails the run with the file named — and, where the pin's own families point at
// one, the stage that should have named it and the file of that family already behind its key —
// and `uncovered` in the `--json` report, because a
// verdict nothing measured is not a verdict. `KEY_EXEMPT_PINNED` is the one way such
// a file becomes deliberate — a declaration with a reason, read by that refusal, by the
// `--status` map and by `src/test/ci-runner.test.ts`, which holds the rest of the policy: an
// entry has to be a file the pin still holds, dormant (an exemption for a covered file has
// expired), and reasoned. The list is empty, which is what the sentence above is for.
const cacheEnabled = !process.argv.includes("--no-cache");
const cache = cacheEnabled ? loadCache() : { version: CACHE_VERSION, stages: {} };
const cacheFiles = cacheEnabled ? sourceFiles() : null;
const globalKey = cacheFiles === null ? "" : hashPaths(inputFiles(cacheFiles, GLOBAL_FORCE));

/** A stage's cache key, or `null` when its inputs cannot name what it reads. */
function stageKey(stage) {
  if (cacheFiles === null || !stage.inputs || stage.inputs.length === 0) return null;
  return createHash("sha256")
    .update(globalKey)
    .update("\0")
    .update(stage.inputs.map(inputText).join("\0"))
    .update("\0")
    .update(hashPaths(stageKeyFiles(stage, cacheFiles)))
    .digest("hex");
}

/**
 * A stage's key read *now* rather than as the run decided.
 *
 * Each file's digest is memoized for the life of the run — one read however many stages'
 * globs name it — which is what makes asking for a key a second time cheap *and*, after a
 * pass that changed its own inputs, wrong: it would hand back the digest of the tree the
 * stage started from. So the memo is dropped first. The cost is one re-read of the files
 * that stage reads, and the alternative is recording a tree no stage ever saw.
 */
function rereadStageKey(stage) {
  fileDigests.clear();
  return stageKey(stage);
}

// What each selected stage is about to do, and why — decided up front because the
// answer depends only on the cache and the tree, never on what a stage does. The
// run, the opening verdict and `--explain-cache` all read this one record, so an
// explanation can never describe a policy the run does not actually follow.
const decisions = new Map();
const reusePlan = new Map();
// The pin as the run opens: a snapshot the close reads a suspect list out of, so a red
// run can tell a tree that moved underneath it from one this checkout broke. Before the
// loop, so the window it measures is the run's own, and tolerant of failure — an
// attribution aid that could not read the pin is worth a stderr note, never a red run.
try {
  const { watches, problem } = await readManifest(manifestPath());
  if (problem) throw new Error("pin problem");
  const snapshotDir = dirname(PIN_SNAPSHOT_FILE);
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(PIN_SNAPSHOT_FILE, JSON.stringify({ files: pin(null, watches) }), "utf8");
} catch (error) {
  console.error(
    `ci: pin snapshot not taken — concurrent-edit attribution unavailable this run (${error?.message ?? "unknown"})`,
  );
}
// Stages whose digest still matches but whose entry is past the cap: they run
// again, and are named so the re-run is not read as a plain cache miss.
const expired = [];
for (const stage of selected) {
  const decision = decideStage(stage);
  decisions.set(stage.name, decision);
  if (decision.decision === "reuse") {
    reusePlan.set(stage.name, { hash: decision.key, summary: decision.summary });
  } else if (decision.decision === "expired") {
    expired.push(stage.name);
  }
}
const expiredSet = new Set(expired);

/** How old a recorded pass is in ms, or `null` when it carries no usable date. */
function ageOf(entry) {
  const at = Date.parse(entry.at ?? "");
  return Number.isFinite(at) ? Date.now() - at : null;
}

/**
 * Whether a recorded pass is young enough to reuse. Under a finite cap an entry
 * with no usable timestamp cannot be vouched for, so it counts as expired — the
 * safe direction for a gate, and the same reason a hash miss always means "run it".
 */
function withinCap(entry) {
  if (cacheTtlMs === Infinity) return true;
  const age = ageOf(entry);
  return age !== null && age <= cacheTtlMs;
}

/**
 * The one place a stage's fate is decided. A stage change detection already skipped
 * stays `unchanged`: not running it at all is the cheaper true story, and the cache
 * does not get to claim credit for it.
 */
function decideStage(stage) {
  if (!stageTouched(stage)) {
    return { decision: "unchanged", reason: "no changed file feeds it" };
  }
  // A stage that edits the tree cannot be answered from the cache, and not only
  // because its pass speaks for a tree it then changed. The state a tree-editing
  // check exists to repair is the one a killed run leaves behind — a weakened file
  // plus its lock — and the check applies the *same* mutation every time, so that
  // debris hashes exactly like the debris an earlier pass started from. Reusing that
  // entry would report the gate as checked while the weakened file stood there. So
  // these always run; being the file's only healer is worth the seconds.
  if (stage.editsTree) {
    return {
      decision: "run",
      reason: "its run edits the tree, which a recorded pass cannot vouch for",
    };
  }
  if (cacheFiles === null) {
    return { decision: "run", reason: "the cache is off (--no-cache)" };
  }
  const key = stageKey(stage);
  if (key === null) {
    return { decision: "run", reason: "its inputs cannot name what it reads" };
  }
  const entry = cache.stages[stage.name];
  if (entry?.pass !== true) {
    return { decision: "run", reason: "no recorded pass for these inputs", key };
  }
  if (entry.hash !== key) {
    return {
      decision: "run",
      reason: "its recorded digest differs — an input changed",
      key,
    };
  }
  const age = ageOf(entry);
  if (!withinCap(entry)) {
    return {
      decision: "expired",
      reason: `its recorded pass is ${formatAge(age)} old (cap ${capLabel})`,
      key,
      ageMs: age,
      recordedAt: entry.at ?? null,
    };
  }
  return {
    decision: "reuse",
    reason: "inputs unchanged since a passing run",
    key,
    summary: entry.summary ?? "recorded pass",
    ageMs: age,
    recordedAt: entry.at ?? null,
  };
}

// This run's passes, merged over the loaded cache so a `--only` run does not evict
// the entries for the stages it left alone.
const nextCache = { version: CACHE_VERSION, stages: { ...cache.stages } };

/**
 * One stage's line in `--explain-cache`: the decision, the reason, and the evidence
 * behind it — how old the recorded pass is, how recently an input was touched, and
 * how many files the key covers. "Newest input" is the most recently touched of them —
 * the one that answers "did anything move?" — not the oldest, which would hide a file
 * written seconds ago behind an untouched one.
 *
 * The files are given at the scale that fits. Few enough to name, and each is written
 * with the input that matched it whenever the two differ (`next.config.mjs ←
 * next.config.*`), which answers "what put *this* file behind the key?" without the
 * reader having to hold the stage's declarations in their head. Too many to name, and
 * the line gives the inputs themselves with how many files each contributed — a list of
 * thirty-six names says nothing anyone can act on, while `^coverage-.*\.mjs$ ×7` says
 * which family the stage is keyed on and how much of it. A secret-looking name is
 * redacted entry by entry rather than collapsed, so the pairing survives redaction; the
 * detail's count is what keeps the total honest. The inputs are not redacted: an input is
 * a pattern rather than a name, and the pattern that swept up a secret file is the one a
 * reader most needs to see.
 */
function explainLine(entry) {
  const detail = [];
  if (entry.ageMs !== undefined && entry.ageMs !== null) {
    detail.push(`recorded ${formatAge(entry.ageMs)} ago`);
  }
  if (entry.newestInputMs !== undefined && entry.newestInputMs !== null) {
    detail.push(`newest input ${formatAge(Date.now() - entry.newestInputMs)} ago`);
  }
  if (entry.inputCount !== undefined && entry.inputCount !== null) {
    detail.push(`${entry.inputCount} file(s) behind the key`);
  }
  const suffix = detail.length > 0 ? ` (${detail.join("; ")})` : "";
  const pairs = entry.matchedBy ?? [];
  const listed =
    pairs.length > 0 && pairs.length <= 8
      ? ` [${pairs
          .map((pair) =>
            pair.input && pair.input !== pair.name ? `${pair.name} ← ${pair.input}` : pair.name,
          )
          .join(", ")}]`
      : "";
  const families = pairs.length > 8 ? ` [${inputTally(pairs).join(", ")}]` : "";
  return `${entry.decision.padEnd(9)} — ${entry.reason}${suffix}${listed}${families}`;
}

/**
 * The inputs behind one key with how many files each contributed, first-seen first.
 * The compact form for a stage whose file list will not fit on a line, and the one that
 * answers "which family re-keyed this?" when the files themselves cannot be named. A pair
 * with no input to blame is skipped rather than rendered as an empty label; nothing on
 * disk produces one, since every pair comes from an input that matched it.
 */
function inputTally(pairs) {
  const counts = new Map();
  for (const pair of pairs) {
    if (!pair.input) continue;
    counts.set(pair.input, (counts.get(pair.input) ?? 0) + 1);
  }
  return [...counts].map(([input, count]) => `${input} ×${count}`);
}

// `--explain-cache` reports the same decisions the run is about to take, with the
// files behind each key, and exits without running anything — the answer to "why did
// that stage not get reused?" without paying for the suite to find out. It reads the
// one decision record the run itself reads, so it cannot describe — or argue for —
// behavior other than what would happen.
if (process.argv.includes("--explain-cache")) {
  // The files `GLOBAL_FORCE` puts behind *every* stage's key, resolved once for both forms.
  // They are the part of a key no per-stage list can show — a stage that names six files is
  // still keyed on a dependency bump, a `tsconfig.json` or a workflow — so a report giving
  // only the stage's own files would answer "what is behind this key?" with half of it. They
  // are also the second half the pin's coverage invariant counts: a pinned gate file no
  // stage's `inputs` name is still behind a key if it is one of these. Null under `--no-cache`,
  // where there is no key to explain.
  const globalForce = cacheFiles === null ? null : inputFiles(cacheFiles, GLOBAL_FORCE);
  // The force list's own dead entries, off the same walk and null with the key: a pattern that
  // matches no file is an entry that re-keys nothing, which is the one way this list can lie.
  const forceGaps = cacheFiles === null ? null : forceAbsences(cacheFiles);
  // The stage list's own dead entries, off the same walk and null with the key: a stage `inputs`
  // entry that matches no file is a stage keying nothing through it, which is the same lie as a
  // dead `GLOBAL_FORCE` entry one scope down — the reason the fix is usually a declaration and
  // occasionally a dropped entry rather than a refusal is unchanged.
  const inputGaps = cacheFiles === null ? null : inputAbsences(cacheFiles);
  // The pin's own families, keyed by the stage whose key already holds a member of each: the
  // sibling the refusal names, reachable here by stage name on a tree where nothing is uncovered.
  // Asked of the pin rather than of the selection, because it is a fact about the stage list and
  // not about this run; `null` when the pin will not resolve, which is the alarm's failure to
  // report rather than an empty answer.
  const pinRows = await pinnedRows();
  const families = pinRows === null ? null : familyKeysByStage(pinRows);
  const explanation = selected.map((stage) => {
    const decision = decisions.get(stage.name);
    const matched = matchedInputs(stage);
    const held = families === null ? [] : (families.get(stage.name) ?? []);
    // The gate's own module list, the same reading `stageKeyFiles` folds into the key:
    // computed once per stage above, so this cannot name a module the key does not hold.
    const imports = stageImportNames(stage);
    // This stage's own dead entries, in declaration order: the labels it is keyed on nothing
    // through. Reported per stage because the repair is this stage's `inputs` — the declaration of
    // what may be dead is one list (`INPUT_CONTINGENT`), but which stage is keying nothing is not.
    const dead = (inputGaps?.rows ?? [])
      .filter((row) => row.stage === stage.name)
      .map((row) => row.input);
    return {
      name: stage.name,
      decision: decision.decision,
      reason: decision.reason,
      // The gate this stage runs, when it declares one: the machinery the key is about, and
      // what the machinery invariant in `src/test/ci-runner.test.ts` walks for its imports.
      ...(stage.script === undefined ? {} : { script: rel(stage.script()) }),
      ...(decision.key === undefined ? {} : { key: decision.key }),
      ...(decision.ageMs === undefined
        ? {}
        : { ageMs: decision.ageMs, recordedAt: decision.recordedAt }),
      ...(matched === null
        ? {}
        : {
            // Each name with the input that matched it, the name redacted entry by entry
            // so the pairing survives — the count is the truth, the names need not be.
            matchedBy: matched.map((pair) => ({
              name: redactInput(pair.name),
              input: pair.input,
            })),
            inputCount: matched.length,
            newestInputMs: newestOf(matched.map((pair) => pair.path)),
          }),
      // The stage's own `inputs` that name no file here, which is the one way a stage can key
      // nothing through an entry and say nothing about it. Absent when the stage has none, so a
      // healthy row is unchanged.
      ...(dead.length === 0 ? {} : { deadInputs: dead }),
      // The other direction of the coverage refusal, on every tree: the watch-rule families this
      // stage's key already holds a member of, each with the member that earned it — the sibling
      // to put a lost file beside. Redacted like the names above, one entry at a time, because a
      // `via` is a file name while the rules are patterns a reader most needs to see. Absent when
      // the pin will not resolve or the stage holds no family, so a healthy entry is unchanged.
      ...(held.length === 0
        ? {}
        : {
            families: held.map((family) => ({
              rule: family.rule,
              via: redactInput(family.via),
            })),
          }),
      // The same modules the key folds in, named whole rather than only as the `imports of
      // …` labels on the pairs above: one field per stage, so a job reading the report gets
      // the stage's machinery in one place. Redacted entry by entry like every name here.
      ...(imports === null || imports.length === 0
        ? {}
        : { imports: redactInputs(imports) }),
    };
  });

  if (JSON_OUTPUT) {
    writeStdoutSync(
      `${JSON.stringify(
        {
          explainCache: true,
          gate: "pass",
          exitCode: 0,
          cacheEnabled,
          cacheFile: rel(CACHE_FILE),
          cacheTtlMs: cacheTtlMs === Infinity ? null : cacheTtlMs,
          ...(globalForce === null
            ? {}
            : {
                globalForce: redactInputs(globalForce.map((file) => rel(file))),
                // The force list's declaration beside the entries in it that resolve to no file:
                // `globalForceAbsent` is the fact, `globalForceContingent` is the decision, and
                // the suite requires the two to be the same set — so a dead entry is a red test
                // naming it rather than a line that re-keys nothing, and an exemption that
                // outlived its reason is red for the same reason.
                globalForceAbsent: forceGaps.absent,
                globalForceContingent: GLOBAL_FORCE_CONTINGENT,
              }),
          // The stage list's declaration of the `inputs` entries allowed to name no file, beside
          // the per-stage `deadInputs` rows that hold it: the suite requires the two to be the
          // same set, in both directions — so a dead entry is a red test naming its stage, and an
          // exemption that outlived its reason is red for the same reason.
          ...(inputGaps === null ? {} : { inputContingent: INPUT_CONTINGENT }),
          stages: explanation,
          reused: [...reusePlan.keys()],
          expired,
          unchanged: wouldSkip.map((stage) => stage.name),
          excluded,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const width = Math.max(0, ...selected.map((stage) => stage.name.length));
    console.log(
      `ci: cache — ${selected.length} selected stage(s), cap ${capLabel}, ` +
        (cacheEnabled ? rel(CACHE_FILE) : "cache off") +
        (globalForce === null ? "" : `, ${globalForce.length} file(s) behind every key`),
    );
    // The force list's dead entries, on the same head: a pattern that matched no file re-keys
    // nothing, so it is said rather than left to be inferred from a count that never moves — and
    // a declared contingency is named as what it is, which is the one place a reader of "what is
    // behind every key?" sees the decision.
    if (forceGaps !== null && forceGaps.absent.length > 0) {
      console.log(
        `ci:   global-force: ${forceGaps.absent.join(", ")} matches no file here` +
          (forceGaps.undeclared.length === 0
            ? " — declared contingent, so it re-keys nothing only until a file of that name appears."
            : ", and is not declared contingent — it re-keys nothing. Drop it, or record it in " +
              "GLOBAL_FORCE_CONTINGENT with the reason it is a spelling this project may yet " +
              `take (declared: ${Object.keys(GLOBAL_FORCE_CONTINGENT).join(", ") || "none"}).`),
      );
    }
    for (const entry of explanation) {
      console.log(`ci:   ${entry.name.padEnd(width)}  ${explainLine(entry)}`);
      // The refusal's sibling, on a tree where nothing is uncovered: which watch-rule family this
      // stage's key already holds a member of, and the member that earned it. `↳ <rule> via
      // <file>` is the same pairing the refusal prints, asked of the stage by name.
      const heldFamilies = entry.families ?? [];
      if (heldFamilies.length > 0) {
        console.log(
          `ci:   ${" ".repeat(width)}  ↳ ${heldFamilies
            .map((family) => `${family.rule} via ${family.via}`)
            .join(", ")}`,
        );
      }
      // The stage's machinery, on its own continuation: the modules the import closure folds
      // into this key, named whole — the same set the `imports of …` labels on the file list
      // above and the `imports` field of the JSON report carry. Silent when the gate loads
      // no module beside itself, which keeps a single-script stage's line unchanged.
      if (entry.imports !== undefined) {
        console.log(`ci:   ${" ".repeat(width)}  ⤷ imports ${entry.imports.join(", ")}`);
      }
      // This stage's own dead entries, one line each, told apart by the decision the same way the
      // global key's line is: an entry somebody wrote down as a spelling this project may yet take
      // reads differently from one that keys nothing and is nobody's decision — so a reader is
      // never told a dead entry is fine. The `✗` is what makes this line the stage's own rather
      // than the head's global-force sentence, which names no stage.
      for (const label of entry.deadInputs ?? []) {
        console.log(
          `ci:   ${" ".repeat(width)}  ✗ ${label} matches no file here` +
            ((inputGaps?.undeclared ?? []).includes(label)
              ? ", and is not declared contingent — it keys nothing for this stage. Drop it, or " +
                "record it in INPUT_CONTINGENT with the reason it is a spelling this project may " +
                `yet take (declared: ${Object.keys(INPUT_CONTINGENT).join(", ") || "none"}).`
              : " — declared contingent, so this stage keys nothing through it only until a file " +
                "of that name appears."),
        );
      }
    }
    for (const name of excluded) {
      console.log(`ci:   ${name.padEnd(width)}  excluded  — --skip asked for it`);
    }
  }
  process.exit(0);
}

// --- A run may not start with a pinned gate file behind no key -------------
//
// The one failure the cache cannot report on its own (see "Every file the pin holds is behind
// some stage's key" above), and the reason it is a refusal rather than a warning: the run's
// verdict *is* the cache's answer for every stage it reuses, so a gate file no key covers is a
// file this run would vouch for without measuring — and, unlike drift, nothing moves later to
// give it away. The two reporting paths have already answered by now (`--dry-run` and
// `--explain-cache` report and exit, `gates:status` prints the same map), so this sits where the
// run begins, and it is asked of the *list* rather than of the selection: `--only=lint` is a
// narrower run, not a narrower stage list, and which key covers a file is a property of the
// list. `--no-cache` is no exception — a gap in the list is what the next cached run would act
// on, and turning the cache off is how a person inspects it.
//
// Each file is named with the watch rule that pinned it, because that is the family the fix is
// written against: a `.json` in the pin came from a rule that names one, and the stage that
// should have been given it is the one whose gate reads that kind of file. The rule is the
// pin's own answer (`ruleOwners`, run through the same scan), not a pattern matched here. The
// stage to edit is named beside it whenever the rule's own family points at one
// (`stageSuggestions`), with the file already behind that stage's key that earned it: a rule
// that lost one file names the stage keying the rest and the sibling to put it beside, and a
// family no stage has ever keyed is said to be just that — the refusal does not guess at a
// stage. And the stage it does name comes with the edit itself: `stageDeclarationLine` renders
// that stage's whole entry — the table it is declared in, read by name — with the file appended,
// printed under the sentence, so the repair is a line to paste rather than a stage to go find in
// this file.
//
// Asked of the run itself, before it opens its log, because a key that does not cover a file can be
// reused from a pass recorded before that file changed, so the run's own verdict would vouch for a
// tree nothing measured — and unlike drift, nothing moves later to give it away. One reading of the
// pin serves both this refusal and the drift stage's lead: `gaps` is the files behind no key, and
// `pinFamilies` is the family view the refusal's rows are grouped by, kept so that a red drift can
// lead with the families nothing below measures. `null` is the pin refusing to resolve, which is
// the alarm's failure to report and not an empty gap list.
//
// The stage order is read here for the same reason and with the same consequence, one step cheaper:
// a copy of the pass that contradicts the stage declarations has told its reader something false
// before anything was measured, and unlike a stale count in a report the lie does not correct
// itself, because nothing below compares a copy to the table it copied. So it is a refusal rather
// than a warning, asked before the pin (five file reads against the alarm's spawn) and long before
// the verdict line that opens the run. The repair is named with the finding for the two generated
// lines — `--stages=write` — and the audit that lists every claim alone is `--stages=check`; both
// answer from the declarations, so they are right on a tree this run has just refused.
const orderDrift = stageOrderFindings();
if (orderDrift.length > 0) {
  const listed = orderDrift
    .map((finding) => {
      const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
      return `${where} (${finding.detail})`;
    })
    .join(", ");
  const regenerator = orderDrift.some(
    (finding) => finding.kind === "generated" || finding.kind === "snapshot",
  )
    ? ", and `--stages=write` regenerates the marked lines"
    : "";
  abort(
    `${orderDrift.length} copy/copies of the stage order disagree with the stage table, so this ` +
      `run could not describe itself: ${listed}. The table is the stage declarations in this file; ` +
      "`node .freebuff/ci.mjs --stages=check` lists every claim" +
      regenerator,
    { orderDrift },
  );
}
const pinCoverage = await pinnedCoverage();
const gaps = pinCoverage === null ? null : pinCoverage.filter(uncoveredRow);
pinFamilies =
  pinCoverage === null
    ? null
    : new Map(familyCoverage(pinCoverage).map((family) => [family.rule, family]));
pinOwners = pinCoverage === null ? null : familyOwners(pinCoverage, STAGES);
if (gaps !== null && gaps.length > 0) {
  const listed = gaps
    .map((row) => {
      const rule = row.rule ?? "no rule that resolves it now";
      // The stage, when the pin's families point at one: "name it in a stage's inputs" is only
      // actionable once the stage is on the line, and the rule alone leaves the reader to work
      // out which stage reads that family. The file that earned the stage is on the line too, so
      // the repair is a stage to extend and a sibling to extend it with rather than a count to
      // take on trust. And the stage's own import modules ride on the sentence, because they
      // are the other half the pasted `inputs` line will not carry: a gate that loads helpers
      // keys them without any declaration, so the repair is the sibling AND the machinery.
      const imports = row.suggested === null ? null : closureOf(row.suggested);
      const repair =
        row.suggested === null
          ? "no stage keys anything this rule pins"
          : `add it to the ${row.suggested} stage, which already keys ${row.suggestedBy}` +
            (imports === null || imports.length === 0
              ? ""
              : ` and imports ${imports.join(", ")}`);
      return `${row.file} (pinned by ${rule}; ${repair})`;
    })
    .join(", ");
  // The half a reader can act on without reading the runner: the suggested stage's own `inputs`
  // declaration with the file appended, under the sentence, so the fix is a line to paste rather
  // than a stage to go find. Only the rows with a stage get one — a family no stage has keyed has
  // no line to edit, and inventing a stage there is the guess this refusal exists to avoid.
  const repairs = gaps
    .filter((row) => row.suggested !== null)
    .map((row) => ({
      file: row.file,
      stage: row.suggested,
      line: stageDeclarationLine(stageDeclaration(row.suggested), row.file),
    }));
  const repairByFile = new Map(repairs.map((entry) => [entry.file, entry.line]));
  const repairBlock =
    repairs.length === 0
      ? ""
      : "\n  repair — the stage's entry in .freebuff/gate-drift.mjs with the file appended:\n" +
        repairs.map((entry) => `    ${entry.line}`).join("\n");
  abort(
    `${gaps.length} pinned gate file(s) are behind no stage's key, so this run could not ` +
      `vouch for them: ${listed}. Name each in the inputs of the stage beside it, or record ` +
      "it in KEY_EXEMPT_PINNED with a reason — `npm run gates:status` prints the map" +
      repairBlock,
    {
      uncovered: gaps.map((row) => ({
        file: row.file,
        rule: row.rule,
        stage: row.suggested,
        via: row.suggestedBy,
        repair: repairByFile.get(row.file) ?? null,
        // The same modules the sentence names, as data: a job applying the repair gets the
        // stage's full machinery, not only the sibling the `via` speaks for. Null with no
        // stage, matching the sentence that names none.
        imports: row.suggested === null ? null : closureOf(row.suggested),
      })),
    },
  );
}

// The scripts a stage runs are the machinery of the run, and one can be described by the pin and
// still be unloadable: a rewrite cut off mid-expression is a file no reader can open. Asked here,
// before the log's opening line and before any stage, because the four stages that read it each
// report it as something it is not — a lint finding, a gate with no JSON, a suite whose subject
// never loaded, a pin that moved — and none of them says the one thing a reader needs.
// Only the stages that will actually run: a `--changed-only` skip and a cache reuse both mean the
// script is never spawned, and a reused stage's inputs are unchanged since a pass recorded when
// the script parsed — so neither can be the truncated write this refusal is about. On a fully
// warm cache that leaves the guard with nothing to ask, which is the right price for it.
const willRun = selected.filter(
  (stage) => !wouldSkip.includes(stage) && !reusePlan.has(stage.name),
);
const unparsable = await unparsableScripts(willRun);
if (unparsable.length > 0) {
  const listed = unparsable
    .map(({ file, line, message }) => `${file}${line === null ? "" : `:${line}`} (${message})`)
    .join(", ");
  abort(
    `${unparsable.length} stage script(s) cannot be parsed, so the run would report their ` +
      `breakage as a stage it is not: ${listed}. Finish the edit — or restore a pinned file, ` +
      "whose last copy is under `.ci/gate-content` — before a stage is asked to run machinery " +
      "no reader can load",
    { unparsable: unparsable.map(({ file, line, message }) => ({ file, line, message })) },
  );
}

// Open the log with the counts the run can already state: nothing has passed or
// failed yet, but `--skip`, change detection and the cache have fixed the parts
// that will not run. It is the same line that closes the log, so a reader (or a
// log-scraping job) sees the shape of the run before scrolling past the evidence.
progress(
  verdictLine({
    passed: 0,
    failed: 0,
    skipped: 0,
    unchanged: wouldSkip.length,
    reused: reusePlan.size,
    excluded: excluded.length,
    total: selectedTotal,
  }),
);
progress(`ci: running ${selected.length} stage(s): ${selected.map((stage) => stage.name).join(", ")}\n`);

// Name the stages `--skip` removed, so a green run is never mistaken for a full
// pass — a deliberate omission has to be as visible as an accidental one would
// be loud.
if (excluded.length > 0) {
  progress(`ci: --skip excludes: ${excluded.join(", ")}`);
}

// Say so when CI switched the behavior on, so the log explains why a run kept
// going (or, with `--fail-fast`, why it did not).
if (ciDetected && maxFailures === null && !keepGoingArg && !failFastArg) {
  progress(
    "ci: CI environment detected — running every stage after a failure (pass --fail-fast to stop at the first)",
  );
}
if (maxFailures !== null) {
  progress(`ci: stopping after ${maxFailures} failing stage(s)`);
}
// Name the stages whose recorded pass was too old to trust, so a re-run that looks
// like it should have been reused says why it was not.
if (expired.length > 0) {
  progress(
    `ci: re-running ${expired.length} stage(s) — recorded pass expired (cap ${capLabel}): ${expired.join(", ")}`,
  );
}

/**
 * What a killed run left behind, healed before a single stage measures anything.
 *
 * The tree-editing checks hold a lock while a file is mutated, and the only thing that
 * puts the file back is the check that owns it running again — which `--skip`, `--only`
 * and a change set that feeds nothing can decide not to do, and which the failure
 * budget can stop the run short of. It is also what every stage *before* the healer
 * would measure: a coverage gate script left weakened taints the coverage stage, and a
 * route left fail-open taints the suite. So the recovery runs here, ahead of the
 * stages, in the mode a run that is not the lock's owner warrants — a stale lock (the
 * kill case) is restored, one held by a live check is described rather than fought,
 * because that check is editing this tree right now.
 */
const recovery = existsSync(LOCK_PATH) ? recoverInterruptedRun({ mode: "report" }) : null;
// The stage whose check wrote it, when this run knows one — a recovery reported on that
// stage's own row is the narrow case a reader looks at first. `recoveryOnStage` records
// that the loop below did report it there, so the run does not say it twice.
const recoveryStage =
  recovery === null ? null : (STAGES.find((stage) => stage.editsTree === recovery.check) ?? null);
let recoveryOnStage = false;

// One recovery outcome is still not a state this run may describe and then carry on from:
// `absorbed`, which the shared recovery now answers itself wherever it can — a later edit
// that absorbed a mutation leaves a file that is neither the source before the sweep's edit
// nor the source after it, and the lock's own pre-mutation source goes back over both when
// the holder is dead (`absorbed-restored`, a warning like any other heal). What still arrives
// here is the residue: the write did not verify, so a half-written file may be on disk, and
// every stage below would be measuring it as the real thing. The refusal is the runner's own
// path for a tree it will not vouch for (`abort`: the message on stderr, and the recovery
// itself in the `--json` payload rather than in a stage row no report could trust); the
// lock's owner refuses the same state from inside `.freebuff/mutation-lock.mjs` with exit 2,
// and a reporter cannot exit from there without taking its report with it.
if (recovery?.action === "absorbed") {
  abort(recovery.message, {
    recovered: [
      {
        ...recovery,
        stage: recoveryStage?.name ?? null,
        label: recoveryStage?.label ?? null,
        ...recoveryDetails({ recovered: [recovery] })[0],
      },
    ],
  });
}

const results = [];
const skipped = [];
const unchanged = [];
const reused = [];
// Failing stages seen so far, for the `--max-failures` budget below.
let failures = 0;
for (let index = 0; index < selected.length; index += 1) {
  const stage = selected[index];
  // A stage no changed file feeds is skipped rather than failed: it stays in the
  // report as `unchanged`, and the run continues to the stages that did move.
  if (!stageTouched(stage)) {
    unchanged.push(stage.name);
    if (JSON_OUTPUT) {
      progress(`ci: ${stage.name} skipped — nothing it reads changed`);
    } else {
      console.log(`── ${stage.label} ──`);
      console.log(`SKIP  ${stage.label} — nothing it reads changed`);
      console.log("");
    }
    continue;
  }
  // A stage whose inputs are byte-identical to a recorded pass is answered from
  // the cache rather than re-run: the same evidence, without paying for it twice.
  const reuse = reusePlan.get(stage.name);
  if (reuse) {
    reused.push(stage.name);
    if (JSON_OUTPUT) {
      progress(`ci: ${stage.name} reused — ${reuse.summary} (inputs unchanged since a passing run)`);
    } else {
      console.log(`── ${stage.label} ──`);
      console.log(`REUSE ${stage.label} — ${reuse.summary} (inputs unchanged since a passing run)`);
      console.log("");
    }
    continue;
  }
  // One reading either side of the pass, both taken from the tree as it actually is: the
  // key the *run decided* against was computed up front, and — unlike these — before the
  // run healed a killed check's lock, so it is evidence about the decision rather than
  // about the stage. See where the entry is written below.
  const startedKey = rereadStageKey(stage);
  // Redacted the moment it exists, so no consumer of the result — the human report,
  // the JSON, an annotation — can publish a name another one hides.
  const result = redactResult(stage.run(stage));
  results.push({ stage, result });
  // A recovery this run performed before any stage ran belongs on the row of the stage
  // that would have done it — the same place, and the same `WARN RECOVERED` detail, a
  // check's own recovery lands on when the check is run directly.
  if (recovery !== null && recoveryStage !== null && recoveryStage.name === stage.name) {
    recoveryOnStage = true;
    result.details.unshift(...recoveryDetails({ recovered: [recovery] }));
    result.summary += recoveredNote([recovery]);
  }
  if (result.pass && startedKey !== null) {
    // What a pass can vouch for is the tree it leaves. Reuse compares against *that*, so
    // a stage whose run edits the files it reads — a check that restored a killed run's
    // lock, a formatter writing its own output — is never answered for a tree it never
    // produced. `startedHash` keeps the other side, where a reader can see the two differ.
    const leftKey = rereadStageKey(stage);
    nextCache.stages[stage.name] = {
      hash: leftKey ?? startedKey,
      startedHash: startedKey,
      pass: true,
      summary: result.summary,
      at: new Date().toISOString(),
    };
    // An input that vanished while the stage ran is a change and not a crash: the entry
    // above is the tree that is *left*, so the file's absence is in the key. It is said
    // out loud because the two hashes differing is true of nearly every stage here and
    // says nothing about which input moved — or that anything went at all.
    for (const file of missingInputs(stage)) {
      const name = rel(file);
      result.details.push({
        mark: "WARN INPUT GONE",
        name,
        detail:
          "input vanished while the stage ran — the key is recorded against the tree that is left",
        location: { file: name },
      });
    }
  }
  // A stage that had to run because its recorded pass aged out says so on its own
  // line, so the reason sits with the evidence rather than only up front.
  const agedOut = expiredSet.has(stage.name) ? " (its recorded pass expired)" : "";
  if (JSON_OUTPUT) {
    progress(`ci: ${stage.name} ${result.pass ? "pass" : "fail"} — ${result.summary}${agedOut}`);
  } else {
    console.log(`── ${stage.label} ──`);
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${stage.label} — ${result.summary}${agedOut}`);
    for (const detail of result.details) {
      const line = detail.name ? `${detail.name}  ${detail.detail}` : detail.detail;
      console.log(`      ${detail.mark}  ${line}`);
      // A diff is printed under its row, indented one step past it, so the `-`/`+` lines
      // read as part of the finding they explain.
      for (const row of String(detail.diff ?? "").split("\n")) {
        if (row !== "") console.log(`            ${row}`);
      }
      if (detail.fix) console.log(`            fix: ${detail.fix}`);
    }
    for (const raw of result.raw ?? []) {
      console.log(`      | ${raw.split("\n").join("\n      | ")}`);
    }
    console.log("");
  }
  if (!result.pass) {
    failures += 1;
    // A keep-going run never stops; a capped one stops at its budget; the local
    // default budget is one. Either way the stages not reached are named.
    if (failures >= failureBudget) {
      skipped.push(...selected.slice(index + 1).map((next) => next.name));
      break;
    }
  }
}

// A recovery that belonged to a stage which did not run — excluded by `--skip`, not
// selected, fed by nothing that changed, or never reached because a failure stopped the
// run — has no row to be reported on, so the run reports it itself, in the same warning
// shape a stage's own recovery takes. The alternative is the state this whole path
// exists to end: the tree put back in silence, or worse, not put back while a green run
// page implies every gate was measured against the source it names.
const runRecovery = recovery !== null && !recoveryOnStage ? recovery : null;
if (runRecovery !== null) {
  const [detail] = recoveryDetails({ recovered: [runRecovery] });
  if (JSON_OUTPUT) {
    progress(`ci: lock recovery — ${detail.detail}`);
  } else {
    const owner = recoveryStage === null ? "" : ` (in place of ${recoveryStage.label})`;
    console.log(`── interrupted run recovery${owner} ──`);
    console.log(`${detail.mark}  ${detail.name}  ${detail.detail}`);
    console.log("");
  }
}

// Persist what passed before any of the exit paths below can leave, so the next
// run can reuse it. Written even on a red run: the stages that got through are
// still passed, and a re-run should not pay for them a second time.
if (cacheEnabled) saveCache(nextCache);

const failed = results.filter(({ result }) => !result.pass).map(({ stage }) => stage.name);
const exitCode = failed.length === 0 ? 0 : 1;
// The stages that actually ran: `selected` minus the ones change detection skipped.
const ran = results.length;

// The files that moved underneath the run, from the opening snapshot — the evidence a
// shared-tree run needs to say which reds are a concurrent session's. Read here, at the
// close, once; a green run has no failures to mark but consumes the snapshot anyway so
// the next run opens fresh.
const pinSuspects = await readPinSuspects();
if (pinSuspects.length > 0 && failed.length > 0) {
  const paths = pinSuspects.map((suspect) => `${suspect.path} (${suspect.how})`).join(", ");
  console.error(
    `ci: concurrent-edit suspects — ${pinSuspects.length} pinned gate file(s) moved during this run: ${paths}` +
      " — failed stages may be reading a tree another session is writing; re-run over a settled tree before owning these reds",
  );
}
for (const suspect of pinSuspects) {
  for (const { stage, result } of results) {
    if (result.pass) continue;
    result.details.push({
      mark: "WARN",
      name: suspect.path,
      // The file rides in the location, so the annotation this detail becomes points at
      // the moved file on the diff rather than at nothing.
      location: { file: suspect.path },
      detail:
        `moved during this run (${suspect.how} since the run opened) — a concurrent session was writing ` +
        `this file while the ${stage.label} measured the tree; this failure may be theirs, not this checkout's`,
      suspect: true,
    });
  }
}

// The locatable failures and warnings, in stage-then-detail order, so the first
// annotation is the first failure. Derived from the same result objects the
// human report and the JSON payload read, so the two cannot drift apart. A *heading*
// is a grouping label rather than a finding — the drift stage folds its rows under one
// per watch family — so it is skipped: it names no file, and a fileless `::error` per
// family would be annotation noise, not a place on the diff. The rows keep their
// annotations, so the fold costs no file its mark.
// The runbook's dated bullet, written once the run's own facts are all in hand —
// the counts, the failed stages, the suspects — so what it records is what this
// run closed with, not a projection of it.
const recorded = recordRunBullet();

const annotations = results.flatMap(({ stage, result }) =>
  result.details.filter((detail) => !detail.heading).map((detail) => annotationFor(stage, detail)),
);
// A recovery the run performed in place of a stage that did not run has no stage to be
// annotated against, so it is annotated under the run — and last, so the first
// annotation is still the first thing a stage reported.
if (runRecovery !== null) {
  const [detail] = recoveryDetails({ recovered: [runRecovery] });
  annotations.push({
    level: "warning",
    ...(detail.location?.file ? { file: detail.location.file } : {}),
    title: recoveryStage?.label ?? "interrupted run recovery",
    message: detail.detail,
  });
}

/**
 * The run's one-line verdict: how every selected stage ended, by outcome. It
 * exists for the long log — the per-stage lines are the evidence, but a reader
 * (or a log-scraping summary step) wants the count without scrolling to find it.
 * The ways a stage does **not** run are counted apart — `unchanged` (no changed
 * file fed it), `skipped` (a failure stopped the run before it), `reused` (its
 * inputs are byte-identical to a recorded pass) and `excluded` (`--skip` asked for
 * it) — so "did not run" can never be read as "passed" this run. `reused` is the
 * one of the four with evidence behind it, which is why it is named rather than
 * folded into `unchanged`.
 *
 * It formats a supplied set of counts rather than reading the run's state, so the
 * same line can bracket the log: the opening call projects what the run is about to
 * attempt, the closing one reports what it did.
 */
function verdictLine(counts) {
  return (
    `ci: verdict — ${counts.passed} passed, ${counts.failed} failed, ` +
    `${counts.skipped} skipped, ${counts.unchanged} unchanged, ` +
    `${counts.reused} reused, ${counts.excluded} excluded (${counts.total} selected)`
  );
}

/** The closing verdict: the counts exactly as the run left them. */
function finalVerdict() {
  return verdictLine({
    passed: results.filter(({ result }) => result.pass).length,
    failed: failed.length,
    skipped: skipped.length,
    unchanged: unchanged.length,
    reused: reused.length,
    excluded: excluded.length,
    total: selectedTotal,
  });
}

if (JSON_OUTPUT) {
  const payload = {
    gate: exitCode === 0 ? "pass" : "fail",
    exitCode,
    stages: results.map(({ stage, result }) => ({
      name: stage.name,
      label: stage.label,
      pass: result.pass,
      summary: result.summary,
      details: result.details.map((detail) => ({
        mark: detail.mark,
        ...(detail.name ? { name: detail.name } : {}),
        detail: detail.detail,
        // A family heading rather than a finding: it names no file and the rows under it are
        // its members, so a machine consumer of the report can tell the two apart the way the
        // annotations do — and the fold reaches a report read *after* the run, not only the log.
        ...(detail.heading ? { heading: true } : {}),
        // The loosening, when the gate that failed is the alarm: a report a reader
        // consults *after* the run has to carry it too, or the only place the change is
        // legible stays the log the failure scrolled past.
        ...(detail.diff ? { diff: detail.diff } : {}),
        // The concurrent-edit attribution, when the run's opening pin snapshot names a
        // file that moved underneath it: a machine consumer reads the same suspects the
        // human report annotates, per detail rather than re-deriving them.
        ...(detail.suspect ? { suspect: true } : {}),
        ...(detail.fix ? { fix: detail.fix } : {}),
      })),
      raw: result.raw ?? [],
    })),
    failed,
    skipped,
    stoppedEarly: skipped.length > 0,
    keepGoing,
    maxFailures,
    // The reuse policy in force, so a consumer can tell a capped run from an
    // uncapped one (`null` is "no cap").
    cacheTtlMs: cacheTtlMs === Infinity ? null : cacheTtlMs,
    unchanged,
    reused,
    expired,
    excluded,
    // The pinned gate files that moved between the run's opening snapshot and its close,
    // the evidence the suspect annotations mark: empty when the tree was quiet or the
    // snapshot could not be taken, so a settled run reads no different from before.
    suspects: pinSuspects,
    // What the close did with the runbook's dated bullet: `written` when this run appended
    // it, `deduped` when the file already held this run's bullet, `declined` under
    // `--no-record`, `failed` when the append itself failed — so a machine consumer can
    // tell a recorded run from a silent one without reading the runbook.
    recorded,
    // The rendered-links guard's coverage reading, when the suite left one: the same
    // line the runbook bullet quotes, so a consumer of this report sees the guard's
    // coverage trend without reading the runbook. Absent (`null`) for a stubbed or
    // failed suite — an omission, never a zero.
    coverageStamp: renderedLinksCoverage,
    // A lock the run dealt with before any stage ran, when the stage that owns it was
    // not one of them: it has no stage row to ride, so the run carries it here, with the
    // `mark` a report reads to tell a heal from a lock left for a human.
    ...(runRecovery === null
      ? {}
      : {
          recovered: [
            {
              ...runRecovery,
              stage: recoveryStage?.name ?? null,
              label: recoveryStage?.label ?? null,
              ...recoveryDetails({ recovered: [runRecovery] })[0],
            },
          ],
        }),
    annotations,
  };
  // The verdict is progress, not the report: under `--json` it belongs on
  // stderr with the rest, where it still closes the CI log.
  progress(finalVerdict());
  writeStdoutSync(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

// The workflow commands go on stdout, where the GitHub runner reads them; they
// sit alongside the human report, whose lines the runner ignores.
const emitAnnotations = () => {
  for (const annotation of annotations) console.log(workflowCommand(annotation));
};

// The same line closes either outcome: a run that skipped stages says so, so a
// green job never hides that some stage did not run.
const reportUnchanged = () => {
  if (unchanged.length === 0) return;
  console.error(
    `ci: skipped ${unchanged.length} unchanged stage(s): ${unchanged.join(", ")}` +
      (changeNote ? ` (${changeNote})` : ""),
  );
};

if (exitCode === 0) {
  if (GITHUB_ANNOTATIONS) emitAnnotations();
  // A green run says which of the three green shapes it was: nothing to do, the
  // selected stages all ran, or some were answered from the cache — so `ran` being
  // short of the selection never reads as a stage that quietly went missing.
  const greenMessage =
    ran === 0
      ? reused.length > 0
        ? `ci: nothing ran — ${reused.length} stage(s) reused from a recorded pass.`
        : `ci: nothing to run — no stage reads anything in the change set.`
      : reused.length > 0
        ? `ci: all ${ran} stage(s) that ran passed (${reused.length} reused).`
        : `ci: all ${ran} stage(s) passed.`;
  console.log(greenMessage);
  reportUnchanged();
  // The dated bullet rides the green close too: a run recorded only when it fails
  // would leave the runbook reading as if nothing had been measured since the last red.
  recordRunBullet();
  // The one-line verdict closes even a green log, so the counts are in the same
  // place whether the run passed, failed, or stopped short.
  progress(finalVerdict());
  process.exit(0);
}

console.error(`ci: ${failed.length} of ${ran} stage(s) failed: ${failed.join(", ")}`);
if (skipped.length > 0) {
  console.error(
    `ci: stopped early — ${skipped.length} stage(s) not run: ${skipped.join(", ")} (use --keep-going to run them, or --from=${skipped[0]} to resume at one${
      maxFailures === null ? "" : `, or raise --max-failures above ${maxFailures}`
    })`,
  );
}
reportUnchanged();
recordRunBullet();
progress(finalVerdict());
if (GITHUB_ANNOTATIONS) emitAnnotations();
process.exit(1);
