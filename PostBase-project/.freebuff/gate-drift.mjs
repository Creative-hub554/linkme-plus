#!/usr/bin/env node
/**
 * The drift alarm for the build's gate machinery: a gate on the gates.
 *
 * Every check this repo has is ultimately a file that decides something. `tsc` is
 * decided by `tsconfig.json`, the suite by `vitest.config.ts`, each gate stage by the
 * script `.freebuff/ci.mjs` spawns for it, and the mutation checks by the modules they
 * are made of. Two of those are already well guarded: `src/test/coverage-*.test.ts`
 * pins what each coverage script *does*, `npm run mutation:coverage` proves those tests
 * still notice a weakening, and the crash-safe lock (`.freebuff/mutation-lock.mjs`) puts
 * a script back when a killed run left it edited. What none of them answers is the fourth
 * question — is the file on disk still the one that was reviewed and recorded? A hand
 * edit that *loosens* rather than breaks is the one nothing notices: an extra entry in
 * the suite's `exclude`, an empty `inputs` on a stage, a launcher that stops failing on a
 * survivor, a redactor that stops redacting, a lock module whose recovery returns early.
 * None of those changes a line of product code, so no test exists to catch them, and the
 * build goes on reporting a green it did not earn. That is what this pins.
 *
 * ## Coverage is one family of this, not the whole of it
 *
 * The five coverage scripts were the first thing pinned, and the reason the pattern
 * generalises: a weakened gate is otherwise silent *because* nothing outside the gate
 * reads the gate. So the watch rules now name the **whole gate surface**, and the
 * principle for what belongs is one sentence: *any file whose job is to decide, enforce
 * or publish a verdict, and which changes only when that verdict changes.* In practice:
 *
 *   - the coverage gates and the algebra, thresholds and floor rules they share
 *     (`coverage-*.mjs`), because the *numbers* live there as much as the comparisons;
 *   - the runner (`ci.mjs`), which decides which stages exist, what they read, what the
 *     cache may answer for and whether a killed run's tree is healed at all — an extra
 *     `exclude` or an emptied `inputs` there disables a gate without touching it;
 *   - the two tree-editing checks and the lock they share (`mutation-*.mjs`), because a
 *     launcher that stops calling a survivor a survivor, or a recovery that returns
 *     early, is the difference between a gate and a ceremony;
 *   - the other stage scripts and their builders (`build-contents.mjs`,
 *     `runbook-contents.mjs`, `lint-baseline.mjs`, `preview-preflight.mjs`), each of
 *     which is the entire enforcement of its stage;
 *   - the redactor and the nightly report renderer (`redact.mjs`, `nightly-report.mjs`),
 *     which decide what a published report is allowed to say — a report that hides a
 *     failure is a gate that failed quietly;
 *   - the collect-budget ratchet (`collect-*.mjs`, `*-collect-baselines.mjs`), whose
 *     recorder, proposer, applier and recorded numbers are the same shape as the
 *     coverage ratchet one directory over;
 *   - what the suite itself measures (`vitest.config.ts`, `vitest.mutation.config.ts`)
 *     — `all: true`, the thresholds hand-off, the exclusion that isolates the mutation
 *     check, the collect-budget reporter: drop any and the run still passes;
 *   - the config that decides whether any of it is checked at all (`tsconfig.json`,
 *     `eslint.config.mjs`) — an `exclude` widened by one glob, a `strict` dropped, a rule
 *     turned off: the same silent loosening one level out, where the gate that stopped
 *     applying is the compiler and the linter rather than a stage;
 *   - the client build's own configs (`vite.config.ts`, `next.config.mjs`) — Vite's
 *     `define:` table is the shortest path a value has into a bundle (nothing has to
 *     import anything; the bundler is simply told to substitute) and `next.config.mjs`
 *     reads `R2_PUBLIC_URL` at build time and decides which hosts `next/image` will load
 *     from. `src/test/client-env.test.ts` reads both, so the rule below is what catches a
 *     loosening outside that guard's policy: a literal in `define:`, a widened
 *     `remotePatterns`, a build that stopped inlining a public value at all;
 *   - the rest of what ships, which the client configs do not cover
 *     (`postcss.config.mjs`, `wrangler.jsonc`): the stylesheet pipeline, whose *generated*
 *     output `src/test/globals-layer.test.ts` says outright it cannot check — it parses
 *     `globals.css`, so a plugin dropped here empties every utility and no test reds — and
 *     the worker's own shape (entry point, compatibility date and flags, the Durable Object
 *     class and its migration tags, every binding), which is also the source
 *     `npm run types:worker` regenerates `worker-configuration.d.ts` from, the `Env` the
 *     compiler then reads. Neither is in any `tsconfig.json` include;
 *   - and the workflows that decide whether any of it *runs* (`.github/workflows/*.yml`) —
 *     a step deleted, a job given `if: false`, a `continue-on-error: true` added, the
 *     `--skip=` in what `npm run ci` is asked for widened. This is the one family whose
 *     loosening no stage below can notice *by construction*, because what it changed is
 *     the thing that would have run them: the gate is cancelled from above, and the run
 *     page of a job that steps were removed from reads exactly like a page that never
 *     had them.
 *
 * The *recorded* numbers count as machinery too, which is why `coverage-thresholds.mjs`,
 * `coverage-floor-rules.mjs` and `collect-budget-baselines.mjs` are in the set even
 * though a script writes them: they are what a gate enforces, so a raise is the loosening
 * this exists to catch, and the recorder run and the re-pin belong in the same commit.
 *
 * Deliberately *not* pinned, and the reason each is a decision rather than an oversight:
 * `package.json` and the lockfiles (a dependency bump rewrites them constantly, and
 * `GLOBAL_FORCE` in the runner already makes a change there re-run every stage), the
 * artifacts a *run* writes rather than a reviewer (`gate-hashes.mjs` itself, which could
 * never record its own hash; `.ci/`; the transient `.collect-*.json` verdicts), and the
 * operational one-offs that gate nothing (`apply-migration.mjs`, `apply-sql.mjs`,
 * `live-insert.mjs`, the `*-probe.mjs` scripts, the skill-index builders). Nothing else
 * under `.github/` exists to pin today; a composite action under `.github/actions/`
 * would be the next thing to consider there, deliberately, since a workflow's step can
 * name one only by path. `tsconfig.json`
 * and `eslint.config.mjs` were on this list as "worth pinning later, deliberately", and
 * they no longer are: `GLOBAL_FORCE` already re-runs every stage when one of them changes,
 * which is exactly the gap — a config that cancels a check is re-read by every gate and
 * compared to nothing. `tsconfig.tsbuildinfo` sits beside `tsconfig.json` and is left out
 * for the ordinary reason: it is incremental-build output, not a decision. The two client
 * build configs joined the pin for the same reason one level further out: `vite.config.ts`
 * carries the `define:` table the bundler substitutes from, and `next.config.mjs` decides
 * which hosts `next/image` will load. The two beside them joined next, on the same argument
 * pushed one step out: nothing reads a loosening in `postcss.config.mjs` — it is the whole
 * stylesheet pipeline, and the suite parses `globals.css` by its own account in
 * `src/test/globals-layer.test.ts` rather than the *generated* stylesheet, so a dropped
 * plugin empties every utility while every test still passes — and `wrangler.jsonc` decides
 * what the deployed worker *is*, which is the one thing here no stage can run to find out.
 * (`GLOBAL_FORCE` in the runner already names `postcss.config.*`, so a change re-keys every
 * stage; re-running is not noticing, which is why it needs the pin as much as `tsconfig.json`
 * did.) Exactly one root config stays outside, and it is the one that decides nothing on its
 * own: `drizzle.config.ts` names the file `drizzle-kit` reads as the schema and the directory
 * it writes into, while the schema itself (`src/lib/db/schema.ts`) is the file that decides
 * anything — type-checked, tested and read by the app — and the migrations are hand-written,
 * hand-reviewed and hand-applied by the same one-off tools that are outside the pin for the
 * same reason. A pointer for a tool whose output is read as ordinary source is not the
 * machinery this pins. `src/test/gate-drift.test.ts` holds that edge from both sides: the
 * rule that claims the pair reaches exactly it, and no rule may claim `drizzle.config.ts`
 * while it stays out, so promoting it later is a declaration edit rather than a quietly
 * widened pattern. The client-env boundary is written down as a pair in
 * `convention-guards.ts` and held to its own rule by `src/test/gate-drift.test.ts`, so a
 * third config the client-env guard starts reading has to be added here rather than left
 * outside the pin.
 *
 * ## What "committed" means here
 *
 * The obvious answer would be `git diff HEAD`, and it is not available: this checkout has
 * no commits, so there is no `HEAD` to differ against. What a review actually fixes is
 * *content*, so that is what gets recorded — a checked-in manifest of one hash per
 * watched file, `.freebuff/gate-hashes.mjs`, regenerated with `npm run gates:pin`. The
 * manifest travels with the branch like any other file, so a loosening has to change it
 * too, in the same diff a reviewer reads. It is the shape the runbook's pinned Contents
 * and the collect-budget baselines already use: a small committed artifact a script
 * regenerates and a gate compares the tree against.
 *
 * The watch rules are declared once, in `DEFAULT_WATCHES`, and the manifest *records* them
 * beside the hashes, so widening or narrowing the set is a reviewed line in the pin's diff
 * as well as a one-line edit here. The record is checked against the declaration, and a
 * manifest that names a different set is refused rather than scanned by, so the pin, the
 * check and the recorder can never answer to two rule sets at once — the failure that once
 * let `npm run gates:pin` render a narrower list than the manifest had recorded. The
 * algorithm is read from the manifest, so a future move to a stronger digest is a recorded
 * fact rather than a silent mismatch — and a rule that matches nothing is caught rather than
 * passing vacuously (see the empty-pin guard below), because a gate that pins no file is
 * exactly the failure this exists to prevent.
 *
 * ## How drift reads
 *
 * Three findings, all of them a failure:
 *
 *   - **changed** — a pinned file's hash is not what the manifest records. This is the
 *     loosened gate, and the one the alarm exists for.
 *   - **unpinned** — a file matching a watch rule that the manifest does not name. A new
 *     gate script nobody pinned is exactly as unguarded as a weakened one, so it is
 *     refused until `npm run gates:pin` records it.
 *   - **gone** — a pinned file no longer on disk (renamed or deleted), which would
 *     otherwise let a gate disappear quietly.
 *
 * The findings fold under a heading per watch family, the way the runner's drift stage folds its
 * own: the rule that names them, how many of its members moved, and the stage that owns it — `held
 * by the <stage> stage`, `extend the <stage> stage, which already keys <via>`, or `no stage keys it;
 * name it in a stage's `inputs`` — with the rows themselves kept in the order they were collected,
 * so the `changed`/`unpinned`/`gone` reading survives inside each family, and a pinned path no rule
 * names any more under a heading of its own. The stage list an owner is read from is declared here,
 * in `STAGE_TABLE`, beside the watch rules, and the runner builds its `STAGES` from it: the alarm's
 * fold and the runner's answer the same question from one declaration. Both fields also travel on
 * each finding in `--json` (`family`, `owner`), and the *order* the headings take travels beside the
 * rows (`movedFamilies`), so a consumer that folds the report itself puts the same family first.
 *
 * `--write <path>` reports the drift it did not record the same way, as `left` on its
 * payload, instead of refusing while other files are drifted.
 *
 * Two ways the alarm cannot answer are told apart from drift, and both are failures:
 * a manifest missing or malformed is exit **2** (the alarm could not run at all), and a
 * pin that names *nothing* is exit **2** as well (the watch rules matched no file, so a
 * "pass" would be vacuous). "The check could not answer" must never read as "the gates
 * are fine".
 *
 * ## The one change a script may make to the manifest
 *
 * `npm run gates:pin` records the *whole* tree, which is the right answer for a person with
 * a diff to read and the wrong one for a script that has just written one pinned file: run
 * from automation it would bless every other file in that checkout, including one somebody
 * loosened by hand — precisely what this alarm exists to catch. So `--write <path>` re-pins
 * the files it is named, through the exported `repin`, and refuses two things: a path the
 * manifest does not already pin (adding a gate is a person's decision) and a pinned path
 * that is gone from disk (a re-pin never drops a pin). A *third* case — another pinned file
 * that no longer matches the tree — is **reported** as `left` rather than refused: those
 * entries keep the hash they already had, so nothing is absorbed and the next check still
 * reports them, while a re-pin for your own file stops being blocked by somebody else's
 * edit in a shared checkout. A targeted re-pin therefore never widens the pin, never
 * narrows it, and never takes responsibility for a file it was not asked about — it does
 * not need to refuse for that to hold.
 *
 * The caller that needs it is `.freebuff/apply-collect-baselines.mjs`: it writes
 * `.freebuff/collect-budget-baselines.mjs` on an approved `/collect-apply`, that file is a
 * pinned gate file, and the workflow that runs the applier commits the two together — so the
 * follow-up commit cannot land a tree whose pin no longer matches.
 *
 * ## The one-line state of the pin
 *
 * `--status` answers the three questions a person has before doing anything about a pin, in
 * one line: what does not match, what a *targeted* re-pin could record, and whether the diff
 * cache can still read the next drift (`stashReport`, verified counts, so the line cannot
 * promise a reading the alarm would refuse to produce). It writes no pin and stashes nothing
 * — a report that filled the cache on its way past would answer "the cache is healthy" about
 * a cache it had just written, which is the one question it exists to answer honestly — and
 * a combination that asks it to (`--status` with `--write` or with paths) is refused as the
 * typo it is. Its exit codes are the check's, so it can stand in for `gates:drift` wherever
 * the line is more useful than the findings; `--status --json` carries the check's whole
 * payload *plus* `cache` and `recordable`, which is what a script should read instead of
 * parsing the sentence.
 *
 * That line is the *pin's* state and nothing more: it says what does not match, not which key
 * covers each pinned file. The stage *list* is declared here — the findings above name an owner
 * from it — but the map of file-to-key is the runner's question, so `npm run gates:status` runs
 * `ci.mjs --status` — this line, printed by this script as a child process so there is one
 * renderer of it, followed by that coverage map.
 *
 * ## Usage
 *
 *   npm run gates:drift        # compare the tree to the pinned manifest; exit 1 on drift
 *   npm run gates:status       # that state as one line, then the stage key behind each
 *                              #   pinned file (`ci.mjs --status`, which runs this one)
 *   node .freebuff/gate-drift.mjs --status   # the one line on its own
 *   npm run gates:pin          # record the tree as it is now (--write, no paths)
 *   node .freebuff/gate-drift.mjs --write .freebuff/<file>.mjs   # re-pin that file only
 *   node .freebuff/gate-drift.mjs --json   # one report object on stdout
 *
 * Exit codes: 0 when every pinned file matches, 1 when anything drifted, 2 when the
 * manifest could not be read or written, when there is nothing pinned to check, or when a
 * targeted re-pin refuses the path it was named. `--write` answers 0 once it has written,
 * including when the re-pin named files to leave alone and did — `left` is where that is
 * reported, because "did the write happen" and "is the tree pinned" are two questions and
 * only the check answers the second. `--status` answers the same codes as the check it
 * reports on, and never 2 for a cache that cannot be written: a cold or degraded diff cache
 * is a fact in the line, not a verdict.
 *
 * `GATE_HASHES_FILE` (an absolute path, or one relative to the project root) points the
 * alarm at another manifest, which is how `src/test/gate-drift.test.ts` drives it against
 * a throwaway tree: nothing but a test ever sets it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redactText } from "./redact.mjs";
import { assertWholeScript, isScriptPath } from "./whole-write.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The manifest this pins, relative to the project root. */
export const MANIFEST_FILE = ".freebuff/gate-hashes.mjs";

