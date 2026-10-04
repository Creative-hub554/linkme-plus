/**
 * The collect-time budget: a reporter that fails a run when a test file's
 * *collection* — the transform and import work Vitest does before a single case
 * runs — crosses a ceiling.
 *
 * Collect cost is invisible in the suite's own result. A file can pass every
 * case while quietly making the whole run slower for everyone, and that is
 * exactly the shape of the eager `?raw` globs this repository has been removing:
 * Vite read and registered every page and route into *each* test file that
 * imported the shared index, and the only symptom was collect time. A source
 * guard can pin the one shape it knows about; this is the backstop for the ones
 * it does not.
 *
 * It is a reporter rather than a test because Vitest exposes `collectDuration`
 * only on a module's `diagnostic()`, which a test cannot reach, and because it
 * has to run once for the whole run rather than once per file. `onTestRunEnd`
 * hands over every module and a place to fail the process.
 *
 * The per-file ceiling is *load-aware*: it is a multiple of the run's own median
 * collect, not a fixed number of milliseconds. Collection is wall-clock on a
 * shared checkout and moves with whatever else is running — a run whose median
 * file collected in ~160ms on a quiet machine collected in ~244ms with the box
 * loaded, and individual files swung by an order of magnitude — so a fixed
 * ceiling has to be set for the worst load it might ever meet, loose enough that
 * it never fires on the machine it is meant to protect. Dividing each file's
 * collect by the run's median cancels most of that swing, because the *ratio* of
 * a file to the median of all files moves far less than its milliseconds do (the
 * heaviest app file sat at 6.9× the median quiet and 6.1× loaded). A ratio
 * budget can therefore be tied to the machine's own pace and still not flake.
 *
 * There are two collect shapes, chosen by where a file lives: a tighter multiple
 * for `src/test` files, which are small and whose collect is dominated by the
 * shared index they import, and a looser one for the app's tests, whose route
 * files legitimately pull in the real client stack. Each has a floor, so a run
 * too small or too fast to produce a meaningful median — a focused run of a
 * single file — still gets a sensible ceiling rather than one the median would
 * collapse toward nothing.
 *
 * The multiples were measured, not guessed. Over several full runs of this suite
 * the heaviest file was a `src/test` file at about 6.2× the median and a
 * `src/lib/db` one at about 7.6×, so the two multiples sit a little above twice
 * the worst ratio actually seen — enough that load alone cannot carry a file
 * over, while still well under the fixed ceilings this replaces, which never
 * fired.
 *
 * The check has three parts:
 *
 * 1. the per-file collect ceiling above, so a file that starts eagerly importing
 *    the world fails here rather than in a code review;
 * 2. a ceiling on the *import* of the shared scanners (`module-index.ts`,
 *    `source-scan.ts`) — the sharp signal. Those modules hold only path
 *    arithmetic and a `readFileSync` cache, so importing one is milliseconds
 *    even under load; a returning glob makes it the slowest import the file has;
 *    and
 * 3. the same comparison in the other direction, for *both* recorded values: a
 *    baseline — or the warning band — that sits *far above* what the tree measures
 *    is reported too. The ratchet only ever lowers, so a number raised by hand, or
 *    first recorded on a day the scanner happened to be slow, would sit there
 *    keeping the gate loose forever with nothing to notice it. This is what
 *    notices, and `npm run collect:record` is the fix. The band is judged by how
 *    far the recorder would move it, and the imports by how far the recorded cost
 *    sits above the measurement. Because one run is one noisy sample, this
 *    direction is *warned* on a single run and only *failed* when a repeated
 *    session confirms it — the same repeated-sample treatment the proposal gives a
 *    tightening, and the same approve-and-apply flow closes it.
 *
 * Both the import check and the warning band *ratchet*. Their numbers are not
 * hand-picked: they are recorded in `.freebuff/collect-budget-baselines.mjs`, and
 * `npm run collect:record` re-measures a full run and lowers any value the run
 * beat. The import baseline is a low-water mark — the recorded cost of the module
 * plus a fixed margin the gate keeps over it — so as the shared index gets cheaper
 * the gate tightens on its own. The soft threshold is the same idea one step
 * removed: it sits a fixed margin above the *tightest file the recording run saw*,
 * so as the tree's collects improve the band that warns moves down with them. The
 * recorder only ever lowers these values, so a regression cannot be recorded away:
 * it has to be fixed, or the number raised by hand with a reason. This mirrors
 * `coverage-headroom.mjs`, which enforces a backstop plus a margin; here the
 * recorded numbers are the backstops.
 *
 * The recorder can also *propose* rather than apply: `npm run collect:propose`
 * measures the same way but writes a Markdown proposal instead of the checked-in
 * file, so a pull request can be told what it would tighten without anything
 * under version control changing. Because a proposal is advice rather than a
 * gate, and because one run's collect time is one sample of a noisy quantity, the
 * proposal is measured several times and only a drop that holds across *every* run
 * is posted — the aggregate is the worst case any of them saw, so a single quietly
 * fast machine cannot propose a tightening the others did not confirm — the same propose-don't-apply shape as
 * `.freebuff/coverage-propose.mjs`. The proposal comment carries a hidden payload
 * of the values the run earned; a reviewer replies with the apply command and
 * `.github/workflows/collect-apply.yml` turns that payload into a follow-up pull
 * request, so the tightening is one deliberate merge rather than a number someone
 * has to transcribe. The payload and the merge are `.freebuff/collect-apply.mjs`'s
 * contract, and the merge is tighten-only, so the command can never loosen a gate.
 *
 * The proposal also names the direction the gate fails on. `npm run collect:record`
 * is the documented fix for a *stale-high* baseline, but it runs on the developer's
 * machine; a proposal that only showed an ordinary drop would leave a reviewer to
 * work out from the numbers alone that one of them was a red gate rather than a
 * tidy-up. So a stale baseline is called out, and the same approve-and-apply reply
 * that applies a tightening is also how a loose gate is closed.
 *
 * A run does not have to fail to say something. Every run ends by naming the few
 * files nearest their collect budget, and once any file is inside the soft band
 * the notice becomes a warning: still green, but printed loudly and left where the
 * CI runner turns it into a GitHub annotation, so a creep is visible on the green
 * runs that come before it breaches rather than only on the red one after.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, TestModule } from "vitest/node";
import { SOFT_GATE_FILE } from "../../.freebuff/collect-budget-soft.mjs";
import { RUN_REPORT_FILE } from "../../.freebuff/collect-run.mjs";
import {
  APPLY_COMMAND,
  PROPOSAL_MARKER,
  renderProposalState,
} from "../../.freebuff/collect-apply.mjs";
import {
  importBaselines,
  importMarginMs,
  softThreshold,
} from "../../.freebuff/collect-budget-baselines.mjs";

/**
 * A Vitest path as a `src`-relative one (`src/test/render.test.ts`).
 *
 * Vitest reports a module id that may be bare (`src/…`) or absolute, with either
 * platform's separators, and the reporter is named by path — from the config's
 * `reporters` and from `--reporter=…` in CI — so nothing here should depend on
 * where the module itself sits. The `/src/` marker is all the arithmetic needed.
 */
