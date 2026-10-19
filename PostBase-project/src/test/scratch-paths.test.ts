import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frozenScratchPaths, relativeFixturePaths } from "@/test/convention-guards";
import { readTestSources, stripStringsAndComments } from "@/test/source-scan";
// The one declaration of this reading: its sidecar's name, the env seam a test points at
// scratch, and the prefix the line carries. The runner reads it back through the same entry,
// so the file, the seam and the vocabulary are stated once for both ends of the pipeline.
import {
  SCRATCH_PATHS_READING,
  metricOf,
  readingPath,
} from "../../.freebuff/coverage-readings.mjs";

/**
 * A guard for the fixture paths every suite builds: a path built from a binding a hook has not
 * filled yet is built from the empty string the binding is declared as.
 *
 * The suites that run a real process or a real gate keep their scratch directory in a module
 * binding a `beforeAll` fills (`makeScratchDir`, `src/test/scratch.ts`), and every fixture path
 * they write is built from it. The body of a `describe` runs while the file is *collected*,
 * before any hook, so a path built there freezes the empty string — and `join("", name)` is a
 * relative path, which resolves against whatever directory the runner happens to be in.
 * `ci-runner.test.ts`'s suspects suite did exactly that: `const fixture = path.join(stubDir,
 * "ci-suspect-pin.mjs")` in the describe body, before its `beforeAll` had made `stubDir`, so the
 * fixture was written over a tracked file in the checkout's own root. Nothing reds — the write
 * succeeds, into the wrong tree — which is why the shape needs a guard rather than a review.
 *
 * The rule is not "never read it in a describe body": it is that the read has to happen *after*
 * the hook. Resolving the path where it is used — `const fixturePath = () => path.join(stubDir,
 * name)`, or the same call inside the test that needs it — is the fix, and the detector states
 * that boundary rather than banning a binding.
 *
 * The same leak has a second spelling, and it has its own guard id (`relative-fixture`, from
 * `relativeFixturePaths`) applied here beside the first: a fixture named at a relative *literal* —
 * `writeFileSync("ci-suspect-pin.mjs", …)`, `readFileSync("fixtures/seed.json")` — resolves
 * against the runner's working directory exactly as the empty string did. Where the first guard
 * reads a path that was *built* too early, this one reads one that was never built at all, and
 * between them the two spellings of the mistake are named rather than one being left to review.
 *
 * Both detectors live in `@/test/convention-guards`, alongside the other convention guards, so one
 * meta-test can drive them all; this file keeps the assertions: which files are scanned, what each
 * rule means, and each leak patched back into the file it came from. The test files come from
 * `@/test/source-scan`, shared with the other convention guards so they all scan exactly the same
 * set.
 */
const testSources = readTestSources();

/** The checkout root, resolved once — the runner's own source is held against it. */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Where the scan leaves its reading of what it judged: one line, written once the tree-wide
 * pass below has run, in the path the CI runner's close reads.
 *
 * The rendered-links guard publishes its own reading through another entry of the same
 * registry, and the two are two files rather than one for a reason worth stating: the suite's
 * files run in parallel workers, so a single reading file would be the last writer's — the run
 * page would quote one guard's coverage under the other's name. The path is built from the
 * registry's entry for this reading, which is where the sidecar's name and the seam that can
 * point a run at scratch are declared — and it is built rather than spelled, for the same
 * reason the suites' fixtures are (a relative literal here is exactly the leak the
 * `relative-fixture` guard exists to catch). The default is the transient dot-file beside the
 * reporter's sidecars.
 */
const scratchReadingPath = readingPath(SCRATCH_PATHS_READING, projectRoot);

/** The reading's prefix — the registry's own spelling of it, taken rather than restated. */
const READING_PREFIX = SCRATCH_PATHS_READING.prefix;

