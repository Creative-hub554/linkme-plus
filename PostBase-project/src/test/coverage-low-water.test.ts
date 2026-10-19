import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeScratchDir, removeScratchDir } from "./scratch";
// The job the proposal is opened by, read as text the way `coverage-history.test.ts` reads it: the
// steps below are the only place the invocation and its flags are stated outside this suite.
import nightlySource from "../../.github/workflows/nightly.yml?raw";
import {
  CONVENTION_GUARDS_READING,
  READINGS,
  RENDERED_LINKS_READING,
  SCRATCH_PATHS_READING,
  metricOf,
} from "../../.freebuff/coverage-readings.mjs";
// The paths are the module's own, never spelled a second time here: the low-water file is the one
// the command reads by default, and the two records it is derived from are the two surfaces the
// trend already names.
// The poster the nightly job leaves its nudge comment through, for the one thing a case has to
// derive from it rather than restate: where a body's redaction record lands beside it.
import { recordPathFor } from "../../.freebuff/pr-comment.mjs";
// The hidden marker the night's refuted-record comment carries and the two comment steps find it by —
// named by the module that renders the body rather than spelled here, so a body and a lookup that
// drifted apart fail the assertions below instead of quietly posting a second comment.
import { RECORD_COMMENT_MARKER } from "../../.freebuff/wait-drift-gate.mjs";
// The two markers a collect-budget proposal and the reply that answers it are found by — and the
// outcome vocabulary that reply declares itself with — named by the module that posts them rather than
// spelled a second time here: the shapes this suite hands the settlement command are built out of them,
// so a marker or a status word that moves moves these fixtures with it.
import {
  APPLY_REPLY_MARKER,
  APPLY_STATUSES,
  APPLY_STATUS_OPEN,
  PROPOSAL_MARKER,
} from "../../.freebuff/collect-apply.mjs";
import {
  ESCALATED_NIGHTS,
  HISTORY_FILE,
  LOW_WATER_FILE,
  LOW_WATER_PROPOSAL_FILE,
  NUDGE_COMMENT_FILE,
  RUNBOOK_FILE,
  STALE_NIGHTS,
  WAIT_COMMENT_FILE,
  collectProposalSettlement,
  collectProposalSettlements,
  derivedLowWater,
  floorProposalSettlement,
  floorProposalSettlements,
  settlementBand,
  mentionOf,
  nightsBetween,
  proposalNudge,
  pullCloses,
  pullThreads,
  recordCollectProposals,
  recordFloorProposals,
  recordProposalSettlements,
  recordWaitCrossing,
  saidWaitCrossing,
  saidWaitLevel,
  unsaidWaitWarning,
  waitCrossing,
  waitCrossingDrift,
  waitCrossings,
  renderCollectSettlementSection,
  renderFloorSettlementSection,
  renderFloorWaitComment,
  renderSettlementDistribution,
  renderWaitDrift,
  settlementAgeTrend,
  settlementDistribution,
  settlementWaitWarning,
  floorProposal,
  historyRecords,
  mergeRecords,
  readLowWater,
  readingMovement,
  renderFloorDrift,
  renderFloorProposal,
  renderLowWater,
  renderTrendReport,
  runbookRecords,
  trendReport,
} from "../../.freebuff/coverage-trend.mjs";

/**
 * A test for the committed low-water mark every reading is held against.
 *
 * The command used to answer from the nights a caller handed in: the floor was the low-water of the
 * records before the newest, so a level a reading had held *before* the window it was handed — or
 * before the days a fixture, or a checkout with pruned records, still carries — was not a floor at
 * all. `.freebuff/coverage-low-water.json` records it instead: one number per declared reading and
 * the night it settled, derived from the records by `npm run coverage:low-water` and held to that
 * derivation here.
 *
 * Three things are contracts rather than details, and each is a case below: the derivation is the
 * **records'** (every record, not a window of them, and only lines the entry's own metric reads),
 * the committed file is **byte for byte** what that derivation renders — so the one edit that would
 * let a fall through, a floor lowered by hand, cannot survive a run — and the command holds a
 * reading's newest record against the committed floor *where the file names it*, keeping the nights
 * at hand as the rule for a reading no file has recorded yet.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const trendModule = path.join(projectRoot, ".freebuff/coverage-trend.mjs");
/** The three committed files this pass is about, each path the module's own. */
const committed = {
  lowWater: path.join(projectRoot, LOW_WATER_FILE),
  runbook: path.join(projectRoot, RUNBOOK_FILE),
  history: path.join(projectRoot, HISTORY_FILE),
};

/** A reading's line as its writer builds it: the entry's own prefix, then what it audited. */
const line = (entry: { prefix: string }, body: string): string => `${entry.prefix} ${body}`;

/**
 * A request as `gh pr list --json number,createdAt,closedAt,mergedAt` states one — the shape the
 * settlement step writes to `.ci/floor-settlements.json`, with `null` for the days an open request
 * does not have yet.
 */
const ghSettled = (
  number: number,
  createdAt: string,
  closedAt: string | null,
  mergedAt: string | null = closedAt,
) => ({ number, createdAt, closedAt, mergedAt });

/**
 * One record, as a whole-gate close writes it: a dated head announcing the verdict, then one
 * indented line per reading that run carried. The head is the runner's own shape, which is what
 * makes the bullet a record rather than a paragraph about one.
 */
function record(date: string, readingLines: string[] = []): string {
  const head =
    `- **${date} — ci verdict: 5 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, ` +
    "0 excluded (5 selected); all stages passed.** typecheck PASS.";
  return [head, ...readingLines.map((carried) => `  ${carried}.`)].join("\n");
}

/** The records the walk answers with, typed for reading: a date and the line each id carried. */
function recordsOf(text: string): { date: string; readings: Record<string, string> }[] {
  return runbookRecords(text) as { date: string; readings: Record<string, string> }[];
}

/** Bodies the guards are known to write, shaped so the number a metric reads is unambiguous. */
const bodies = {
  renderedLinks: (destinations: number) =>
    `chrome — the footer 14 (${destinations} unique destinations) | data — 28 page mounts, ` +
    "18 unique destinations",
  scratchPaths: (suites: number) =>
    `${suites} suite(s) keep a scratch directory and were judged — src/test/a.test.ts ` +
    "(200 test file(s) scanned)",
  conventionGuards: (guards: number) =>
    `${guards} guard(s) exercised on both of their shapes — mount, settle`,
};

/** A runbook of one rendered-links record per value, dated consecutively from 2026-09-01. */
function linksRunbook(values: (number | string)[]): string {
  return values
    .map((value, index) =>
      record(`2026-09-${String(index + 1).padStart(2, "0")}`, [
        typeof value === "number" ? line(RENDERED_LINKS_READING, bodies.renderedLinks(value)) : value,
      ]),
    )
    .join("\n\n");
}

/**
 * The floors as the module's own shape — one number and the night it settled, per reading id —
 * written down here because the module is JavaScript and the cases read the map key by key.
 */
type Floors = Record<string, { value: number; since: string }>;

/**
 * Whether a registry entry declares the one optional field — `floored: false` — that takes its
 * records out of the floors. A member-of-union access through a cast rather than a direct
 * property read, because the neighbouring entries do not carry the field and the module is
 * JavaScript the types are inferred from.
 */
function markedUnfloored(entry: { floored?: boolean } | Record<string, unknown>): boolean {
  return (entry as { floored?: boolean }).floored === false;
}

/** A low-water file as the recorder writes one, with only the readings a case names. */
const floorsOf = (...named: [string, number, string][]) =>
  renderLowWater(Object.fromEntries(named.map(([id, value, since]) => [id, { value, since }])));

describe("the low-water the records state", () => {
  it("takes each reading's lowest readable line, and the earliest night at it", () => {
    const records = recordsOf(
      [
        record("2026-09-01", [line(RENDERED_LINKS_READING, bodies.renderedLinks(27))]),
        record("2026-09-02", [line(SCRATCH_PATHS_READING, bodies.scratchPaths(9))]),
        record("2026-09-03", [line(RENDERED_LINKS_READING, bodies.renderedLinks(25))]),
        // The same level again, later: the low-water has held since the *first* night at it, which
        // is a fact that does not move when the reading repeats itself there.
        record("2026-09-04", [line(RENDERED_LINKS_READING, bodies.renderedLinks(25))]),
        record("2026-09-05", [line(RENDERED_LINKS_READING, bodies.renderedLinks(31))]),
      ].join("\n\n"),
    );

    expect(derivedLowWater(records)).toEqual({
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-09-03" },
      [SCRATCH_PATHS_READING.id]: { value: 9, since: "2026-09-02" },
    });
  });

  it("leaves a reading out of what no record carried, and a line its metric cannot read", () => {
    // A line the entry's prefix carries but its metric cannot read is not a level the reading
    // settled at, so it cannot become the floor — the same refusal the movement makes.
    const stale = `${RENDERED_LINKS_READING.prefix} chrome — the footer 14`;
    const records = recordsOf(
      [record("2026-09-01", [stale]), record("2026-09-02", [line(RENDERED_LINKS_READING, bodies.renderedLinks(26))])].join(
        "\n\n",
      ),
    );

    expect(derivedLowWater(records)).toEqual({
      [RENDERED_LINKS_READING.id]: { value: 26, since: "2026-09-02" },
    });
    // …and a reading no record carried is simply absent: the file names floors, never zeroes.
    expect(Object.keys(derivedLowWater(records))).not.toContain(SCRATCH_PATHS_READING.id);
    expect(derivedLowWater()).toEqual({});
    expect(derivedLowWater([])).toEqual({});
  });
});