function projectPath(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  const marker = normalized.lastIndexOf("/src/");
  return marker === -1 ? normalized : normalized.slice(marker + 1);
}

/**
 * The ceiling for one class of file: how many times the run's median collect it
 * may cost, and the floor below which the ceiling never falls.
 */
interface CeilingShape {
  /** The multiple of the run's median collect a file is allowed. */
  multiple: number;
  /** The lowest the ceiling may ever fall, in ms, however fast the run. */
  floor: number;
}

/**
 * The shape for a `src/test` file. Fourteen times the median, measured against
 * the heaviest such files — the convention guards `fake-db` and `expect-gated`,
 * whose collect legitimately reaches roughly 6.2× the run median — so a real file
 * keeps about a factor of two of headroom. The floor covers the focused or
 * mostly-cached run whose median is too small for the multiple to mean anything.
 */
const TEST_DIR_SHAPE: CeilingShape = { multiple: 14, floor: 2000 };

/**
 * The shape for a file elsewhere in the app. Looser, because a route or db test
 * imports the real handler and its whole client stack: those files reached about
 * 7.6× the median, so seventeen keeps roughly the same headroom the `src/test`
 * shape does. The floor keeps a run too small to produce a real median from
 * pinning a route test to a ceiling load alone would cross.
 */
const APP_SHAPE: CeilingShape = { multiple: 17, floor: 2600 };

/** The ceiling shape that applies to a test file, by where it lives. */
function shapeFor(file: string): CeilingShape {
  return projectPath(file).startsWith("src/test/") ? TEST_DIR_SHAPE : APP_SHAPE;
}

/**
 * The modules whose *import* must stay near-free, because they are the shared
 * index every convention guard reads through. Each is matched by the tail of a
 * project-relative path, so the absolute path Vitest reports does not matter, and
 * each is a key in `.freebuff/collect-budget-baselines.mjs`.
 */
export const TRACKED_IMPORTS = ["src/test/module-index.ts", "src/test/source-scan.ts"];

/** One import of a test module, as Vitest measured it. */
export interface ImportTiming {
  /** The project-relative, forward-slashed path that was imported. */
  path: string;
  /** The time to import it and everything it imports, in ms. */
  total: number;
}

/** One test module's collection, as Vitest measured it. */
export interface ModuleTiming {
  /** The project-relative, forward-slashed path of the test file. */
  file: string;
  /** The time Vitest spent collecting the file, in ms. */
  collect: number;
  /** The imports that collection made. */
  imports: ImportTiming[];
}

/** A budget a module crossed, and by how much. */
export interface BudgetBreach {
  /** The test file that crossed it. */
  file: string;
  /** Which budget it crossed. */
  kind: "collect" | "import";
  /** What it cost, in ms. */
  ms: number;
  /** The budget it had to stay under, in ms. */
  budget: number;
  /** What was being measured, for the report. */
  detail: string;
}

/**
 * The import budget for the tracked scanners: a recorded low-water cost per
 * module and the margin the gate keeps over it.
 *
 * Split out from the module constants so a test can drive the arithmetic with
 * fixtures, the way `collectCeilingFor` takes its median — the committed values
 * are one instance of the shape, not the shape itself.
 */
export interface ImportBudget {
  /** Each tracked module's recorded import cost, in ms. */
  baselines: Readonly<Record<string, number>>;
  /** The margin the budget keeps over each baseline, in ms. */
  marginMs: number;
}

/**
 * The committed baselines: the two recorded numbers and the fixed import margin,
 * exactly as `.freebuff/collect-budget-baselines.mjs` holds them.
 */
export interface CommittedBaselines {
  /** The fixed margin the import gate keeps over each `importBaselines` entry. */
  importMarginMs: number;
  /** The recorded fraction of a collect budget at which a file warns. */
  softThreshold: number;
  /** Each tracked module's recorded low-water import cost, in ms. */
  importBaselines: Readonly<Record<string, number>>;
}

/** The baselines read from the checked-in file, which the reporter enforces. */
export const COMMITTED_BASELINES: CommittedBaselines = {
  importMarginMs,
  softThreshold,
  importBaselines,
};

/** The import budget read from the checked-in baseline file. */
export const COMMITTED_IMPORT_BUDGET: ImportBudget = {
  baselines: COMMITTED_BASELINES.importBaselines,
  marginMs: COMMITTED_BASELINES.importMarginMs,
};

/**
 * The import budget a tracked module has, in ms.
 *
 * A module the baseline file does not name gets the margin alone: a brand-new
 * tracked scanner would still be held to a small number rather than none, and the
 * recorder is what gives it a real baseline.
 */
export function importBudgetFor(
  tracked: string,
  budget: ImportBudget = COMMITTED_IMPORT_BUDGET,
): number {
  return (budget.baselines[tracked] ?? 0) + budget.marginMs;
}

/**
 * The run's median collect, in ms — the number every per-file ceiling scales
 * from.
 *
 * The median rather than the mean because it is the point a regression in one
 * file cannot drag: a single file that starts eagerly importing the world is one
 * sample out of more than a hundred, so it moves the median by nothing while it
 * moves the mean by however big it got. That is what lets a file trip its own
 * ratio budget instead of hiding behind a raised average.
 *
 * An empty run has no median; zero is returned so the shapes fall back to their
 * floors.
 */