/** A source key (`../test/ci-runner.test.ts`) as the checkout spells the file it names. */
function checkoutPath(key: string): string {
  return key.replace(/^\.\.\//, "src/");
}

/**
 * Whether a suite keeps a scratch directory: it *calls* the helper.
 *
 * Read through the shared lexer rather than by substring, because the call's name is also
 * written in prose — in this very file, which names it in the predicate below. Blanking the
 * strings and comments first is the difference between "this suite calls `makeScratchDir`"
 * and "this suite mentions it", and the reading is only worth printing if it means the
 * former: a roster that named every file the phrase appears in would be a different, much
 * less useful, and quietly wrong answer.
 */
function keepsScratchDir(source: string): boolean {
  return stripStringsAndComments(source).includes("makeScratchDir(");
}

/**
 * The line the tree-wide pass publishes: which suites that keep a scratch directory were
 * judged, and how large the tree they were judged in was.
 *
 * A scan that only ever asserted `offenders == []` answers *none offended* on a green run and
 * nothing else — the same sentence a scan that read one file, or read nothing at all, would
 * print. This is the other half of the answer, and the reason it names the suites rather than
 * counting them: the run page then says *which* suites were judged, and a suite that keeps a
 * scratch directory and quietly stopped being scanned is visible there rather than only
 * inferable from the absence of a failure. `null` when the tree holds no such suite at all:
 * a reading is an answer to a question the scan asked, never a line written for its own sake.
 */
function scratchCoverageReading(sources: Record<string, string>): string | null {
  const suites = Object.entries(sources)
    .filter(([, source]) => keepsScratchDir(source))
    .map(([key]) => checkoutPath(key))
    .sort();
  if (suites.length === 0) return null;
  return (
    `${READING_PREFIX} ${suites.length} suite(s) keep a scratch directory and were judged — ` +
    `${suites.join(", ")} (${Object.keys(sources).length} test file(s) scanned)`
  );
}

describe("the fixture paths every suite builds", () => {
  it("are found, so this guard is not silently scanning nothing", () => {
    expect(Object.keys(testSources).length, "no test sources matched the glob").toBeGreaterThan(20);
    // Checked against the scratch helper rather than against the rule: if every suite stopped
    // keeping a scratch directory the rule would have nothing to read, and that is a pass — the
    // coverage to assert is that the glob reached the suites that build one.
    const scratchSuites = Object.values(testSources).filter(keepsScratchDir);
    expect(
      scratchSuites.length,
      "the glob did not reach the suites that keep a scratch directory",
    ).toBeGreaterThan(3);
  });

  it("are built after the hook that fills them, never while the file is collected", () => {
    const offenders = Object.entries(testSources).flatMap(([path, source]) =>
      frozenScratchPaths(source).map((line) => `${path}:${line}`),
    );

    expect(
      offenders,
      "These suites build a fixture path from a binding their hook has not filled yet, so the " +
        "path is the empty string spelled relative — and the fixture is written wherever the " +
        "runner happens to be standing rather than into the scratch directory. Resolve it where " +
        "it is used, as `const fixturePath = () => path.join(scratch, name)`, or build it inside " +
        "the test that writes it.",
    ).toEqual([]);
  });

  it("never name a fixture at a path the working directory resolves", () => {
    const offenders = Object.entries(testSources).flatMap(([path, source]) =>
      relativeFixturePaths(source).map((line) => `${path}:${line}`),
    );

    expect(
      offenders,
      "These suites name a fixture at a relative path literal, so it is read or written wherever " +
        "the runner happens to be standing — the checkout — rather than under the scratch " +
        "directory the suite made for it. Build the path from that directory (`path.join(scratch, " +
        "name)`) instead of spelling it out.",
    ).toEqual([]);
  });

  it("fires on the shape it exists to catch", () => {
    // A guard only ever run against a clean tree is a guard never shown to fire. Each shape is
    // stated once, with the freeze as the one that must be caught and the deferred read as the
    // fix; the line each case names is the line the read is written on.
    const frozenInASuite = [
      'let scratch = "";',
      "",
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      'describe("the suspects", () => {',
      '  const fixture = path.join(scratch, "pin.json");',
      "});",
    ];
    expect(frozenScratchPaths(frozenInASuite.join("\n"))).toEqual([8]);

    // The same freeze from a module-scope `const`, which is the shape a fixture in a file with no
    // describe at all takes — and the one the reading has to reach without a suite to look in.
    const frozenAtModuleScope = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      'const fixture = path.join(scratch, "pin.json");',
    ];
    expect(frozenScratchPaths(frozenAtModuleScope.join("\n"))).toEqual([6]);

    // A hook other than `beforeAll` fills the binding exactly as `beforeAll` does: this is the
    // case the sweep's vocabulary limb is written against, since the meta-test's own fixture
    // fills its binding in a `beforeAll` and cannot tell the two hooks apart.
    const frozenByBeforeEach = [
      'let scratch = "";',
      "beforeEach(() => {",
      '  scratch = makeScratchDir("case-");',
      "});",
      "",
      'const fixture = path.join(scratch, "case.json");',
    ];
    expect(frozenScratchPaths(frozenByBeforeEach.join("\n"))).toEqual([6]);

    // The name carried by a template rather than written bare. A template is one token, so a
    // reading that looked for the identifier alone would miss this one entirely.
    const frozenInATemplate = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      "const fixture = `${scratch}/pin.json`;",
    ];
    expect(frozenScratchPaths(frozenInATemplate.join("\n"))).toEqual([6]);

    const resolvedWhereItIsUsed = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      'const fixturePath = () => path.join(scratch, "pin.json");',
      "",
      'it("writes its fixture", () => {',
      '  writeFileSync(fixturePath(), "{}");',
      "});",
    ];
    expect(frozenScratchPaths(resolvedWhereItIsUsed.join("\n"))).toEqual([]);

    // A helper the file declares is the fix too: it runs when a test calls it, which is after the
    // hook. `ci-runner.test.ts` writes every stub through one of these.
    const readFromAHelper = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      "function fixturePath(name: string): string {",
      "  return path.join(scratch, name);",
      "}",
    ];
    expect(frozenScratchPaths(readFromAHelper.join("\n"))).toEqual([]);

    const readInTheHookAndTheTest = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      '  writeFileSync(path.join(scratch, "seed.json"), "{}");',
      "});",
      "",
      'it("uses the scratch directory", () => {',
      '  expect(path.join(scratch, "pin.json")).toContain("pin.json");',
      "});",
    ];
    expect(frozenScratchPaths(readInTheHookAndTheTest.join("\n"))).toEqual([]);

    // A binding filled where it is declared is not a fixture binding at all — nothing unfilled is
    // ever read from it, whatever the path built beside it looks like.
    const filledUpFront = [
      'let scratch = mkdtempSync(join(tmpdir(), "suite-"));',
      "",
      'const fixture = path.join(scratch, "pin.json");',
    ];
    expect(frozenScratchPaths(filledUpFront.join("\n"))).toEqual([]);
  });

  it("reads the modifier's own call — `describe.skip`/`.only` — as collection time", () => {
    // A skipped or focused suite is still collected: its body runs while the file is read, before
    // any hook, and the fixture it freezes is exactly as wrong as one built in a plain describe.
    const frozenInSkip = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      'describe.skip("kept for later", () => {',
      '  const fixture = path.join(scratch, "pin.json");',
      "});",
    ];
    expect(frozenScratchPaths(frozenInSkip.join("\n"))).toEqual([7]);

    const frozenInOnly = [
      'let scratch = "";',
      "beforeEach(() => {",
      '  scratch = makeScratchDir("case-");',
      "});",
      'describe.only("the one under the cursor", () => {',
      '  const fixture = path.join(scratch, "case.json");',
      "});",
    ];
    expect(frozenScratchPaths(frozenInOnly.join("\n"))).toEqual([6]);
  });

  it("reads `describe.each`, whose callback hangs on the second call, as collection time", () => {
    // The factory is the half a reading of `describe(` alone misses twice over: the token after
    // `describe` is a dot, and the callback is an argument of the *call the chain ends in* — the
    // case list belongs to `each`, the title and the body to the call after it. A path built in
    // that body freezes like any other, so this is the shape the reading has to walk to.
    const frozenInEach = [
      'let scratch = "";',
      "",
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      "",
      'describe.each(["a", "b"])("the %s page", () => {',
      '  const fixture = path.join(scratch, "pin.json");',
      "});",
    ];
    expect(frozenScratchPaths(frozenInEach.join("\n"))).toEqual([8]);

    // …and the suite's own chain is read the same way when the *earlier* call is a factory too,
    // which is what the repo's rendered suites write: the array is built by a call of its own.
    const frozenInEachOverCases = [
      'let scratch = "";',
      "beforeAll(() => {",
      '  scratch = makeScratchDir("suite-");',
      "});",
      'describe.each(Object.keys(CASES))("the %s page", () => {',
      '  const fixture = path.join(scratch, "pin.json");',
      "});",
    ];
    expect(frozenScratchPaths(frozenInEachOverCases.join("\n"))).toEqual([6]);
  });

  it("holds every hook that fills a fixture path, not only the one above", () => {
    // The hooks are interchangeable to the rule: a fixture a `beforeEach` makes is a fixture a
    // `beforeAll` makes, and a reading whose vocabulary had lost one of the four would still
    // pass every case above, whose fixtures fill the binding in a `beforeAll`. This states the
    // per-test hook on the module-scope half of the reading — the other shape a fixture takes —
    // so the vocabulary is held from two places rather than from one fixture's coincidence.
    const filledEachTest = [
      'let scratch = "";',
      "beforeEach(() => {",
      '  scratch = makeScratchDir("case-");',
      "});",
      'const fixture = path.join(scratch, "case.json");',
    ];
    expect(frozenScratchPaths(filledEachTest.join("\n"))).toEqual([5]);
  });

  it("fires on the fixture a suite names outright", () => {
    // The other spelling of the same leak, stated the way a suite would write it: the path is not
    // built at the wrong moment, it is never built at all — so it resolves against the working
    // directory, which is the checkout.
    const written = [
      'it("writes its fixture", () => {',
      '  writeFileSync("ci-suspect-pin.mjs", "{}");',
      "});",
    ];
    expect(relativeFixturePaths(written.join("\n"))).toEqual([2]);

    // A template is read by its leading chunk, so `` `stub-${name}.mjs` `` is caught while
    // `` `${root}/stub.mjs` `` — a root the suite was handed — is left alone.
    const templated = [
      '  writeFileSync(`stub-${name}.mjs`, "export const stub = 1;", "utf8");',
      '  writeFileSync(`${root}/stub.mjs`, "export const stub = 1;", "utf8");',
    ];
    expect(relativeFixturePaths(templated.join("\n"))).toEqual([1]);

    // A directory made in the checkout is the same mistake one step earlier: everything written
    // through the path the suite keeps afterwards lands where the directory did.
    const made = [
      '  const fixtures = mkdtempSync("fixtures-");',
      '  mkdirSync("fixtures/seed");',
    ];
    expect(relativeFixturePaths(made.join("\n"))).toEqual([1, 2]);

    // Both paths of a copy or a rename are read: a *destination* spelled relative lands in the
    // checkout just as surely as a source does, and the half this case states is the one a
    // reading that stopped at the first argument would miss.
    const twoPaths = [
      '  copyFileSync(path.join(scratch, "seed.json"), "out.json");',
      '  renameSync("from.json", path.join(scratch, "to.json"));',
    ];
    expect(relativeFixturePaths(twoPaths.join("\n"))).toEqual([1, 2]);

    // Left alone: a path the call builds, a rooted literal (either spelling of rooted), a template
    // whose first chunk is a substitution, a data argument that is not a path at all, and a
    // relative string in a call that names no file.
    const resolved = [
      '  writeFileSync(path.join(scratch, "pin.json"), "{}");',
      '  writeFileSync(join(tmpdir(), "pin.json"), "{}");',
      '  readFileSync("/tmp/seed.json", "utf8");',
      '  readFileSync("C:\\\\fixtures\\\\seed.json", "utf8");',
      "  readFileSync(`${scratchRoot}/seed.json`, \"utf8\");",
      '  writeFileSync(fixturePath, "seed contents", "utf8");',
      '  expect(specifier).toBe("../components/landing/live-product-preview.tsx");',
    ];
    expect(relativeFixturePaths(resolved.join("\n"))).toEqual([]);
  });

  it("reads every call that names a path, not only the ones a case above uses", () => {
    // The vocabulary is a list, and a list is what this case holds: each name is driven through
    // the detector on the same shape, so a call struck out of `FIXTURE_CALLS` fails here even
    // when no other case happens to name it. The fixtures above state the shapes; this states the
    // coverage — the difference between "the read I thought of is read" and "every call that
    // names a file is".
    const calls = [
      "readFileSync",
      "writeFileSync",
      "appendFileSync",
      "mkdirSync",
      "mkdtempSync",
      "rmSync",
      "unlinkSync",
      "existsSync",
      "readdirSync",
      "copyFileSync",
      "renameSync",
      "statSync",
      "openSync",
    ];
    for (const call of calls) {
      const source = `  ${call}("fixture.bin", "x");`;
      expect(
        relativeFixturePaths(source),
        `${call} no longer counts as a call that names a path`,
      ).toEqual([1]);
    }
  });

  it("reads a fixture the suite loads the same way it reads one it writes", () => {
    // The half of the vocabulary that is not a write. A fixture *loaded* from a relative literal
    // is loaded from wherever the runner stands: it can pass on one machine and fail on another,
    // and here it can silently read the real file the suite meant to shadow — which is why the
    // read calls sit in the same vocabulary as the writes, and why this case is stated apart from
    // the one above: a vocabulary that lost them would still fire on every shape there.
    const loaded = [
      '  const seed = readFileSync("fixtures/seed.json", "utf8");',
      '  const cache = JSON.parse(readFileSync(`cache/${key}.json`, "utf8"));',
      '  expect(existsSync("tmp-fixtures")).toBe(false);',
      '  statSync(".freebuff/run.md");',
    ];
    expect(relativeFixturePaths(loaded.join("\n"))).toEqual([1, 2, 3, 4]);
  });

  // What the pass covered, left where the runner's close reads it. Published from the hook
  // rather than from the case, as the rendered-links close-out is: a red run still says which
  // suites it judged on its way to the red, and the reading is a report of the scan rather
  // than an assertion the scan has to pass to make.
  afterAll(() => {
    const reading = scratchCoverageReading(testSources);
    if (reading === null) return;
    // The console line is the reading's primary channel — visible in a developer's own run.
    console.log(reading);
    // Fail-silent on purpose: a tree that cannot host the sidecar costs the run page one
    // line, never the suite a test.
    try {
      writeFileSync(scratchReadingPath, `${reading}\n`, "utf8");
    } catch {
      return;
    }
  });
});

