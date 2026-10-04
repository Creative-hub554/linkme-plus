#!/usr/bin/env node
/**
 * Finds route guards whose removal no test notices.
 *
 * A guard — an `if` whose body answers a 4xx/5xx — is the place a route makes a
 * decision a test exists to pin. This walks every `src/app/**\/route.ts` that has
 * a neighbour `route.test.ts`, finds each guard, rewrites its condition to
 * `false`, runs *that* test file, and records whether the suite noticed. A guard
 * whose test file still passes in full is **survived**: the guard is real code
 * whose removal costs nothing in coverage, which is exactly where a regression
 * could slip through.
 *
 * The same walk also finds every `catch` clause, and mutates it back into a
 * rethrow (`catch (err) { throw err; }`). A guard answers a bad *input* before
 * the work starts; a catch answers a *failed operation*. Both are branches a
 * test exists to pin, and a catch whose removal no test notices is an error path
 * nothing drives — the branch a `failNextSelect`/`failNextInsert` seam would
 * reach. Mutating it to rethrow makes a driven branch reject the handler (the
 * test fails), and leaves an undriven one invisible (the test passes), which is
 * the same caught/survived split the guards report.
 *
 * Every guard is also mutated *fail-open*: its refusal body is replaced with a
 * success return, so the guard still fires but answers 2xx instead of 4xx. This
 * is the regression a test that only checks "the route refused" misses — the
 * branch that used to answer an error now quietly succeeds. It is not the same
 * check as removing the guard: with the condition forced to `false` the route
 * carries on past the guard and a *later* refusal can still answer with the
 * status the test expects, so the guard's own removal survives behind a sibling.
 * The fail-open mutation returns early, so a test that is really pinning *this*
 * guard's refusal fails, while a test that only ever reaches a sibling's still
 * passes and the guard is reported as an uncovered error path. Catches are not
 * mutated this way: turning a catch fail-open is strictly weaker than the
 * rethrow above, which already catches every test that reaches the branch.
 *
 * It edits the working tree while it runs and restores every file it touched
 * before moving on. If the file is not the one it wrote when it comes to restore
 * (another session edited it in the window), it stops rather than clobbering, and
 * says the mutation may have been *absorbed* into the new content rather than
 * replaced by it — a file that still carries the weakened source is the one case a
 * later run must not measure as the real thing.
 *
 * A restore only helps if the process gets to run it. SIGINT and SIGTERM are
 * caught and restore the one file that is currently mutated, but a SIGKILL, a
 * closed terminal or a power cut runs no handler at all, and a route left
 * rewritten (`if ( false )`, or a refusal body replaced with a success return)
 * goes on being served — silently refusing valid input, or accepting invalid
 * input. So before a file is mutated the sweep writes a **lock** naming that file and
 * holding its pre-mutation source, and removes the lock once the file is back. On
 * startup the sweep runs the recovery first: if the file still matches the mutation it
 * restores the recorded source and clears the lock, if it is already whole it just
 * clears the lock, and if it matches neither (someone else edited it) it refuses to
 * clobber and leaves the lock for a human — and should that edit have *absorbed* the
 * mutation rather than replaced it, which the lock can tell from the splice it records,
 * the recorded source goes back over both (a file carrying the weakened source may not
 * be measured, and the holder is dead), with the write verified and the lock cleared —
 * the recovery refuses only if that restore does not verify.
 * A lock whose `pid` is still running means
 * another run holds the tree, so this one refuses to start rather than fighting it for
 * the file.
 *
 * Both halves of that live in `.freebuff/mutation-lock.mjs`, which the coverage gate
 * mutation check holds against too: the lock is one file
 * (`.freebuff/.mutation-lock.json`) for both, because "this tree is being edited right
 * now" is a property of the tree rather than of the check holding it. A second run of
 * either check stands down with `REFUSING TO START` instead of rewriting files beside
 * the first.
 *
 * The same walk cannot see the test helpers, which are the *other* place a
 * decision is pinned: a helper whose body stops asserting is a guard removed
 * from every test that calls it, and no route test can notice because they all
 * keep passing. `SELF_MUTATIONS` below strikes those helpers directly and
 * requires the helper's own unit test to catch it.
 *
 * It cannot see the convention guards either, and they are the third place a
 * decision is pinned. `src/test/convention-guards.ts` holds the detectors behind
 * the source-reading guards — a raw `mount()`, an assertion after a `settle()`, a
 * teardown that clears the body before React has torn its portals down, an
 * unlayered colour rule, a per-beat callback, a surface-owned clock, a stale
 * runbook Contents block, an environment name no client bundle may carry, a secret
 * published under a `NEXT_PUBLIC_` name, a build config that inlines a server value — and `src/test/convention-guards.test.ts` is the one
 * file that proves each detector still *fires*. A detector that has quietly
 * stopped catching is a rule that has gone unenforced, which is exactly the
 * failure the meta-test exists for and one no route test can see.
 * `CONVENTION_MUTATIONS` below strikes them at two depths: one detector neutered at a
 * time, and then one *limb* at a time — a single comparison inverted, one name struck
 * from a vocabulary, one gate narrowed. The second depth is the point, because a
 * detector that has lost a limb still fires on the fixture that is now its only
 * evidence, so it passes a whole-detector check while the part of the rule it dropped is
 * enforced by nothing. Each entry names the guard test that pins its depth, and a
 * detector that has gone dark, or gone partly dark, is a survivor here rather than a
 * guard that silently became decorative.
 *
 * The fourth place is the runner itself, and no walk above can see it either.
 * `.freebuff/ci.mjs` is where a run decides what to *say* — which files sit behind a
 * stage's key, and which of a stage's `inputs` resolve to no file — and those answers
 * are read by `src/test/ci-runner.test.ts` and by nothing else, which puts them in
 * exactly the position the helpers and the detectors are in one and two files over: a
 * check that stopped answering leaves a suite that still passes, and a run that goes on
 * vouching for a tree nothing measured. A glob that matches nothing keys nothing and
 * nothing about it says so — which is how `wrangler.toml` sat behind a checkout that had
 * moved to `wrangler.jsonc`, in the force list *and* in a stage's `inputs`. Those are the
 * two halves of one question (`forceAbsences` and `inputAbsences`), and `RUNNER_MUTATIONS`
 * below strikes each of them quiet and requires the runner's own suite to catch it.
 *
 * The fifth place is the module all of that *shares*: `.freebuff/mutation-lock.mjs`, which
 * puts back what a killed run left mutated and refuses the file a later edit left still
 * carrying the mutation. Its answers are read by four callers — the runner healing before
 * its stages, the guard sweep, the preflight sweep and the coverage launcher — and held by
 * one suite, which is the same position the helpers, the detectors and the runner are in: a
 * refusal that stopped refusing leaves a run measuring a file that carries the weakened
 * source as if it were the real thing, with every test still green. `LOCK_MUTATIONS` below
 * strikes one of those answers quiet and requires `src/test/mutation-sweep-recovery.test.ts`
 * to catch it.
 *
 * The sixth place is the ratchet that holds the other five: `holdDeclaredTable` in
 * `src/test/declared-strikes.ts`, which compares each table to its declaration and pins each
 * declared anchor, and whose own suite (`src/test/declared-strikes.test.ts`) carries a control
 * that requires it to reject a disagreement. A ratchet that stopped holding would leave every
 * generated case green over tables that are no longer held — the same silent pass the five
 * families above exist to prevent, one level up — so `RATCHET_MUTATIONS` below strikes it quiet
 * and requires that control to catch it.
 *
 *   node .freebuff/mutation-guards.mjs            # every route with a test
 *   node .freebuff/mutation-guards.mjs --list     # enumerate targets, run nothing
 *   node .freebuff/mutation-guards.mjs --audit    # the detector decisions no strike reaches
 *   node .freebuff/mutation-guards.mjs --anchors   # read every strike's anchor, run nothing
 *   node .freebuff/mutation-guards.mjs --vocabulary # each family and the strikes that stamp it
 *   node .freebuff/mutation-guards.mjs --file=admin
 *   node .freebuff/mutation-guards.mjs --limit=10
 *   node .freebuff/mutation-guards.mjs --write-baseline  # (re)record the survivor and un-struck baseline
 *   node .freebuff/mutation-guards.mjs --baseline        # fail on a gap the baseline does not record
 *   node .freebuff/mutation-guards.mjs --no-fail-open    # skip the fail-open guard mutations
 *   node .freebuff/mutation-guards.mjs --json            # machine-readable survivors (see below)
 *
 * `--json` replaces the human progress and summary with a single JSON object on
 * stdout — the counts, the gate, every survivor with its path, line, kind and
 * descriptor, and any lock it recovered out of the shared `.freebuff/.mutation-lock.json`.
 * A survivor's `kind` carries the *depth* as well as the family: `guard`,
 * `failopen` and `catch` for the route walk, `self` for a test helper,
 * `convention` for a convention detector that reported nothing at all, `limb`
 * for one limb of one that went dark, `runner` for a check inside the runner
 * itself, `lock` for one of the answers the shared lock module gives the runner and
 * the three tree-editing checks, and `ratchet` for the declared-table hold itself — so a consumer can count the two detector
 * failures apart instead of reading them as the same regression (`ci.mjs` does,
 * in the stage summary it hands the run page). One more kind never sits beside them:
 * `broken`, something the sweep will not apply — a strike whose anchor no longer occurs in
 * the file it rewrites, or a word the entries and `STRIKE_WORDS` disagree about (a kind an
 * entry stamps that no word declares, or a declared word no entry stamps). It is
 * carried in `survivors` so a consumer names it the way it names every other failure,
 * but the sweep refuses before its first strike and names every reason at once, so a
 * `broken` row appears only in a `gate: "fail"` object with `checked: 0`. The strikes that ran are counted
 * the same way, as `helperSelfMutations`, `runnerSelfMutations`,
 * `conventionSelfMutations`, `limbSelfMutations`, `lockSelfMutations` and
 * `ratchetSelfMutations` — so a CI job can name the survivors without parsing the report. Progress goes to
 * stderr, stdout carries exactly the one object, and the exit code is unchanged. It applies to a plain sweep; `--list`, `--audit`, `--anchors`, `--vocabulary`, `--write-baseline`
 * and `--baseline` keep their own output and ignore it.
 *
 * `--anchors` is the cheap question asked on its own: it reads every self-mutation strike's
 * `find` against the file it splices into and reports which still occurs exactly once,
 * running no strike, editing nothing and holding no lock. A drifted anchor exits 1 — the same
 * code the sweep's own refusal uses, so the two cannot disagree about what is red — and a
 * `--json` run carries a row per strike (`path`, `name`, `status`, `occurrences`, and the
 * `kind` the entry resolves to) plus the drifted names. Like the audit and the refusal, it reads the families whole, so a `--file`
 * that would run none of them cannot narrow the answer.
 *
 * Exit code is 1 if any guard or self-mutation survived, and also when the sweep refuses to
 * begin: a strike's anchor no longer occurs in its target, or the entries and `STRIKE_WORDS`
 * disagree about a kind. Those reasons are checked and reported together, before anything is
 * measured, because a strike that cannot be applied — or a survivor that cannot be named —
 * would leave its check held by nothing while every test still passed. Either way the code is a gate.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The lock this sweep holds while a file is mutated, and the recovery that puts one
// back after a kill, are shared with the coverage gate mutation check — one module
// owns the file and its shape, so the two checks cannot drift apart.
import { LOCK_PATH, clearLock, recoverInterruptedRun, writeLock } from "./mutation-lock.mjs";
// The save a strike is allowed to take: text that balances, or nothing. A strike that could
// not be loaded would fail its test for the wrong reason, which the sweep reads as *caught*.
import { saveWholeScript } from "./whole-write.mjs";
// The words a survivor's family is named by, and the two-way comparison the start-up refusal
// acts on: declared once, in the vocabulary module the preflight sweep and the coverage
// launcher read their own tables from. `strikeKind` stays here — it is the one place a stamp
// is resolved — and the refusal stays here too, shaped to this sweep's survivor objects.
import { STRIKE_WORDS, vocabularyHoles as vocabularyHolesOf } from "./mutation-vocabulary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = join(root, "src", "app");
const vitestEntry = join(root, "node_modules", "vitest", "vitest.mjs");

// Where a strike reads and rewrites its target. Every real run uses the checkout itself;
// `MUTATION_STRIKE_ROOT` points the self-mutation targets at a scratch copy so a test can
// rot an anchor and watch the refusal without putting a real file at risk — the same shape
// as `GATE_CONTENT_DIR` and `CI_STAGE_ORDER_ROOT`. Only the self-mutation families are
// remapped: the route walk splices by index into source it read from the route it walks, so
// its targets carry no text anchor that could rot.
const strikeRoot = process.env.MUTATION_STRIKE_ROOT
  ? resolve(process.env.MUTATION_STRIKE_ROOT)
  : root;
const strikeTarget = (file) =>
  strikeRoot === root ? file : join(strikeRoot, relative(root, file));

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const auditOnly = args.includes("--audit");
const anchorsOnly = args.includes("--anchors");
const vocabularyOnly = args.includes("--vocabulary");
const fileFilter = option("--file");
const limit = Number(option("--limit") ?? Infinity);
const baselineMode = args.includes("--baseline");
const writeBaseline = args.includes("--write-baseline");
const failOpen = !args.includes("--no-fail-open");

/** `--json` emits one machine-readable object (progress moves to stderr). */
const JSON_OUTPUT = args.includes("--json");