export function medianCollect(modules: ModuleTiming[]): number {
  if (modules.length === 0) return 0;
  const sorted = modules.map((entry) => entry.collect).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // An even run has no single middle: the average of the two is the median.
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The collect ceiling a test file has, given the run's median.
 *
 * Pure and synchronous so fixtures can drive it: the multiple is chosen so that
 * a quiet run and a loaded one put the same file on the same side of its budget.
 * `median` is threaded in rather than computed here so the reporter can compute
 * it once for the whole run and so a test can pin the arithmetic without having
 * to build a whole run's worth of modules.
 */
export function collectCeilingFor(file: string, median: number): number {
  const shape = shapeFor(file);
  return Math.max(shape.floor, shape.multiple * median);
}

/**
 * How many files the end-of-run notice names. Five is enough to spot a file
 * trending toward its budget without turning every green run into a report.
 */
const SLOWEST_SHOWN = 5;

/**
 * How far above the tightest file a recording run saw the soft band is kept, as a
 * fraction of a budget.
 *
 * The recorded `softThreshold` is `tightest + this margin`, so the band always
 * clears the worst file the run measured by enough that the ordinary wobble of a
 * shared machine cannot trip it — while still tightening whenever the tree's own
 * worst case improves, because the recorder lowers the threshold with it.
 */
const SOFT_THRESHOLD_MARGIN = 0.2;

/**
 * The tightest the recorded soft band may ever become.
 *
 * Without a floor, a run that found every file comfortable would drive the
 * threshold toward zero and the warning would fire on noise rather than on a
 * creep. A third of the budget is still far from the hard gate, so it warns well
 * before a file is in danger.
 *
 * It is also the floor the band is *judged* against: a run whose tightest file
 * never reached it is not compared to the band at all, and published in the run
 * report so the summary can show that as a word rather than a boundary the run had
 * no chance to cross.
 */
export const MIN_SOFT_THRESHOLD = 0.3;

/** One file's collect, against the ceiling it had to stay under. */
export interface CollectRow {
  /** The project-relative path of the test file. */
  file: string;
  /** The time Vitest spent collecting it, in ms. */
  collect: number;
  /** The ceiling it had to stay under, in ms. */
  ceiling: number;
  /** `collect / ceiling` — where 1.0 is a breach. */
  used: number;
}

/** Every file's collect against its ceiling, unsorted. */
function collectRows(modules: ModuleTiming[], median: number): CollectRow[] {
  return modules.map((entry) => {
    const ceiling = collectCeilingFor(entry.file, median);
    return {
      file: entry.file,
      collect: entry.collect,
      ceiling,
      used: entry.collect / ceiling,
    };
  });
}

/** Tightest first; raw milliseconds break ties so the order is stable. */
const byUsed = (a: CollectRow, b: CollectRow): number => b.used - a.used || b.collect - a.collect;

/**
 * The test files closest to their collect budget, tightest first.
 *
 * Ordered by the fraction of its budget a file used, not by raw milliseconds,
 * because that is the form a creep becomes visible in *before* it breaches: a
 * file that has quietly doubled but is still a third of a loose ceiling shows up
 * beside one that is nearly over, while a fixed millisecond cut would keep naming
 * the same heavy route tests and hide the one that is moving. Exported so a
 * fixture can pin the ordering and the arithmetic — the reporter cannot be
 * reached from a test.
 */
export function slowestCollects(
  modules: ModuleTiming[],
  median: number,
  limit: number = SLOWEST_SHOWN,
): CollectRow[] {
  return collectRows(modules, median).sort(byUsed).slice(0, limit);
}

/**
 * The files at or over the soft threshold, tightest first and not truncated.
 *
 * The soft gate's input. Separate from `collectBudgetBreaches` on purpose:
 * crossing it does not fail the run, it warns — and the reporter leaves the same
 * list where the CI runner reads it, so the warning becomes a GitHub annotation
 * rather than a line nobody sees.
 */
export function softWarnings(
  modules: ModuleTiming[],
  median: number,
  threshold: number = COMMITTED_BASELINES.softThreshold,
): CollectRow[] {
  return collectRows(modules, median)
    .filter((row) => row.used >= threshold)
    .sort(byUsed);
}

/**
 * The tightest file in a run, as a fraction of its budget.
 *
 * The quantity the recorder lowers the soft threshold from: the largest `used`
 * any file reached. Zero for an empty run, so the threshold cannot move on one.
 */
export function worstUsed(modules: ModuleTiming[], median: number): number {
  return collectRows(modules, median).reduce((worst, row) => Math.max(worst, row.used), 0);
}

/**
 * The soft threshold a run's headroom earns: never above the current one, and
 * never below the floor.
 *
 * This is what lets the band tighten on its own. A recording run measures its own
 * tightest file and proposes a band a margin above it; `Math.min` keeps that
 * proposal from ever *raising* the threshold, so a busy run cannot loosen a band a
 * quiet one already tightened, and `Math.max` keeps it from collapsing to zero.
 *
 * The proposal is rounded to two decimals — a fraction of a budget is not worth
 * more, and an unrounded `tightest + margin` would write a different noise tail
 * into the committed file on every run.
 */
export function nextSoftThreshold(
  current: number,
  tightest: number,
  margin: number = SOFT_THRESHOLD_MARGIN,
): number {
  const proposed = Math.round((tightest + margin) * 100) / 100;
  return Math.max(MIN_SOFT_THRESHOLD, Math.min(current, proposed));
}

/**
 * The dearest import of one tracked module in a file, in ms.
 *
 * A file can import a tracked scanner through several specifiers, so the dearest
 * one is what it actually paid; zero means the file never imported it.
 */
function dearestImport(entry: ModuleTiming, tracked: string): number {
  let cost = 0;
  for (const imported of entry.imports) {
    if (imported.path !== tracked && !imported.path.endsWith(`/${tracked}`)) continue;
    cost = Math.max(cost, imported.total);
  }
  return cost;
}

/**
 * Every budget the modules crossed, in no particular order.
 *
 * Split out from the reporter so it can be driven by fixtures: a budget check
 * that has only ever seen a green tree has not been shown to do anything, and
 * the reporter itself cannot be reached from a test. Both the median and the
 * import budget default to the run's own and the committed file, so a caller with
 * no reason to compute them separately can pass just the modules.
 */
export function collectBudgetBreaches(
  modules: ModuleTiming[],
  median: number = medianCollect(modules),
  importBudget: ImportBudget = COMMITTED_IMPORT_BUDGET,
): BudgetBreach[] {
  const breaches: BudgetBreach[] = [];
  for (const entry of modules) {
    const ceiling = collectCeilingFor(entry.file, median);
    if (entry.collect > ceiling) {
      breaches.push({
        file: entry.file,
        kind: "collect",
        ms: entry.collect,
        budget: ceiling,
        detail: "collecting the file",
      });
    }

    for (const tracked of TRACKED_IMPORTS) {
      const cost = dearestImport(entry, tracked);
      const budget = importBudgetFor(tracked, importBudget);
      if (cost > budget) {
        breaches.push({
          file: entry.file,
          kind: "import",
          ms: cost,
          budget,
          detail: `importing ${tracked}`,
        });
      }
    }
  }

  // A stale-high baseline is deliberately *not* a breach. It is the reverse of a
  // budget being crossed — the gate is looser than the tree needs, not tighter —
  // and one run is one noisy sample of a wall-clock quantity, so a single reading
  // is not evidence enough to fail a build on. What notices it is
  // `staleHighBaselines` below, reported as a warning here and judged across a
  // repeated session by `npm run collect:stale`.
  return breaches;
}

/**
 * The dearest import of each tracked module across the run, in ms.
 *
 * The quantity the recorder lowers a baseline to: the worst a file actually paid
 * to import the module, maximized across files so one fast import cannot hide a
 * slow one. A module no file imported is left out rather than recorded at zero,
 * so a rename cannot quietly drop it from the baseline.
 */
export function measuredImportCosts(modules: ModuleTiming[]): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const entry of modules) {
    for (const tracked of TRACKED_IMPORTS) {
      const cost = dearestImport(entry, tracked);
      if (cost > 0) costs[tracked] = Math.max(costs[tracked] ?? 0, cost);
    }
  }
  return costs;
}

/**
 * How many times the measured cost a recorded baseline may sit above before it is
 * called stale.
 *
 * A ratio rather than a fixed number so the check means the same thing when a
 * scanner gets slower: the baseline should be *near* what the tree pays, not a
 * multiple of it.
 */
const STALE_BASELINE_FACTOR = 4;

/**
 * The absolute clearance below which a baseline is never called stale, in ms.
 *
 * This is the part that keeps the check from flaking. A baseline is compared
 * against one run's measurement, and one run is one noisy sample on a shared
 * machine — a focused run or a warm cache can put an import at a fraction of a
 * millisecond. Ten milliseconds is well past anything that wobble produces at
 * these magnitudes, so the check fires on a *gross* loosening and stays quiet
 * about the few milliseconds that are genuinely immaterial against a 50ms margin.
 * Micro-drift is `npm run collect:propose`'s business, not this gate's.
 */