/** The digest a pinned file is recorded under. */
export const DEFAULT_ALGORITHM = "sha1";

/**
 * Which files count as gate machinery — the one place the watch rules are written.
 *
 * The manifest records this list beside the hashes, so widening or narrowing the pin is a
 * reviewed line in the manifest's diff and not only a constant edited here. It is a
 * *record*, though, not a second declaration: `readManifest` refuses its own manifest when
 * the rules it records are not these, so the pin, the check and the recorder can only ever
 * answer to the list below. That is what keeps a widening here from being silently undone by
 * the next `npm run gates:pin`, and a hand-widening *there* from being silently kept.
 *
 * One rule per family rather than a list of paths, so a *new* file in a family is found
 * (and reported as `unpinned`) instead of being silently outside the pin. `dir` is
 * resolved against the project root and scanned one level deep; it may name a nested
 * directory (the workflows live in one), and `.github/workflows` is one level deep because
 * that is all GitHub Actions reads — a workflow in a subdirectory there would not run, so
 * it is not a gate to pin.
 */
export const DEFAULT_WATCHES = [
  // The coverage gates, and the algebra, thresholds and floor rules they share.
  { dir: ".freebuff", pattern: "^coverage-.*\\.mjs$" },
  // The runner, the alarm itself, the import closure the runner folds into every
  // script-backed stage's key, and the files that decide what a report says — including
  // the two that put a comment on a pull request and the gate that reports whether it
  // arrived, because a report nobody can read is the same failure as one never written.
  { dir: ".freebuff", pattern: "^(ci|comment-gate|gate-drift|redact|nightly-report|pr-comment|import-closure)\\.mjs$" },
  // The stage order's lint-time snapshot: `--stages=write` writes it beside the marked lines
  // and `--stages=check` verifies its contents — but only when a check runs, and a hand edit
  // between two of them is believed silently by exactly the reader the file exists for (an
  // ESLint rule, a convention guard, anything that must not spawn the runner to learn the
  // order). Generated, like the lines it mirrors, so the pin holds its bytes the way it holds
  // those: a change to it is a reviewed re-pin rather than a fact no pass looks at.
  { dir: ".freebuff", pattern: "^stage-order\\.json$" },
  // The two tree-editing checks and the lock they share.
  { dir: ".freebuff", pattern: "^mutation-.*\\.mjs$" },
  // The save-guard the tree-editing checks and the baseline applier save through. It is no
  // single caller's family — three writers in two families read it — so extending one
  // family's rule to reach it would misname it; a rule of one names it for what it is.
  { dir: ".freebuff", pattern: "^whole-write\\.mjs$" },
  // The sweep scaffold, a rule of one for the same reason: it edits the table, the runner and
  // the module when it onboards a sweep, so it is gate machinery with no family to inherit —
  // and a scaffold nobody pinned could rewrite the gate unwatched.
  { dir: ".freebuff", pattern: "^scaffold-sweep\\.mjs$" },
  // The other scripts a gate stage is made of, and the builders they read.
  { dir: ".freebuff", pattern: "^(build-contents|runbook-contents|lint-baseline|preview-preflight)\\.mjs$" },
  // The collect-budget ratchet: its recorder, proposer, applier and recorded numbers.
  { dir: ".freebuff", pattern: "^(collect-.*|.*-collect-baselines)\\.mjs$" },
  // What the suite and the isolated mutation run measure, and what they exclude.
  { dir: ".", pattern: "^vitest(\\..+)?\\.config\\.ts$" },
  // The client build's own configs, and the reason they are pinned is the reason they look
  // harmless: `define:` in `vite.config.ts` inlines text into a bundle with nothing
  // importing it, and `images.remotePatterns` in `next.config.mjs` is what the image shim
  // will load from. `src/test/client-env.test.ts` reads these two files — the same pair,
  // declared once in `src/test/convention-guards.ts` — so a change here that the detector
  // does not describe is what the pin is for.
  { dir: ".", pattern: "^(next|vite)\\.config\\.(mjs|ts)$" },
  // The rest of what the build *ships*, and the reason they are pinned is again that no
  // checker reads them: `postcss.config.mjs` is the whole stylesheet pipeline (the suite
  // parses `globals.css` and says in `src/test/globals-layer.test.ts` that it cannot see the
  // *generated* stylesheet, so a plugin dropped here empties every utility and no test reds),
  // and `wrangler.jsonc` is what the deployed worker *is* — entry point, compatibility date
  // and flags, the Durable Object class and its migration tags, every binding — and the
  // source `npm run types:worker` regenerates `worker-configuration.d.ts` from, which `tsc`
  // then reads as `Env`, so the binding list that ships and the one the compiler sees can
  // disagree with nothing in between. Neither file is in any `tsconfig.json` include.
  { dir: ".", pattern: "^(postcss\\.config\\.mjs|wrangler\\.jsonc)$" },
  // What decides whether any of it is checked at all: a loosened `exclude`, a dropped
  // `strict` or a disabled rule set un-checks types and lint without touching a gate.
  { dir: ".", pattern: "^(tsconfig.*\\.json|eslint\\.config\\..*)$" },
  // What decides whether any of it is *run*: the workflows. A step deleted, a job made
  // conditional, a `continue-on-error: true` added, a `--skip=` widened — the gate is
  // cancelled from above, and the stages below never know they did not run.
  { dir: ".github/workflows", pattern: "^.*\\.ya?ml$" },
];

/**
 * Suite debris, transient by name: the copy-for-test convention the mutation suites use.
 *
 * A suite that drives a real sweep through the runner copies the script beside itself —
 * `mutation-preflight.copy-for-test.mjs`, `mutation-example.copy-for-test.mjs`, and the module
 * copy `mutation-vocabulary.preflight-copy.mjs` — because the script resolves its neighbours
 * relative to its own location; the copy is removed when the case ends. But *while the suite
 * runs* the file is on disk and matches a watch rule, so a `--status` or a drift stage running
 * concurrently read it as an unpinned gate — false drift that vanished the moment the suite
 * did, and worse: a full-tree pin taken mid-suite would have recorded it, to report it `gone`
 * forever after the suite cleaned up. A file carrying one of these suffixes is therefore never
 * scanned at all — it is a copy of an already-pinned script wearing a test's name, and a
 * genuinely new gate file never carries one.
 */
const TRANSIENT_SUITE_COPIES = /(\.copy-for-test|\.preflight-copy)\.mjs$/;

// --- The stage list, and the family each stage owns --------------------------

/**
 * A small glob matcher for the change-set patterns: `**` spans directories (and may match none),
 * while `*` and `?` stop at a `/`. It handles only that much on purpose — the patterns are ours, so
 * a dependency would be more than they need.
 *
 * It is declared here, beside the watch rules, because two readers have to ask "does this input name
 * this file?" the same way: the runner, for the key a stage is cached under, and the alarm, for the
 * stage that owns the family a finding belongs to. The runner imports it rather than keeping a
 * second copy, so the two cannot drift into disagreeing about a file they both match.
 */
export function globMatch(pattern, path) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${source}$`).test(path);
}

/**
 * Whether one of a stage's `inputs` names a file.
 *
 * An input is a glob, except in one stage: the drift stage's inputs are the alarm's own watch rules
 * (`{dir, pattern}`), taken from `DEFAULT_WATCHES` rather than rendered into second-hand globs. That
 * is what makes the pin and the stage that checks it impossible to pull apart — a family a rule
 * watches is behind this stage's key because it *is* the rule, not because a list beside the runner
 * remembered to say so — and the reading is the alarm's own: a filename, one level down, in the
 * directory the rule names.
 *
 * One level, and not `<dir>/*`: naming the whole directory would say more than the alarm reads.
 * `.freebuff` holds artifacts a run writes and removes (`.collect-budget-run.json`, the
 * `.collect-*.json` verdicts), a stage's key is read once before its pass and once after, and a key
 * that moves for a file the run itself deletes is a cache that never holds — so the narrower reading
 * is the correct one, not merely the tidier one.
 */
export function matchesInput(input, path) {
  if (typeof input === "string") return globMatch(input, path);
  // The rule's directory is resolved against the root before the comparison, exactly as the pin
  // resolves it when it scans, so a rule written relative to the root and one written absolutely
  // name the same file the same way. That is what lets a fixture manifest — an absolute directory
  // of throwaway files — be read by the same code as `.freebuff` is; for the committed rules, which
  // are all relative, the two readings are identical.
  const resolved = rel(resolve(ROOT, input.dir));
  const dir = resolved === "" ? "" : `${resolved}/`;
  if (!path.startsWith(dir)) return false;
  const name = path.slice(dir.length);
  return !name.includes("/") && new RegExp(input.pattern).test(name);
}

/**
 * One input as a reader says it: a glob is itself, a watch rule is `dir/pattern`.
 *
 * The rule's two fields in the shape the glob-only stages already have, so the drift stage's line
 * reads like the others' instead of like a JSON object. The label is a pattern rather than a path —
 * nothing could open `.freebuff/^coverage-.*\\.mjs$` — and that is the point: what a reader needs
 * from this line is *which family*, not a file name to hand to a tool.
 */
export function inputLabel(input) {
  if (typeof input === "string") return input;
  return input.dir === "." ? input.pattern : `${input.dir}/${input.pattern}`;
}

/**
 * Whether an input is a *whole-tree sweep*: a glob that names a file anywhere in the tree rather than
 * a place in it, so the key it builds is about an extension rather than about a family.
 *
 * `**` at the head matches at any depth — the lint stage's extension sweep over `.mjs`, the
 * typecheck stage's over `.ts` — and a bare `*` is the same reading one level up. Everything else is
 * scoped: a literal path, a glob rooted in a directory (`.freebuff/coverage-*.mjs`, the mutation
 * stage's route globs), or a watch rule, which names a family by construction and is never a sweep.
 * It is the distinction `--explain-cache` draws between a key *on* a file and a key that sweeps one
 * up, asked of the declaration rather than of a scan, so a reader of the pin's rows can be given it
 * without walking the tree again — the one question the owner reading below needs an input's shape
 * for.
 */
export function sweepInput(input) {
  if (typeof input !== "string") return false;
  return input.split("/")[0] === "**" || input === "*";
}

/**
 * The watch rule that names a path — the family a finding or a pinned file belongs to — or
 * `undefined` when no rule does. The first rule in declaration order wins, which is the tie-break
 * every other reading here uses, so a path two rules match is never counted under two families.
 */
export function ruleFor(path, watches = DEFAULT_WATCHES) {
  return watches.find((rule) => matchesInput(rule, path));
}

/**
 * The stages, in canonical order — cheapest first, the three tree-editing checks last. This is where
 * a stage is *declared*, all of it: `label` (what every report calls it), `script` (`env`, the
 * override a test drives it through, and `path`, the default gate script), `inputs` (the files its
 * cache key covers, which is also what makes the stage the owner of a watch family), and `editsTree`
 * on the three checks whose pass rewrites the working tree — the `check` name the lock they hold
 * carries.
 *
 * The list lives here rather than in `.freebuff/ci.mjs` because the alarm reads it too: the runner
 * builds its `STAGES` from these entries (`STAGE_TABLE.map(…)`) and adds the one thing that cannot
 * live here — its own `run` — while the alarm names the stage that owns a family from the same
 * `inputs`. One declaration is what keeps the two from answering the same question differently, and
 * the order is part of it: the runner maps this list, so no second array can reorder the pass. The
 * claims a reader would otherwise have to check by eye are checked (`stageDeclarationGaps`), and the
 * copies of the order and the names written elsewhere in the tree — the runner's header, the
 * runbook, the tests, the nightly job — are held to it by the runner's own `--stages=check` audit,
 * which reads this table rather than the array it was built into.
 *
 * A stage's key is its `inputs`, so a stage that runs a gate script must name that script among
 * them: the runner proves it for the script *and every module it loads*, and `stageDeclarationGaps`
 * proves it for the declared default, which is the entry a later edit can move without a run
 * noticing. The drift stage's own entry is the pin's — the rules themselves plus the manifest no
 * rule can name — which is what makes the stage that checks the pin unanswerable from a recorded
 * pass over a family it has never heard of.
 */
