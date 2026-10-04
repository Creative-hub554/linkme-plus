import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { COVERAGE_STRIKES } from "../../.freebuff/coverage-strikes.mjs";
import { MUTATIONS } from "./coverage-mutations";

/**
 * Every mutation table the CI suites keep, and the hand-written declaration held against it.
 *
 * A mutation table is a *count*, and each sweep reports the cases it saw — never the cases there
 * should have been — so an entry deleted from a table shrinks what is swept while every remaining
 * case passes and the stage reads green. That hole is the same in every family, so the repair is
 * stated once here rather than re-derived per sweep: `DECLARED_TABLES` pairs each table with a
 * hand-written declaration (the authority — a copy regenerated from the table would hold nothing)
 * and a `read` that answers the table fresh, and `holdDeclaredTable` holds the two together, both
 * ways, with each declared anchor pinned to the file the strike splices into. A sweep added to the
 * chain needs a declaration here and no new case: `src/test/declared-strikes.test.ts` generates
 * one from this list.
 *
 * The declarations are deliberately not derived from the readers. The point is that a *person*
 * decided the table's contents, so a strike the sweep gains without a declaration, and a
 * declaration the sweep no longer carries, are both failures — the shape `EXPECTED_GUARDS` and the
 * three strike lists each took on their own before this module collected them.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const guardsSweep = path.join(projectRoot, ".freebuff", "mutation-guards.mjs");
const preflightSweep = path.join(projectRoot, ".freebuff", "mutation-preflight.mjs");

/**
 * One entry of a declared table.
 *
 * `name` is the string the sweep enumerates the strike under; `anchor` is a line the strike
 * splices into, held to exactly one occurrence in `source` when it is given; `replace` is what the
 * strike swaps in, held to differ from the anchor so a "weakening" that weakens nothing is a
 * failure rather than a quiet no-op; and `source` is the file the anchor lives in, relative to the
 * project root, defaulting to the table's own.
 */
export interface DeclaredStrike {
  name: string;
  anchor?: string;
  replace?: string;
  source?: string;
}

/** A mutation table, the declaration held against it, and how to read the table fresh. */
export interface DeclaredTable {
  /** What is held, for the generated case's name and the failure messages. */
  sweep: string;
  /** The hand-written declaration — the authority, never derived from the table. */
  declared: readonly DeclaredStrike[];
  /** Reads the strikes the table really carries; may spawn the sweep, and runs fresh each time. */
  read: () => DeclaredStrike[];
  /** Shown when the two lists disagree, in the sweep's own words. */
  message: string;
  /** The file an entry's `anchor` is held against when the entry names none. */
  source?: string;
}

/** The guards that must be registered — a guard missing here is unchecked. */
export const EXPECTED_GUARDS = [
  "mount",
  "settle",
  "body-clear",
  "stylesheet",
  "beat-seam",
  "beat-clock",
  "runbook",
  "client-env",
  "public-vocabulary",
  "client-config",
  "stale-stage-lists",
];

/**
 * Runs a sweep under its own lock (the sweep reads a lock before it does anything, `--list`
 * included) so a test never touches — or heals — the lock a real run holds.
 */
