#!/usr/bin/env node
/**
 * The coverage gates' own load-bearingness, run and reported like the guard sweep.
 *
 * `src/test/coverage-mutation.test.ts` is the check itself: it weakens each
 * coverage gate script in place, one at a time, and requires that script's own
 * test file to fail. As a test file it is only half a gate — it runs with the
 * suite, and a red case deep in a test report is not the same thing as a build
 * that refuses to pass. This is the launcher that makes it one: it runs that
 * single file under `vitest.mutation.config.ts` (which exists so the check is the
 * only writer of those scripts while it runs), reads Vitest's JSON report back,
 * and answers the contract `.freebuff/mutation-guards.mjs --json` answers —
 * `gate`, `checked`, and one entry per survivor — so `.freebuff/ci.mjs` can
 * report a survived *gate* the way it reports a survived *guard*, and the nightly
 * job's summary and annotations carry it through `nightly-report.mjs` without
 * either side knowing about the other.
 *
 * ## What a survivor is here
 *
 * The check inverts the usual mutation question. Each case *asserts* that the
 * weakened gate fails its test file, so a case that passes is a mutation that
 * survived: the gate's own test file did not notice the weakening, and the pin
 * does not hold. A failing case is therefore the finding, and every case that did
 * not pass is reported as a survivor, grouped by what it means — the words
 * `SURVIVOR_WORDS` declares, which the start-up refusal holds the stamps to:
 *
 *   - `survived` — the case ran, asserted, and the weakening went unnoticed
 *     ("… still passed, so the mutation survived"). This is the one that means a
 *     coverage gate stopped being load-bearing.
 *   - `broken` — the check could not reach that conclusion: the anchor drifted
 *     out of the script, the mapped test file failed to load, the case was
 *     skipped, or the run produced no report at all. A different problem, not a
 *     smaller one — it means the gate is unchecked, which is how a gate
 *     disappears without anyone lowering a number.
 *
 * `checked` counts the cases that ran (every test in the report), so a check that
 * quietly stopped collecting anything reads as a survivor rather than as a clean
 * pass: an empty run is the loudest failure this can have. And the other end of the
 * same worry is held too: `.freebuff/coverage-strikes.mjs` declares how many
 * weakenings there are supposed to be, so a run that collected *fewer* cases than
 * that — a strike deleted from `src/test/coverage-mutations.ts`, which shrinks the
 * walk without failing a case — is refused here rather than passing over whatever is
 * left.
 *
 * ## Crash safety: a killed run cannot leave a weakened gate behind
 *
 * The check edits a coverage script in place and puts it back in a `finally` before
 * the next case, so an error restores it — but a SIGKILL, a closed terminal or a
 * power cut runs no handler at all, and a weakened gate left on disk is the one
 * outcome worse than the check it was mutating: `<=` in `coverage-floor.mjs` fails a
 * file sitting exactly on its floor, and an unanchored glob in `coverage-scopes.mjs`
 * hands a threshold files it was never meant to hold. So the check holds a **lock**
 * while a script is weakened — `.freebuff/mutation-lock.mjs` owns that file and its
 * shape, and the check writes through it (the guard sweep holds the same lock) — and
 * this launcher reads any lock
 * it finds *before* it spawns Vitest, through the same module's recovery: a script
 * still matching the mutation is restored from the lock's copy, one already whole just
 * has its lock cleared, and one matching neither (another writer edited it in the
 * window) is left alone with the lock in place and a warning, because the lock's copy
 * is older than that edit and restoring it would lose it — unless that edit *absorbed*
 * the mutation, which the lock can see from the splice it records: a file that still
 * contains the weakened source is neither version, so the recorded source goes back over
 * it — the holder is dead, and no run may measure a file carrying the weakened source —
 * with the write verified and the lock cleared; the recovery refuses (exit 2) only if
 * that restore does not verify, and then this launcher never reaches Vitest. A lock
 * whose `pid` is still running means another run holds the tree, so this refuses to
 * start rather than fighting it for the same file.
 *
 * `--recover` does that recovery and stops: the way to put a tree back without
 * paying for the check, and the mode `src/test/mutation-coverage.test.ts` drives
 * against a lock written by hand.
 *
 * ## Usage
 *
 *   npm run mutation:coverage                     # human report, exit 1 on a survivor
 *   node .freebuff/mutation-coverage.mjs --json   # one report object on stdout
 *   node .freebuff/mutation-coverage.mjs --recover  # restore an interrupted run's tree, then stop
 *
 * Exit codes, the sweep's: 0 when every gate was caught, 1 when a survivor was
 * found, 2 when the run could not be read at all (no report, or the launcher
 * could not spawn Vitest), 3 when another run holds the lock. A crash still writes
 * the `--json` report — a broken run is a survivor, not silence — with the reason in
 * its `detail`.
 *
 * `MUTATION_COVERAGE_VITEST` (an absolute path, or one resolved beside this file)
 * points the launcher at another Vitest entry, which is how
 * `src/test/mutation-coverage.test.ts` drives the report mapping against a stub
 * instead of paying for the five nested runs the real check makes.
 *
 * For a single case with Vitest's own output — `npx vitest run --config
 * vitest.mutation.config.ts -t floor` — run the config directly; this launcher
 * owns none of Vitest's flags.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// The lock a run holds while a script is weakened, and the recovery that puts one back
// after a kill: the module owns the file and its shape, and the check that weakens the
// scripts writes it, so the writer and the reader cannot drift apart. The guard sweep
// holds the same lock — one file for both, since it means "this tree is being edited".
import { recoverInterruptedRun } from "./mutation-lock.mjs";
// The survivor words this report declares, and the two-way comparison its start-up refusal
// acts on: declared once, in the vocabulary module the guard sweep and the preflight sweep
// read their own tables from. The launcher's stamps stay here — what counts as a stamp is
// this launcher's own shape — and the refusal stays here too, shaped to this payload.
import {
  COVERAGE_SURVIVOR_WORDS as SURVIVOR_WORDS,
  SURVIVOR_WHY,
  vocabularyHoles as vocabularyHolesOf,
} from "./mutation-vocabulary.mjs";
// The declared strike count: the one place that can tell a smaller sweep from a clean one, so a
// strike deleted from the table (which shrinks the check without failing a case) is a refusal
// here rather than a shorter run that reads green. `src/test/declared-strikes.ts` reads the same
// declaration, both ways and anchor by anchor, from the default suite; this is the opt-in run's
// half of it.
import { COVERAGE_STRIKES } from "./coverage-strikes.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `--json` swaps the human report for a machine-readable one, the way every other
 * gate in this repo works: progress moves to stderr and stdout carries a single
 * object. The exit code is unchanged.
 */