const STALE_BASELINE_FLOOR_MS = 10;

/** The size a recorded baseline would have to exceed to be stale, in ms. */
function staleThreshold(measured: number): number {
  return Math.max(measured * STALE_BASELINE_FACTOR, STALE_BASELINE_FLOOR_MS);
}

/**
 * Whether a recorded baseline has gone stale against what this run measured.
 *
 * The ratchet lowers a baseline a run beats and never raises one, which is what
 * makes it safe to run unattended — but it also means a number that is too *high*
 * has nothing pushing it down. A baseline raised by hand to silence a breach, or
 * recorded on the one day a scanner was slow, would keep the gate looser than the
 * tree needs for as long as nobody looks. This is the direction the recorder
 * cannot correct on its own, so it is the direction that has to be *reported*.
 *
 * A module the run never imported is not judged: no measurement is not a
 * measurement of zero.
 */
export function staleBaseline(recorded: number, measured: number): boolean {
  return recorded > staleThreshold(measured);
}

/**
 * The cost each recorded baseline would be called loose past, keyed by tracked module.
 *
 * The per-import half of the boundaries the run report publishes, built with the very
 * `staleThreshold` the check calls: a baseline is stale once the recorded value sits
 * above the returned number, so the run summary can print the boundary that judged a
 * baseline instead of a script restating the rule. It is a function of the *measurement*
 * rather than of the recorded value, which is why it is built per module here rather
 * than as one number. A module the run did not import is absent, as it is from
 * `measured` — no measurement is not a measurement of zero.
 */
export function importStaleThresholds(
  measured: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(measured).map(([tracked, cost]) => [tracked, staleThreshold(cost)]),
  );
}

/** A recorded gate that sits far above what a run — or a session — measured. */
export interface StaleGate {
  /** Which recorded value it is: a scanner's import cost, or the warning band. */
  kind: "import" | "band";
  /** The value's name: a tracked module's path, or `softThreshold`. */
  name: string;
  /**
   * What the committed file records, in this gate's own unit — ms for an import,
   * a fraction of a collect budget for the band.
   */
  recorded: number;
  /** What the measurement saw, in the same unit. */
  measured: number;
}

/**
 * The recorded import baselines that are stale-high against a measurement.
 *
 * The one place the import predicate is applied to a whole set of baselines, so the
 * warning a single run leaves, the repeated session's report and the stale callout
 * in a proposal cannot come to disagree about which module is loose.
 *
 * `measured` is the dearest reading each tracked module produced — across the run's
 * files, or across a session's samples. Judging against the dearest is what makes
 * the answer "every measurement agreed": the threshold rises with the measurement,
 * so a baseline that is stale against the largest reading is stale against all of
 * them, and one cheap sample can never be what condemns a gate.
 *
 * A module the measurement never mentions is not judged: no measurement is not a
 * measurement of zero, and a rename must not quietly drop a baseline from the
 * check.
 */
export function staleHighBaselines(
  recorded: Readonly<Record<string, number>>,
  measured: Readonly<Record<string, number>>,
): StaleGate[] {
  const stale: StaleGate[] = [];
  for (const tracked of TRACKED_IMPORTS) {
    const was = recorded[tracked];
    const cost = measured[tracked];
    if (was === undefined || cost === undefined) continue;
    if (!staleBaseline(was, cost)) continue;
    stale.push({ kind: "import", name: tracked, recorded: was, measured: cost });
  }
  return stale;
}

/**
 * The clearance below which the warning band is never called too loose, as a
 * fraction of a collect budget.
 *
 * Additive where the import check's is a factor, because a fraction is bounded:
 * four times a tightest file of 0.3 is more than the whole budget, so a ratio here
 * would never fire at all. What matters is how much of a budget the band sits above
 * the tightest file a run saw — a band that warns at 90% of a budget while the
 * tree's worst file uses a third is not warning anyone of anything.
 *
 * Calibrated against real full-suite runs, whose tightest file lands anywhere from
 * 0.34 to 0.52 of its budget depending on how loaded the machine is: the committed
 * band is then 0 to 0.08 above what the recorder would set it to, while a band
 * raised by hand to 0.9 is 0.18 to 0.36 above it. Fifteen points of a budget clears
 * that gap, and — because the band is only judged against a run that got within
 * `MIN_SOFT_THRESHOLD` of a budget — it is also more than the committed band can
 * ever be moved, so machine speed and load alone can never fail it.
 */
const STALE_BAND_CLEARANCE = 0.15;

/**
 * The headroom over the tightest file past which the warning band is called stale,
 * as a fraction of a budget.
 *
 * The boundary the check below actually draws, in the units the run summary shows:
 * `staleSoftBand` judges the drop the recorder would make, and `nextSoftThreshold`
 * keeps the band `SOFT_THRESHOLD_MARGIN` above the run's tightest file, so the
 * headroom at which the band is called loose is the two constants added up. Exported
 * and published in the run report for one reason: the summary can then show how much
 * headroom counts as too much, rather than a Node script copying either constant out
 * of this module and drifting from the gate it is describing.
 */
export const STALE_BAND_HEADROOM = STALE_BAND_CLEARANCE + SOFT_THRESHOLD_MARGIN;

/**
 * Whether the recorded warning band sits far above the tightest file a measurement saw.
 *
 * The band's job is to warn *before* a file breaches, so one that warns far later
 * than the tree needs is as useless as one that is too tight — and it is the
 * direction the ratchet moves only when someone happens to run the recorder, since
 * `nextSoftThreshold` lowers it and never raises it. The drop the recorder *would*
 * make against this measurement is the honest size of the looseness, so that is
 * what is measured: a band the recorder would not move is never called loose, by
 * construction rather than by a second opinion.
 *
 * A run whose tightest file never reached `MIN_SOFT_THRESHOLD` is not judged at all.
 * The recorder would clamp its target to that floor rather than to the tree, so the
 * comparison would be against the floor — and every focused run, whose one file is
 * nowhere near its ceiling, would then "prove" the committed band loose.
 */
export function staleSoftBand(threshold: number, worst: number): boolean {
  if (worst < MIN_SOFT_THRESHOLD) return false;
  return threshold - nextSoftThreshold(threshold, worst) > STALE_BAND_CLEARANCE;
}

/**
 * Every recorded gate a measurement found too loose — the imports and the band.
 *
 * The one place the decision is made, so the warning a single run prints, the run
 * report the repeated session's gate reads and the stale callout in a proposal all
 * name the same loose gates.
 *
 * `sample` is a run's measurement: each tracked module's dearest import, and
 * `tightest`, the fraction of its budget the worst file used. A session passes the
 * worst case of its samples, which is what makes the answer "every measurement
 * agreed" — the import threshold rises with the measurement, and the band only
 * looks looser as the tightest file falls, so a gate that is loose against the
 * worst case is loose against every reading that went into it.
 */
export function staleGates(baselines: CommittedBaselines, sample: CollectSample): StaleGate[] {
  const stale = staleHighBaselines(baselines.importBaselines, sample.measured);
  if (staleSoftBand(baselines.softThreshold, sample.tightest)) {
    stale.push({
      kind: "band",
      name: "softThreshold",
      recorded: baselines.softThreshold,
      measured: sample.tightest,
    });
  }
  return stale;
}