function withScratchLock<T>(run: (lockFile: string) => T): T {
  const workdir = mkdtempSync(path.join(tmpdir(), "declared-strikes-"));
  try {
    return run(path.join(workdir, "lock.json"));
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/**
 * The `--list` names a self-mutation sweep enumerates under one file, as `{ name }` rows. `--list`
 * prints one line per strike, `<file>  <name>`; `key` turns the name into the unit the declaration
 * counts (a convention detector's guard id, before its `:`), and duplicates collapse when `key`
 * does so.
 */
function sweepList(
  args: string[],
  prefix: string,
  key: (name: string) => string = (name) => name,
): DeclaredStrike[] {
  return withScratchLock((lockFile) => {
    const result = spawnSync(process.execPath, [guardsSweep, "--list", ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: lockFile },
    });
    expect(
      result.error,
      `could not run ${guardsSweep}: ${result.error?.message ?? ""}`,
    ).toBeUndefined();
    expect(result.status, `the sweep's --list run failed:\n${result.stderr ?? ""}`).toBe(0);
    return (result.stdout ?? "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith(prefix))
      .map((line) => ({ name: key(line.slice(prefix.length)) }));
  });
}

/**
 * The preflight sweep's case ids. `--list --json` answers from the table without applying a
 * mutation and reports every entry whether or not its anchor still fits, so the ids are held even
 * on a tree whose anchors have drifted; the exit code is not read because a drifted anchor is
 * exactly the state the payload already names.
 */
function preflightIds(): DeclaredStrike[] {
  return withScratchLock((lockFile) => {
    const result = spawnSync(process.execPath, [preflightSweep, "--list", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, MUTATION_LOCK_FILE: lockFile },
    });
    expect(
      result.error,
      `could not run ${preflightSweep}: ${result.error?.message ?? ""}`,
    ).toBeUndefined();
    const payload = JSON.parse(result.stdout || "{}") as { anchors?: { id: string }[] };
    return (payload.anchors ?? []).map((anchor) => ({ name: anchor.id }));
  });
}

/** The guard id a convention mutation's name begins with, before its `:`. */
function guardId(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(0, colon);
}

export const DECLARED_TABLES: readonly DeclaredTable[] = [
  {
    sweep: "the convention detectors",
    declared: EXPECTED_GUARDS.map((name) => ({ name })),
    read: () => {
      const rows = sweepList(
        ["--file=convention-guards"],
        "src/test/convention-guards.ts  ",
        guardId,
      );
      // Several detector mutations can weaken one guard — a limb each — so the table is counted
      // by guard, the unit the declaration names.
      return [...new Set(rows.map((row) => row.name))].map((name) => ({ name }));
    },
    message:
      "A convention guard has no detector mutation in CONVENTION_MUTATIONS " +
      "(.freebuff/mutation-guards.mjs), so the sweep never weakens it and it can stop firing " +
      "while its file still passes. Add `<guard id>: …` beside the others.",
  },
  {
    sweep: "the runner",
    source: ".freebuff/ci.mjs",
    declared: [
      {
        name: "global-force: the runner reports no GLOBAL_FORCE entry that matches no file",
        anchor: "function forceAbsences(files) {",
      },
      {
        name: "dead-input: the runner reports no stage input that matches no file",
        anchor: "function inputAbsences(files) {",
      },
      {
        name: "stage-order: the runner reports no copy of the stage order that disagrees with the table",
        anchor: "function stageOrderFindings(root = stageOrderRoot, watchGlobs = []) {",
      },
      {
        name: "commentary: the runner reports no stage-order claim written in the tree's commentary",
        anchor: "function stageCommentaryFindings(root, seen) {",
      },
      {
        name: "commentary-scan: the runner reads no source file's commentary for a stage-order claim",
        anchor: "function commentaryFiles(dir, out = []) {",
      },
      {
        name: "commentary-read: the commentary pass reads raw bytes, so a fixture string becomes a claim",
        anchor: "function commentary(source) {",
      },
      {
        name: "suite-failure: the runner names nothing that failed outside the test list",
        anchor: "function failureOutsideTests(report) {",
      },
      {
        name: "parse-silence: the runner names no stage script it cannot parse",
        anchor: "async function unparsableScripts(stages) {",
      },
    ],
    read: () => sweepList([], ".freebuff/ci.mjs  "),
    message:
      "The runner's own answers and the strikes against them are one list: a report the runner " +
      "holds with no strike against it is a check that can go quiet while every test still " +
      "passes, and a strike for a report nobody decided to keep is the same drift read the other " +
      "way — add the strike (or the declaration), not one of the two.",
  },
  {
    sweep: "the shared lock",
    source: ".freebuff/mutation-lock.mjs",
    declared: [
      {
        name: "absorbed: the lock reports no file that still carries the mutation it recorded",
        anchor: "function absorbedStretch(entry, content) {",
      },
      {
        name: "absorbed-inserted: the lock stops finding the mutation by its inserted text alone",
        anchor: "  const inserted = flatten(splice.inserted);",
      },
    ],
    read: () => sweepList([], ".freebuff/mutation-lock.mjs  "),
    message:
      "The lock's answers and the strikes against them are one list: a lock answer with no strike " +
      "against it can go quiet while every test still passes, and a strike for an answer nobody " +
      "decided to keep is the same drift read the other way — add the strike (or the " +
      "declaration), not one of the two.",
  },
  {
    sweep: "the test helpers",
    source: "src/test/expect-gated.ts",
    declared: [
      {
        name: "expectGatedNone no-op",
        anchor: 'export function expectGatedNone(kind: "reads" | "writes" | "deletes") {',
      },
      {
        name: "expectGatedRead no-op",
        anchor: "export function expectGatedRead(table: TableLike, gate: Gate = {}) {",
      },
      {
        name: "expectGatedUpdate no-op",
        anchor: "export function expectGatedUpdate(table: TableLike, gate: Gate = {}) {",
      },
      {
        name: "expectGatedInsert no-op",
        anchor: "export function expectGatedInsert(table: TableLike, gate: InsertGate = {}) {",
      },
      {
        name: "expectGatedDelete no-op",
        anchor: "export function expectGatedDelete(table: TableLike, gate: Gate = {}) {",
      },
      {
        name: "locate always returns 0",
        anchor: "function locate(tables: string[], name: string, nth: number): number {",
      },
      {
        name: "assertWhere no-op",
        anchor: "function assertWhere(actual: string, expected: Sql | Sql[], table: string) {",
      },
      {
        name: "assertFirst no-op",
        anchor: "function assertFirst(index: number, name: string, kind: string) {",
      },
      {
        name: "expectGatedSequence no-op",
        anchor:
          'export function expectGatedSequence(\n  kind: "reads" | "deletes" | "writes",\n  expected: WriteExpectation[],\n) {',
      },
      {
        name: 'assertWhere treats `where: ""` as a substring match',
        anchor: 'if (expected === "") {',
      },
    ],
    read: () => sweepList(["--file=expect-gated"], "src/test/expect-gated.ts  "),
    message:
      "The helper's answers and the strikes against them are one list: a helper with no strike " +
      "against it can stop asserting while every test still passes, and a strike for a helper " +
      "nobody decided to keep is the same drift read the other way — add the strike (or the " +
      "declaration), not one of the two.",
  },
  {
    sweep: "the coverage gates",
    // Read from `.freebuff/coverage-strikes.mjs`, where the declaration also lives for the
    // launcher: one list, two consumers, so the opt-in run's count check and this both-way hold
    // cannot come to check different lists.
    declared: COVERAGE_STRIKES.map((strike) => ({
      name: `${strike.script}  ${strike.test}`,
      anchor: strike.find,
      replace: strike.replace,
      source: strike.script,
    })),
    read: () =>
      MUTATIONS.map((mutation) => ({
        name: `${mutation.script}  ${mutation.test}`,
        anchor: mutation.find,
        replace: mutation.replace,
      })),
    message:
      "The coverage gates' strikes and the declarations are one list: a strike the table gains " +
      "without an entry here is a gate nobody decided to check, and an entry the table no longer " +
      "has is a gate that has quietly stopped being swept — add the strike (or the declaration), " +
      "not one of the two.",
  },
  {
    sweep: "the preflight sweep",
    declared: [
      { name: "health/no-live-pid" },
      { name: "health/serving" },
      { name: "health/wedged" },
      { name: "health/foreign-port" },
      { name: "health/other-port-detail" },
      { name: "health/another-owners-port" },
      { name: "reach/fix-points-at-health" },
      { name: "owner/another-checkout-fails" },
      { name: "owner/names-the-process" },
      { name: "owner/lock-pid-is-ours" },
      { name: "owner/runs-this-checkout" },
      { name: "owner/unread-command-line" },
      { name: "owner/unidentified-is-not-a-pass" },
      { name: "owner/nothing-to-identify" },
      { name: "tab/unchecked" },
      { name: "tab/bad-list" },
      { name: "tab/ok-needs-a-tab" },
      { name: "tab/gone" },
      { name: "tab/died-behind-the-tab" },
      { name: "tab/nothing-to-accuse" },
      { name: "tab/tabs-shape" },
      { name: "tab/entry-shapes" },
      { name: "tab/unreadable-file" },
      { name: "loopback/brackets" },
      { name: "loopback/is-loopback" },
      { name: "loopback/parses" },
      { name: "loopback/127-0-0-1" },
      { name: "report/register-sentence" },
    ],
    read: preflightIds,
    message:
      "The preflight's cases and the declarations here are one list: a case the table gains " +
      "without an entry is a check nobody decided to sweep, and an entry the table no longer has " +
      "is a check that has quietly stopped being swept — add the case (or the declaration), not " +
      "one of the two.",
  },
  {
    sweep: "the declared-table ratchet",
    // The ratchet's own strike, held the way every other family's is — by name, read back from
    // the sweep's `--list` — so a ratchet quieted out of the sweep, or a declaration left behind
    // by a strike nobody kept, is a failing case in this very file. No anchor is declared, and it
    // cannot be: the strike's source is *this* file, so a verbatim anchor would occur once in
    // `holdDeclaredTable` and once as this declaration's own text, and the occurrence check
    // cannot tell the two apart. The anchor is held where every family's is anyway — the sweep
    // refuses before its first strike when an anchor no longer fits (`unfittedStrikes`/`--anchors`)
    // — so this declaration holds the name, the sweep holds the line, and the control in
    // `declared-strikes.test.ts` is what makes a quieted ratchet a failure at all.
    declared: [{ name: "ratchet: the declared-table hold returns before it compares anything" }],
    read: () => sweepList([], "src/test/declared-strikes.ts  "),
    message:
      "The ratchet's own strike and this declaration are one list: a `holdDeclaredTable` that " +
      "stopped holding would leave every generated case green over tables that are no longer " +
      "held, and a declaration for a strike nobody kept is the same drift read the other way — " +
      "add the strike (or the declaration), not one of the two.",
  },
];

/**
 * Holds one table against its declaration, both ways.
 *
 * The list comparison is a `toEqual` on sorted arrays, so a strike the table gained without a
 * declaration and a declaration the table no longer carries are the same red. Each declared
 * anchor is then held to the file it splices into — exactly once — because a renamed function
 * leaves a strike's declaration in place while the strike fits no line at all, which a run reports
 * as `anchor found 0 time(s) … skipped`, a line rather than a failure.
 */
export function holdDeclaredTable(table: DeclaredTable): void {
  const actual = table.read();

  expect(actual.map((row) => row.name).sort(), table.message).toEqual(
    table.declared.map((entry) => entry.name).sort(),
  );

  const byName = new Map(actual.map((row) => [row.name, row]));
  for (const entry of table.declared) {
    const row = byName.get(entry.name);
    if (entry.anchor === undefined) continue;

    if (row?.anchor !== undefined) {
      expect(
        row.anchor,
        `${table.sweep}: the table weakens a different line than the declaration names for ` +
          `"${entry.name}" — re-fit the declaration.`,
      ).toBe(entry.anchor);
    }
    if (entry.replace !== undefined) {
      expect(
        entry.replace,
        `${table.sweep}: "${entry.name}" swaps in its own anchor, so it weakens nothing.`,
      ).not.toBe(entry.anchor);
    }
    if (entry.replace !== undefined && row?.replace !== undefined) {
      expect(
        row.replace,
        `${table.sweep}: the table swaps in a different string than the declaration records ` +
          `for "${entry.name}" — re-fit the declaration.`,
      ).toBe(entry.replace);
    }

    const where = entry.source ?? table.source;
    if (where === undefined) {
      throw new Error(`${table.sweep}: "${entry.name}" declares an anchor but names no source`);
    }
    const text = readFileSync(path.resolve(projectRoot, where), "utf8");
    expect(
      text.split(entry.anchor).length - 1,
      `\`${entry.anchor}\` is gone (or written twice), so the "${entry.name}" strike no longer ` +
        `fits ${where} — re-fit the strike's anchor, or drop the strike and record why the ` +
        "table it belongs to needs none.",
    ).toBe(1);
  }
}