const JSON_OUTPUT = process.argv.includes("--json");
const vocabularyOnly = process.argv.includes("--vocabulary");
const log = JSON_OUTPUT ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts);

/** The config that isolates the check, and the file it is the only member of. */
const CONFIG = "vitest.mutation.config.ts";
const CHECK_FILE = "src/test/coverage-mutation.test.ts";

/**
 * The scratch report a run writes. Vitest's name for it, so the flag this passes is
 * the one it documents — keyed by the process id, so a second run in this shared
 * checkout can never have its report read by the first (which is the one mistake
 * here that would read as a pass) — and removed before and after, so it is never
 * stale.
 */
const reportPath = join(ROOT, ".freebuff", `.mutation-coverage-report.${process.pid}.json`);

/** The project-relative, forward-slashed path a report names. */
const rel = (path) => relative(ROOT, path ?? "").split("\\").join("/");

/** The Vitest entry to spawn, overridable so a test can run the mapping against a stub. */
function vitestEntry() {
  const override = process.env.MUTATION_COVERAGE_VITEST;
  if (override === undefined || override === "") return join(ROOT, "node_modules", "vitest", "vitest.mjs");
  return isAbsolute(override) ? override : fileURLToPath(new URL(override, import.meta.url));
}

/** The first non-empty line of a message — all a one-line report can carry. */
function firstLine(text) {
  return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

/**
 * The survivor vocabulary: the words this launcher's report can name, no longer declared
 * here — they are the coverage table of the shared vocabulary module, imported above under
 * the local name `SURVIVOR_WORDS` (with its `SURVIVOR_WHY` sentences) so every bucket and
 * refusal below keeps its spelling. A stamp with no word is a survivor the report counts
 * nowhere — its buckets filter on exactly these words — and a word with no stamp is a
 * repair the report claims and nothing can reach. Both are refused before Vitest is
 * spawned, beside the lock recovery: the same refusal the guard sweep makes over
 * `STRIKE_WORDS`, and the preflight sweep over `SURVIVOR_WORDS`, sized to this launcher's
 * two kinds.
 */

// The two words in stamp position, named so the mapping's conditional stays scannable:
// the stamp scan reads them where they are declared (see `stampedKinds`), so a word the
// vocabulary drops is a hole the refusal names, not a literal nothing can see.
const KIND_SURVIVED = "survived";
const KIND_BROKEN = "broken";

/**
 * The survivor kinds this launcher's own source stamps, read rather than restated: every
 * `kind` word the report itself declares for — the mapping's two-way split between a
 * weakening a gate's own test file did not notice and a check that could not answer. The
 * refusal survivors below are the vocabulary speaking about itself, not stamps in it, so
 * the scan reads over `broken` there: `broken` is a declared word, and the refusal can
 * never be the thing that makes the set disagree.
 */
function stampedKinds(source) {
  const stamps = new Set();
  // The words in stamp position, both ways a stamp is written: the kind literal the sweep
  // maps each case onto, and the KIND_* constants the mapping's conditional stamps (read
  // where they are declared, so a word the vocabulary drops is a hole the refusal names).
  const literal = /\bkind: "(\w+)"/g;
  for (const match of source.matchAll(literal)) {
    if (match[1] !== "broken") stamps.add(match[1]); // the refusal's own survivors are not a bucket
  }
  for (const match of source.matchAll(/\bconst (KIND_\w+) = "(\w+)"/g)) {
    stamps.add(match[2]);
  }
  return [...stamps];
}

/** The two ways the stamps and the declared words can disagree, read from this source. */
function vocabularyHoles(source) {
  return vocabularyHolesOf(SURVIVOR_WORDS, stampedKinds(source));
}

/**
 * The start-up refusal: the one reason this launcher may not begin (it names no survivor
 * its stamps can produce), reported and exited before Vitest is spawned — after the lock
 * recovery, so a healed tree is still carried. It exits 1, the code a `broken` survivor
 * earns at the end of a run, and under `--json` it writes the report a consumer already
 * reads rather than crashing with none, so the runner names the reason instead of a parse
 * failure. `note` keeps the human line a normal refusal carries, and `recovered` keeps the
 * heal a killed run left for this one.
 */
function refuseVocabulary({ unnamed = [], unspoken = [] }, recovered) {
  const survivors = [
    ...unnamed.map((kind) => ({
      path: rel(fileURLToPath(import.meta.url)),
      line: null,
      kind: "broken",
      descriptor: `a survivor stamped "${kind}"`,
      detail: `it stamps kind "${kind}", which SURVIVOR_WORDS does not declare`,
    })),
    ...unspoken.map((word) => ({
      path: rel(fileURLToPath(import.meta.url)),
      line: null,
      kind: "broken",
      descriptor: `the "${word}" word`,
      detail: "SURVIVOR_WORDS declares it, and no survivor can ever carry it",
    })),
  ];
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: ROOT,
          gate: "fail",
          exitCode: 1,
          checked: 0,
          files: 0,
          survivors,
          recovered: recovered ? [recovered] : [],
          note: `${survivors.length} vocabulary hole(s) — the kinds this launcher stamps and the words its report declares are not the same set`,
        },
        null,
        2,
      )}\n`,
    );
  }
  log("");
  log(
    `mutation-coverage: START-UP REFUSAL (${survivors.length}) — refusing before the check runs; this launcher verifies nothing until the reason below is repaired:`,
  );
  log("");
  log(
    `  VOCABULARY HOLES (${survivors.length}) — the kinds this launcher stamps and the words its report declares are not the same set:`,
  );
  for (const kind of unnamed) {
    log(`    - kind "${kind}"`);
    log("      it stamps a kind SURVIVOR_WORDS does not declare, so the report counts a survivor under it nowhere");
  }
  for (const word of unspoken) {
    log(`    - the "${word}" word`);
    log("      SURVIVOR_WORDS declares it, and no survivor can ever carry it");
  }
  console.error(
    `\nmutation-coverage: ${survivors.length} vocabulary hole(s) — declare every kind a survivor can carry, ` +
      "and drop every word nothing stamps: a survivor the report cannot name is a gate held by nothing " +
      "while every test stays green.",
  );
  process.exit(1);
}

/**
 * The stamps with their sites: the same scan `stampedKinds` runs — the refusal's own
 * `broken` literals skipped, the `KIND_*` declarations read where they stand — carrying the
 * line number and text each match was read from, so the vocabulary table can list what
 * fills each bucket beside the bucket rather than count it into a blur.
 */
function stampedSites(source) {
  const lines = source.split("\n");
  const self = rel(fileURLToPath(import.meta.url));
  const sites = [];
  for (const match of source.matchAll(/\bkind: "(\w+)"/g)) {
    if (match[1] === "broken") continue; // the refusal's own survivors are not a bucket
    const line = source.slice(0, match.index).split("\n").length;
    sites.push({ file: self, line, word: match[1], text: (lines[line - 1] ?? "").trim() });
  }
  for (const match of source.matchAll(/\bconst (KIND_\w+) = "(\w+)"/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    sites.push({ file: self, line, word: match[2], text: (lines[line - 1] ?? "").trim() });
  }
  return sites;
}

/**
 * `--vocabulary`: the report-only table, the guard sweep's mode by the same name — each
 * declared word beside the stamps that fill its bucket, and any hole reported rather than
 * left for the refusal below. It answers before Vitest is spawned, reading nothing but this
 * launcher's own source and the shared table, so it says whether a run would begin — never
 * what a run would find — and exits 1 only when the vocabulary is already a refusal.
 */
function vocabularyTable() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const sites = stampedSites(source);
  const { unnamed, unspoken } = vocabularyHoles(source);
  const holes = unnamed.length + unspoken.length;
  const exitCode = holes === 0 ? 0 : 1;
  const self = rel(fileURLToPath(import.meta.url));
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: ROOT,
          mode: "vocabulary",
          file: self,
          words: Object.entries(SURVIVOR_WORDS).map(([word, mark]) => ({
            word,
            mark,
            why: SURVIVOR_WHY[word],
            stamps: sites.filter((site) => site.word === word),
          })),
          unnamed,
          unspoken,
          gate: exitCode === 0 ? "pass" : "fail",
          exitCode,
        },
        null,
        2,
      )}\n`,
    );
    process.exit(exitCode);
  }
  log("");
  log(
    `mutation-coverage: survivor vocabulary — ${Object.keys(SURVIVOR_WORDS).length} declared word(s), ` +
      `${new Set(sites.map((site) => site.word)).size} kind(s) stamped\n`,
  );
  for (const [word, mark] of Object.entries(SURVIVOR_WORDS)) {
    const filled = sites.filter((site) => site.word === word);
    log(`  "${word}" (${mark}): ${filled.length} stamp(s) the bucket reads — ${SURVIVOR_WHY[word]}`);
    for (const site of filled) log(`      ${site.file}  line ${site.line}: ${site.text}`);
  }
  log(
    holes === 0
      ? "\n  every declared word is stamped, and every stamp names a declared word."
      : `\n  ${holes} vocabulary hole(s):`,
  );
  for (const kind of unnamed) {
    log(`    UNNAMED   a survivor stamped "${kind}" — SURVIVOR_WORDS does not declare it`);
  }
  for (const word of unspoken) {
    log(`    UNSPOKEN  the "${word}" word — declared, and no stamp can ever carry it`);
  }
  if (holes > 0) {
    console.error(
      `\nmutation-coverage: ${holes} vocabulary hole(s) — the next check would refuse before it runs; ` +
        "declare every kind a survivor can carry, and drop every word nothing stamps.",
    );
  }
  process.exit(exitCode);
}

