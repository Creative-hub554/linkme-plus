import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_REPORT_FILE } from "../../.freebuff/collect-run.mjs";
// The marker the rendered summary opens with and the path it is written to, both from
// the renderer itself: the workflow greps for the first and hands the second to `gh` as
// the comment body, so the poster and the renderer share both names rather than each
// holding a literal that only happens to match.
import { REPORT_PATH, SUMMARY_MARKER } from "../../.freebuff/collect-gates.mjs";
// The reporter's own boundary builder, so the crafted report carries a boundary the
// gate would really draw rather than one invented for the test.
import { importStaleThresholds } from "@/test/collect-budget";

// The committed baselines, as values: the summary must report *these*, and the
// expectations are computed from the file rather than written down here, so the
// test moves with the numbers instead of pinning a second copy of them.
import {
  importBaselines,
  importMarginMs,
  softThreshold,
} from "../../.freebuff/collect-budget-baselines.mjs";

/**
 * The collect-budget gates summary, as published.
 *
 * `.freebuff/collect-gates.mjs` exists so the recorded gates are legible on the
 * build page rather than only inside `.freebuff/collect-budget-baselines.mjs`:
 * without it a hit of the hard gate is a surprise, and a quiet tightening is
 * invisible. So the claims worth checking are that the section carries every
 * recorded number and the budget each one implies, and that it actually lands in
 * `$GITHUB_STEP_SUMMARY` — the run page, which is the whole point of the script.
 *
 * The values are read from the baselines module at test time, and the expected
 * amount is derived from them (`recorded + margin`), so this checks the summary's
 * *arithmetic and wiring* rather than re-asserting today's numbers. The script runs
 * from a temp directory, which keeps the `.freebuff/collect-gates.md` it writes off
 * the real one; it reads the baselines by import, not by path, so the copy it
 * reports is still the committed one.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(projectRoot, ".freebuff", "collect-gates.mjs");

/** One run of the script: how it exited, and the three places its output landed. */
type Rendered = { status: number; markdown: string; summary: string; report: string };

/** The recorded gates as a plain map, so a loop can index them by module. */
const recorded: Readonly<Record<string, number>> = importBaselines;

let dir: string;
let rendered: Rendered;
// The same section rendered in a job that also left the reporter's run report: the
// summary reads that file for this run's measurements, so its columns are what the
// gap between recorded and paid is published from.
let measured: Rendered;
// A run whose tightest file is *at or past* the recorded band, which is the other
// direction the band's headroom can point.
let overBand: Rendered;
// The same section for a run the reporter found loose: the verdict rides in the
// report's `stale` list, and the summary has to carry it onto the row it judged.
let loose: Rendered;
// A run whose tightest file never reached the judged floor, so the band has no
// boundary to be shown against.
let unjudged: Rendered;

/** The costs the crafted report claims this run measured, keyed by module. */
const MEASURED: Readonly<Record<string, number>> = Object.fromEntries(
  Object.keys(recorded).map((tracked) => [tracked, recorded[tracked] - 0.9]),
);

/** The boundary the reporter would draw for those costs, as the report carries it. */
const STALE_ABOVE: Readonly<Record<string, number>> = importStaleThresholds(MEASURED);

/** The tightest file the crafted report claims this run measured, as a fraction. */
const TIGHTEST = 0.46;

/** The headroom the reporter's rule calls the band loose past, as a fraction. */
const STALE_PAST = 0.35;

/** The tightest file a run must reach before the band is judged, as a fraction. */
const JUDGED_FROM = 0.3;

/**
 * The verdicts the reporter would have written for that run: one tracked import it
 * found looser than recorded, and the warning band it found warning far later than a
 * tightest file of 0.3 needs. Every entry is the shape `parseRunReport` accepts.
 */
const LOOSE = [
  { kind: "import", name: "src/test/module-index.ts", recorded: 20, measured: 2.5 },
  { kind: "band", name: "softThreshold", recorded: softThreshold, measured: 0.3 },
];