/**
 * The reading itself, held the way the rendered-links coverage is: what it names, what it
 * leaves out, how its prefix is spelled, and that the close-out really left it on disk.
 *
 * This block sits after the pass above rather than beside it because one of its cases reads
 * the sidecar back, and Vitest has run that describe's hooks by the time this one starts —
 * the same reason the reintroduction cases below can read files the scan already judged.
 */
describe("the reading the scan publishes", () => {
  it("names every suite that keeps a scratch directory, and the tree it read them in", () => {
    const reading = scratchCoverageReading(testSources);
    expect(reading, "the scan read no test sources at all").not.toBeNull();

    // The roster is recomputed here from the same sources, so a suite that gains a scratch
    // directory is demanded by name while a suite that loses one does not fail the case: the
    // reading states who was judged, and this states that nobody who should be is missing.
    const suites = Object.entries(testSources)
      .filter(([, source]) => keepsScratchDir(source))
      .map(([key]) => checkoutPath(key))
      .sort();
    expect(suites.length, "no suite keeps a scratch directory").toBeGreaterThan(3);
    for (const suite of suites) {
      expect(reading, `${suite} keeps a scratch directory and is not named`).toContain(suite);
    }
    // …and the tree the reading was taken in, so an empty reading cannot pass as one taken
    // over a suite that was really read.
    expect(reading).toContain(`(${Object.keys(testSources).length} test file(s) scanned)`);
    // …and the number the entry declares the reading is *charted* by, read off the line this
    // suite just built rather than recomputed by the trend from whatever integers it finds: the
    // roster's size is what this reading is for, and a wording that moved out from under the
    // metric is a red case here rather than a chart that stops moving.
    expect(metricOf(SCRATCH_PATHS_READING, reading)).toBe(suites.length);
  });

  it("is nothing at all for a tree whose suites keep no scratch directory", () => {
    // The other half of the same honesty: with nothing to judge there is no reading, and the
    // runner reads its absence as an omission rather than as a fabricated zero.
    const noScratch = {
      "../test/plain.test.ts": 'it("reads a fixture", () => {});\n',
    };
    expect(scratchCoverageReading(noScratch)).toBeNull();
  });

  it("takes its prefix from the reading's one declaration, which is what the runner reads", () => {
    // The prefix is the contract the registry declares once: this suite writes it, the runner's
    // reader carries a sidecar's line past it, and neither keeps a literal of its own — the
    // runner reads every declared reading through the same entry this file builds its line
    // from, so a changed vocabulary is one edit rather than two spellings that happen to agree.
    const runner = readFileSync(resolve(projectRoot, ".freebuff", "ci.mjs"), "utf8");
    expect(READING_PREFIX).toBe(SCRATCH_PATHS_READING.prefix);
    expect(runner).toContain("coverage-readings.mjs");
    expect(runner).not.toContain(READING_PREFIX);
    expect(scratchCoverageReading(testSources)).toContain(`${READING_PREFIX} `);
  });

  it("is the line the close-out left where the runner reads it", () => {
    // The sidecar, read back: the pass above wrote this file before this case ran, so a
    // close-out that stopped writing — or wrote somewhere else — is a red case rather than a
    // run page that quietly loses the reading. The default path is used by the real run, and
    // a caller that pointed the seam at scratch wrote there instead, which is the path read.
    const written = readFileSync(scratchReadingPath, "utf8").trim();
    expect(written).toBe(scratchCoverageReading(testSources));
  });
});