/** The last non-empty line of a child's output, which is where a crash says why. */
function lastLine(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

/**
 * Every case the run reported, in order: the gate file it belongs to, its name,
 * its status, and any failure messages. A file that failed to load carries no
 * assertion at all, which is itself a case here — a collection error must not read
 * as "nothing failed".
 */
function casesOf(report) {
  const cases = [];
  for (const file of report?.testResults ?? []) {
    const path = rel(file.name);
    const assertions = file.assertionResults ?? [];
    for (const assertion of assertions) {
      cases.push({
        path,
        descriptor: assertion.fullName ?? assertion.title ?? "(unnamed case)",
        status: assertion.status,
        messages: assertion.failureMessages ?? [],
      });
    }
    if (file.status === "failed" && assertions.length === 0) {
      cases.push({
        path,
        descriptor: "the check file failed to load",
        status: "failed",
        messages: [file.message ?? ""],
      });
    }
  }
  return cases;
}

/**
 * One survivor per case that did not pass, classified by what it means: a case
 * whose own message says the mutation survived is a gate that stopped being
 * load-bearing, and anything else — a drifted anchor, a file that would not load,
 * a case that was skipped — is the check unable to answer at all.
 */
function survivorsOf(cases) {
  return cases
    .filter((item) => item.status !== "passed")
    .map((item) => ({
      path: item.path,
      line: null,
      // The stamp resolves the vocabulary's own words, held to `SURVIVOR_WORDS` at start-up.
      // Each is written as a `KIND_*` constant — a ternary of bare literals would hide both
      // words from the stamp scan, which reads them where they are declared — so the
      // conditional keeps the words scannable.
      kind: item.status === "failed" && item.messages.some((message) => /mutation survived/i.test(message))
        ? KIND_SURVIVED
        : KIND_BROKEN,
      descriptor: item.descriptor,
      detail:
        item.messages.map(firstLine).find(Boolean) ??
        (item.status === "failed" ? "the case failed with no message" : "the case did not run"),
    }));
}

/**
 * The report this run closes with: the gate, the counts, every survivor, and any lock
 * recovery — a healed tree is a fact about this run, and this report is where a run's
 * facts go, so `.freebuff/ci.mjs` can say what happened without reading a stderr.
 */
function report({ cases, files, survivors, note, recovered }) {
  const exitCode = survivors.length === 0 ? 0 : note === undefined ? 1 : 2;
  const payload = {
    root: ROOT,
    gate: exitCode === 0 ? "pass" : "fail",
    exitCode,
    checked: cases.length,
    files,
    survivors,
    recovered: recovered ? [recovered] : [],
    ...(note === undefined ? {} : { note }),
  };

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    log(`mutation-coverage: weakening each coverage gate in place, one at a time, and requiring`);
    log(`  that gate's own test file to fail (the working tree is edited and restored as it goes)`);
    log("");
    for (const [index, item] of cases.entries()) {
      const mark = item.status === "passed" ? "caught  " : item.status === "failed" ? "SURVIVED" : "NOT RUN ";
      log(`  [${index + 1}/${cases.length}] ${mark}  ${item.descriptor}`);
    }
    log("");
    if (note !== undefined) log(`mutation-coverage: ${note}`);
    log(`Checked ${cases.length} case(s) in ${files} file(s).`);

    // One bucket per declared word, in the table's order: these are the words the start-up
    // refusal holds the stamps to, so a survivor under an undeclared kind cannot reach this
    // loop — it is refused before Vitest is spawned instead.
    for (const [kind, mark] of Object.entries(SURVIVOR_WORDS)) {
      const items = survivors.filter((item) => item.kind === kind);
      if (items.length === 0) continue;
      log("");
      log(`  ${mark} (${items.length}) — ${SURVIVOR_WHY[kind]}:`);
      for (const item of items) {
        log(`  - ${item.path}  ${item.descriptor}`);
        log(`      ${item.detail}`);
      }
    }

    log("");
    const survived = survivors.filter((item) => item.kind === KIND_SURVIVED).length;
    if (survivors.length === 0) {
      log("Every coverage gate was caught by its weakening: no mutation survived.");
    } else {
      log(
        `${survivors.length} survivor(s): ${survived} ${SURVIVOR_WHY.survived}, ` +
          `${survivors.length - survived} ${SURVIVOR_WHY.broken}.`,
      );
    }
  }

  process.exit(exitCode);
}