/** Progress output: stdout by default, stderr under `--json` so stdout stays clean. */
const log = JSON_OUTPUT ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts);

function option(name) {
  const hit = args.find((arg) => arg.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
}

function hash(text) {
  return createHash("sha1").update(text).digest("hex");
}

/** Every `route.ts` under `src/app`, depth-first. */
function walkRoutes(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRoutes(full, out);
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out;
}

/** The index of the delimiter matching the one at `openIndex`, skipping strings and comments. */
function matchDelimiter(source, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i, char);
      if (i === -1) return -1;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      if (newline === -1) return -1;
      i = newline;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of the closing quote for the string opening at `start`. */
function skipString(source, start, quote) {
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === quote) return i;
    if (quote !== "`" && source[i] === "\n") return -1; // an unterminated string
  }
  return -1;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

/** Whether this body is a refusal — the shape a guard's block has. */
function isRefusal(body) {
  return /errorResponse\s*\(/.test(body) || /status:\s*[45]\d\d/.test(body);
}

/** The message literals a guard's refusal is written with. */
function refusalMessages(body) {
  const out = [];
  const pattern = /(?:errorResponse|NextResponse\.json)\(\s*(["'`])([^"'`]*)\1/g;
  let match;
  while ((match = pattern.exec(body)) !== null) out.push(match[2]);
  return out;
}

/** Every `if` whose body refuses, with the span of its condition. */
function findGuards(source) {
  const guards = [];
  const pattern = /\bif\s*\(/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchDelimiter(source, open, "(", ")");
    if (close === -1) continue;
    const condition = source.slice(open + 1, close).replace(/\s+/g, " ").trim();

    let bodyStart = close + 1;
    while (bodyStart < source.length && /\s/.test(source[bodyStart])) bodyStart += 1;
    let bodyEnd;
    if (source[bodyStart] === "{") {
      const brace = matchDelimiter(source, bodyStart, "{", "}");
      if (brace === -1) continue;
      bodyEnd = brace + 1;
    } else {
      const semi = source.indexOf(";", bodyStart);
      bodyEnd = semi === -1 ? source.length : semi + 1;
    }

    const body = source.slice(bodyStart, bodyEnd);
    if (isRefusal(body)) {
      guards.push({
        open,
        close,
        condition,
        line: lineOf(source, match.index),
        messages: refusalMessages(body),
        // The refusal body's span, so a fail-open mutation can replace the whole
        // body with a success return whatever its shape (braced or one line).
        bodyStart,
        bodyEnd,
      });
    }
    pattern.lastIndex = bodyStart; // keep scanning inside the body for nested guards
  }
  return guards;
}

/**
 * Every `catch` clause, with the span of the whole clause (through its closing
 * brace). The promise `.catch(callback)` method is deliberately not matched: it
 * is followed by an arrow or a function reference, never a brace, so the pattern
 * requires `{` after the optional parameter list.
 */
function findCatches(source) {
  const catches = [];
  const pattern = /\bcatch\s*(?:\(([^)]*)\))?\s*\{/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const braceStart = pattern.lastIndex - 1; // the `{` the match ended on
    const braceEnd = matchDelimiter(source, braceStart, "{", "}");
    if (braceEnd === -1) continue;
    const body = source.slice(braceStart + 1, braceEnd);
    // A bare `catch {` gets a parameter so the rethrow can name it.
    const param = (match[1] ?? "").trim() || "err";
    catches.push({
      start: match.index,
      end: braceEnd + 1,
      line: lineOf(source, match.index),
      condition: "catch",
      messages: refusalMessages(body),
      text: `catch (${param}) { throw ${param}; }`,
    });
    pattern.lastIndex = braceStart; // keep scanning inside for nested catches
  }
  return catches;
}

/** Runs one test file and answers which of its tests failed. */
function runTest(testPath) {
  const reportPath = join(root, ".freebuff", ".mutation-report.json");
  if (existsSync(reportPath)) unlinkSync(reportPath);

  const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", relative(root, testPath), "--reporter=json", `--outputFile=${reportPath}`],
    { cwd: root, encoding: "utf8" },
  );

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return { ok: false, inconclusive: true, failed: [], total: 0, stderr: result.stderr ?? "" };
  } finally {
    if (existsSync(reportPath)) unlinkSync(reportPath);
  }

  const failed = [];
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === "failed") failed.push(assertion.title ?? assertion.fullName ?? "(unnamed)");
    }
  }
  return {
    ok: report.numFailedTests === 0,
    inconclusive: false,
    failed,
    total: report.numTotalTests ?? 0,
  };
}

function label(path) {
  return relative(root, path).split("\\").join("/");
}

/**
 * Mutations of the shared test helpers, which the route walk cannot reach.
 *
 * Each entry rewrites test-only code so it stops asserting, then runs the file
 * named in `test` — the helper's own unit test, not a route test, because a
 * route test calling a no-op helper still passes. `find` must occur exactly
 * once; a drifted anchor is reported and refused rather than guessed at, so a
 * helper renamed out from under this list stops the sweep before it measures
 * anything instead of silently dropping the mutation.
 */
const helperFile = join(root, "src", "test", "expect-gated.ts");
const helperTest = join(root, "src", "test", "expect-gated.test.ts");

/** A mutation that turns the helper's body into a no-op, so it stops asserting. */
function noOp(name, find) {
  return { name, file: helperFile, find: `${find}\n`, replace: `${find}\n  return;\n`, test: helperTest };
}

const HELPER_MUTATIONS_ALL = [
  noOp(
    "expectGatedNone no-op",
    'export function expectGatedNone(kind: "reads" | "writes" | "deletes") {',
  ),
  noOp(
    "expectGatedRead no-op",
    "export function expectGatedRead(table: TableLike, gate: Gate = {}) {",
  ),
  noOp(
    "expectGatedUpdate no-op",
    "export function expectGatedUpdate(table: TableLike, gate: Gate = {}) {",
  ),
  noOp(
    "expectGatedInsert no-op",
    "export function expectGatedInsert(table: TableLike, gate: InsertGate = {}) {",
  ),
  noOp(
    "expectGatedDelete no-op",
    "export function expectGatedDelete(table: TableLike, gate: Gate = {}) {",
  ),
  // `locate` returning 0 (rather than the searched index) is the silent-pass
  // form: the helper stops finding the operation and pins the first one instead.
  {
    name: "locate always returns 0",
    file: helperFile,
    find: "function locate(tables: string[], name: string, nth: number): number {\n",
    replace: "function locate(tables: string[], name: string, nth: number): number {\n  return 0;\n",
    test: helperTest,
  },
  noOp("assertWhere no-op", "function assertWhere(actual: string, expected: Sql | Sql[], table: string) {"),
  noOp("assertFirst no-op", "function assertFirst(index: number, name: string, kind: string) {"),
  noOp(
    "expectGatedSequence no-op",
    'export function expectGatedSequence(\n  kind: "reads" | "deletes" | "writes",\n  expected: WriteExpectation[],\n) {',
  ),
  // The exact-empty branch is the one place `toContain` is deliberately *not*
  // used, because `toContain("")` passes for any predicate at all. Rewriting
  // `toBe` as `toContain` there makes `where: ""` assert nothing — the silent
  // pass this entry hunts, and the one a route test cannot reach, since a route
  // only pairs `where: ""` with a read that really is unfiltered.
  {
    name: 'assertWhere treats `where: ""` as a substring match',
    file: helperFile,
    find: `  if (expected === "") {
    expect(actual, \`the \\\`where\\\` of \${table}\`).toBe("");
    return;
  }
`,
    replace: `  if (expected === "") {
    expect(actual, \`the \\\`where\\\` of \${table}\`).toContain("");
    return;
  }
`,
    test: helperTest,
  },
];

/**
 * The family as this run uses it. `--file` narrows what is *run*; the anchor check reads the
 * `_ALL` list above, so a slice that swept none of a family still refuses a strike whose
 * anchor left the file, the same way the audit below reads the detectors whole.
 */
const HELPER_MUTATIONS = HELPER_MUTATIONS_ALL.filter(
  (mutation) => !fileFilter || label(mutation.file).includes(fileFilter),
);

/**
 * Mutations of the convention-guard detectors, which the route walk cannot reach
 * either.
 *
 * Every one of these guards reads a file's *source* and refuses a shape no rendered
 * test can see, and each was written where it applies with its own fixture. The
 * fixture is the one place its author would not think to distrust, so the detectors
 * were split out into `convention-guards.ts` and `convention-guards.test.ts` drives
 * them all against a forbidden shape and a clean one. That meta-test is what proves a
 * detector *fires* — but a proof is only a proof while the test that holds it actually
 * fails when the detector goes dark, and a detector that stops catching is precisely
 * the change a green suite cannot show.
 *
 * There are two depths here, because the two ways a detector can go quiet are not the
 * same failure and are not noticed by the same file.
 *
 *   - **the whole detector** (`neuter` below). The body returns before it looks at
 *     anything — `return []`, or `return null` for `cleanupProblem`, whose clean answer
 *     is the absence of a problem — so the detector reports nothing at all.
 *     `convention-guards.test.ts` catches it on its forbidden fixture, which is the
 *     blunt case: a detector that has stopped catching anything.
 *   - **one limb** (`limb` below). A single comparison inverted, one name struck from a
 *     vocabulary, one gate narrowed. The detector still fires on the shape the fixture
 *     states, so the meta-test's `length > 0` is satisfied and a whole-detector check
 *     calls it healthy; what notices is the *other* guard test, the one that pins that
 *     limb's own answer. The beat-seam detector is what made this concrete: its three
 *     limbs all fire on one fixture, so limbs 1 and 3 can go dark with the meta-test
 *     still green, and only `beat-seams.test.ts` — which asserts the exact reason each
 *     limb reports — sees it. Those entries name that file in `test`.
 *
 * A survivor at either depth means the test named in `test` no longer notices its
 * detector going quiet there, so the rule it documents is enforced by nothing. `find`
 * must occur exactly once, for the same reason as the helpers above: a detector renamed
 * out from under this list is reported and refused, not guessed at — and for a limb that
 * matters more, since these anchors are single lines a rewrite passes through.
 */
const conventionsFile = join(root, "src", "test", "convention-guards.ts");
const conventionsTest = join(root, "src", "test", "convention-guards.test.ts");
const beatSeamsTest = join(root, "src", "test", "beat-seams.test.ts");
const renderTest = join(root, "src", "test", "render.test.ts");
// The client-bundle guard lives in `client-env.test.ts` — it walks the real module graph,
// so its fixtures are the tree itself rather than a string in a registry.
const clientEnvTest = join(root, "src", "test", "client-env.test.ts");

/**
 * A mutation that neuters one detector, by inserting a return before its body.
 *
 * `name` must begin with the guard's id and a colon (`mount: …`). `convention-guards.test.ts`
 * reads these back from `--list` and ratchets them against the registry, so a guard added
 * without an entry fails the suite instead of sitting outside the sweep — which is why the
 * id has to be readable from the name and not only from the anchor below it.
 */
function neuter(name, signature, replacement) {
  return {
    name,
    file: conventionsFile,
    find: `${signature}\n`,
    replace: `${signature}\n  ${replacement}\n`,
    test: conventionsTest,
    kind: "convention",
  };
}

/**
 * A mutation that takes away one *limb* of a detector and leaves the rest of it
 * standing: a comparison inverted, a name struck from a vocabulary, a gate narrowed.
 *
 * The anchor is an exact fragment rather than a signature, so it is the first thing a
 * rewrite of the detector drifts through — which is why the exactly-once check is worth
 * more here than anywhere else in this file.
 *
 * `test` is whichever guard test pins that limb, defaulting to the meta-test — the one
 * that holds the forbidden/clean pair a detector's whole predicate is read against. For
 * the beat-seam detector it is `beat-seams.test.ts` instead, because the meta-test cannot
 * separate the limbs: all three fire on its one fixture, and "something fired" is not the
 * same assertion as "this limb fired, for this reason".
 */
function limb(name, { find, replace, test = conventionsTest }) {
  return { name, file: conventionsFile, find, replace, test, kind: "convention", limb: true };
}