// Five sequential spawns of the real reporter — one per rendered shape — at ~1–2s of
// node start-up each on a quiet box, and every case in both suites reads the shared
// result. The default 5s hook budget is a quiet-box number: under full-suite load this
// fixture has already timed out and red three cases at once, each green solo on re-run.
// The fixtures hold facts, not speed, so the budget is the spawn count, not the
// machine's best day — the same shared-box reasoning as ci-runner's 120s precedent.
beforeAll(
  () => {
    dir = mkdtempSync(path.join(tmpdir(), "collect-gates-"));
    rendered = render();
    measured = render(MEASURED);
    overBand = render(MEASURED, 0.9);
    loose = render(MEASURED, 0.3, LOOSE);
    unjudged = render(MEASURED, 0.1);
  },
  120_000,
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the report from the temp directory, capturing the step summary it appends.
 *
 * `measurement` is written where the reporter would leave it — `.freebuff/` beside
 * the run — so the measured columns have something real to read; without it the
 * directory holds no report, which is the standalone case.
 */
function render(
  measurement: Readonly<Record<string, number>> | null = null,
  tightest: number = TIGHTEST,
  stale: ReadonlyArray<{ kind: string; name: string; recorded: number; measured: number }> = [],
): Rendered {
  const reportPath = path.join(dir, ".freebuff", RUN_REPORT_FILE);
  mkdirSync(path.dirname(reportPath), { recursive: true });
  if (measurement === null) {
    rmSync(reportPath, { force: true });
  } else {
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          runs: 1,
          samples: 1,
          measured: measurement,
          importStaleAbove: STALE_ABOVE,
          tightest,
          staleBandHeadroom: STALE_PAST,
          bandJudgedFrom: JUDGED_FROM,
          stale,
        },
        null,
        2,
      )}\n`,
    );
  }
  const summaryFile = path.join(dir, "step-summary.md");
  const run = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    // Blanked like the coverage report's own test: the identity line is noise here.
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_SHA: "",
      GITHUB_REF_NAME: "",
      GITHUB_RUN_ID: "",
      GITHUB_REPOSITORY: "",
    },
  });
  if (run.error) throw run.error;
  let summary = "";
  try {
    summary = readFileSync(summaryFile, "utf8");
  } catch {
    // No summary file at all is a real failure, but it is reported by the
    // assertion below rather than as an error out of `beforeAll`.
  }
  // The file the script wrote, read back at the very path it declares — and the one
  // the workflow posts. A run that wrote somewhere else leaves nothing to read here,
  // which the assertion below reports rather than swallowing.
  let report = "";
  try {
    report = readFileSync(path.join(dir, REPORT_PATH), "utf8");
  } catch {
    // Absent is a real failure, asserted below rather than thrown out of `beforeAll`.
  }
  return {
    status: run.status ?? -1,
    markdown: `${run.stdout ?? ""}${run.stderr ?? ""}`,
    summary,
    report,
  };
}

/** The rendered table row for a tracked module, so an assertion is about that row. */
function row(markdown: string, tracked: string): string {
  return markdown.split("\n").find((line) => line.startsWith(`| \`${tracked}\` `)) ?? "";
}

/** The rendered warning-band row, so an assertion is about that one row. */
function bandRow(markdown: string): string {
  return markdown.split("\n").find((line) => line.startsWith("| `soft threshold` ")) ?? "";
}