describe("the committed low-water file", () => {
  it("renders the floors it reads back, in the registry's order", () => {
    const text = floorsOf(
      [RENDERED_LINKS_READING.id, 25, "2026-10-09"],
      [SCRATCH_PATHS_READING.id, 7, "2026-10-13"],
      [CONVENTION_GUARDS_READING.id, 13, "2026-10-13"],
    );

    expect(readLowWater(text)).toEqual({
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-10-09" },
      [SCRATCH_PATHS_READING.id]: { value: 7, since: "2026-10-13" },
      [CONVENTION_GUARDS_READING.id]: { value: 13, since: "2026-10-13" },
    });
    // The file is JSON, so the rule it states travels *in* it: a reader who finds the file and not
    // the module still learns what the numbers mean and what regenerates them.
    const parsed = JSON.parse(text) as {
      note: string;
      readings: Record<string, { value: number; since: string }>;
    };
    expect(parsed.note).toContain("npm run coverage:low-water");
    expect(parsed.note).toContain("lowest level");
    expect(parsed.readings[SCRATCH_PATHS_READING.id]).toEqual({ value: 7, since: "2026-10-13" });

    // A reading the registry no longer declares carries nothing rather than a floor for something
    // that is not read any more; the entries that *are* declared still read.
    const stale = JSON.stringify({
      readings: { "a-reading-nobody-declares": { value: 3, since: "2026-09-01" }, ...JSON.parse(text).readings },
    });
    expect(readLowWater(stale)).toEqual(readLowWater(text));
  });

  it("refuses a file it cannot read rather than guessing a floor", () => {
    // The command answers with the records' own low-water and says so on stderr when this throws,
    // so a broken file costs the floors and never a verdict — but it must not be *read* as floors
    // either, which is what a silently tolerant reader would do.
    const refused: [string, string][] = [
      ["{ not json", "JSON"],
      ["{}", "no `readings` map"],
      [JSON.stringify({ readings: [] }), "no `readings` map"],
      [JSON.stringify({ readings: { [RENDERED_LINKS_READING.id]: 25 } }), "not an entry"],
      [
        JSON.stringify({ readings: { [RENDERED_LINKS_READING.id]: { since: "2026-10-09" } } }),
        "no whole-number value",
      ],
      [
        JSON.stringify({ readings: { [RENDERED_LINKS_READING.id]: { value: 25.5, since: "2026-10-09" } } }),
        "no whole-number value",
      ],
      [
        JSON.stringify({ readings: { [RENDERED_LINKS_READING.id]: { value: 25, since: "9 October" } } }),
        "`since` date",
      ],
    ];

    for (const [text, said] of refused) {
      expect(() => readLowWater(text), `${text} was read as floors`).toThrowError(
        new RegExp(said.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });
});

describe("the floor a reading is held against", () => {
  const movementOf = (values: (number | string)[], lowWater: Floors = {}) =>
    readingMovement(RENDERED_LINKS_READING, recordsOf(linksRunbook(values)), { lowWater });

  it("holds the newest record against the committed floor, not the nights at hand", () => {
    // The decisive pair. The nights at hand reach no lower than 31, so a fall to 26 is a regression
    // by their own low-water; the reading has settled at 25, and a return to 26 is a dip back to a
    // level it has held. Which of the two the answer is depends on the floor, and the floor is the
    // recorded one.
    const atHand = movementOf([31, 33, 26]);
    expect(atHand).toMatchObject({ status: "regressed", floor: 31, floorFrom: "records", delta: -5 });
    expect(atHand.floorSince).toBeNull();

    const committedFloor = movementOf([31, 33, 26], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" },
    });
    expect(committedFloor).toMatchObject({
      status: "rose",
      floor: 25,
      floorFrom: "low-water",
      floorSince: "2026-08-01",
      delta: 1,
    });

    // …and the window is what `--limit` bounds, never the floor: the committed number is the same
    // however few nights a caller hands in, which is the whole point of recording it, while the
    // records' own rule moves with the window it is said to be a low-water of.
    const narrow = { [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" } };
    expect(
      readingMovement(RENDERED_LINKS_READING, recordsOf(linksRunbook([31, 33, 26])), {
        limit: 2,
        lowWater: narrow,
      }),
    ).toMatchObject({ floor: 25, floorFrom: "low-water", before: 1 });
    expect(
      readingMovement(RENDERED_LINKS_READING, recordsOf(linksRunbook([31, 33, 26])), { limit: 2 }),
    ).toMatchObject({ floor: 33, floorFrom: "records", before: 1 });
  });

  it("fails a fall below the committed floor, and says which floor it was", () => {
    const held = movementOf([27, 28, 24], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" },
    });
    expect(held).toMatchObject({ status: "regressed", floor: 25, floorFrom: "low-water", delta: -1 });
    expect(renderTrendReport(trendReport(linksRunbook([27, 28, 24]), {
      lowWater: { [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" } },
    }))).toContain(
      "REGRESSED   rendered-links         24 chrome unique destinations — down 1 from the " +
        "committed low-water 25 (recorded 2026-08-01)",
    );

    // The level itself is a hold, not a fall: the point of a low-water is that returning to it is
    // not a regression, and a floor the records cannot reach is what lets that be said at all.
    expect(
      movementOf([27, 25], { [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" } }),
    ).toMatchObject({ status: "held", delta: 0 });
  });

  it("answers where the nights at hand have nothing — the window no longer decides", () => {
    // One record and no committed floor: the reading has never moved, said out loud. The same single
    // record *with* a floor is held against a level its own history does not reach — which is what
    // the recorded file is for, and what a reading whose earlier nights have left the window (or the
    // files) would otherwise lose.
    expect(movementOf([26])).toMatchObject({ status: "no-history", floor: null, floorFrom: null });
    expect(movementOf([26], { [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-08-01" } })).toMatchObject({
      status: "rose",
      floor: 25,
      floorFrom: "low-water",
      delta: 1,
    });
  });

  it("falls back to the records' own low-water for a reading the file does not name", () => {
    // A guard declared this morning, a floor nobody has recorded for it yet: the command keeps the
    // rule it had — the nights at hand — rather than calling the reading new or holding it against
    // some other reading's number.
    const other = movementOf([31, 33, 26], {
      [SCRATCH_PATHS_READING.id]: { value: 7, since: "2026-08-01" },
    });
    expect(other).toMatchObject({ status: "regressed", floor: 31, floorFrom: "records" });
    // …and the answer says the file named one reading, not that it named this one: the floor this
    // row was held against is the records' own, which is the fact a reader has to be able to check.
    const report = trendReport(linksRunbook([31, 33, 26]), {
      lowWater: { [SCRATCH_PATHS_READING.id]: { value: 7, since: "2026-08-01" } },
    });
    expect(report.sources.lowWater).toBe(1);
    expect(
      report.rows.find((row) => row.id === RENDERED_LINKS_READING.id)?.floorFrom,
    ).toBe("records");
  });
});

describe("the committed low-water in this checkout", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const recordsIn = () =>
    mergeRecords(runbookRecords(read(committed.runbook)), historyRecords(read(committed.history)));

  /**
   * The ratchet itself, as a callable: a file's text held to the floors the records derive, failing
   * with the recorder's diff. The case below runs it over the checkout; the control after that runs
   * it over a file it has made stale on purpose, because a red that loses its message is green
   * either way — the comparison is the same test, and only the words beside it are the deliverable.
   */
  function holdToDerivation(text: string, derived: Floors): void {
    expect(
      text,
      renderFloorDrift(floorProposal({ committed: readLowWater(text) as Floors, derived })),
    ).toBe(renderLowWater(derived));
  }

  it("is byte for byte what the committed records derive", () => {
    // The ratchet. The file is a record of a derivation rather than a second opinion, so the one
    // edit that would let a fall through — a floor lowered by hand — is a red case rather than a
    // quiet widening, and the repair is the recorder (`npm run coverage:low-water`), whose diff is
    // the decision. This is also the case that fails when a night settles a new level and the file
    // has not been re-recorded, which is exactly the night the decision is owed on.
    //
    // Its *message* is that diff, and it is the case's own because this is where the red is read: a
    // job's log quotes what the case printed, while the two JSON texts are hundreds of characters
    // to diff by eye and name neither the reading whose floor moved nor the command that writes it
    // back. The rows come from the proposal the night's own step is built from, so the red a person
    // reads and the request the job opens say the same thing.
    holdToDerivation(read(committed.lowWater), derivedLowWater(recordsIn()) as Floors);
  });

  it("fails a stale file with that diff, so the red carries what to run", () => {
    // The control for the case above: the same call, over a pair that disagrees. It is the only way
    // to read what the red prints — a passing case prints nothing — and it is what fails if the
    // message is ever dropped from the comparison, which no other case can see.
    const derived = readLowWater(floorsOf([RENDERED_LINKS_READING.id, 23, "2026-10-14"])) as Floors;
    let failure = "";
    try {
      holdToDerivation(floorsOf([RENDERED_LINKS_READING.id, 25, "2026-10-09"]), derived);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    expect(failure, "a stale file passed the ratchet").toContain("would move 1 floor(s)");
    expect(failure).toContain(`  ${RENDERED_LINKS_READING.id} `);
    expect(failure).toContain("25 (2026-10-09) → 23 (2026-10-14) — lowered");
    expect(failure).toContain("npm run coverage:low-water");
    // …and the same call over the derivation's own bytes passes, so the control is about the words
    // the failure carries rather than about the helper refusing everything it is handed.
    expect(() => holdToDerivation(renderLowWater(derived), derived)).not.toThrow();
  });

  it("names every reading the records have settled, at the lowest level they state", () => {
    const floors = readLowWater(read(committed.lowWater)) as Floors;
    const records = recordsIn();
    const settled = READINGS.filter(
      (entry) =>
        !markedUnfloored(entry) &&
        records.some((held) => metricOf(entry, held.readings[entry.id]) !== null),
    );
    // The registry's unfloored reading is the deliberate exception, and it is named here by its
    // own absence: its records settle (the queue has a number tonight), and no floor names it —
    // which is what `floored: false` means on the committed file's side, asserted against the
    // real pair rather than against a fixture of it.
    const unfloored = READINGS.filter((entry) => markedUnfloored(entry));
    if (unfloored.length > 0) {
      expect(
        READINGS.some(
          (entry) =>
            markedUnfloored(entry) &&
            records.some((held) => metricOf(entry, held.readings[entry.id]) !== null),
        ),
        "the fixture wants the unfloored reading's records committed, so this case says something",
      ).toBe(true);
    }

    expect(settled.length, "the committed records carry no readable reading at all").toBeGreaterThan(0);
    expect(Object.keys(floors)).toEqual(settled.map((entry) => entry.id));
    for (const entry of unfloored) {
      expect(Object.keys(floors), `${entry.id} was floored deliberately-not`).not.toContain(entry.id);
    }
    for (const entry of settled) {
      const measured = records
        .map((held) => metricOf(entry, held.readings[entry.id]))
        .filter((value) => value !== null);
      expect(measured, `${entry.id} states no level at all`).toContain(floors[entry.id].value);
      for (const value of measured) {
        expect(value, `${entry.id} settled below its own floor`).toBeGreaterThanOrEqual(
          floors[entry.id].value,
        );
      }
      // The date is one of the records', and the earliest one at that level: "the floor has held
      // since …" is a fact about the file, so it is checked against the records, not taken on trust.
      const atFloor = records
        .filter((held) => metricOf(entry, held.readings[entry.id]) === floors[entry.id].value)
        .map((held) => held.date);
      expect(atFloor).toContain(floors[entry.id].since);
      expect(floors[entry.id].since).toBe(atFloor[0]);
    }
  });

  it("answers this checkout's own trend from it, rather than from the window", () => {
    // The floors are the points of this pass: the two readings that have one record apiece used to
    // read NO HISTORY, and the command compared one reading of three. It now compares every reading
    // the records carry, each against the level it has settled to.
    const report = trendReport(read(committed.runbook), {
      history: read(committed.history),
      lowWater: readLowWater(read(committed.lowWater)),
    });

    expect(report.sources.lowWater).toBeGreaterThan(0);
    expect(report.rows.filter((row) => row.floorFrom === "low-water")).toHaveLength(report.sources.lowWater);
    expect(report.compared).toBeGreaterThanOrEqual(report.sources.lowWater);
    expect(renderTrendReport(report)).toContain("the committed low-water");
  });
});

describe("the coverage:low-water recorder, run as a command", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchDir("coverage-low-water-");
  });
  afterAll(() => {
    removeScratchDir(scratch);
  });

  /**
   * A runbook of rendered-links records, a table with no rows, and a low-water file that names
   * nothing — the paths a case runs with.
   *
   * The empty file is what keeps the *committed* floors out of a fixture's answer: without it the
   * command would read the checkout's own low-water (the default path) and hold a three-night
   * fixture against a level its records never reached. The case that asserts the default is the one
   * that leaves the flag off on purpose.
   */
  const fixture = (name: string, values: (number | string)[]) => {
    const runbook = path.join(scratch, `run-${name}.md`);
    const table = path.join(scratch, `table-${name}.md`);
    const none = path.join(scratch, `none-${name}.json`);
    writeFileSync(runbook, linksRunbook(values), "utf8");
    writeFileSync(table, ["# Coverage history", "", "| Date | x |", "| :-- | :-- |", ""].join("\n"), "utf8");
    writeFileSync(none, JSON.stringify({ readings: {} }), "utf8");
    return { runbook, table, none };
  };

  const run = (args: string[]) =>
    spawnSync(process.execPath, [trendModule, ...args], { encoding: "utf8" });

  it("records the floors it derives, and holds the run it was recorded from against them", () => {
    const { runbook, table, none } = fixture("record", [27, 28, 25]);
    const target = path.join(scratch, "recorded-low-water.json");

    // Without a recorded floor the fall is a regression — the nights at hand reach 27, and the
    // newest record settled at 25.
    const before = run(["--runbook", runbook, "--history", table, "--low-water", none]);
    expect(before.status).toBe(1);
    expect(before.stdout).toContain("down 2 from the low-water 27");

    const recorded = run([
      "--runbook",
      runbook,
      "--history",
      table,
      "--low-water",
      none,
      "--write-low-water",
      "--file",
      target,
    ]);
    expect(recorded.status, recorded.stderr).toBe(0);
    expect(recorded.stdout).toContain("recorded the low-water of 1 reading(s)");
    const text = readFileSync(target, "utf8");
    expect(text).toBe(renderLowWater({ [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-09-03" } }));
    expect((readLowWater(text) as Floors)[RENDERED_LINKS_READING.id]).toEqual({
      value: 25,
      since: "2026-09-03",
    });

    // …and the same run judged against the level it recorded is the reading holding it: the step
    // down is no longer a *new* fact, it is the number the decision was written down as.
    const after = run(["--runbook", runbook, "--history", table, "--low-water", target]);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain("HELD        rendered-links");
    expect(after.stdout).toContain("the committed low-water 25 (recorded 2026-09-03)");
  });

  it("still fails a further fall below the recorded floor", () => {
    const { table } = fixture("slide", [27, 28, 25]);
    const file = path.join(scratch, "slide-low-water.json");
    writeFileSync(file, floorsOf([RENDERED_LINKS_READING.id, 25, "2026-09-03"]), "utf8");
    const next = fixture("slide-next", [27, 28, 25, 24]);

    const result = run(["--runbook", next.runbook, "--history", table, "--low-water", file]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("REGRESSED   rendered-links");
    expect(result.stdout).toContain("down 1 from the committed low-water 25 (recorded 2026-09-03)");
  });

  it("notes a committed low-water it cannot read, and answers from the records", () => {
    const { runbook, table, none } = fixture("unreadable", [27, 28]);
    expect(readLowWater(readFileSync(none, "utf8"))).toEqual({});
    const junk = path.join(scratch, "junk-low-water.json");
    writeFileSync(junk, '{"readings": {"rendered-links": 25}}', "utf8");

    // A file that is not there, and one that is there and is not floors: both cost the answer the
    // committed floors and nothing else — the records' own low-water is what it answers with, and
    // the note says so rather than the answer quietly changing shape.
    const missing = run(["--runbook", runbook, "--history", table, "--low-water", path.join(scratch, "no-file.json")]);
    expect(missing.status).toBe(0);
    expect(missing.stderr).toContain("no committed low-water at");
    expect(missing.stdout).toContain("ROSE        rendered-links");

    const broken = run(["--runbook", runbook, "--history", table, "--low-water", junk]);
    expect(broken.status).toBe(0);
    // The note carries the reader's own reason, so a file that is floors-looking but wrong says
    // *which* line of it was wrong rather than only that something was.
    expect(broken.stderr).toContain("is not an entry with a value and a date");
    expect(broken.stdout).toContain("the low-water 27");
  });

  it("reads the committed file with no flag at all, which is the nightly invocation", () => {
    const { runbook, table } = fixture("default", [27, 28]);
    expect(readLowWater(readFileSync(committed.lowWater, "utf8"))).toEqual(
      derivedLowWater(
        mergeRecords(
          runbookRecords(readFileSync(committed.runbook, "utf8")),
          historyRecords(readFileSync(committed.history, "utf8")),
        ),
      ),
    );
    const payload = JSON.parse(
      run(["--runbook", runbook, "--history", table, "--json"]).stdout,
    ) as { sources: { lowWater: number }; rows: { id: string; floorFrom: string | null }[] };

    // The default is the file beside the module — the committed one on the runner — so the floors a
    // nightly run reads are the recorded ones rather than whatever the night's records reach, and
    // this fixture's own reading (rendered-links) is one the committed file names.
    expect(payload.sources.lowWater).toBeGreaterThan(0);
    expect(payload.rows.find((row) => row.id === RENDERED_LINKS_READING.id)?.floorFrom).toBe("low-water");
  });
});
/* -------------------------------------------------------------------------- */

/**
 * The proposal a red night earns: the floors the records now derive, in a place a person can merge
 * them from.
 *
 * The cases above hold the committed file to its derivation and hold a reading's newest record
 * against it. These hold the *other* answer the same derivation gets — the one the nightly job
 * leaves for review, because the recorder rewrites a gate and only a person may decide to lower
 * one. Three things are pinned: the statuses (`proposed` for a step down, `unchanged` for a file
 * that already states the derivation, and `refused` for a derivation that names no reading at all,
 * which must never be written), the body's own numbers (the floor the file held, the one it would
 * hold, and the trend answer it was earned by, so a reviewer can see how much looser the gate
 * becomes), and the wiring that carries it to a branch (`nightly.yml`'s steps).
 */
describe("the floor proposal a step down earns", () => {
  /** A floor map as the module reads one back: one number and the night it settled, by id. */
  const floors = (value: number, since: string): Floors => ({
    [RENDERED_LINKS_READING.id]: { value, since },
  });

  it("proposes the floor the records now derive, and says what moved", () => {
    const proposal = floorProposal({
      committed: floors(25, "2026-10-09"),
      derived: floors(23, "2026-10-14"),
    });

    expect(proposal).toMatchObject({
      status: "proposed",
      changed: true,
      stepped: [RENDERED_LINKS_READING.id],
    });
    expect(proposal.rows).toHaveLength(1);
    expect(proposal.rows[0]).toMatchObject({
      id: RENDERED_LINKS_READING.id,
      kind: "down",
      delta: -2,
      was: { value: 25, since: "2026-10-09" },
      now: { value: 23, since: "2026-10-14" },
    });
    // The two texts the caller writes — the file as it is and the file as the proposal leaves it —
    // both through the renderer the committed file is held to, so the diff is the file's own shape.
    expect(proposal.before).toBe(renderLowWater(floors(25, "2026-10-09")));
    expect(proposal.after).toBe(renderLowWater(floors(23, "2026-10-14")));
  });

  it("leaves a floor that does not move out of the rows, and answers `unchanged`", () => {
    const held = floorProposal({
      committed: floors(25, "2026-10-09"),
      derived: floors(25, "2026-10-09"),
    });

    expect(held).toMatchObject({ status: "unchanged", changed: false, rows: [], stepped: [] });
    expect(held.after).toBe(held.before);
    // A reading whose *date* moved while its level did not is not a row either: the floor is the
    // number, so a re-record that lands on the same one is nothing to review.
    expect(
      floorProposal({ committed: floors(25, "2026-10-09"), derived: floors(25, "2026-11-01") }),
    ).toMatchObject({ status: "unchanged", changed: false });
  });

  it("renders the recorder's diff as the words a stale file fails with", () => {
    const drifted = renderFloorDrift(
      floorProposal({ committed: floors(25, "2026-10-09"), derived: floors(23, "2026-10-14") }),
    );

    // The reading, both levels with the night each settled, the direction, and the command: the four
    // facts a reader of a red needs, none of which the two JSON texts state by themselves.
    expect(drifted).toContain("would move 1 floor(s)");
    expect(drifted).toContain(`  ${RENDERED_LINKS_READING.id}`);
    expect(drifted).toContain("25 (2026-10-09) → 23 (2026-10-14) — lowered");
    expect(drifted).toContain("npm run coverage:low-water");
    // …and it does not pretend the recorder is the whole of the repair: a floor the diff lowers is a
    // decision, which is the request the nightly job opens instead.
    expect(drifted).toContain("opens the same diff as a pull");

    // The shapes a line can take, one apiece: a reading the file never named, and one no record
    // states a level for any more. Both are lines of the same edit, so both are rows of the same
    // message rather than a count of what moved.
    const named = floorProposal({
      committed: {},
      derived: floors(13, "2026-10-14"),
    });
    expect(renderFloorDrift(named)).toContain("no floor → 13 (2026-10-14) — named");
    const dropped = floorProposal({
      committed: floors(25, "2026-10-09"),
      derived: {},
    });
    expect(renderFloorDrift(dropped)).toContain("25 (2026-10-09) → no floor — dropped");

    // A difference no floor states — the note, a `since` date at an unchanged level, the order of
    // the entries — has no row to print. The message says that instead of rendering an empty list
    // under a sentence about a movement, and it still names the one command that repairs it.
    const unmoved = renderFloorDrift(
      floorProposal({ committed: floors(25, "2026-10-09"), derived: floors(25, "2026-10-11") }),
    );
    expect(unmoved).toContain("no reading's");
    expect(unmoved).toContain("floor moved");
    expect(unmoved).not.toContain("would move");
    expect(unmoved).toContain("npm run coverage:low-water");
  });

  it("carries a floor the derivation would raise, or drop, as a row of its own", () => {
    // The step down is why the proposal exists, but the edit it carries is the whole derivation: a
    // raise (records pruned), a reading no record states a level for any more, and a reading no file
    // had recorded yet are lines of the same file, and a reviewer has to see all of them.
    const mixed = floorProposal({
      committed: {
        [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-10-09" },
        [SCRATCH_PATHS_READING.id]: { value: 7, since: "2026-10-13" },
      },
      derived: {
        [RENDERED_LINKS_READING.id]: { value: 23, since: "2026-10-14" },
        [CONVENTION_GUARDS_READING.id]: { value: 13, since: "2026-10-14" },
      },
    });

    expect(mixed.rows.map((row: { id: string; kind: string }) => [row.id, row.kind])).toEqual([
      [RENDERED_LINKS_READING.id, "down"],
      [SCRATCH_PATHS_READING.id, "dropped"],
      [CONVENTION_GUARDS_READING.id, "new"],
    ]);
    expect(mixed.stepped).toEqual([RENDERED_LINKS_READING.id]);

    // …and a raise is a row of its own, never folded into the fall beside it: it is the one
    // direction that *tightens* a gate, and it is still this edit that carries it.
    const raised = floorProposal({
      committed: floors(25, "2026-10-09"),
      derived: floors(27, "2026-10-14"),
    });
    expect(raised.rows[0]).toMatchObject({ kind: "up", delta: 2 });
    expect(raised).toMatchObject({ status: "proposed", changed: true, stepped: [] });
  });

  it("refuses a derivation that names no reading at all rather than writing it", () => {
    const proposal = floorProposal({ committed: floors(25, "2026-10-09"), derived: {} });

    expect(proposal).toMatchObject({ status: "refused", changed: false });
    // What a caller must not write: floors of *nothing*, which is every reading back on the nights
    // at hand and the ratchet's whole reach gone. It is what a records file this could not read
    // derives, so the answer is to write nothing and say so.
    expect(readLowWater(proposal.after)).toEqual({});
    // An empty file and an empty derivation are the one pair that *is* the answer: a fresh checkout
    // owes no proposal and nothing was moved.
    expect(floorProposal({ committed: {}, derived: {} })).toMatchObject({
      status: "unchanged",
      changed: false,
    });
  });

  it("renders the body a reviewer merges from: the verdict, the numbers, and what the merge does", () => {
    const report = trendReport(linksRunbook([27, 28, 25]), {
      lowWater: floors(27, "2026-09-02") as Floors,
    });
    const proposal = floorProposal({
      report,
      committed: floors(27, "2026-09-02"),
      derived: floors(25, "2026-09-03"),
    });
    const body = renderFloorProposal({ report, proposal });

    expect(body).toContain("## Proposed coverage floor");
    expect(body).toContain("`npm run coverage:trend` failed after tonight's record: rendered-links");
    expect(body).toContain("**Merging this lowers a gate");
    // The numbers, in the file's own terms: the floor it held and the night it settled, the floor
    // it would hold, and the night *that* one settled — the diff as a table.
    expect(body).toContain("| `rendered-links` | 27 (2026-09-02) | 25 | 2026-09-03 | lowered it |");
    // …and the answer it was earned by, verbatim, because the row above is a summary of it and the
    // reader is entitled to the whole thing.
    expect(body).toContain("REGRESSED   rendered-links");
    expect(body).toContain("from 3 runbook record(s) and 0 nightly history row(s)");
    // The one consequence a reviewer has to know before merging: the suite is red until this lands.
    expect(body).toContain("coverage-low-water.test.ts");
    expect(body).toContain("npm run coverage:low-water");
  });

  it("does not claim a fall when the red that reached it was the file's, not a reading's", () => {
    const report = trendReport(linksRunbook([25, 25]));
    const proposal = floorProposal({
      report,
      committed: floors(25, "2026-09-01"),
      derived: floors(24, "2026-09-02"),
    });
    const body = renderFloorProposal({ report, proposal });

    expect(report.regressed).toEqual([]);
    // A green trend over a file that does not state the records is the night the suite's byte
    // comparison is what reddens — the chart draws a record under the level the file holds, while
    // the newest record cleared it — so the body names *that* red rather than claiming a fall the
    // trend never measured.
    expect(body).toContain("the floors the file holds are not the ones the records state");
    expect(body).not.toContain("failed after tonight's record");
  });

  it("says so briefly when there is nothing to propose, and renders no table", () => {
    const unchanged = floorProposal({
      committed: floors(25, "2026-10-09"),
      derived: floors(25, "2026-10-09"),
    });
    expect(renderFloorProposal({ proposal: unchanged })).toContain(
      "## Coverage floor — nothing to record",
    );

    const refused = floorProposal({ committed: floors(25, "2026-10-09"), derived: {} });
    const body = renderFloorProposal({ proposal: refused });
    expect(body).toContain("## Coverage floor — nothing recorded");
    expect(body).toContain("would erase the floors");
    // Neither is a proposal, so neither renders one: a table under a status that says nothing was
    // written would read like a request nobody made.
    expect(body).not.toContain("| reading |");
    expect(body).not.toContain("## Proposed");
  });
});

/**
 * The command the nightly job runs, over fixtures: the same derivation the recorder makes, written
 * where a person can merge it from, with the statuses a workflow reads.
 *
 * The paths are scratch on purpose — a case that let the default land would write a proposal into
 * the checkout it is testing — and every run is a real spawn, because what the workflow depends on
 * is the command's own exit code, its stdout, and the two files it leaves behind.
 */
describe("the coverage:propose-low-water command", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchDir("coverage-propose-low-water-");
  });
  afterAll(() => {
    removeScratchDir(scratch);
  });

  /**
   * A runbook of records, an empty table, and a committed file that names a higher floor than the
   * records reach — a step down, which is the night the command exists for. The names carry a tag so
   * a case's files cannot be read as another case's.
   */
  const fixture = (tag: string, values: (number | string)[], committed: Floors) => {
    const files = {
      runbook: path.join(scratch, `run-${tag}.md`),
      history: path.join(scratch, `table-${tag}.md`),
      committed: path.join(scratch, `committed-${tag}.json`),
      target: path.join(scratch, `recorded-${tag}.json`),
      proposal: path.join(scratch, `proposal-${tag}.md`),
    };
    writeFileSync(files.runbook, linksRunbook(values), "utf8");
    writeFileSync(files.history, ["# Coverage history", "", "| Date | x |", "| :-- | :-- |", ""].join("\n"), "utf8");
    writeFileSync(files.committed, renderLowWater(committed), "utf8");
    return files;
  };

  /** The command's flags for a fixture: the records, the committed file, and where to write. */
  const flags = (files: { runbook: string; history: string; committed: string; target: string; proposal: string }) => [
    "--runbook",
    files.runbook,
    "--history",
    files.history,
    "--low-water",
    files.committed,
    "--propose-low-water",
    "--file",
    files.target,
    "--output",
    files.proposal,
  ];

  const run = (
    args: string[],
    env: Record<string, string> = {},
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [trendModule, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  /** The step-down fixture every case below starts from: the floor is 27, the records reach 25. */
  const steppedDown = (tag: string) => fixture(tag, [27, 28, 25], {
    [RENDERED_LINKS_READING.id]: { value: 27, since: "2026-09-02" },
  });

  it("records the floor the records derive, and renders the proposal beside it", () => {
    const files = steppedDown("record");
    const result = run(flags(files));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("coverage-trend: proposed");
    expect(result.stdout).toContain("wrote the floors the records derive to");
    // The floor file is the recorder's own output — the same bytes `npm run coverage:low-water`
    // writes — so a reviewer reading the diff is reading the derivation and nothing else.
    const written = readFileSync(files.target, "utf8");
    expect(written).toBe(renderLowWater({ [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-09-03" } }));
    expect(readLowWater(written)).toMatchObject({
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-09-03" },
    });
    // …and the body is the proposal that floor is owed a merge for.
    const body = readFileSync(files.proposal, "utf8");
    expect(body).toContain("## Proposed coverage floor");
    expect(body).toContain("| `rendered-links` | 27 (2026-09-02) | 25 | 2026-09-03 | lowered it |");
    expect(body).toContain("REGRESSED   rendered-links");
  });

  it("writes no floor, and says nothing is owed, when the file already states the derivation", () => {
    const files = steppedDown("recorded");
    const first = run(flags(files));
    expect(first.status, first.stderr).toBe(0);
    const recorded = readFileSync(files.target, "utf8");
    writeFileSync(files.committed, recorded, "utf8");

    // The second night of the same step down: the committed file now carries the derivation, so
    // there is nothing to move and no request to open — the status is what the workflow reads.
    const second = run(flags(files));
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("coverage-trend: unchanged");
    expect(readFileSync(files.target, "utf8")).toBe(recorded);
    expect(readFileSync(files.proposal, "utf8")).toContain("## Coverage floor — nothing to record");
  });

  it("reports `changed` and `status` on the workflow's outputs, and the body on the run page", () => {
    const files = steppedDown("seams");
    const output = path.join(scratch, "github-output.txt");
    const summary = path.join(scratch, "github-summary.md");

    const result = run(flags(files), { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("changed=true\nstatus=proposed\n");
    // The run page gets the same text the review does: the numbers a reader needs to judge a looser
    // gate are on the page the red run publishes, not only in the branch.
    const summaryText = readFileSync(summary, "utf8");
    expect(summaryText).toContain("## Proposed coverage floor");
    expect(summaryText).toContain("| `rendered-links` |");
    expect(summaryText).toBe(`\n${readFileSync(files.proposal, "utf8")}\n`);

    // …and the same seams on an unchanged run, which is the other shape the workflow reads: no
    // branch, no request, said in the status rather than implied by an absent file. Its own seam
    // files, because a workflow's output is appended to and an assertion on the pair would be an
    // assertion about both runs.
    writeFileSync(files.committed, readFileSync(files.target, "utf8"), "utf8");
    const unchangedOutput = path.join(scratch, "github-output-unchanged.txt");
    const unchanged = run(flags(files), {
      GITHUB_OUTPUT: unchangedOutput,
      GITHUB_STEP_SUMMARY: path.join(scratch, "github-summary-unchanged.md"),
    });
    expect(unchanged.status, unchanged.stderr).toBe(0);
    expect(readFileSync(unchangedOutput, "utf8")).toBe("changed=false\nstatus=unchanged\n");
  });

  it("refuses a derivation that names no reading, exits 1, and leaves the file alone", () => {
    // Records whose lines are not readings at all: the runbook parses but states no level for any
    // declared reading, which is the one derivation that must not be recorded — it would erase the
    // floors rather than lower one.
    const files = fixture("refused", ["- **2026-09-03 — ci verdict: 5 passed.** nothing a metric reads"], {
      [RENDERED_LINKS_READING.id]: { value: 25, since: "2026-09-02" },
    });
    const committed = readFileSync(files.committed, "utf8");
    const result = run(flags(files));

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain("## Coverage floor — nothing recorded");
    expect(result.stdout).toContain("coverage-trend: refused");
    expect(readFileSync(files.committed, "utf8")).toBe(committed);
    expect(existsSync(files.target)).toBe(false);
  });

  it("defaults the proposal to the path the nightly job's own step never uses, and is ignored by git", () => {
    // The default is the transient beside the collect-budget proposal, declared once in the module
    // and kept out of the tree by the rule below. A case cannot drive the default itself — that
    // would write a proposal into the checkout it is testing, which is the write `checkout-watch`
    // exists to refuse — so the path and its rule are held to each other instead, and the nightly
    // job's own invocation (`--output .ci/…`) is pinned in the wire cases that follow.
    expect(LOW_WATER_PROPOSAL_FILE).toBe(".freebuff/coverage-floor-proposal.md");
    const ignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
    expect(ignore).toContain(LOW_WATER_PROPOSAL_FILE);
  });
});
/* -------------------------------------------------------------------------- */

/**
 * The proposal that has *sat*: the same request, unanswered, on the nights after the one that
 * opened it — the loudness half of the night's answer.
 *
 * The step above opens one pull request and keeps it current, which is exactly the shape that can
 * go quiet: the body is rewritten in place and the branch is force-pushed, so nothing notifies
 * anybody and a proposal nobody has read looks the same as one being argued about. These cases pin
 * the three things that break that silence, each one earned by a longer age than the last — a
 * comment the night *adds* (an edited one notifies nobody), the run page naming the request once it
 * has sat past `STALE_NIGHTS`, and the comment naming a person once it has sat past
 * `ESCALATED_NIGHTS`, since a mention is the only signal in this set that reaches somebody's inbox.
 * The age is the request's own, counted in whole nights because the job runs at 02:17 UTC, and the
 * mode reads no records at all: every number a reviewer sees in it belongs to the body the other
 * step wrote.
 */
describe("the floor proposal that has sat unmerged", () => {
  /** The night's nudge, for a request opened `created` and re-fired on `today`. */
  const nudgeOn = (created: string, today: string, number: string | number = 12, owner?: string) =>
    proposalNudge({ number, created, today, ...(owner === undefined ? {} : { owner }) });

  it("counts whole nights rather than whole days, because the job runs at 02:17", () => {
    // The trap this arithmetic exists for: last night's run opened the request at 02:20, tonight's
    // re-fires it at 02:17 — nineteen and a half hours, which is *zero* whole days. A span-based age
    // would report "opened today" through the first two nights of the request's life and would
    // never reach the threshold the run page waits for.
    expect(nightsBetween("2026-10-10T02:20:00Z", "2026-10-11T02:17:00Z")).toBe(1);
    expect(nightsBetween("2026-10-10T23:59:00Z", "2026-10-11T00:01:00Z")).toBe(1);
    // …and the night it was opened is night zero of re-firing, whatever the hour it opened at.
    expect(nightsBetween("2026-10-11T02:20:00Z", "2026-10-11T22:00:00Z")).toBe(0);
    // An age read from something unreadable is not a small age: it is not an age at all.
    expect(nightsBetween("last Tuesday", "2026-10-11T02:17:00Z")).toBeNull();
    expect(nightsBetween("2026-10-10T02:20:00Z", "")).toBeNull();
  });

  it("answers the night's comment from that age, and refuses an age it cannot read", () => {
    expect(nudgeOn("2026-10-10T02:20:00Z", "2026-10-11T02:17:00Z")).toMatchObject({
      number: "12",
      created: "2026-10-10",
      today: "2026-10-11",
      nights: 1,
      stale: false,
      page: null,
    });

    // The number and the date are both load-bearing, and neither has a fallback: a nudge that could
    // not say how long the request has sat, or which request it means, is a note about nothing.
    expect(proposalNudge({ number: 12, created: "then" })).toBeNull();
    expect(proposalNudge({ created: "2026-10-10T02:20:00Z" })).toBeNull();
    expect(proposalNudge({ number: "  ", created: "2026-10-10T02:20:00Z" })).toBeNull();
  });

  it("says the same request was restated: the night, the night it opened, and the body above", () => {
    const comment = nudgeOn("2026-10-07T02:20:00Z", "2026-10-11T02:17:00Z")?.comment ?? "";

    // Night 5 of the request's life, night 4 of re-firing it: the count a reader uses to see that
    // nobody has answered, named in the heading rather than buried in prose.
    expect(comment).toContain("## The floor proposal re-fired tonight — night 5");
    expect(comment).toContain("opened on\n2026-10-07");
    expect(comment).toContain("read that table rather than the diff you first saw");
    // The decision, both ways it can be answered, and the command the other one runs.
    expect(comment).toContain("**A floor is a gate, so this is a decision rather than an errand.**");
    expect(comment).toContain("`npm run coverage:low-water` over this tree");
    // …and the fact that makes the comment worth reading at all: the red is not news.
    expect(comment).toContain("this comment is the job saying so, not a second\nfinding");
    expect(comment).toContain("#12 · night 5");
  });

  it("names the request on the run page only once it has sat past the nights the job waits", () => {
    // The boundary from both sides, because it is the whole of the decision: two nights is a request
    // somebody may simply not have read yet, and the third is the job saying it out loud — and
    // nothing else about the night's answer changes at that line.
    const young = nudgeOn("2026-10-09T02:20:00Z", "2026-10-11T02:17:00Z");
    expect(STALE_NIGHTS).toBe(3);
    expect(young?.nights).toBe(2);
    expect(young?.stale).toBe(false);
    expect(young?.page).toBeNull();
    expect(young?.comment).toContain("night 3");

    const stale = nudgeOn("2026-10-08T02:20:00Z", "2026-10-11T02:17:00Z");
    const page = stale?.page ?? "";
    expect(stale?.nights).toBe(3);
    expect(stale?.stale).toBe(true);
    expect(page).toContain("## Floor proposal — ⏳ #12 has sat unmerged for 3 nights");
    expect(page).toContain("opened on 2026-10-08");
    // It says what the red above it is about, so a morning reader is not sent looking for a finding
    // that did not happen tonight.
    expect(page).toContain("what the report above is red about is this request's");
    // …and the one command that answers it without a merge.
    expect(page).toContain("`npm run\n  coverage:low-water`");
  });

  it("stops posting a note and names somebody once the request has sat a week", () => {
    // The second threshold, and the boundary from both sides for the same reason the first one: six
    // nights is a proposal somebody may still be about to answer, and the seventh is the job asking a
    // *person* rather than a page — the one escalation a comment can make, since a new comment
    // notifies nobody who was not already watching the request.
    expect(ESCALATED_NIGHTS).toBe(7);
    // Stated as a relation rather than two numbers: an escalation that arrived *before* the run page
    // named the request would be the job shouting at somebody about a proposal it had not mentioned.
    expect(ESCALATED_NIGHTS).toBeGreaterThan(STALE_NIGHTS);

    const nearly = nudgeOn("2026-10-05T02:20:00Z", "2026-10-11T02:17:00Z", 12, "theow");
    expect(nearly?.nights).toBe(6);
    expect(nearly?.escalated).toBe(false);
    // Earned by the age, not by the handle: a young request is not commented *at* anybody, however
    // many owners it was handed.
    expect(nearly?.owner).toBe("");
    expect(nearly?.comment).not.toContain("@");
    expect(nearly?.comment).toContain("## The floor proposal re-fired tonight — night 7");
    expect(nearly?.page).toContain("## Floor proposal — ⏳ #12 has sat unmerged for 6 nights");
    expect(nearly?.page).not.toContain("names `@theow`");

    const escalated = nudgeOn("2026-10-04T02:20:00Z", "2026-10-11T02:17:00Z", 12, "theow");
    expect(escalated?.escalated).toBe(true);
    expect(escalated?.owner).toBe("@theow");
    const comment = escalated?.comment ?? "";
    // The age in the heading, so the notification says how long it has been — and the mention on its
    // own line, because a handle buried in a paragraph is not what a reader's eye lands on.
    expect(comment).toContain("## The floor proposal re-fired tonight — night 8 · unmerged for 7 nights");
    expect(comment).toContain("@theow — this request has sat unmerged for 7 nights.");
    expect(comment).toContain("names\na person instead of posting another note nobody has read");
    // It is the same comment that got louder rather than a second text: every line a reviewer reads on
    // a younger night is still here, which is what keeps the two from drifting apart.
    expect(comment).toContain("## The floor proposal re-fired tonight — night 8");
    expect(comment).toContain("read that table rather than the diff you first saw");
    expect(comment).toContain("this comment is the job saying so, not a second\nfinding");
    expect(comment).toContain("#12 · night 8");
    // …and the footer says which line it is past, so the comment explains its own voice.
    expect(comment).toContain(
      `past the ${ESCALATED_NIGHTS} nights this job only comments through · posted by the nightly job`,
    );
    // The page says where tonight's signal went, or the one reader who *is* looking at the page would
    // not know a person has been notified at all.
    expect(escalated?.page).toContain("## Floor proposal — ⏳ #12 has sat unmerged for 7 nights");
    expect(escalated?.page).toContain(`Past the ${ESCALATED_NIGHTS} nights this job only comments through`);
    expect(escalated?.page).toContain("names `@theow` on the request");
  });

  it("renders a mention only for a handle, and says so when the escalation has none", () => {
    // The mention is the escalation, so what counts as one matters: an `@` pasted in front of a
    // display name, a URL or an empty string would notify nobody while reading as if it had, which
    // is worse than an escalation that admits it named no one.
    expect(mentionOf("theow")).toBe("@theow");
    expect(mentionOf("@theow")).toBe("@theow");
    expect(mentionOf("  theow  ")).toBe("@theow");
    expect(mentionOf("the-ow")).toBe("@the-ow");
    expect(mentionOf("Theo W")).toBe("");
    expect(mentionOf("theow/websitebuildertoolsai")).toBe("");
    expect(mentionOf("-theow")).toBe("");
    expect(mentionOf("theow-")).toBe("");
    expect(mentionOf("a".repeat(40))).toBe("");
    expect(mentionOf("a".repeat(39))).toBe(`@${"a".repeat(39)}`);
    expect(mentionOf("")).toBe("");
    expect(mentionOf(undefined)).toBe("");

    // …and the two texts say it themselves rather than leaving a comment that looks addressed and is
    // not: nobody is named anywhere in it, and the footer is where a reader finds out why.
    const anonymous = nudgeOn("2026-10-04T02:20:00Z", "2026-10-11T02:17:00Z", 12, "Theo W");
    expect(anonymous?.escalated).toBe(true);
    expect(anonymous?.owner).toBe("");
    expect(anonymous?.comment).not.toContain("@");
    expect(anonymous?.comment).toContain("This request has sat unmerged for 7 nights.");
    // Not the sentence the named one reads: an escalation that says a person is being named while
    // naming nobody sends a reader looking for a notification that was never sent.
    expect(anonymous?.comment).toContain("this run had no owner handle to name");
    expect(anonymous?.comment).not.toContain("names\na person instead of posting another note");
    expect(anonymous?.comment).toContain("and no owner handle to name in this run");
    expect(anonymous?.page).toContain("names nobody — this run had no owner handle to mention");
  });
});

/**
 * The night's nudge, run as the nightly job runs it: a real spawn, because what the step depends on
 * is the command's own exit code, the file it leaves behind and the run page it appends to.
 */
describe("the coverage:trend --nudge command", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchDir("coverage-nudge-");
  });
  afterAll(() => {
    removeScratchDir(scratch);
  });

  const run = (
    args: string[],
    env: Record<string, string> = {},
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [trendModule, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  it("writes the night's comment, and names the request on the run page once it is stale", () => {
    const output = path.join(scratch, "stale-nudge.md");
    const summary = path.join(scratch, "stale-summary.md");

    const result = run(
      [
        "--nudge",
        "--number",
        "12",
        "--created",
        "2026-10-07T02:20:00Z",
        "--today",
        "2026-10-11",
        "--output",
        output,
      ],
      { GITHUB_STEP_SUMMARY: summary },
    );

    expect(result.status, result.stderr).toBe(0);
    const comment = readFileSync(output, "utf8");
    expect(comment).toContain("## The floor proposal re-fired tonight — night 5");
    expect(result.stdout).toContain("has been open 4 night(s)");
    expect(result.stdout).toContain("named on the run page");
    // The page gets the section, not the comment: the comment belongs to the pull request, and the
    // page says the one thing it can say — that the red above it is this request's business.
    const page = readFileSync(summary, "utf8");
    expect(page).toContain("## Floor proposal — ⏳ #12 has sat unmerged for 4 nights");
    expect(page).not.toContain("The nightly job re-derived the floors from tonight's records");
  });

  it("names the owner on the request once it has sat a week, from the flag or from the run", () => {
    const output = path.join(scratch, "escalated-nudge.md");
    const summary = path.join(scratch, "escalated-summary.md");
    const week = [
      "--nudge",
      "--number",
      "12",
      "--created",
      "2026-10-04T02:20:00Z",
      "--today",
      "2026-10-11",
      "--output",
      output,
    ];

    const named = run([...week, "--owner", "theow"], {
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_REPOSITORY_OWNER: "",
    });
    expect(named.status, named.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("@theow — this request has sat unmerged for 7 nights.");
    // The log line is what the step's reader sees on the run page, and it is where the escalation is
    // visible as a fact rather than only as prose in a comment nobody has opened.
    expect(named.stdout).toContain("has been open 7 night(s)");
    expect(named.stdout).toContain("theow named on the request");
    expect(readFileSync(summary, "utf8")).toContain("names `@theow` on the request");
    // No `--owner` and no complaint: the run's own owner is the default, which is what makes the
    // escalation need no flag in the workflow to be visible in the workflow.
    expect(named.stderr).not.toContain("no owner handle was given to name");

    // Rewritten by the second run with the same text: the mention in it is the proof that the
    // *run's* owner reached the module rather than being read from the flag's absence.
    const fromRun = run(week, { GITHUB_REPOSITORY_OWNER: "theow" });
    expect(fromRun.status, fromRun.stderr).toBe(0);
    expect(fromRun.stdout).toContain("@theow named on the request");
    expect(readFileSync(output, "utf8")).toContain(
      "@theow — this request has sat unmerged for 7 nights.",
    );
  });

  it("says out loud when the escalation has nobody to name", () => {
    // The failure this prevents is quiet: a comment that reads like an escalation and notifies nobody
    // at all. So the run is told, in the log of the night that could not name a person, and the two
    // texts say it where they are read — the point of escalating is that somebody notices this one.
    const output = path.join(scratch, "anonymous-nudge.md");
    const summary = path.join(scratch, "anonymous-summary.md");

    const result = run(
      [
        "--nudge",
        "--number",
        "12",
        "--created",
        "2026-10-04T02:20:00Z",
        "--today",
        "2026-10-11",
        "--output",
        output,
      ],
      { GITHUB_STEP_SUMMARY: summary, GITHUB_REPOSITORY_OWNER: "" },
    );

    // Still a pass: the night's comment was written and the age was answered, which is what this mode
    // is for. What is missing is a handle, and that is reported rather than failed.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`past the ${ESCALATED_NIGHTS} nights this job only comments`);
    expect(result.stderr).toContain("no owner handle was given to name");
    expect(result.stdout).toContain("nothing to mention");
    const comment = readFileSync(output, "utf8");
    expect(comment).toContain("This request has sat unmerged for 7 nights.");
    expect(comment).toContain("the night should be naming");
    expect(comment).not.toContain("@");
    expect(readFileSync(summary, "utf8")).toContain("names nobody — this run had no owner handle");
  });

  it("prints the comment and appends nothing while the request is still young", () => {
    const summary = path.join(scratch, "young-summary.md");

    const result = run(
      ["--nudge", "--number", "12", "--created", "2026-10-10T02:20:00Z", "--today", "2026-10-11"],
      { GITHUB_STEP_SUMMARY: summary },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("## The floor proposal re-fired tonight — night 2");
    expect(result.stdout).toContain("comment on stdout");
    expect(result.stdout).not.toContain("named on the run page");
    // Not an empty section on the page: the file the step appends to is not written at all.
    expect(existsSync(summary)).toBe(false);
  });

  it("reads no records at all: a runbook it cannot open costs the nudge nothing", () => {
    // The mode is about the *request* rather than about the floors — every number in it belongs to
    // the body the step above wrote — so it is reached before the records are read, the way the
    // recorder is. The proof is a nudge run with a runbook that is not there: the trend mode refuses
    // one (its whole subject is that file) and this one answers, because the age is not read from it.
    const summary = path.join(scratch, "nudge-no-records-summary.md");
    const missing = path.join(scratch, "no-runbook.md");

    const nudge = run(
      [
        "--nudge",
        "--number",
        "12",
        "--created",
        "2026-10-08T02:20:00Z",
        "--runbook",
        missing,
        "--today",
        "2026-10-11",
      ],
      { GITHUB_STEP_SUMMARY: summary },
    );
    expect(nudge.status, nudge.stderr).toBe(0);
    expect(nudge.stdout).toContain("night 4");
    expect(readFileSync(summary, "utf8")).toContain("has sat unmerged for 3 nights");
    // …while the mode that *is* about the records still refuses the same missing file, so the two
    // are told apart by what they read rather than by an accident of ordering.
    const trend = run(["--runbook", missing]);
    expect(trend.status).toBe(1);
    expect(trend.stderr).toContain("cannot read");
  });

  it("refuses an age it cannot read rather than nudging from a guess", () => {
    const output = path.join(scratch, "refused-nudge.md");

    const result = run([
      "--nudge",
      "--number",
      "12",
      "--created",
      "the other night",
      "--output",
      output,
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("needs --number <n> and a readable --created <date>");
    // Nothing was written, and no page was told about a request whose age nobody knows.
    expect(existsSync(output)).toBe(false);

    const noNumber = run(["--nudge", "--created", "2026-10-08T02:20:00Z"]);
    expect(noNumber.status).toBe(2);
    expect(noNumber.stderr).toContain("needs --number <n> and a readable --created <date>");
  });
});

/**
 * The proposals that *stopped* waiting: how long each sat before it was merged or dropped.
 *
 * The two loudness thresholds were chosen, not measured, and nothing recorded what the requests
 * actually did — so the job could get louder every night for a year and never know whether it was
 * shouting at proposals that answer themselves. These cases pin the record that answers it: one
 * dated line per answered request, in the runbook, stating the age and which threshold that age
 * crossed, written once and readable back. Two properties are contracts rather than details: the
 * line is *not* a reading (`runbookRecords`' head is a `ci verdict:`, so a record of when a
 * proposal was answered can never move a floor), and the dedupe is the runbook's own heads, because
 * the step that finds settlements runs every night.
 */
describe("the floor proposals that have been answered", () => {
  /** A settled request as the module reads one: the days, not the fields GitHub names them in. */
  const request = (
    number: number,
    created: string,
    closed: string | null,
    merged: string | null = closed,
  ) => ({ number, created, closed, merged });

  it("records the age a request sat, and which of the two thresholds that crossed", () => {
    // The whole review in one line: how many nights it sat, whether the run page had started naming
    // it, and whether the comment had started naming a person. Every clause comes from the two
    // constants, so moving either one moves what the records of the past are read as.
    const merged = floorProposalSettlement(
      request(23, "2026-10-20T02:20:00Z", "2026-10-29T09:00:00Z"),
    );
    expect(merged).toMatchObject({
      number: "23",
      opened: "2026-10-20",
      closed: "2026-10-29",
      nights: 9,
      outcome: "merged",
    });
    expect(merged?.line).toContain("- **2026-10-29 — floor proposal #23: merged after 9 nights.**");
    expect(merged?.line).toContain("on every one of the 9 nights it sat");
    expect(merged?.line).toContain(
      `past the ${ESCALATED_NIGHTS} nights at which the night's comment names a person`,
    );
    // A merge is the end of the question: no sentence about a proposal being dropped.
    expect(merged?.line).not.toContain("dropped rather than adopted");

    const dropped = floorProposalSettlement(
      request(24, "2026-10-20T02:20:00Z", "2026-10-24T09:00:00Z", null),
    );
    expect(dropped?.outcome).toBe("closed");
    expect(dropped?.line).toContain("- **2026-10-24 — floor proposal #24: closed after 4 nights.**");
    expect(dropped?.line).toContain(
      `past the ${STALE_NIGHTS} nights at which the run page starts naming it, and answered before ` +
        `the ${ESCALATED_NIGHTS} at which a comment names a person`,
    );
    // …and a drop says what it means for the floors, which is not "decided": the discrepancy is
    // still there, so the next night derives it again.
    expect(dropped?.line).toContain("It was dropped rather than adopted");
    // The head stays the marker's own shape for a drop — `closed`, never a phrase — because the
    // reader and the dedupe both match on it.
    expect(floorProposalSettlements(dropped?.line ?? "")).toEqual([
      { date: "2026-10-24", number: "24", outcome: "closed", nights: 4 },
    ]);

    // The three bands, at their own boundaries: the constants are the line, not a copy of it.
    expect(settlementBand(0)).toBe("before either threshold");
    expect(settlementBand(STALE_NIGHTS - 1)).toBe("before either threshold");
    expect(settlementBand(STALE_NIGHTS)).toBe("after the run page");
    expect(settlementBand(ESCALATED_NIGHTS - 1)).toBe("after the run page");
    expect(settlementBand(ESCALATED_NIGHTS)).toBe("after the escalation");
  });

  it("says zero and one nights in their own words, and refuses an age that is not one", () => {
    // Zero and one are the fast end of the distribution the review is reading — a proposal adopted
    // the day it was opened is the best case, not a broken one — so they are said rather than
    // rounded into a plural or dropped for looking like an absence.
    const sameDay = floorProposalSettlement(
      request(20, "2026-10-20T02:20:00Z", "2026-10-20T09:00:00Z"),
    );
    expect(sameDay?.nights).toBe(0);
    expect(sameDay?.line).toContain("- **2026-10-20 — floor proposal #20: merged after 0 nights.**");
    expect(sameDay?.line).toContain("answered 2026-10-20 the same day, so no night passed");

    const oneNight = floorProposalSettlement(
      request(21, "2026-10-20T02:20:00Z", "2026-10-21T09:00:00Z"),
    );
    expect(oneNight?.line).toContain("- **2026-10-21 — floor proposal #21: merged after 1 night.**");
    expect(oneNight?.line).toContain("on the one night in between");

    // And an age that cannot be read is not a small age: an open request (no close at all), a date
    // that is not one, no number, and a close that reads *before* its open are refused, not guessed.
    expect(floorProposalSettlement(request(12, "2026-10-08T02:20:00Z", null, null))).toBeNull();
    expect(
      floorProposalSettlement({ number: 12, created: "the other night", closed: "2026-10-11T02:20:00Z" }),
    ).toBeNull();
    expect(
      floorProposalSettlement({ created: "2026-10-08T02:20:00Z", closed: "2026-10-11T02:20:00Z" }),
    ).toBeNull();
    expect(
      floorProposalSettlement({
        number: 12,
        created: "2026-10-20T02:20:00Z",
        closed: "2026-10-19T02:20:00Z",
        merged: null,
      }),
    ).toBeNull();
  });

  it("reads the records back out of the runbook, and keeps them out of the readings", () => {
    const line = floorProposalSettlement(
      request(13, "2026-10-04T02:20:00Z", "2026-10-13T11:00:00Z"),
    )?.line;
    const runbook = [
      "# The runbook",
      "",
      "- **2026-09-30 — ci verdict: 10 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (10 selected); all stages passed.** typecheck PASS.",
      `  rendered-links coverage: chrome — the footer 14 (27 unique destinations).`,
      "",
      `${line}`,
      "",
    ].join("\n");

    // The record read back is what the line states, so a person reviewing the thresholds is reading
    // the job's own history rather than a second derivation of it.
    expect(floorProposalSettlements(runbook)).toEqual([
      { date: "2026-10-13", number: "13", outcome: "merged", nights: 9 },
    ]);
    expect(floorProposalSettlements("# The runbook\n")).toEqual([]);

    // …and the one property beyond the record itself: a night's answer to a proposal is not a
    // measurement. The settlement head is deliberately not a `ci verdict:` head, so a settlement
    // bullet contributes no record to the floors — it cannot move a low-water mark, and the trend
    // cannot read a night's answer as a reading of anything.
    const settlementOnly = ["# The runbook", "", `${line}`, ""].join("\n");
    expect(runbookRecords(settlementOnly)).toEqual([]);
  });

  it("records each request once, oldest answer first, however GitHub lists them", () => {
    const existing = floorProposalSettlement(
      request(11, "2026-09-29T02:20:00Z", "2026-10-01T07:00:00Z"),
    )?.line;
    const text = ["# The runbook", "", `${existing}`, ""].join("\n");
    // Newest first, the way `gh pr list` answers, with the already-recorded request and an open one
    // mixed in: the order GitHub happens to use must not become the runbook's order, and nothing an
    // earlier night recorded may be recorded again.
    const settled = [
      request(14, "2026-05-01T02:20:00Z", "2026-05-03T09:00:00Z", null),
      request(12, "2026-10-08T02:20:00Z", null, null),
      request(13, "2026-10-04T02:20:00Z", "2026-10-13T11:00:00Z"),
      request(11, "2026-09-29T02:20:00Z", "2026-10-01T07:00:00Z"),
    ];

    const recorded = recordFloorProposals({ text, settled });
    expect(recorded.added.map((record) => record.number)).toEqual(["14", "13"]);
    expect(recorded.text.indexOf("#14")).toBeLessThan(recorded.text.indexOf("#13"));
    expect(recorded.text.indexOf("#11")).toBeLessThan(recorded.text.indexOf("#14"));
    expect(recorded.text.match(/#11: merged/g)).toHaveLength(1);
    expect(recorded.text).not.toContain("#12");
    expect(recorded.records.map((record) => record.number)).toEqual(["11", "14", "13"]);

    // The second night writes nothing, because the file says what the first one found — which is the
    // whole of why the step can run every night.
    const again = recordFloorProposals({ text: recorded.text, settled });
    expect(again.added).toEqual([]);
    expect(again.text).toBe(recorded.text);
  });

  it("states the whole history on the page, oldest answer first", () => {
    // Nothing to state is an omission, never an empty section — the same rule the report and the
    // chart follow — so a night before the first proposal was answered adds nothing to the page.
    expect(renderFloorSettlementSection([])).toBeNull();

    const section =
      renderFloorSettlementSection([
        { date: "2026-10-13", number: "13", outcome: "merged", nights: 9 },
        { date: "2026-05-03", number: "14", outcome: "closed", nights: 2 },
      ]) ?? "";

    expect(section).toContain("### Floor proposals answered");
    // The thresholds are named with their values, because the table is the reading of them.
    expect(section).toContain(`\`STALE_NIGHTS\` (${STALE_NIGHTS})`);
    expect(section).toContain(`\`ESCALATED_NIGHTS\` (${ESCALATED_NIGHTS})`);
    expect(section.split("\n").filter((line) => line.startsWith("| #"))).toEqual([
      "| #14 | 2026-05-03 | 2 | closed unmerged, before either threshold |",
      "| #13 | 2026-10-13 | 9 | merged, after the escalation |",
    ]);
    // …and the table says what it is *for*, since a column of ages without the question it answers is
    // decoration rather than a review.
    expect(section).toContain("a job being loud about proposals that answer");
  });

  it("counts those ages as a distribution, and reads the escalation against the answers", () => {
    // The shape of the whole review in one object, which is the one thing a column of records cannot
    // answer on its own: how many answers landed in each band, and what their ages say about the
    // mention. The bands are asked for through `settlementBand` rather than written here as
    // phrases, so this case pins the counting as covering what that function can answer — a band
    // renamed there fails this case instead of leaving the table claiming a name nothing produces.
    const distribution = settlementDistribution([
      { date: "2026-05-03", number: "14", outcome: "closed", nights: 0 },
      { date: "2026-05-04", number: "15", outcome: "merged", nights: STALE_NIGHTS - 1 },
      { date: "2026-06-01", number: "16", outcome: "merged", nights: STALE_NIGHTS },
      { date: "2026-06-08", number: "17", outcome: "merged", nights: ESCALATED_NIGHTS },
      { date: "2026-06-20", number: "18", outcome: "closed", nights: ESCALATED_NIGHTS + 4 },
    ]);

    expect(distribution?.total).toBe(5);
    expect(distribution?.bands).toEqual([
      { band: settlementBand(0), count: 2, share: 40 },
      { band: settlementBand(STALE_NIGHTS), count: 1, share: 20 },
      { band: settlementBand(ESCALATED_NIGHTS), count: 2, share: 40 },
    ]);
    // The spread travels beside the counts, because three bands across two thresholds is a coarse
    // reading of five numbers and a reader cannot tell one-night answers from three-night ones
    // without it.
    expect(distribution?.fastest).toBe(0);
    expect(distribution?.slowest).toBe(ESCALATED_NIGHTS + 4);
    // …and the question the bands cannot answer: the mention arrives at a *night*, so whether it was
    // ever spent is a fact about the timing rather than about the band the answer landed in.
    expect(distribution?.escalation).toEqual({
      crossed: 2,
      onFirstNight: 1,
      later: 1,
      // The four nights the later answer sat after the mention had already gone out.
      spareNights: 4,
    });
  });

  it("says nothing rather than a row of zeroes, and never counts an age it cannot read", () => {
    // Both read whatever a run hands them — a JSON list off a workflow, a record a person typed — so
    // what they do with input their JSDoc does not promise is asked for directly rather than assumed.
    const asRecords = (value: unknown) => value as Parameters<typeof settlementDistribution>[0];
    const asDistribution = (value: unknown) =>
      value as Parameters<typeof renderSettlementDistribution>[0];

    // A runbook with no settlements is an omission, not a table of zeroes — the rule the whole page
    // follows — and an age that cannot be read is not a small one: counting a missing number as zero
    // would put a proposal in the fastest band on the strength of a broken record.
    expect(settlementDistribution([])).toBeNull();
    expect(settlementDistribution(asRecords(null))).toBeNull();
    expect(settlementDistribution(asRecords([{ nights: "the other night" }, { number: 4 }]))).toBeNull();
    expect(settlementDistribution(asRecords([{ nights: "x" }, { nights: 3 }]))?.total).toBe(1);
    // …and the block renders nothing for a distribution that is not one, rather than throwing at
    // whatever handed it one.
    expect(renderSettlementDistribution(asDistribution(null), "floor")).toBeNull();
  });

  it("states the distribution above the records, and both readings of the escalation", () => {
    const escalated =
      renderFloorSettlementSection([
        { date: "2026-10-13", number: "13", outcome: "merged", nights: ESCALATED_NIGHTS + 2 },
        { date: "2026-06-08", number: "17", outcome: "merged", nights: ESCALATED_NIGHTS },
        { date: "2026-05-03", number: "14", outcome: "closed", nights: 0 },
      ]) ?? "";

    // The counts, in the constants' own words: the table and the wording of the records are the same
    // three bands, so neither can drift from the other.
    expect(escalated).toContain("#### Where the ages landed");
    expect(escalated).toContain(`| ${settlementBand(0)} | 1 | 33% |`);
    expect(escalated).toContain(`| ${settlementBand(STALE_NIGHTS)} | 0 | 0% |`);
    expect(escalated).toContain(`| ${settlementBand(ESCALATED_NIGHTS)} | 2 | 67% |`);
    // …and the row the loudness read is *for*: how often the mention was already out when the
    // answer arrived, which is the only thing in these records that can judge it.
    expect(escalated).toContain("#### How often the escalation mattered");
    expect(escalated).toContain(
      `| the day the mention first went out (\`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS}) | 1 | 0 |`,
    );
    expect(escalated).toContain("| later than that | 1 | 2 |");
    expect(escalated).toContain("| before the mention ever went out | 1 | — |");
    expect(escalated).toContain("2 of the 3 answers arrived with the mention already out");
    // Summary first, receipts after: the counts are what a reviewer came for, and the per-request
    // table below is where they came from rather than a second answer to the same question.
    expect(escalated.indexOf("#### Where the ages landed")).toBeLessThan(
      escalated.indexOf("| request | answered"),
    );

    // A history that has never escalated one says so in as many words: a zero in the first row would
    // read as a band nobody counted, and this is the reading the two constants are on trial for.
    const quiet =
      renderFloorSettlementSection([
        { date: "2026-05-03", number: "14", outcome: "closed", nights: 0 },
      ]) ?? "";
    expect(quiet).toContain("The escalation has not been reached once");
    expect(quiet).not.toContain("arrived with the mention already out");
    expect(quiet).toContain("| later than that | 0 | 0 |");
  });

  it("reads the ages as a trend across the nights they were answered on", () => {
    // The pure reader behind the page's third reading, asked for directly: one point per night an
    // answer arrived, the median of every age recorded up to and including it, and how far that moved
    // against the point before — the reading the bands cannot give, because an answer either crossed a
    // threshold or it did not while the middle of the ages can climb toward one first.
    // What it reads is promised as a list of dated records; the shapes below are what a run can still
    // hand it, so they are cast the way this file's other out-of-contract probes are.
    const asAges = (value: unknown) => value as Parameters<typeof settlementAgeTrend>[0];

    expect(settlementAgeTrend([])).toEqual([]);
    expect(settlementAgeTrend([{ date: "2026-10-20", number: "1", nights: 2 }])).toEqual([
      { date: "2026-10-20", ages: [2], count: 1, median: 2, change: null },
    ]);
    expect(settlementAgeTrend(asAges([{ date: "2026-10-20", nights: 2 }]))).toEqual([
      { date: "2026-10-20", ages: [2], count: 1, median: 2, change: null },
    ]);

    // Two answers on one night are one point — the median is a reading of the answers so far rather
    // than of the calendar — and an even count answers with a half night rather than a rounding of one,
    // which is a step of the movement and not noise to be smoothed away. The day's own answers are met
    // in the order the receipts meet them, by number, however a caller listed them.
    expect(
      settlementAgeTrend([
        { date: "2026-10-20", number: "2", nights: 3 },
        { date: "2026-10-20", number: "1", nights: 0 },
        { date: "2026-10-22", number: "3", nights: 5 },
      ]),
    ).toEqual([
      { date: "2026-10-20", ages: [0, 3], count: 2, median: 1.5, change: null },
      { date: "2026-10-22", ages: [5], count: 3, median: 3, change: 1.5 },
    ]);

    // Neither is guessed at, the rule the counts follow: an age that cannot be read is left out of the
    // ages the medians run on, and a record that states no day at all has no night to belong to — it is
    // counted in the tables and absent from the line, never plotted at a day nothing stated. A night
    // nothing was answered adds no point either, for the same reason: there is no new age to move a
    // median on, and a blank in the series would claim a night was measured.
    expect(
      settlementAgeTrend(
        asAges([
          { date: "2026-10-20", number: "1", nights: 2 },
          { date: "", number: "2", nights: 9 },
          { number: "3", nights: 9 },
          { date: "2026-10-25", number: "4", nights: "x" },
        ]),
      ),
    ).toEqual([{ date: "2026-10-20", ages: [2], count: 1, median: 2, change: null }]);
  });

  it("states the median trend on the page, and reads it against the thresholds", () => {
    // The case this block exists for: a rise that is *visible* while every single age is still inside
    // the first threshold, which is the one thing the two tables above cannot show — they are read one
    // age at a time, so nothing there moves until an answer crosses a band.
    const records = [
      { date: "2026-10-14", number: "30", outcome: "merged", nights: 0 },
      { date: "2026-10-18", number: "31", outcome: "merged", nights: 2 },
      { date: "2026-10-18", number: "32", outcome: "closed", nights: 2 },
      { date: "2026-10-26", number: "33", outcome: "merged", nights: 1 },
    ];
    const section = renderFloorSettlementSection(records) ?? "";

    // One row per night an answer arrived, oldest first, with the running median and its movement — a
    // cell rather than something a reader has to subtract from the row above it.
    expect(section.split("\n").filter((line) => line.startsWith("| 2026-"))).toEqual([
      "| 2026-10-14 | 0 | 1 | 0 | — |",
      // The change is against the row above it, which is what makes the column a series: a second
      // answer on a night already plotted moves that night's point rather than adding a row beside it,
      // so this night's median is held against the one before the night, not against itself.
      "| 2026-10-18 | 2, 2 | 3 | 2 | +2 |",
      "| 2026-10-26 | 1 | 4 | 1.5 | -0.5 |",
    ]);
    // …and the picture is drawn against the two thresholds rather than against the series' own range,
    // which is the one place this departs from the chart above: normalized to itself a half-night drift
    // would fill the scale, while the whole point here is how far the middle of the ages is from the
    // loud end.
    expect(section).toContain("on a scale of 0 → 7 nights");
    expect(section).toContain("up 1.5 from 0");

    // The reading, in numbers: it rose, it peaked before the point it ended on, and where it ended is
    // held against the first threshold in the floor's own words for what that night is.
    expect(section).toContain(
      "The median has risen 0 → 1.5 nights across the 3 nights an answer arrived on (it peaked at 2 on 2026-10-18).",
    );
    expect(section).toContain(
      `The newest median, 1.5 nights, is inside the first threshold: 1.5 nights short of the night the run page starts naming one (\`STALE_NIGHTS\` = ${STALE_NIGHTS}).`,
    );
    // …and the two readings of one history are the same ages: all four are inside the first band, so
    // the bands say nothing has happened while the median has risen 0 → 1.5.
    expect(section).toContain(`| ${settlementBand(STALE_NIGHTS - 1)} | 4 | 100% |`);

    // A single answer night has numbers and no movement: the table is there, the bars are not, and the
    // sentence says a second night is what would make this a series.
    const one =
      renderFloorSettlementSection([
        { date: "2026-05-03", number: "14", outcome: "closed", nights: 0 },
      ]) ?? "";
    expect(one).toContain("#### How the median wait moved");
    expect(one).toContain("| 2026-05-03 | 0 | 1 | 0 | — |");
    expect(one).not.toContain("- **median wait**");
    expect(one).toContain(
      "The median is 0 nights so far, from the one night an answer arrived on — a second one is what makes this a movement.",
    );

    // …and a record that states no day is counted above and named as absent here, rather than leaving
    // the series quietly shorter than the counts it sits under.
    const undated =
      renderFloorSettlementSection(
        [
          { date: "2026-10-14", number: "30", outcome: "merged", nights: 2 },
          { number: "31", outcome: "merged", nights: 4 },
        ] as unknown as Parameters<typeof renderFloorSettlementSection>[0],
      ) ?? "";
    expect(undated).toContain(
      "1 of the 2 records counted above names no day it was answered, so it is in the tables above and not on this line.",
    );
  });

  it("warns when the middle of the ages passes the level the history had held", () => {
    // The two thresholds are read one request at a time, so the first night either of them can say
    // anything about this job is the night a request has already sat that long. The middle of the ages
    // moves earlier, and this is what turns that movement into something the night *says*: the newest
    // median held against the worst any earlier answer night ended at. It is an event rather than a
    // state — it fires on the night the wait becomes the longest it has ever been, and never again while
    // the median stays below the line it crossed.
    expect(settlementWaitWarning([])).toBeNull();
    expect(
      settlementWaitWarning([{ date: "2026-10-14", number: "30", outcome: "merged", nights: 9 }]),
    ).toBeNull();

    const rising = [
      { date: "2026-10-14", number: "30", outcome: "merged", nights: 0 },
      { date: "2026-10-18", number: "31", outcome: "merged", nights: 1 },
      { date: "2026-10-26", number: "32", outcome: "merged", nights: 2 },
    ];
    expect(settlementWaitWarning(rising)).toEqual({
      held: 0.5,
      heldSince: "2026-10-18",
      latest: 1,
      latestDate: "2026-10-26",
      answers: 3,
      nights: 3,
      total: 3,
      reached: { first: 0, second: 0 },
    });

    // A median that fell back to a level an earlier night held is no crossing, and neither is one that
    // matched the worst without passing it: in both of these the newest median is a level the history
    // had already held.
    expect(
      settlementWaitWarning([
        { date: "2026-10-14", number: "30", outcome: "merged", nights: 4 },
        { date: "2026-10-18", number: "31", outcome: "merged", nights: 2 },
      ]),
    ).toBeNull();
    expect(
      settlementWaitWarning([
        { date: "2026-10-14", number: "30", outcome: "merged", nights: 2 },
        { date: "2026-10-18", number: "31", outcome: "merged", nights: 1 },
        { date: "2026-10-26", number: "32", outcome: "merged", nights: 2 },
      ]),
    ).toBeNull();

    // The page leads with it — ahead of the distribution and the receipts, because a warning buried
    // under three tables is not one — and the sentence says what the two thresholds have *not* done yet,
    // which is the whole reason a median is carried: every age in this history is still inside the first
    // band, and the bands above have nothing to say about it.
    const section = renderFloorSettlementSection(rising) ?? "";
    expect(section).toContain("#### The median wait is past the level it had held");
    expect(section.indexOf("#### The median wait is past")).toBeLessThan(
      section.indexOf("#### Where the ages landed"),
    );
    expect(section).toContain(
      "The middle of these ages is now 1 night, higher than the 0.5 nights the history had held since " +
        `2026-10-18 — no age in the records has yet reached the ${STALE_NIGHTS} nights at which the run ` +
        "page starts naming one.",
    );
    expect(section).toContain("this one moved on 2026-10-26, over the 3 answers recorded so far.");
    expect(section).toContain(`| ${settlementBand(0)} | 3 | 100% |`);

    // …and a history whose median never passed what it held carries no block at all: the omission every
    // other part of this page makes, rather than a warning about a wait that has been held.
    const quiet =
      renderFloorSettlementSection([
        { date: "2026-10-14", number: "30", outcome: "merged", nights: 4 },
        { date: "2026-10-18", number: "31", outcome: "merged", nights: 2 },
      ]) ?? "";
    expect(quiet).not.toContain("past the level it had held");
  });

  it("states that finding as the comment a night can leave where somebody will read it", () => {
    // The third channel for one finding, and the only one of the three that can reach a person: the page
    // reaches whoever opens the run and the annotation whoever watches the job, while the comment lands on
    // the request that is still open, where somebody who can answer it is already looking. It is a
    // different text from the night's own comment on that request, and on purpose: that one is about the
    // request's age and exists only on a night the floors moved, while this one is about the record — so
    // what it says is the finding, why this request is the one that answers it, and nothing about the age
    // beyond the footer, which is where a detail belongs in a comment whose subject is the record.
    const rising = [
      { date: "2026-10-14", number: "30", outcome: "merged", nights: 0 },
      { date: "2026-10-18", number: "31", outcome: "merged", nights: 1 },
      { date: "2026-10-26", number: "32", outcome: "merged", nights: 2 },
    ];
    const wait = settlementWaitWarning(rising);
    if (wait === null) throw new Error("the fixture no longer passes a level the history had held");
    const comment = renderFloorWaitComment({
      wait,
      number: "604",
      created: "2026-10-24",
      nights: 2,
    });

    expect(comment).toContain("## The wait these proposals settle at is now the worst the record holds");
    expect(comment).toContain(
      "The middle of every age in the record is now 1 night, higher than the 0.5 nights the history had " +
        `held since 2026-10-18 — no age in the records has yet reached the ${STALE_NIGHTS} nights at which ` +
        "the run page starts naming one.",
    );
    expect(comment).toContain("**This request is the one that answers that reading**");
    expect(comment).toContain(
      "<sub>#604 · 2 nights open, since 2026-10-24 · the median wait is 1 night ·",
    );
    // Nobody is named, and that is the rule rather than an omission: the mention past `ESCALATED_NIGHTS`
    // belongs to the night's own note about this request's age, and one mention meaning two findings
    // would mean neither.
    expect(comment).not.toMatch(/@[A-Za-z0-9-]+/);
    // …and a caller with no age to state gets the phrase dropped rather than a number this could not
    // compute — the omission the rest of this module makes rather than a guess.
    expect(renderFloorWaitComment({ wait, number: "604", created: null })).toContain(
      "<sub>#604 · the median wait is 1 night ·",
    );
  });

  it("records a crossing as the level the median passed, and reads it back as one", () => {
    // The record is what makes the finding an *event* rather than a state, so it is held to the
    // settlement lines' own requirement — readable back exactly as it was written — with the one field
    // that exists for the decision: the **level** the median passed, not the night it was noticed.
    const crossing = waitCrossing({
      date: "2026-11-03",
      number: 604,
      latest: 4,
      held: 2.5,
      since: "2026-10-20",
    });
    if (crossing === null) throw new Error("the fixture no longer makes a crossing");
    expect(crossing.line).toContain(
      "- **2026-11-03 — settled wait on #604: the median reached 4 nights, past the 2.5 it had held " +
        "since 2026-10-20.**",
    );
    expect(waitCrossings(crossing.line)).toEqual([
      { kind: "floor", date: "2026-11-03", number: "604", latest: 4, held: 2.5, since: "2026-10-20" },
    ]);
    // …and the other kind has a line of its own, read by its own head and *not* by this one: a level one
    // series passed is nothing the other may measure against, which is what the kind on every record is
    // for — and the collect line names the series rather than a request, because there is no request of
    // this job's own in that story.
    const collectCrossing = waitCrossing({
      kind: "collect",
      date: "2026-11-03",
      latest: 4,
      held: 2.5,
      since: "2026-10-20",
    });
    if (collectCrossing === null) throw new Error("the collect fixture no longer makes a crossing");
    expect(collectCrossing.line).toContain(
      "- **2026-11-03 — settled collect-budget wait: the median reached 4 nights, past the 2.5 it had " +
        "held since 2026-10-20.**",
    );
    expect(waitCrossings(collectCrossing.line, "collect")).toEqual([
      { kind: "collect", date: "2026-11-03", number: "", latest: 4, held: 2.5, since: "2026-10-20" },
    ]);
    expect(waitCrossings(collectCrossing.line, "floor")).toEqual([]);
    expect(waitCrossings(crossing.line, "collect")).toEqual([]);
    // The whole-file read is both series' lines, each tagged with the kind it belongs to — which is what
    // lets the trend step hold every line against its own kind's settlements.
    expect(waitCrossings(`${crossing.line}\n${collectCrossing.line}\n`).map((read) => read.kind)).toEqual([
      "floor",
      "collect",
    ]);
    // …while a line edited by hand into something else stops being a crossing rather than being read as
    // a nearly-right one, and the settlement heads are not this head: a record of *when the job was
    // answered* and one of what it has already said are two different stories about two different things.
    expect(waitCrossings("- **2026-11-03 — floor proposal #604: merged after 4 nights.**")).toEqual([]);
    expect(waitCrossings(crossing.line.replace("past the 2.5", "past the"))).toEqual([]);

    // A crossing that cannot be stated in full is refused rather than recorded as a nearly-right one,
    // which is the settlement writer's own rule: the writer is total about the *bar* and strict about
    // what it will write.
    const full = { date: "2026-11-03", number: 604, latest: 4, held: 2.5, since: "2026-10-20" };
    expect(waitCrossing({ ...full, number: undefined })).toBeNull();
    expect(waitCrossing({ ...full, number: "  " })).toBeNull();
    expect(waitCrossing({ ...full, date: "the third" })).toBeNull();
    expect(waitCrossing({ ...full, since: "the night before last" })).toBeNull();
    expect(waitCrossing({ ...full, latest: "four" })).toBeNull();
    expect(waitCrossing({ ...full, held: "two" })).toBeNull();
    // …and the halves of a level are carried as they were rather than rounded into another reading: a
    // median over an even count of ages is a half night, which is the step the movement is read in.
    expect(waitCrossing({ ...full, latest: 2.5 })?.latest).toBe(2.5);

    // The bar a later night is held to is the *highest* level a comment has been about, and where two
    // stand at one level the later of them — the two tie-breaks that keep the page's sentence and the
    // decider's number one answer to one question.
    const older = { date: "2026-10-01", number: "1", latest: 3, held: 2, since: "2026-09-20" };
    const newer = { date: "2026-10-05", number: "2", latest: 5, held: 4, since: "2026-09-25" };
    const tied = { date: "2026-10-09", number: "3", latest: 6, held: 4, since: "2026-09-25" };
    expect(saidWaitCrossing([])).toBeNull();
    expect(saidWaitLevel([])).toBeNull();
    expect(saidWaitLevel([older, newer, tied])).toBe(4);
    expect(saidWaitCrossing([older, newer, tied])).toBe(tied);
    // A record nothing can read a level out of is the same `null` as no record at all, rather than a bar
    // of zero: a level nobody has held is not a level a rise has to pass.
    expect(saidWaitLevel([{ held: Number.NaN }])).toBeNull();

    // The writer appends one line with the blank line before it, and is total over the bar: the second
    // call in this pair is what a retried step or a night run twice does, and it must record nothing —
    // which is what keeps the *level* single however often the caller calls it.
    const first = recordWaitCrossing("# The runbook\n", crossing);
    expect(first.added).toEqual(crossing);
    expect(first.text).toBe(`# The runbook\n\n${crossing.line}\n`);
    expect(recordWaitCrossing(first.text, crossing)).toEqual({ text: first.text, added: null });
    // …while a later rise past that level is a new crossing and lands beside it.
    const beyond = waitCrossing({
      date: "2026-11-09",
      number: "604",
      latest: 6,
      held: 4,
      since: "2026-10-28",
    });
    if (beyond === null) throw new Error("the fixture no longer makes a crossing");
    expect(recordWaitCrossing(first.text, beyond).text).toBe(`${first.text}\n${beyond.line}\n`);
    // A crossing it was handed none of changes nothing, and an empty runbook gains no leading blank line.
    expect(recordWaitCrossing(first.text, null)).toEqual({ text: first.text, added: null });
    expect(recordWaitCrossing("", beyond).text).toBe(`${beyond.line}\n`);
  });

  it("refuses a crossing line the settlement records do not produce", () => {
    // The gate over the record, and the reason it exists: a crossing line is not a reading — nothing
    // derives a floor from it and the trend charts nothing off it — it is the **bar** the night's
    // decision reads. A line the history cannot produce is a level nothing has held, and both
    // directions are failures: too high and a crossing that is really new is never said, too low and
    // one already said is said again. The series is the page's own (`settlementAgeTrend`), so the bar
    // is checked against the very numbers the decision is written in.
    const settled = [
      request(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
      request(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
      request(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
      request(605, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z"),
    ];
    const records = floorProposalSettlements(
      recordFloorProposals({ text: "# The runbook\n", settled }).text,
    );
    expect(records.map((record) => record.nights)).toEqual([1, 4, 6, 7]);
    // …and the middle of those ages on the four nights an answer arrived: 1, 2.5, 4, 5 — the levels a
    // line can legitimately name, and the nights they first stood.
    expect(settlementAgeTrend(records).map((point) => [point.date, point.median])).toEqual([
      ["2026-10-15", 1],
      ["2026-10-20", 2.5],
      ["2026-10-28", 4],
      ["2026-11-05", 5],
    ]);

    /** A crossing the fixture is about, as the runbook holds it — read back, not handed in. */
    const recorded = (options: Parameters<typeof waitCrossing>[0]) => {
      const made = waitCrossing(options);
      if (made === null) throw new Error("the fixture no longer makes a crossing");
      const lines = waitCrossings(made.line);
      if (lines.length !== 1) throw new Error("the fixture's line is not one the reader can read back");
      return lines[0];
    };

    // A night's own record, both the crossings this series really has, is left alone — the check is a
    // refutation, not a rewrite.
    const produced = [
      recorded({ date: "2026-11-03", number: 604, latest: 4, held: 2.5, since: "2026-10-20" }),
      recorded({ date: "2026-11-05", number: 604, latest: 5, held: 4, since: "2026-10-28" }),
    ];
    expect(waitCrossingDrift(records, produced)).toEqual([]);
    // …and so is the same crossing said on a later night: the record is about the *level*, so the night a
    // comment was left on is only held to not being before the crossing happened.
    expect(
      waitCrossingDrift(records, [
        recorded({ date: "2026-11-14", number: "604", latest: 4, held: 2.5, since: "2026-10-20" }),
      ]),
    ).toEqual([]);

    // The five ways a line can stop being one the records produce, each reported with the first leg that
    // fails rather than everything that follows from it.
    const drift = (options: Parameters<typeof waitCrossing>[0]) =>
      waitCrossingDrift(records, [recorded(options)]);
    expect(drift({ date: "2026-11-05", number: 604, latest: 6, held: 4, since: "2026-10-28" })).toEqual([
      { crossing: expect.anything(), reason: "unreached", seen: { latest: 6 } },
    ]);
    expect(drift({ date: "2026-11-05", number: 604, latest: 4, held: 1, since: "2026-10-15" })).toEqual([
      { crossing: expect.anything(), reason: "unheld", seen: { held: 1, worst: 2.5 } },
    ]);
    expect(drift({ date: "2026-11-05", number: 604, latest: 4, held: 2.5, since: "2026-10-19" })).toEqual([
      { crossing: expect.anything(), reason: "unsince", seen: { held: 2.5, since: "2026-10-19", first: "2026-10-20" } },
    ]);
    expect(drift({ date: "2026-10-01", number: 604, latest: 4, held: 2.5, since: "2026-10-20" })).toEqual([
      { crossing: expect.anything(), reason: "premature", seen: { date: "2026-10-01", movedOn: "2026-10-28" } },
    ]);
    expect(drift({ date: "2026-11-05", number: 604, latest: 2.5, held: 2.5, since: "2026-10-20" })).toEqual([
      { crossing: expect.anything(), reason: "unpassed", seen: { latest: 2.5, held: 2.5 } },
    ]);
    // …and the line that states the very first night the series has is its own case: a crossing is
    // measured against the nights before it, and that one has none.
    expect(drift({ date: "2026-10-15", number: 604, latest: 1, held: 0, since: "2026-10-01" })).toEqual([
      { crossing: expect.anything(), reason: "unheld", seen: { held: 0, worst: null } },
    ]);
    // One finding per line, in the order the runbook holds them, so a runbook somebody edited by hand
    // reports every line rather than the first one it trips over.
    expect(
      waitCrossingDrift(records, [
        recorded({ date: "2026-10-01", number: 604, latest: 4, held: 2.5, since: "2026-10-20" }),
        recorded({ date: "2026-11-05", number: 604, latest: 6, held: 4, since: "2026-10-28" }),
      ]).map((finding) => finding.reason),
    ).toEqual(["premature", "unreached"]);

    // Two omissions, both deliberate: a series that has not started cannot refute anything — a bar is
    // only wrong about a history there is one — and a runbook with no crossings is checked for nothing.
    expect(waitCrossingDrift([], produced)).toEqual([]);
    expect(waitCrossingDrift(records.slice(0, 1), produced)).toEqual([]);
    expect(waitCrossingDrift(records, [])).toEqual([]);
  });

  it("states that refutation on the page too, where the record is discussed", () => {
    // One finding, two surfaces. The trend step is where a night *fails* over a crossing line the
    // settlements do not produce; the settlement section is the page a person opening the run reads
    // first, and the history those lines were derived from is the thing being discussed there — so a
    // reader of the section should not have to open the log of a step two stages later to learn that
    // the record quoting back at them is one these records cannot produce. This holds the two
    // renderings against each other rather than trusting that they were written alike.
    const settled = [
      request(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
      request(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
      request(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
      request(605, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z"),
    ];
    const text = recordFloorProposals({ text: "# The runbook\n", settled }).text;
    const records = floorProposalSettlements(text);
    // …the middle of those ages being 1, 2.5, 4 and 5 on the four nights an answer arrived, which is
    // the series both surfaces read the lines against.
    expect(settlementAgeTrend(records).map((point) => point.median)).toEqual([1, 2.5, 4, 5]);
    /** One line as the writer builds it, as a runbook holds it. */
    const line = (options: Parameters<typeof waitCrossing>[0]) => {
      const made = waitCrossing(options);
      if (made === null) throw new Error("the fixture no longer makes a crossing");
      return made.line;
    };

    // Two directions at once, which is the whole point of the finding: a bar above what the records
    // held and one below it are both levels nothing has held. The second line is *edited in* by hand,
    // which is the case this exists for — `recordWaitCrossing` is total over the bar and never appends
    // a line below the level already on record, so a runbook holding two drifting lines is a person's.
    const runbook = `${recordWaitCrossing(
      text,
      waitCrossing({ date: "2026-11-05", number: 604, latest: 6, held: 4, since: "2026-10-28" }),
    ).text}${line({ date: "2026-11-05", number: 604, latest: 4, held: 1, since: "2026-10-15" })}\n`;
    const crossings = waitCrossings(runbook);
    expect(crossings).toHaveLength(2);

    // The trend step's red, which is where a night fails over this: the log's own sentences,
    // deliberately spelled out because they are the ones the page has to carry.
    const report = trendReport(runbook);
    expect(report.waitDrift.map((finding) => finding.reason)).toEqual(["unreached", "unheld"]);
    expect(report.gate).toBe("fail");
    const log = renderTrendReport(report);
    expect(log).toContain(
      "  #604 on 2026-11-05 — the records hold no night whose middle is 6 night(s), so the crossing it " +
        "states never happened",
    );
    expect(log).toContain(
      "  #604 on 2026-11-05 — the worst the records had held before that night is 2.5 night(s), not the " +
        "1 it says it passed",
    );

    // …and the page, where the record is discussed: the same finding as a block of its own, one entry
    // per line in the order the runbook holds them rather than the first one it trips over, and the two
    // directions side by side because a reader may only ever meet one of them.
    const section = renderFloorSettlementSection(records, { crossings }) ?? "";
    expect(section).toContain("#### A crossing line the records do not produce");
    expect(section).toContain(
      "- **#604 on 2026-11-05** — the records hold no night whose middle is 6 night(s), so the crossing " +
        "it states never happened.",
    );
    expect(section).toContain(
      "- **#604 on 2026-11-05** — the worst the records had held before that night is 2.5 night(s), not " +
        "the 1 it says it passed.",
    );
    // One sentence behind both, which is the check that says so rather than two literals written alike
    // twice: the note the log states is the note the page's entry states.
    const note = log
      .split("\n")
      .filter((row) => row.trimStart().startsWith("#604 on 2026-11-05 — the records hold"))
      .map((row) => row.trim().replace("#604 on 2026-11-05 — ", ""))[0];
    expect(note).toBeDefined();
    expect(section).toContain(`**#604 on 2026-11-05** — ${note}.`);
    // It leads the arithmetic for the same reason the warning does, and ahead of the warning itself:
    // the paragraphs below cite these very lines as the record of what has been said, so a line the
    // settlements cannot produce has to be met before it is quoted back as settled fact.
    expect(section.indexOf("#### A crossing line")).toBeLessThan(
      section.indexOf("#### The median wait is past the level it had held"),
    );
    expect(section.indexOf("#### A crossing line")).toBeLessThan(
      section.indexOf("#### Where the ages landed"),
    );
    expect(section.indexOf("#### A crossing line")).toBeLessThan(
      section.indexOf("Every one of them, oldest answer first:"),
    );
    // …and the block is a finding about a record, never a row of the table: the section still answers
    // the question it exists for, unchanged by the red above it.
    expect(section).toContain("| #601 | 2026-10-15 | 1 | merged, ");

    // Nothing is said when there is nothing to say. A record these settlements *do* produce adds no
    // block, and neither does a caller that handed over no record at all: `null` is not a record that
    // matches, it is the absence of one, and a block claiming the lines were checked would be a claim
    // about a check nobody ran.
    const matching = waitCrossing({
      date: "2026-11-05",
      number: 604,
      latest: 5,
      held: 4,
      since: "2026-10-28",
    });
    if (matching === null) throw new Error("the fixture no longer makes a crossing");
    expect(waitCrossingDrift(records, [matching])).toEqual([]);
    // The block's own contract, in the two shapes a caller can hand it and nothing: no findings is no
    // block — the omission, never a heading with an empty list under it.
    expect(renderWaitDrift([])).toBeNull();
    expect(renderWaitDrift(null)).toBeNull();
    expect(renderFloorSettlementSection(records, { crossings: [matching] }) ?? "").not.toContain(
      "#### A crossing line",
    );
    expect(renderFloorSettlementSection(records, { crossings: [] }) ?? "").not.toContain(
      "#### A crossing line",
    );
    expect(renderFloorSettlementSection(records) ?? "").not.toContain("#### A crossing line");
  });

  it("owes a comment only for a crossing above every level one has been about", () => {
    // The decider, and the whole of the difference between a standing finding and an event: the page and
    // the annotation go on stating a wait for as long as it stands, while a comment lands where a person
    // is and stays there — so it is left once per crossing, and the bar is the level the runbook's record
    // already states. *Strictly above*, because a crossing's own level grows as the series does: a median
    // that came back down and climbed to somewhere it was already told about is not news.
    const rising = [
      { date: "2026-10-14", number: "30", outcome: "merged", nights: 0 },
      { date: "2026-10-18", number: "31", outcome: "merged", nights: 1 },
      { date: "2026-10-26", number: "32", outcome: "merged", nights: 2 },
    ];
    const wait = settlementWaitWarning(rising);
    if (wait === null) throw new Error("the fixture no longer passes a level the history had held");

    // Nothing crossed, nothing owed — and a caller with no record at all owes it, because a wait that
    // rose before this record existed has been said by no comment.
    expect(unsaidWaitWarning(null, 0)).toBeNull();
    expect(unsaidWaitWarning(wait, null)).toBe(wait);
    // A level already announced is not news, and neither is one below it.
    expect(unsaidWaitWarning(wait, wait.held)).toBeNull();
    expect(unsaidWaitWarning(wait, wait.held + 1)).toBeNull();
    // …while a crossing past every level on record is exactly the event this exists for.
    expect(unsaidWaitWarning(wait, wait.held - 0.5)).toBe(wait);
  });

  it("says on the page whether the standing wait has already been said, and where", () => {
    // The one thing about a standing wait a reader cannot work out from the page alone: the state is
    // restated every night it stands and the comment is not. `null` — a caller that handed over no record
    // — gets neither sentence, because it cannot be known; an empty list is a runbook that records none,
    // which is a fact and is said as one; and a record that stands *below* the crossing leaves it owed,
    // because the paragraph is the decider's own answer rather than the presence of a record.
    const rising = [
      { date: "2026-10-14", number: "30", outcome: "merged", nights: 0 },
      { date: "2026-10-18", number: "31", outcome: "merged", nights: 1 },
      { date: "2026-10-26", number: "32", outcome: "merged", nights: 2 },
    ];
    const said = waitCrossing({
      date: "2026-10-27",
      number: 604,
      latest: 1,
      held: 0.5,
      since: "2026-10-18",
    });
    const earlier = waitCrossing({
      date: "2026-10-01",
      number: 1,
      latest: 0.5,
      held: 0,
      since: "2026-09-01",
    });
    if (said === null || earlier === null) throw new Error("the fixture no longer makes a crossing");

    const unknown = renderFloorSettlementSection(rising) ?? "";
    expect(unknown).not.toContain("No comment has been left about this crossing yet");
    expect(unknown).not.toContain("The night has already said it");
    const none =
      renderFloorSettlementSection(rising, { crossings: [] }) ?? "";
    expect(none).toContain(
      "No comment has been left about this crossing yet — the night leaves one on the floor proposal " +
        "that is open to answer it, and records the crossing it said in `.freebuff/run.md`, so it is " +
        "said once rather than every night this stands.",
    );
    const announced =
      renderFloorSettlementSection(rising, { crossings: [earlier, said] }) ?? "";
    expect(announced).toContain(
      "The night has already said it where a person will meet it: the comment it left on #604 on " +
        "2026-10-27 announced this crossing, and the record of that in the runbook is why there is no " +
        "second one",
    );
    expect(announced).not.toContain("No comment has been left");
    const owed =
      renderFloorSettlementSection(rising, { crossings: [earlier] }) ?? "";
    expect(owed).toContain("No comment has been left about this crossing yet");
  });
});

/**
 * The same record for the other kind of request the job's neighbourhood raises: the collect-budget
 * proposal, which is a comment the `collect-propose` job leaves on a pull request rather than a
 * request of the nightly job's own.
 *
 * Two properties are the kind's own, and both are cases below. The age counted is the age of the
 * **comment** — the day the job first proposed the tightening — so a proposal made a week into a
 * branch is not recorded as a week of being ignored; and the answer is the reply on that pull
 * request, so a close is recorded only where nothing answered the proposal, and a close arriving
 * *after* an answer never becomes the record's end. Everything else is deliberately the floor's: the
 * same three bands, the same dedupe on the runbook's own heads, the same distribution — with the kind's
 * own words around them, because a collect proposal is escalated by nothing and a sentence claiming
 * otherwise would be a lie about one of the two kinds.
 */
describe("the collect-budget proposals that have been answered", () => {
  /**
   * A settled proposal as the module reads one: the days, not the fields GitHub names them in, plus the
   * outcome the reply declared where it declared one (`applyOutcomeIn`'s answer — `null` is a reply that
   * declared nothing, which is every fixture that predates the vocabulary).
   */
  const request = (
    number: number,
    proposed: string,
    answered: string | null,
    closed: string | null = null,
    status: string | null = null,
  ) => ({ number, proposed, answered, closed, status });

  it("records the age a proposal sat, and which of the two thresholds that crossed", () => {
    const answered = collectProposalSettlement(
      request(147, "2026-10-25T02:20:00Z", "2026-10-29T11:00:00Z"),
    );
    expect(answered).toMatchObject({
      number: "147",
      opened: "2026-10-25",
      closed: "2026-10-29",
      nights: 4,
      outcome: "answered",
    });
    expect(answered?.line).toContain(
      "- **2026-10-29 — collect-budget proposal on #147: answered after 4 nights.**",
    );
    // The ask rode on the pull request it was measured against rather than being re-fired every night
    // like the floor's, so the line says what actually happened to it and cannot borrow the floor's
    // sentence about the job re-deriving the floors and re-asking.
    expect(answered?.line).toContain(
      "It was proposed 2026-10-25 and answered 2026-10-29, 4 nights later",
    );
    expect(answered?.line).toContain("re-measured by every run that request carried");
    expect(answered?.line).not.toContain("re-derived the floors");
    // The clock, in the kind's own words: the floor request's, named as the floor's, because a collect
    // proposal has no escalation to cross it with.
    expect(answered?.line).toContain(
      `past the ${STALE_NIGHTS} nights at which the job's own floor request starts being named on the run page`,
    );
    // …and an answer is no place for the sentence about nothing having been applied.
    expect(answered?.line).not.toContain("Nothing was applied");

    const unanswered = collectProposalSettlement(
      request(148, "2026-10-10T02:20:00Z", null, "2026-10-20T09:00:00Z"),
    );
    expect(unanswered?.outcome).toBe("closed unanswered");
    expect(unanswered?.nights).toBe(10);
    expect(unanswered?.line).toContain(
      "- **2026-10-20 — collect-budget proposal on #148: closed unanswered after 10 nights.**",
    );
    expect(unanswered?.line).toContain(
      "the pull request was closed 2026-10-20 with the ask unanswered",
    );
    expect(unanswered?.line).toContain(
      "Nothing was applied, and that is not a verdict on the baselines",
    );
    expect(unanswered?.line).toContain(
      `past the ${ESCALATED_NIGHTS} nights at which the job's own floor request starts naming a person`,
    );
    // The head stays the marker's own shape — `closed unanswered`, never a phrase — because the reader
    // and the dedupe both match on it.
    expect(collectProposalSettlements(unanswered?.line ?? "")).toEqual([
      { date: "2026-10-20", number: "148", outcome: "closed unanswered", nights: 10 },
    ]);

    // …and the three bands are the floor's own, at the same boundaries: one clock, both kinds.
    expect(settlementBand(0)).toBe("before either threshold");
    expect(settlementBand(STALE_NIGHTS)).toBe("after the run page");
    expect(settlementBand(ESCALATED_NIGHTS)).toBe("after the escalation");
  });

  it("counts to the answer rather than to the close, and refuses an end it cannot read", () => {
    // A pull request can be closed *after* it was answered — the follow-up landed, the branch went
    // away — and the age this record is about is the one that ended with the answer. Counting to the
    // close would make the proposal's own wait depend on the life of a second request.
    const later = collectProposalSettlement(
      request(150, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", "2026-11-30T09:00:00Z"),
    );
    expect(later?.closed).toBe("2026-10-07");
    expect(later?.nights).toBe(2);
    expect(later?.outcome).toBe("answered");

    // Zero and one night are said in their own words, as on the floor's side: a proposal applied the
    // day it was posted is the fast end of the distribution rather than an absence.
    const sameDay = collectProposalSettlement(
      request(151, "2026-10-20T02:20:00Z", "2026-10-20T09:00:00Z"),
    );
    expect(sameDay?.nights).toBe(0);
    expect(sameDay?.line).toContain(
      "the same day, so no night passed between the question and the answer",
    );
    const oneNight = collectProposalSettlement(
      request(152, "2026-10-20T02:20:00Z", null, "2026-10-21T09:00:00Z"),
    );
    expect(oneNight?.line).toContain("one night later");

    // An end nobody has reached yet is not a settlement, and an end that cannot be read is not a small
    // one: a proposal nothing has answered and nobody has closed, a proposal day that is not a date,
    // no number, an end reading *before* the proposal, and — the kind's own trap — a reply whose day
    // cannot be read, which must not quietly become a close.
    expect(collectProposalSettlement(request(153, "2026-10-20T02:20:00Z", null, null))).toBeNull();
    expect(
      collectProposalSettlement({
        number: 154,
        proposed: "the other night",
        answered: "2026-10-22T09:00:00Z",
      }),
    ).toBeNull();
    expect(
      collectProposalSettlement({ proposed: "2026-10-20T02:20:00Z", answered: "2026-10-22T09:00:00Z" }),
    ).toBeNull();
    expect(
      collectProposalSettlement(request(155, "2026-10-22T02:20:00Z", "2026-10-20T09:00:00Z")),
    ).toBeNull();
    expect(
      collectProposalSettlement(request(156, "2026-10-20T02:20:00Z", "not a day", "2026-10-22T09:00:00Z")),
    ).toBeNull();
  });

  it("records what the reply did, so a refused apply is not an answered proposal", () => {
    // The defect this word exists for: a reply that refused the tightening and one that adopted it were
    // the same record — `answered after 4 nights` — which says the gate moved when it did not. The
    // record states the word the reply declared instead, and the line says what that word means.
    const refused = collectProposalSettlement(
      request(147, "2026-10-25T02:20:00Z", "2026-10-29T11:00:00Z", null, "refused"),
    );
    expect(refused?.outcome).toBe("refused");
    expect(refused?.line).toContain(
      "- **2026-10-29 — collect-budget proposal on #147: refused after 4 nights.**",
    );
    expect(refused?.line).toContain("It was proposed 2026-10-25 and answered 2026-10-29, 4 nights later");
    expect(refused?.line).toContain(
      "The reply refused it — the payload would have raised a recorded budget",
    );
    expect(refused?.line).toContain("the gates are what they were");
    // The head is the dedupe *and* the reader: a word the head cannot match is a record the next night
    // writes again. So the word is read back exactly as it was written, which is the property every
    // outcome below is held to.
    expect(collectProposalSettlements(refused?.line ?? "")).toEqual([
      { date: "2026-10-29", number: "147", outcome: "refused", nights: 4 },
    ]);

    // An adopted tightening, and one that needed no writing: the two words that *are* the adoption, and
    // the only two the page counts as one. `applied` adds nothing to the record — its own sentence says
    // where the values went — while `unchanged` says what that reply found.
    const applied = collectProposalSettlement(
      request(147, "2026-10-25T02:20:00Z", "2026-10-29T11:00:00Z", null, "applied"),
    );
    expect(applied?.outcome).toBe("applied");
    expect(applied?.line).not.toContain("The reply refused it");
    expect(
      collectProposalSettlement(request(148, "2026-10-25T02:20:00Z", "2026-10-29T11:00:00Z", null, "unchanged"))
        ?.line,
    ).toContain("already sat at or below what the proposal asked for");

    // Every other way the reply left the gates alone says so in its own words — the four cases a person
    // reading the runbook has to be able to tell apart — and each one still reads back.
    const note = (status: string) =>
      collectProposalSettlement(
        request(150, "2026-10-20T02:20:00Z", "2026-10-22T09:00:00Z", null, status),
      )?.line ?? "";
    expect(note("drift")).toContain("nothing was committed, the baselines were put back");
    expect(note("unverified")).toContain("the drift check then disagreed with the tree");
    expect(note("no-payload")).toContain("there was nothing to apply");
    expect(note("fork")).toContain("no branch of this repository to open a follow-up against");
    expect(note("unknown")).toContain("could not report an outcome");
    for (const status of APPLY_STATUSES) {
      expect(collectProposalSettlements(note(status)), status).toEqual([
        { date: "2026-10-22", number: "150", outcome: status, nights: 2 },
      ]);
    }

    // A status outside the vocabulary is narrowed to `unknown` rather than written as itself: the record
    // has to be one the head can read back, or the same proposal is recorded every night it is seen. And
    // a reply that declared nothing at all is the plain answer it always was — not `unknown`, which would
    // turn every older record into a claim about an outcome nobody stated.
    expect(
      collectProposalSettlement(request(151, "2026-10-20T02:20:00Z", "2026-10-22T09:00:00Z", null, "rejected"))
        ?.outcome,
    ).toBe("unknown");
    expect(
      collectProposalSettlement(request(152, "2026-10-20T02:20:00Z", "2026-10-22T09:00:00Z"))?.outcome,
    ).toBe("answered");
    // …and the reply's word describes only a reply: a close with the ask unanswered is the other ending
    // whatever status was handed alongside it, because nothing declared anything.
    expect(
      collectProposalSettlement(
        request(153, "2026-10-20T02:20:00Z", null, "2026-10-22T09:00:00Z", "refused"),
      )?.outcome,
    ).toBe("closed unanswered");
  });

  it("reads the records back out of the runbook, and keeps them out of the readings", () => {
    const line = collectProposalSettlement(
      request(147, "2026-10-25T02:20:00Z", "2026-10-29T11:00:00Z"),
    )?.line;
    const runbook = [
      "# The runbook",
      "",
      "- **2026-09-30 — ci verdict: 10 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (10 selected); all stages passed.** typecheck PASS.",
      `  rendered-links coverage: chrome — the footer 14 (27 unique destinations).`,
      "",
      `${line}`,
      "",
    ].join("\n");

    expect(collectProposalSettlements(runbook)).toEqual([
      { date: "2026-10-29", number: "147", outcome: "answered", nights: 4 },
    ]);
    expect(collectProposalSettlements("# The runbook\n")).toEqual([]);
    // The two kinds are told apart by their own heads — a collect proposal on #147 and a floor
    // proposal #147 are different requests that can share a number — and a settlement of either is
    // not a measurement: the head is not a `ci verdict:`, so it can never move a floor.
    expect(floorProposalSettlements(runbook)).toEqual([]);
    expect(runbookRecords(["# The runbook", "", `${line}`, ""].join("\n"))).toEqual([]);
  });

  it("records each request once, oldest answer first, however GitHub lists them", () => {
    const text = "# The runbook\n";
    // The list is every pull request the job might have proposed on, in the order GitHub answered:
    // two proposals nothing has settled ride along, and the order they arrive in must not become the
    // runbook's order.
    const settled = [
      request(148, "2026-10-10T02:20:00Z", null, "2026-10-20T09:00:00Z"),
      request(203, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z"),
      request(201, "2026-10-25T02:20:00Z", null, null),
      request(204, "2026-10-01T02:20:00Z", null, null),
    ];

    const recorded = recordCollectProposals({ text, settled });
    expect(recorded.added.map((record) => record.number)).toEqual(["203", "148"]);
    expect(recorded.text.indexOf("#203")).toBeLessThan(recorded.text.indexOf("#148"));
    expect(recorded.records.map((record) => record.number)).toEqual(["203", "148"]);
    // The writer is the floor's own — one append, one blank line, one line per request — and the kind
    // is what keeps the two histories apart: the same file read as the floor's records finds none of
    // these, and re-recording the same list writes nothing, which is what lets both steps run nightly.
    expect(floorProposalSettlements(recorded.text)).toEqual([]);
    const again = recordProposalSettlements({ kind: "collect", text: recorded.text, settled });
    expect(again.added).toEqual([]);
    expect(again.text).toBe(recorded.text);
    // …and a list that is not one is not a crash: this runs over whatever GitHub answered with, and an
    // entry that is not a request is skipped rather than handed to a reader that would have to defend
    // itself against every caller. Both probes are cast the way this file's other out-of-contract
    // cases are, because `settled` is promised as a list of requests.
    const asSettled = (value: unknown) =>
      value as NonNullable<Parameters<typeof recordCollectProposals>[0]>["settled"];
    const asKind = (value: unknown) =>
      value as NonNullable<Parameters<typeof recordProposalSettlements>[0]>["kind"];
    expect(recordCollectProposals({ text, settled: asSettled(null) }).added).toEqual([]);
    expect(recordCollectProposals({ text, settled: asSettled([null, "the other night"]) }).added).toEqual(
      [],
    );
    // An unknown kind is the one thing the writer refuses loudly, because it is a programming mistake
    // rather than a night's input.
    expect(() => recordProposalSettlements({ kind: asKind("proposal"), text, settled })).toThrow(
      "unknown settlement kind",
    );
  });

  it("states the whole history on the page, in the kind's own words for the clock", () => {
    expect(renderCollectSettlementSection([])).toBeNull();

    const section =
      renderCollectSettlementSection([
        { date: "2026-10-29", number: "147", outcome: "answered", nights: 4 },
        { date: "2026-10-20", number: "148", outcome: "closed unanswered", nights: 10 },
      ]) ?? "";

    expect(section).toContain("### Collect-budget proposals answered");
    // The thresholds are named with their values, because the tables are the reading of them.
    expect(section).toContain(`\`STALE_NIGHTS\` (${STALE_NIGHTS})`);
    expect(section).toContain(`\`ESCALATED_NIGHTS\` (${ESCALATED_NIGHTS})`);
    expect(section.split("\n").filter((line) => line.startsWith("| #"))).toEqual([
      "| #148 | 2026-10-20 | 10 | closed without the reply, after the escalation | closed 2026-10-20 |",
      "| #147 | 2026-10-29 | 4 | answered, after the run page | — |",
    ]);
    // …and the column the state is in is a column of the table and not a note beside it: the header names
    // what the cells are about, and the paragraph under the table says where each date comes from and what
    // a dash does *not* mean.
    expect(section).toContain("| proposal | answered | nights | how it was answered | pull request |");
    expect(section).toContain("**1 of these requests is recorded as gone.**");
    expect(section).toContain(
      "A dash there is a request the runbook does not record as closed, which is not the same as one still",
    );
    // The bands and the counts are the floor's — one clock, one set of numbers — while the words
    // around them are this kind's: the page says outright that a collect proposal has no escalation
    // of its own rather than borrowing the floor's mention.
    expect(section).toContain(`| ${settlementBand(0)} | 0 | 0% |`);
    expect(section).toContain(`| ${settlementBand(STALE_NIGHTS)} | 1 | 50% |`);
    expect(section).toContain(`| ${settlementBand(ESCALATED_NIGHTS)} | 1 | 50% |`);
    expect(section).toContain("the clock's loud end");
    expect(section).toContain("No comment of this job's names anybody for a collect proposal");
    expect(section).not.toContain("the mention already out");
    // …and the floor's section is untouched by the sharing: its own words still say what its own
    // loudness is, and the two sections cannot drift into one voice.
    const floor =
      renderFloorSettlementSection([
        { date: "2026-10-29", number: "23", outcome: "merged", nights: 9 },
      ]) ?? "";
    expect(floor).toContain("the mention already out");
    expect(floor).toContain("| the day the mention first went out");
    expect(floor).not.toContain("the clock's loud end");
  });

  it("holds the median trend against the kind's own idea of what each threshold night is", () => {
    // The trend is the floor's — one history, one median, the same two numbers — and the words it
    // reads them with are this kind's, because crossing the first threshold is not the same fact for a
    // proposal nothing re-fires as it is for the request the job does shout about. The middle falls
    // here (12 → 6.5) while the newest of it sits between the two thresholds.
    const section =
      renderCollectSettlementSection([
        { date: "2026-10-20", number: "148", outcome: "closed unanswered", nights: ESCALATED_NIGHTS + 5 },
        { date: "2026-10-29", number: "147", outcome: "applied", nights: 1 },
      ]) ?? "";

    expect(section).toContain(
      "The median has fallen 12 → 6.5 nights across the 2 nights an answer arrived on (it peaked at 12 on 2026-10-20).",
    );
    expect(section).toContain(
      `The newest median, 6.5 nights, is past the first threshold (the night the job's own floor request starts being named on the run page, \`STALE_NIGHTS\` = ${STALE_NIGHTS}) and 0.5 nights short of the second (the night that request's comment starts naming a person, \`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS}).`,
    );
    // …and the floor's section says the same numbers in the floor's words, so a mechanism only one of
    // the two kinds has cannot be borrowed by the other.
    const floor =
      renderFloorSettlementSection([
        { date: "2026-10-20", number: "23", outcome: "merged", nights: ESCALATED_NIGHTS + 5 },
        { date: "2026-10-29", number: "24", outcome: "merged", nights: 1 },
      ]) ?? "";
    expect(floor).toContain(
      `0.5 nights short of the second (the night the night's comment starts naming a person`,
    );
    expect(floor).not.toContain("the job's own floor request starts being named on the run page");
    expect(section).not.toContain("the night the night's comment starts naming a person");
  });

  it("warns on this kind's own wait, in this kind's own words for the threshold night", () => {
    // The warning is the floor's — one history per kind, one median, the same two numbers — and what it
    // reads them with is this kind's: crossing the first threshold is not the same fact for a proposal
    // nothing re-fires as it is for the request the job does shout about. Here the rise arrives *after*
    // two ages have already reached it, so the sentence says that instead of claiming the earlier night
    // the whole reading is for.
    const records = [
      { date: "2026-10-14", number: "148", outcome: "applied", nights: 1 },
      { date: "2026-10-18", number: "149", outcome: "refused", nights: 4 },
      { date: "2026-10-26", number: "150", outcome: "applied", nights: 5 },
    ];
    expect(settlementWaitWarning(records)).toEqual({
      held: 2.5,
      heldSince: "2026-10-18",
      latest: 4,
      latestDate: "2026-10-26",
      answers: 3,
      nights: 3,
      total: 3,
      reached: { first: 2, second: 0 },
    });

    const section = renderCollectSettlementSection(records) ?? "";
    expect(section).toContain(
      "The middle of these ages is now 4 nights, higher than the 2.5 nights the history had held since " +
        `2026-10-18 — 2 of the 3 ages in the records have already reached the ${STALE_NIGHTS} nights at ` +
        "which the job's own floor request starts being named on the run page.",
    );
    // …while the floor reads the same numbers as its own mechanism, so neither section can borrow the
    // other's answer to what that night is.
    const floor =
      renderFloorSettlementSection([
        { date: "2026-10-14", number: "23", outcome: "merged", nights: 1 },
        { date: "2026-10-18", number: "24", outcome: "merged", nights: 4 },
        { date: "2026-10-26", number: "25", outcome: "merged", nights: 5 },
      ]) ?? "";
    expect(floor).toContain(
      `— 2 of the 3 ages in the records have already reached the ${STALE_NIGHTS} nights at which the run ` +
        "page starts naming one.",
    );
    expect(section).not.toContain("the run page starts naming one.");
  });

  it("counts the replies that did not adopt the tightening apart from the ones that did", () => {
    // The last column is the reply's own word, so a refusal reads as a refusal; and the paragraph under
    // the receipts is the count that turns that distinction into a reading rather than a cell somebody has
    // to scan for. Only the two words that *are* an adoption are left out of it — and `answered`, whose
    // reply declared nothing, is deliberately not counted as a refusal either: nothing about that record
    // says whether the tightening landed.
    const section =
      renderCollectSettlementSection([
        { date: "2026-10-29", number: "147", outcome: "applied", nights: 4 },
        { date: "2026-10-28", number: "149", outcome: "unchanged", nights: 3 },
        { date: "2026-10-27", number: "150", outcome: "refused", nights: 9 },
        { date: "2026-10-20", number: "148", outcome: "closed unanswered", nights: 10 },
      ]) ?? "";
    expect(section.split("\n").filter((line) => line.startsWith("| #"))).toEqual([
      "| #148 | 2026-10-20 | 10 | closed without the reply, after the escalation | closed 2026-10-20 |",
      "| #150 | 2026-10-27 | 9 | refused — the payload would have raised a budget, after the escalation | — |",
      "| #149 | 2026-10-28 | 3 | already at or below it, after the run page | — |",
      "| #147 | 2026-10-29 | 4 | applied, after the run page | — |",
    ]);
    expect(section).toContain("1 of these replies did not adopt the tightening — `refused` (1) —");
    expect(section).toContain("reads as a refusal rather than as an answered one");
    // The vocabulary the intro names is the applier's own list, so a word added there is named here
    // rather than leaving the page describing a set of outcomes it does not accept.
    expect(section).toContain(`\`${APPLY_STATUSES.join("`, `")}\``);
    // A reply nobody could interpret counts as one of them too — nothing landed — and is named by its own
    // row rather than by a phrase nothing produces.
    const unreported =
      renderCollectSettlementSection([
        { date: "2026-10-29", number: "151", outcome: "unknown", nights: 3 },
      ]) ?? "";
    expect(unreported).toContain(
      "| #151 | 2026-10-29 | 3 | nothing reported — the approval could not be applied, after the run page |",
    );
    expect(unreported).toContain("1 of these replies did not adopt the tightening — `unknown` (1) —");
    // …while a history of adoptions, and one of plain answers, carries no such paragraph at all: the
    // sentence exists to state a distinction, and there is none to state.
    const adoptions =
      renderCollectSettlementSection([
        { date: "2026-10-29", number: "147", outcome: "applied", nights: 4 },
        { date: "2026-10-25", number: "152", outcome: "answered", nights: 2 },
      ]) ?? "";
    expect(adoptions).toContain("| #152 | 2026-10-25 | 2 | answered, before either threshold |");
    expect(adoptions).not.toContain("did not adopt the tightening");
  });
});

/**
 * The record as the nightly job writes it: a real spawn, because what the step depends on is the
 * command's exit code, the runbook it leaves behind and the page it appends to.
 */
describe("the coverage:trend --settle-floor command", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchDir("coverage-settle-");
  });
  afterAll(() => {
    removeScratchDir(scratch);
  });

  const run = (
    args: string[],
    env: Record<string, string> = {},
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [trendModule, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  /** A scratch file this suite owns, written whole. */
  const file = (name: string, text: string): string => {
    const at = path.join(scratch, name);
    writeFileSync(at, text, "utf8");
    return at;
  };

  it("records what was answered, once, and states the history on the page", () => {
    const runbook = file(
      "settle-runbook.md",
      [
        "# The runbook",
        "",
        "- **2026-10-02 — ci verdict: 10 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (10 selected); all stages passed.** typecheck PASS.",
        "",
      ].join("\n"),
    );
    const settled = file(
      "settled.json",
      JSON.stringify([
        ghSettled(12, "2026-10-08T02:20:00Z", null),
        ghSettled(13, "2026-10-04T02:20:00Z", "2026-10-13T11:00:00Z"),
        ghSettled(14, "2026-10-20T02:20:00Z", "2026-10-22T09:00:00Z", null),
      ]),
    );
    const summary = path.join(scratch, "settle-summary.md");
    const out = path.join(scratch, "settle-output");
    // The file the artifact below uploads — the half of the record that outlives the run, since a
    // step summary is read once, by whoever is looking at that run.
    const artifact = path.join(scratch, "settle-artifact.md");

    const result = run(
      ["--settle-floor", "--settled", settled, "--runbook", runbook, "--output", artifact],
      {
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: out,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    // The log line is where the run page's reader learns what the night recorded, and the running
    // list is the review itself: every age that has been recorded so far.
    expect(result.stdout).toContain("recorded 2 settlement(s)");
    expect(result.stdout).toContain("#13 merged after 9 night(s)");
    expect(result.stdout).toContain("2 settled so far: 9, 2 night(s)");
    expect(readFileSync(out, "utf8")).toContain("recorded=2");

    const text = readFileSync(runbook, "utf8");
    expect(text).toContain("- **2026-10-13 — floor proposal #13: merged after 9 nights.**");
    expect(text).toContain("- **2026-10-22 — floor proposal #14: closed after 2 nights.**");
    // The open request is not an answer, so it is not a record.
    expect(text).not.toContain("#12");
    // …and the record it wrote is the reading the floors are *not* derived from: the command that
    // holds the low-water mark against the records reads the same file and finds no new night in it.
    expect(runbookRecords(text).map((record) => record.date)).toEqual(["2026-10-02"]);

    const page = readFileSync(summary, "utf8");
    expect(page).toContain("### Floor proposals answered");
    expect(page).toContain("| #14 | 2026-10-22 | 2 | closed unmerged, before either threshold |");
    expect(page).toContain("| #13 | 2026-10-13 | 9 | merged, after the escalation |");
    expect(page).toContain("#### Where the ages landed");

    // …and the file the artifact carries is that page, rendered for the runbook this run just wrote
    // rather than a second summary of it: one renderer behind the two surfaces, so what a reviewer
    // reads on the page and what a later reader unpacks from the upload cannot drift apart.
    expect(result.stdout).toContain(`the summary to ${artifact}`);
    const written = readFileSync(artifact, "utf8");
    expect(written).toBe(`${renderFloorSettlementSection(floorProposalSettlements(text))}\n`);
    expect(written).toContain("#### How often the escalation mattered");

    // The next night records nothing: the file is the dedupe, so the same list read twice writes
    // once — the property that lets the step run every night.
    const again = run(
      ["--settle-floor", "--settled", settled, "--runbook", runbook, "--output", artifact],
      {
        GITHUB_STEP_SUMMARY: summary,
      },
    );
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("recorded 0 settlement(s)");
    expect(readFileSync(runbook, "utf8")).toBe(text);
    // The second night rewrites the file rather than appending to it: the history is the runbook's,
    // and the artifact is a rendering of it — an appended one would double every age a night later.
    expect(readFileSync(artifact, "utf8")).toBe(written);
  });

  it("records its own request's reopening, in this kind's words", () => {
    // The correction is on *both* kinds, and this is why: a floor proposal is a pull request this job raised
    // itself, and somebody can reopen it exactly as they can one somebody else's — the record's word about
    // that request is contradicted the same way, and only the noun the line names it by differs. The close it
    // quotes is the settlement's own day here rather than a close record, because for this kind the settlement
    // *is* the request's life: a merged proposal's entry comes back open in tonight's list, and the day the
    // merge happened is what the merge line states.
    const runbook = file("floor-reopen-runbook.md", "# The runbook\n");
    const merged = file(
      "floor-reopen-merged.json",
      JSON.stringify([ghSettled(300, "2026-10-02T02:20:00Z", "2026-10-16T06:00:00Z")]),
    );
    // …and the same request open again tonight: neither a close nor a merge, which is how this kind's own
    // list states a request somebody has reopened.
    const reopened = file(
      "floor-reopen-open.json",
      JSON.stringify([ghSettled(300, "2026-10-02T02:20:00Z", null)]),
    );
    const artifact = path.join(scratch, "floor-reopen-page.md");
    const out = path.join(scratch, "floor-reopen-output");

    const first = run(["--settle-floor", "--settled", merged, "--runbook", runbook, "--output", artifact]);

    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(runbook, "utf8")).toContain(
      "- **2026-10-16 — floor proposal #300: merged after 14 nights.**",
    );
    expect(first.stdout).not.toContain("reopened");

    const back = run(
      [
        "--settle-floor",
        "--settled",
        reopened,
        "--runbook",
        runbook,
        "--output",
        artifact,
        "--today",
        "2026-10-20",
      ],
      { GITHUB_OUTPUT: out },
    );

    expect(back.status, back.stderr).toBe(0);
    const text = readFileSync(runbook, "utf8");
    expect(text).toContain("- **2026-10-20 — floor proposal #300 reopened, after the close recorded for 2026-10-16.**");
    // …the settlement stays as the history of the request's own life, and the request's thread is what the
    // correction moves.
    expect(text).toContain("- **2026-10-16 — floor proposal #300: merged after 14 nights.**");
    expect(floorProposalSettlements(text).map((record) => record.number)).toEqual(["300"]);
    expect(pullThreads(text)).toEqual([
      { state: "reopened", date: "2026-10-20", number: "300", closed: "2026-10-16" },
    ]);
    expect(back.stdout).toContain(
      "1 pull request(s) reopened after the record said they were gone: #300, closed on 2026-10-16",
    );
    // …and the request is *open* again as far as this step is concerned, which is the other half of the same
    // fact and the one no record could have supplied: the request a risen wait can be said on comes off
    // tonight's list, so a proposal that came back is a request this job can reach somebody on again.
    expect(readFileSync(out, "utf8")).toContain("open-request=300\n");
    // …while the page is the page it was: this kind's section is about asks' ages and states nothing about
    // the pull requests they were raised as, so the line below the table is the one surface that says it.
    expect(readFileSync(artifact, "utf8")).toBe(
      `${renderFloorSettlementSection(floorProposalSettlements(text))}\n`,
    );

    // The night after writes nothing: the same reader the line was earned from is the dedupe, so a second
    // night over the same list finds the file already saying the request is back.
    const again = run([
      "--settle-floor",
      "--settled",
      reopened,
      "--runbook",
      runbook,
      "--output",
      artifact,
      "--today",
      "2026-10-21",
    ]);

    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).not.toContain("reopened");
    expect(readFileSync(runbook, "utf8")).toBe(text);
  });

  it("announces a wait that has passed what it held, and annotates the run for it when asked", () => {
    // The finding is the module's and so is the sentence: the step's log gets it on stderr, and — under
    // `--github-annotations`, the repository's own name for the flag — GitHub gets it as a workflow
    // command on stdout, which is what a person watching the job sees without opening its page. Neither
    // changes the exit code: nothing about a rising wait is a verdict, and the two thresholds stay the
    // only numbers that escalate anything.
    const runbook = file("wait-runbook.md", "# The runbook\n");
    const settled = file(
      "wait-settled.json",
      JSON.stringify([
        ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
      ]),
    );
    const artifact = path.join(scratch, "wait-artifact.md");

    const plain = run([
      "--settle-floor",
      "--settled",
      settled,
      "--runbook",
      runbook,
      "--output",
      artifact,
    ]);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stderr).toContain(
      "coverage-trend: warning — the median wait for floor proposals is 4 nights, past the 2.5 nights " +
        "it had held since 2026-10-20",
    );
    // An annotation is asked for rather than always printed, or a person running this by hand would meet
    // workflow commands in their terminal — the same rule `.freebuff/ci.mjs`'s flag follows.
    expect(plain.stdout).not.toContain("::warning");

    const annotated = run([
      "--settle-floor",
      "--github-annotations",
      "--settled",
      settled,
      "--runbook",
      runbook,
      "--output",
      artifact,
    ]);
    expect(annotated.status, annotated.stderr).toBe(0);
    expect(annotated.stdout).toContain(
      "::warning file=.freebuff/run.md,title=settled wait (floor proposals)::the median wait for floor " +
        "proposals is 4 nights, past the 2.5 nights it had held since 2026-10-20",
    );
    expect(annotated.stdout).toContain(
      `2 of the 3 ages in the records have already reached the ${STALE_NIGHTS} nights at which the run ` +
        "page starts naming one",
    );

    // …and the page the night writes leads with the same finding, so a run whose annotation is gone still
    // carries it — while the night's own log line is unchanged and nothing was re-recorded.
    const page = readFileSync(artifact, "utf8");
    expect(page).toContain("#### The median wait is past the level it had held");
    expect(page.indexOf("#### The median wait is past")).toBeLessThan(
      page.indexOf("#### Where the ages landed"),
    );
    expect(annotated.stdout).toContain("recorded 0 settlement(s)");
  });

  it("leaves the risen wait as a comment on the request that is still open, and names it for the poster", () => {
    // The channel that reaches a person rather than a page: the run page is read by whoever opens the run
    // and the annotation by whoever is watching the job, while the request that is still open is where a
    // reviewer is already looking. Which request that is comes out of the same list the settlements were
    // read from — the entry that states no close is the one still open — and it is *published* rather than
    // left to the step below, which cannot see that list and has to be `skipped` on the nights nothing is
    // owed.
    const runbook = file("wait-comment-runbook.md", "# The runbook\n");
    const settled = file(
      "wait-comment-settled.json",
      JSON.stringify([
        ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
        // The request the night is about: still open, so it is not a settlement and not a record — and
        // the only entry here a comment could be left on.
        ghSettled(604, "2026-10-30T02:20:00Z", null),
      ]),
    );
    const comment = path.join(scratch, "wait-comment.md");
    const out = path.join(scratch, "wait-comment-output");

    const result = run(
      [
        "--settle-floor",
        "--settled",
        settled,
        "--runbook",
        runbook,
        "--output",
        path.join(scratch, "wait-comment-page.md"),
        "--comment",
        comment,
        // The clock the request's own age is read against, as the nudge takes it: a run writing about a
        // night other than the one it is running on has to be able to say which night that is.
        "--today",
        "2026-11-03",
      ],
      { GITHUB_OUTPUT: out },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("the risen wait is said on #604, the request still open");
    // The file is the renderer's own text for the history the runbook now holds rather than a second
    // reading of the same numbers in shell: one implementation behind the page and the comment.
    const text = readFileSync(runbook, "utf8");
    const wait = settlementWaitWarning(floorProposalSettlements(text));
    if (wait === null) throw new Error("the fixture no longer passes a level the history had held");
    const written = readFileSync(comment, "utf8");
    expect(written).toBe(
      renderFloorWaitComment({
        wait,
        number: "604",
        created: "2026-10-30",
        nights: nightsBetween("2026-10-30T02:20:00Z", "2026-11-03"),
      }),
    );
    expect(written).toContain("**This request is the one that answers that reading**");
    expect(written).toContain("<sub>#604 · 4 nights open, since 2026-10-30 ·");
    // …and no person is named: that is the night's *other* comment's business, and a mention meaning two
    // findings would mean neither.
    expect(written).not.toMatch(/@[A-Za-z0-9-]+/);
    // The poster step's whole input: the request, which is empty on every night nothing is owed.
    expect(readFileSync(out, "utf8")).toContain("wait-request=604");
    // …and the record landed either way, which is the layering this step keeps: the runbook is the record
    // and the comment is one of the three ways the night says it.
    expect(text).toContain("floor proposal #603: merged after 6 nights");
  });

  it("writes no comment when the wait held, and says so when it rose with nothing open to say it on", () => {
    // Two nights that owe nothing, and they are not the same fact. A wait that held is the ordinary night;
    // a wait that rose with no request open is the finding having run out of channels — the night a
    // proposal is answered is usually the night its branch stopped being open — and that one is said out
    // loud, because a step asked for a file it did not write should say which of the two it was.
    const runbook = file("nothing-runbook.md", "# The runbook\n");
    const closed = file(
      "nothing-settled.json",
      JSON.stringify([
        ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
      ]),
    );
    const comment = path.join(scratch, "nothing-comment.md");
    const out = path.join(scratch, "nothing-output");

    const risen = run(
      ["--settle-floor", "--settled", closed, "--runbook", runbook, "--comment", comment],
      { GITHUB_OUTPUT: out },
    );
    expect(risen.status, risen.stderr).toBe(0);
    expect(risen.stderr).toContain("coverage-trend: warning —");
    expect(risen.stderr).toContain(
      "the settled wait rose but there is no open request of this kind's own to say it on",
    );
    expect(existsSync(comment)).toBe(false);
    // …and the output is empty rather than absent, which is what keeps a night with nowhere to comment
    // from reading like a comment that was lost.
    expect(readFileSync(out, "utf8")).toContain("wait-request=\n");
    // …and the *request* is empty too, for a different reason: there is none open in this list. It is the
    // output the verdict step's own comment reads — the repair a refuted crossing line asks for is an edit
    // to a person's file, so a night with a refutation needs a request even when no wait is owed — and the
    // two are apart on purpose rather than one output meaning two things.
    expect(readFileSync(out, "utf8")).toContain("open-request=\n");

    // The held wait: a middle that never passed what the history had held, with a request still open — so
    // there is no finding to carry, and the open request changes nothing.
    const held = file(
      "held-settled.json",
      JSON.stringify([
        ghSettled(605, "2026-10-14T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(606, "2026-10-22T02:20:00Z", "2026-10-25T06:00:00Z"),
        ghSettled(607, "2026-10-28T02:20:00Z", null),
      ]),
    );
    const heldRunbook = file("held-runbook.md", "# The runbook\n");
    const heldOut = path.join(scratch, "held-output");
    const quiet = run(
      ["--settle-floor", "--settled", held, "--runbook", heldRunbook, "--comment", comment],
      { GITHUB_OUTPUT: heldOut },
    );
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(quiet.stdout).toContain(`no risen wait to say — nothing written to ${comment}`);
    expect(quiet.stderr).not.toContain("warning —");
    expect(existsSync(comment)).toBe(false);
    expect(readFileSync(heldOut, "utf8")).toContain("wait-request=\n");
    // …while the request itself *is* published, which is the whole reason the two outputs are apart: a
    // night that owes no comment about the wait can still have a verdict to say to a person.
    expect(readFileSync(heldOut, "utf8")).toContain("open-request=607");
  });

  it("says a risen wait once per crossing, and records the level it passed", () => {
    // The finding is an *event* now, not a state: the page and the annotation go on stating a wait for as
    // long as it stands, while the comment — the one channel that reaches a person — is left once per
    // crossing. What is recorded is the **level** the median passed, with the night that level had stood
    // since, because that is what makes a later rise news: a median that has climbed but has not passed
    // somewhere a comment has already been about is not a second comment.
    const runbook = file("crossing-runbook.md", "# The runbook\n");
    const page = path.join(scratch, "crossing-page.md");
    const comment = path.join(scratch, "crossing-comment.md");
    const out = path.join(scratch, "crossing-output");
    // The same history the comment case uses: three answers whose middle is 4 nights, past the 2.5 the
    // earlier nights had held — plus the one request that is still open to say it on.
    const risen = file(
      "crossing-risen.json",
      JSON.stringify([
        ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
        ghSettled(604, "2026-10-30T02:20:00Z", null),
      ]),
    );
    const args = ["--settle-floor", "--settled", risen, "--runbook", runbook, "--today", "2026-11-03"];

    const first = run([...args, "--comment", comment, "--output", page], { GITHUB_OUTPUT: out });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("the risen wait is said on #604, the request still open");
    expect(first.stdout).toContain(`the crossing recorded in ${runbook}`);
    // The record is the level the median passed, the night that level had stood since, and the night this
    // one said so — the fields the next night is held to, readable back as they were written.
    const recorded = readFileSync(runbook, "utf8");
    expect(waitCrossings(recorded)).toEqual([
      { kind: "floor", date: "2026-11-03", number: "604", latest: 4, held: 2.5, since: "2026-10-20" },
    ]);
    // …and the page this run wrote *before* the comment was recorded still names the crossing as owed,
    // because it was: a rendering of the night as it stood, not a guess about what the step would do next.
    expect(readFileSync(page, "utf8")).toContain("No comment has been left about this crossing yet");
    expect(readFileSync(out, "utf8")).toContain("wait-request=604");
    expect(readFileSync(out, "utf8")).toContain("open-request=604");

    // The same night again — a retried step, or a person running the command twice — records nothing and
    // writes no second comment. The output is empty, which is what skips the poster, and the state is
    // still announced: a wait that stands is restated every night, only the comment is the event.
    const againPath = path.join(scratch, "crossing-again.md");
    const againOut = path.join(scratch, "crossing-output-again");
    const again = run([...args, "--comment", againPath, "--output", page], { GITHUB_OUTPUT: againOut });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("this crossing has already been said");
    expect(again.stdout).toContain("the comment left on #604 on 2026-11-03 announced it");
    expect(existsSync(againPath)).toBe(false);
    expect(readFileSync(runbook, "utf8")).toBe(recorded);
    expect(readFileSync(againOut, "utf8")).toContain("wait-request=\n");
    // …and the open request is still published, which is what lets the verdict step's own comment reach a
    // person on a night the wait itself owes nothing.
    expect(readFileSync(againOut, "utf8")).toContain("open-request=604");
    expect(again.stderr).toContain("coverage-trend: warning —");
    expect(readFileSync(page, "utf8")).toContain(
      "the comment it left on #604 on 2026-11-03 announced this crossing",
    );

    // A later answer that takes the middle of the ages past the level *that* comment was about is a new
    // crossing rather than a repetition — which is the whole reason the level is recorded instead of the
    // night — and it lands beside the first, so the record reads as the history of what has been said.
    const beyond = file(
      "crossing-beyond.json",
      JSON.stringify([
        ...(JSON.parse(readFileSync(risen, "utf8")) as unknown[]),
        ghSettled(605, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z"),
      ]),
    );
    const third = run(
      [
        "--settle-floor",
        "--settled",
        beyond,
        "--runbook",
        runbook,
        "--today",
        "2026-11-05",
        "--comment",
        path.join(scratch, "crossing-third.md"),
      ],
      { GITHUB_OUTPUT: path.join(scratch, "crossing-output-third") },
    );
    expect(third.status, third.stderr).toBe(0);
    expect(third.stdout).toContain("the risen wait is said on #604");
    expect(waitCrossings(readFileSync(runbook, "utf8")).map((crossing) => crossing.held)).toEqual([
      2.5, 4,
    ]);
  });

  it("refuses a runbook it cannot write the crossing into, with the comment already rendered", () => {
    // The record *is* the runbook, so a night that could not write it says so rather than leaving the
    // crossing to be said again on every night it stands — the same boundary the settlement write has,
    // reached at the other end of the step: the body the poster reads is already on disk, and the step
    // reddens so the failure is visible instead of being read as a night that owed nothing. The list is
    // one the previous night has already recorded, so nothing else in this step writes.
    const runbook = file("readonly-runbook.md", "# The runbook\n");
    const beyond = file(
      "readonly-settled.json",
      JSON.stringify([
        ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
        ghSettled(605, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z"),
        ghSettled(604, "2026-10-30T02:20:00Z", null),
      ]),
    );
    // The night before, as the workflow runs it: no `--comment`, so nothing was owed a comment and no
    // crossing was recorded — the settlements alone.
    const prior = run(["--settle-floor", "--settled", beyond, "--runbook", runbook]);
    expect(prior.status, prior.stderr).toBe(0);
    expect(prior.stdout).toContain("recorded 4 settlement(s)");
    expect(waitCrossings(readFileSync(runbook, "utf8"))).toEqual([]);

    const settledText = readFileSync(runbook, "utf8");
    chmodSync(runbook, 0o444);
    const comment = path.join(scratch, "readonly-comment.md");
    const blocked = run(
      ["--settle-floor", "--settled", beyond, "--runbook", runbook, "--comment", comment],
      { GITHUB_OUTPUT: path.join(scratch, "readonly-output") },
    );
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("cannot write");
    expect(blocked.stderr).toContain("the crossing is not recorded");
    // The body it rendered is still there — the poster's input is not what failed — while the record it
    // could not write is not, so the runbook reads exactly as the night before left it.
    expect(existsSync(comment)).toBe(true);
    chmodSync(runbook, 0o644);
    expect(readFileSync(runbook, "utf8")).toBe(settledText);
  });

  it("fails the night's own read on a crossing line the records do not produce", () => {
    // The record is the bar the night's decision is written in, so it is held against the settlements
    // it claims to describe by the command that can fail a night — `npm run coverage:trend`, which the
    // nightly job runs as its own step after the settle steps have written. The fixture isolates the
    // record: a runbook of settlements and crossings alone, with the history table and the committed
    // floors pointed at paths that are not there, so the answer is the record and nothing else.
    const runbook = file("drift-runbook.md", "# The runbook\n");
    const settled = file(
      "drift-settled.json",
      JSON.stringify([
        ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
        ghSettled(605, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z"),
        // …and the request the night's comment is left on, still open.
        ghSettled(604, "2026-10-30T02:20:00Z", null),
      ]),
    );
    // The night that said the crossing: the middle of the ages is 5 nights against the 4 the earlier
    // nights had held, so a comment is owed and the line it leaves behind is one the records produce.
    const said = run([
      "--settle-floor",
      "--settled",
      settled,
      "--runbook",
      runbook,
      "--today",
      "2026-11-05",
      "--comment",
      path.join(scratch, "drift-comment.md"),
    ]);
    expect(said.status, said.stderr).toBe(0);
    const text = readFileSync(runbook, "utf8");
    expect(waitCrossings(text)).toEqual([
      { kind: "floor", date: "2026-11-05", number: "604", latest: 5, held: 4, since: "2026-10-28" },
    ]);

    /** The night's own read of that record: the runbook alone, and no committed floors to compare. */
    const alone = [
      "--runbook",
      runbook,
      "--history",
      path.join(scratch, "no-table.md"),
      "--low-water",
      path.join(scratch, "no-floors.json"),
    ];
    const clean = run(alone);
    expect(clean.status, clean.stderr).toBe(0);
    // …and the answer says the check ran, because a reader who cannot see it cannot tell a line that was
    // checked from one nothing looked at.
    expect(clean.stdout).toContain("1 settled-wait line(s) checked against the records");
    expect(clean.stdout).not.toContain("do not produce");
    expect(JSON.parse(run([...alone, "--json"]).stdout).waitDrift).toEqual([]);

    // Then a record somebody edited by hand: every way the records can refute a line, in one runbook, so
    // the report names each of them rather than the first it trips over.
    const edited = (options: Parameters<typeof waitCrossing>[0]) => {
      const made = waitCrossing(options);
      if (made === null) throw new Error("the fixture no longer makes a crossing");
      return `${made.line}\n`;
    };
    writeFileSync(
      runbook,
      text +
        edited({ date: "2026-11-05", number: 604, latest: 6, held: 4, since: "2026-10-28" }) +
        edited({ date: "2026-11-05", number: 604, latest: 4, held: 1, since: "2026-10-15" }) +
        edited({ date: "2026-11-05", number: 604, latest: 4, held: 2.5, since: "2026-10-19" }) +
        edited({ date: "2026-10-01", number: 604, latest: 4, held: 2.5, since: "2026-10-20" }) +
        edited({ date: "2026-11-05", number: 604, latest: 2.5, held: 2.5, since: "2026-10-20" }),
      "utf8",
    );

    // The machine's answer first: the red is the record's, and it is not a reading's — `regressed` is
    // empty because nothing moved, which is what keeps the two reds apart in the payload a job reads.
    const drifted = run([...alone, "--json"]);
    expect(drifted.status).toBe(1);
    const payload = JSON.parse(drifted.stdout);
    expect(payload.gate).toBe("fail");
    expect(payload.regressed).toEqual([]);
    expect(payload.waitDrift.map((finding: { reason: string }) => finding.reason)).toEqual([
      "unreached",
      "unheld",
      "unsince",
      "premature",
      "unpassed",
    ]);
    expect(payload.sources.waits).toBe(6);

    // …and the report, which is what the run page and `.ci/trend.txt` carry: one line per refuted
    // crossing with the first leg that fails, so the night can be repaired from the red itself.
    const page = run(alone);
    expect(page.status).toBe(1);
    expect(page.stdout).toContain(
      "5 settled-wait line(s) the settlement records do not produce, which is this run's red:",
    );
    expect(page.stdout).toContain(
      "  #604 on 2026-11-05 — the records hold no night whose middle is 6 night(s), so the crossing it " +
        "states never happened",
    );
    expect(page.stdout).toContain(
      "  #604 on 2026-11-05 — the worst the records had held before that night is 2.5 night(s), not the " +
        "1 it says it passed",
    );
    expect(page.stdout).toContain(
      "  #604 on 2026-11-05 — the records first held 2.5 night(s) on 2026-10-20, not on the 2026-10-19 " +
        "it states",
    );
    expect(page.stdout).toContain(
      "  #604 on 2026-10-01 — it is dated 2026-10-01, before the night the middle of the ages moved " +
        "(2026-10-28)",
    );
    expect(page.stdout).toContain(
      "  #604 on 2026-11-05 — it states a median of 2.5 night(s) against the 2.5 it says it passed, and a " +
        "crossing is a median strictly above the level behind it",
    );
    // …and the floor's paragraph is not this red's repair: no reading regressed, so telling a reader to
    // re-record a floor would send them to the wrong file.
    expect(page.stdout).not.toContain("The floor is the reading's committed low-water");
  });

  it("judges the record it just rendered, and hands the night's verdict to the gate", () => {
    // The section states the refutation for whoever opens the run; the night has to *stop* over it, and
    // this is the step where the finding is known. It is the night's recording aid — `continue-on-error`
    // in the job — so it does not exit on the finding: it publishes the count its own block is made of,
    // and `.freebuff/wait-drift-gate.mjs` reads that back as the job's verdict. Two things have to hold
    // for that to be one answer: the count is the block's (the same findings, off one call), and the
    // night still records exactly what it was asked to record.
    const settled = [
      ghSettled(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
      ghSettled(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
      ghSettled(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
      ghSettled(605, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z"),
    ];
    const drift = waitCrossing({
      date: "2026-11-05",
      number: 604,
      latest: 6,
      held: 4,
      since: "2026-10-28",
    });
    const matching = waitCrossing({
      date: "2026-11-05",
      number: 604,
      latest: 5,
      held: 4,
      since: "2026-10-28",
    });
    if (drift === null || matching === null) throw new Error("the fixture no longer makes a crossing");
    // The runbook the night reads: three of the four answered requests already recorded, and the crossing
    // line *edited in* by hand — which is the case this exists for, since `recordWaitCrossing` is total
    // over the bar and never appends a line below the level already on record. The fourth answer is the
    // night's own work, so the recording and the judgement are asserted in one run. The recorder is
    // handed the days rather than GitHub's fields, which is the shape the kind's own mapper produces.
    const request = (number: number, created: string, closed: string, merged: string = closed) => ({
      number,
      created,
      closed,
      merged,
    });
    const written = recordFloorProposals({
      text: "# The runbook\n",
      settled: [
        request(601, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z"),
        request(602, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z"),
        request(603, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z"),
      ],
    }).text;
    const list = file("judged-settled.json", JSON.stringify(settled));
    const summary = path.join(scratch, "judged-summary.md");
    const page = path.join(scratch, "judged-page.md");
    // The block as a file of its own, which is the surface a reader months later has: the verdict step
    // quotes this file into the record the artifact carries, because a page rolls away and a file in an
    // artifact does not.
    const driftLines = path.join(scratch, "judged-drift.md");
    const runbook = file("judged-runbook.md", `${written}${drift.line}\n`);
    const args = [
      "--settle-floor",
      "--settled",
      list,
      "--runbook",
      runbook,
      "--output",
      page,
      "--drift",
      driftLines,
    ];

    const out = path.join(scratch, "judged-output");
    const result = run([...args, "--github-annotations"], {
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
    });

    // The record landed and the step still passed: the red over this belongs to the gate, because a red
    // here would say the night's history stopped accruing, which is a different fact.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("recorded 1 settlement(s)");
    const text = readFileSync(runbook, "utf8");
    expect(text).toContain("- **2026-11-05 — floor proposal #605: merged after 7 nights.**");
    // …and the record is otherwise left as it was found: the night refutes a refuted line, it does not
    // repair one, which is the whole reason the red is worth having.
    expect(text).toContain(drift.line);
    // The count travels, and it is the block's: one line the records do not produce, which is what the
    // section states and what the gate fails the job over. The same output is written on an ordinary
    // night as a `0`, so an empty value means the step never judged rather than a clean record.
    expect(readFileSync(out, "utf8")).toContain("wait-drift=1\n");
    // …and *which* line it is, in the identity every surface names it by (the request and the night),
    // because the verdict step's comment is deduped on the lines rather than on the rendered block.
    expect(readFileSync(out, "utf8")).toContain("wait-drift-set=#604 on 2026-11-05\n");
    expect(result.stdout).toContain(
      "1 crossing line(s) the settlements do not produce, which the drift gate fails the night over",
    );
    // The log gets the module's own sentences — the same ones the trend step's red carries — and the
    // annotation is how a reviewer watching the run meets the line rather than only the red that follows.
    expect(result.stderr).toContain(
      "coverage-trend: the record states 1 crossing line(s) these settlements do not produce:",
    );
    expect(result.stderr).toContain("A crossing line is the bar this job's own reading is written in");
    expect(result.stderr).toContain(
      "  #604 on 2026-11-05 — the records hold no night whose middle is 6 night(s), so the crossing it " +
        "states never happened",
    );
    expect(result.stdout).toContain(
      "::error file=.freebuff/run.md,title=settled-wait drift (floor proposals)::#604 on 2026-11-05 — " +
        "the records hold no night whose middle is 6 night(s), so the crossing it states never happened",
    );
    // …and both surfaces the night writes carry the block they are the count of, with the file the
    // verdict step quotes stating the lines themselves rather than only a pointer to the page.
    expect(readFileSync(summary, "utf8")).toContain("#### A crossing line the records do not produce");
    expect(readFileSync(page, "utf8")).toContain("#### A crossing line the records do not produce");
    expect(readFileSync(driftLines, "utf8")).toContain(
      "#### A crossing line the records do not produce",
    );
    expect(readFileSync(driftLines, "utf8")).toContain(
      "- **#604 on 2026-11-05** — the records hold no night whose middle is 6 night(s)",
    );

    // The annotation is asked for, not assumed: the same run without the flag says the finding in its log
    // and hands the gate the same count, and puts nothing on the run's annotations.
    const bare = run(args, { GITHUB_OUTPUT: path.join(scratch, "bare-output") });
    expect(bare.status, bare.stderr).toBe(0);
    expect(bare.stdout).not.toContain("::error");
    expect(readFileSync(path.join(scratch, "bare-output"), "utf8")).toContain("wait-drift=1\n");

    // The other direction of the same count, over the same night's history: a line these records *do*
    // produce is no finding at all, and the gate is handed a `0` rather than an empty value.
    const cleanOut = path.join(scratch, "clean-output");
    const cleanPage = path.join(scratch, "clean-page.md");
    const cleanDrift = path.join(scratch, "clean-drift.md");
    const cleanRunbook = file("clean-runbook.md", `${written}${matching.line}\n`);
    const quiet = run(
      [
        "--settle-floor",
        "--settled",
        list,
        "--runbook",
        cleanRunbook,
        "--output",
        cleanPage,
        "--drift",
        cleanDrift,
      ],
      { GITHUB_OUTPUT: cleanOut },
    );
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(readFileSync(cleanOut, "utf8")).toContain("wait-drift=0\n");
    // …and the list of lines is published as the *empty* value rather than left off: a kind that judged
    // and held every line has no line to report, which is a different state from the step never having
    // judged at all — and the gate reads a positive count with nothing named as a mis-wired step.
    expect(readFileSync(cleanOut, "utf8")).toContain("wait-drift-set=\n");
    expect(quiet.stderr).not.toContain("these settlements do not produce");
    expect(readFileSync(cleanPage, "utf8")).not.toContain(
      "#### A crossing line the records do not produce",
    );
    // …and the file follows the file's rule rather than the count's: a night with nothing to state
    // writes nothing at all, so the absence a later reader meets means exactly this, not a failure to
    // write. The step says which it was, since a file nobody wrote is not something a reader can ask.
    expect(existsSync(cleanDrift)).toBe(false);
    expect(quiet.stdout).toContain(
      `no crossing line these settlements cannot produce — nothing written to ${cleanDrift}`,
    );
  });

  it("passes a night with nothing answered, and refuses a list or a runbook it cannot read", () => {
    const runbook = file("quiet-runbook.md", "# The runbook\n");
    const open = file("open.json", JSON.stringify([ghSettled(12, "2026-10-08T02:20:00Z", null)]));

    // Most nights answer nothing, and that is a pass with a note rather than a failure — no settlement
    // was owed, and the file is left exactly as it was.
    const quietPage = path.join(scratch, "quiet-page.md");
    const quiet = run([
      "--settle-floor",
      "--settled",
      open,
      "--runbook",
      runbook,
      "--output",
      quietPage,
    ]);
    expect(quiet.status, quiet.stderr).toBe(0);
    expect(quiet.stdout).toContain("nothing was answered since the last night");
    expect(readFileSync(runbook, "utf8")).toBe("# The runbook\n");
    // …and no file is left behind for the artifact to pick up: a history with nothing in it is the
    // same omission on the page and in the upload, never an empty table claiming to be one.
    expect(quiet.stdout).toContain(`no settlements to summarise — nothing written to ${quietPage}`);
    expect(existsSync(quietPage)).toBe(false);

    // A list it cannot read is a usage error: the list is the whole of what there is to record, so a
    // night that cannot read it must not look like a night that owed nothing.
    const noList = run(["--settle-floor", "--runbook", runbook]);
    expect(noList.status).toBe(2);
    expect(noList.stderr).toContain("--settled <path>");
    const junk = file("junk.json", "not json");
    expect(run(["--settle-floor", "--settled", junk, "--runbook", runbook]).status).toBe(2);
    const notList = file("object.json", "{}");
    const object = run(["--settle-floor", "--settled", notList, "--runbook", runbook]);
    expect(object.status).toBe(2);
    expect(object.stderr).toContain("does not hold a list of requests");

    // …while a runbook it cannot read is a failure: the record *is* that file, so "no record" is not
    // a pass, and neither is an empty list write.
    const missing = run([
      "--settle-floor",
      "--settled",
      open,
      "--runbook",
      path.join(scratch, "nothing-here.md"),
    ]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("the settlement is recorded *in* the runbook");
    expect(existsSync(path.join(scratch, "nothing-here.md"))).toBe(false);
  });

  it("refuses an --output it cannot write, with the record itself already landed", () => {
    // The file is asked for, so a run that could not write it did not do what it was asked — even
    // though the record the file summarises went into the runbook a moment earlier. The boundary is
    // deliberate: the runbook is the *record* and the file is a rendering of it, so the history of
    // the night survives the failure — and the night still reports it, rather than leaving the summary
    // silently absent from an artifact nobody would know to miss.
    const runbook = file("unwritable-runbook.md", ["# The runbook", ""].join("\n"));
    const settled = file(
      "unwritable-settled.json",
      JSON.stringify([ghSettled(13, "2026-10-04T02:20:00Z", "2026-10-13T11:00:00Z")]),
    );

    const result = run([
      "--settle-floor",
      "--settled",
      settled,
      "--runbook",
      runbook,
      "--output",
      path.join(scratch, "no-such-dir", "page.md"),
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot write");
    expect(readFileSync(runbook, "utf8")).toContain("#13: merged after 9 nights");
  });
});

/**
 * The same command for the other kind, through the same spawn: this one's list is GitHub's own pull
 * requests *with their comments*, so the step that runs it hands over a shape only the module can read
 * — and a list of the wrong kind, which is the failure a workflow edit would produce, has to record
 * nothing rather than invent a settlement out of fields that are not there.
 */
describe("the coverage:trend --settle-collect command", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchDir("coverage-settle-collect-");
  });
  afterAll(() => {
    removeScratchDir(scratch);
  });

  const run = (
    args: string[],
    env: Record<string, string> = {},
  ): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [trendModule, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  /** A scratch file this suite owns, written whole. */
  const file = (name: string, text: string): string => {
    const at = path.join(scratch, name);
    writeFileSync(at, text, "utf8");
    return at;
  };

  /**
   * One pull request as `gh pr list --json number,closedAt,comments` states it: the proposal comment
   * the job posted (its own `createdAt` is the day the proposal was made) and, where somebody
   * answered it, the reply the apply job left — both bodies carrying the poster's own markers.
   */
  const ghProposal = (
    number: number,
    proposed: string,
    answered: string | null,
    closed: string | null = null,
    status: string | null = null,
  ) => ({
    number,
    closedAt: closed,
    comments: [
      { createdAt: proposed, body: `${PROPOSAL_MARKER}\n\nproposal` },
      ...(answered === null
        ? []
        : [
            {
              createdAt: answered,
              // …and the outcome the apply job declares in it, where it declared one: a reply from
              // before that vocabulary existed carries the marker alone, which is the `answered`
              // record every one of those has always been.
              body:
                `${APPLY_REPLY_MARKER}\n\n` +
                (status === null ? "" : `${APPLY_STATUS_OPEN}${status} -->\n\n`) +
                "reply",
            },
          ]),
    ],
  });

  it("leaves no comment for a kind with no request of its own, however its wait moves", () => {
    // The comment channel is the floor kind's because its *target* is: a collect proposal is a comment
    // this job leaves on somebody else's pull request, so a risen wait here has no request of this job's
    // own to be said on — and the open pull request in this list belongs to somebody else, which is
    // exactly why commenting on it would be the wrong thing to do. A caller that asks for the file
    // anyway gets none, and is told which case it hit rather than left wondering.
    const runbook = file("collect-wait-runbook.md", "# The runbook\n");
    const settled = file(
      "collect-wait-settled.json",
      JSON.stringify([
        ghProposal(401, "2026-10-01T02:20:00Z", "2026-10-02T06:00:00Z"),
        ghProposal(402, "2026-10-01T02:20:00Z", "2026-10-05T06:00:00Z", null, "applied"),
        // …and a proposal still standing, on an open pull request: the entry a floor-shaped reader would
        // have taken for the request to comment on.
        ghProposal(403, "2026-10-20T02:20:00Z", null),
      ]),
    );
    const comment = path.join(scratch, "collect-wait-comment.md");
    const result = run([
      "--settle-collect",
      "--settled",
      settled,
      "--runbook",
      runbook,
      "--output",
      path.join(scratch, "collect-wait-page.md"),
      "--comment",
      comment,
      "--today",
      "2026-11-03",
    ]);

    expect(result.status, result.stderr).toBe(0);
    // The wait *did* rise — one answer after a night, the next after four — so this is not a quiet
    // history read as one: what is missing is a request of this kind's own to say it on.
    expect(result.stderr).toContain("coverage-trend: warning —");
    expect(result.stderr).toContain(
      "the settled wait rose but there is no open request of this kind's own to say it on",
    );
    expect(existsSync(comment)).toBe(false);
  });

  it("records the answered and the unanswered, once, and states the history on the page", () => {
    const runbook = file(
      "collect-runbook.md",
      [
        "# The runbook",
        "",
        "- **2026-10-02 — ci verdict: 10 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (10 selected); all stages passed.** typecheck PASS.",
        "",
      ].join("\n"),
    );
    const settled = file(
      "collect-settled.json",
      JSON.stringify([
        // A proposal still standing: nothing answered it and the pull request is open.
        ghProposal(201, "2026-10-25T02:20:00Z", null),
        // Answered, with the pull request still open — the answer is the reply, not the close.
        ghProposal(203, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z"),
        // Closed with the ask unanswered, which is a settlement too.
        ghProposal(202, "2026-10-10T02:20:00Z", null, "2026-10-20T09:00:00Z"),
        // …and a pull request the job never proposed anything on.
        { number: 204, closedAt: null, comments: [{ createdAt: "2026-10-01T02:20:00Z", body: "hi" }] },
      ]),
    );
    const summary = path.join(scratch, "collect-summary.md");
    const out = path.join(scratch, "collect-output");
    const artifact = path.join(scratch, "collect-artifact.md");

    // The drift file is asked for here too, because this kind judges its own record now: the runbook
    // holds no collect crossing yet, so the count is a `0` and no block is written — which is the
    // ordinary night, and the file's absence means exactly that.
    //
    // `--today` is the night the run is *about*, and it is passed because this night records a collect
    // crossing: without it the line would be dated by the wall clock, and a fixture whose answers are
    // dated in the future would leave the next night reading its own record as a line about a night the
    // series has not reached.
    const collectDrift = path.join(scratch, "collect-drift.md");
    const result = run(
      [
        "--settle-collect",
        "--settled",
        settled,
        "--runbook",
        runbook,
        "--output",
        artifact,
        "--drift",
        collectDrift,
        "--today",
        "2026-11-05",
      ],
      { GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: out },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("recorded 2 settlement(s)");
    expect(result.stdout).toContain("#203 answered after 2 night(s)");
    expect(result.stdout).toContain("#202 closed unanswered after 10 night(s)");
    expect(result.stdout).toContain("2 settled so far: 2, 10 night(s)");
    expect(readFileSync(out, "utf8")).toContain("recorded=2");
    // …and this kind judges the record it renders as well, off its *own* series: the two waits are
    // watched separately, so the count here is over these settlements and the collect crossing lines,
    // never over the floor proposal's. Nothing is refuted on this night — the runbook holds no collect
    // crossing yet — so the count is a `0` and no block is written, which is the ordinary night.
    expect(readFileSync(out, "utf8")).toContain("wait-drift=0\n");
    expect(existsSync(collectDrift)).toBe(false);
    expect(result.stdout).toContain(
      `no crossing line these settlements cannot produce — nothing written to ${collectDrift}`,
    );
    // …and the night records the crossing it just said, which is the half of the record this kind was
    // missing: nothing else writes one, so without it the section above could never hold a line against
    // anything. It names the series rather than a request, and its sentence says which channel said it.
    const settledText = readFileSync(runbook, "utf8");
    const collectCrossings = waitCrossings(settledText, "collect");
    expect(collectCrossings).toHaveLength(1);
    expect(collectCrossings[0].number).toBe("");
    expect(settledText).toContain(" — settled collect-budget wait: the median reached ");
    expect(settledText).toContain("this kind leaves no comment, having no request of its own to leave one on");
    expect(result.stdout).toContain(`this kind's crossing recorded in ${runbook}`);
    // …while the channel it has not got stays a step nobody posts from: the output promises no comment,
    // which is what keeps a poster out of this step's invocation.
    expect(readFileSync(out, "utf8")).toContain("wait-request=\n");

    const text = readFileSync(runbook, "utf8");
    expect(text).toContain(
      "- **2026-10-07 — collect-budget proposal on #203: answered after 2 nights.**",
    );
    expect(text).toContain(
      "- **2026-10-20 — collect-budget proposal on #202: closed unanswered after 10 nights.**",
    );
    // A proposal nothing has ended is still being asked, so it is not a record — and a pull request
    // with no proposal on it has nothing this command could read an age out of.
    expect(text).not.toContain("#201");
    expect(text).not.toContain("#204");
    // The record it wrote is what the floors are *not* derived from, and the two kinds do not read each
    // other's lines: the settlement this run appended is not a floor record and not a reading.
    expect(floorProposalSettlements(text)).toEqual([]);
    expect(runbookRecords(text).map((record) => record.date)).toEqual(["2026-10-02"]);

    const page = readFileSync(summary, "utf8");
    expect(page).toContain("### Collect-budget proposals answered");
    // …and the row states the *request* as well as the ask: a settlement whose ask went unanswered settles the
    // pull request too (its own day is the day that request closed), while a reply that landed with the
    // request still there leaves the cell a dash — which is the record saying nothing, not the page claiming
    // the request survives.
    expect(page).toContain("| #202 | 2026-10-20 | 10 | closed without the reply, after the escalation | closed 2026-10-20 |");
    expect(page).toContain("| #203 | 2026-10-07 | 2 | answered, before either threshold | — |");
    expect(page).toContain("| proposal | answered | nights | how it was answered | pull request |");
    expect(page).toContain("#### Where the ages landed");

    // …and the file the artifact carries is the page, rendered for the runbook this run just wrote
    // rather than a second summary of it: one renderer behind the two surfaces.
    expect(result.stdout).toContain(`the summary to ${artifact}`);
    const written = readFileSync(artifact, "utf8");
    expect(written).toBe(
      `${renderCollectSettlementSection(collectProposalSettlements(text), { threads: pullThreads(text) })}\n`,
    );

    // The next night records nothing and rewrites rather than appends: the file is the dedupe, and an
    // appended artifact would double every age a night later.
    const again = run(["--settle-collect", "--settled", settled, "--runbook", runbook, "--output", artifact], {
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("recorded 0 settlement(s)");
    expect(readFileSync(runbook, "utf8")).toBe(text);
    expect(readFileSync(artifact, "utf8")).toBe(written);
  });

  it("records the pull request's own close when the ask there was answered first, once", () => {
    // The half of this kind's story its settlement line cannot state, and the reason the record exists: a
    // collect ask is a comment, so the pull request under it can outlive the answer by weeks — and while
    // nothing said so, a comment this job left there was rewritten nightly into a thread that had closed.
    // The line is owed for exactly one state, and every other state in this case is a refusal: a request
    // answered with its pull request still open (nothing to record yet), the same request closed a night
    // later (the close), the same window again (nothing — the file is the dedupe), and a request closed
    // with the ask *unanswered*, whose own settlement line already states that ending.
    const runbook = file("close-runbook.md", "# The runbook\n");
    const open = file(
      "close-open.json",
      JSON.stringify([ghProposal(210, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", null, "applied")]),
    );
    const closed = file(
      "close-closed.json",
      JSON.stringify([
        ghProposal(210, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", "2026-10-11T10:00:00Z", "applied"),
        ghProposal(211, "2026-10-05T02:20:00Z", null, "2026-10-12T10:00:00Z"),
      ]),
    );
    const summary = path.join(scratch, "close-summary.md");
    const artifact = path.join(scratch, "close-artifact.md");

    const first = run(["--settle-collect", "--settled", open, "--runbook", runbook, "--output", artifact]);

    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(runbook, "utf8")).toContain(
      "- **2026-10-07 — collect-budget proposal on #210: applied after 2 nights.**",
    );
    // A request still standing is not one to record a close of, and the log says nothing about one.
    expect(pullCloses(readFileSync(runbook, "utf8"))).toEqual([]);
    expect(first.stdout).not.toContain("closed after the ask there was answered");
    // …and the page is the table it always was: a history in which no request has gone has no state to
    // state, so the column is not there to be read as a row of dashes.
    expect(readFileSync(artifact, "utf8")).not.toContain("pull request |");
    expect(readFileSync(artifact, "utf8")).not.toContain("recorded as gone");

    const second = run(
      [
        "--settle-collect",
        "--settled",
        closed,
        "--runbook",
        runbook,
        "--output",
        artifact,
        "--today",
        "2026-10-13",
      ],
      { GITHUB_STEP_SUMMARY: summary },
    );

    expect(second.status, second.stderr).toBe(0);
    const text = readFileSync(runbook, "utf8");
    // The line, in the shape the writer writes: its head is the reader's, so a rewrite of either that
    // moved the other would leave this failing rather than a night silently not reading it.
    expect(text).toContain(
      "- **2026-10-11 — the pull request behind collect-budget proposal #210 closed, after the ask there " +
        "was answered.**",
    );
    // …the ask's own line is *not* written a second time, and the request whose ask went unanswered gets
    // no close line at all: its settlement states the close as the ask's ending, which is the whole of
    // what the second line is for.
    expect((text.match(/collect-budget proposal on #210/g) ?? []).length).toBe(1);
    expect(text).toContain("- **2026-10-12 — collect-budget proposal on #211: closed unanswered after 7 nights.**");
    expect(pullCloses(text)).toEqual([{ date: "2026-10-11", number: "210" }]);
    expect(second.stdout).toContain(
      "1 pull request(s) closed after the ask there was answered: #210 on 2026-10-11",
    );
    // …and the page the night writes say so too, which is the other half of the record: the row for #210
    // carries the day its pull request closed, the row for #211 the day its own settlement states, and the
    // paragraph under the table says which is which, because a reader of the page alone has to be able to
    // tell that the thread is gone without opening the runbook.
    const page = readFileSync(summary, "utf8");
    expect(page).toContain("| proposal | answered | nights | how it was answered | pull request |");
    expect(page).toContain(
      "| #210 | 2026-10-07 | 2 | applied, before either threshold | closed 2026-10-11 |",
    );
    expect(page).toContain(
      "| #211 | 2026-10-12 | 7 | closed without the reply, after the escalation | closed 2026-10-12 |",
    );
    expect(page).toContain("**2 of these requests are recorded as gone.**");
    expect(readFileSync(artifact, "utf8")).toContain(
      "| #210 | 2026-10-07 | 2 | applied, before either threshold | closed 2026-10-11 |",
    );
    // …and the record is a record of its own: the settlements the page, the median and the crossing check
    // are built from are the two asks, nothing more, and the artifact is the section they render.
    expect(collectProposalSettlements(text).map((record) => record.number)).toEqual(["210", "211"]);
    expect(readFileSync(artifact, "utf8")).toBe(
      renderCollectSettlementSection(collectProposalSettlements(text), { threads: pullThreads(text) }) + "\n",
    );
    expect(waitCrossingDrift(collectProposalSettlements(text), waitCrossings(text, "collect"))).toEqual([]);
    // …and it is not a reading either: the floors are derived from `ci verdict:` lines, which this is not.
    expect(runbookRecords(text).map((record) => record.date)).toEqual([]);

    // The night after that, over the same window: the close is on record, so nothing is written at all —
    // the file is the dedupe, and a second line would say the same request closed twice.
    const third = run(["--settle-collect", "--settled", closed, "--runbook", runbook, "--output", artifact]);

    expect(third.status, third.stderr).toBe(0);
    expect(third.stdout).not.toContain("pull request(s) closed");
    expect(readFileSync(runbook, "utf8")).toBe(text);
  });

  it("corrects a recorded close when the pull request comes back, once, and records the second close", () => {
    // The half of the close record the close cannot state about itself, and the reason it had to be written:
    // a close is read as the end of a thread — the gate leaves that comment alone, the page drops its cell —
    // and a pull request can be *reopened* by whoever closed it. Without a line saying so, one close was a
    // permanent claim about a request whose life this job does not own, and every later night went on
    // treating a live thread as one nobody will read. The correction is dated by the night the job saw it,
    // which is the one date here GitHub does not state (a request carries `closedAt` and nothing for a
    // reopening), and the close it supersedes is quoted in the line so a reader has both days.
    //
    // Owed for exactly one state, and every other state in this case is a refusal: a request that was never
    // closed (the settlement is the end of the ask, not of the thread), the same window again (the reader
    // the gate asks is the dedupe), and the request closing a second time — which is a fact the first close
    // line does not state, and which puts the cell back on the page the reopening had taken it off.
    //
    // Two requests, because the file records a thread ending in *two* shapes and both have to correct: #210
    // is the ask answered and the pull request closed weeks later (the close record), while #211 is one
    // request that went away with its ask still unanswered — whose ending is its own settlement line, and
    // whose `closed unanswered` word is also what puts a cell on the page. That second one is the case the
    // page's own correction exists for: the reopening takes the cell off without touching the word column,
    // because the ask's history is one thing and the pull request's state is another.
    const runbook = file("reopen-runbook.md", "# The runbook\n");
    const answered = file(
      "reopen-answered.json",
      JSON.stringify([ghProposal(210, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", null, "applied")]),
    );
    const closed = file(
      "reopen-closed.json",
      JSON.stringify([
        ghProposal(210, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", "2026-10-11T10:00:00Z", "applied"),
        ghProposal(211, "2026-10-05T02:20:00Z", null, "2026-10-12T10:00:00Z"),
      ]),
    );
    // …and the same requests open again, as tonight's list states them: the close day is `null`, which is the
    // one field the correction is read off. Nothing else about either changed — #210's ask was answered and
    // stays answered, and #211's ask was never answered at all, which is what the two heads below must not
    // unsay.
    const reopened = file(
      "reopen-reopened.json",
      JSON.stringify([
        ghProposal(210, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", null, "applied"),
        ghProposal(211, "2026-10-05T02:20:00Z", null, null),
      ]),
    );
    const closedAgain = file(
      "reopen-closed-again.json",
      JSON.stringify([
        ghProposal(210, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z", "2026-10-20T10:00:00Z", "applied"),
        ghProposal(211, "2026-10-05T02:20:00Z", null, null),
      ]),
    );
    const summary = path.join(scratch, "reopen-summary.md");
    const artifact = path.join(scratch, "reopen-artifact.md");

    // Night one: the ask is answered. The request is still standing, so there is no thread to say anything
    // about — and no word about one, which is what makes the close below the cause of everything after it.
    const settled = run(["--settle-collect", "--settled", answered, "--runbook", runbook, "--output", artifact]);

    expect(settled.status, settled.stderr).toBe(0);
    expect(settled.stdout).not.toContain("reopened");
    expect(pullThreads(readFileSync(runbook, "utf8"))).toEqual([]);

    // Night two: the request has gone, which is the record this case turns on.
    const gone = run([
      "--settle-collect",
      "--settled",
      closed,
      "--runbook",
      runbook,
      "--output",
      artifact,
      "--today",
      "2026-10-12",
    ]);

    expect(gone.status, gone.stderr).toBe(0);
    expect(readFileSync(runbook, "utf8")).toContain(
      "- **2026-10-12 — collect-budget proposal on #211: closed unanswered after 7 nights.**",
    );
    expect(pullCloses(readFileSync(runbook, "utf8"))).toEqual([{ date: "2026-10-11", number: "210" }]);

    // Night three: the request is open again. The close stays in the file as the history it is, and the line
    // below it is the record's word about the *thread* — the one every later night and every surface acts on.
    const back = run(
      [
        "--settle-collect",
        "--settled",
        reopened,
        "--runbook",
        runbook,
        "--output",
        artifact,
        "--today",
        "2026-10-15",
      ],
      { GITHUB_STEP_SUMMARY: summary },
    );

    expect(back.status, back.stderr).toBe(0);
    const text = readFileSync(runbook, "utf8");
    // The line, in the shape the writer writes: its head is the reader's, and the close it corrects is quoted
    // in it rather than left to be worked out from the order of the file. It is owed for both requests, and
    // the day it quotes is each one's own ending — the close record's day for #210, and the day its settlement
    // states for #211, which is the same day the request closed.
    expect(text).toContain(
      "- **2026-10-15 — the pull request behind collect-budget proposal #210 reopened, after the close " +
        "recorded for 2026-10-11.**",
    );
    expect(text).toContain(
      "- **2026-10-15 — the pull request behind collect-budget proposal #211 reopened, after the close " +
        "recorded for 2026-10-12.**",
    );
    // …the close is still there, as the history it is, and the ask's own line is still one line: a reopening
    // corrects the record's word about the pull request, which is a different fact about the same number.
    expect(text).toContain(
      "- **2026-10-11 — the pull request behind collect-budget proposal #210 closed, after the ask there " +
        "was answered.**",
    );
    expect((text.match(/collect-budget proposal on #210/g) ?? []).length).toBe(1);
    // …#211's own line is the settlement the request went away with, and it states nothing about the
    // correction — the ask was never answered, and a reopening does not answer it.
    expect(text).toContain("- **2026-10-12 — collect-budget proposal on #211: closed unanswered after 7 nights.**");
    expect((text.match(/collect-budget proposal on #211/g) ?? []).length).toBe(1);
    // …and what the file now says about both requests is that they are back. The two readers below are the
    // ones every surface asks: the thread's standing statement, and the closes that still stand, which is the
    // dedupe the next night's close is read against and the column the page draws. One entry per request, in
    // the order the file first names them — the close on the earlier night, then #211's own correction.
    expect(pullThreads(text)).toEqual([
      { state: "reopened", date: "2026-10-15", number: "210", closed: "2026-10-11" },
      { state: "reopened", date: "2026-10-15", number: "211", closed: "2026-10-12" },
    ]);
    expect(pullCloses(text)).toEqual([]);
    expect(back.stdout).toContain(
      "2 pull request(s) reopened after the record said they were gone: #210, closed on 2026-10-11, " +
        "#211, closed on 2026-10-12",
    );
    // …and the page says it by *not* saying it: neither thread is gone, so there is no cell and no paragraph
    // about one — while #211's *word* column still states how its ask ended, which is the ask's history and
    // not the pull request's state. The artifact is where that absence is read: it is rewritten whole each
    // night, while a run page appends, so the page still holds the earlier night's table beside this one.
    expect(readFileSync(artifact, "utf8")).not.toContain("pull request |");
    expect(readFileSync(artifact, "utf8")).not.toContain("recorded as gone");
    expect(readFileSync(artifact, "utf8")).toContain(
      "| #211 | 2026-10-12 | 7 | closed without the reply, after the escalation |",
    );
    expect(readFileSync(artifact, "utf8")).toBe(
      renderCollectSettlementSection(collectProposalSettlements(text), { threads: pullThreads(text) }) + "\n",
    );
    expect(waitCrossingDrift(collectProposalSettlements(text), waitCrossings(text, "collect"))).toEqual([]);
    expect(runbookRecords(text).map((record) => record.date)).toEqual([]);

    // The night after that, over the same window: the file already says the request is back, so nothing is
    // written at all. That is the reader being the dedupe rather than a second record of the same night.
    const quiet = run(["--settle-collect", "--settled", reopened, "--runbook", runbook, "--output", artifact]);

    expect(quiet.status, quiet.stderr).toBe(0);
    expect(quiet.stdout).not.toContain("reopened");
    expect(readFileSync(runbook, "utf8")).toBe(text);

    // And the second close, which is news the first close line does not state: it is recorded as its own
    // close, dated by the day this one happened, and the standing word about the thread is an ending again —
    // so the page's column comes back with the later day rather than the corrected one.
    const again = run([
      "--settle-collect",
      "--settled",
      closedAgain,
      "--runbook",
      runbook,
      "--output",
      artifact,
      "--today",
      "2026-10-21",
    ], { GITHUB_STEP_SUMMARY: summary });

    expect(again.status, again.stderr).toBe(0);
    const final = readFileSync(runbook, "utf8");
    expect(final).toContain(
      "- **2026-10-20 — the pull request behind collect-budget proposal #210 closed, after the ask there " +
        "was answered.**",
    );
    // …and #211 is still open, so the night writes nothing for it: a correction already on record is not one
    // to state twice, which is the reader being the dedupe.
    expect((final.match(/reopened, after the close recorded for/g) ?? []).length).toBe(2);
    expect(pullCloses(final)).toEqual([{ date: "2026-10-20", number: "210" }]);
    expect(pullThreads(final)).toEqual([
      { state: "closed", date: "2026-10-20", number: "210", closed: "2026-10-20" },
      { state: "reopened", date: "2026-10-15", number: "211", closed: "2026-10-12" },
    ]);
    expect(again.stdout).toContain(
      "1 pull request(s) closed after the ask there was answered: #210 on 2026-10-20",
    );
    expect(readFileSync(artifact, "utf8")).toContain(
      "| #210 | 2026-10-07 | 2 | applied, before either threshold | closed 2026-10-20 |",
    );
    // …the cell for #211 does not come back with it: that request is still open, so its row is the dash the
    // page states rather than a survival, and the count is the one request the record calls gone.
    expect(readFileSync(artifact, "utf8")).toContain(
      "| #211 | 2026-10-12 | 7 | closed without the reply, after the escalation | — |",
    );
    expect(readFileSync(artifact, "utf8")).toContain("**1 of these requests is recorded as gone.**");
    // …and it is still two settlements and no reading: the record grew two corrections and a second close,
    // and nothing the page's other halves are built from moved.
    expect(collectProposalSettlements(final).map((record) => record.number)).toEqual(["210", "211"]);
    expect((final.match(/the pull request behind collect-budget proposal #210/g) ?? []).length).toBe(3);
    expect((final.match(/the pull request behind collect-budget proposal #211/g) ?? []).length).toBe(1);
    expect(runbookRecords(final).map((record) => record.date)).toEqual([]);
  });

  it("refutes a collect crossing line in the collect section, and against no other kind's records", () => {
    // The other half of the record this kind was missing: what the night writes, its own section has to
    // be able to refute — the floor kind's check, over these lines and these settlements. A line edited
    // by hand is the case it exists for (the recorder is total over the bar, so it never writes one
    // below the level on record), and the two waits are watched separately, which is the half this case
    // holds as hard as the first: the *floor* section must not see a collect line at all.
    const written = recordCollectProposals({
      text: "# The runbook\n",
      settled: [
        { number: 801, proposed: "2026-10-14T02:20:00Z", answered: "2026-10-15T06:00:00Z", status: "applied", closed: null },
        { number: 802, proposed: "2026-10-16T02:20:00Z", answered: "2026-10-20T06:00:00Z", status: "applied", closed: null },
        { number: 803, proposed: "2026-10-22T02:20:00Z", answered: "2026-10-28T06:00:00Z", status: "applied", closed: null },
        { number: 805, proposed: "2026-10-29T02:20:00Z", answered: "2026-11-05T06:00:00Z", status: "applied", closed: null },
      ],
    }).text;
    // The series' medians are 1, 2.5, 4 then 5, so the crossing these records *do* produce is the last
    // one: a median of 5 on 2026-11-05, past the 4 the history had held since 2026-10-28. The refuted
    // line is that same line with the median moved to a number no night of the series has.
    const matching = waitCrossing({
      kind: "collect",
      date: "2026-11-05",
      latest: 5,
      held: 4,
      since: "2026-10-28",
    });
    const drift = waitCrossing({
      kind: "collect",
      date: "2026-11-05",
      latest: 6,
      held: 4,
      since: "2026-10-28",
    });
    if (matching === null || drift === null) throw new Error("the fixture no longer makes a crossing");
    const list = file(
      "collect-drift-settled.json",
      JSON.stringify([
        ghProposal(801, "2026-10-14T02:20:00Z", "2026-10-15T06:00:00Z", null, "applied"),
        ghProposal(802, "2026-10-16T02:20:00Z", "2026-10-20T06:00:00Z", null, "applied"),
        ghProposal(803, "2026-10-22T02:20:00Z", "2026-10-28T06:00:00Z", null, "applied"),
        ghProposal(805, "2026-10-29T02:20:00Z", "2026-11-05T06:00:00Z", null, "applied"),
      ]),
    );
    // The night's own read of the runbook it just wrote, published for the gate the same way the floor
    // kind's is: the count is the block's own findings, off one call.
    const text = `${written}${drift.line}\n`;
    const runbook = file("collect-drift-runbook.md", text);
    const page = path.join(scratch, "collect-drift-page.md");
    const lines = path.join(scratch, "collect-drift-lines.md");
    const out = path.join(scratch, "collect-drift-output");

    const result = run(
      [
        "--settle-collect",
        "--settled",
        list,
        "--runbook",
        runbook,
        "--output",
        page,
        "--drift",
        lines,
      ],
      { GITHUB_OUTPUT: out },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("wait-drift=1\n");
    // The collect kind's line, in the identity its own series is named by — no request of this job's own
    // in that story, so the series and the night are the whole of what a later night can match it on.
    expect(readFileSync(out, "utf8")).toContain("wait-drift-set=the collect-budget wait on 2026-11-05\n");
    expect(result.stdout).toContain(
      "1 crossing line(s) the settlements do not produce, which the drift gate fails the night over",
    );
    // The line is named as the series it belongs to, and the reason is the first leg the arithmetic
    // fails — the same sentences the floor kind's refutation is stated in.
    expect(result.stderr).toContain(
      "  the collect-budget wait on 2026-11-05 — the records hold no night whose middle is 6 night(s)",
    );
    const section = readFileSync(page, "utf8");
    expect(section).toContain("#### A crossing line the records do not produce");
    expect(section).toContain("- **the collect-budget wait on 2026-11-05** —");
    // …and in *this* kind's words, which is the difference between the two sections' blocks: the page
    // and the annotation say a collect crossing, since this kind leaves no comment to say one.
    expect(section).toContain("the run page and the run's annotation say it while the middle of the ages");
    expect(section).toContain("The night that rendered that page wrote the line from these records");
    expect(section).not.toContain("a comment is left while the middle of the ages");
    // …and the *file* it published says the same thing in the same words: the block is rendered with this
    // kind, so the file a reader of the artifact opens states the channel this crossing was said in rather
    // than inheriting the floor kind's story about a comment this kind never leaves.
    const block = readFileSync(lines, "utf8");
    expect(block).toContain(
      "- **the collect-budget wait on 2026-11-05** — the records hold no night whose middle is 6 night(s)",
    );
    expect(block).toContain("the run page and the run's annotation say it while the middle of the ages");
    expect(block).not.toContain("a comment is left while the middle of the ages");
    // …and the file is the very block the section carries rather than a second rendering of it.
    expect(section).toContain(block);

    // The *floor* step, over the very same runbook: this line is nothing it may measure against, so the
    // count is a `0` and its own section says nothing at all — the two waits are watched separately.
    const floorOut = path.join(scratch, "collect-drift-floor-output");
    const floorPage = path.join(scratch, "collect-drift-floor-page.md");
    const none = file("collect-drift-none.json", "[]");
    const floor = run(
      ["--settle-floor", "--settled", none, "--runbook", runbook, "--output", floorPage],
      { GITHUB_OUTPUT: floorOut },
    );
    expect(floor.status, floor.stderr).toBe(0);
    expect(readFileSync(floorOut, "utf8")).toContain("wait-drift=0\n");
    expect(floor.stderr).not.toContain("these settlements do not produce");
    // A runbook with no floor settlements has no floor section to write, which is the same omission the
    // page makes — and the collect line is still the collect kind's own record.
    expect(existsSync(floorPage)).toBe(false);

    // …while the check over the *whole file* — the trend step's, which reads both kinds — does catch it,
    // holding each line against its own series: one finding, for the collect kind, named as that series.
    const report = trendReport(runbook === "" ? "" : readFileSync(runbook, "utf8"));
    expect(report.waitDrift).toHaveLength(1);
    expect(report.waitDrift[0]).toMatchObject({ crossing: { kind: "collect" } });
    expect(renderTrendReport(report)).toContain("the collect-budget wait on 2026-11-05");
    // …and a line these records *do* produce is no finding at all, in either surface.
    const quiet = file("collect-drift-quiet.md", `${written}${matching.line}\n`);
    const quietOut = path.join(scratch, "collect-drift-quiet-output");
    const quietPage = path.join(scratch, "collect-drift-quiet-page.md");
    const quietRun = run(
      [
        "--settle-collect",
        "--settled",
        list,
        "--runbook",
        quiet,
        "--output",
        quietPage,
        "--drift",
        path.join(scratch, "collect-drift-quiet-lines.md"),
      ],
      { GITHUB_OUTPUT: quietOut },
    );
    expect(quietRun.status, quietRun.stderr).toBe(0);
    expect(readFileSync(quietOut, "utf8")).toContain("wait-drift=0\n");
    expect(existsSync(path.join(scratch, "collect-drift-quiet-lines.md"))).toBe(false);
    expect(readFileSync(quietPage, "utf8")).not.toContain(
      "#### A crossing line the records do not produce",
    );
    expect(trendReport(readFileSync(quiet, "utf8")).waitDrift).toEqual([]);
  });

  it("records a refused reply as a refusal, end to end, and never as an answer", () => {
    // The declaration, driven the way the night drives it: the same fixture shape the workflow hands
    // over, a reply that refused the tightening beside one that applied it and a request that went away
    // unanswered, and the runbook has to end up saying which was which — because that is exactly the
    // reading this record was blind to while every reply counted as `answered`.
    const runbook = file("collect-refused-runbook.md", "# The runbook\n");
    const settled = file(
      "collect-refused-settled.json",
      JSON.stringify([
        ghProposal(301, "2026-10-01T02:20:00Z", "2026-10-14T06:00:00Z", null, "refused"),
        ghProposal(302, "2026-10-01T02:20:00Z", "2026-10-14T06:00:00Z", null, "applied"),
        // …and the other ending, so one render carries all three kinds of row.
        ghProposal(303, "2026-10-10T02:20:00Z", null, "2026-10-18T06:00:00Z"),
      ]),
    );
    const artifact = path.join(scratch, "collect-refused-artifact.md");
    const result = run(["--settle-collect", "--settled", settled, "--runbook", runbook, "--output", artifact]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("#301 refused after 13 night(s)");
    expect(result.stdout).toContain("#302 applied after 13 night(s)");
    expect(result.stdout).toContain("#303 closed unanswered after 8 night(s)");

    const text = readFileSync(runbook, "utf8");
    expect(text).toContain("- **2026-10-14 — collect-budget proposal on #301: refused after 13 nights.**");
    expect(text).toContain("The reply refused it — the payload would have raised a recorded budget");
    expect(text).toContain("- **2026-10-14 — collect-budget proposal on #302: applied after 13 nights.**");
    // The reading the record exists for, out of one grep of the file: which proposals ended adopted and
    // which did not, without opening either pull request.
    expect(collectProposalSettlements(text).map((record) => `${record.number}:${record.outcome}`)).toEqual([
      "301:refused",
      "302:applied",
      "303:closed unanswered",
    ]);

    const page = readFileSync(artifact, "utf8");
    expect(page).toContain(
      "| #301 | 2026-10-14 | 13 | refused — the payload would have raised a budget, after the escalation |",
    );
    expect(page).toContain("| #302 | 2026-10-14 | 13 | applied, after the escalation |");
    expect(page).toContain("1 of these replies did not adopt the tightening — `refused` (1) —");
    // …and the third reading of the same ages rides on the page the record was written to: the median
    // trend across the two nights these three were answered on, one row per night and the same two
    // thresholds read in this kind's words.
    expect(page).toContain("#### How the median wait moved");
    expect(page).toContain("| 2026-10-14 | 13, 13 | 2 | 13 | — |");
    expect(page).toContain("| 2026-10-18 | 8 | 3 | 13 | 0 |");
    // The scale widens rather than clipping the median that went past it, so the bars stay a measure of
    // nights on the one rendering a reader has.
    expect(page).toContain(
      `on a scale of 0 → 13 nights — wider than the \`ESCALATED_NIGHTS\` = ${ESCALATED_NIGHTS} the two thresholds divide, because one median has gone past it`,
    );
    // A median that never moved names no peak — there is none it came back down from — while where the
    // number sits against the two thresholds is said in this kind's words, as the floor does in its own.
    expect(page).toContain("The median has not moved from 13 nights across the 2 nights an answer arrived on.");
    expect(page).not.toContain("it peaked at");
    expect(page).toContain(
      `The newest median, 13 nights, is past both thresholds (the night the job's own floor request starts being named on the run page at ${STALE_NIGHTS}, the night that request's comment starts naming a person at ${ESCALATED_NIGHTS}).`,
    );

    // …and the word is readable back, so the next night records none of these again — the property the
    // vocabulary exists to keep, now that a record can end on any of eight words.
    const again = run(["--settle-collect", "--settled", settled, "--runbook", runbook, "--output", artifact]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("recorded 0 settlement(s)");
    expect(readFileSync(runbook, "utf8")).toBe(text);
    expect(readFileSync(artifact, "utf8")).toBe(page);
  });

  it("records nothing from the other kind's list, and refuses a list or a runbook it cannot read", () => {
    const runbook = file("collect-quiet-runbook.md", "# The runbook\n");
    // The two kinds' lists are not interchangeable, which is the failure a workflow edit would leave
    // behind: a floor-shaped list carries no comments, so there is no proposal in it to settle, and a
    // collect-shaped list carries no `createdAt` for the floor's reader. Both are a pass with a note —
    // the list is real and simply holds nothing this mode can read — rather than a red night.
    const floorList = file(
      "collect-floor-list.json",
      JSON.stringify([ghSettled(13, "2026-10-04T02:20:00Z", "2026-10-13T11:00:00Z")]),
    );
    const collectList = file(
      "collect-list.json",
      JSON.stringify([ghProposal(203, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z")]),
    );

    const wrongKind = run(["--settle-collect", "--settled", floorList, "--runbook", runbook]);
    expect(wrongKind.status, wrongKind.stderr).toBe(0);
    expect(wrongKind.stdout).toContain("nothing was answered since the last night");
    const otherWay = run(["--settle-floor", "--settled", collectList, "--runbook", runbook]);
    expect(otherWay.status, otherWay.stderr).toBe(0);
    expect(otherWay.stdout).toContain("nothing was answered since the last night");
    expect(readFileSync(runbook, "utf8")).toBe("# The runbook\n");

    // A list it cannot read is a usage error, named by the flag that was passed: the list is the whole
    // of what there is to record, so a night that cannot read it must not look like a night that owed
    // nothing.
    const noList = run(["--settle-collect", "--runbook", runbook]);
    expect(noList.status).toBe(2);
    expect(noList.stderr).toContain("--settle-collect needs --settled <path>");
    const junk = file("collect-junk.json", "not json");
    expect(run(["--settle-collect", "--settled", junk, "--runbook", runbook]).status).toBe(2);
    const notList = file("collect-object.json", "{}");
    const object = run(["--settle-collect", "--settled", notList, "--runbook", runbook]);
    expect(object.status).toBe(2);
    expect(object.stderr).toContain("does not hold a list of requests");
    // …while a runbook it cannot read is a failure: the record *is* that file, so "no record" is not a
    // pass, and nothing is left where that runbook would have been.
    const missing = run([
      "--settle-collect",
      "--settled",
      collectList,
      "--runbook",
      path.join(scratch, "collect-nothing-here.md"),
    ]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("the settlement is recorded *in* the runbook");
    expect(existsSync(path.join(scratch, "collect-nothing-here.md"))).toBe(false);
  });

  it("refuses an --output it cannot write, with the record itself already landed", () => {
    const runbook = file("collect-unwritable-runbook.md", "# The runbook\n");
    const settled = file(
      "collect-unwritable-settled.json",
      JSON.stringify([ghProposal(203, "2026-10-05T02:20:00Z", "2026-10-07T09:00:00Z")]),
    );

    const result = run([
      "--settle-collect",
      "--settled",
      settled,
      "--runbook",
      runbook,
      "--output",
      path.join(scratch, "no-such-dir", "collect-page.md"),
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot write");
    expect(readFileSync(runbook, "utf8")).toContain("#203: answered after 2 nights");
  });
});

/**
 * The night that opens it: `nightly.yml`'s own steps, held to the command above.
 *
 * The proposal is only ever reached through the workflow — nothing else runs `--propose-low-water`
 * — so the chain that has to hold is three claims that fail silently when they break: the trend
 * step exposes its verdict as a step output (a probe with no `id:` is a failure nothing can read),
 * the writer runs *because* that verdict was a failure and goes to the paths this module declares,
 * and the request is opened only after the pin has been checked over the tree the commit carries,
 * on the bot's own branch, from the body the writer rendered. The last case is about the file
 * GitHub actually runs: this directory's workflow is a mirror of the repository root's, and a
 * proposal the mirror does not carry is a proposal no night ever opens.
 */
describe("the nightly job's floor proposal", () => {
  /** One step's YAML block, found by its `name:`, so the pins read like the file does. */
  function stepBlock(name: string, source = nightlySource): string {
    const marker = `      - name: ${name}`;
    const start = source.indexOf(marker);
    expect(start, `the nightly job has no step named ${name}`).toBeGreaterThan(-1);
    const next = source.indexOf("\n      - name: ", start + marker.length);
    return source.slice(start, next === -1 ? source.length : next);
  }

  /**
   * A step that posts a comment: the name it is found by, the id the gate judges, its `--label`,
   * and the `--producer` its run-page notes blame.
   */
  type PosterStep = { name: string; id: string; label: string; producer: string };

  /**
   * Every step in the job whose script calls the poster, read out of the file.
   *
   * `stepBlock` finds a step whose name a case already knows, which is the half of this that cannot
   * see a step nobody wrote a case for: a sixth poster — or one whose `id:` a rename took away — is
   * exactly the shape every case above passes over, and each of these steps is `continue-on-error`,
   * which is what would keep that silence green. So the list is derived the way
   * `collect-budget.test.ts` derives `ci.yml`'s, and the case below is what holds the gate to it.
   *
   * The split is the boundary `stepBlock` uses, so a step's block here is the block a case reads:
   * the layout is one fact this relies on, and the workflows are pinned by content, so a reformat
   * that moved these would be an edit somebody made on purpose rather than a quiet escape.
   */
  function posterSteps(source = nightlySource): PosterStep[] {
    return source
      .split(/\n      - /)
      .slice(1)
      .filter((block) => block.includes("node .freebuff/pr-comment.mjs"))
      .map((block) => ({
        name: /^name: (.+)$/m.exec(block)?.[1] ?? "",
        id: /(?:^|\n)        id: (\S+)/.exec(block)?.[1] ?? "",
        label: /--label '([^']+)'/.exec(block)?.[1] ?? "",
        producer: /--producer '([^']+)'/.exec(block)?.[1] ?? "",
      }));
  }

  /** The branch the night's own step pushes to, named here so the cases read like the step does. */
  const BRANCH = "coverage/floor-proposal";
  /**
   * The steps this pass adds, in the order the job runs them — the last one being the gate that
   * turns a comment step's failure into a red job, which is why it is the job's last step.
   */
  const PROPOSAL_STEPS = [
    "Record the floor proposals that have been answered",
    "Record the collect-budget proposals that have been answered",
    "Check the coverage trend",
    "Propose the floors the records now derive",
    "Check the pin describes the tree the proposal will carry",
    "Open the floor proposal",
    "Comment the re-fired proposal on the pull request",
    "Comment the risen wait on the floor proposal",
    "Fail on a crossing line the records do not produce",
    // …and its poster, which is the second half of one pair rather than a step of its own: the mirror is
    // the copy GitHub runs, and a mirror that posted a *different* body — or posted it on a different
    // night — is the same failure one step later.
    "Comment the refuted record on the open request",
    // …and the two other steps that write into that same comment, which the mirror is held to for the
    // same reason: a night that retracted or ended on a copy whose step had drifted is one night later
    // than the divergence this list exists to catch, and `--update-only` means the wrong comment is
    // rewritten in place rather than a new one appearing.
    "Retract the refuted record that was repaired",
    "Comment the ending on the request that ended",
    "Fail when a comment this run owed was not posted",
  ];

  it("records what became of the answered proposals, in the runbook the night commits", () => {
    const step = stepBlock("Record the floor proposals that have been answered");

    // The list is GitHub's own, and it asks for **both** answers: a request dropped unmerged is a
    // settlement too, and `--state closed` would be this step deciding which answers count. The
    // requests still open carry no `closedAt` and are the module's to leave out.
    expect(step).toContain(`--head "${BRANCH}"`);
    expect(step).toContain("--state all");
    expect(step).toContain("--json number,createdAt,closedAt,mergedAt");
    expect(step).toContain("> .ci/floor-settlements.json");
    // …and the record is written by the module that counts the nights, into the file the runbook
    // gate reads: the path is the module's constant rather than a literal here.
    expect(step).toContain("node .freebuff/coverage-trend.mjs --settle-floor");
    expect(step).toContain("--settled .ci/floor-settlements.json");
    expect(step).toContain(`--runbook ${RUNBOOK_FILE}`);
    // …and the same section goes to the file the artifact carries: the run page is read once, so the
    // counts a later review is read against have to be a file the upload below keeps.
    expect(step).toContain("--output .ci/floor-settlements.md");
    // The finding the step can leave on the run: a median past the worst this history has held is
    // announced as a workflow command as well as on the page, and that is the only one of the two
    // channels that reaches somebody who is not reading the run. The assertion is on the *invocation* —
    // the mode, then the flag, then the inputs — because the whole word appears in the step's own comment
    // as well, and a step whose prose promised an annotation while its command never asked for one would
    // satisfy a check that only looked for the name.
    expect(step).toContain(
      "node .freebuff/coverage-trend.mjs --settle-floor \\\n            --github-annotations",
    );
    // A recording aid cannot flip the night's verdict — the doctrine the runner's own runbook write
    // follows — while the step's own failure still shows as the night the history stopped accruing.
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("if: always()");
    // It has to run *before* the commit-back, which is what carries the line to the branch — a record
    // left in the runner's checkout is the failure this whole step exists to prevent.
    const commit = stepBlock("Commit the coverage history");
    expect(nightlySource.indexOf(step)).toBeLessThan(nightlySource.indexOf(commit));
    expect(commit).toContain(`git add ${HISTORY_FILE} .freebuff/gate-hashes.mjs ${RUNBOOK_FILE}`);
    // The list GitHub answered with rides in the artifact, so a settlement line can be read back
    // against what the step was told — the record is only as good as the list it came from.
    expect(stepBlock("Upload the report")).toContain(".ci/floor-settlements.json");
    // The rendering rides in the same upload as the list it was rendered from, so the summary and
    // the raw answer it counts can always be read against each other.
    expect(stepBlock("Upload the report")).toContain(".ci/floor-settlements.md");
  });

  it("records what became of the collect-budget proposals too, in the same runbook", () => {
    const step = stepBlock("Record the collect-budget proposals that have been answered");

    // Every pull request rather than one head, because a collect proposal is posted wherever it was
    // earned — so there is no branch to filter by — and the list is asked for **newest-updated
    // first**: an old pull request somebody answered today is a pull request updated today, which is
    // what keeps it inside the window, while the default order walks back through creation dates and
    // drops exactly those. `--state all` for the floor step's reason: a request that closed with the
    // proposal unanswered settled it too, and asking for the closed ones alone would be this step
    // deciding which answers count.
    expect(step).toContain("gh pr list --state all --limit 50");
    expect(step).toContain(`--search "sort:updated-desc"`);
    expect(step).toContain("--json number,closedAt,comments");
    expect(step).not.toContain("--head");
    expect(step).toContain("> .ci/collect-settlements.json");
    // The reading is the module's — which comment on the request is the proposal and which is the
    // reply is not something a shell can see — and it records into the same runbook as the floor's,
    // with the same kind of section for the artifact to carry.
    expect(step).toContain("node .freebuff/coverage-trend.mjs --settle-collect");
    expect(step).toContain("--settled .ci/collect-settlements.json");
    expect(step).toContain(`--runbook ${RUNBOOK_FILE}`);
    expect(step).toContain("--output .ci/collect-settlements.md");
    // This kind's wait is watched on its own history, and a rise past the worst it has held is said as a
    // workflow command here too — the two steps are two kinds, not one finding reported twice — with the
    // flag on the invocation itself, for the floor step's reason.
    expect(step).toContain(
      "node .freebuff/coverage-trend.mjs --settle-collect \\\n            --github-annotations",
    );
    // A recording aid cannot flip the night's verdict, while its own failure still shows as the night
    // the history stopped accruing — and it runs *before* the commit-back, which is what carries the
    // line to the branch.
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("if: always()");
    const commit = stepBlock("Commit the coverage history");
    expect(nightlySource.indexOf(step)).toBeLessThan(nightlySource.indexOf(commit));
    // The raw list and the summary rendered from it ride in the artifact together, so a reviewer can
    // read a line back against what the step was told.
    expect(stepBlock("Upload the report")).toContain(".ci/collect-settlements.json");
    expect(stepBlock("Upload the report")).toContain(".ci/collect-settlements.md");
  });

  it("gives the trend step an id, so the night can answer the verdict it fails with", () => {
    const step = stepBlock("Check the coverage trend");

    expect(step).toContain("id: trend");
    expect(step).toContain("if: always()");
    // The answer is the step's own exit code, carried by hand past the summary; the step below
    // reads that failure rather than a file, which is the whole reason the id is needed.
    expect(step).toContain("exit $status");
  });

  it("proposes the floors on either red the floors can go stale under, to the paths the module declares", () => {
    const step = stepBlock("Propose the floors the records now derive");

    // Two reds ask this question and the step names both of them. The trend's verdict is one: a
    // reading stepped below the floor its records settled to. The gate's is the other, and it is
    // the one this case is about — the suite's byte comparison is where the night lands when a
    // record sits below the level the chart draws under its series while the *newest* record
    // cleared it (a dip an older night carried, a bullet committed by hand, a backfilled night),
    // which the trend's newest-record rule cannot see. A green answer has nothing to record and a
    // red about anything else records nothing either: the status below is what decides.
    expect(step).toContain("if: steps.gate.outcome == 'failure' || steps.trend.outcome == 'failure'");
    expect(step).toContain("node .freebuff/coverage-trend.mjs --propose-low-water");
    // The floor file the commit carries and the body the request is opened with are the module's
    // constants spelled out, so a rename moves both ends rather than leaving a step writing
    // somewhere the suite's ratchet is not watching.
    expect(step).toContain(`--file ${LOW_WATER_FILE}`);
    expect(step).toContain(`--output .ci/${path.basename(LOW_WATER_PROPOSAL_FILE)}`);
  });

  it("gives the two steps that can redden the ids the proposal step reads, in both files", () => {
    // `steps.x.outcome` for a step no file declares is empty, so a condition naming a missing id
    // stops the proposal silently — and it would do it in whichever copy is missing it, the mirror
    // being the one GitHub actually runs. Both reds are therefore asked for in both files.
    const mirrorPath = path.join(projectRoot, "..", ".github", "workflows", "nightly.yml");
    const sources = existsSync(mirrorPath)
      ? [nightlySource, readFileSync(mirrorPath, "utf8")]
      : [nightlySource];

    for (const source of sources) {
      expect(stepBlock("Run the full CI gate", source)).toContain("id: gate");
      expect(stepBlock("Check the coverage trend", source)).toContain("id: trend");
    }
  });

  it("checks the pin over the tree the commit will carry before anything is opened", () => {
    const verify = stepBlock("Check the pin describes the tree the proposal will carry");

    expect(verify).toContain("if: steps.propose-floor.outputs.changed == 'true'");
    expect(verify).toContain("node .freebuff/gate-drift.mjs");
    // The request the step below opens starts no workflows of its own (`GITHUB_TOKEN`-created
    // events do not), so this is the only place the pin is ever checked against that commit.
    const open = stepBlock("Open the floor proposal");
    expect(open).toContain(
      "if: steps.propose-floor.outputs.changed == 'true' && steps.verify-floor.outcome == 'success'",
    );
  });

  it("opens one request on the night's own branch, from the body the writer rendered", () => {
    const step = stepBlock("Open the floor proposal");

    expect(step).toContain(`branch="${BRANCH}"`);
    // The write, and the manifest beside it: the doctrine every commit in these workflows is held
    // to, and the reason the floor file is named with `coverage-low-water.json` and not `floor.json`.
    expect(step).toContain(`git add ${LOW_WATER_FILE} .freebuff/gate-hashes.mjs`);
    expect(step).toContain(`--body-file .ci/${path.basename(LOW_WATER_PROPOSAL_FILE)}`);
    expect(step).toContain("gh pr create");
    // One branch, kept current: a step down nobody merged is still a step down tomorrow, so the
    // second night edits the request it already has rather than opening a second one.
    expect(step).toContain("gh pr edit");
    // …and the push is leased to the head this run read, so a push that arrived in between — a
    // reviewer's own commit on that branch — is refused rather than overwritten.
    expect(step).toContain(`--force-with-lease="refs/heads/$branch:$lease"`);
    expect(step).toContain(`git ls-remote "$remote" "refs/heads/$branch"`);
  });

  it("renders the re-fired request's comment, and publishes the age the poster step needs", () => {
    const step = stepBlock("Open the floor proposal");

    // The age is the request's own. The branch cannot answer it: it is force-pushed every night, so
    // its commit always reads as tonight, and `createdAt` is the only place the first night survives.
    expect(step).toContain(`created=$(gh pr view "$number" --json createdAt --jq '.createdAt')`);
    expect(step).toContain("node .freebuff/coverage-trend.mjs --nudge");
    expect(step).toContain(`--number "$number"`);
    expect(step).toContain(`--created "$created"`);
    // …and the handle the escalation names, read from the run's own owner rather than written into a
    // workflow: a hard-coded person is one that stops being the right one, and a missing variable is
    // a night whose escalation names nobody.
    expect(step).toContain(`--owner "$GITHUB_REPOSITORY_OWNER"`);
    expect(step).toContain(`--output .ci/${path.basename(NUDGE_COMMENT_FILE)}`);
    // The step that opens the request reaches no comment, and the two facts the step after it needs
    // are published rather than recomputed: that the request re-fired at all — which is what keeps
    // that step `skipped` on the night the request is new, the state the gate passes — and how long
    // it has sat.
    expect(step).toContain('echo "refired=true" >> "$GITHUB_OUTPUT"');
    expect(step).toContain('echo "number=$number" >> "$GITHUB_OUTPUT"');
    expect(step).toContain('echo "created=$created" >> "$GITHUB_OUTPUT"');
    expect(step).toContain('echo "refired=false" >> "$GITHUB_OUTPUT"');
    expect(step).not.toContain("node .freebuff/pr-comment.mjs");
  });

  it("posts that comment in a step of its own, so losing it can fail the night", () => {
    const step = stepBlock("Comment the re-fired proposal on the pull request");

    // `continue-on-error` for the same reason every comment step in `ci.yml` has it: a lost comment
    // must not take the artifact uploads with it. The gate at the end of the job is what stops that
    // leaving the night green, and it can only read a step of its own — which is why the posting is
    // not done inside the step above.
    expect(step).toContain("id: comment-floor");
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("if: steps.open-floor.outputs.refired == 'true'");
    // The request it is about is read from the step that opened it, so the number is bound here
    // rather than known: a `PR:` that named another request would comment on the wrong one.
    expect(step).toContain("PR: ${{ steps.open-floor.outputs.number }}");
    // Posted through `.freebuff/pr-comment.mjs`, like every other comment these workflows leave, and
    // *fresh*: an edited comment notifies nobody, which is the whole of what the night adds.
    expect(step).toContain("node .freebuff/pr-comment.mjs");
    expect(step).toContain("--fresh");
    expect(step).toContain(`--body .ci/${path.basename(NUDGE_COMMENT_FILE)}`);
    expect(step).toContain("--label 'Floor proposal nudge'");
    expect(step).toContain("--producer 'Comment the re-fired proposal on the pull request'");
  });

  it("carries the risen wait to the request that is still open, in a step that can be skipped", () => {
    // The warning reaches the run page and the run's own annotations, and neither of those reaches an
    // inbox; a comment is the only channel this job has that can. It goes on the floor proposal that is
    // still open, and the step that can name it is the one that read GitHub's list — so the number
    // travels from there to the poster as an output, which is what the settle step's own id is for.
    const settle = stepBlock("Record the floor proposals that have been answered");
    const poster = stepBlock("Comment the risen wait on the floor proposal");

    expect(settle).toContain("id: settle-floor");
    expect(poster).toContain("if: steps.settle-floor.outputs.wait-request != ''");
    expect(poster).toContain("continue-on-error: true");
    // …and the condition is the point rather than a detail: the night a proposal is answered is usually
    // the night its branch stopped being open, so most risen waits have no request left to be said on.
    // An empty output *skips* the poster, which the gate at the end of the job passes — a step that ran
    // to post nothing would read as a comment this run owed and lost.
    expect(poster).toContain("PR: ${{ steps.settle-floor.outputs.wait-request }}");
    // Posted through the poster every other comment in these workflows goes through, and *fresh*: an
    // edited comment notifies nobody, which is the half of this that reaches a person.
    expect(poster).toContain("node .freebuff/pr-comment.mjs");
    expect(poster).toContain("--fresh");
    // The two steps are ordered rather than merely both present: the comment is rendered by the step that
    // computed the finding, and posted after it.
    expect(nightlySource.indexOf(settle)).toBeLessThan(nightlySource.indexOf(poster));
    // …and the label the poster reports under is the one the gate reads its outcome by, taken from that
    // label rather than written a second time, so a pair that drifted would fail here.
    const label = /--label '([^']+)'/.exec(poster)?.[1] ?? "";
    expect(label).toBe("Risen settled wait");
    expect(poster).toContain("--producer 'Comment the risen wait on the floor proposal'");
    expect(stepBlock("Fail when a comment this run owed was not posted")).toContain(
      '"' + label + '=${{ steps.comment-wait.outcome }}"',
    );
  });

  it("fails the night when that comment was owed and did not arrive", () => {
    const poster = stepBlock("Comment the re-fired proposal on the pull request");
    const gate = stepBlock("Fail when a comment this run owed was not posted");

    // One name for the loss, from the poster's own `--label` rather than a second literal: the gate
    // reports the missing comment under the label the step was given, so a pair that drifted would
    // send a reader looking for a comment nobody posted.
    const label = /--label '([^']+)'/.exec(poster)?.[1] ?? "";
    expect(label).toBe("Floor proposal nudge");
    expect(gate).toContain("node .freebuff/comment-gate.mjs");
    // The *step's* outcome, not the job's: `continue-on-error` is exactly what this exists to see
    // past, and `skipped` passes there because a night whose proposal did not change owed nothing.
    expect(gate).toContain('"' + label + '=${{ steps.comment-floor.outcome }}"');
    expect(gate).toContain("if: always()");
    // Last, so the artifact is uploaded before the verdict can fail the run.
    const uploadAt = nightlySource.indexOf("      - name: Upload the report");
    expect(uploadAt).toBeGreaterThan(-1);
    expect(nightlySource.indexOf(gate)).toBeGreaterThan(uploadAt);
    expect(uploadAt).toBeGreaterThan(nightlySource.indexOf(poster));
  });

  it("fails the night over the record each settle step both wrote and judged", () => {
    // The settlement section is a judgment as well as a page, and the step that renders it is the wrong
    // step to take a verdict on: it is `continue-on-error` so that a night still records, comments and
    // uploads whatever the record turns out to say. So the finding travels as the count the module
    // published and a step of its own reads it back — the division the comment channel has, with one
    // name fewer to keep in step, since what it reads is the module's own `wait-drift` output. The other
    // side of that pairing is asserted where the command runs: the settle case above reads
    // `wait-drift=1` back off the output file of a night whose record states a line these settlements do
    // not produce, and a `0` off one that holds a line they do.
    //
    // …and it is one verdict per *kind*, because a crossing is a level one series has been told about:
    // the collect record has a crossing of its own now, so its section has a refutation of its own, and
    // one shared count would let a refuted collect record pass on a floor night that held.
    const settle = stepBlock("Record the floor proposals that have been answered");
    const collect = stepBlock("Record the collect-budget proposals that have been answered");
    const verdict = stepBlock("Fail on a crossing line the records do not produce");

    expect(settle).toContain("id: settle-floor");
    expect(collect).toContain("id: settle-collect");
    expect(verdict).toContain("node .freebuff/wait-drift-gate.mjs");
    expect(verdict).toContain('"Settled-wait drift=${{ steps.settle-floor.outputs.wait-drift }}"');
    expect(verdict).toContain('"Collect-wait drift=${{ steps.settle-collect.outputs.wait-drift }}"');
    expect(verdict).toContain("if: always()");
    // The lines travel as a file of their own as well as a count, and the step that judges the count
    // quotes it: a verdict kept only on a run page is a verdict that rolls away with the run, while a
    // refuted crossing line is a finding about the runbook that somebody re-reads months later. One file
    // per kind, and the `--drift` that names it carries the label the count above it is announced under
    // — the pairing is by label, so the gate never has to trust the order the files were named in.
    expect(settle).toContain("--drift .ci/wait-drift-lines.md");
    expect(collect).toContain("--drift .ci/collect-wait-drift-lines.md");
    expect(verdict).toContain('--drift "Settled-wait drift=.ci/wait-drift-lines.md"');
    expect(verdict).toContain('--drift "Collect-wait drift=.ci/collect-wait-drift-lines.md"');
    expect(verdict).toContain("--record .ci/wait-drift.md");
    expect(verdict).toContain("--summary .ci/summary.md");
    // The lines travel as a *list* as well as a count, paired with their own record's label like
    // `--drift`, and the record of what has already been said travels beside them: the comment below is
    // said once per refuted line rather than every night the line stands, so the step that leaves it has
    // to know both which lines this night refutes and which of them a person has already been told about.
    expect(verdict).toContain(
      '--set "Settled-wait drift=${{ steps.settle-floor.outputs.wait-drift-set }}"',
    );
    expect(verdict).toContain(
      '--set "Collect-wait drift=${{ steps.settle-collect.outputs.wait-drift-set }}"',
    );
    expect(verdict).toContain("--runbook .freebuff/run.md");
    // The collect settle step is a recording aid like the floor one, so the red is the gate's and not
    // its own — asserted here because the second settle step is the one an edit could give a verdict to.
    expect(collect).toContain("continue-on-error: true");
    // …and the verdict is not the settle step's: a red there would mean the night's history stopped
    // accruing, which is a different fact from a record these settlements cannot produce. (The block
    // below this one *mentions* the keyword in its prose about the comment step's own outcome, so what
    // is asserted here is the setting rather than the word.)
    expect(settle).toContain("continue-on-error: true");
    expect(verdict).not.toContain("continue-on-error: true");
    // …and the verdict has an `id`, because a *comment* is owed on it: the record is a file in an artifact
    // and the annotation a line in a checks list, and neither reaches a person, while the repair this
    // finding asks for is an edit to the runbook by hand. `--comment` renders that body from the same
    // blocks the record quotes — off the same `renderWaitDrift` output the count is made from — and
    // `--request` is where that body goes on the night no comment stands yet; on every night after it, the
    // request is the one the standing comment is on, which the step reads out of the runbook.
    expect(verdict).toContain("id: wait-drift");
    expect(verdict).toContain("--comment .ci/wait-drift-repair.md");
    expect(verdict).toContain('--request "${{ steps.settle-floor.outputs.open-request }}"');
    // …and the *retraction* is rendered by the same step, off the same reading of the runbook: the night
    // the last line the comment named leaves the record, the comment is the only thing on the request
    // still saying the record is broken, and the note that answers it is composed where the comment's own
    // present state is known.
    expect(verdict).toContain("--retract .ci/wait-drift-retract.md");
    // …and the third body, the ending of a comment whose request has been answered: rendered by this same
    // step off the same reading of the runbook, because the fact it states — the record's own word and
    // date for the thread — is only known once the record has been read.
    expect(verdict).toContain("--end .ci/wait-drift-end.md");
    const poster = stepBlock("Comment the refuted record on the open request");
    // Gated on `reported` — the verdict step's own output, `true` only on a night it wrote a body to post.
    // Neither the count nor the outcome can stand in for it: a refuted record makes the night red on every
    // night it stands, including the nights the *comment* is already on the request, so the outcome is
    // `failure` where there is nothing to post — and a poster that ran to post nothing there is a loss
    // `comment-gate.mjs` reads, the value a night with nothing to say must have instead being `skipped`.
    // The request is not read back off the settle step either, because the body does not belong on the
    // request this night happens to have open: it belongs where the finding was first reported, which the
    // verdict step publishes for exactly that reason.
    expect(poster).toContain("if: steps.wait-drift.outputs.reported == 'true'");
    expect(poster).toContain("continue-on-error: true");
    expect(poster).toContain("PR: ${{ steps.wait-drift.outputs.comment-request }}");
    // Posted through the poster every other comment in these workflows goes through, and **marked rather
    // than fresh**: the body carries the marker the poster finds its previous comment by, so a record left
    // refuted for a week is one comment rewritten rather than seven posted — and a retraction is only a
    // single defined action if there is a single comment to rewrite. What `--fresh` would buy — the
    // notification the night's *other* record-level comment still posts one of, in its step above — is
    // what this pair trades away deliberately: the run page, the annotation and the artifact's record are
    // what say the finding every night it stands.
    expect(poster).toContain("node .freebuff/pr-comment.mjs");
    expect(poster).toContain(`--marker '${RECORD_COMMENT_MARKER}'`);
    expect(poster).not.toContain("--fresh");
    expect(poster).toContain("--body .ci/wait-drift-repair.md");
    expect(poster).toContain("--label 'Refuted settled-wait record'");
    expect(poster).toContain("--producer 'Comment the refuted record on the open request'");
    // …and the retraction, which is the same comment and the same marker arrived at from the other end: the
    // same step's `retract` output, empty on every night but the one that took the last line out, and
    // `--update-only` because a request that never carried the red owes nothing — a note about a repair
    // nobody was told about is noise, and the poster answers it green.
    const retraction = stepBlock("Retract the refuted record that was repaired");
    expect(retraction).toContain("if: steps.wait-drift.outputs.retract != ''");
    expect(retraction).toContain("PR: ${{ steps.wait-drift.outputs.retract }}");
    expect(retraction).toContain("node .freebuff/pr-comment.mjs");
    expect(retraction).toContain("--update-only");
    expect(retraction).toContain(`--marker '${RECORD_COMMENT_MARKER}'`);
    expect(retraction).toContain("--body .ci/wait-drift-retract.md");
    expect(retraction).toContain("--label 'Repaired settled-wait record'");
    expect(retraction).toContain("--producer 'Retract the refuted record that was repaired'");
    // …and `continue-on-error` like every comment here, because what fails the night is `comment-gate.mjs`
    // reading this step's outcome — a retraction that never arrived leaves the stale red this pair exists
    // to end, which is the one state the pair is here to make impossible.
    expect(retraction).toContain("continue-on-error: true");
    // …and the *ending*, which is the same comment and the same marker again from the other end of that
    // comment's life: `ended-request` names the request the comment stands on rather than the one this night
    // has open — the request somebody merged or dropped, where the red is the only thing still saying
    // anything — and it is published only on the night that wrote the body, so a night that owes no ending
    // skips this step rather than posting one it does not have. `--update-only` for the retraction's reason
    // and one more: the ending rewrites a comment this job left there, so a request that never carried the
    // mark has no red for it to explain and the poster answers that green.
    const ending = stepBlock("Comment the ending on the request that ended");
    expect(ending).toContain("if: steps.wait-drift.outputs.ended-request != ''");
    expect(ending).toContain("PR: ${{ steps.wait-drift.outputs.ended-request }}");
    expect(ending).toContain("node .freebuff/pr-comment.mjs");
    expect(ending).toContain("--update-only");
    expect(ending).toContain(`--marker '${RECORD_COMMENT_MARKER}'`);
    expect(ending).toContain("--body .ci/wait-drift-end.md");
    expect(ending).toContain("--label 'Ended settled-wait record'");
    expect(ending).toContain("--producer 'Comment the ending on the request that ended'");
    expect(ending).toContain("continue-on-error: true");
    // …and the labels the three steps report under are the ones the gate reads their outcomes by, taken from
    // the `--label` each step passes rather than written a second time, so a pair that drifted would fail
    // here — the rule the two comments above are held to. The `id` is read out of the step for the same
    // reason, and it is the sharper half of the pair: the gate names a step by that name, so an `id` renamed
    // with the gate left alone is a comment nothing would judge — the silence `continue-on-error` buys —
    // where a renamed label only sends a reader looking for a step nobody can find.
    const gate = stepBlock("Fail when a comment this run owed was not posted");
    const idOf = (step: string) => /(?:^|\n)        id: (\S+)/.exec(step)?.[1] ?? "";
    const label = /--label '([^']+)'/.exec(poster)?.[1] ?? "";
    expect(label).toBe("Refuted settled-wait record");
    expect(idOf(poster)).toBe("comment-wait-drift");
    expect(gate).toContain('"' + label + '=${{ steps.' + idOf(poster) + '.outcome }}"');
    const retractLabel = /--label '([^']+)'/.exec(retraction)?.[1] ?? "";
    expect(retractLabel).toBe("Repaired settled-wait record");
    expect(idOf(retraction)).toBe("retract-wait-drift");
    expect(gate).toContain('"' + retractLabel + '=${{ steps.' + idOf(retraction) + '.outcome }}"');
    const endLabel = /--label '([^']+)'/.exec(ending)?.[1] ?? "";
    expect(endLabel).toBe("Ended settled-wait record");
    expect(idOf(ending)).toBe("end-wait-drift");
    expect(gate).toContain('"' + endLabel + '=${{ steps.' + idOf(ending) + '.outcome }}"');
    // Ordered *before* the upload now, because the record it writes is a file the artifact carries and
    // an upload that ran first would ship a review summary without it — and the comment's own body and
    // redaction record ride in that same upload, so the poster sits before it too, while the gate that
    // judges the poster stays the job's last word. The upload is `if: always()`, so a red here does not
    // take the artifact with it; that is what the ordering buys rather than loses.
    const uploadAt = nightlySource.indexOf("      - name: Upload the report");
    expect(uploadAt).toBeGreaterThan(-1);
    expect(nightlySource.indexOf(verdict)).toBeLessThan(uploadAt);
    // …and *above the commit-back*, which is the ordering the dedupe needs rather than a preference: the
    // report line this step appends to the runbook is what keeps the next night from leaving the same
    // comment, and a line that never reached the branch would die with the runner and be said again
    // tomorrow. It sits after both settle steps for the reason the counts are theirs, and the commit
    // stages the runbook whether or not the verdict wrote into it.
    expect(nightlySource.indexOf(verdict)).toBeGreaterThan(nightlySource.indexOf(collect));
    expect(nightlySource.indexOf(verdict)).toBeLessThan(
      nightlySource.indexOf("      - name: Commit the coverage history"),
    );
    expect(nightlySource.indexOf(poster)).toBeLessThan(uploadAt);
    expect(nightlySource.indexOf(verdict)).toBeLessThan(nightlySource.indexOf(poster));
    // …and the retraction's own body and redaction record ride in that same upload, which is why it sits
    // above it too, and *after* the poster so a night that both reported a new line and lost an old one
    // writes the report into the comment before the note that says a line is gone.
    expect(nightlySource.indexOf(retraction)).toBeLessThan(uploadAt);
    expect(nightlySource.indexOf(retraction)).toBeGreaterThan(nightlySource.indexOf(poster));
    expect(nightlySource.indexOf(verdict)).toBeLessThan(
      nightlySource.indexOf("      - name: Fail when a comment this run owed was not posted"),
    );
    expect(nightlySource.indexOf(poster)).toBeLessThan(
      nightlySource.indexOf("      - name: Fail when a comment this run owed was not posted"),
    );
    expect(nightlySource.indexOf(retraction)).toBeLessThan(
      nightlySource.indexOf("      - name: Fail when a comment this run owed was not posted"),
    );
    // …and the ending's own pair rides in that same upload, *after* the retraction: both steps write into
    // one comment, and a night that lost an old line and ended a thread has to leave the note about the
    // line there before the ending that becomes the comment's last word — the order the runbook's own
    // lines are written in, and the reason a later night reads the ending as the comment's state.
    expect(nightlySource.indexOf(ending)).toBeLessThan(uploadAt);
    expect(nightlySource.indexOf(ending)).toBeGreaterThan(nightlySource.indexOf(retraction));
    expect(nightlySource.indexOf(ending)).toBeLessThan(
      nightlySource.indexOf("      - name: Fail when a comment this run owed was not posted"),
    );
  });

  it("judges every step in the job that posts a comment, counted from the file", () => {
    // The rule the cases above satisfy one pair at a time, put to the file as a whole. Each of them
    // reads a step it already knew the name of, so the shapes they cannot see are the ones that
    // matter here: a *sixth* poster, which is a comment nothing judges, and an entry in the gate for
    // a step that posts nothing any more, which is a label the run page would never show beside the
    // ones it would. `collect-budget.test.ts` holds `ci.yml` to the same rule; this is that rule over
    // the night's five, and the labels and ids below are the file's own rather than a second copy of
    // what the gate says — the gate is read *through* these, not compared to a hand-written list.
    // Both copies are read, because both are run: the project's is the canonical the suite reads and
    // the repository root's is the one GitHub actually reads, so a poster added to *either* alone is
    // a comment one of the two jobs judges and the other does not. The mirror is read the way the
    // other cases read it — there if it is there — and the two are held to the same list below.
    const mirrorPath = path.join(projectRoot, "..", ".github", "workflows", "nightly.yml");
    const sources: [string, string][] = existsSync(mirrorPath)
      ? [
          ["the night's own job", nightlySource],
          ["the mirror GitHub actually runs", readFileSync(mirrorPath, "utf8")],
        ]
      : [["the night's own job", nightlySource]];

    const steps = posterSteps();

    expect(steps.map((step) => step.id)).toEqual([
      "comment-wait-drift",
      "retract-wait-drift",
      "end-wait-drift",
      "comment-floor",
      "comment-wait",
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Refuted settled-wait record",
      "Repaired settled-wait record",
      "Ended settled-wait record",
      "Floor proposal nudge",
      "Risen settled wait",
    ]);

    const entryFor = (step: PosterStep) =>
      '"' + step.label + '=${{ steps.' + step.id + '.outcome }}"';

    for (const [which, source] of sources) {
      // The same five steps, in the same order, out of each copy: the two differ in their declared
      // mechanical deltas (the working directory, the artifact prefixes), and a comment step is not
      // one of them — a poster in one copy alone is a night whose behaviour depends on which file
      // is executed.
      const derived = posterSteps(source);
      expect(derived, `${which} posts its comments from other steps`).toEqual(steps);

      const gate = stepBlock("Fail when a comment this run owed was not posted", source);
      expect(source.indexOf(gate), `${which} has no verdict step`).toBeGreaterThan(-1);

      for (const step of derived) {
        // The three things a step has to carry to be judged at all: a name to be found by, an `id:`
        // the gate can read an outcome out of — `steps.<id>.outcome` for a step no file declares is
        // empty, so a rename that took the id and left the gate naming it is a comment nothing
        // judges — and the `--label` the poster reports under, which is the name the gate's own line
        // about the loss carries.
        expect(step.name, "a poster step with no name cannot be found").not.toBe("");
        expect(step.id, `${step.name} posts a comment and declares no id`).not.toBe("");
        expect(step.label, `${step.name} posts a comment and states no label`).not.toBe("");
        // …and it names *itself* as the producer: every note the poster writes says "The
        // '<producer>' step …" — the step that ran `gh`, the log to check — so a producer naming
        // the step that rendered the body would blame a log that never posted. Read out of the
        // step rather than restated, so a rename of either half fails here.
        expect(step.producer, `${step.name} states no producer`).not.toBe("");
        expect(step.producer, `${step.name} names another step as its producer`).toBe(step.name);
        expect(gate).toContain(entryFor(step));
        // …and judged *after* it ran: the gate reads a step's outcome, and a poster below it would
        // be a verdict about a step that had not run yet — judged nothing, or last night's file.
        expect(source.indexOf(gate)).toBeGreaterThan(source.indexOf(stepBlock(step.name, source)));
      }
      // …and counted rather than listed, which is the direction a list of expected pairs cannot
      // see: an entry left behind by a step that stopped posting comments is a sixth entry, and
      // nothing in the loop above reads the gate for entries it was not handed. The count holds the
      // gate to that copy's own posters in both directions — one missing and one extra.
      expect(gate.split("=${{ steps.").length - 1, `${which} has a pair too many`).toBe(
        derived.length,
      );
      // The invocation is spelled once, for the reason the pairs are counted: a second verdict step
      // would judge the same steps twice and disagree with itself on the night one of them was
      // skipped, while a step that ran to post nothing is read as a loss by the one that remains.
      expect(source.split("node .freebuff/comment-gate.mjs").length - 1).toBe(1);
    }
  });

  it.skipIf(!existsSync(path.join(projectRoot, "..", ".github", "workflows", "nightly.yml")))(
    "carries the night's verdict in both copies of the artifact list",
    () => {
      // The record is a file of this run like any other, which is why it rides in the same upload as the
      // summary it was appended to: a night read back from an artifact months later has to be able to say
      // what it *decided*, not only what its gate measured. The block it quotes is not uploaded beside it
      // — the record quotes the lines in full, and the settlement section states them in the artifact
      // already — so the file the two steps pass between them stays the machinery it is.
      const upload = stepBlock("Upload the report");
      expect(upload).toContain(".ci/wait-drift.md");
      expect(upload).not.toContain(".ci/wait-drift-lines.md");
      // …and the comment's own pair, which is a body and its redaction record rather than a second copy of
      // the record: `pr-comment.mjs` scrubs the body it posts and writes this record beside it, and the
      // record is only useful where the body is, so the two ride in one upload or the comparison the record
      // exists for cannot be made. The path is the poster's own derivation rather than a copy of it here.
      const repair = ".ci/wait-drift-repair.md";
      expect(upload).toContain(repair);
      expect(upload).toContain(recordPathFor(repair));
      // …and the retraction's pair beside them, for the same reason and its own: the note that says the
      // finding ended is a second body `pr-comment.mjs` scrubs, so its redaction record has to land where
      // that body is — a night read back from the artifact has to be able to compare the comment that
      // answered the red against the text it was written from, exactly as for the red itself.
      const retract = ".ci/wait-drift-retract.md";
      expect(upload).toContain(retract);
      expect(upload).toContain(recordPathFor(retract));
      // …and the ending's pair beside them, for the same reason and the more pointed one: the ending is
      // written into the very comment the red stands on, so the body and the text it was written from have
      // to be readable together a month later exactly as for the two above.
      const end = ".ci/wait-drift-end.md";
      expect(upload).toContain(end);
      expect(upload).toContain(recordPathFor(end));
      // …and the mirror, where the artifact list is spelled with the project prefix its header declares:
      // the prefix is read from the entry the two copies already share rather than written a second time
      // here, so a list that dropped one of these files fails in whichever copy dropped it.
      const mirror = readFileSync(
        path.join(projectRoot, "..", ".github", "workflows", "nightly.yml"),
        "utf8",
      );
      const listed = /^(\s*)(.+?)\/\.ci\/floor-settlements\.json$/m.exec(mirror);
      expect(listed?.[2], "the mirror names no prefixed settlement list").toBeTruthy();
      expect(mirror).toContain(`${listed?.[2]}/.ci/wait-drift.md`);
      expect(mirror).not.toContain(`${listed?.[2]}/.ci/wait-drift-lines.md`);
      expect(mirror).toContain(`${listed?.[2]}/${repair}`);
      expect(mirror).toContain(`${listed?.[2]}/${recordPathFor(repair)}`);
      expect(mirror).toContain(`${listed?.[2]}/${retract}`);
      expect(mirror).toContain(`${listed?.[2]}/${recordPathFor(retract)}`);
      expect(mirror).toContain(`${listed?.[2]}/${end}`);
      expect(mirror).toContain(`${listed?.[2]}/${recordPathFor(end)}`);
    },
  );

  it("names the one marker every comment step looks up, out of the module that renders the body", () => {
    // The gate renders the bodies and the three steps that write into that one comment find it by a marker,
    // so the literal is written once in the module and three times in the workflow — which is exactly the
    // shape that drifts: a body carrying one marker with a lookup matching another would post a second
    // comment every night while the suite passed, and the retraction or the ending would rewrite nothing at
    // all. So the three lookups are held to the export rather than to a copy of it, in both copies of the
    // workflow (all three are step blocks the mirror is compared on, so asserting it here holds the night
    // GitHub runs to it too).
    const poster = stepBlock("Comment the refuted record on the open request");
    const retraction = stepBlock("Retract the refuted record that was repaired");
    // …and the third step that looks the comment up, which is the same lookup arrived at from the far end
    // of the thread: the ending is written *into* that comment, so a marker this one stopped matching
    // would leave the ending to be posted as a second comment beside the red it was written to replace.
    const ending = stepBlock("Comment the ending on the request that ended");

    expect(poster).toContain(`--marker '${RECORD_COMMENT_MARKER}'`);
    expect(retraction).toContain(`--marker '${RECORD_COMMENT_MARKER}'`);
    expect(ending).toContain(`--marker '${RECORD_COMMENT_MARKER}'`);
  });

  it("carries the night's comment and its record in the artifact the proposal rides in", () => {
    // The poster writes the redaction record beside the body it scrubbed, and it is only useful
    // where the raw text is: the two have to land in one upload or the comparison the record exists
    // for cannot be made. The path comes from the poster's own function, so a rename moves this
    // check with it rather than leaving a hand-copied path to rot.
    const body = `.ci/${path.basename(NUDGE_COMMENT_FILE)}`;
    const upload = stepBlock("Upload the report");

    expect(upload).toContain(body);
    expect(upload).toContain(recordPathFor(body));
    // …and the file it uploads is the one the step rendered and the poster read.
    expect(stepBlock("Open the floor proposal")).toContain(body);

    // …and the same pair for the *other* comment a night can leave, which is a second body and a
    // second record rather than the same file twice: a night that carried only one of the two pairs
    // would leave that comment's redactions unreadable beside the text they map onto. The body is the
    // module's own path for the finding, named on both ends — the step that renders it into the file
    // and the step that posts that file — so a rename moves them together.
    const waitBody = `.ci/${path.basename(WAIT_COMMENT_FILE)}`;
    expect(upload).toContain(waitBody);
    expect(upload).toContain(recordPathFor(waitBody));
    expect(stepBlock("Record the floor proposals that have been answered")).toContain(
      `--comment ${waitBody}`,
    );
    expect(stepBlock("Comment the risen wait on the floor proposal")).toContain(`--body ${waitBody}`);
  });

  it("holds the permission the request needs, and carries the proposal with the run's report", () => {
    // The job the commit-back already gave `contents: write` is the same one, so the two
    // permissions are scoped together and the workflow's own default stays `contents: read`.
    expect(nightlySource).toContain("      pull-requests: write");
    expect(nightlySource).toContain("    permissions:\n      contents: write\n");
    expect(nightlySource).toContain("permissions:\n  contents: read");
    // The proposal rides with the report artifact, so a night's request can be read back from the
    // run that opened it even after the branch is gone.
    expect(stepBlock("Upload the report")).toContain(
      `.ci/${path.basename(LOW_WATER_PROPOSAL_FILE)}`,
    );
  });

  it.skipIf(!existsSync(path.join(projectRoot, "..", ".github", "workflows", "nightly.yml")))(
    "carries the same four steps in the mirror GitHub actually reads",
    () => {
      // GitHub reads `.github/workflows` at the *repository root*, and this directory's workflow is
      // a mirror of it — the pin holds both, and the mirror's own header lists the mechanical deltas
      // it is allowed. None of them touch these four steps, so they are held byte for byte: a night
      // that opens a proposal has to be the night that runs, not only the copy the suite reads.
      const mirror = readFileSync(
        path.join(projectRoot, "..", ".github", "workflows", "nightly.yml"),
        "utf8",
      );

      for (const name of PROPOSAL_STEPS) {
        expect(stepBlock(name, mirror), `${name} differs in the mirror`).toBe(stepBlock(name));
      }
      expect(mirror).toContain("      pull-requests: write");
      // The night's comment is a file of this run like any other, so the mirror's artifact list
      // names it too — under its own path prefix, which is one of the mechanical deltas the
      // mirror's header declares.
      expect(mirror).toContain(path.basename(NUDGE_COMMENT_FILE));
      // The artifact list is where the two copies are spelled differently — the mirror's paths carry
      // the project prefix its header declares — and that prefix is read from the entry the two copies
      // already share rather than written here. The summary is then required *beside* it: a basename
      // assertion would be satisfied by the step's own `--output` and would not notice the upload that
      // dropped the file, which is the half of this the artifact exists for.
      const listed = /^(\s*)(.+?)\/\.ci\/floor-settlements\.json$/m.exec(mirror);
      expect(listed?.[2], "the mirror names no prefixed settlement list").toBeTruthy();
      expect(mirror).toContain(`${listed?.[2]}/.ci/floor-settlements.md`);
      // …and the wait comment's pair, under the same prefix: the mirror's artifact list is where the
      // two copies are spelled differently, so the prefix is the one the entries they share already
      // carry rather than a second literal here.
      expect(mirror).toContain(`${listed?.[2]}/.ci/${path.basename(WAIT_COMMENT_FILE)}`);
      expect(mirror).toContain(`${listed?.[2]}/.ci/${path.basename(recordPathFor(WAIT_COMMENT_FILE))}`);
      // …and the same pair for the other kind's record, whose files are its own: the two steps write
      // two lists and two summaries, and an upload that carried one kind's pair alone would leave a
      // night's collect settlements unreadable a month later.
      const listedCollect = /^(\s*)(.+?)\/\.ci\/collect-settlements\.json$/m.exec(mirror);
      expect(listedCollect?.[2], "the mirror names no prefixed collect-settlement list").toBeTruthy();
      expect(mirror).toContain(`${listedCollect?.[2]}/.ci/collect-settlements.md`);
      expect(mirror).toContain("--fresh");
    },
  );
});