const CONVENTION_MUTATIONS_ALL = [
  neuter(
    "mount: the detector flags no raw mount",
    "export function rawMountCalls(source: string): number[] {",
    "return [];",
  ),
  neuter(
    "settle: the detector flags no assertion after a sleep",
    "export function settlesWithoutWait(source: string): number[] {",
    "return [];",
  ),
  neuter(
    "body-clear: the detector finds no cleanup problem",
    "export function cleanupProblem(source: string): CleanupProblem | null {",
    "return null;",
  ),
  neuter(
    "stylesheet: the detector flags no unlayered colour rule",
    "export function unlayeredColourOffenders(css: string): string[] {",
    "return [];",
  ),
  neuter(
    "runbook: the detector reports no Contents drift",
    "export function contentsDrift(source: string): string[] {",
    "return [];",
  ),
  neuter(
    "beat-seam: the detector flags no per-beat seam",
    "export function imperativeBeatSeams(source: string): string[] {",
    "return [];",
  ),
  neuter(
    "beat-clock: the detector flags no surface-owned clock",
    "export function surfaceOwnedClocks(source: string): string[] {",
    "return [];",
  ),
  neuter(
    "client-env: the detector reads no environment names at all",
    "export function serverEnvReads(source: string): string[] {",
    "return [];",
  ),
  neuter(
    "public-vocabulary: the detector flags no credential carried by a public name",
    "export function publicSecretNames(source: string): string[] {",
    "return [];",
  ),
  neuter(
    "client-config: the detector flags no value inlined into the client bundle",
    "export function inlinedClientValues(source: string): string[] {",
    "return [];",
  ),
  neuter(
    "stale-stage-lists: the detector flags no stale stage list",
    "export function staleStageLists(source: string, canonicalOrder: string[]): number[] {",
    "return [];",
  ),

  // One limb at a time, which is the drift a fixture-per-guard meta-test cannot see.
  //
  // The three beat-seam limbs come first, each weakened alone. `beat-seams.test.ts`
  // pins them because it asserts the exact reason a detector reports, so a limb that
  // goes dark changes the *reason* (or drops the finding) and the case fails; the
  // meta-test, which only asks that something was reported, stays green through two of
  // the three. These are the entries that would have survived the first pass of this
  // check, which is the whole reason it now has a second depth.
  limb("beat-seam: the callback vocabulary loses the name the limb was written for", {
    find: '  "onTick",\n',
    replace: "",
    test: beatSeamsTest,
  }),
  limb("beat-seam: the step limb stops seeing a callback that was renamed out of it", {
    find: "      if (!callbacks.has(text)) continue;\n",
    replace: "      if (!BEAT_CALLBACK_NAMES.has(text)) continue;\n",
    test: beatSeamsTest,
  }),
  limb("beat-seam: the return limb stops reading the walk it hands back", {
    find: 'const BEAT_RUNNER_NAMES = new Set(["tick", "step", "advance", "rotate", "pulse"]);\n',
    replace: 'const BEAT_RUNNER_NAMES = new Set(["tick", "step", "rotate", "pulse"]);\n',
    test: beatSeamsTest,
  }),
  // The other end of the same beat: the surface-side detector's clock vocabulary,
  // narrowed to the interval. `beat-seams.test.ts` pins the frame loop as a clock, so
  // dropping `requestAnimationFrame` is visible there and nowhere else.
  limb("beat-clock: the frame loop stops counting as a clock", {
    find: 'const CLOCK_METHODS = new Set(["setInterval", "requestAnimationFrame"]);\n',
    replace: 'const CLOCK_METHODS = new Set(["setInterval"]);\n',
    test: beatSeamsTest,
  }),
  // …and the gate that decides *which* modules this detector is asked of at all, which is
  // the negative half of the rule: only a module that names the carousel family is scanned,
  // so the components that legitimately animate — a canvas painting frames, a typing
  // indicator breathing — are left alone. Drop the gate and the rule silently widens to "any
  // component that owns a clock", which the meta-test cannot see (its forbidden fixture
  // mounts the carousel, so the clock there is reported either way) while `beat-seams.test.ts`
  // catches it from several directions: the whole-components scan, the real-tree control, and
  // the same control with the refused shape patched into it. So this one should read with a
  // margin rather than as a thin one, and that is what it is here to show.
  limb("beat-clock: the carousel gate is dropped, so every component with a clock is scanned", {
    find: "  if (!tokens.some((token) => AMBIENT_HOOK_NAMES.has(token.text))) return [];\n",
    replace: "",
    test: beatSeamsTest,
  }),
  // A rule stated as one predicate, turned around. Each inversion is wrong in both
  // directions at once, so the meta-test's forbidden half fails — the detector stops
  // reporting the shape it exists for — and its clean half fails beside it, which is the
  // run's report of the fact rather than a claim made here: four of these five fail 2 of
  // the 5 cases. The last two are the ones that go *over*-broad instead: `settle`'s
  // negation flagging the `waitFor` that replaced the sleep, and `mount` losing the
  // boundary that keeps `mountSurface(` out of the bare-mount regex, which is what makes
  // `leaves its clean shape alone` — and only that case — fail. No mutation exercised
  // the clean half before these entries, so the assertion that a detector still *leaves
  // the fix alone* was the half of the meta-test with nothing behind it.
  limb("body-clear: the ordering comparison is inverted", {
    find: "  return clearAt !== -1 && clearAt < cleanupAt;\n",
    replace: "  return clearAt !== -1 && clearAt > cleanupAt;\n",
  }),
  limb("stylesheet: the layer comparison is inverted", {
    find: "    .filter((rule) => rule.layer === null)\n",
    replace: "    .filter((rule) => rule.layer !== null)\n",
  }),
  limb("runbook: the drift comparison is inverted", {
    find: "  if (actual === expected) return [];\n",
    replace: "  if (actual !== expected) return [];\n",
  }),
  limb("settle: the sleep check is inverted, so the wait that replaced it is flagged", {
    find: "    if (next < tokens.length && startsWithExpect(tokens, next)) {\n",
    replace: "    if (next < tokens.length && !startsWithExpect(tokens, next)) {\n",
  }),
  limb("mount: the boundary that keeps `mountSurface` out of the bare-mount regex is dropped", {
    find: "const RAW_MOUNT = /(?<![\\w$.])mount\\s*\\(/;\n",
    replace: "const RAW_MOUNT = /(?<![\\w$.])mount/;\n",
    test: renderTest,
  }),
  limb("mount: the member-call exclusion stops counting", {
    find: "const RAW_MOUNT = /(?<![\\w$.])mount\\s*\\(/;\n",
    replace: "const RAW_MOUNT = /(?<![\\w$])mount\\s*\\(/;\n",
    test: renderTest,
  }),
  limb("body-clear: the sweep of a copy of the body's children stops counting", {
    find: "    if (!bound.has(tokens[index].text)) continue;\n",
    replace: "    if (bound.has(tokens[index].text)) continue;\n",
    test: renderTest,
  }),
  limb("beat-seam: the callback option is asked only of a hook that owns a clock", {
    find: `  for (const name of callbacks) {
    if (BEAT_CALLBACK_NAMES.has(name)) seams.set(name, "is a per-beat callback option");
  }
`,
    replace: `  if (ownsRepeatingClock(tokens))
  for (const name of callbacks) {
    if (BEAT_CALLBACK_NAMES.has(name)) seams.set(name, "is a per-beat callback option");
  }
`,
    test: beatSeamsTest,
  }),
  limb("beat-seam: only an optional member counts as a function-typed declaration", {
    // Anchored with the line below it: `at += 1` after a `?` is also how the
    // client-environment walkers step over the optional chain, so the one-line form
    // no longer names a single decision.
    find: '  if (tokens[at]?.text === "?") at += 1;\n  if (tokens[at]?.text !== ":") return false;\n',
    replace: '  if (tokens[at]?.text !== "?") return false;\n  at += 1;\n  if (tokens[at]?.text !== ":") return false;\n',
    test: beatSeamsTest,
  }),
  // The client-environment family: three rules about what may reach a browser, and the
  // decisions inside them that the meta-test's one fixture cannot separate. That fixture is
  // a single `const x = env.NAME`, so a detector that had lost the *alias* limb — the way
  // this repo reads almost every one of its secrets — would still report it and still look
  // healthy. `client-env.test.ts` walks the real module graph instead, so each of these is
  // pinned against the tree the rule is about.
  limb("client-env: the module-scope alias of the environment object stops counting", {
    find: "      if (names === undefined) continue;\n",
    replace: "      continue;\n",
    test: clientEnvTest,
  }),
  limb("client-env: a name taken apart by destructuring stops counting", {
    find: '    if (tokens[index].text !== "=" || tokens[index - 1]?.text !== "}") continue;\n',
    replace: "    continue;\n",
    test: clientEnvTest,
  }),
  limb("client-env: the `import.meta.env` spelling stops counting", {
    find: '  if (tokens[index]?.text !== "import") return -1;\n',
    replace: "  return -1;\n",
    test: clientEnvTest,
  }),
  limb("client-env: the bracket spelling of a read stops counting", {
    find: '  if (tokens[at]?.text === "[") {\n',
    replace: "  if (false) {\n",
    test: clientEnvTest,
  }),
  limb("client-env: the client boundary stops being read off the directive", {
    find: '  return first !== undefined && stringLiteral(first.text) === "use client";\n',
    replace: '  return first !== undefined && stringLiteral(first.text) === "use server";\n',
    test: clientEnvTest,
  }),
  limb("public-vocabulary: a whole credential word drops out of the vocabulary", {
    find: '  "SECRET",\n',
    replace: "",
    test: clientEnvTest,
  }),
  limb("public-vocabulary: the segment boundaries are dropped, so a word inside a word counts", {
    find: '  `(?:^|_)(${PUBLIC_SECRET_WORDS.join("|")})(?=_|$)`,\n',
    replace: '  `(${PUBLIC_SECRET_WORDS.join("|")})`,\n',
    test: clientEnvTest,
  }),
  limb("client-config: a `define`/`env` value stops being read for environment names", {
    find: "              ...environmentReadsIn(tokens, entry.from, entry.to, aliases),\n",
    replace: "",
    test: clientEnvTest,
  }),
  limb("client-config: a published name stops being checked for a credential", {
    find: "      if (word !== null) {\n",
    replace: "      if (false) {\n",
    test: clientEnvTest,
  }),
  limb("client-config: the wholesale replacement of the environment stops counting", {
    find: "      if (ENVIRONMENT_OBJECT_KEY.test(entry.key)) {\n",
    replace: "      if (false) {\n",
    test: clientEnvTest,
  }),
  limb("beat-clock: the half of the carousel named by the vocabulary stops counting", {
    find: `const AMBIENT_HOOK_NAMES = new Set([
  "useAmbientCarousel",
  "useAmbientPlayback",
  "useCarouselRotation",
]);
`,
    replace: `const AMBIENT_HOOK_NAMES = new Set([
  "useAmbientCarousel",
  "useAmbientPlayback",
]);
`,
    test: beatSeamsTest,
  }),
  // The stage-order detector's one limb is the one the meta-test cannot see: its fixture *is* a
  // comment, so a detector that stopped stripping strings and code would still fire on it and
  // still look healthy. `ci-stage-order.test.ts` pins the other direction — a list inside a
  // string or in code reports nothing — and its tree-wide scan fails loudly if the reading ever
  // goes raw, because the suite's own fixture strings are out of order on purpose.
  limb("stale-stage-lists: the detector reads the whole file as if every line were commentary", {
    find: "  const lines = commentary(source).split(/\\r?\\n/);\n",
    replace: "  const lines = source.split(/\\r?\\n/);\n",
    test: join(root, "src", "test", "ci-stage-order.test.ts"),
  }),
];

/**
 * The family as this run uses it. `--file` narrows what is *run*, never the audit below: a
 * slice that swept none of the family would otherwise report every decision as un-struck.
 */
const CONVENTION_MUTATIONS = CONVENTION_MUTATIONS_ALL.filter(
  (mutation) => !fileFilter || label(mutation.file).includes(fileFilter),
);

/* -------------------------------------------------------------------------- */
/* The runner's own checks                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mutations of the answers the CI runner itself reports, which no route test and no
 * detector test can see.
 *
 * `.freebuff/ci.mjs` is where a run decides what to *say*: which files sit behind a
 * stage's key, which entries resolve to no file, which decision it would take and why.
 * Those answers are read by the runner's own tests and by nothing else — the position
 * the helpers and the detectors are in one and two files over. A check that has stopped
 * answering leaves a suite that still passes and a run that goes on vouching for a tree
 * nothing measured: the declaration is corrected here, and every walk in this file still
 * asserts what it always asserted while a glob that matches nothing keys nothing and says
 * nothing — which is how `wrangler.toml` sat behind a checkout that had moved to
 * `wrangler.jsonc`, both in `GLOBAL_FORCE` and in the preflight's `inputs`.
 *
 * Two entries are the two halves of one question, kept together because a reader who has one
 * usually wants the other: `forceAbsences` (the `GLOBAL_FORCE` entries that resolve to no file —
 * the half behind *every* key) and `inputAbsences` (the stage `inputs` that do, each row naming
 * the stage keying nothing through it). The third is the other kind of answer a run gives before
 * it measures anything: `stageOrderFindings`, which compares every copy of the stage order — the
 * generated lines and the lists in the prose, the tests and the workflow — to the stage
 * declarations, and whose emptiness is what lets a run start beside a lie about what it is about
 * to run. Three more are that audit's tree-wide half — the `--commentary` pass over every source
 * file's comments — three entries because the answer goes quiet three different ways: the walk
 * that finds no file to read, the reading that stops being comment-only (and starts refusing the
 * fixture strings the suite writes out of order on purpose), and the findings dropped wholesale.
 *
 * Each entry rewrites one check quiet and requires the runner's own suite to catch it, which for
 * the two key questions is `src/test/ci-runner.test.ts` and for the stage order is
 * `src/test/ci-stage-order.test.ts`. Those files are pages of subprocess runs rather than unit
 * tests of the checks, because each check is only visible through what a run reports, and it is
 * that report the tests hold. `find` must occur exactly once, for the same reason as the families above: a check
 * renamed out from under this list is reported and refused rather than guessed at. Like the
 * other two families the list answers to `--file`, so a slice that names no runner file runs
 * none of these.
 */
const runnerFile = join(root, ".freebuff", "ci.mjs");
const runnerTest = join(root, "src", "test", "ci-runner.test.ts");

/**
 * A mutation that stops one of the runner's reported answers, by returning an empty one.
 *
 * The suite that has to notice is `ci-runner.test.ts` by default, because the checks here are
 * only visible through the report a run prints. The one exception passes its own file: an answer
 * a run gives *before* it runs a stage — the stage-order refusal — is driven by
 * `ci-stage-order.test.ts`, which asks the runner in a subprocess for the same reason and reads a
 * different part of the report.
 */