/**
 * The ratchet: the baselines with each measured module lowered to the run's
 * cost, never raised.
 *
 * A recorded cost is rounded to whole milliseconds, which the margin dwarfs. A
 * module the run did not import keeps its baseline; a module the baseline file
 * does not yet name is added. Raising a baseline is deliberately not possible
 * here — a regression has to be fixed, or the number lifted by hand — so the
 * recorder can only ever tighten the gate.
 */
export function lowerImportBaselines(
  existing: Readonly<Record<string, number>>,
  measured: Readonly<Record<string, number>>,
): Record<string, number> {
  const next: Record<string, number> = { ...existing };
  for (const [module, cost] of Object.entries(measured)) {
    const recorded = Math.round(cost);
    const current = next[module];
    if (current === undefined || recorded < current) next[module] = recorded;
  }
  return next;
}

/**
 * One propose-mode measurement: what a single full run saw.
 *
 * The raw quantity a repeated proposal is aggregated from, rather than the
 * proposal itself — the aggregation takes the worst case, and the worst case of
 * "the dearest import was 8ms" is a number that can still be fed to the same
 * ratchet a single run uses.
 */
export interface CollectSample {
  /** Each tracked module's dearest import cost this run, in ms. */
  measured: Record<string, number>;
  /** The run's tightest file, as a fraction of the collect budget it had. */
  tightest: number;
}

/**
 * The aggregation that makes a proposal noise-proof: the worst case any sample
 * saw.
 *
 * A drop is only posted when *every* run measured it, which is the maximum of the
 * samples — taking the largest is taking the least aggressive proposal. A single
 * run whose machine was briefly idle is exactly the noise this absorbs, and the
 * cost of insisting on a confirmed number is only that the ratchet turns a little
 * later than the luckiest run alone would have turned it.
 *
 * A module no sample imported is left out, so the ratchet keeps its recorded
 * value rather than being handed a zero to fall to.
 */
export function aggregateSamples(samples: CollectSample[]): CollectSample {
  const measured: Record<string, number> = {};
  let tightest = 0;
  for (const sample of samples) {
    for (const [tracked, cost] of Object.entries(sample.measured)) {
      measured[tracked] = Math.max(measured[tracked] ?? 0, cost);
    }
    tightest = Math.max(tightest, sample.tightest);
  }
  return { measured, tightest };
}

/**
 * The baselines a measured sample earns, before any of it is written.
 *
 * The whole ratchet in one place: each tracked import to its measured cost, never
 * raised, and the soft threshold to a margin above the run's tightest file, never
 * raised. Shared by the recorder, the single-sample proposer and the repeated one
 * so none of them can disagree about the direction.
 */
function loweredFrom(before: CommittedBaselines, sample: CollectSample): CommittedBaselines {
  return {
    importMarginMs: before.importMarginMs,
    softThreshold: nextSoftThreshold(before.softThreshold, sample.tightest),
    importBaselines: lowerImportBaselines(before.importBaselines, sample.measured),
  };
}

/**
 * Where the repeated propose runs leave the samples the reporter reads back.
 *
 * A directory the launcher clears before its first run, so the samples present are
 * exactly that session's — a stale file from an earlier propose run would be
 * folded into this one's worst case and quietly hold a real drop back.
 */
const SAMPLE_DIR = ".collect-budget-samples";

/** The path of the sample directory, resolved from the run's directory. */
function sampleDirPath(): string {
  return join(process.cwd(), ".freebuff", SAMPLE_DIR);
}

/**
 * Leave this run's sample and read back every sample the session has written.
 *
 * The aggregation happens in the reporter rather than in the launcher because the
 * ratchet is here, and re-implementing it in plain Node is how the two would come
 * to disagree. So each run of the session folds its own sample in and rewrites
 * the proposal; after the launcher's last run the proposal on disk is the one
 * aggregate over all of them, and the launcher only has to read it.
 */
function accumulateSample(index: number, sample: CollectSample): CollectSample[] {
  const dir = sampleDirPath();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${index}.json`), `${JSON.stringify(sample)}\n`);
  return readdirSync(dir)
    .filter((entry) => /^\d+\.json$/.test(entry))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((entry) => JSON.parse(readFileSync(join(dir, entry), "utf8")) as CollectSample);
}

/**
 * How many runs the propose session set out to take, for the run report.
 *
 * The launcher declares its target as it starts each run, so a session that came up
 * short can be told apart from a complete one — `npm run collect:stale` fails
 * closed on a partial session rather than judging a baseline the missing runs might
 * have contradicted. A plain `npm run collect:propose` declares nothing and is its
 * own single run, which is exactly what it is.
 */
function proposalRunTarget(samples: number): number {
  const declared = Number.parseInt(process.env.COLLECT_PROPOSAL_RUNS ?? "", 10);
  return Number.isFinite(declared) && declared > 0 ? declared : samples;
}

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
 * The recorder writes this, and a test compares it to the committed file, so the
 * checked-in baselines cannot drift from what the recorder would write — the same
 * contract `npm run skill:index` keeps for its generated index.
 */
export function renderBaselines(committed: CommittedBaselines = COMMITTED_BASELINES): string {
  const rows = Object.keys(committed.importBaselines)
    .sort()
    .map((module) => `  ${JSON.stringify(module)}: ${committed.importBaselines[module]},`)
    .join("\n");
  return (
    `${BASELINE_HEADER}\n\n` +
    `export const importMarginMs = ${committed.importMarginMs};\n\n` +
    `export const softThreshold = ${committed.softThreshold};\n\n` +
    `export const importBaselines = {\n${rows}\n};\n`
  );
}

/** One value the recorder would lower, for the proposal. */
export interface ProposedChange {
  /** Which recorded value it is: a scanner's import cost, or the warning band. */
  kind: "import" | "band";
  /** The value's name: `softThreshold`, or a tracked module's path. */
  name: string;
  /** What the committed file holds, or undefined when the value is new. */
  from: number | undefined;
  /** What the recorder would lower it to. */
  to: number;
  /**
   * Whether the committed value was *stale-high*: so far above what the run
   * measured that the collect-budget gate is failing on it right now, rather
   * than an honest value being nudged down.
   *
   * The two look identical in a diff — the ratchet lowers a stale baseline like
   * any other — but they mean opposite things to a reviewer. An ordinary drop is
   * optional housekeeping; a stale baseline is a gate that is currently red, and
   * applying it is what turns the run green again.
   */
  stale: boolean;
}

/**
 * The lowerings between two sets of baselines, a tracked module name apart.
 *
 * A value only appears when the run beat the committed one, so an empty list is
 * the honest "nothing to propose" — the same direction `lowerImportBaselines`
 * and `nextSoftThreshold` enforce, read back out as a diff.
 *
 * `measured` and `tightest` are what the run saw — each tracked module's dearest
 * import, and the fraction of its budget the worst file used. They are the
 * quantities the staleness checks judge against, so the proposal can tell a loose
 * gate from a tidy-up. Both are optional: a caller that only wants the diff leaves
 * them out and nothing is marked stale, which is the conservative reading — a
 * change then claims no more than "this could be tighter". Which gates are loose is
 * `staleGates`'s answer, so the callout and the run report agree.
 */
export function proposalChanges(
  before: CommittedBaselines,
  after: CommittedBaselines,
  measured: Readonly<Record<string, number>> = {},
  tightest?: number,
): ProposedChange[] {
  const changes: ProposedChange[] = [];
  if (after.softThreshold < before.softThreshold) {
    changes.push({
      kind: "band",
      name: "softThreshold",
      from: before.softThreshold,
      to: after.softThreshold,
      stale: tightest === undefined ? false : staleSoftBand(before.softThreshold, tightest),
    });
  }
  const loose = new Set(staleHighBaselines(before.importBaselines, measured).map((e) => e.name));
  for (const tracked of Object.keys(after.importBaselines).sort()) {
    const from = before.importBaselines[tracked];
    const to = after.importBaselines[tracked];
    if (from === undefined || to < from) {
      changes.push({ kind: "import", name: tracked, from, to, stale: loose.has(tracked) });
    }
  }
  return changes;
}

/**
 * The proposal markdown — the body of the sticky pull-request comment.
 *
 * Mirrors `.freebuff/coverage-propose.mjs`'s output: a marker line so the workflow
 * can find and update the previous comment, a table of what would move, and a
 * closing line that says nothing is applied until a person runs the recorder. It
 * is written even when there is nothing to propose, so the artifact a workflow
 * uploads still records that the check ran.
 *
 * A stale-high baseline gets a callout of its own above the table. It is the one
 * row a reviewer must not read as housekeeping: the gate is failing on it, and
 * applying the proposal is the fix — so it is named rather than left to be
 * inferred from a committed number someone would have to know was too big.
 */
export function renderProposal(
  changes: ProposedChange[],
  applied: CommittedBaselines,
  samples: number = 1,
): string {
  if (changes.length === 0) {
    return (
      `${PROPOSAL_MARKER}\n## Collect-budget proposal\n\n` +
      "Nothing to record — no measured value beat its committed one. The gates " +
      "already sit at or below this run's numbers.\n"
    );
  }
  const stale = changes.filter((change) => change.stale);
  const rows = changes
    .map(
      (change) =>
        `| \`${change.name}\`${change.stale ? " **(stale)**" : ""} | ` +
        `${change.from ?? "—"} | ${change.to} |`,
    )
    .join("\n");
  return (
    `${PROPOSAL_MARKER}\n## Collect-budget proposal\n\n` +
    (stale.length > 0 ? staleNote(stale) : "") +
    "`npm run collect:record` ran against this change's measured collect times and would lower:\n\n" +
    "| value | committed | this run |\n| --- | --: | --: |\n" +
    `${rows}\n\n` +
    (samples > 1
      ? `Every value here held across ${samples} runs: the proposal is the worst ` +
        "case any of them measured, so one quietly fast machine cannot post a " +
        "tightening the others did not confirm.\n\n"
      : "") +
    "Nothing here is applied — a lower number only *tightens* a gate. Run " +
    "`npm run collect:record` locally and commit the result, or reply " +
    `\`${APPLY_COMMAND}\` to open a pull request that applies exactly these values.\n\n` +
    // The machine-readable half: the apply step reads these values out of the
    // comment rather than re-measuring, so what was approved is what is applied.
    `${renderProposalState(applied)}\n`
  );
}