/** A run that never got as far as a report: a survivor, with the reason it could not run. */
function unreadable(reason, recovered) {
  log(`mutation-coverage: ${reason}`);
  report({
    cases: [],
    files: 0,
    note: reason,
    recovered,
    survivors: [{ path: CHECK_FILE, line: null, kind: "broken", descriptor: "the check did not run", detail: reason }],
  });
}

// Whatever an interrupted run left weakened goes back before anything reads those
// scripts: the lock is the only record of what they looked like. What that did is kept
// — not only printed — so the report below can carry it. `--recover` stops here, which
// is how a tree is put back without paying for the check.
const recovered = recoverInterruptedRun();
if (process.argv.includes("--recover")) {
  console.error("mutation-coverage: recovery only — the check was not run.");
  process.exit(0);
}

// `--vocabulary` answers here, where `--recover` does: before the refusal reads its stamps and
// before Vitest is spawned, reading nothing but this launcher's own source and the shared
// table — so it says whether a run would begin, never what a run would find, and runs no check.
if (vocabularyOnly) vocabularyTable();

// The vocabulary is read from this launcher's own source, whole — before Vitest is spawned —
// so a hole refuses a run that would sweep rather than one that already did.
const vocabulary = vocabularyHoles(readFileSync(fileURLToPath(import.meta.url), "utf8"));
if (vocabulary.unnamed.length > 0 || vocabulary.unspoken.length > 0) {
  refuseVocabulary(vocabulary, recovered);
}