export const STAGE_TABLE = [
  {
    name: "typecheck",
    label: "typecheck",
    inputs: ["**/*.ts", "**/*.tsx", "**/*.d.ts", "**/*.mts", "**/*.cts"],
  },
  {
    name: "runbook",
    label: "runbook contents",
    script: { env: "CI_RUNBOOK_SCRIPT", path: "./build-contents.mjs" },
    inputs: [
      ".freebuff/run.md",
      ".freebuff/build-contents.mjs",
      ".freebuff/runbook-contents.mjs",
    ],
  },
  // The extensions ESLint actually reads, and only those: `**/*.jsx` was here and is gone, because
  // this configuration does not lint a `.jsx` file at all — a dead entry is worse than a missing
  // one, since the stage looks covered across a change it never sees.
  {
    name: "lint",
    label: "lint baseline",
    script: { env: "CI_LINT_SCRIPT", path: "./lint-baseline.mjs" },
    inputs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs"],
  },
  // No `script`: these two run a published tool (`tsc`, `vitest`) whose machinery is pinned by the
  // lockfile in `GLOBAL_FORCE` instead of being a gate file of this repository's own.
  { name: "test", label: "vitest suite", inputs: ["src/**", "worker/**"] },
  // What the check reads about the environment, plus — like every stage — its own script: the list
  // is a complete statement of what the stage reads, so the machinery is named here rather than only
  // being swept up by the lint stage's `**/*.mjs`, which would leave this stage reusable across a
  // change to the script it runs.
  {
    name: "preflight",
    label: "preview preflight",
    script: { env: "CI_PREFLIGHT_SCRIPT", path: "./preview-preflight.mjs" },
    inputs: [
      ".freebuff/preview-preflight.mjs",
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      ".env*",
      // The worker's config by family, not by the spelling this repo has not used since it moved to
      // `wrangler.jsonc`: the entry sat dead in the preflight's inputs for as long as the same one
      // sat dead in `GLOBAL_FORCE`, and for the same reason — `wrangler.toml` names no file this
      // checkout has.
      "wrangler.*",
      "vite.config.*",
      "next.config.*",
    ],
  },
  // The alarm's watch rules *themselves*, not a list of globs written beside them. Rendered by hand —
  // `.freebuff/*.mjs`, `vitest*.config.ts`, the rest — that list was a second statement of the same
  // policy, and the failure it hid is the one this stage exists to make impossible: a rule widened
  // to a new family can be pinned while the stage that checks the pin stays answerable from a
  // recorded pass, because nothing tied the two together. Taking `DEFAULT_WATCHES` ties them by
  // construction — a family watched there is behind this stage's key in the same commit — and the
  // runner matches a rule the way the alarm does (`matchesInput`), so the stage's key covers exactly
  // what the pin covers. That is also narrower than the glob list was: a rule reads a filename, not
  // the directory it lives in, which is what keeps the collect-budget artifacts a run writes and
  // deletes out of this stage's inputs. (`GLOBAL_FORCE` re-keys every stage when the build and
  // config files move; this is what covers the gate families it never heard of.)
  //
  // …plus the pin's own manifest, which the alarm loads by path rather than through an import
  // statement — the one module behind this stage's key that no watch rule can name and no walk over
  // the script can see. It is deliberately not *pinned* (a manifest that pinned itself could never
  // be written), which is exactly why it has to be an input: the manifest is what this stage
  // compares the tree against, so editing the pin by hand has to re-key the check that reads it, or
  // the loosening would be answered from a recorded pass.
  {
    name: "drift",
    label: "gate drift",
    script: { env: "CI_DRIFT_SCRIPT", path: "./gate-drift.mjs" },
    inputs: [...DEFAULT_WATCHES, MANIFEST_FILE],
  },
  // Only a coverage gate script, the check that weakens it, the table it weakens them from, the
  // launcher, the lock module they share with the guard sweep, the test file it must make fail, or
  // the config that isolates the run can change which gate a weakening is noticed by.
  // `vitest.config.*` is here for the same reason the guard sweep carries it: the child runs under
  // it. The table is named on its own because it is not a `.test.ts` and nothing else would catch
  // it: a strike deleted from `src/test/coverage-mutations.ts` shrinks the sweep while this stage
  // would otherwise be reused over its old pass.
  // The vocabulary smoke stage: the fourth sweep — the minimal end-to-end proof of the shared
  // vocabulary module's inheritance claim — as the cheapest gate in the run. It runs no mutation
  // and takes no lock, and its run report is one demonstration stamp: `checked: 1`, no survivors.
  // It carries the `vocabularyFirst` pre-pass in the runner's own declaration, so a vocabulary
  // hole reds the gate before its run mode is ever spawned; it is read-only and cacheable, and it
  // sits after `drift` so the alarm has vouched for the pin before any stage reads a sweep's
  // vocabulary — and before the tree-editing tail, where it does not belong.
  {
    name: "mutation-example",
    label: "vocabulary smoke",
    script: { env: "CI_EXAMPLE_SCRIPT", path: "./mutation-example.mjs" },
    inputs: [".freebuff/mutation-example.mjs", ".freebuff/mutation-vocabulary.mjs"],
  },
  {
    name: "mutation-fifth",
    label: "fifth vocabulary smoke",
    script: { env: "CI_FIFTH_SCRIPT", path: "./mutation-fifth.mjs" },
    inputs: [".freebuff/mutation-fifth.mjs", ".freebuff/mutation-vocabulary.mjs"],
  },
  {
    name: "mutation-coverage",
    label: "coverage gate mutation",
    // It heals the tree it edits, so it can never be answered from a recorded pass; the value is the
    // `check` name the lock it holds carries, which is how a recovery this run performs is
    // attributed to the stage that would have done it.
    editsTree: "coverage mutation check",
    script: { env: "CI_MUTATION_COVERAGE_SCRIPT", path: "./mutation-coverage.mjs" },
    inputs: [
      ".freebuff/coverage-*.mjs",
      ".freebuff/mutation-coverage.mjs",
      ".freebuff/mutation-lock.mjs",
      "src/test/coverage-mutations.ts",
      "src/test/coverage-mutation.test.ts",
      "src/test/coverage-*.test.ts",
      "vitest.mutation.config.ts",
      "vitest.config.*",
    ],
  },
  // Only the preflight, the test file whose failure is the verdict, the sweep itself, the lock module
  // it shares with the other two tree-editors, the whole-write guard the sweep saves its mutants
  // through — the guard's text decides what a mutant save even attempts, so a change to it re-keys
  // the sweep — or a config the child test run loads can change which branch a test notices. It is
  // cheaper than the route sweep below — nineteen Vitest runs against one file — so it goes first of
  // the two.
  {
    name: "mutation-preflight",
    label: "preflight mutation sweep",
    editsTree: "preflight sweep",
    script: { env: "CI_MUTATION_PREFLIGHT_SCRIPT", path: "./mutation-preflight.mjs" },
    inputs: [
      ".freebuff/preview-preflight.mjs",
      ".freebuff/mutation-preflight.mjs",
      ".freebuff/mutation-lock.mjs",
      ".freebuff/whole-write.mjs",
      // The guard reads the manifest's pinned-script list to know what a save protects, so the
      // manifest sits in this stage's import graph the way it sits in the drift stage's — loaded by
      // name through the guard, never pinned itself, and named here so editing it re-keys the sweep.
      MANIFEST_FILE,
      "src/test/preview-preflight.test.ts",
      "vitest.config.*",
    ],
  },
  // Only a route, its neighbour test, the shared test harness, the sweep, the lock module it holds
  // against the coverage check, the whole-write guard the sweep saves its mutants through — the
  // guard's text decides what a mutant save even attempts, so a change to it re-keys the sweep — or
  // the runner it strikes can change which guard a test notices.
  {
    name: "mutation",
    label: "mutation sweep",
    editsTree: "guard sweep",
    script: { env: "CI_MUTATION_SCRIPT", path: "./mutation-guards.mjs" },
    inputs: [
      "src/app/**/route.ts",
      "src/app/**/route.test.ts",
      "src/test/**",
      ".freebuff/mutation-guards.mjs",
      ".freebuff/ci.mjs",
      ".freebuff/mutation-lock.mjs",
      ".freebuff/whole-write.mjs",
      // Same reach as the preflight sweep above: the guard saves its mutants through whole-write,
      // and whole-write reads the pinned-script list out of the manifest, so the manifest re-keys
      // this sweep exactly as it re-keys the drift stage that compares the tree against it.
      MANIFEST_FILE,
      "vitest.config.*",
    ],
  },
];

/**
 * The stage names, in the order they run — the canonical order every copy in the tree is held to.
 *
 * Derived from the table rather than written a second time, and imported by the runner: the audit
 * that holds the header's numbered list, the runbook, the tests and the nightly job to the pass reads
 * *this*, so there is no array beside it that could be reordered into a different claim.
 */
export const STAGE_NAMES = STAGE_TABLE.map((stage) => stage.name);

/** One stage's declaration, by name — what the runner builds its `STAGES` entries from. */
export function stageDeclaration(name) {
  const stage = STAGE_TABLE.find((candidate) => candidate.name === name);
  if (stage === undefined) throw new Error(`no stage named ${name} in the stage table`);
  return stage;
}

/**
 * What the table says about a stage that is not true of the list itself: the claims an entry makes
 * that no single entry can keep on its own.
 *
 * Three kinds of them, each a thing a reader of the table would otherwise have to check by eye and
 * a run would only discover in its output. A stage's `label` is what every report calls it, so a missing
 * one prints a stage as `ci:   — …` and a shared one makes two rows that cannot be told apart in a
 * report — the summary line, an annotation's title, the run page and the nightly comment all read
 * it. A declared `script` is the gate the stage runs, and the stage's own `inputs` are the key its
 * pass is recorded under, so a script behind none of them is the one failure the runner's script
 * walk exists to prevent, read here from the declaration instead of from a spawned process; the same
 * entry has to name its `env`, or the override a test drives the stage through would be a variable
 * named `undefined` that silently falls back. And the tree-editing checks rewrite the working tree
 * one file at a time, so they run last and nothing else may touch the tree in that window: the
 * entries with `editsTree` must be exactly the tail of the list, each with its own `check` name,
 * because a recovery this runner performs is attributed to the stage whose `editsTree` is the lock's
 * `check` — and a name shared by two of them would attribute it to whichever came first.
 *
 * Asked of the list in hand (`stages`, defaulting to the table in force) rather than of a file, so a
 * test can hand it a doctored copy and watch each claim fire — which is the only way to show the
 * checks are the reason their cases fail.
 */
export function stageDeclarationGaps(stages = STAGE_TABLE) {
  const gaps = [];
  const labels = new Map();
  const checks = new Map();
  for (const stage of stages) {
    if (typeof stage.label !== "string" || stage.label.trim() === "") {
      gaps.push({ stage: stage.name, kind: "label", detail: `the ${stage.name} stage has no label` });
    } else if (labels.has(stage.label)) {
      gaps.push({
        stage: stage.name,
        kind: "label",
        detail: `the ${stage.name} and ${labels.get(stage.label)} stages are both labelled "${stage.label}"`,
      });
    } else {
      labels.set(stage.label, stage.name);
    }

    if (stage.script === undefined) continue;
    if (typeof stage.script.env !== "string" || stage.script.env.trim() === "") {
      gaps.push({
        stage: stage.name,
        kind: "script",
        detail: `the ${stage.name} stage's script names no override variable`,
      });
    }
    const file = rel(join(ROOT, ".freebuff", stage.script.path));
    if (!stage.inputs.some((input) => matchesInput(input, file))) {
      gaps.push({
        stage: stage.name,
        kind: "script",
        detail: `the ${stage.name} stage runs ${file} and none of its own inputs names it`,
      });
    }
  }

  for (const stage of stages) {
    if (stage.editsTree === undefined) continue;
    if (checks.has(stage.editsTree)) {
      gaps.push({
        stage: stage.name,
        kind: "editing",
        detail: `the ${stage.name} and ${checks.get(stage.editsTree)} stages both carry the \`check\` name "${stage.editsTree}"`,
      });
    } else {
      checks.set(stage.editsTree, stage.name);
    }
  }
  // The group that edits the tree has to be the *tail*: they are the stages a reader is told run
  // last, and a stage added after them would run while one of them may be holding a mutated file.
  // Reported per stage, so the finding names the entry to move rather than the group.
  const editing = stages.filter((stage) => stage.editsTree !== undefined).map((stage) => stage.name);
  const tail = stages.slice(stages.length - editing.length).map((stage) => stage.name);
  for (const name of editing) {
    if (tail.includes(name)) continue;
    gaps.push({
      stage: name,
      kind: "editing",
      detail: `the ${name} stage edits the tree, so it has to be one of the last ${editing.length} (${tail.join(", ")})`,
    });
  }
  return gaps;
}

/**
 * The one stage that answers for the *pin* rather than for a file.
 *
 * Its `inputs` are the alarm's own watch rules (`DEFAULT_WATCHES`), so it holds every pinned file by
 * construction — it is the pin checking itself, which is what makes the coverage invariant
 * enforceable: no pinned file can hide from a key, because the key that checks the pin already names
 * the rule that held it. That same construction is what keeps the invariant from seeing the *next*
 * member: a family this stage holds whole is held whole by definition, and stays held whole when a
 * rule is widened or a sibling script joins it, so the coverage map reads `covered` while no stage
 * that *measures* the file has it in `inputs` at all. The owner reading excludes it for the same
 * reason — counting it would make it the answer to every question — and the runner imports this
 * name rather than keeping its own copy of the string.
 */
export const PIN_SELF_CHECK_STAGE = "drift";

/**
 * Which watch rule put each pinned file in the pin, as the `dir/pattern` label a reader can hold
 * against the declaration, or `null` where no rule resolves it any more.
 *
 * Asked of the rules themselves — each is run through the pin's own scan — rather than by matching a
 * path against a pattern here, so the label cannot disagree with the pin about which family a file
 * belongs to. The first rule in declaration order that resolves a file owns it, the tie-break
 * `--explain-cache` uses when two inputs match one file; a rule whose scan throws, or whose pattern
 * no longer matches anything, claims nothing and leaves the file with no label, which is the honest
 * answer rather than a lost map. `exclude` is the manifest, which a rule can sweep up and which is
 * never a family member.
 */
export function ruleOwners(watches, exclude = []) {
  const owners = new Map();
  for (const rule of watches) {
    let files;
    try {
      files = Object.keys(pin(exclude, [rule]));
    } catch {
      continue;
    }
    const label = inputLabel(rule);
    for (const file of files) if (!owners.has(file)) owners.set(file, label);
  }
  return owners;
}

/**
 * The pin's own rows — one per file it holds, with the rule that pinned it and the stages whose
 * `inputs` name it — as the one resolve of the pin both readers share.
 *
 * The runner adds `everyKey` and `exempt` to these rows for its two reports; the alarm feeds them
 * straight to `familyOwners` to name the stage that owns a family. Written once so a stage list that
 * moved, or a family read from something other than the pin, cannot make the two disagree about who
 * holds what.
 */