function runnerQuiet(name, signature, replacement, test = runnerTest) {
  return {
    name,
    file: runnerFile,
    find: `${signature}\n`,
    replace: `${signature}\n  ${replacement}\n`,
    test,
    kind: "runner",
  };
}

const RUNNER_MUTATIONS_ALL = [
  runnerQuiet(
    "global-force: the runner reports no GLOBAL_FORCE entry that matches no file",
    "function forceAbsences(files) {",
    "return { absent: [], undeclared: [], revived: [] };",
  ),
  runnerQuiet(
    "dead-input: the runner reports no stage input that matches no file",
    "function inputAbsences(files) {",
    "return { rows: [], absent: [], undeclared: [], revived: [] };",
  ),
  runnerQuiet(
    "stage-order: the runner reports no copy of the stage order that disagrees with the table",
    "function stageOrderFindings(root = stageOrderRoot, watchGlobs = []) {",
    "return [];",
    join(root, "src", "test", "ci-stage-order.test.ts"),
  ),
  runnerQuiet(
    "commentary: the runner reports no stage-order claim written in the tree's commentary",
    "function stageCommentaryFindings(root, seen) {",
    "return { findings: [], scanned: 0 };",
    join(root, "src", "test", "ci-stage-order.test.ts"),
  ),
  runnerQuiet(
    "commentary-scan: the runner reads no source file's commentary for a stage-order claim",
    "function commentaryFiles(dir, out = []) {",
    "return out;",
    join(root, "src", "test", "ci-stage-order.test.ts"),
  ),
  runnerQuiet(
    "commentary-read: the commentary pass reads raw bytes, so a fixture string becomes a claim",
    "function commentary(source) {",
    "return source;",
    join(root, "src", "test", "ci-stage-order.test.ts"),
  ),
  runnerQuiet(
    "suite-failure: the runner names nothing that failed outside the test list",
    "function failureOutsideTests(report) {",
    "return { brokenSuites: [], unhandled: [] };",
  ),
  runnerQuiet(
    "parse-silence: the runner names no stage script it cannot parse",
    "async function unparsableScripts(stages) {",
    "return [];",
  ),
];

/** The family as this run uses it; see `HELPER_MUTATIONS` above for why the check is whole-file. */
const RUNNER_MUTATIONS = RUNNER_MUTATIONS_ALL.filter(
  (mutation) => !fileFilter || label(mutation.file).includes(fileFilter),
);

/* -------------------------------------------------------------------------- */
/* The shared lock's own answers                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mutations of the answers `.freebuff/mutation-lock.mjs` gives, which no route test, no
 * detector test and no runner test can see.
 *
 * The module is the one place a killed run's mutation is put back — or refused — and its
 * answers are read by four callers (the runner, which heals before its stages measure
 * anything, and the three checks that edit the tree) and held by one suite. That is the
 * position the helpers, the detectors and the runner are in one, two and three files over,
 * and the failure it hides is the sharpest of the four: recovery deciding *not* to put a
 * file back, or answering that the state it found is somebody else's edit, leaves the
 * weakened source on disk for the next run to measure as the real thing.
 *
 * The entries here are the answers that are easiest to lose without noticing, because
 * nothing about them is a claim a fixture can see: `absorbedStretch` returning `null` — "no
 * mutation is still in this file" — is a *quieter* answer than the one it replaces, so every
 * lock that is genuinely somebody else's edit still reads exactly as before. What notices is
 * the crash-safety suite, which seeds the state a leaked mutation leaves and requires the
 * refusal.
 *
 * One entry quiets the whole function, and the other quiets only its last, weakest answer:
 * the mutation's own inserted text, searched for once the region around it is gone. They are
 * two entries rather than one because those are two different losses. The first says the
 * check is off, and any case that reaches it fails. The second leaves the check looking
 * alive — the padded window still refuses a reformatted region — while the case it was added
 * for, a writer who rewrote the surrounding lines and kept the mutation, degrades to the
 * `differs from both` warning. Its anchor is the line that fallback starts at, so the
 * replacement goes in ahead of that fallback and the tiers above it still answer; a strike
 * anchored on a function's declaration could not tell the two apart. `find` must occur
 * exactly once, for the same reason as the families above: a function renamed out from under
 * this list is reported and refused rather than guessed at. Like the other families the list
 * answers to `--file`, so a slice that names no lock file runs none of these.
 */
const lockFile = join(root, ".freebuff", "mutation-lock.mjs");
const lockTest = join(root, "src", "test", "mutation-sweep-recovery.test.ts");

/**
 * A mutation that stops one of the recovery's answers, by returning an empty one.
 *
 * The anchor is the line the statement goes after, so a strike can quiet a whole function
 * (`function f(...) {`) or stop at one answer inside it and leave the answers above it
 * standing — which is what separates "the check is off" from "its last, weakest way of
 * finding a mutation is off".
 */
function lockQuiet(name, signature, replacement, test = lockTest) {
  return {
    name,
    file: lockFile,
    find: `${signature}\n`,
    replace: `${signature}\n  ${replacement}\n`,
    test,
    kind: "lock",
  };
}

const LOCK_MUTATIONS_ALL = [
  lockQuiet(
    "absorbed: the lock reports no file that still carries the mutation it recorded",
    "function absorbedStretch(entry, content) {",
    "return null;",
  ),
  lockQuiet(
    "absorbed-inserted: the lock stops finding the mutation by its inserted text alone",
    "  const inserted = flatten(splice.inserted);",
    "return null;",
  ),
];

/** The family as this run uses it; see `HELPER_MUTATIONS` above for why the check is whole-file. */
const LOCK_MUTATIONS = LOCK_MUTATIONS_ALL.filter(
  (mutation) => !fileFilter || label(mutation.file).includes(fileFilter),
);

/* -------------------------------------------------------------------------- */
/* The declared-table ratchet's own hold                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mutations of the ratchet every mutation table answers to — `holdDeclaredTable` in
 * `src/test/declared-strikes.ts` — which none of the five families above can see, because
 * they are the tables it holds.
 *
 * The ratchet is where the other families' declarations are read: it compares a table's names
 * to its declaration both ways and pins each declared anchor to exactly one occurrence in the
 * file the strike splices into. That position makes its own failure the quietest in the sweep.
 * A `holdDeclaredTable` that stops holding — or returns before it compares anything — leaves
 * *every* generated case passing over two lists that were never held, so a strike deleted from
 * any table reads exactly like a strike that is still there. Nothing about the green suite says
 * which it is.
 *
 * What makes the loss visible is a control in the ratchet's own suite: `declared-strikes.test.ts`
 * hands `holdDeclaredTable` a disagreement at each layer it holds — the names it compares and the
 * anchor it reads out of the file — and requires it to throw. That case is what this strike is
 * aimed at, and it is the only case that notices: the generated per-table cases pass vacuously
 * under the mutation, exactly as they would under the real rot. So this entry is load-bearing only
 * while that control is, which is the point — remove the control and the strike survives, which is
 * the break the control exists to make loud.
 *
 * One entry, because the ratchet is one function; a limb-level break (the name comparison, the
 * anchor read) is already reached by the control's other two assertions. `find` must occur exactly
 * once, for the same reason as the families above.
 */
const ratchetFile = join(root, "src", "test", "declared-strikes.ts");
const ratchetTest = join(root, "src", "test", "declared-strikes.test.ts");

/**
 * A mutation that stops the ratchet holding, by returning before it compares anything.
 *
 * The anchor is the function's declaration line, so the statement quiets the whole function; a
 * limb-level break is a different entry, not a different anchor.
 */
function ratchetQuiet(name, signature, replacement, test = ratchetTest) {
  return {
    name,
    file: ratchetFile,
    find: `${signature}\n`,
    replace: `${signature}\n  ${replacement}\n`,
    test,
    kind: "ratchet",
  };
}

const RATCHET_MUTATIONS_ALL = [
  ratchetQuiet(
    "ratchet: the declared-table hold returns before it compares anything",
    "export function holdDeclaredTable(table: DeclaredTable): void {",
    "return;",
  ),
];

/** The family as this run uses it; see `HELPER_MUTATIONS` above for why the check is whole-file. */
const RATCHET_MUTATIONS = RATCHET_MUTATIONS_ALL.filter(
  (mutation) => !fileFilter || label(mutation.file).includes(fileFilter),
);

/* -------------------------------------------------------------------------- */
/* What no strike reaches                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The detector file with its strings and comments blanked.
 *
 * A decision has to be read out of the code, not out of the prose around it: this file
 * documents itself heavily, and a doc line that mentions `return []` is not a decision. A
 * string keeps its quotes and loses its contents (a decision may compare against `""`); a
 * comment loses everything. A `${…}` substitution inside a template is not entered — the
 * same approximation `tokenize` in `src/test/source-scan` states — which is enough for a
 * file that writes its templates on one line.
 */
function codeView(source) {
  const out = source.split("");
  let state = "code";
  let quote = "";
  const blank = (at) => {
    if (out[at] !== undefined && source[at] !== "\n") out[at] = " ";
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (state === "code") {
      if (ch === "/" && source[i + 1] === "/") {
        blank(i);
        blank(i + 1);
        state = "line";
        i += 1;
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        blank(i);
        blank(i + 1);
        state = "block";
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        state = "string";
        quote = ch;
      }
      continue;
    }
    if (state === "line") {
      if (ch === "\n") state = "code";
      else blank(i);
      continue;
    }
    if (state === "block") {
      if (ch === "*" && source[i + 1] === "/") {
        blank(i);
        blank(i + 1);
        state = "code";
        i += 1;
        continue;
      }
      blank(i);
      continue;
    }
    if (ch === "\\") {
      i += 1;
      blank(i);
      continue;
    }
    if (ch === quote) {
      state = "code";
      quote = "";
      continue;
    }
    blank(i);
  }
  return out.join("");
}

/**
 * The shapes a strike can reach: an early answer, a predicate step, or a comparison that
 * *is* the answer. The mechanics that walk a token stream — `if (…) continue;` in a scanner —
 * are deliberately not decisions here: a strike per line of the walk would be noise, and the
 * rules are what these three shapes name.
 */