/**
 * The callout for a proposal's stale-high baselines, or nothing when there are none.
 *
 * Called out above the table rather than folded into it because a stale baseline
 * is the one row that is not optional: the committed number is so far above what
 * the run measured that the gate is failing on it, and the same approve-and-apply
 * reply that applies an ordinary tightening is what clears the failure. A reviewer
 * who read only the table would take a red gate for a housekeeping nit.
 */
/** A fraction of a collect budget, as the percentage a person reads it as. */
function percent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

/**
 * One stale change as a line of the callout, in the units its value is recorded in.
 *
 * A band is a fraction of a budget and an import is milliseconds, so the two cannot
 * share a sentence: `recorded at 0.58ms` is a different claim from `recorded at
 * 58%`. The kind is what picks the reading.
 */
function staleChangeLine(change: ProposedChange): string {
  if (change.kind === "band") {
    // `to` is the band the recorder would *set* — one margin above the tightest
    // file — not the tightest file itself, so the line says that rather than
    // claiming a measurement it does not hold.
    return (
      `> - the warning band is recorded at ${percent(change.from)} of a budget; the ` +
      `recorder would set it to ${percent(change.to)}`
    );
  }
  return `> - \`${change.name}\` — recorded at ${change.from}ms, this run measured ${change.to}ms`;
}

function staleNote(stale: ProposedChange[]): string {
  const rows = stale.map(staleChangeLine).join("\n");
  return (
    "> **A loose gate, not a tidy-up.** " +
    (stale.length === 1 ? "This recorded value is" : "These recorded values are") +
    " *stale-high*: the committed number sits far above what the run measured, " +
    "which is the direction the collect-budget gate fails a run on. Applying " +
    "the values below is not optional housekeeping — it is what turns the build " +
    "green again.\n>\n" +
    `${rows}\n\n`
  );
}

/** Where the checked-in baseline file lives, resolved from the run's directory. */
function baselineFilePath(): string {
  return join(process.cwd(), ".freebuff", "collect-budget-baselines.mjs");
}

/** Where the proposal markdown is written, resolved from the run's directory. */
function proposalFilePath(): string {
  return join(process.cwd(), ".freebuff", "collect-budget-proposal.md");
}

/** The one-field state file the launcher reads to set its `earned` output. */
function proposalStatePath(): string {
  return join(process.cwd(), ".freebuff", ".collect-budget-proposal.json");
}

/** The lines the report prints, worst overrun first. */
function formatBreaches(breaches: BudgetBreach[], median: number): string {
  const rows = [...breaches]
    .sort((a, b) => b.ms / b.budget - a.ms / a.budget)
    .map(
      (breach) =>
        `  ${breach.ms.toFixed(0).padStart(6)}ms  ` +
        `over ${String(Math.round(breach.budget)).padStart(5)}ms  ` +
        `${breach.kind.padEnd(7)}  ${breach.file}  (${breach.detail})`,
    )
    .join("\n");
  return (
    `collect-budget: ${breaches.length} breach(es) at a run median of ` +
    `${median.toFixed(0)}ms — a budget was crossed\n` +
    `${rows}\n` +
    "A file that suddenly costs much more to collect usually means an eager import " +
    "or a `?raw` glob came back. Read the shared index on demand instead. A `collect` " +
    "breach wants the multiple in `src/test/collect-budget.ts` raised deliberately; an " +
    "`import` breach is a tracked scanner being read eagerly again.\n"
  );
}

/** The one-line summary the recorder prints for each tracked module. */
function recordLine(
  tracked: string,
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  measured: Readonly<Record<string, number>>,
): string {
  const saw = measured[tracked];
  const was = before[tracked];
  const now = after[tracked];
  const change =
    now === undefined
      ? "left unnamed (not imported this run)"
      : was === undefined
        ? `added ${now}ms`
        : now < was
          ? `lowered ${was}ms -> ${now}ms`
          : `kept ${now}ms`;
  return `  ${tracked}: ${change}${saw === undefined ? "" : ` (measured ${saw.toFixed(1)}ms)`}`;
}