export function pinFamilyRows(files, watches, exclude = [], stages = STAGE_TABLE) {
  const owners = ruleOwners(watches, exclude);
  return files.map((file) => ({
    file,
    rule: owners.get(file) ?? null,
    keys: stages
      .filter((stage) => stage.inputs.some((input) => matchesInput(input, file)))
      .map((stage) => stage.name),
  }));
}

/**
 * The stage each watch rule's family should be owned by — the stage that *names* the most of its
 * members with an input scoped to something, with the member that earned it — or `null` for a family
 * in the pin that no stage keys at all.
 *
 * The forward reading of the runner's `familyKeysByStage`, and the same choice `stageSuggestions`
 * makes for a family that has lost a file: the stage holding the most of a family is the one to
 * extend, and the `via` is the earliest member it already holds (by name, the deterministic choice
 * every tie here makes), so the repair reads as "put it beside that" rather than as a stage to trust
 * on a count. What the count is taken *over* is the whole of this function. A member behind an input
 * that names a place — a literal path, a glob rooted in a directory (`.freebuff/coverage-*.mjs`), a
 * watch rule — is **named** by that stage; a member behind nothing but a whole-tree sweep
 * (`sweepInput`: the lint stage's extension glob over `.mjs`, the typecheck stage's over `.ts`) is
 * **swept up** by it. Named members are counted first, so the pin's `.freebuff/coverage-*.mjs` family
 * is owned by the stage that names that glob rather than by the lint sweep that holds every `.mjs`
 * file whole. Without that distinction the lint stage would be named the owner of every `.mjs` family
 * in the pin — families it was never told exist, whose clause would read `held by the lint stage`,
 * which is true of the key and false of the reader.
 *
 * Ties fall to how much of the family a stage holds by any input at all, then to declaration order —
 * the one `stageSuggestions` and `--explain-cache` already use, so a stage both readings consider is
 * settled the same way in both. A stage that holds every member *owns* the family rather than merely
 * being the best candidate, and `whole` carries that difference for the caller. A family no stage
 * names *at all* is the one place a sweep is still the answer: `lint` holds every `.mjs` file whole
 * by construction, so a family only it and the pin's own re-key hold — the `collect-*` scripts, say —
 * has no other owner to offer, and the sweep keeps it with `whole` set rather than being dropped for
 * a silence that would contradict the coverage map printed above it. `null` is reserved for a family
 * no stage keys *at all*, which is the fact the refusal's words state.
 *
 * The pin's own `drift` re-key is excluded throughout (`PIN_SELF_CHECK_STAGE`): it holds every
 * family whole by construction — its inputs are the watch rules themselves — so counting it would
 * make it the answer to every question and hide the one question being asked, which is which stage
 * *measures* the family rather than which stage vouches for the pin. Asked of the pin's own rows
 * (`row.keys`, the stage list's reading of what covers a file) so it cannot disagree with the
 * coverage map or with `stageSuggestions` about who holds what, and a rule the pin does not hold at
 * all is absent rather than given a stage it never had.
 *
 * Two callers ask it of one pin: the runner, so a red run's headings carry the repair beside the
 * grouping and `--status` names the stage to widen before a member ever falls out of every key; and
 * the alarm, so each finding row carries the same repair on its own diff. `ownerClause` renders all
 * of them, in the refusal's words.
 */
export function familyOwners(rows, stages = STAGE_TABLE) {
  const members = new Map();
  const byRule = new Map();
  const stageByName = new Map(stages.map((stage) => [stage.name, stage]));
  for (const row of rows) {
    if (row.rule === null) continue;
    members.set(row.rule, (members.get(row.rule) ?? 0) + 1);
    if (!byRule.has(row.rule)) byRule.set(row.rule, new Map());
    const byStage = byRule.get(row.rule);
    for (const name of row.keys) {
      if (name === PIN_SELF_CHECK_STAGE) continue;
      if (!byStage.has(name)) byStage.set(name, { named: [], keyed: [] });
      const claim = byStage.get(name);
      claim.keyed.push(row.file);
      const names = (stageByName.get(name)?.inputs ?? []).some(
        (input) => !sweepInput(input) && matchesInput(input, row.file),
      );
      if (names) claim.named.push(row.file);
    }
  }
  const order = new Map(stages.map((stage, index) => [stage.name, index]));
  const owners = new Map();
  for (const [rule, byStage] of byRule) {
    const ranked = [...byStage]
      .map(([stage, claim]) => ({
        stage,
        named: [...claim.named].sort((left, right) => left.localeCompare(right)),
        keyed: [...claim.keyed].sort((left, right) => left.localeCompare(right)),
      }))
      .sort(
        (left, right) =>
          right.named.length - left.named.length ||
          right.keyed.length - left.keyed.length ||
          (order.get(left.stage) ?? 0) - (order.get(right.stage) ?? 0),
      );
    if (ranked.length === 0) {
      owners.set(rule, null);
      continue;
    }
    const [best] = ranked;
    owners.set(rule, {
      stage: best.stage,
      via: best.named[0] ?? best.keyed[0],
      whole: best.keyed.length === members.get(rule),
    });
  }
  return owners;
}

/**
 * The repair a family carries, as the clause appended to it — the stage that owns it, the stage that
 * should, or the honest fact that none does.
 *
 * Three answers, and each is a different next step rather than a shade of one: a family a stage holds
 * whole is `held by the <stage> stage`, which is the verdict to check; a family a stage only
 * part-holds is `extend the <stage> stage, which already keys <via>`, the repair the coverage refusal
 * spells out for a *lost* file, now said for a family while it is merely red; and a family no stage
 * keys is `no stage keys it; name it in a stage's `inputs``, the instruction the refusal gives. A
 * family the pin does not hold at all has no row (`ownerByRule` has no entry) and gets no clause
 * rather than a stage it never had. The wording matches the refusal's on purpose: the same two
 * repairs should not read as two different things on two surfaces, and one function serves every
 * surface that needs it — the runner's family view and a red drift's family headings, and now the
 * alarm's own per-finding rows.
 */
export function ownerClause(rule, ownerByRule) {
  if (ownerByRule === null || !ownerByRule.has(rule)) return "";
  const owner = ownerByRule.get(rule);
  if (owner === null) return " — no stage keys it; name it in a stage's `inputs`";
  if (owner.whole) return ` — held by the ${owner.stage} stage`;
  return ` — extend the ${owner.stage} stage, which already keys ${owner.via}`;
}

/**
 * Each finding's family and the repair it carries, read from the tree the finding is about.
 *
 * One clause per finding rather than one heading per family: the alarm's report is a row per file
 * with the loosening under it, in the order the findings were collected, and a reader deciding
 * whether a change was meant wants that row — not a fold that would reorder the diff they are
 * reading. So each row is given the watch rule that names its path (`family`) and the clause for the
 * stage that owns that family (`owner`), both read the way the runner's family fold reads them: the
 * same rules, the same named-vs-swept ranking (`familyOwners`), the same words (`ownerClause`). A
 * path no rule names has no family and no repair to state, and carries `family: null` so a consumer
 * can tell it from a row that was never annotated at all.
 *
 * The family view is built from the tree the findings are about, so a `gone` finding still names the
 * family that *held* it — the rule matches the path even though the file resolves no more — and a
 * family with no member left behind any stage's key is the ownerless case the refusal names. A pin
 * that will not resolve leaves every clause unstated rather than guessed, which is the alarm having
 * nothing to say rather than a wrong answer.
 */
function withFamilies(rows, { watches, files, exclude }) {
  if (rows.length === 0) return { rows, ownerByRule: null };
  let ownerByRule = null;
  try {
    ownerByRule = familyOwners(pinFamilyRows(files, watches, exclude), STAGE_TABLE);
  } catch {
    // A tree the rules cannot be scanned against has no family view to offer; the rows keep their
    // repair unstated rather than being dropped.
    ownerByRule = null;
  }
  const annotated = rows.map((row) => {
    const rule = ruleFor(row.path ?? "", watches);
    if (rule === undefined) return { ...row, family: null, owner: null };
    const family = inputLabel(rule);
    return { ...row, family, owner: ownerClause(family, ownerByRule) };
  });
  // The map travels with the rows: the refusal below asks it which of the moved families no stage
  // keys, and it is the same reading the clauses above were cut from, so the two cannot disagree
  // about who holds what.
  return { rows: annotated, ownerByRule };
}

/**
 * The refusal a red check carries when a moved family is behind no stage's key — the alarm's
 * counterpart of the runner's coverage refusal, said about the families that *moved* rather than
 * about the files a run would key.
 *
 * A family no stage's key names is the hole the pin cannot close from above: re-pinning records the
 * change and leaves the family measured by nothing, so the next loosening in it is reported as drift
 * and never fails a gate that reads those files. That makes the ordinary advice — "re-pin it" —
 * incomplete for exactly these families, and a report that gave only that advice would be advising
 * the hole. So the check refuses: the moved families with no key are named with the repair the
 * coverage refusal gives (name the family in a stage's `inputs`), that list travels as `refused` in
 * `--json`, and the sentence the report prints travels as `refusal`, so a consumer reports what the
 * alarm said rather than re-rendering it.
 *
 * Only the *moved* families count, and only ones the pin still holds a member of: a rule all of
 * whose members are `gone` has no row in the family view (there is nothing left of it to key),
 * and its repair is the re-pin decision the check already asks for rather than a stage to widen. A
 * pin that will not resolve has no view at all (`ownerByRule` is `null`) and so cannot refuse — the
 * alarm says what it could read rather than inventing a hole.
 */
/**
 * The moved findings grouped by the watch rule that names each one, in the order the runner's drift
 * stage folds its own rows: the families nothing below measures lead, then how much moved, then the
 * rule's own name — the comparator `movedFamilyGroups` uses, read off the same family view, so a red
 * alarm and a red run put the same family first. The rows are *not* grouped here: the caller keeps
 * the collected order and filters by label, which is what keeps `changed`, `unpinned`, `gone` the
 * order inside a family while the families themselves are ordered by exposure.
 *
 * Exposure is the pin's own reading: a family no stage but the pin's re-key holds *whole* is the one
 * a new member would join behind nothing, so it leads. A rule the pin does not hold at all has no row
 * in that view and contributes no exposure, exactly as it does on the runner's side, and a pin that
 * will not resolve has no view at all — the families then read by how much moved, which is the
 * runner's own fallback.
 */
function familyFold(rows, ownerByRule) {
  const moved = new Map();
  for (const row of rows) {
    if (row.family === null || row.family === undefined) continue;
    moved.set(row.family, (moved.get(row.family) ?? 0) + 1);
  }
  const exposed = (rule) => {
    if (ownerByRule === null) return false;
    const owner = ownerByRule.get(rule);
    if (owner === undefined) return false;
    return owner === null || !owner.whole;
  };
  return [...moved]
    .map(([rule, count]) => ({ rule, moved: count, owner: ownerClause(rule, ownerByRule) }))
    .sort(
      (left, right) =>
        Number(exposed(right.rule)) - Number(exposed(left.rule)) ||
        right.moved - left.moved ||
        left.rule.localeCompare(right.rule),
    );
}

/**
 * The refusal a red check carries when a moved family is behind no stage's key — the alarm's
 * counterpart of the runner's coverage refusal, said about the families that *moved* rather than
 * about the files a run would key.
 */
function refusalFor(rows, ownerByRule) {
  if (ownerByRule === null) return null;
  const moved = new Map();
  for (const row of rows) {
    if (row.family === null || row.family === undefined) continue;
    moved.set(row.family, (moved.get(row.family) ?? 0) + 1);
  }
  const families = [...moved]
    .filter(([rule]) => ownerByRule.has(rule) && ownerByRule.get(rule) === null)
    .map(([rule, count]) => ({ rule, moved: count }))
    .sort((left, right) => right.moved - left.moved || left.rule.localeCompare(right.rule));
  if (families.length === 0) return null;
  const listed = families.map(({ rule, moved: count }) => `${rule} (${count} moved)`).join(", ");
  const noun = families.length === 1 ? "moved watch family" : "moved watch families";
  return {
    families,
    sentence:
      `${families.length} ${noun} behind no stage's key: ${listed}. Only the pin's own check ` +
      "re-runs on the next change to any of them — name each in a stage's `inputs` (the stage " +
      "list is in `.freebuff/gate-drift.mjs`), and `npm run gates:status` prints the family view.",
  };
}

/** The manifest path, overridable for a test (absolute, or relative to the root). */
export function manifestPath() {
  const override = process.env.GATE_HASHES_FILE;
  if (!override) return join(ROOT, MANIFEST_FILE);
  return isAbsolute(override) ? override : join(ROOT, override);
}

/** The project-relative, forward-slashed path a finding names. */
export function rel(path) {
  return relative(ROOT, path ?? "").split("\\").join("/");
}

/** One file's content hash, over the raw bytes so encoding cannot change the pin. */
export function hashFile(path, algorithm = DEFAULT_ALGORITHM) {
  return createHash(algorithm).update(readFileSync(path)).digest("hex");
}

/**
 * Whether a test substituted the manifest through `GATE_HASHES_FILE` — rules and all.
 *
 * The seam exists to point the alarm at a *different* pin: a throwaway tree of fixture files
 * with a rule that names it. So a substituted manifest is taken as given, rules included;
 * the alarm's own manifest is the one whose rules have to be the declared ones.
 */
function substitutedManifest() {
  return Boolean(process.env.GATE_HASHES_FILE);
}

/** Whether two rule lists are the same rules, in the same order. */
function sameRules(left, right) {
  return (
    left.length === right.length &&
    left.every((rule, index) => rule.dir === right[index].dir && rule.pattern === right[index].pattern)
  );
}

/** Whether a value is a watch rule: a directory and a filename pattern. */
function isRule(rule) {
  return (
    rule !== null &&
    typeof rule === "object" &&
    !Array.isArray(rule) &&
    typeof rule.dir === "string" &&
    typeof rule.pattern === "string"
  );
}