const DECISION_SHAPES = [
  /\breturn\s+(\[\]|null|true|false|"[^"]*"|'[^']*')\s*;?\s*$/,
  /\.(filter|some|every|map|includes|has)\s*\(/,
  /\breturn\b[^;]*(===|!==|<=|>=|<|>)/,
];

/** A module-level `const NAME = …`: the vocabulary or pattern a detector is written against. */
const RULE_TABLE = /^const [A-Z][A-Z_0-9]* = /;

/**
 * The body of every `function` in the file, by name and line.
 *
 * Braces are counted on the blanked view, so a brace a string, a comment or a template
 * substitution carries cannot open or close a body — which is why the view is built first. A
 * function whose body never returns to depth zero simply has no region, and the decisions in
 * it are reported without a name rather than with a wrong one.
 */
function functionRegions(view) {
  const regions = [];
  let open = null;
  view.forEach((text, index) => {
    const start = /^\s*(?:export\s+)?function\s+(\w+)/.exec(text);
    if (!open && start) open = { name: start[1], from: index + 1, depth: 0 };
    if (!open) return;
    for (const ch of text) {
      if (ch === "{") open.depth += 1;
      else if (ch === "}") {
        open.depth -= 1;
        if (open.depth === 0) {
          regions.push({ name: open.name, from: open.from, to: index + 1 });
          open = null;
          break;
        }
      }
    }
  });
  return regions;
}

/**
 * The decisions in the detector file that no limb strike reaches.
 *
 * A detector is a pile of decisions — a leading gate that decides *which* modules the rule
 * is asked of, a vocabulary of names it knows, a comparison that is the answer — and the
 * sweep is a pile of strikes at them. The two lists have gaps, and a gap is invisible from
 * either side: a neutered detector and a detector that lost one limb both read `caught`, so
 * nothing said that the beat-clock gate had never been struck *at all* until the strikes
 * behind those lines were read by hand. This is that reading, done every run.
 *
 * The whole-detector neuters are deliberately not counted as reaching a decision: one
 * replaces the detector's whole body, which moves every decision inside it at once, so it
 * cannot show which decision the tests actually pin. What is left is the honest list — the
 * rules only the neuter ever moves, and only together with everything else.
 *
 * Each entry names the function (or the table) the decision lives in rather than a guard id:
 * the file is laid out guard by guard, but the *function* is what a strike anchors, and the
 * name comes from the braces around the line rather than from a reading of the layout. The
 * registry below the detectors is not scanned — it maps guards to detectors, which its own
 * ratchet in `convention-guards.test.ts` checks.
 */
function unstruckRules() {
  const source = readFileSync(conventionsFile, "utf8");
  const lines = source.split("\n");
  const view = codeView(source).split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  // What each limb strike reaches, as the offset span its `find` rewrites: the lines that
  // span covers are the lines the strike can move.
  const spans = [];
  for (const mutation of CONVENTION_MUTATIONS_ALL) {
    if (!mutation.limb) continue;
    const from = source.indexOf(mutation.find);
    if (from !== -1) spans.push([from, from + mutation.find.length]);
  }
  const reachedBy = (from, to) => spans.some(([a, b]) => a < to && b > from);
  // A table is one decision however many lines it is written over — `BEAT_CALLBACK_NAMES`
  // writes its names across eight — so its span runs to the bracket that closes the list and a
  // strike *inside* the list reaches it. Everything else is the line it is written on, and a
  // `[` inside a regexp is not a list: only a `[` opened by `=` or `(` is.
  const spanOf = (index) => {
    const from = starts[index];
    const lineEnd = from + lines[index].length;
    if (!RULE_TABLE.test(view[index].trim())) return [from, lineEnd];
    const open = /(?:=|\()\s*\[/.exec(lines[index]);
    if (!open) return [from, lineEnd];
    const close = matchDelimiter(source, from + open.index + open[0].length - 1, "[", "]");
    return [from, close === -1 ? lineEnd : close + 1];
  };

  // Where a decision lives, for the label: the function whose braces contain it, or the
  // table it declares. "module scope" is a name that failed to resolve rather than a guess.
  const regions = functionRegions(view);
  const where = (index, text) => {
    const line = index + 1;
    const region = regions.find((item) => item.from <= line && line <= item.to);
    if (region) return region.name;
    const table = /^const ([A-Z][A-Z_0-9]*) = /.exec(text.trim());
    return table ? `const ${table[1]}` : "module scope";
  };

  // The registry is where the guards are *listed*, not where a rule lives.
  const registry = lines.findIndex((line) => /^\/\*\s+The registry/.test(line));

  const rules = [];
  let sites = 0;
  lines.forEach((text, index) => {
    if (registry !== -1 && index >= registry) return;
    const code = view[index].trim();
    if (!code) return;
    if (!RULE_TABLE.test(code) && !DECISION_SHAPES.some((shape) => shape.test(code))) return;
    sites += 1;
    if (reachedBy(...spanOf(index))) return;
    rules.push({ where: where(index, text), line: index + 1, code: text.trim().slice(0, 120) });
  });
  // The count of sites as well as the list: "43 of 55" is the coverage the sweep has at this
  // depth, which a bare `43` would leave a reader to work out from a file they would have to
  // open — the reading this exists to save.
  return { sites, rules };
}


/**
 * The detector strikes that take away one limb rather than the whole detector.
 *
 * A property of the list rather than of the report, so the count the header prints and
 * the `limbSelfMutations` field the JSON carries cannot come to mean different things.
 * Their survivors are reported apart from the whole-detector ones (see the summary
 * below), which is what lets a reader tell "this rule is enforced by nothing at all"
 * from "this rule lost one limb and the rest of it still bites".
 */
const narrowedConventions = CONVENTION_MUTATIONS.filter((mutation) => mutation.limb);

/**
 * All five families, run first and reported apart: the helper strikes, the detector
 * strikes, the runner's own checks, the shared lock's answers and the declared-table
 * ratchet's own hold are the same shape of claim (test-only or gate-side code weakened,
 * its own suite must notice) about five different parts of the test surface.
 */
const SELF_MUTATIONS = [
  ...HELPER_MUTATIONS,
  ...CONVENTION_MUTATIONS,
  ...RUNNER_MUTATIONS,
  ...LOCK_MUTATIONS,
  ...RATCHET_MUTATIONS,
];

// The same five families, unscoped. `--file` decides what this run *rewrites*, but a strike
// that no longer fits its target is a rot wherever the run was narrowed to, so the anchor
// check below reads this list: a scoped sweep may not report a pass while a strike in a
// family it skipped holds nothing.
const ALL_SELF_MUTATIONS = [
  ...HELPER_MUTATIONS_ALL,
  ...CONVENTION_MUTATIONS_ALL,
  ...RUNNER_MUTATIONS_ALL,
  ...LOCK_MUTATIONS_ALL,
  ...RATCHET_MUTATIONS_ALL,
];

// Which family a self-mutation belongs to, and what the report calls it.
//
// Derived once, from the entry rather than from the branch that reads it, so the survivor
// report, the JSON `kind`, the baseline and the anchor report below cannot come to disagree
// about which family a strike was — and the words are looked up rather than written out per
// family, so a family added to the sweep is named in the log instead of falling through to a
// neighbour's word.
//
// The words themselves are `STRIKE_WORDS` from the shared vocabulary module, imported above:
// declared once, where the preflight and coverage tables are declared too, so the two-way
// refusal and the suites' spelling pins come with them. The stamped half is the entries' —
// `limb` for a detector struck at one limb, the entry's own `kind` otherwise, `self` for a
// helper that names none — so `strikeKind` is the one place a stamp is resolved and that
// table the one place a word is declared.
const strikeKind = (mutation) => (mutation.limb ? "limb" : (mutation.kind ?? "self"));

// Before anything is read for the plan or rewritten, put back a file a previous,
// killed sweep left mutated: the lock is the only record of what it looked like.
const recovered = recoverInterruptedRun();

// The audit is read after the recovery above, not before: it reads the detector file, so a
// killed sweep's `false` left in that file would otherwise be audited as if it were the rule.
// (`--list` reads no file and can run earlier; this cannot.)
const audit = unstruckRules();
const unstruck = audit.rules;

if (auditOnly) {
  const header =
    `${label(conventionsFile)} — ${unstruck.length} of ${audit.sites} decision(s) reach no limb strike`;
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          mode: "audit",
          file: label(conventionsFile),
          sites: audit.sites,
          unstruck,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    log(header);
    for (const item of unstruck) log(`  ${item.where} (line ${item.line}) — ${item.code}`);
  }
  process.exit(0);
}

// `--anchors`: every self-mutation anchor, read against the file it splices into, with no
// strike run and no lock taken. The sweep already refuses when an anchor has left its target
// (see `unfittedStrikes` below), but that refusal is only reached by a full sweep — minutes of
// mutating and testing — so this is the cheap question asked on its own: does every strike
// still fit? It reads the families whole, like the audit above and the refusal below, so a
// `--file` that would run none of them cannot narrow the answer. A drifted anchor is exit 1,
// the same code the sweep's own refusal uses, so the two cannot disagree about what is red.
if (anchorsOnly) {
  const rows = anchorReport();
  const drifted = rows.filter((row) => row.status !== "fits");
  const files = new Set(rows.map((row) => row.path));
  const exitCode = drifted.length === 0 ? 0 : 1;

  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          mode: "anchors",
          strikes: rows.map((row) => ({
            path: row.path,
            name: row.mutation.name,
            // The family `strikeKind` resolves the entry to. The report already reads every
            // self-mutation whole, so it is where the vocabulary the sweep would *speak* is
            // observable without running a strike or parsing this file.
            kind: strikeKind(row.mutation),
            status: row.status,
            occurrences: row.occurrences,
          })),
          drifted: drifted.map((row) => row.where),
          gate: exitCode === 0 ? "pass" : "fail",
          exitCode,
        },
        null,
        2,
      )}\n`,
    );
    process.exit(exitCode);
  }

  log(
    `mutation-guards: ${rows.length} strike(s) against ${files.size} file(s) — every self-mutation anchor read, no strike run\n`,
  );
  for (const row of rows) {
    log(`  ${row.status === "fits" ? "ok      " : "DRIFTED "}  ${row.where}`);
    if (row.status !== "fits") {
      // The same builder the refusal reads, so the anchor reason is spelled one way
      // whatever mode reports it.
      for (const line of reasonLines(brokenSelf(row))) log(`            ${line}`);
    }
  }
  log(
    `\n${rows.length} strike(s): ${rows.length - drifted.length} fit the tree` +
      (drifted.length === 0
        ? "."
        : `, ${drifted.length} no longer fit — re-fit each anchor, or drop the strike and record why the check needs none.`),
  );
  if (drifted.length > 0) {
    console.error(
      `\nmutation-guards: ${drifted.length} strike(s) no longer fit the tree — the next sweep ` +
        "would refuse before its first strike; re-fit each anchor against the file it now has.",
    );
  }
  process.exit(exitCode);
}

// `--vocabulary`: every declared family beside the exact strikes that stamp it, with no strike
// run and no lock taken. The sweep already refuses when the declared words and the stamped kinds
// are not the same set (see `vocabularyAbsences`/`refuseStartUp` below), but that refusal is
// reached from a run that would otherwise strike, so this is the same question asked on its own —
// and the one place a hole is *readable* rather than merely named: each family is printed with
// the strikes that carry it, so a word no entry stamps has no strikes under it and an entry with
// no word shows up under its own undeclared heading. Read from the families whole, like the audit
// and the anchor report, so a `--file` cannot narrow what the vocabulary is checked against. A
// hole is exit 1, the same code the sweep's own refusal uses, so the two cannot disagree about
// what is red.
if (vocabularyOnly) {
  const families = strikeFamilies();
  const { unnamed, unspoken } = vocabularyAbsences();
  const holes = unnamed.length + unspoken.length;
  const exitCode = holes === 0 ? 0 : 1;

  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          mode: "vocabulary",
          families: [...families].map(([kind, entries]) => ({
            kind,
            declared: STRIKE_WORDS[kind] !== undefined,
            count: entries.length,
            strikes: entries.map((mutation) => ({
              path: label(mutation.file),
              name: mutation.name,
            })),
          })),
          unnamed: unnamed.map((mutation) => ({
            path: label(mutation.file),
            name: mutation.name,
            kind: strikeKind(mutation),
          })),
          unspoken: [...unspoken],
          gate: exitCode === 0 ? "pass" : "fail",
          exitCode,
        },
        null,
        2,
      )}\n`,
    );
    process.exit(exitCode);
  }

  log(
    `mutation-guards: strike vocabulary — ${Object.keys(STRIKE_WORDS).length} declared family(ies), ` +
      `${ALL_SELF_MUTATIONS.length} strike(s), ${families.size} kind(s) stamped\n`,
  );
  for (const [kind, entries] of families) {
    const word = STRIKE_WORDS[kind];
    log(
      `  ${word ? `"${kind}" (${word.pin})` : `"${kind}" — NO DECLARED WORD`}: ${entries.length} strike(s)`,
    );
    for (const mutation of entries) log(`      ${label(mutation.file)}  ${mutation.name}`);
  }
  log(
    holes === 0
      ? "\n  every declared word is stamped, and every strike stamps a declared word."
      : `\n  ${holes} vocabulary hole(s):`,
  );
  for (const mutation of unnamed) {
    log(
      `    UNNAMED   ${label(mutation.file)}  ${mutation.name} — it stamps kind ` +
        `"${strikeKind(mutation)}", which STRIKE_WORDS does not declare`,
    );
  }
  for (const word of unspoken) {
    log(
      `    UNSPOKEN  the "${word}" family — no entry stamps it, so nothing can ever be ` +
        "reported under it",
    );
  }
  if (holes > 0) {
    console.error(
      `\nmutation-guards: ${holes} vocabulary hole(s) — the next sweep would refuse before its ` +
        "first strike; add the missing word (with its `what` and `pin`), correct the entry's " +
        "kind, or drop the word nothing stamps.",
    );
  }
  process.exit(exitCode);
}

const routes = walkRoutes(appDir)
  .filter((path) => existsSync(join(dirname(path), "route.test.ts")))
  .filter((path) => !fileFilter || label(path).includes(fileFilter))
  .sort();

const plan = [];
for (const route of routes) {
  const source = readFileSync(route, "utf8");
  const guards = findGuards(source);
  guards.forEach((guard, index) =>
    plan.push({
      route,
      source,
      kind: "guard",
      index,
      count: guards.length,
      line: guard.line,
      condition: guard.condition,
      messages: guard.messages,
      descriptor: `if (${guard.condition})`,
      mutation: { start: guard.open + 1, end: guard.close, text: " false " },
    }),
  );
  // The success shape the fail-open mutation answers with. Nearly every route
  // imports `successResponse`; the rest get a bare `Response.json({})` so the
  // mutation needs no import it cannot add.
  const successExpr = /\bsuccessResponse\b/.test(source) ? "successResponse({})" : "Response.json({})";
  if (failOpen) {
    guards.forEach((guard, index) =>
      plan.push({
        route,
        source,
        kind: "failopen",
        index,
        count: guards.length,
        line: guard.line,
        condition: guard.condition,
        messages: guard.messages,
        descriptor: `if (${guard.condition}) [fail-open]`,
        // Replace the refusal body — braces and all — with a success return, so
        // the guard still fires but the route fails open.
        mutation: { start: guard.bodyStart, end: guard.bodyEnd, text: `{ return ${successExpr}; }` },
      }),
    );
  }
  const catches = findCatches(source);
  catches.forEach((clause, index) =>
    plan.push({
      route,
      source,
      kind: "catch",
      index,
      count: catches.length,
      line: clause.line,
      condition: clause.condition,
      messages: clause.messages,
      descriptor: "catch {...}",
      mutation: { start: clause.start, end: clause.end, text: clause.text },
    }),
  );
}

const guardCount = plan.filter((item) => item.kind === "guard").length;
const failOpenCount = plan.filter((item) => item.kind === "failopen").length;
const catchCount = plan.filter((item) => item.kind === "catch").length;

log("Route guard and catch mutation check");
log(`  routes with a neighbour test: ${routes.length}`);
log(`  guards found: ${guardCount} (each also mutated fail-open)`);
log(
  failOpen
    ? `  fail-open guard mutations: ${failOpenCount} (refusal body replaced with a success return)`
    : "  fail-open guard mutations: skipped (--no-fail-open)",
);
log(`  catch blocks found: ${catchCount} (mutated back into a rethrow)`);
log(    `  self-mutations: ${SELF_MUTATIONS.length} ` +
    `(${HELPER_MUTATIONS.length} test helper, ${CONVENTION_MUTATIONS.length} convention detector` +
    `, ${RUNNER_MUTATIONS.length} runner check, ${LOCK_MUTATIONS.length} shared-lock check` +
    `, ${RATCHET_MUTATIONS.length} declared-table ratchet; ` +
    `${narrowedConventions.length} of the detector strikes narrow one limb rather than the whole` +
    " detector)",
);
log("  (the working tree is edited and restored in place; run nothing else against it)");
log("");