describe("the collect-budget gates summary", () => {
  it("prints the section and exits clean", () => {
    expect(rendered.status).toBe(0);
    expect(rendered.markdown).toContain("## Collect budget");
  });

  it("shows each recorded import beside the budget it is enforced at", () => {
    // The enforced number is the one the reporter actually applies — recorded cost
    // plus the margin — so the row is a display of the gate, not just the baseline.
    expect(Object.keys(recorded).length).toBeGreaterThan(0);
    for (const tracked of Object.keys(recorded)) {
      const line = row(rendered.markdown, tracked);
      expect(line, `no row for ${tracked}`).not.toBe("");
      expect(line).toContain(`${recorded[tracked]}ms`);
      expect(line).toContain(`${recorded[tracked] + importMarginMs}ms`);
      expect(line).toContain(`${importMarginMs}ms`);
    }
  });

  it("shows the recorded soft threshold as the band a file warns at", () => {
    const percent = `${(softThreshold * 100).toFixed(0)}%`;
    expect(rendered.markdown).toContain(`**Soft threshold — ${percent}.**`);
  });

  it("lands in the run summary, not only on stdout", () => {
    // The coverage table is published the same way; a gate summary that only
    // reached the log would be the problem this script exists to fix.
    expect(rendered.summary).toContain("## Collect budget");
    expect(rendered.summary).toContain(`${(softThreshold * 100).toFixed(0)}%`);
  });

  it("names the file the values are recorded in, so the gate can be traced", () => {
    expect(rendered.markdown).toContain(".freebuff/collect-budget-baselines.mjs");
  });

  it("opens with the marker the workflow greps to update its comment in place", () => {
    // Posted as a pull-request comment, the summary updates the comment it posted
    // last time by this marker; a rename on one side without the other would stack a
    // new comment on every run instead. The job summary carries the same text.
    expect(rendered.markdown).toContain(SUMMARY_MARKER);
    expect(rendered.summary).toContain(SUMMARY_MARKER);
  });

  it("writes the report to the path the workflow posts as the comment body", () => {
    // The comment step hands `gh` this file — the path is the renderer's own
    // `REPORT_PATH`, which the workflow names in a variable and the test pins there —
    // so the file it names has to be the one written here, or the comment would carry a
    // stale body (or be skipped) while every table above stayed right. Pinned at this
    // end by reading the very path back with the run's own marker; the poster's side is
    // pinned where the workflow is read as source.
    expect(rendered.report).toContain(SUMMARY_MARKER);
    expect(rendered.report).toContain("## Collect budget");
    // The same section the run printed, not a stub or an empty file: the artifact and
    // the comment both carry these bytes.
    expect(rendered.markdown.startsWith(rendered.report)).toBe(true);
  });
});