/**
 * Every watched file's hash, keyed project-relative and sorted — exactly what the
 * manifest records. `exclude` drops the manifest itself, which a watch rule can otherwise
 * sweep up and which could then never be rewritten; `watches` is scanned in order and
 * deduped by resolved path, so two rules naming the same file still pin it once. A file
 * matching `TRANSIENT_SUITE_COPIES` is skipped before any of that: it is a suite's
 * copy-for-test debris, present only while a suite runs, and reading it as a gate would
 * make every concurrent check report false drift.
 */
export function pin(exclude, watches = DEFAULT_WATCHES, algorithm = DEFAULT_ALGORITHM) {
  const skip = new Set((exclude ?? []).map((path) => resolve(path)));
  const found = new Map();
  for (const rule of watches) {
    const dir = resolve(ROOT, rule.dir);
    const pattern = new RegExp(rule.pattern);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      if (TRANSIENT_SUITE_COPIES.test(entry.name)) continue;
      const path = join(dir, entry.name);
      if (skip.has(resolve(path))) continue;
      found.set(rel(path), path);
    }
  }
  const pinned = {};
  for (const key of [...found.keys()].sort()) {
    pinned[key] = hashFile(found.get(key), algorithm);
  }
  return pinned;
}

/**
 * The three findings, from the recorded manifest and the tree as it is now. A recorded
 * hash with nothing to compare against is `gone` rather than a fourth category: a file
 * that was deleted and one the watch rules no longer name are the same problem — the
 * manifest still pins something the tree no longer has — and the message says both.
 */
export function compare(recorded, current) {
  const changed = [];
  const gone = [];
  const unpinned = [];
  for (const [path, expected] of Object.entries(recorded)) {
    if (!(path in current)) {
      gone.push(path);
      continue;
    }
    if (current[path] !== expected) changed.push({ path, expected, actual: current[path] });
  }
  for (const path of Object.keys(current)) {
    if (!(path in recorded)) unpinned.push(path);
  }
  return { changed, gone, unpinned };
}

/** The first eight hex characters of a hash — enough to tell two apart in a line. */
function short(hash) {
  return String(hash ?? "").slice(0, 8);
}

/** The findings as one list, each carrying the words its detail row prints. */
export function findings(recorded, current) {
  const { changed, gone, unpinned } = compare(recorded, current);
  return [
    ...changed.map((item) => ({
      kind: "changed",
      path: item.path,
      detail: `on disk ${short(item.actual)}, pinned ${short(item.expected)}`,
    })),
    ...unpinned.map((path) => ({
      kind: "unpinned",
      path,
      detail: "not in the pinned hashes — a gate nobody pinned",
    })),
    ...gone.map((path) => ({
      kind: "gone",
      path,
      detail: "pinned but not on disk (or no watch rule names it any more)",
    })),
  ];
}

// --- Reading a drift: the last content that matched the pin ------------------

/**
 * Where the last matching content of each pinned file is kept.
 *
 * The manifest records a hash, which is what makes the pin small and instant — and what
 * makes a drift unreadable, because two hex prefixes are not a review. So every time the
 * tree *matches* the pin (a passing check) or the pin is *written*, the text that matched is
 * stashed here, and a later drift is printed as a unified diff against it. It lives under
 * `.ci/` — git-ignored, like the result cache — because it is a convenience and not a gate:
 * losing it costs the diff and nothing else, and the report says so rather than letting a
 * hash pass for a description. `GATE_CONTENT_DIR` points it elsewhere, which is how a test
 * keeps fixtures off the real directory: nothing else ever sets it.
 *
 * A stashed copy is only ever diffed against when its hash **equals the pinned hash**, so a
 * stale, partial or hand-edited cache can never produce a diff of the wrong text — it can
 * only produce no diff at all, which is the honest failure of the two.
 *
 * A cache that cannot be *written* is a different matter, because the cost lands later: the
 * write that fails is usually the one that just matched the pin, so losing it spends the
 * next drift's diff before anyone knows there is a drift to read. The tree that needs a
 * diff most is the one whose `.ci/` is read-only — a CI workspace, a checked-out artifact, a
 * full disk — so a match that cannot be stashed where it belongs is stashed in
 * `fallbackContentDir()` instead and *says* where, rather than being dropped. The fallback
 * is a temporary directory, so it is a stay of execution and not a repair: it is announced
 * as a degraded cache, and a later sweep of it costs exactly what the loss would have.
 */
export const DEFAULT_CONTENT_DIR = ".ci/gate-content";
const CONTENT_INDEX = "index.json";

/** The stash directory, overridable for a test (absolute, or relative to the root). */
export function contentDir() {
  return resolveStashDir(process.env.GATE_CONTENT_DIR, join(ROOT, DEFAULT_CONTENT_DIR));
}

/**
 * Where the text goes when the stash directory refuses the write.
 *
 * The system temporary directory, because a `.ci/` that cannot be written is read-only for
 * a reason (a runner workspace, a mounted artifact) and a second path inside the project
 * would be refused by the same reason. One directory per project *root*, so two checkouts on
 * one machine do not take turns rewriting each other's index — the hash check keeps them
 * from ever showing each other's text either way, but a shared index would still churn.
 *
 * `GATE_CONTENT_FALLBACK_DIR` points it elsewhere, which is how a test drives both halves of
 * this at once: nothing but a test ever sets it.
 */
export function fallbackContentDir() {
  const tag = createHash(DEFAULT_ALGORITHM).update(ROOT).digest("hex").slice(0, 8);
  const name = `gate-content-${basename(resolve(ROOT))}-${tag}`;
  return resolveStashDir(process.env.GATE_CONTENT_FALLBACK_DIR, join(tmpdir(), name));
}

/** A stash directory, honouring an override that is absolute or relative to the root. */
function resolveStashDir(override, fallback) {
  if (!override) return fallback;
  return isAbsolute(override) ? override : join(ROOT, override);
}

/**
 * Every directory a stashed copy may be found in, the usual one first.
 *
 * The read side is the other half of the fallback and had to be told about it: a copy that
 * was kept elsewhere is still a copy, and looking only in the usual place would report the
 * text as absent while it sits in a file — the precise confusion the fallback exists to
 * avoid, from the other end. Order matters only for speed; `stashedText` verifies whatever
 * it finds against the pin, so the second directory can never answer with text the first
 * would have contradicted.
 */
export function stashDirs() {
  return [contentDir(), fallbackContentDir()];
}

/**
 * A stash directory in the form an operator can act on.
 *
 * The value that was *configured*, when there was one, because an absolute override outside
 * the project relative-ises to `../../../Users/…` and buries the one path they set; the
 * project-relative path when it is inside the tree (`.ci/gate-content`); and the absolute
 * path otherwise — which is the case for the temporary fallback. A path on another drive
 * has no relative form at all on Windows, and `relative` returns it absolute there.
 */
function stashLabel(dir, override) {
  if (override) return override;
  const inside = relative(ROOT, dir);
  return isAbsolute(inside) || inside.startsWith("..") ? dir : inside;
}

/**
 * Where one pinned file's text goes, or `null` when it would land outside the stash.
 *
 * The key is *percent-escaped* into a single file name rather than mirrored as a path, which
 * is what keeps a manifest from writing anywhere but the stash: a pinned key is a path, and
 * a manifest can name files outside the project (the fixtures in the test suite do), so a
 * stash that mirrored them would follow them. One file per key, and `index.json` beside it
 * is what maps a name back to the key.
 */
function stashPath(dir, key) {
  return join(dir, encodeURIComponent(key));
}

/** The hashes the stash's index holds, or nothing when it is missing or unreadable. */
function readContentIndex(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, CONTENT_INDEX), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** One file's content hash, over the raw bytes so encoding cannot change the pin. */
function hashBytes(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest("hex");
}

/**
 * Stash the text of every pinned file, for the next drift to be read as a diff.
 *
 * `pinned` is the manifest's map (key → hash) and the content is read back from the tree,
 * each file stashed only if it still hashes to what the pin says — so this can be called
 * from a passing check or after a write and cannot record text the pin does not describe.
 * A file whose stash already holds that hash is left alone, so a steady-state check writes
 * nothing; the index is rewritten either way, which is also what forgets a gate file the
 * pin no longer names.
 *
 * A pinned *script* is held to one more reading before its copy lands: the same balance
 * check every writer of a pinned script saves through (`.freebuff/whole-write.mjs`), read
 * here against the text about to be kept. The hash cannot catch a truncation that happened
 * to *be* the pin — this stash exists because a cut-off write once matched its own hash —
 * and without this the poisoned copy would become the reference every later diff for that
 * file is read against. A refused script is left out of the stash (the index entry was
 * recorded above, so the copy reads as missing, which is the honest state) and reported to
 * the caller in `refused` rather than thrown, because the tree matched the pin — the
 * alarm's one question — and losing a convenience must not turn that into a verdict.
 */