if (listOnly) {
  for (const item of plan) {
    log(`${label(item.route)}:${item.line}  ${item.descriptor}`);
  }
  for (const mutation of SELF_MUTATIONS) {
    log(`${label(mutation.file)}  ${mutation.name}`);
  }
  process.exit(0);
}

const survived = [];
const survivedSelf = [];
// Every strike a test *did* notice, with the case that noticed it. The decision is
// still binary — one failing case is a caught mutation — but the margin behind it is
// not: a limb pinned by a single case is one edit away from going dark, and a bare
// count (`3/17`) cannot tell that apart from a limb the whole file answers. Recorded
// for the self-mutations only, because those are the ones whose reasons the report
// already names and whose margins vary run to run.
const caughtSelf = [];
let checked = 0;

// A run mutates a file for the duration of one test invocation. If the process
// is interrupted in that window, put the file back before going down — a killed
// check must not leave a `false` in the tree.
let active = null;
function restoreAndExit(signal) {
  if (active) {
    try {
      writeFileSync(active.path, active.original);
      console.error(`\n${signal}: restored ${label(active.path)} before exiting.`);
    } catch (error) {
      console.error(`\n${signal}: could NOT restore ${label(active.path)}: ${error.message}`);
      console.error(`The lock remains at ${label(LOCK_PATH)}; the next run will retry the restore.`);
      process.exit(130);
    }
  }
  clearLock();
  process.exit(130);
}
process.on("SIGINT", () => restoreAndExit("SIGINT"));
process.on("SIGTERM", () => restoreAndExit("SIGTERM"));

// A strike is a `find`/`replace` pair of exact strings spliced into a file. When a later
// edit renames the line a strike anchors on, its `find` no longer occurs and its `replace`
// never lands: the sweep runs on, every test passes, and the check the strike existed to
// hold is held by nothing — a gate that disappears without anyone lowering a number. It
// used to be a printed `?` line and exit 0. It is a refusal now, and it comes before the
// first strike, because a sweep that cannot apply its own strikes has not measured the
// tree it would otherwise vouch for — so it may not report on the part of it that did run
// either.
//
// Every anchor, read against the file it splices into, and the family the entry stamps beside
// it: the rows are the one place every self-mutation is enumerated with the `kind`
// `strikeKind` gives it, without a strike being run or the table being restated. `occurrences`
// is how many times the
// strike's `find` occurs there, and `status` names the answer: `fits` is the only healthy
// one, `missing` is a renamed anchor and `ambiguous` one too vague to say which line it
// means. Read from the unscoped families, so a narrowed run refuses a rot in a family it
// would not have run — and so `--anchors` above answers the same question this does.
function anchorReport() {
  return ALL_SELF_MUTATIONS.map((mutation) => {
    const source = readFileSync(strikeTarget(mutation.file), "utf8");
    const occurrences = source.split(mutation.find).length - 1;
    return {
      mutation,
      occurrences,
      where: `${label(mutation.file)}  ${mutation.name}`,
      path: label(mutation.file),
      status: occurrences === 1 ? "fits" : occurrences === 0 ? "missing" : "ambiguous",
    };
  });
}

/** The rows above, narrowed to the strikes that no longer fit — what the refusal acts on. */
function unfittedStrikes() {
  return anchorReport().filter((entry) => entry.status !== "fits");
}

/**
 * The declared words and the strikes that stamp each, plus any undeclared kind an entry uses.
 *
 * Built from `ALL_SELF_MUTATIONS` and `strikeKind` — the same two readers the survivor report
 * and the anchor rows use — so the listing is the vocabulary the sweep would *speak* rather than
 * a second copy of it. The declared words come first, in declaration order, so a family that no
 * entry stamps shows up as an empty list; an undeclared kind is kept under its own heading
 * rather than folded into a neighbour's, which is the whole point of reading it here.
 */
function strikeFamilies() {
  const families = new Map(Object.keys(STRIKE_WORDS).map((kind) => [kind, []]));
  for (const mutation of ALL_SELF_MUTATIONS) {
    const kind = strikeKind(mutation);
    if (!families.has(kind)) families.set(kind, []);
    families.get(kind).push(mutation);
  }
  return families;
}

/**
 * How the words the sweep declares and the kinds its entries stamp disagree.
 *
 * `STRIKE_WORDS` is the vocabulary every reader of a survivor speaks — the report looks a
 * family's words up (`STRIKE_WORDS[kind].what` and `.pin`), the `--json` survivor carries the
 * kind, and `ci.mjs` groups and counts by it — and it only holds while the set it declares and
 * the set the entries stamp are the same set. Either side can break on its own, and they fail
 * differently:
 *
 *   - `unnamed` — an entry stamps a kind no word covers. Every reader is then wrong at once:
 *     the report's own log line dereferences `undefined` and throws *mid-sweep*, after the tree
 *     has been edited and restored for every strike before it, and `ci.mjs` is handed a word it
 *     does not know and annotates the survivor as `SURVIVED (<kind>)`.
 *   - `unspoken` — a declared word no entry stakes a family of. Nothing throws, which is the
 *     quieter half and the reason it is worth naming: the report claims a family it never
 *     speaks, and `ci.mjs` carries a mark and a noun no survivor can ever reach.
 *
 * Read from the families whole, like the anchor refusal below, so a `--file` that would run
 * none of a family still refuses a hole in it: a family whose survivors cannot be named — or a
 * word whose family the sweep never strikes — is as broken as one whose strikes no longer fit.
 */
function vocabularyAbsences() {
  // The shared comparison answers in stamps (the shape the preflight and coverage refusals
  // read), and this refusal reads entries: the unnamed kinds are mapped back to the strikes
  // that stamp them, in the same first-seen order the comparison found them, so the refusal
  // can name the entry — its file and its name — rather than a bare kind.
  const { unnamed, unspoken } = vocabularyHolesOf(
    STRIKE_WORDS,
    ALL_SELF_MUTATIONS.map((mutation) => strikeKind(mutation)),
  );
  return {
    unnamed: ALL_SELF_MUTATIONS.filter((mutation) => unnamed.includes(strikeKind(mutation))),
    unspoken,
  };
}

/**
 * The reason vocabulary, one spelling per reason: `reasonLines` builds the words the report
 * prints from the survivor object the `--json` payload carries, so the two cannot come to
 * mean different things. The start-up refusal, the `--anchors` report and the end-of-run
 * survivor buckets all read these builders — a reason re-phrased at one of them is a
 * disagreement the cases red rather than two truthful-sounding sentences. The anchor
 * sentence is spelled once, in `brokenSelf.detail`; this reads it back from the survivor
 * (`reason: "anchor"` marks it) rather than holding a second copy of the words.
 */
function reasonLines(entry) {
  switch (entry.kind) {
    case "broken":
      if (entry.reason === "anchor") return [entry.detail];
      return [entry.detail];
    default:
      return [entry.detail ?? entry.descriptor];
  }
}

/** A broken strike as the survivor-shaped entry the report and `--json` already speak. */
function brokenSelf(entry) {
  return {
    path: label(entry.mutation.file),
    line: null,
    kind: "broken",
    descriptor: entry.mutation.name,
    where: entry.where,
    total: null,
    masked: true,
    named: [],
    // Why it cannot be applied: the reason word the refusal reads (`reasonLines`) plus the
    // numbers the sentence interpolates, so the report and the payload print one spelling.
    reason: "anchor",
    occurrences: entry.occurrences,
    detail: `its anchor occurs ${entry.occurrences} time(s), expected exactly 1`,
  };
}

// The one refusal: every reason the sweep may not begin — a strike that cannot be applied, or a
// vocabulary the entries and `STRIKE_WORDS` disagree over — gathered into one report and one exit.
// The reasons are computed together rather than one at a time so a run is told the whole of it: a
// run that fixed the one it was told, re-ran, and was told the next would have had to guess how
// many there were, which is exactly the reading a refusal exists to save.
//
// It exits, because a sweep that cannot apply its own strikes — or cannot name its own survivors —
// has not measured the tree, and a run that named the breaks and went on would be vouching for the
// part it did. Under `--json` it writes the survivor object a consumer already knows — every reason
// as a `broken` survivor, `checked: 0`, `gate: "fail"` — rather than crashing with no report, so the
// runner names the reason instead of a parse failure. The mid-loop guard shares it: a target that
// moved under a run between the anchor check and its own strike is the same refusal reached from
// another place, so the two cannot drift into saying different things.
function refuseStartUp({ unnamed = [], unspoken = [], unfitted = [] }) {
  const reasons = [
    ...unnamed.map(unnamedSelf),
    ...unspoken.map(unspokenSelf),
    ...unfitted.map(brokenSelf),
  ];
  if (JSON_OUTPUT && !writeBaseline && !baselineMode) {
    process.stdout.write(`${JSON.stringify(jsonPayload(reasons, 1), null, 2)}\n`);
  }
  log("");
  log(
    `START-UP REFUSAL (${reasons.length}) — this run strikes nothing until every reason below is repaired:`,
  );
  if (unnamed.length > 0 || unspoken.length > 0) {
    log("");
    log(
      `  VOCABULARY HOLES (${unnamed.length + unspoken.length}) — the words the sweep declares and the kinds its strikes stamp are not the same set:`,
    );
    for (const mutation of unnamed) {
      const survivor = unnamedSelf(mutation);
      log(`    - ${survivor.where}`);
      for (const line of reasonLines(survivor)) log(`      ${line}`);
    }
    for (const word of unspoken) {
      const survivor = unspokenSelf(word);
      log(`    - ${survivor.where}`);
      for (const line of reasonLines(survivor)) log(`      ${line}`);
    }
  }
  if (unfitted.length > 0) {
    log("");
    log(
      `  UNCHECKED STRIKES (${unfitted.length}) — the sweep's own strikes, which no longer fit the files they rewrite:`,
    );
    for (const entry of unfitted) {
      log(`    - ${entry.where}`);
      for (const line of reasonLines(brokenSelf(entry))) log(`      ${line}`);
    }
  }
  console.error(
    `\nmutation-guards: ${reasons.length} start-up refusal(s) — the sweep refuses before its first ` +
      "strike, so it never measures a tree it cannot fully hold. Re-fit every strike that no " +
      "longer fit the tree so its anchor occurs exactly once, and close every vocabulary hole(s): " +
      "the declared words and the stamped kinds must be the same set. A strike that cannot be " +
      "applied, or a survivor that cannot be named, leaves its check held by nothing while every " +
      "test stays green.",
  );
  process.exit(1);
}

/** An entry that stamps an undeclared kind, in the survivor shape the report already speaks. */
function unnamedSelf(mutation) {
  return {
    path: label(mutation.file),
    line: null,
    kind: "broken",
    descriptor: mutation.name,
    where: `${label(mutation.file)}  ${mutation.name}`,
    total: null,
    masked: true,
    named: [],
    detail: `it stamps kind "${strikeKind(mutation)}", which STRIKE_WORDS does not declare`,
  };
}

/** A declared word no entry stamps, in the same shape, at the sweep's own file. */
function unspokenSelf(word) {
  return {
    path: label(fileURLToPath(import.meta.url)),
    line: null,
    kind: "broken",
    descriptor: `the "${word}" family`,
    where: `STRIKE_WORDS  the "${word}" family`,
    total: null,
    masked: true,
    named: [],
    detail: "STRIKE_WORDS declares it, and no entry stamps it, so nothing can ever be reported under it",
  };
}

// Everything that stops the sweep before its first strike, gathered in one place: the vocabulary
// the entries and `STRIKE_WORDS` disagree over, and the strikes that no longer fit the tree. Both
// halves read the families whole, so a `--file` that would run none of a family still refuses a
// hole in it. The vocabulary is read first only because it is the sweep's own declaration, before
// the anchor check reads the tree; whatever comes back is named by the refusal, all of it at once.
function startUpRefusals() {
  return { ...vocabularyAbsences(), unfitted: unfittedStrikes() };
}

const refusals = startUpRefusals();
if (refusals.unnamed.length > 0 || refusals.unspoken.length > 0 || refusals.unfitted.length > 0) {
  refuseStartUp(refusals);
}