describe("the collect-budget gates summary's measured columns", () => {
  it("publishes this run's measurement beside what is recorded", () => {
    // The recorded number alone cannot say whether a gate is loose or the tree is
    // close to it; the pair does, and it is on the build page on a green run — the
    // one time nobody is reading the gate.
    expect(measured.status).toBe(0);
    expect(measured.markdown).toContain(
      "| tracked import | recorded | + margin | enforced | this run | gap | stale above |",
    );
    for (const tracked of Object.keys(recorded)) {
      const line = row(measured.markdown, tracked);
      expect(line).toContain(`${recorded[tracked]}ms`);
      expect(line).toContain(`${MEASURED[tracked].toFixed(1)}ms`);
      // Every crafted measurement is 0.9ms under its recorded mark, so the gap is
      // negative — the direction that says the ratchet could tighten further.
      expect(line).toContain("-0.9ms");
    }
    expect(measured.summary).toContain("this run");
  });

  it("shows the warning band's headroom against the tightest file this run measured", () => {
    // The import rows pair a recorded value with what the tree paid; the band is the
    // other half of the gate, and pairing it the same way is what makes a *green* run
    // show the room it still has in both halves rather than only the imports.
    expect(measured.markdown).toContain("| warning band | recorded | this run | headroom |");
    const line = bandRow(measured.markdown);
    const points = Math.round((softThreshold - TIGHTEST) * 100);
    expect(line).toContain(`${(softThreshold * 100).toFixed(0)}%`);
    expect(line).toContain(`${(TIGHTEST * 100).toFixed(0)}%`);
    expect(line).toContain(`${Math.abs(points)} pts`);
  });

  it("shows the cost each recorded baseline would be called stale past", () => {
    // The import half of the same shape the band row carries: the boundary the gate
    // draws, read from the report so the number a reader compares a baseline against
    // is the one that judged it — 4× a 3.1ms measurement, and the floor under it.
    const moduleIndex = row(measured.markdown, "src/test/module-index.ts");
    const sourceScan = row(measured.markdown, "src/test/source-scan.ts");
    expect(moduleIndex).toContain(`${STALE_ABOVE["src/test/module-index.ts"].toFixed(1)}ms`);
    expect(sourceScan).toContain(`${STALE_ABOVE["src/test/source-scan.ts"]}ms`);
  });

  it("shows the headroom the band is called stale past, read from the gate's report", () => {
    // The boundary is the reporter's rule, not the summary's arithmetic: it comes out
    // of the run report so the number a reader compares a headroom against is the one
    // the gate enforces, rather than a second copy of it that could drift.
    expect(measured.markdown).toContain(
      "| warning band | recorded | this run | headroom | stale past |",
    );
    expect(bandRow(measured.markdown)).toContain(`${Math.round(STALE_PAST * 100)} pts`);
    expect(measured.summary).toContain("stale past");
  });

  it("says a run was not judged rather than showing a boundary it never reached", () => {
    // The band is only judged against a run near its budget, so a run far from one
    // gets the word where the boundary would be — the reporter's floor, not a
    // boundary this run had any chance to cross.
    expect(bandRow(unjudged.markdown)).toContain("not judged");
    expect(bandRow(measured.markdown)).toContain(`${Math.round(STALE_PAST * 100)} pts`);
    expect(bandRow(measured.markdown)).not.toContain("not judged");
  });

  it("shows a negative headroom once a file is at or past the band", () => {
    // The sign is the point: a file under the band is room the ratchet could take
    // back by warning earlier, and one at or over it is the band doing its job while
    // the run stays green.
    const points = Math.round((softThreshold - 0.9) * 100);
    expect(points).toBeLessThan(0);
    expect(bandRow(overBand.markdown)).toContain(`-${Math.abs(points)} pts`);
  });

  it("still shows the recorded band, without a run's half, when there is no report", () => {
    // The band's recorded value is a baseline; it renders whether or not a run
    // measured anything, and the missing half is named rather than shown blank.
    expect(rendered.markdown).toContain("| warning band | recorded |");
    expect(rendered.markdown).not.toContain("headroom");
    expect(rendered.markdown).not.toContain("stale past");
    expect(rendered.markdown).not.toContain("stale above");
    expect(rendered.markdown).not.toContain("⚠");
    expect(bandRow(rendered.markdown)).toContain(`${(softThreshold * 100).toFixed(0)}%`);
  });

  it("marks a gate the reporter found loose, beside the number it was reached from", () => {
    // The summary is published on a *green* run, where the headroom alone cannot
    // say the band has stopped warning anyone. The reporter's verdict is already in
    // the report, so the row it judged carries it rather than the summary re-deciding.
    expect(loose.markdown).toContain("| warning band | recorded | this run | headroom |");
    expect(bandRow(loose.markdown)).toContain("⚠");
    expect(row(loose.markdown, "src/test/module-index.ts")).toContain("⚠");
    // Only the gate the reporter flagged: the one that held stays a plain number.
    expect(row(loose.markdown, "src/test/source-scan.ts")).not.toContain("⚠");
    expect(loose.markdown).toContain("marks a gate the reporter found looser");
  });

  it("leaves the rows unmarked, and the mark unexplained, when nothing was loose", () => {
    // A mark on every row would be noise, and a mark explained but never shown is a
    // footnote to nothing.
    expect(measured.markdown).not.toContain("⚠");
    expect(measured.markdown).not.toContain("found looser");
  });

  it("says so rather than showing a blank when the job left no run report", () => {
    // The script also runs on its own (and in these tests), where there is nothing
    // measured to show. The recorded columns must still render, and the missing half
    // must be named — a zero or a blank would read as a real measurement.
    expect(rendered.markdown).toContain("| tracked import | recorded | + margin | enforced |");
    expect(rendered.markdown).not.toContain("this run | gap |");
    expect(rendered.markdown).toContain("No run report in this job");
    for (const tracked of Object.keys(recorded)) {
      expect(row(rendered.markdown, tracked)).toContain(`${recorded[tracked]}ms`);
    }
  });
});
