import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUN_REPORT_FILE,
  parseRunReport,
  staleGateDetails,
} from "../../.freebuff/collect-run.mjs";

/**
 * The collect run report: what a run measured, and what the staleness gate does
 * with the recorded values it found loose.
 *
 * The reporter only *suspects* a loose gate on one run — one reading is one noisy
 * sample of a wall-clock quantity — so the reporter annotates it and moves on, and
 * `npm run collect:stale` is what fails, and only when every run of the session
 * agreed. These tests drive the real script with crafted reports, because the two
 * things worth checking are properties of the *decision*: that a clean report
 * passes, that a confirmed one fails, and that anything the script cannot trust —
 * absent, malformed, or from a session that came up short — fails closed rather
 * than reading as "nothing is stale".
 *
 * The script resolves the report from its working directory — the same convention
 * the reporter writes it by — so the tests run it against a temp directory and a
 * report of their own. That keeps them off the real `.freebuff/` file, which any
 * concurrent suite run in this checkout is also rewriting.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(projectRoot, ".freebuff", "gate-collect-baselines.mjs");

let workdir: string;
let reportPath: string;

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collect-run-"));
  mkdirSync(path.join(workdir, ".freebuff"), { recursive: true });
  reportPath = path.join(workdir, ".freebuff", RUN_REPORT_FILE);
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** A loose import baseline, as the reporter would record it. */
const LOOSE = { kind: "import", name: "src/test/module-index.ts", recorded: 40, measured: 3 };

/** A loose warning band: a fraction of a budget, not milliseconds. */
const LOOSE_BAND = { kind: "band", name: "softThreshold", recorded: 0.9, measured: 0.2 };

/** The measured costs a single full run left, keyed by tracked module. */
const MEASURED = { "src/test/module-index.ts": 3.1, "src/test/source-scan.ts": 2 };

/** The per-import boundary the reporter's rule draws for those costs, in ms. */
const STALE_ABOVE = { "src/test/module-index.ts": 12.4, "src/test/source-scan.ts": 10 };

/** The tightest file a full run measured, as a fraction of its collect budget. */
const TIGHTEST = 0.46;

/** The headroom the reporter's own rule calls the band loose past, as a fraction. */
const BAND_HEADROOM = 0.35;

/** The tightest file a run must reach before the band is judged, as a fraction. */
const JUDGED_FROM = 0.3;

/** The report JSON the reporter writes for a session. */
function reportText(
  runs: number,
  samples: number,
  stale: ReadonlyArray<{ kind: string; name: string; recorded: number; measured: number }>,
  measured: Readonly<Record<string, number>> = MEASURED,
  tightest: number = TIGHTEST,
): string {
  return `${JSON.stringify(
    {
      runs,
      samples,
      measured,
      importStaleAbove: STALE_ABOVE,
      tightest,
      staleBandHeadroom: BAND_HEADROOM,
      bandJudgedFrom: JUDGED_FROM,
      stale,
    },
    null,
    2,
  )}\n`;
}