/** The one-line summary the recorder prints for the soft threshold. */
function recordThresholdLine(before: number, after: number, tightest: number): string {
  const change = after < before ? `lowered ${before} -> ${after}` : `kept ${after}`;
  return `  softThreshold: ${change} (tightest file ${tightest.toFixed(2)} of its budget)`;
}

/**
 * The end-of-run notice: the files nearest their budget, on every run so a creep
 * is visible before it breaches.
 *
 * Written to stderr: the CI runner gives Vitest's JSON reporter stdout and parses
 * it, so a stray line there would corrupt the report.
 */
function formatTightest(rows: CollectRow[], median: number, total: number): string {
  if (rows.length === 0) return "";
  const lines = rows
    .map(
      (row) =>
        `  ${`${Math.round(row.used * 100)}%`.padStart(4)} of ` +
        `${String(Math.round(row.ceiling)).padStart(5)}ms  ` +
        `${row.collect.toFixed(0).padStart(6)}ms  ${row.file}`,
    )
    .join("\n");
  return (
    `collect-budget: the files nearest their collect budget out of ${total} ` +
    `(run median ${median.toFixed(0)}ms) — watch these for a creeping regression\n` +
    `${lines}\n`
  );
}

/**
 * The soft-gate block: the files near their budget, which do not fail the run but
 * are what to look at before the next change trips the hard gate.
 */
function formatSoftGate(
  warnings: CollectRow[],
  threshold: number,
  median: number,
  total: number,
): string {
  const lines = warnings
    .map(
      (row) =>
        `  ${`${Math.round(row.used * 100)}%`.padStart(4)} of ` +
        `${String(Math.round(row.ceiling)).padStart(5)}ms  ` +
        `${row.collect.toFixed(0).padStart(6)}ms  ${row.file}`,
    )
    .join("\n");
  return (
    `collect-budget: ${warnings.length} of ${total} file(s) at or over ` +
    `${Math.round(threshold * 100)}% of their collect budget ` +
    `(run median ${median.toFixed(0)}ms) — still green, but close to the hard gate\n` +
    `${lines}\n`
  );
}

/** Where the soft-gate sidecar lives, resolved from the run's directory. */
function softGateFilePath(): string {
  return join(process.cwd(), ".freebuff", SOFT_GATE_FILE);
}

/**
 * Leave the soft-gate warnings where the CI runner can find them.
 *
 * A plain JSON sidecar rather than a line of stderr to parse: the runner already
 * reads its Vitest report the same way, and a warning naming a file with a space
 * or a colon in it would break a text parse but not this.
 */
function writeSoftGate(warnings: CollectRow[], threshold: number): void {
  writeFileSync(softGateFilePath(), `${JSON.stringify({ threshold, warnings }, null, 2)}\n`);
}

/** Drop a stale sidecar, so a warning from an earlier run cannot be re-reported. */
function clearSoftGate(): void {
  rmSync(softGateFilePath(), { force: true });
}

/** Where the run report lives, resolved from the run's directory. */
function runReportPath(): string {
  return join(process.cwd(), ".freebuff", RUN_REPORT_FILE);
}

/**
 * Leave the run report where its three readers can find it.
 *
 * A plain JSON sidecar rather than a line of stderr, for the same reason the soft
 * gate uses one: the CI runner captures a passing run's stderr and never prints it.
 * It is written on *every* run that judged the baselines — including the ones that
 * found nothing loose — because `npm run collect:stale` has to tell "judged and
 * clean" apart from "never judged at all", and the second must not pass; and
 * because `npm run collect:gates` publishes the measurement, which is worth seeing
 * precisely on the green runs where nothing is wrong yet.
 *
 * `tightest` rides along so the summary can show the *other* half of the gate: the
 * recorded warning band against the file nearest its budget, which otherwise only
 * appears in the report when the band is stale. The imports are a table here and the
 * band is one number, so a run that never came near either is the one a reader most
 * needs to see both halves on.
 */
function writeRunReport(
  runs: number,
  samples: number,
  measured: Readonly<Record<string, number>>,
  tightest: number,
  stale: StaleGate[],
): void {
  // `importStaleAbove`, `staleBandHeadroom` and `bandJudgedFrom` are the reporter's
  // own rule rather than measurements: the cost a recorded baseline may sit at before
  // this run calls it stale, the headroom past which the band is called loose, and the
  // tightest file a run must reach before the band is judged at all. They ride here so
  // the run summary can print the boundaries the gate enforces — and the word for a
  // run that never reached one — rather than a second copy that could drift. The same
  // reason the measured columns read this file.
  //
  // The per-import threshold is built with the same `staleThreshold` the check calls,
  // so the number a reader compares a baseline against is the one that judged it.
  const importStaleAbove = importStaleThresholds(measured);
  writeFileSync(
    runReportPath(),
    `${JSON.stringify(
      {
        runs,
        samples,
        measured,
        importStaleAbove,
        tightest,
        staleBandHeadroom: STALE_BAND_HEADROOM,
        bandJudgedFrom: MIN_SOFT_THRESHOLD,
        stale,
      },
      null,
      2,
    )}\n`,
  );
}

/** Drop the report, so a run that does not judge cannot leave an earlier one's. */
function clearRunReport(): void {
  rmSync(runReportPath(), { force: true });
}

/**
 * The staleness warning: the recorded baselines looser than this run measured.
 *
 * A warning rather than a failure on purpose. One run is one sample of a
 * wall-clock quantity, so a loose gate is only *confirmed* when a repeated session
 * agrees on it; a lone reading is printed loudly and annotated, and
 * `npm run collect:stale` is what fails on it.
 */
/** One recorded gate's two numbers, in the units that gate is recorded in. */
function staleNumbers(entry: StaleGate): { was: string; now: string } {
  return entry.kind === "band"
    ? { was: percent(entry.recorded), now: percent(entry.measured) }
    : { was: `${entry.recorded}ms`, now: `${entry.measured.toFixed(1)}ms` };
}

function formatStale(stale: StaleGate[]): string {
  const rows = stale
    .map((entry) => {
      const { was, now } = staleNumbers(entry);
      const label = entry.kind === "band" ? "worst file" : "measured";
      return `  recorded ${was.padStart(7)}  ${label} ${now.padStart(7)}  ${entry.name}`;
    })
    .join("\n");
  return (
    `collect-budget: ${stale.length} recorded gate(s) are looser than this run ` +
    "measured — a warning, not a failure\n" +
    `${rows}\n` +
    "One run is not evidence enough to fail on. `npm run collect:propose` runs the " +
    "suite repeatedly and fails when every run agrees; `npm run collect:record` " +
    "lowers the recorded value now.\n"
  );
}