/* -------------------------------------------------------------------------- */

/**
 * One substitution in a real file's own text, which must land exactly once.
 *
 * This case patches a file the scan actually reads rather than a shape written for the test, so
 * the anchor is what keeps it honest: the fixture moving, or its call site changing, fails the
 * case instead of leaving a patch that changed nothing and a detector quietly handed a clean
 * source. The mutation sweep's own entries hold themselves to the same rule, for the same reason.
 */
function replaceOnce(source: string, find: string, replace: string): string {
  expect(
    source.split(find).length - 1,
    `the file no longer contains this anchor exactly once: ${find}`,
  ).toBe(1);
  return source.replace(find, replace);
}

/** The real file a case patches, keyed the way the source scan keys it. */
function scannedSource(path: string): string {
  const source = testSources[path];
  expect(source, `${path} was not read by the source scan`).toBeTruthy();
  return source ?? "";
}

/**
 * The freeze, brought back into the file it came from.
 *
 * The fixtures above state the shape in the abstract; these state the shapes *this repo* wrote,
 * patched back into the suites the guards actually scan: the suspects suite's fixture, resolved
 * per test today, captured in the describe body as it was when it wrote `ci-suspect-pin.mjs`
 * into the checkout's root, and the stage-order suite's stub script, written into its scratch
 * root today and named outright before that. A rename or a refactor that moved either one would
 * fail its case rather than leaving a patch that changed nothing — and the case would then be
 * reading a file that no longer carries the mistake it is about.
 */