/** Run the gate over a report, or with none at all when `content` is null. */
function gate(content: string | null): { status: number; output: string } {
  if (content === null) rmSync(reportPath, { force: true });
  else writeFileSync(reportPath, content);
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: workdir, encoding: "utf8" });
  if (run.error) throw run.error;
  return { status: run.status ?? -1, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

describe("the collect run report", () => {
  it("round-trips the values a session left", () => {
    expect(parseRunReport(reportText(3, 3, [LOOSE, LOOSE_BAND]))).toEqual({
      runs: 3,
      samples: 3,
      measured: MEASURED,
      importStaleAbove: STALE_ABOVE,
      tightest: TIGHTEST,
      staleBandHeadroom: BAND_HEADROOM,
      bandJudgedFrom: JUDGED_FROM,
      stale: [LOOSE, LOOSE_BAND],
    });
  });

  it("is null for anything that is not a well-formed report", () => {
    // Every failure is one answer, because the caller is only deciding whether to
    // fail a build — and a malformed report must never be read as "clean".
    expect(parseRunReport(undefined)).toBeNull();
    expect(parseRunReport("not json")).toBeNull();
    expect(parseRunReport("[]")).toBeNull();
    expect(parseRunReport(reportText(0, 0, []))).toBeNull();
    expect(parseRunReport(reportText(3, -1, []))).toBeNull();
    expect(parseRunReport('{"runs":3,"samples":3,"stale":[]}')).toBeNull();

    // One well-formed body, one field changed, so each case names the part it holds
    // rather than restating the whole shape beside it.
    const good = JSON.parse(reportText(3, 3, [])) as Record<string, unknown>;
    const without = (field: string): string => {
      const copy = { ...good };
      delete copy[field];
      return JSON.stringify(copy);
    };
    const setting = (field: string, value: unknown): string =>
      JSON.stringify({ ...good, [field]: value });

    // Every number the summary reads: a blank where any of them belongs is as
    // untrustworthy as a missing cost map, and just as likely to read as "clean".
    for (const field of [
      "measured",
      "importStaleAbove",
      "tightest",
      "staleBandHeadroom",
      "bandJudgedFrom",
      "stale",
    ]) {
      expect(parseRunReport(without(field)), `missing ${field}`).toBeNull();
    }
    expect(parseRunReport(setting("measured", { a: -1 }))).toBeNull();
    expect(parseRunReport(setting("importStaleAbove", { a: -1 }))).toBeNull();
    expect(parseRunReport(setting("importStaleAbove", []))).toBeNull();
    expect(parseRunReport(setting("tightest", -0.1))).toBeNull();
    expect(parseRunReport(setting("tightest", "wide"))).toBeNull();
    expect(parseRunReport(setting("staleBandHeadroom", -0.1))).toBeNull();
    expect(parseRunReport(setting("staleBandHeadroom", "wide"))).toBeNull();
    expect(parseRunReport(setting("bandJudgedFrom", -1))).toBeNull();
    expect(parseRunReport(setting("bandJudgedFrom", "wide"))).toBeNull();
    expect(parseRunReport(setting("stale", [{}]))).toBeNull();
    expect(
      parseRunReport(setting("stale", [{ kind: "band", name: "b", recorded: 1 }])),
    ).toBeNull();
  });

  it("rejects an entry whose kind names nothing the parent can act on", () => {
    // A kind the readers do not know is a report written by something newer or
    // corrupted; either way its units are unknown, so it must not be trusted.
    expect(
      parseRunReport(
        `{"runs":3,"samples":3,"measured":{},"importStaleAbove":{},"tightest":0.5,"staleBandHeadroom":0.35,"bandJudgedFrom":0.3,"stale":[${JSON.stringify({ ...LOOSE, kind: "collect" })}]}`,
      ),
    ).toBeNull();
  });

  it("earns a WARN annotation, not an error, for the single-run reader", () => {
    // `ci.mjs` reads the same report on a lone run, where it may only annotate.
    const [import_, band] = staleGateDetails([LOOSE, LOOSE_BAND]);
    expect(import_.mark).toBe("WARN");
    expect(import_.name).toBe(LOOSE.name);
    expect(import_.detail).toContain("recorded 40ms");
    expect(import_.detail).toContain("measured 3ms");
    expect(import_.location).toEqual({ file: LOOSE.name });
    // The band is a fraction, so its line is a percentage — and it belongs to no
    // test file, so there is nothing to point an annotation at.
    expect(band.name).toBe(LOOSE_BAND.name);
    expect(band.detail).toContain("recorded 90% of a collect budget");
    expect(band.detail).toContain("used only 20%");
    expect(band.location).toBeUndefined();
  });

  it("tolerates the absence of entries, so a clean run annotates nothing", () => {
    expect(staleGateDetails(undefined)).toEqual([]);
    expect(staleGateDetails([])).toEqual([]);
  });
});

describe("the staleness gate step", () => {
  it("passes when the session found nothing loose", () => {
    const result = gate(reportText(3, 3, []));
    expect(result.status).toBe(0);
    expect(result.output).toContain("no gate is looser than the tree needs");
  });

  it("fails when every run of the session agreed a baseline is loose", () => {
    const result = gate(reportText(3, 3, [LOOSE]));
    expect(result.status).toBe(1);
    expect(result.output).toContain("loose against every one of 3 run(s)");
    expect(result.output).toContain(LOOSE.name);
    // And it names the fix, which is the same approve-and-apply flow a drop uses.
    expect(result.output).toContain("collect:record");
    expect(result.output).toContain("apply");
  });

  it("fails on a warning band every run agreed warns too late", () => {
    // The same direction as an import baseline, for the other recorded value: a
    // band this far above the tightest file is not warning anyone of anything.
    const result = gate(reportText(3, 3, [LOOSE_BAND]));
    expect(result.status).toBe(1);
    expect(result.output).toContain(LOOSE_BAND.name);
    expect(result.output).toContain("recorded 90% of a collect budget");
  });

  it("fails closed on a report a single run produced", () => {
    // A lone run warns and is annotated, but "every run agrees" is vacuous for one
    // run — so the gate refuses to call it confirmation rather than passing a loose
    // gate that repeats never corroborated.
    const result = gate(reportText(1, 1, [LOOSE]));
    expect(result.status).toBe(1);
    expect(result.output).toContain("the report judged 1 run");
    expect(result.output).toContain("a lone run confirms nothing");
  });

  it("fails closed on a session that came up short of its runs", () => {
    // Fewer samples is a weaker claim, so nothing is called stale on a partial
    // session — but the gate must not pass on evidence it never gathered.
    const result = gate(reportText(3, 1, [LOOSE]));
    expect(result.status).toBe(1);
    expect(result.output).toContain("only 1 of 3 runs left a sample");
  });

  it("fails closed when there is no report at all", () => {
    const result = gate(null);
    expect(result.status).toBe(1);
    expect(result.output).toContain("no run report");
  });

  it("fails closed on a report it cannot parse", () => {
    const result = gate("{ this is not json\n");
    expect(result.status).toBe(1);
    expect(result.output).toContain("no run report");
  });
});