export function stashContent(pinned, { dir = contentDir(), algorithm = DEFAULT_ALGORITHM } = {}) {
  const index = readContentIndex(dir);
  const next = {};
  const refused = [];
  let stashed = 0;

  for (const [key, hash] of Object.entries(pinned)) {
    const target = stashPath(dir, key);
    next[key] = hash;
    if (index[key] === hash && existsSync(target)) continue;
    const source = join(ROOT, key);
    if (!existsSync(source)) continue;
    const bytes = readFileSync(source);
    if (hashBytes(bytes, algorithm) !== hash) continue;
    if (isScriptPath(key)) {
      try {
        assertWholeScript(bytes.toString("utf8"), key);
      } catch (error) {
        refused.push({ key, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    stashed += 1;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CONTENT_INDEX), `${JSON.stringify(next, null, 2)}\n`);
  return { dir, stashed, refused };
}

/**
 * Stash the text a pass matched, best effort: a convenience that must never become a verdict.
 *
 * What the stash buys is the diff the next drift is read as, so failing to write it costs that
 * and nothing else — a full disk, a read-only `.ci/`, or a `GATE_CONTENT_DIR` that is not a
 * directory must not turn a matching tree into a failed check. The alarm answers one question
 * (`does the pin describe the tree`) and this is not it, so the failure is swallowed and the
 * reason is kept instead: `stashFields` turns that into a `warning` and a `cause` on the
 * payload (and no `stash` key at all), so the report says the matched text could not be kept
 * and what refused the write, rather than letting the loss be silent — and says both as
 * named facts a stage can carry to the run page.
 */
function tryStash(pinned, algorithm) {
  const primary = contentDir();
  const where = () => stashLabel(primary, process.env.GATE_CONTENT_DIR);
  let primaryError;
  try {
    const stash = stashContent(pinned, { dir: primary, algorithm });
    // The guard's refusal is reported as the degraded cache it is, but it does not fall
    // back: the fallback exists for a *place* that refuses the write, and a script that
    // does not balance would not balance there either — stashing it anyway would record
    // exactly the reference this guard exists to keep out. The text is refused, the
    // warning says what that costs (the next drift shows hashes only), and the verdict is
    // untouched, because the tree matched the pin.
    if (stash.refused.length > 0) {
      return {
        stash,
        warning: STASH_REFUSED(stash.refused),
        cause: stash.refused.map((row) => `${row.message} — writing to ${where()}`).join("; "),
      };
    }
    return { stash };
  } catch (error) {
    primaryError = error;
  }

  // The usual place refused, so the text goes somewhere it cannot refuse. This is the case
  // that used to spend the next diff: the run that matches the pin is the only run that has
  // the matching text in hand, so a cache that is read-only on exactly that run leaves
  // nothing behind for the drift that follows.
  const fallback = fallbackContentDir();
  const keptAt = stashLabel(fallback, process.env.GATE_CONTENT_FALLBACK_DIR);
  const cause = stashCause(primaryError, where());
  try {
    const stash = stashContent(pinned, { dir: fallback, algorithm });
    return { stash: { ...stash, fallback: keptAt }, warning: STASH_MOVED(keptAt), cause };
  } catch (fallbackError) {
    // Nothing was kept, so this is the old loss — now with both refusals in the cause, since
    // "where could it have gone" is the first thing a reader asks of a fallback that failed.
    return {
      warning: STASH_LOST,
      cause: `${cause}; ${stashCause(fallbackError, keptAt)}`,
    };
  }
}

/**
 * Why the stash could not be written, as the one line an operator can act on.
 *
 * "Could not be stashed" on its own asks a reader to guess between a full disk, a read-only
 * `.ci/` and a `GATE_CONTENT_DIR` that is a file, and the OS said which — so the error's own
 * message is published beside the directory the alarm writes to, and both halves are
 * needed. `EEXIST: file already exists, mkdir '…'` names what it refused; an
 * `ENOSPC: no space left on device, write` names no path at all, and the directory is then
 * the only thing there is to look at. The message is kept verbatim rather than mapped to
 * advice: the codes are the same ones `fs` has always thrown, and a table of them here
 * would be a second, staler source of the truth Node already prints.
 */
function stashCause(error, where) {
  const reason = error instanceof Error ? error.message : String(error);
  return `${reason} — writing to ${where}`;
}

/**
 * What a run says when the text it matched could not be kept.
 *
 * Spelled once, so the CLI note, the `--json` payload and every report built on that
 * payload cannot describe the same loss in three different sentences. It names the cost and
 * not the cause, which travels beside it as its own field: the reader deciding how much to
 * trust the next hash pair needs the cost, and the operator who can fix the cache needs the
 * reason — and a sentence carrying both would make every surface say both, whether or not
 * it had room for them.
 */
const STASH_LOST =
  "the matched text could not be stashed — the next drift will show hashes only";

/**
 * What a run says when the text it matched had to be kept somewhere else.
 *
 * A separate sentence from `STASH_LOST` because it is a separate state: the diff survives,
 * so a reader must not be told the next drift is hashes only, and the cache is not where it
 * belongs, so a reader must not be told nothing happened. It names the directory, because
 * "somewhere temporary" is a fact nobody can act on, and the temporary part, because a
 * reader who is owed a diff in a week needs to know it may already have been swept.
 */
const STASH_MOVED = (where) =>
  `the matched text could not be stashed in the usual place — kept at ${where} instead, which the OS may clear, and then the next drift shows hashes only`;

/**
 * What a run says when the guard kept the text it matched out of the stash.
 *
 * A third degraded state, between `STASH_LOST` (nothing was kept anywhere) and
 * `STASH_MOVED` (kept, but elsewhere): the text was in hand, matched the pin, and the
 * whole-write guard refused to record it because the pinned script does not balance — the
 * same refusal a writer of that script would have hit, met here at the moment the
 * truncated text would have become the pin's reference for every later diff. Nothing was
 * written, so the next drift for that file shows hashes only; the reason travels in
 * `cause`, per refused file, the way an OS refusal's does, and the file is named here
 * because the repair is to the file and not to the cache. A warning beside a pass and
 * never a verdict of its own: the tree matched the pin, which is the alarm's one question.
 */
const STASH_REFUSED = (refused) =>
  refused.length === 1
    ? `the matched text was kept out of the stash: the pinned script does not balance, so the next drift for ${refused[0].key} shows hashes only`
    : `the matched text of ${refused.length} pinned scripts was kept out of the stash: they do not balance, so the next drift for each shows hashes only`;

/**
 * The stash a run that just matched deserves, as the payload fields that carry it.
 *
 * Either the stash was written — and the payload says where, so a reader can see the diff
 * cache is being maintained — or it was not, and the payload says *that* (`warning`) and
 * *why* (`cause`) rather than leaving a reader to infer the loss from the absence of a
 * `stash` key and to guess at the reason. The difference is not academic: `ci.mjs` turns the
 * two into a `WARN` detail on a stage that passed, so a degraded diff cache and the write
 * that failed reach the run page instead of only the CLI.
 */
function stashFields(pinned, algorithm) {
  const { stash, warning, cause } = tryStash(pinned, algorithm);
  // `stash` and `warning` are not mutually exclusive any more, and that is the point: a
  // kept-elsewhere stash is both a stash and a degraded one, so a consumer reading either
  // field alone is still told the truth. Only the total loss has no `stash` to report.
  return stash === undefined ? { warning, cause } : { stash, warning, cause };
}

/**
 * The stashed text for a file, but only when it hashes to the hash that was pinned.
 *
 * The verification is the whole contract: the diff this feeds is shown to a reviewer as
 * "what the pin recorded", so text that does not hash to the pinned value is not evidence
 * and is reported as no evidence at all.
 */
export function stashedText(key, pinned, { dir, algorithm = DEFAULT_ALGORITHM } = {}) {
  const found = stashLookup(key, pinned, { dir, algorithm });
  return found === null ? null : found.bytes.toString("utf8");
}

/**
 * The stashed bytes for one key — verified against the pin — and which directory they came
 * from. `rank` is the position in the search order, so a caller can tell the usual stash
 * from the fallback without comparing paths, which two settings can make equal.
 */
function stashLookup(key, pinned, { dir, algorithm = DEFAULT_ALGORITHM } = {}) {
  const dirs = dir === undefined ? stashDirs() : [dir];
  for (const [rank, candidate] of dirs.entries()) {
    const target = stashPath(candidate, key);
    let bytes;
    try {
      if (!existsSync(target)) continue;
      bytes = readFileSync(target);
    } catch {
      // An unreadable cache holds nothing to show, which is the same answer as an empty one
      // and never a failed check: the verdict is about the tree, and this is the reading of
      // a convenience. A hash that does not match moves on for the same reason — a stale
      // copy in the usual place must not hide the true one that a fallback write left.
      continue;
    }
    if (hashBytes(bytes, algorithm) === pinned) return { dir: candidate, rank, bytes };
  }
  return null;
}

/**
 * How much of the pin the diff cache actually holds, as the three numbers that answer it.
 *
 * The cache is a convenience, so "is it healthy" is not a verdict on anything — but it is
 * the difference between the next drift being read and being two hex prefixes, and a reader
 * asking about the pin deserves that in the same breath. `fresh` are the copies found in the
 * usual directory, `fallback` the ones only the temporary fallback has (kept, but on
 * borrowed time), and `missing` the files whose next drift will show hashes only. Every count
 * is verified against the pinned hash by the same lookup the diff itself uses, so this can
 * never promise a reading the alarm would then refuse to produce.
 */
export function stashReport(pinned, { algorithm = DEFAULT_ALGORITHM } = {}) {
  const dirs = stashDirs();
  const report = { fresh: 0, fallback: 0, missing: 0, dir: dirs[0], fallbackDir: dirs[1] };
  for (const [key, hash] of Object.entries(pinned)) {
    const found = stashLookup(key, hash, { algorithm });
    if (found === null) report.missing += 1;
    else if (found.rank === 0) report.fresh += 1;
    else report.fallback += 1;
  }
  return report;
}

/** The most cells a line-alignment may use; past it the change is reported as too large. */
const MAX_DIFF_CELLS = 1_000_000;

/** How many lines of a diff are printed before the rest is summarised. */
export const DIFF_BUDGET = 24;

/** How many unchanged lines surround a hunk. */
const DIFF_CONTEXT = 3;

/** The lines of a text, without its trailing empty one. */
function lines(text) {
  const split = String(text ?? "").split(/\r?\n/);
  if (split.length > 0 && split[split.length - 1] === "") split.pop();
  return split;
}

/**
 * The line operations that turn `a` into `b`, as `equal`/`del`/`ins` steps.
 *
 * The common prefix and suffix are trimmed first — which is what makes this fast enough
 * for a whole file: a small edit in a two-thousand-line runner trims down to a handful of
 * lines and needs no alignment at all. What is left is aligned by longest common
 * subsequence, and a middle too large for that is reported as `tooLarge` rather than
 * aligned slowly or guessed at.
 */
function lineOps(a, b, context) {
  let start = 0;
  const shared = Math.min(a.length, b.length);
  while (start < shared && a[start] === b[start]) start += 1;
  // The trim stops `context` lines short on both sides, so the hunk that comes out of the
  // middle still has the unchanged lines around it: a diff of one line with nothing beside
  // it does not say where in the file the line was.
  start = Math.max(0, start - context);
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  endA = Math.min(a.length, endA + context);
  endB = Math.min(b.length, endB + context);

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = [];

  if ((midA.length + 1) * (midB.length + 1) > MAX_DIFF_CELLS) {
    return { prefix: start, ops: null, midA, midB };
  }

  const width = midB.length + 1;
  const table = new Uint32Array((midA.length + 1) * width);
  for (let x = 1; x <= midA.length; x += 1) {
    for (let y = 1; y <= midB.length; y += 1) {
      table[x * width + y] =
        midA[x - 1] === midB[y - 1]
          ? table[(x - 1) * width + (y - 1)] + 1
          : Math.max(table[(x - 1) * width + y], table[x * width + (y - 1)]);
    }
  }

  let x = midA.length;
  let y = midB.length;
  while (x > 0 && y > 0) {
    if (midA[x - 1] === midB[y - 1]) {
      ops.push({ kind: "equal", line: midA[x - 1] });
      x -= 1;
      y -= 1;
    } else if (table[(x - 1) * width + y] >= table[x * width + (y - 1)]) {
      ops.push({ kind: "del", line: midA[x - 1] });
      x -= 1;
    } else {
      ops.push({ kind: "ins", line: midB[y - 1] });
      y -= 1;
    }
  }
  while (x > 0) {
    ops.push({ kind: "del", line: midA[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    ops.push({ kind: "ins", line: midB[y - 1] });
    y -= 1;
  }
  ops.reverse();

  return { prefix: start, ops, midA, midB };
}

/**
 * A unified diff of two texts, redacted and capped, or `null` when they are equal.
 *
 * This is the answer to "the hash changed" — the loosening itself, in the shape a reviewer
 * already reads. Three deliberate limits: the output is **redacted** (`redactText`, the same
 * scrubber the runner applies to everything it prints, because this ends up in a public CI
 * log), it is capped at `budget` body lines with the remainder summarised rather than
 * truncated silently, and a change too large to align line by line says so instead of
 * pretending to be a diff. Header lines name the two sides rather than a commit: there is no
 * commit to name here.
 */
export function unifiedDiff(
  before,
  after,
  { budget = DIFF_BUDGET, context = DIFF_CONTEXT, path = "" } = {},
) {
  const a = lines(before);
  const b = lines(after);
  const { prefix, ops, midA, midB } = lineOps(a, b, context);

  if (ops !== null && ops.length === 0) return null;

  const header = [
    `--- pinned  ${path}`.trimEnd(),
    `+++ on disk ${path}`.trimEnd(),
  ];
  const body = [];

  if (ops === null) {
    // Too large to align: say so, and show the head and tail of each side, which is
    // enough to see that a file was replaced wholesale and by what.
    const head = Math.max(1, Math.floor(budget / 4));
    body.push(
      `@@ the change is too large to align line by line (pinned ${a.length} line(s), on disk ${b.length} line(s)) @@`,
      ...midA.slice(0, head).map((line) => `-${line}`),
      `-… ${Math.max(0, midA.length - head)} more pinned line(s)`,
      ...midB.slice(0, head).map((line) => `+${line}`),
      `+… ${Math.max(0, midB.length - head)} more line(s) on disk`,
    );
    return redactDiff([...header, ...body]);
  }

  // Hunks: a run of changes with `context` unchanged lines either side, merging two runs
  // that would overlap into one hunk rather than printing the lines between them twice.
  const groups = [];
  ops.forEach((op, index) => {
    if (op.kind === "equal") return;
    const last = groups[groups.length - 1];
    if (last !== undefined && index - last[last.length - 1] <= context * 2 + 1) last.push(index);
    else groups.push([index]);
  });

  // The line each side starts at: how much the ops before it consumed on that side. A
  // `del` moves the pinned number and not the on-disk one; an `ins` the other way round.
  const consumed = (upto, kinds) =>
    ops.slice(0, upto).filter((op) => kinds.includes(op.kind)).length;

  let emitted = 0;
  let skipped = 0;
  for (const group of groups) {
    const from = Math.max(0, group[0] - context);
    const to = Math.min(ops.length, group[group.length - 1] + context + 1);
    const slice = ops.slice(from, to);
    const rows = [];
    const push = (op) => {
      if (emitted >= budget) {
        skipped += 1;
        return;
      }
      rows.push(`${op.kind === "equal" ? " " : op.kind === "del" ? "-" : "+"}${op.line}`);
      emitted += 1;
    };
    // A run of changes prints the way a unified diff does it: every removed line, then
    // every added one, so a replacement reads `-` before `+` whatever order the alignment
    // produced. Each side keeps its own order, so nothing moves that was not already a
    // swap.
    for (let index = 0; index < slice.length; index += 1) {
      if (slice[index].kind === "equal") {
        push(slice[index]);
        continue;
      }
      const run = [];
      while (index < slice.length && slice[index].kind !== "equal") {
        run.push(slice[index]);
        index += 1;
      }
      index -= 1;
      for (const op of run.filter((item) => item.kind === "del")) push(op);
      for (const op of run.filter((item) => item.kind === "ins")) push(op);
    }
    if (rows.length === 0) continue;
    const oldCount = slice.filter((op) => op.kind !== "ins").length;
    const newCount = slice.filter((op) => op.kind !== "del").length;
    // Both sides share the trimmed prefix, so it offsets both numbers — without it a
    // change on line 40 of a file reports itself as line 1.
    body.push(
      `@@ -${prefix + consumed(from, ["equal", "del"]) + 1},${oldCount} ` +
        `+${prefix + consumed(from, ["equal", "ins"]) + 1},${newCount} @@`,
      ...rows,
    );
  }

  if (skipped > 0) body.push(`… ${skipped} more changed line(s) not shown`);
  if (body.length === 0) return null;

  return redactDiff([...header, ...body]);
}

/** The publishable form of a diff: every line scrubbed of secret-looking paths. */
function redactDiff(rows) {
  return rows.map((row) => redactText(row)).join("\n");
}

/** The doc comment at the top of the generated manifest file. */
const MANIFEST_HEADER = `/**
 * The pinned hashes of the build's gate machinery, recorded.
 *
 * Generated — do not edit by hand. \`npm run gates:pin\` rewrites \`files\` from the tree,
 * and \`npm run gates:drift\` (and the CI stage it backs) fails the build when a watched
 * file's hash is not the one recorded here. A hand-edit that keeps the hashes but changes
 * the watch rules is caught too: the alarm refuses a manifest whose recorded rules are not
 * \`DEFAULT_WATCHES\`, and \`src/test/gate-drift.test.ts\` compares this file, byte for byte,
 * to what \`--write\` would produce and pins the set of files it names.
 *
 * The alarm exists because a loosened gate is otherwise silent, and because nothing
 * outside a gate reads it. The suite pins what each gate *does*, and
 * \`npm run mutation:coverage\` proves the coverage tests still notice a weakening — but
 * neither is watching the files themselves, so a stage with empty \`inputs\`, an extra
 * suite \`exclude\`, a launcher that stops calling a survivor a survivor, a threshold moved
 * in \`coverage-thresholds.mjs\`, an \`exclude\` in \`tsconfig.json\` widened until a type is
 * never checked, a literal added to \`vite.config.ts\`'s \`define:\` table, an image host
 * widened in \`next.config.mjs\`, the plugin dropped from \`postcss.config.mjs\` so the
 * stylesheet pipeline stops emitting utilities, a binding removed from \`wrangler.jsonc\` so
 * the deployed worker no longer has it, or a step deleted from a workflow, passes every test
 * it was written to pass. Recorded
 * content turns that into a loud failure with one command to answer it:
 *
 *   npm run gates:pin     # re-pin after a deliberate change, and say why in the diff
 *
 * \`watches\` is the rule set the pin was built from, recorded here so what the alarm covers
 * is a reviewed line in this file's diff as well as a declaration in the script. The two are
 * held equal — a manifest that recorded a different set is refused, and \`npm run gates:pin\`
 * renders the declaration — so a widening of the pin cannot be half-recorded. \`algorithm\`
 * names the digest both sides use, so a future move to a stronger one is a recorded fact and
 * not a silent mismatch. A rule that matches nothing is not a narrow pin but a broken one,
 * and the checker refuses an empty pin rather than passing it.
 */`;

/**
 * The exact source of the manifest for a set of pins, so the file that is checked in and
 * the file `--write` would produce cannot drift — the same contract `renderBaselines` in
 * `.freebuff/collect-apply.mjs` keeps for the collect-budget baselines.
 */
export function renderManifest({ algorithm, watches, files }) {
  const rows = Object.keys(files)
    .sort()
    .map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(files[path])},`)
    .join("\n");
  const rules = watches.map((rule) => `  ${JSON.stringify(rule)},`).join("\n");
  return (
    `${MANIFEST_HEADER}\n\n` +
    `export const algorithm = ${JSON.stringify(algorithm)};\n\n` +
    `export const watches = [\n${rules}\n];\n\n` +
    `export const files = {\n${rows}\n};\n`
  );
}

/** How many drifted files a `--status` line names before it summarises the rest. */
const STATUS_NAMES = 6;

/**
 * The pin's state as one line: what does not match, what a re-pin would record, and whether
 * the diff cache can still read the next drift.
 *
 * One line on purpose, and the whole answer inside it. The check prints a row per finding
 * with the diff under it, which is what a reader wants when something is wrong and a lot to
 * scroll past when the question was "where am I". Everything here is a count or a name, so
 * the length is bounded by the number of findings and the first six are named out loud — the
 * rest summarised the way the diff renderer summarises a line it did not print, because
 * "and 12 more" tells a reader to run the check, which is the right next move anyway.
 */
function statusLine(payload) {
  const rows = payload.findings;
  const named = (items) => {
    const shown = items
      .slice(0, STATUS_NAMES)
      .map((item) => `${item.path} (${item.kind})`);
    if (items.length > STATUS_NAMES) shown.push(`and ${items.length - STATUS_NAMES} more`);
    return shown.join(", ");
  };
  // Two counts, not one, and only when they differ: the manifest can name fewer files than
  // the rules resolve to (an unpinned one) or more (a gone one), so a single number would be
  // wrong about exactly the states this line exists to make legible.
  const head =
    rows.length === 0
      ? `${payload.pinned} gate file(s) pinned in ${payload.manifest}, all match`
      : `${payload.pinned} pinned and ${payload.checked} watched in ${payload.manifest}, ` +
        `${rows.length} do not match (${named(rows)})`;

  // A targeted re-pin records exactly the `changed` findings: a file the pin does not name is
  // a new gate, and a pinned file that is gone is a gate being dropped, and both of those are
  // decisions the whole-tree command exists to put in a person's hands.
  const counts = payload.recordable?.length ?? 0;
  const record =
    counts === 0
      ? rows.length === 0
        ? "nothing for a re-pin to record"
        : "a targeted re-pin records none of them, because adding a gate and dropping one are " +
          "`npm run gates:pin` decisions"
      : counts === rows.length
        ? counts === 2
          ? "a targeted re-pin records both"
          : `a targeted re-pin records all ${counts}`
        : `a targeted re-pin records ${counts} of them`;

  // Counted over the *pin*, which is what the cache holds copies of: a file the rules watch
  // and the manifest does not name is not a copy anybody is missing.
  const cache = payload.cache;
  const held = cache.fresh + cache.fallback;
  const pinned = payload.pinned;
  const count = held === pinned ? `all ${pinned}` : `${held} of ${pinned}`;
  const reading =
    held === 0
      ? "the diff cache is cold — every drift shows hashes only until a check passes"
      : `the diff cache holds ${count} matched copies` +
        // Where they are is part of the answer only when some of them are on borrowed time,
        // and how many are missing is part of it only when the next drift would be unreadable
        // — so the common line says neither and the unusual one says both.
        (cache.fallback > 0
          ? `, ${cache.fallback === held ? "all" : cache.fallback} of them in the temporary ` +
            `fallback at ${process.env.GATE_CONTENT_FALLBACK_DIR ?? cache.fallbackDir}`
          : "") +
        (cache.missing > 0
          ? `, ${cache.missing} with no copy on hand and so no diff when they move`
          : "");

  return `gate-status: ${head} — ${record}; ${reading}.`;
}

/** The report, human or `--json`, and the exit code that carries it. */
function report(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return process.exit(payload.exitCode);
  }
  const slug = { changed: "CHANGED", unpinned: "UNPINNED", gone: "GONE" };
  if (payload.message) {
    console.log(`gate-drift: ${payload.message}`);
    return process.exit(payload.exitCode);
  }
  if (payload.mode === "status") {
    console.log(statusLine(payload));
    return process.exit(payload.exitCode);
  }
  if (payload.mode === "write" && payload.targets) {
    console.log(
      `gate-drift: re-pinned ${payload.moved?.length ?? 0} of ${payload.checked} gate file(s) ` +
        `in ${payload.manifest}.`,
    );
    for (const item of payload.moved ?? []) {
      console.log(`  REPINNED  ${item.path}`);
      console.log(`            was ${short(item.from)}, now ${short(item.to)}`);
    }
    // The rest of the tree, named rather than left for the caller to discover: a re-pin that
    // reported only its own file would let a partial write read as a pinned tree, and the
    // count is the one number that says whether the manifest describes the checkout now.
    if (payload.left?.length) {
      console.log(
        `  left: ${payload.left.length} other pinned file(s) do not match the tree and were ` +
          "not recorded —",
      );
      console.log(
        `        ${payload.left.map((item) => `${item.path} (${item.kind})`).join(", ")}`,
      );
      console.log(
        "        a targeted re-pin records what it was asked about; `npm run gates:pin` records the rest.",
      );
    }
  } else if (payload.mode === "write") {
    console.log(`gate-drift: pinned ${payload.checked} gate file(s) in ${payload.manifest}.`);
  } else {
    console.log(
      payload.gate === "pass"
        ? `gate-drift: ${payload.checked} gate file(s) pinned in ${payload.manifest}, all match.`
        : `gate-drift: ${payload.checked} gate file(s) pinned in ${payload.manifest}, ` +
            `${payload.findings.length} do not match:`,
    );
  }
  // One finding, exactly as the report has always printed it: the kind, the path, the hash
  // statement, and the loosening itself under it. Indented one step past the finding line so the
  // `-`/`+` rows read as part of it.
  const printRow = (item) => {
    console.log(`  ${slug[item.kind] ?? item.kind}  ${item.path}`);
    console.log(`           ${item.detail}`);
    for (const row of String(item.diff ?? "").split("\n")) {
      if (row !== "") console.log(`           ${row}`);
    }
  };
  // The findings fold under a heading per watch family, the way the runner's drift stage folds its
  // own rows: the rule that moved, how many of its members did, and the stage that owns it — then
  // the rows themselves, in the order they were collected, so the `changed`/`unpinned`/`gone`
  // reading survives inside each group. The *family* order is the runner's own (`movedFamilies`),
  // which is why the payload carries it beside the rows: a reader comparing the sentence a run
  // prints with the alarm's own report should not have to work out which family leads. A pinned path
  // no rule names any more gets a heading of its own at the end rather than drifting between
  // families, the same split the runner's fold makes.
  const fold = payload.movedFamilies;
  if (fold === undefined) {
    // No family view — a passing check has no findings to fold, and a payload built without one is
    // still printed rather than swallowed.
    for (const item of payload.findings) printRow(item);
  } else {
    const grouped = new Map();
    for (const item of payload.findings) {
      const label = item.family ?? null;
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(item);
    }
    for (const family of fold) {
      console.log(`  FAMILY  ${family.rule} (${family.moved})${family.owner ?? ""}`);
      for (const item of grouped.get(family.rule) ?? []) printRow(item);
    }
    const unnamed = grouped.get(null) ?? [];
    if (unnamed.length > 0) {
      console.log(`  UNNAMED  ${unnamed.length} file(s) no watch rule names`);
      for (const item of unnamed) printRow(item);
    }
  }
  const undiffed = payload.findings.filter(
    (item) => item.kind === "changed" && !item.diff,
  ).length;
  if (payload.mode === "check" && undiffed > 0) {
    console.log("");
    console.log(
      `${undiffed} changed file(s) have no pinned copy on hand, so only the hashes are shown —`,
    );
    console.log("a check that passes stashes the text it matched, and the next drift diffs it.");
  }
  // A passing check or a write refreshes the stash, so a `warning` here means that write did
  // not land where it belongs: either the text was kept elsewhere (so the next diff still
  // reads, for as long as nobody clears that directory) or it was lost outright. Neither is
  // silence-worthy, because a cache that has stopped being maintained should not look busy.
  // The payload carries both sentences, so the JSON and the log agree — and the cause gets
  // its own line, indented under the note, because it names the write that was refused,
  // which is what an operator reading a red-herring-free log actually has to act on.
  if (payload.warning) {
    console.log(`  note: ${payload.warning}`);
    if (payload.cause) console.log(`  cause: ${payload.cause}`);
  }
  if (payload.mode === "check" && payload.gate !== "pass") {
    console.log("");
    console.log(
      "A file the build's verdict is made of is not the one that was recorded. If the",
    );
    console.log("change is the one you meant to make, re-pin it with `npm run gates:pin` —");
    console.log("otherwise this is the loosening the alarm exists to make loud.");
  }
  // …and last, because it qualifies the advice above rather than adding to it: for these families
  // the re-pin is not the whole repair. Its own line, prefixed so it cannot read as another finding
  // row, and printed after the closing paragraph so the ordinary repair is read first and then
  // corrected where it does not apply.
  if (payload.refusal) {
    console.log("");
    console.log(`gate-drift: refusal — ${payload.refusal}`);
  }
  process.exit(payload.exitCode);
}

/** The report object, from the pins and the findings, with the exit code that carries it. */
function payloadFor({
  manifest,
  algorithm,
  checked,
  rows,
  gate,
  exitCode,
  message,
  mode = "check",
  targets,
  moved,
  left,
  pinned,
  cache,
  recordable,
  stash,
  warning,
  cause,
  refused,
  refusal,
  movedFamilies,
}) {
  const pick = (kind) => rows.filter((item) => item.kind === kind).map((item) => item.path);
  return {
    root: ROOT,
    mode,
    gate,
    exitCode,
    manifest,
    algorithm,
    checked,
    findings: rows,
    // The same three findings again, as bare paths: what a caller needs to act on,
    // without reading the detail strings.
    changed: pick("changed"),
    unpinned: pick("unpinned"),
    gone: pick("gone"),
    ...(message === undefined ? {} : { message }),
    // The targeted form of `--write`: which files it was asked about, and which of them
    // actually moved. A caller that re-pins one file it just wrote reads `moved`.
    ...(targets === undefined ? {} : { targets }),
    ...(moved === undefined ? {} : { moved }),
    // …and the pinned files it did *not* record, because they do not match the tree either.
    // A targeted re-pin never touches them — they keep the hash the manifest already had —
    // so this is a statement about the rest of the tree, which the caller would otherwise
    // have to infer from a second command. `kind` and `detail` travel with each one so a
    // reader can tell drift from a file the pin never named.
    ...(left === undefined || left.length === 0 ? {} : { left }),
    // `--status` only: how many files the manifest actually names (which `checked` — what the
    // rules resolve to — is not, once a file is unpinned or gone), how much of the pin the
    // diff cache holds (verified counts, so this cannot promise a reading the alarm would
    // refuse to produce), and which findings a *targeted* re-pin could record. Those are the
    // questions the check's own output leaves a reader to work out from a second command and
    // a knowledge of the rules.
    ...(pinned === undefined ? {} : { pinned }),
    ...(cache === undefined ? {} : { cache }),
    ...(recordable === undefined || recordable.length === 0 ? {} : { recordable }),
    // …and the families that moved behind no stage's key, with the sentence that says so. Absent
    // when every moved family was keyed, so a consumer reads a missing `refused` as "nothing to
    // refuse about" rather than as a reading it did not get. The sentence rides with the list for
    // the same reason `warning` does: the log and the JSON should not be able to say two things.
    ...(refused === undefined || refused.length === 0 ? {} : { refused }),
    ...(refusal === undefined ? {} : { refusal }),
    // …and the moved findings grouped by family, *in the order the report prints them*: the rows
    // beside it are flat and keep the collected order, so without this a consumer would have to
    // re-derive which family leads — and would have no exposure reading to do it with. Each entry
    // carries the rule, how many of its members moved, and the same owner clause the heading prints.
    ...(movedFamilies === undefined || movedFamilies.length === 0 ? {} : { movedFamilies }),
    // Where the text that matched the pin was kept. A convenience, not a gate: its loss
    // costs the diff and nothing else, which is why it is reported rather than required.
    // When the usual directory refused the write this is the fallback, and it says so in
    // `fallback` — the text is on hand and the cache is not where it belongs.
    ...(stash === null || stash === undefined ? {} : { stash }),
    // …and the loss itself, when a pass could not write it anywhere. Named rather than
    // inferred from an absent `stash`, so a consumer that has never read this file can still
    // tell a degraded diff cache from one that was never written for a good reason (a failed
    // check, which deliberately keeps the old text). It travels *with* a `stash` in the
    // kept-elsewhere case, deliberately: that run has both a diff to show and a cache to fix.
    ...(warning === undefined ? {} : { warning }),
    // The reason the write was refused, for the operator who can do something about it: a
    // warning says the diff is lost, and this says whether that is a full disk, a read-only
    // `.ci/`, or a path that is not a directory.
    ...(cause === undefined ? {} : { cause }),
  };
}

/**
 * A manifest as it loads: the digest to use, the watch rules to scan by, the hashes
 * recorded, and — when the file is missing, unreadable, or names no usable rule — the reason
 * it cannot be trusted. A problem is returned rather than thrown because `--write` repairs
 * one, so "could not be read" and "do not write" are different questions.
 *
 * "No usable rule" includes the one rule set this alarm will not scan by: a manifest of its
 * own that records rules other than `DEFAULT_WATCHES`. The rules are declared once, in the
 * script, and the manifest only records them, so a recorded set that differs — a hand edit,
 * or an edit to the declaration that has not been re-pinned yet — is a manifest whose
 * coverage is not the declared coverage. It is refused rather than scanned by, and the
 * repair is the same single command (`npm run gates:pin`, which renders the declaration),
 * which is what leaves the two unable to disagree past one run. A substituted manifest
 * (`GATE_HASHES_FILE`) is taken rules and all: the seam names a whole other pin.
 */
export async function readManifest(manifest = manifestPath()) {
  const relManifest = rel(manifest);
  let algorithm = DEFAULT_ALGORITHM;
  let watches = DEFAULT_WATCHES;
  let recorded = {};
  let problem = null;

  if (existsSync(manifest)) {
    try {
      const loaded = await import(pathToFileURL(manifest).href);
      if (typeof loaded.algorithm === "string" && loaded.algorithm !== "") {
        algorithm = loaded.algorithm;
      }
      // A `watches` that is absent, empty, not a list of rules, or not the declared set is a
      // manifest whose coverage cannot be trusted, so it is refused rather than quietly
      // defaulted: the repair path is `--write`, which is the same one-command answer drift
      // gets.
      if (!Array.isArray(loaded.watches) || loaded.watches.length === 0) {
        problem = `${relManifest} names no watch rule — run \`npm run gates:pin\` to record the gate hashes`;
      } else if (!loaded.watches.every(isRule)) {
        problem = `${relManifest} has a malformed watch rule — run \`npm run gates:pin\` to record the gate hashes`;
      } else if (!substitutedManifest() && !sameRules(loaded.watches, DEFAULT_WATCHES)) {
        // The rules are declared once, in `DEFAULT_WATCHES`; this file only records them, so
        // a recorded set that differs is a manifest whose coverage is not the declared one.
        // Neither list is scanned by: the answer is the one command that re-renders the
        // declaration, because scanning by the record is how the two drifted apart in the
        // first place and scanning by the declaration would hide that they had.
        problem =
          `${relManifest} records watch rules that are not the declared ones — ` +
          "run `npm run gates:pin` to record the gate hashes";
      } else {
        watches = loaded.watches;
      }
      if (loaded.files && typeof loaded.files === "object") recorded = loaded.files;
    } catch (error) {
      problem = `${relManifest} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  } else {
    problem = `${relManifest} does not exist — run \`npm run gates:pin\` to record the gate hashes`;
  }

  return { manifest, relManifest, algorithm, watches, recorded, problem };
}

/** A re-pin that will not be done, with the reason as its message. */
export class RepinError extends Error {}

/** A named path as the manifest keys it: project-relative, forward-slashed, no `./`. */
function targetKey(path) {
  return String(path ?? "").trim().split("\\").join("/").replace(/^\.\//, "");
}

/**
 * Re-pin named files, and only those: the one change automation may make to the manifest.
 *
 * `npm run gates:pin` records the whole tree, which is the right answer for a person with a
 * diff to read and the wrong one for a script that has just written *one* pinned file — a
 * whole-tree re-pin run by a script blesses every other file in that checkout, including
 * one somebody loosened by hand, which is the failure this alarm exists for. So this records
 * the hashes of the files it is *told about*, refuses the two directions that would change
 * the pin's shape, and **reports** the third:
 *
 *   - a path the manifest does not already pin — adding a gate is a person's decision, and
 *     `npm run gates:pin` is where it is made;
 *   - a path that is pinned but no longer on disk (or no longer matched by a rule) — a
 *     targeted re-pin never *drops* a pin;
 *   - any **other** pinned file that does not match the tree, which is named in the returned
 *     `left` rather than thrown. It is still not absorbed — those entries keep the hash the
 *     manifest already had, so the next check reports them exactly as before — and refusing
 *     as well protected nothing the hash does not already protect. What the refusal *did*
 *     cost was real: in a shared checkout, one unrelated file being edited elsewhere made
 *     the targeted form unusable at the moment it was most needed, and the caller had no
 *     answer but to run the whole-tree re-pin the refusal exists to prevent.
 *
 * Returns `{ manifest, moved, files, left }`, where `moved` is the entries that changed
 * (empty when the targets already match) and the file is only rewritten when something
 * moved. Throws `RepinError` with a message that says which of the two refusals it was.
 *
 * `.freebuff/apply-collect-baselines.mjs` is the caller that needs it: the baselines it
 * writes on approval are a pinned gate file, so the workflow that writes them has to land
 * the matching hash in the same commit — otherwise every branch carrying that commit is red
 * on drift until somebody re-pins by hand.
 */
export async function repin(paths, { manifest = manifestPath() } = {}) {
  const loaded = await readManifest(manifest);
  if (loaded.problem) throw new RepinError(loaded.problem);
  const { relManifest, algorithm, watches, recorded } = loaded;

  const named = [...new Set((paths ?? []).map(targetKey).filter(Boolean))];
  if (named.length === 0) throw new RepinError("no file was named to re-pin");

  let current;
  try {
    current = pin([manifest], watches, algorithm);
  } catch (error) {
    throw new RepinError(
      `a watch rule could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const unknown = named.filter((path) => !(path in recorded));
  if (unknown.length > 0) {
    throw new RepinError(
      `${relManifest} does not pin ${unknown.join(", ")} — a targeted re-pin refreshes the hash of a ` +
        "file that is already a gate, and adding one is `npm run gates:pin`",
    );
  }

  const absent = named.filter((path) => !(path in current));
  if (absent.length > 0) {
    throw new RepinError(
      `${absent.join(", ")} is pinned but not on disk (or no watch rule names it any more) — a ` +
        "targeted re-pin will not drop a pin; run `npm run gates:pin` and look at why",
    );
  }

  // What the manifest still does not describe, for the files this re-pin was not asked
  // about. Reported, not thrown: those entries keep the hash the manifest already had, so a
  // re-pin absorbs nothing and the next check reports them anyway — and the caller is told
  // which ones, so a partial re-pin cannot read as a complete one.
  const left = findings(recorded, current).filter((item) => !named.includes(item.path));

  const files = { ...recorded };
  const moved = [];
  for (const path of named) {
    if (current[path] !== recorded[path]) {
      moved.push({ path, from: recorded[path], to: current[path] });
    }
    files[path] = current[path];
  }
  // Nothing moved is not a failure: a caller that re-pins what it wrote can run twice, and
  // the second run should leave the file alone rather than rewrite it with the same bytes.
  if (moved.length > 0) writeFileSync(manifest, renderManifest({ algorithm, watches, files }));

  return { manifest: relManifest, moved, files, left };
}

async function run() {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write") || argv.includes("--pin");
  const status = argv.includes("--status");
  const json = argv.includes("--json");
  // A bare argument names a file to re-pin. Naming files is the *targeted* form of
  // `--write`, so it is only meaningful beside it; a check with paths is a typo, and a
  // typo that silently checked the whole tree instead would be the wrong answer quietly.
  const targets = argv.filter((arg) => !arg.startsWith("-"));

  const manifest = manifestPath();
  const relManifest = rel(manifest);
  const { algorithm, watches, recorded, problem: unreadable } = await readManifest(manifest);

  let current;
  try {
    current = pin([manifest], watches, algorithm);
  } catch (error) {
    // A watch rule naming a directory that is not there — a typo, or a moved tree — is an
    // alarm that cannot run, not a silent narrowing of the pin.
    const message = `a watch rule could not be read: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return report(
      payloadFor({ manifest: relManifest, algorithm, checked: 0, rows: [], gate: "fail", exitCode: 2, message }),
      json,
    );
  }

  const checked = Object.keys(current).length;
  // Every changed file carries the loosening itself when the stash has a copy whose hash
  // is the pinned one: the report is for a reader deciding whether a change was meant, and
  // two hex prefixes do not answer that. No copy means no `diff` key at all, never a
  // guessed one.
  const { rows, ownerByRule } = withFamilies(
    findings(recorded, current).map((row) => {
      if (row.kind !== "changed") return row;
      const diff = driftDiff(row.path, recorded[row.path], algorithm);
      return diff === null ? row : { ...row, diff };
    }),
    // The family view is the tree the findings are about, which is what makes a `gone` finding name
    // the family that held it, and the pin's manifest is left out of it for the same reason the pin
    // leaves it out: a manifest that pinned itself could never be rewritten.
    { watches, files: Object.keys(current), exclude: [manifest] },
  );

  // `--status` is a reading and nothing else, so asking it to write as well is a typo rather
  // than something to guess at — and the rule is not fussiness: a report that stashed on its
  // way past would answer "the cache is healthy" about a cache it had just filled, which is
  // the one question it exists to answer honestly.
  if (status && (write || targets.length > 0)) {
    return report(
      payloadFor({
        manifest: relManifest,
        algorithm,
        checked,
        rows: [],
        gate: "fail",
        exitCode: 2,
        mode: "status",
        message:
          "--status reports the state of the pin and does not change it — it writes no pin " +
          "and stashes nothing, so it is `node .freebuff/gate-drift.mjs --status` on its own",
      }),
      json,
    );
  }

  if (!write && targets.length > 0) {
    return report(
      payloadFor({
        manifest: relManifest,
        algorithm,
        checked,
        rows: [],
        gate: "fail",
        exitCode: 2,
        message:
          `${targets.length} path(s) named without --write — naming files is the targeted ` +
          "re-pin, so it is `node .freebuff/gate-drift.mjs --write <file>`",
      }),
      json,
    );
  }

  // The targeted form, ahead of the whole-tree one and ahead of the vacuous-pin guard: a
  // caller that names files wants *those* files recorded, and the `checked === 0` refusal
  // below answers a different question (a tree no rule matches).
  if (write && targets.length > 0) {
    try {
      const result = await repin(targets, { manifest });
      // The pin and its stash move together: the text just recorded is what the next
      // drift will be diffed against. A stash that could not be written rides along as a
      // `warning` instead of being dropped, so a caller reading the JSON sees the loss —
      // and `left` says which other pinned files this re-pin was right not to touch.
      return report(
        payloadFor({
          manifest: relManifest,
          algorithm,
          checked,
          rows: [],
          gate: "pass",
          exitCode: 0,
          mode: "write",
          targets: [...new Set(targets.map(targetKey))],
          moved: result.moved,
          left: result.left,
          ...stashFields(result.files, algorithm),
        }),
        json,
      );
    } catch (error) {
      return report(
        payloadFor({
          manifest: relManifest,
          algorithm,
          checked,
          rows: [],
          gate: "fail",
          exitCode: 2,
          mode: "write",
          message: error instanceof Error ? error.message : String(error),
        }),
        json,
      );
    }
  }

  // `--write` refuses to record a pin that names nothing: an empty manifest is the one
  // state in which every check below it passes vacuously, so it must not be writable.
  if (write && checked === 0) {
    return report(
      payloadFor({
        manifest: relManifest,
        algorithm,
        checked,
        rows,
        gate: "fail",
        exitCode: 2,
        message: `${relManifest} watches no file — the rules matched nothing, so a pin would be vacuous`,
        mode: "write",
      }),
      json,
    );
  }

  // `--write` repairs a manifest that is missing or malformed rather than refusing:
  // re-pinning is exactly the action the alarm asks for, so a hand-broken manifest must
  // not be able to lock the repair out.
  if (write) {
    try {
      writeFileSync(manifest, renderManifest({ algorithm, watches, files: current }));
    } catch (error) {
      const message = `${relManifest} could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return report(
        payloadFor({ manifest: relManifest, algorithm, checked, rows: [], gate: "fail", exitCode: 2, message }),
        json,
      );
    }
    return report(
      payloadFor({
        manifest: relManifest,
        algorithm,
        checked,
        rows,
        gate: "pass",
        exitCode: 0,
        mode: "write",
        ...stashFields(current, algorithm),
      }),
      json,
    );
  }

  if (unreadable !== null) {
    return report(
      payloadFor({
        manifest: relManifest,
        algorithm,
        checked: 0,
        rows: [],
        gate: "fail",
        exitCode: 2,
        message: unreadable,
      }),
      json,
    );
  }

  // A pin that names nothing *and* finds nothing to compare is the one pass that would
  // disable every gate at once. When the manifest still names files, the `gone` findings
  // above are the better answer — that is a pin whose files were deleted, not one whose
  // rules stopped matching — so the vacuous case is refused only when there is nothing
  // else to say. The two are genuinely different failures and are told apart here.
  if (checked === 0 && rows.length === 0) {
    return report(
      payloadFor({
        manifest: relManifest,
        algorithm,
        checked,
        rows,
        gate: "fail",
        exitCode: 2,
        message: `${relManifest} watches no file — the rules matched nothing, so a pass would be vacuous`,
      }),
      json,
    );
  }

  // A check that passes has the tree the pin describes, so the text it just matched is
  // stashed for the next drift to be read as a diff — and a pass whose stash could not be
  // written carries the `warning` that says the next diff is lost. A check that *fails*
  // stashes nothing: overwriting the last matching content with the loosened one would
  // destroy exactly the diff the report is about to need, so there is nothing to warn
  // about there and no `warning` key either.
  // `--status` is the same report with two things added and one thing left out: the cache's
  // own health, which no other mode answers, and the subset of the findings a targeted re-pin
  // could actually record — where the check lists what is wrong, this says what would fix it.
  // What it leaves out is the stash: a reading must not write the thing it is reporting on.
  const statusFields = status
    ? {
        mode: "status",
        pinned: Object.keys(recorded).length,
        cache: stashReport(recorded, { algorithm }),
        recordable: rows.filter((item) => item.kind === "changed").map((item) => item.path),
      }
    : {};

  // A red check whose moved families include one no stage keys refuses as well as reports: the
  // repair for those is a stage edit, not the re-pin every other finding wants, and the list and
  // the sentence both ride on the payload so a consumer reports what this said rather than cutting
  // its own. `--status` carries it in `--json` too — that report is the check's whole payload plus
  // its own two fields — while the one-line form stays one line.
  const refusal = refusalFor(rows, ownerByRule);
  // …and the fold of the very same rows, ordered the way the runner orders its headings, so the two
  // reports list the families in one order.
  const movedFamilies = familyFold(rows, ownerByRule);

  return report(
    payloadFor({
      manifest: relManifest,
      algorithm,
      checked,
      rows,
      gate: rows.length === 0 ? "pass" : "fail",
      exitCode: rows.length === 0 ? 0 : 1,
      ...statusFields,
      ...(refusal === null ? {} : { refused: refusal.families, refusal: refusal.sentence }),
      ...(movedFamilies.length === 0 ? {} : { movedFamilies }),
      ...(status || rows.length > 0 ? {} : stashFields(recorded, algorithm)),
    }),
    json,
  );
}

/**
 * The loosening itself, for one changed file: a redacted unified diff of the text the pin
 * recorded against the text on disk, or `null` when no such text is on hand.
 *
 * `stashedText` verifies the cached copy against the pinned hash first, so the only two
 * outcomes are a true diff and no diff — a stale cache cannot describe the wrong change.
 */
function driftDiff(key, pinned, algorithm) {
  const before = stashedText(key, pinned, { algorithm });
  if (before === null) return null;
  let after;
  try {
    after = readFileSync(join(ROOT, key), "utf8");
  } catch {
    return null;
  }
  return unifiedDiff(before, after, { path: key });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