if (existsSync(reportPath)) unlinkSync(reportPath);

const entry = vitestEntry();
const child = spawnSync(
  process.execPath,
  [entry, "run", "--config", CONFIG, "--reporter=json", `--outputFile=${reportPath}`],
  { cwd: ROOT, encoding: "utf8" },
);

let vitestReport = null;
try {
  vitestReport = JSON.parse(readFileSync(reportPath, "utf8"));
} catch {
  vitestReport = null;
} finally {
  if (existsSync(reportPath)) unlinkSync(reportPath);
}

if (child.error) {
  unreadable(`could not run ${rel(entry)}: ${child.error.message}`, recovered);
}

if (vitestReport === null) {
  const output = `${child.stderr ?? ""}\n${child.stdout ?? ""}`;
  unreadable(
    `the check wrote no report — Vitest exited ${child.status ?? "on a signal"} without writing ${rel(reportPath)}` +
      (lastLine(output) === "" ? "" : `: ${lastLine(output)}`),
    recovered,
  );
}

const cases = casesOf(vitestReport);
if (cases.length === 0) {
  unreadable(`${CONFIG} collected no case — the report names no test file`, recovered);
}

// The declared count, and the shrink that refuses. A case deleted from the table makes the check
// walk a shorter list, so every case that is left passes and the run reads clean — and nothing in
// the report says how many there should have been. `COVERAGE_STRIKES` does, and comparing the two
// is what catches the deletion from inside the opt-in run: the default suite holds the table both
// ways and anchor by anchor, but this is the run that actually weakens the gates.
const survivors = survivorsOf(cases);
// Only a run that would otherwise read as a pass is refused for the shortfall: a run that already
// carries a survivor is red already, and the deleted-strike shape this catches is a *clean*, shorter
// walk — every remaining case passes, and nothing else says a case is missing.
if (survivors.length === 0 && cases.length < COVERAGE_STRIKES.length) {
  survivors.push({
    path: CHECK_FILE,
    line: null,
    kind: "broken",
    descriptor: "the check weakened fewer gates than the declared strike list",
    detail:
      `the run reported ${cases.length} case(s), but ${COVERAGE_STRIKES.length} strike(s) are ` +
      "declared in .freebuff/coverage-strikes.mjs — a strike deleted from " +
      "src/test/coverage-mutations.ts shrinks the sweep without failing a case, so this " +
      "refuses rather than reporting a pass over the gates that are left.",
  });
}

report({ cases, files: (vitestReport.testResults ?? []).length, survivors, recovered });