// The helper self-mutations run first: they are few and fixed, the route guards
// are many and sliced by `--limit`, and a survivor among the helpers is the
// sharper failure — it means every test that calls the helper is asserting less
// than it looks like it does.
for (const mutation of SELF_MUTATIONS) {
  checked += 1;
  const target = strikeTarget(mutation.file);
  const original = readFileSync(target, "utf8");
  const occurrences = original.split(mutation.find).length - 1;
  const where = `${label(mutation.file)}  ${mutation.name}`;

  // Unreachable after the check above unless the tree moved under this run between the two
  // reads; the refusal is the same refusal either way.
  if (occurrences !== 1) refuseStartUp({ unfitted: [{ mutation, occurrences, where }] });

  const mutated = original.replace(mutation.find, mutation.replace);
  const mutatedHash = hash(mutated);
  writeLock({ check: "guard sweep", path: target, kind: "self", where, original, mutated });
  // The save a strike is allowed to take. A splice that would unbalance a *pinned* target is
  // a broken strike rather than a guard to break — the test would fail to load it, and a
  // load failure reads exactly like a caught strike. The lock goes back because nothing was
  // written, so a refusal leaves the tree as found.
  try {
    saveWholeScript(target, mutated);
  } catch (error) {
    clearLock();
    console.error(`\nguard sweep: ${error.message}`);
    console.error("Re-fit this strike; nothing was mutated.");
    process.exit(1);
  }
  active = { path: target, original };
  let outcome;
  try {
    outcome = runTest(mutation.test);
  } finally {
    const current = readFileSync(target, "utf8");
    if (hash(current) !== mutatedHash) {
      console.error(
        `\nSTOP: ${label(mutation.file)} changed underneath the check; left as it is now. ` +
          "The mutation may have been absorbed into the new content rather than replaced — " +
          "inspect it by hand before trusting this file.",
      );
      process.exit(2);
    }
    writeFileSync(target, original);
    if (hash(readFileSync(target, "utf8")) !== hash(original)) {
      console.error(`\nSTOP: could not restore ${label(mutation.file)}.`);
      process.exit(2);
    }
    clearLock();
    active = null;
  }

  if (outcome.inconclusive) {
    log(`[${checked}] ?          ${where}`);
    log("             the test run produced no report; read it by hand");
  } else if (outcome.ok) {
    const kind = strikeKind(mutation);
    survivedSelf.push({
      where,
      path: label(mutation.file),
      name: mutation.name,
      test: label(mutation.test),
      total: outcome.total,
      // Which family — and, for a detector, which depth — the survivor belongs to, so a
      // neutered detector reads apart from a no-op helper, a check in the runner reads
      // apart from both, and a limb that went dark reads apart from a detector that
      // reports nothing at all, in the report below, in the baseline, and in the `kind`
      // `ci.mjs` groups its stage summary and its annotations by (`convention` is the
      // whole detector, `limb` is one of its limbs, `runner` is the runner's own check).
      kind,
    });
    log(`[${checked}] SURVIVED   ${where}`);
    log(`             all ${outcome.total} tests passed with ${STRIKE_WORDS[kind].what} disabled`);
    log(`             ${label(mutation.test)} does not pin this ${STRIKE_WORDS[kind].pin}`);
  } else {
    caughtSelf.push({
      where,
      path: label(mutation.file),
      name: mutation.name,
      test: label(mutation.test),
      // The depth this strike reached, the same word the survivor report and `ci.mjs`
      // group by: `convention` is the whole detector, `limb` is one of its limbs,
      // `runner` is a check in the runner itself.
      kind: strikeKind(mutation),
      total: outcome.total,
      caughtBy: outcome.failed,
    });
    log(`[${checked}] caught     ${where}`);
    // Named, not counted: "caught by 3 of 17" says which cases failed and how much of
    // the file stands behind the strike, where a bare "3/17 failed" leaves a reader to
    // work out that those names *are* the answer to "what noticed this".
    log(
      `             caught by ${outcome.failed.length} of ${outcome.total}: ${outcome.failed.join("; ")}`,
    );
  }
}

for (const item of plan.slice(0, limit)) {
  checked += 1;
  const { route, source, mutation, kind } = item;
  const testPath = join(dirname(route), "route.test.ts");
  const original = source;
  const mutated = `${source.slice(0, mutation.start)}${mutation.text}${source.slice(mutation.end)}`;
  const mutatedHash = hash(mutated);
  const noun = kind === "catch" ? "catch block" : kind === "failopen" ? "guard (fail-open)" : "guard";
  const where = `${label(route)}:${item.line}  ${item.descriptor}`;

  writeLock({ check: "guard sweep", path: route, kind, where, original, mutated });
  // The same save as the self family. A route is not a pinned gate script, so this writes it
  // exactly as `writeFileSync` did; the call is uniform so the two families cannot drift into
  // one that is held to the check and one that is not.
  try {
    saveWholeScript(route, mutated);
  } catch (error) {
    clearLock();
    console.error(`\nguard sweep: ${error.message}`);
    console.error("Re-fit this strike; nothing was mutated.");
    process.exit(1);
  }
  active = { path: route, original };
  let outcome;
  try {
    outcome = runTest(testPath);
  } finally {
    const current = readFileSync(route, "utf8");
    if (hash(current) !== mutatedHash) {
      console.error(
        `\nSTOP: ${label(route)} changed underneath the check; its ${noun} was left as it is now. ` +
          "The mutation may have been absorbed into the new content rather than replaced — " +
          "inspect it by hand before trusting this file.",
      );
      process.exit(2);
    }
    writeFileSync(route, original);
    if (hash(readFileSync(route, "utf8")) !== hash(original)) {
      console.error(`\nSTOP: could not restore ${label(route)}.`);
      process.exit(2);
    }
    clearLock();
    active = null;
  }

  if (outcome.inconclusive) {
    log(`[${checked}/${plan.length}] ?          ${where}`);
    log("             the test run produced no report; read it by hand");
  } else if (outcome.ok) {
    // A target can survive because no case reaches it, or because a sibling
    // branch still answers with the same status — the test asserted the answer,
    // not this refusal's message. Whether the test names the message separates
    // the two. For a catch, a survivor is the sharper claim: no test drives the
    // failed-operation path at all.
    const testSource = readFileSync(testPath, "utf8");
    const named = item.messages.filter((message) => message && testSource.includes(message));
    const masked = named.length === 0;
    survived.push({
      where,
      path: label(route),
      line: item.line,
      kind,
      descriptor: item.descriptor,
      total: outcome.total,
      masked,
      named,
    });
    log(`[${checked}/${plan.length}] SURVIVED   ${where}`);
    log(`             all ${outcome.total} tests passed with the ${noun} disabled`);
    log(
      masked
        ? "             its refusal message is never named in the test (masked or uncased)"
        : `             note: the test DOES name this refusal (${named.join(" / ")})`,
    );
  } else {
    log(`[${checked}/${plan.length}] caught     ${where}`);
    log(`             ${outcome.failed.length}/${outcome.total} failed: ${outcome.failed.join("; ")}`);
  }
}

// The limbs a single case is holding up.
//
// `caughtSelf` records the margin behind every strike that was caught; this is the slice
// where the margin is the *whole* of the evidence. Only limbs are listed: a whole-detector
// strike is answered by the meta-test's one forbidden fixture by design, so a margin of one
// there is the file doing its job, while a limb's one-case answer is a pin that an edit to
// that case would remove. The section below prints them; the `--json` payload carries the
// same list so a consumer never has to parse the log to see it.
function thinMarginEntries() {
  return caughtSelf.filter((item) => item.kind === "limb" && item.caughtBy.length === 1);
}

/**
 * Where the recorded baseline lives — `MUTATION_BASELINE_FILE` points it elsewhere, so a
 * test can drive the ratchet (and this run's read of it) without touching the recorded
 * one. A function rather than a `const` because two places answer from it and they run in
 * different orders: the start-up refusal emits its payload before the module reaches the
 * baseline ratchet below, and a `const` declared down there would still be in its temporal
 * dead zone when the refusal wrote its report.
 */
function baselinePath() {
  return process.env.MUTATION_BASELINE_FILE || join(root, ".freebuff", "mutation-baseline.json");
}

/**
 * The recorded baseline's un-struck count — the floor the run page's warning measures a
 * run against — or `undefined` when no baseline records one: the file may not exist yet,
 * or may be one written before the un-struck half joined it, and neither is a number this
 * tree measured. `undefined` serializes to *no key*, so a payload that never saw a
 * baseline carries no comparison at all — never a zero a reader could mistake for one.
 */