/**
 * The reporter itself: turns each module's `diagnostic()` into a `ModuleTiming`,
 * asks `collectBudgetBreaches`, and fails the process when anything is over.
 *
 * Two modes, chosen by `COLLECT_BASELINE_RECORD`, which only
 * `npm run collect:record` sets: normally it is a read-only gate and never writes
 * a file; in record mode it lowers the tracked-import baselines and returns
 * without failing. Keeping the recorder behind an environment variable rather
 * than a normal-run side effect is what lets every other run — including CI —
 * treat the checked-in baseline as read-only.
 *
 * A *loose* gate is the one thing no single run fails on. It is judged apart from
 * the breaches, reported as a warning, and left in a sidecar; the repeated
 * `collect:propose` session is what confirms it, and `npm run collect:stale` is
 * what fails on a confirmation. That is the same shape the proposal already uses
 * for a drop — measure several times, act only on what every run agrees to.
 *
 * `process.exitCode = 1` is the same lever Vitest pulls for a failed test, and
 * it is set here rather than throwing because a reporter error is swallowed into
 * an "unhandled reporter error" warning that does not fail the run.
 */
export class CollectBudgetReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const timings: ModuleTiming[] = modules.map((entry) => {
      const diagnostic = entry.diagnostic();
      return {
        file: projectPath(entry.moduleId),
        collect: diagnostic.collectDuration,
        imports: Object.entries(diagnostic.importDurations ?? {}).map(([file, duration]) => ({
          path: projectPath(file),
          total: duration.totalTime,
        })),
      };
    });

    // Computed once and passed to every consumer, so the number the reports
    // print is the number the ceilings were built from.
    const median = medianCollect(timings);

    if (process.env.COLLECT_BASELINE_RECORD) {
      this.record(timings, median);
    } else if (process.env.COLLECT_BASELINE_PROPOSE) {
      this.propose(timings, median);
    } else {
      const breaches = collectBudgetBreaches(timings, median);
      if (breaches.length > 0) {
        process.exitCode = 1;
        process.stderr.write(formatBreaches(breaches, median));
      }
      // Judged apart from the breaches and never fatal: a recorded value that has
      // gone too loose is the one finding a single run may not fail on. The report is
      // left for `npm run collect:stale`, which confirms it across a repeated session
      // — so `runs` and `samples` are both one here, and that step refuses a report
      // this thin rather than reading it as a clean bill. It is written even when
      // nothing is loose, because the summary publishes the measurement and the gate
      // step tells "judged clean" from "never judged".
      const sample: CollectSample = {
        measured: measuredImportCosts(timings),
        tightest: worstUsed(timings, median),
      };
      const stale = staleGates(COMMITTED_BASELINES, sample);
      writeRunReport(1, 1, sample.measured, sample.tightest, stale);
      if (stale.length > 0) process.stderr.write(formatStale(stale));
    }

    // Always last: the files nearest their budget, so a creep shows up on the
    // green runs that come before it breaches, not only on the red one after.
    // Past the soft threshold the notice becomes a warning — still green, but
    // left where the CI runner turns it into an annotation.
    const warnings = softWarnings(timings, median);
    if (warnings.length > 0) {
      const threshold = COMMITTED_BASELINES.softThreshold;
      writeSoftGate(warnings, threshold);
      process.stderr.write(formatSoftGate(warnings, threshold, median, timings.length));
    } else {
      clearSoftGate();
      process.stderr.write(
        formatTightest(slowestCollects(timings, median), median, timings.length),
      );
    }
  }

  /**
   * The baselines this run's measurements earn: what it would lower, before any
   * of it is written.
   *
   * Shared by the recorder and the proposer so they cannot disagree — the one
   * writes the result to the checked-in file, the other only describes it.
   */
  private lowered(
    timings: ModuleTiming[],
    median: number,
  ): {
    before: CommittedBaselines;
    after: CommittedBaselines;
    measured: Record<string, number>;
    tightest: number;
  } {
    const before = COMMITTED_BASELINES;
    const measured = measuredImportCosts(timings);
    const tightest = worstUsed(timings, median);
    const after = loweredFrom(before, { measured, tightest });
    return { before, after, measured, tightest };
  }

  /**
   * Lower the recorded baselines to what this run measured, and write them.
   *
   * Two values move: each tracked import to the run's dearest cost, and the soft
   * threshold to a margin above the run's tightest file. Both only ever fall.
   */
  private record(timings: ModuleTiming[], median: number): void {
    const { before, after, measured, tightest } = this.lowered(timings, median);
    const path = baselineFilePath();
    writeFileSync(path, renderBaselines(after));
    // Nothing is loose once this has run, and a report from before it ran would
    // only be describing baselines that no longer exist.
    clearRunReport();
    const lines = [
      ...TRACKED_IMPORTS.map((tracked) =>
        recordLine(tracked, before.importBaselines, after.importBaselines, measured),
      ),
      recordThresholdLine(before.softThreshold, after.softThreshold, tightest),
    ];
    process.stderr.write(`collect-budget: recorded baselines to ${path}\n${lines.join("\n")}\n`);
  }

  /**
   * Describe what the recorder *would* lower, without writing the checked-in file.
   *
   * What a pull request runs: the measurement happens here, in the reporter, but
   * the decision to apply it stays with a person, so nothing under version control
   * is touched. A proposal and a small state file are left for the launcher.
   *
   * The measurement is repeated — the launcher runs the suite several times — so a
   * drop has to hold across every run before it is posted. `COLLECT_PROPOSAL_SAMPLE`
   * is what tells this run it is part of such a session: it names the sample to
   * leave, and the reporter then proposes from the worst case of every sample the
   * session has left so far. Without it (a plain `npm run collect:propose`) the
   * run is its own single sample, exactly as before.
   */
  private propose(timings: ModuleTiming[], median: number): void {
    const before = COMMITTED_BASELINES;
    const sample: CollectSample = {
      measured: measuredImportCosts(timings),
      tightest: worstUsed(timings, median),
    };
    const index = process.env.COLLECT_PROPOSAL_SAMPLE;
    const samples = index === undefined ? [sample] : accumulateSample(Number(index), sample);
    const aggregate = aggregateSamples(samples);
    const after = loweredFrom(before, aggregate);
    // The aggregate's measurement is what the ratchet saw, so it is also what
    // decides whether a committed baseline was stale-high — the gate judges the
    // same quantity, so a proposal cannot call a gate loose that a run would pass.
    const changes = proposalChanges(before, after, aggregate.measured, aggregate.tightest);
    writeFileSync(proposalFilePath(), renderProposal(changes, after, samples.length));
    writeFileSync(
      proposalStatePath(),
      `${JSON.stringify({ changed: changes.length > 0, samples: samples.length }, null, 2)}\n`,
    );
    // The same aggregate that earned the drop judges the loose gate, so the session
    // that confirms a tightening also confirms a stale-high baseline — and
    // `npm run collect:stale` fails on the second without re-measuring anything.
    // `runs` is the session's target, so a session that came up short is visible to
    // that step rather than passing as a complete one.
    writeRunReport(
      proposalRunTarget(samples.length),
      samples.length,
      aggregate.measured,
      aggregate.tightest,
      staleGates(before, aggregate),
    );
    process.stderr.write(
      `collect-budget: wrote a proposal with ${changes.length} change(s) from ` +
        `${samples.length} sample(s) to ${proposalFilePath()}\n`,
    );
  }
}

// Vitest loads a reporter named by path — from `--reporter=…` or the config's
// `reporters` — through the module's *default* export, and constructs it. The
// named export stays for the test that drives the budget logic directly.
export default CollectBudgetReporter;