describe("the leak, reintroduced in the real file", () => {
  it("catches the fixture the suspects suite used to freeze", () => {
    const path = "../test/ci-runner.test.ts";
    const source = scannedSource(path);
    const anchor = '  const fixturePath = () => path.join(stubDir, "ci-suspect-pin.mjs");';
    // The premise, asserted against the file rather than assumed: the suite resolves its fixture
    // per test today and the guard leaves it alone, which is what makes capturing it at
    // collection time the reintroduction rather than a change to some other file.
    expect(source, `${path} no longer resolves its fixture per test`).toContain(anchor);
    expect(frozenScratchPaths(source), `${path} already trips the guard`).toEqual([]);

    // The reintroduction is one edit: the arrow that deferred the read, gone, so the path is
    // built while the file is collected — from the empty string `stubDir` still is.
    const reintroduced = replaceOnce(
      source,
      anchor,
      '  const fixture = path.join(stubDir, "ci-suspect-pin.mjs");',
    );

    const flagged = frozenScratchPaths(reintroduced);
    expect(flagged, `${path}: the frozen fixture this file wrote was not seen`).toHaveLength(1);
    // …and the line it names is the line the path is built on, read back out of the patched
    // source rather than taken on trust from the detector's own report.
    expect(reintroduced.split("\n")[flagged[0] - 1]).toContain(
      'path.join(stubDir, "ci-suspect-pin.mjs")',
    );
  });

  it("catches the stub written beside the runner instead of into the scratch directory", () => {
    const path = "../test/ci-stage-order.test.ts";
    const source = scannedSource(path);
    const anchor = '  writeFileSync(silentStub,';
    // The premise, asserted against the file rather than assumed: the stub is written into the
    // scratch root today and the guard leaves it alone, which is what makes naming it outright —
    // at the path the stage runner would then resolve against *its own* working directory — the
    // reintroduction rather than a change to some other file.
    expect(source, `${path} no longer writes its stub into the scratch directory`).toContain(anchor);
    expect(relativeFixturePaths(source), `${path} already trips the guard`).toEqual([]);

    const reintroduced = replaceOnce(
      source,
      anchor,
      '  writeFileSync("stage-pass.mjs",',
    );

    const flagged = relativeFixturePaths(reintroduced);
    expect(flagged, `${path}: the stub written beside the runner was not seen`).toHaveLength(1);
    expect(reintroduced.split("\n")[flagged[0] - 1]).toContain('writeFileSync("stage-pass.mjs"');
  });
});