function recordedUnstruckCount() {
  try {
    const recorded = JSON.parse(readFileSync(baselinePath(), "utf8"));
    return Array.isArray(recorded.unstruck) ? recorded.unstruck.length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `--json` object, built in one place so the refusal above writes the same shape a
 * plain run does. `survivorEntries` is the run's survivors, or — when the refusal wrote it
 * — the strikes that could not be applied, which are already in the one shape this array
 * speaks.
 *
 * `--json`: the same outcome — the counts, the gate, and every survivor — as one object on
 * stdout, and the same exit code. Progress was routed to stderr above, so stdout carries
 * exactly the one object. The baseline modes below have their own output and exit paths, so
 * JSON applies only to a plain sweep.
 */
function jsonPayload(survivorEntries, exitCode) {
  return {
    root,
    routes: routes.length,
    guards: guardCount,
    failOpen: failOpenCount,
    catches: catchCount,
    // The strikes that ran, counted by depth rather than as one "self-mutation" family: a
    // detector struck whole and a detector struck at one limb are told apart here, and a
    // check in the runner is its own count rather than folded into the helper's, so a
    // report can say which kind of weakening this run covers.
    helperSelfMutations: HELPER_MUTATIONS.length,
    runnerSelfMutations: RUNNER_MUTATIONS.length,
    conventionSelfMutations: CONVENTION_MUTATIONS.length - narrowedConventions.length,
    limbSelfMutations: narrowedConventions.length,
    lockSelfMutations: LOCK_MUTATIONS.length,
    ratchetSelfMutations: RATCHET_MUTATIONS.length,
    checked,
    gate: exitCode === 0 ? "pass" : "fail",
    exitCode,
    recovered: recovered ? [recovered] : [],
    // Every self-mutation strike that was caught, and what caught it — additive to the
    // contract above, so a consumer that only reads the counts is unaffected while one that
    // wants to say *which* case noticed a limb does not have to re-derive it from the log.
    // `margin` is how many cases failed, `caughtBy` names them, and every kind is carried (a
    // whole detector is here too) so a consumer filters rather than the sweep deciding for
    // it; `thinMargin` counts the limbs a single case is alone in noticing, which is the
    // slice the human report calls out below. A refusal writes all of these empty, because
    // no strike ran: `checked: 0`, `strikes: []`, `thinMargin: 0`.
    strikes: caughtSelf.map((item) => ({
      path: item.path,
      line: null,
      kind: item.kind,
      descriptor: item.name,
      test: item.test,
      total: item.total,
      margin: item.caughtBy.length,
      caughtBy: item.caughtBy,
    })),
    thinMargin: thinMarginEntries().length,
    // The other half of the same question: not "which limb did one case catch" but "which
    // decision did no strike ever reach". `strikes` is what ran; this is what did not, and
    // it is the list the beat-clock gate was found in. Carried here as well as printed
    // because a consumer that wants to ratchet it needs the lines, not a count.
    decisionSites: audit.sites,
    unstruck: unstruck.length,
    // The floor beside the measurement: the recorded baseline's own un-struck count,
    // read from the same file the `--baseline` ratchet below compares against, so one
    // file answers both readings. Absent rather than zero when nothing records one —
    // see `recordedUnstruckCount`.
    unstruckBaseline: recordedUnstruckCount(),
    unstruckRules: unstruck.map((item) => ({
      where: item.where,
      line: item.line,
      code: item.code,
    })),
    survivors: survivorEntries,
  };
}

/** A survivor-shaped entry for everything a plain run noticed. */
function standardSurvivors() {
  return [
    ...survived.map((item) => ({
      path: item.path,
      line: item.line,
      kind: item.kind,
      descriptor: item.descriptor,
      where: item.where,
      total: item.total,
      masked: item.masked,
      named: item.named,
    })),
    ...survivedSelf.map((item) => ({
      path: item.path,
      line: null,
      kind: item.kind,
      descriptor: item.name,
      where: item.where,
      total: item.total,
      masked: true,
      named: [],
    })),
  ];
}

if (JSON_OUTPUT && !writeBaseline && !baselineMode) {
  const survivorEntries = standardSurvivors();
  const jsonExitCode = survivorEntries.length === 0 ? 0 : 1;
  process.stdout.write(`${JSON.stringify(jsonPayload(survivorEntries, jsonExitCode), null, 2)}\n`);
  process.exit(jsonExitCode);
}

log("");
log(`Checked ${checked} mutation(s).`);
if (survived.length === 0 && survivedSelf.length === 0) {
  log("Every guard was caught by its neighbour test.");
} else {
  const survivedGuards = survived.filter((item) => item.kind === "guard");
  const survivedFailOpen = survived.filter((item) => item.kind === "failopen");
  const survivedCatches = survived.filter((item) => item.kind === "catch");
  if (survivedGuards.length > 0) {
    const masked = survivedGuards.filter((item) => item.masked);
    const unmasked = survivedGuards.filter((item) => !item.masked);
    log(`SURVIVED GUARDS (${survivedGuards.length}) — no test noticed these guards being removed:`);
    if (unmasked.length > 0) {
      log("\n  The test names the refusal, yet still passed — read these first:");
      for (const item of unmasked) {
        log(`    - ${item.where} — names ${item.named.join(" / ")}`);
      }
    }
    log("\n  The test never names the refusal (masked by a sibling guard, or uncased):");
    for (const item of masked) {
      log(`    - ${item.where}`);
    }
  }
  if (survivedFailOpen.length > 0) {
    log(
      `\nFAIL-OPEN GUARDS (${survivedFailOpen.length}) — no test noticed this guard answering success instead of refusing:`,
    );
    for (const item of survivedFailOpen) {
      const note =
        item.named.length > 0
          ? `the test names ${item.named.join(" / ")}, yet never asserts this guard's refusal`
          : "its refusal message is never named in the test";
      log(`    - ${item.where} — ${note}`);
    }
  }
  if (survivedCatches.length > 0) {
    log(
      `\nUNDRIVEN CATCH BLOCKS (${survivedCatches.length}) — no test reached these error branches:`,
    );
    for (const item of survivedCatches) {
      const note =
        item.named.length > 0
          ? `the test names ${item.named.join(" / ")}, yet the branch is never driven`
          : "its refusal message is never named in the test";
      log(`    - ${item.where} — ${note}`);
    }
  }
  if (survivedSelf.length > 0) {
    // Each family is named by its own `kind`, so a survivor is never filed under a
    // neighbour's word: the six are a test helper, a check in the runner, an answer the
    // shared lock stopped giving, a detector struck whole, one limb of one, and the
    // declared-table ratchet. Every family is one of these and every one of these is a
    // family — a bucket added here without a family in `STRIKE_WORDS` would never fill, and
    // a family without a bucket would be counted, exited on, and printed nowhere.
    const helpers = survivedSelf.filter((item) => item.kind === "self");
    const runners = survivedSelf.filter((item) => item.kind === "runner");
    const locks = survivedSelf.filter((item) => item.kind === "lock");
    const detectors = survivedSelf.filter((item) => item.kind === "convention");
    const limbs = survivedSelf.filter((item) => item.kind === "limb");
    const ratchets = survivedSelf.filter((item) => item.kind === "ratchet");
    if (helpers.length > 0) {
      log(`\nSURVIVED (${helpers.length}) — helper self-mutations no test noticed:`);
      for (const item of helpers) {
        log(`    - ${item.where} — ${item.test} still passed (${item.total} tests)`);
      }
    }
    if (runners.length > 0) {
      log(
        `\nSURVIVED (${runners.length}) — checks in the runner itself that its own suite did not notice going quiet:`,
      );
      log("\n  The runner stopped answering what the check exists to say — the stage inputs that");
      log("  resolve to no file — and `src/test/ci-runner.test.ts` passed anyway, so the run goes");
      log("  on vouching for a tree no check measured:");
      for (const item of runners) {
        log(`    - ${item.where} — ${item.test} still passed (${item.total} tests)`);
      }
    }
    if (locks.length > 0) {
      log(
        `\nSURVIVED (${locks.length}) — answers from the shared lock that went quiet, and its own suite did not notice:`,
      );
      log("\n  Recovery stopped saying what it exists to say — that a file a later edit left");
      log("  *carrying* the mutation is one no run may measure — and the crash-safety suite passed");
      log("  anyway, so the next run measures a weakened file as the real thing:");
      for (const item of locks) {
        log(`    - ${item.where} — ${item.test} still passed (${item.total} tests)`);
      }
    }
    if (detectors.length > 0) {
      log(
        `\nSURVIVED (${detectors.length}) — convention detectors that reported nothing, and the test did not notice:`,
      );
      log("\n  The detector stopped reporting the shape it exists for and the file that pins it");
      log("  still passed, so every rule it documents is enforced by nothing:");
      for (const item of detectors) {
        log(`    - ${item.where} — ${item.test} still passed (${item.total} tests)`);
      }
    }
    if (limbs.length > 0) {
      // Told apart from the whole-detector survivors above because a reader has to do
      // different things with them: a detector that reports nothing fails any fixture,
      // while one that has lost a limb still answers every assertion that only asks
      // *whether* something was reported — which is exactly the assertion that let it
      // through, and the reason the report names the test the bar is missing from.
      log(
        `\nSURVIVED (${limbs.length}) — one limb of a convention detector went dark, and the test did not notice:`,
      );
      log("\n  The detector still reports on the fixture it is driven with, so a check that asks");
      log("  only that something fired reads it as healthy; whatever the lost limb carried —");
      log("  a comparison, a name in a vocabulary, a gate — is enforced by nothing:");
      for (const item of limbs) {
        log(`    - ${item.where} — ${item.test} still passed (${item.total} tests)`);
      }
    }
    if (ratchets.length > 0) {
      // Told apart from the limbs above because the repair is a different one: a dark limb
      // is a case to add to the file that pins the detector, while a quieted ratchet is the
      // hold itself and every declared table in `src/test/declared-strikes.ts` is behind it.
      // It needs saying even though the exit code already carries the fact, because the
      // generated cases pass by *calling* the ratchet — a `return` on its first line leaves
      // them all green — so the one reader who has to act is the one who gets no other
      // signal that the counts above them are held by nothing.
      log(
        `\nSURVIVED (${ratchets.length}) — the declared-table ratchet went quiet, and its own suite did not notice:`,
      );
      log("\n  `holdDeclaredTable` stopped comparing the mutation tables to their declarations,");
      log("  and its cases pass by calling it, so every declared count, name and anchor was");
      log("  held by nothing while the suite that holds them read green:");
      for (const item of ratchets) {
        log(`    - ${item.where} — ${item.test} still passed (${item.total} tests)`);
      }
    }
  }
}
// Which case notices each limb, not only how many did.
//
// The per-strike line above answers "what caught this"; a reader scanning for what is
// *thin* still has to read every one of those lines and compare counts. A limb's margin is
// the number of cases that fail when it goes dark, and one is the number that matters: that
// limb is pinned by a single case, so the next edit to that case — a rewrite that keeps
// passing, a `skip`, a rename — is what takes the limb dark, and every count printed above
// would have read healthy until the moment it did. The whole-detector strikes are left out
// on purpose (see `thinMarginEntries`): the meta-test's single forbidden fixture is designed
// to be the one case that answers them.
const thinMargins = thinMarginEntries();
if (thinMargins.length > 0) {
  log(
    `\nTHIN MARGIN (${thinMargins.length}) — one case alone notices these limbs of a convention detector, so an edit to that case is what would let the limb go dark:`,
  );
  for (const item of thinMargins) {
    log(`    - ${item.name} — only "${item.caughtBy[0]}" (${item.test})`);
  }
}

// Every decision in the detector file that no limb strike reaches.
//
// The report above says which strikes a test caught; this says which rules no strike was
// ever written for — the gap the beat-clock gate sat in, where a detector reads `caught`
// because the *neuter* moved its whole body and nothing had ever moved that one line. It is
// printed rather than only carried in the JSON because the reader who has to write the next
// strike is the one reading this, and a count would not name the line to write it against.
if (CONVENTION_MUTATIONS.length > 0) {
  log(
    `\nUN-STRUCK RULES (${unstruck.length} of ${audit.sites} decisions) — decisions in the convention detectors that no limb strike reaches, so only the whole-detector neuter ever moves them (--audit lists them alone; --baseline ratchets the list, so the gap can only shrink):`,
  );
  for (const item of unstruck) log(`    - ${item.where} (line ${item.line}) — ${item.code}`);
}

// The baseline ratchet. `--baseline` compares this run against
// `.freebuff/mutation-baseline.json` and fails in *two* directions, because coverage
// regresses two ways: a **survivor** the file does not record (a guard that had a test
// and no longer does), and an **un-struck rule** it does not record (a decision in the
// detectors that had a limb strike and no longer does, so the gap the audit above lists
// has grown). Both key on what the gap *is* rather than on where it is written — a route
// and its predicate (`path  descriptor`), a function and its decision (`where  code`) —
// never the line number: a line moves with any unrelated edit, and a moved gap is the
// same gap. `--write-baseline` (re)records both halves. The un-struck half is read from
// the detector file as a whole rather than from the slice `--file` narrowed the sweep to,
// so a scoped `--write-baseline` scopes only the survivors and says so. A gap the
// baseline holds and the run no longer does is *resolved* — a survivor that is gone, an
// un-struck rule a limb strike reaches again — reported and never a failure, so the
// ratchet can only tighten: a run may close a gap and may not open one.
//
// The whole ratchet is in two halves that are compared the same way, from one file.
// Splitting them into two files would be two things to keep in step about one claim —
// "this tree's coverage is no worse than the tree the baseline was recorded on" — and
// the halves answer two questions a reader asks together: what has no test at all, and
// what no strike reaches.
//
const baselineSurvivors = [
  ...survived.map((item) => ({
    path: item.path,
    descriptor: item.descriptor,
    line: item.line,
    kind: item.kind,
    named: item.named,
  })),
  ...survivedSelf.map((item) => ({
    path: item.path,
    descriptor: item.name,
    line: null,
    kind: item.kind,
    named: [],
  })),
];

// The un-struck half, in the shape the report and `--audit` print it: the function (or
// the table) the decision lives in, and the code that decides. The line is deliberately
// left out — it is the one field that moves when an unrelated edit moves the decision,
// and a decision that moved is the same gap.
const baselineUnstruck = unstruck.map((item) => ({ where: item.where, code: item.code }));

const survivorKey = (entry) => `${entry.path}  ${entry.descriptor}`;
const unstruckKey = (entry) => `${entry.where}  ${entry.code}`;
const tally = (entries, keyOf) => {
  const map = new Map();
  for (const entry of entries) map.set(keyOf(entry), (map.get(keyOf(entry)) ?? 0) + 1);
  return map;
};
// The two comparisons are the same comparison over two keys: a key whose count grew is a
// gap this run opened, and one whose count shrank is a gap it closed. Counted rather than
// listed because a key is not unique — one function can hold the same shape twice.
const openedSince = (now, before) =>
  [...now].filter(([key, n]) => n > (before.get(key) ?? 0)).map(([key]) => key);
const closedSince = (now, before) =>
  [...before].filter(([key, n]) => n > (now.get(key) ?? 0)).map(([key]) => key);

function writeBaselineFile() {
  if (fileFilter) {
    log(
      `\nWARNING: --file=${fileFilter} is set, so only that scope's survivors are recorded — the survivor half will not cover the rest of the tree. The un-struck half is read from the detector file as a whole, so it is always complete.`,
    );
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    note: "Gaps the mutation sweep must not open: survivors it may not exceed, and detector rules no limb strike reaches, which may not grow. Regenerate with: node .freebuff/mutation-guards.mjs --write-baseline",
    survivors: baselineSurvivors,
    unstruck: baselineUnstruck,
  };
  writeFileSync(baselinePath(), `${JSON.stringify(payload, null, 2)}\n`);
  const plural = (n) => (n === 1 ? "entry" : "entries");
  log(
    `\nBaseline written: ${label(baselinePath())} (${baselineSurvivors.length} survivor ${plural(
      baselineSurvivors.length,
    )}, ${baselineUnstruck.length} un-struck ${plural(baselineUnstruck.length)}).`,
  );
}

if (writeBaseline) {
  writeBaselineFile();
  process.exit(0);
}

if (baselineMode) {
  if (fileFilter) {
    log(
      `\nBaseline comparison limited to routes matching "${fileFilter}" — the un-struck half is whole-file.`,
    );
  }
  if (limit !== Infinity) {
    log("Note: --limit is set, so survivors outside the slice are not compared.");
  }

  if (!existsSync(baselinePath())) {
    writeBaselineFile();
    log("No baseline existed, so this run recorded one. Re-run to compare.");
    process.exit(0);
  }

  const recorded = JSON.parse(readFileSync(baselinePath(), "utf8"));
  if (recorded.unstruck === undefined) {
    // A file written before the un-struck half joined it reads every un-struck rule as a
    // gap the tree just opened. Said out loud, because the fix is a re-record and the
    // message would otherwise read like the detectors had regressed.
    log(
      "\nNote: the recorded baseline holds no un-struck list (it was written before the detectors were ratcheted), so every un-struck rule reads as new. Re-record it with --write-baseline.",
    );
  }

  const scoped = (recorded.survivors ?? []).filter(
    (entry) => !fileFilter || entry.path.includes(fileFilter),
  );
  const nowSurvivors = tally(baselineSurvivors, survivorKey);
  const thenSurvivors = tally(scoped, survivorKey);
  const nowUnstruck = tally(baselineUnstruck, unstruckKey);
  const thenUnstruck = tally(recorded.unstruck ?? [], unstruckKey);
  const appeared = openedSince(nowSurvivors, thenSurvivors);
  const resolved = closedSince(nowSurvivors, thenSurvivors);
  const opened = openedSince(nowUnstruck, thenUnstruck);
  const struck = closedSince(nowUnstruck, thenUnstruck);

  log("");
  if (appeared.length === 0 && opened.length === 0) {
    log(
      `Baseline OK — no new survivors and no newly un-struck rule (${baselineSurvivors.length} survivor, ${baselineUnstruck.length} un-struck entry(ies) checked).`,
    );
  } else {
    if (appeared.length > 0) {
      log(
        `NEW SURVIVORS (${appeared.length}) — not recorded in the baseline, so coverage has regressed:`,
      );
      for (const key of appeared) log(`    - ${key}`);
    }
    if (opened.length > 0) {
      log(
        `${appeared.length > 0 ? "\n" : ""}NEW UN-STRUCK RULES (${opened.length}) — decisions a limb strike no longer reaches, so the coverage gap has grown. Each one either never had a strike or has just lost it; the baseline was recorded on a tree where it had one:`,
      );
      for (const key of opened) log(`    - ${key}`);
    }
  }
  if (resolved.length > 0) {
    log(`\nResolved since the baseline (${resolved.length}) — re-record it with --write-baseline:`);
    for (const key of resolved) log(`    - ${key}`);
  }
  if (struck.length > 0) {
    log(
      `\nStruck since the baseline (${struck.length}) — decisions a limb strike reaches again, so the gap has shrunk; re-record it with --write-baseline:`,
    );
    for (const key of struck) log(`    - ${key}`);
  }
  process.exit(appeared.length > 0 || opened.length > 0 ? 1 : 0);
}

process.exit(survived.length === 0 && survivedSelf.length === 0 ? 0 : 1);
