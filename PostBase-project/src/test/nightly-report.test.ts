import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSummary, sanitizeReport, workflowCommand } from "../../.freebuff/nightly-report.mjs";

/**
 * A test for the nightly report renderer.
 *
 * `.freebuff/nightly-report.mjs` is the publish half of the nightly job: it turns
 * a `ci.mjs --json` payload into the run page's Markdown summary and the
 * workflow commands GitHub annotates the diff with. Both are read by humans and
 * by GitHub, so the exact strings matter — a summary that quietly dropped the
 * failing stage, or an annotation whose escaping broke its property list, would
 * be a report that looks green or a command that points at nothing. The
 * renderer is a pure function of the payload, so this test drives it directly
 * and asserts the Markdown, then runs the CLI once against a real file to prove
 * the wiring (`--summary`, `--annotations`, and the exit codes).
 *
 * The last describe holds the job's *other* wiring — the half that produces the
 * payload rather than publishing it: the workflow runs the whole gate on a
 * schedule with its one environment exclusion, the runner hands the sweep no
 * filter when the run carries none, and the sweep answers that filterless run
 * with the whole plan — so a nightly pass is every strike rather than a slice
 * somebody once asked for.
 */

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const reporter = path.join(projectRoot, ".freebuff", "nightly-report.mjs");
/** The sweep the last describe's chain delivers an unfiltered argv to. */
const sweep = path.join(projectRoot, ".freebuff", "mutation-guards.mjs");

/** A minimal passing payload, shaped like `ci.mjs --json` emits it. */
const passing = {
  gate: "pass",
  exitCode: 0,
  stages: [
    { name: "typecheck", label: "typecheck", pass: true, summary: "0 type error(s)", details: [], raw: [] },
    {
      name: "mutation",
      label: "mutation sweep",
      pass: true,
      summary: "12 mutation(s) checked, no survivors",
      details: [],
      raw: [],
    },
  ],
  failed: [],
  skipped: [],
  stoppedEarly: false,
  keepGoing: true,
  unchanged: [],
  excluded: ["preflight"],
  annotations: [],
};

/** The same report with a failing typecheck at the front. */
const failing = {
  ...passing,
  gate: "fail",
  exitCode: 1,
  failed: ["typecheck"],
  stages: [
    {
      name: "typecheck",
      label: "typecheck",
      pass: false,
      summary: "1 type error(s)",
      details: [
        {
          mark: "TS",
          name: "",
          detail: "src/a.ts(1,2): error TS2322: nope",
          fix: "fix it",
        },
      ],
      raw: ["… and 3 more"],
    },
    passing.stages[1],
  ],
};

/**
 * The passing report with one stage carrying a warning: the shape a tree-editing
 * check produces when it had to put back what a killed run left behind. `ci.mjs` marks
 * such a detail `WARN …`, which is the contract between the two — the runner turns the
 * same mark into a `::warning` annotation.
 */
const warned = {
  ...passing,
  stages: [
    passing.stages[0],
    {
      name: "mutation-coverage",
      label: "coverage gate mutation",
      pass: true,
      summary: "5 coverage gate(s) checked, no survivors — 1 recovered lock",
      details: [
        {
          mark: "WARN RECOVERED",
          name: ".freebuff/coverage-floor.mjs",
          detail:
            "RESTORED .freebuff/coverage-floor.mjs from an interrupted coverage mutation check " +
            "(gate: src/test/coverage-floor.test.ts).",
        },
      ],
      raw: [],
    },
  ],
};

/**
 * A report that names a secret-looking file everywhere the nightly job publishes
 * one: a survivor's path, a stage's `inputs`, a recovery bullet, an annotation, and
 * the prose and raw tail that quote it. The publish path must collapse every one of
 * them — the summary is on the run page for weeks and the artifact is downloadable.
 */
const leaked = {
  gate: "fail",
  exitCode: 1,
  failed: ["mutation"],
  stages: [
    {
      name: "mutation",
      label: "mutation sweep",
      pass: false,
      summary: "5 checked, 1 survivor(s)",
      inputs: [".env.local", ".env.example", "src/app/api/posts/route.ts"],
      details: [
        {
          mark: "SURVIVED GUARD",
          name: ".env.local:31",
          detail: "removed the guard in .env.local",
          fix: "restore .env.local",
          location: { file: ".env.local", line: 31 },
        },
        { mark: "SURVIVED GUARD", name: "src/app/api/jobs/route.ts:7", detail: "guard removed" },
      ],
      raw: ["sweep: wrote .env.local and stopped"],
    },
  ],
  recovered: [
    { label: "the run", mark: "WARN RECOVERED", name: ".env.local", detail: "RESTORED .env.local" },
  ],
  annotations: [
    { level: "error", file: ".env.local", line: 31, title: "mutation sweep", message: "boom at .env.local" },
    { level: "error", file: "src/app/api/jobs/route.ts", line: 7, title: "mutation sweep", message: "guard" },
  ],
};

describe("the nightly report renderer", () => {
  it("never publishes a secret-looking name, wherever the report names one", () => {
    const md = renderSummary(leaked);

    // Not one of the four places the name appears survives into the summary…
    expect(md).not.toContain(".env.local");
    expect(md).not.toContain(".env.example");
    expect(md).toContain("<redacted>");
    // …while a non-secret file is named exactly as before, and the count is kept.
    expect(md).toContain("src/app/api/jobs/route.ts:7");
    expect(md).toContain("5 checked, 1 survivor(s)");
  });

  it("collapses the secret inputs into one marker, so the report does not count them", () => {
    const safe = sanitizeReport(leaked);

    // `.env.local` and `.env.example` become a single `<redacted>`; the ordinary
    // input is untouched.
    expect(safe.stages[0].inputs).toEqual(["<redacted>", "src/app/api/posts/route.ts"]);
  });

  it("lists a warning on a passing stage under its own heading, without failing it", () => {
    const md = renderSummary(warned);

    expect(md).toContain("## Nightly full CI gate — ✅ all 2 stage(s) passed");
    expect(md).toContain("1 warning(s) on a stage that passed.");
    expect(md).toContain("### Warnings");
    expect(md).toContain(
      "- **WARN RECOVERED** (coverage gate mutation) `.freebuff/coverage-floor.mjs` — RESTORED " +
        ".freebuff/coverage-floor.mjs from an interrupted coverage mutation check",
    );
    // A warning is not a failure: the stage stays green and nothing joins the Failures
    // section, which only walks failing stages.
    expect(md).toContain("| coverage gate mutation | ✅ pass | 5 coverage gate(s) checked");
    expect(md).not.toContain("### Failures");
    // And a report with no warnings says nothing about them.
    expect(renderSummary(passing)).not.toContain("### Warnings");
    expect(renderSummary(passing)).not.toContain("warning(s) on a stage that passed");
  });

  it("shows the guard sweep's margin regression and audit readings without failing the gate", () => {
    // The mutation stage's summary carries the sweep's two whole-run readings —
    // thin-margin limbs and un-struck decisions — and a regression rides as a
    // `WARN THIN MARGIN` detail. This is the run-page end of that contract: the
    // readings land in the stage table's Summary cell, the regression lands in the
    // Warnings section beside the detector file it names, and the gate stays green —
    // a limb one case holds is a warning the page must show, not a failure.
    const md = renderSummary({
      ...passing,
      stages: [
        passing.stages[0],
        {
          ...passing.stages[1],
          summary:
            "590 mutation(s) checked, no survivors — 0 thin-margin limb(s) — " +
            "63 of 114 decision(s) un-struck",
          details: [
            {
              mark: "WARN THIN MARGIN",
              name: "src/test/convention-guards.ts",
              detail:
                "beat-seam: the step limb stops seeing a callback that was renamed out of it " +
                '— one case alone notices it: "catches the frame loop a surface opens beside ' +
                'the carousel" (src/test/beat-seams.test.ts)',
              location: { file: "src/test/convention-guards.ts" },
            },
          ],
        },
      ],
    });

    expect(md).toContain("## Nightly full CI gate — ✅ all 2 stage(s) passed");
    expect(md).toContain(
      "| mutation sweep | ✅ pass | 590 mutation(s) checked, no survivors — 0 thin-margin " +
        "limb(s) — 63 of 114 decision(s) un-struck |",
    );
    expect(md).toContain("### Warnings");
    expect(md).toContain(
      "- **WARN THIN MARGIN** (mutation sweep) `src/test/convention-guards.ts` — " +
        "beat-seam: the step limb stops",
    );
    // The warning is not a failure: nothing joins the Failures section, which only
    // walks failing stages.
    expect(md).not.toContain("### Failures");
  });

  it("lists a lock healed in place of a stage that did not run as the run's own warning", () => {
    const md = renderSummary({
      ...passing,
      unchanged: ["mutation-coverage"],
      recovered: [
        {
          action: "restored",
          path: ".freebuff/coverage-propose.mjs",
          check: "coverage mutation check",
          stage: "mutation-coverage",
          label: "coverage gate mutation",
          mark: "WARN RECOVERED",
          name: ".freebuff/coverage-propose.mjs",
          detail:
            "RESTORED .freebuff/coverage-propose.mjs from an interrupted coverage mutation check " +
            "(gate: src/test/coverage-propose.test.ts).",
        },
      ],
    });

    // The lock had no stage row to ride — the stage it belongs to was not run — so the
    // run reports it, naming the stage it stood in for.
    expect(md).toContain("### Warnings");
    expect(md).toContain(
      "Lock(s) an interrupted run left behind, dealt with in place of a stage that did " +
        "not run: 1 healed.",
    );
    expect(md).toContain(
      "- **WARN RECOVERED** (in place of coverage gate mutation, which did not run) " +
        "`.freebuff/coverage-propose.mjs` — RESTORED .freebuff/coverage-propose.mjs from an " +
        "interrupted coverage mutation check",
    );
    // Still not a failure: the stage that did not run is named as unchanged, and a
    // healed tree is a warning on a green run.
    expect(md).toContain("Unchanged (nothing they read changed): `mutation-coverage`.");
    expect(md).not.toContain("### Failures");
  });

  it("leaves a failing stage's own warnings in the Failures section, not in both", () => {
    const md = renderSummary({
      ...failing,
      stages: [
        {
          ...failing.stages[0],
          details: [{ mark: "WARN SOFT GATE", name: "", detail: "48% of its collect budget" }],
        },
        failing.stages[1],
      ],
    });

    expect(md).toContain("### Failures");
    expect(md).toContain("- **WARN SOFT GATE** — 48% of its collect budget");
    expect(md).not.toContain("### Warnings");
  });

  it("renders a passing report as a summary with a green table and no failures", () => {
    const md = renderSummary(passing);

    expect(md).toContain("## Nightly full CI gate — ✅ all 2 stage(s) passed");
    expect(md).toContain("| typecheck | ✅ pass | 0 type error(s) |");
    expect(md).toContain("| mutation sweep | ✅ pass | 12 mutation(s) checked, no survivors |");
    expect(md).not.toContain("### Failures");
  });

  it("names the stages --skip excluded, and warns they were not run", () => {
    const md = renderSummary(passing);

    expect(md).toContain("Excluded by `--skip` (this host cannot run it): `preflight`.");
    expect(md).toContain("> A stage listed as excluded was **not run** in this job");
  });

  it("renders the rendered-links coverage reading under its own heading", () => {
    const stamp = "rendered-links coverage: chrome — the footer 14, the signed-in header 5 (9 unique destinations)";
    const md = renderSummary({ ...passing, coverageStamp: stamp });

    // The section sits after the stage table, and the reading is verbatim — the
    // same line the runbook bullet quotes, so the run page and the record cannot
    // disagree about what the guard audited.
    expect(md).toContain("### Coverage");
    expect(md).toContain(`${stamp}.`);
    const tableEnd = md.indexOf("| mutation sweep |");
    const coverage = md.indexOf("### Coverage");
    expect(coverage).toBeGreaterThan(tableEnd);
  });

  it("omits the coverage section when the suite left no stamp", () => {
    // No `coverageStamp` field, and an explicit null — both the run's real shapes
    // for a stubbed or failed suite. An omission, never a fabricated zero.
    const withoutField = renderSummary(passing);
    const withNull = renderSummary({ ...passing, coverageStamp: null });

    expect(withoutField).not.toContain("### Coverage");
    expect(withNull).not.toContain("### Coverage");
  });

  it("leads a failing report with the failed count and lists each detail with its fix", () => {
    const md = renderSummary(failing);

    expect(md).toContain("## Nightly full CI gate — ❌ 1 of 2 stage(s) failed");
    expect(md).toContain("Failed: `typecheck`.");
    expect(md).toContain("### Failures");
    expect(md).toContain("**typecheck** — 1 type error(s)");
    expect(md).toContain("- **TS** — src/a.ts(1,2): error TS2322: nope _(fix: fix it)_");
    // The raw tail is carried through as a fenced block, not dropped.
    expect(md).toContain("```\n… and 3 more\n```");
  });

  it("fences the loosening itself when the failed gate is the drift alarm", () => {
    const md = renderSummary({
      ...failing,
      failed: ["drift"],
      stages: [
        {
          name: "drift",
          label: "gate drift",
          pass: false,
          summary: "1 gate file(s) no longer match the pin",
          details: [
            {
              mark: "CHANGED",
              name: ".freebuff/coverage-floor.mjs",
              detail: "on disk 11111111, pinned 22222222",
              diff:
                "--- pinned  .freebuff/coverage-floor.mjs\n" +
                "+++ on disk .freebuff/coverage-floor.mjs\n" +
                "@@ -124,7 +124,7 @@\n" +
                "-    if (pct < threshold) {\n" +
                "+    if (pct <= threshold) {",
            },
          ],
          raw: [],
        },
      ],
    });

    // The change the reader has to judge sits in the section, indented into its bullet,
    // rather than a hash pair they would have to resolve by hand.
    expect(md).toContain(
      "- **CHANGED** `.freebuff/coverage-floor.mjs` — on disk 11111111, pinned 22222222\n\n" +
        "  ```diff\n" +
        "  --- pinned  .freebuff/coverage-floor.mjs\n" +
        "  +++ on disk .freebuff/coverage-floor.mjs\n" +
        "  @@ -124,7 +124,7 @@\n" +
        "  -    if (pct < threshold) {\n" +
        "  +    if (pct <= threshold) {\n" +
        "  ```",
    );
    // And a stage whose detail carries no diff renders exactly as before.
    expect(renderSummary(failing)).not.toContain("```diff");
  });

  it("flattens a pipe and a newline in a table cell so the row cannot break", () => {
    const md = renderSummary({
      ...passing,
      stages: [
        {
          name: "lint",
          label: "lint baseline",
          pass: false,
          summary: "2 finding(s) | a\nb",
          details: [],
          raw: [],
        },
      ],
      failed: ["lint"],
      gate: "fail",
    });

    expect(md).toContain("| lint baseline | ❌ fail | 2 finding(s) \\| a b |");
  });

  it("reports a usage error as a gate that never ran, quoting the message", () => {
    const md = renderSummary({
      gate: "fail",
      exitCode: 1,
      error: "--from and --only select stages two different ways",
      stages: [],
      failed: [],
      skipped: [],
      annotations: [],
    });

    expect(md).toContain("## Nightly full CI gate — ❌ the gate did not run");
    expect(md).toContain("--from and --only select stages two different ways");
  });

  it("reports a dry run without pretending it ran a stage", () => {
    const md = renderSummary({ dryRun: true, gate: "pass", stages: ["lint", "test"] });

    expect(md).toContain("(dry run)");
    expect(md).toContain("Would run: lint, test");
  });

  it("names the unchanged and not-run stages rather than implying they passed", () => {
    const md = renderSummary({ ...passing, unchanged: ["mutation"], skipped: ["preflight"], stoppedEarly: true });

    expect(md).toContain("Unchanged (nothing they read changed): `mutation`.");
    expect(md).toContain("Not run (stopped early): `preflight`.");
  });

  it("names a reused stage as a recorded pass rather than a pass this run", () => {
    const md = renderSummary({ ...passing, reused: ["mutation"] });

    expect(md).toContain("Reused (inputs byte-identical to a recorded pass): `mutation`.");
    // A run with no reuse says nothing about it.
    expect(renderSummary(passing)).not.toContain("Reused (");
  });

  it("names a stage that had to re-run because its recorded pass expired", () => {
    const md = renderSummary({ ...passing, expired: ["test"] });

    expect(md).toContain("Re-ran (a recorded pass expired): `test`.");
    expect(renderSummary(passing)).not.toContain("Re-ran (");
  });
});

describe("the nightly report's GitHub annotations", () => {
  it("redacts the file a redacted detail would annotate, so the command points nowhere secret", () => {
    const safe = sanitizeReport(leaked);

    expect(safe.annotations[0].file).toBe("<redacted>");
    expect(workflowCommand(safe.annotations[0])).toContain("file=<redacted>");
    expect(workflowCommand(safe.annotations[0])).not.toContain(".env.local");
    // The annotation that named an ordinary file is untouched.
    expect(workflowCommand(safe.annotations[1])).toContain("file=src/app/api/jobs/route.ts");
  });

  it("escapes a file's comma and a message's percent and newline", () => {
    const command = workflowCommand({
      level: "error",
      file: "src/lib/a,b.ts",
      line: 3,
      column: 1,
      title: "lint",
      message: "50% off\nand a: colon",
    });

    expect(command).toBe("::error file=src/lib/a%2Cb.ts,line=3,col=1,title=lint::50%25 off%0Aand a: colon");
  });

  it("renders a warning with no location", () => {
    const command = workflowCommand({ level: "warning", title: "preview preflight", message: "warn" });

    expect(command).toBe("::warning title=preview preflight::warn");
  });
});

describe("the nightly report CLI", () => {
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nightly-report-test-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the Markdown to --summary and prints the annotations on stdout", () => {
    const report = path.join(dir, "report.json");
    const summary = path.join(dir, "summary.md");
    writeFileSync(
      report,
      JSON.stringify({
        ...failing,
        annotations: [
          { level: "error", file: "src/a.ts", line: 1, column: 2, title: "typecheck", message: "boom" },
        ],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [reporter, "--report", report, "--summary", summary, "--annotations"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain("## Nightly full CI gate — ❌");
    // The annotation the workflow commands are built from reached stdout.
    expect(result.stdout).toContain("::error file=src/a.ts,line=1,col=2,title=typecheck::boom");
  });

  it("publishes nothing secret even when the report it is handed names one", () => {
    const report = path.join(dir, "leaky.json");
    const summary = path.join(dir, "leaky.md");
    writeFileSync(
      report,
      JSON.stringify({
        ...failing,
        annotations: [
          { level: "error", file: ".env.local", line: 1, title: "typecheck", message: "boom" },
        ],
        stages: [
          {
            ...failing.stages[0],
            details: [{ mark: "TS", name: ".env.local:1", detail: "error in .env.local" }],
          },
          failing.stages[1],
        ],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [reporter, "--report", report, "--summary", summary, "--annotations"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const md = readFileSync(summary, "utf8");
    expect(md).not.toContain(".env.local");
    expect(md).toContain("<redacted>");
    // The annotation on stdout is redacted in the same breath.
    expect(result.stdout).not.toContain(".env.local");
    expect(result.stdout).toContain("file=<redacted>");
  });

  it("exits 1 when the report is absent, naming it", () => {
    const result = spawnSync(process.execPath, [reporter, "--report", path.join(dir, "nope.json")], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot read");
  });

  it("exits 1 on a report that is not JSON", () => {
    const report = path.join(dir, "bad.json");
    writeFileSync(report, "not json\n");

    const result = spawnSync(process.execPath, [reporter, "--report", report], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not valid JSON");
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The job's other half: what the nightly run *does*, not what it publishes.
 *
 * The renderer above is held to whatever payload it is handed; this holds the chain
 * that produces that payload at night, and it is the only place all three links of
 * it are held. The workflow names no sweep — it launches the gate, and the sweep is
 * the gate's last stage — so nothing in `.github/workflows/` would notice a `--skip`
 * that grew to name it, or a selection flag that dropped it. And the runner's default
 * scope is invisible in any run that scoped itself: every developer slice passes
 * `--file` or `--limit`, so only an unscoped run shows what a nightly gate actually
 * asks the sweep for. The sweep's own answer to that unfiltered request is the far
 * end of the same chain: it must plan against the whole tree, or the two links above
 * would faithfully deliver a whole-run request to a sweep that narrows anyway. Three
 * claims that fail silently when they break, which is the whole reason they are cases.
 */
describe("the nightly job's wiring of the guard sweep", () => {
  const workflow = readFileSync(path.join(projectRoot, ".github/workflows/nightly.yml"), "utf8");
  const ciRunner = path.join(projectRoot, ".freebuff", "ci.mjs");

  /** Scratch for the stub sweep and its logs, made after the describe body has run. */
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nightly-wiring-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs the whole gate on a schedule, with preflight the only exclusion", () => {
    // Nightly is a claim about *when* as much as what: without the schedule the sweep
    // would still run — but only when somebody remembered to dispatch the job.
    expect(workflow).toMatch(/^  schedule:/m);

    const gate = /npm run(?: --silent)? ci --([^\n]+)/.exec(workflow);
    expect(gate, "the nightly job no longer launches the CI gate").not.toBeNull();
    const gateArgs = gate?.[1] ?? "";
    // The report mode the publish step parses — also what proves the line above matched
    // the gate's own command rather than some later one.
    expect(gateArgs).toContain("--json");

    // The one exclusion, and only that one: the preview preflight needs a live dev
    // server and an `.env.local` a hosted runner has not got. Anything else added to
    // this list silences a stage of the gate — a mutation stage among them — while the
    // run page still renders, one row short, looking every bit as green.
    const skipped = /--skip[= ](\S+)/.exec(gateArgs)?.[1].split(",") ?? [];
    expect(
      skipped,
      "the nightly gate's exclusion list has moved — an environment gap belongs here, " +
        "a silenced stage does not (a mutation stage dropped here stops the guard sweep " +
        "proving itself at night, and nothing else would say so)",
    ).toEqual(["preflight"]);

    // …and nothing else narrows the run: a selection flag drops stages the skip list
    // still names, a slice flag narrows the strike plan itself, and a stop-early flag
    // ends the run before the last stage is reached. Each would leave the summary green
    // over a surface that was never wholly proven, which is the failure this case is.
    for (const flag of ["--only", "--from", "--changed-only", "--file", "--limit", "--fail-fast", "--max-failures"]) {
      expect(gateArgs, `the nightly gate is narrowed by ${flag}`).not.toContain(flag);
    }
  });

  it("hands the sweep no filter of its own, so the nightly stage checks every strike", () => {
    // The runner's scope is the *run's own*: `--file` and `--limit` reach the sweep only
    // when the invocation passed them, and what the default hands it is invisible in any
    // run that scoped itself. So a stub sweep records the argv of each spawn, and the
    // unscoped run — the nightly shape — must ask for exactly the report mode.
    const stub = path.join(dir, "sweep-probe.mjs");
    writeFileSync(
      stub,
      [
        `import fs from "node:fs";`,
        // One line per spawn, argv after the script path — the pre-pass the stage runs
        // first, then the sweep itself, whose line is every flag the runner gave it.
        `if (process.env.STUB_SPAWN_LOG) fs.appendFileSync(process.env.STUB_SPAWN_LOG, process.argv.slice(2).join(" ") + "\\n");`,
        `process.stdout.write(JSON.stringify({ root: process.cwd(), gate: "pass", exitCode: 0, checked: 0, survivors: [] }) + "\\n");`,
        `process.exit(0);`,
      ].join("\n"),
    );

    const stage = (log: string, ...args: string[]) =>
      spawnSync(process.execPath, [ciRunner, "--only=mutation", ...args], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CI_MUTATION_SCRIPT: stub,
          CI_CACHE_FILE: path.join(dir, `cache-${path.basename(log, ".log")}.json`),
          STUB_SPAWN_LOG: log,
        },
      });

    // The nightly shape: the gate passes no scope, so the last spawn — the sweep's own
    // — carries the report mode and nothing else. No `--file`, no `--limit`: the stage
    // adds a filter of its own to nothing.
    const unscoped = path.join(dir, "spawns-unscoped.log");
    const plain = stage(unscoped);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stdout).toContain("PASS  mutation sweep");
    const spawns = readFileSync(unscoped, "utf8").trim().split(/\r?\n/);
    expect(spawns.at(-1), "the sweep was never spawned, so nothing was proven about its scope").toBe(
      "--json",
    );

    // …and the silence above is a default rather than a runner that passes nothing ever:
    // the same stage, given a scope, forwards it beside the report mode. That is what
    // makes `"--json"` an answer about the nightly run instead of an observation about
    // a runner that lost its flags.
    const scoped = path.join(dir, "spawns-scoped.log");
    const narrowed = stage(scoped, "--file=admin");
    expect(narrowed.status, narrowed.stderr).toBe(0);
    expect(readFileSync(scoped, "utf8").trim().split(/\r?\n/).at(-1)).toBe("--json --file=admin");
  }, 20_000);

  /**
   * The third link: what the sweep does with the unfiltered argv the two cases
   * above deliver.
   *
   * Every developer slice passes `--file`, so the whole-tree shape of a run is
   * invisible in ordinary use — and a sweep that narrowed on its own would leave
   * both links above true while still checking only a slice. The probe must also
   * stay cheap: a strike that really runs edits a live source file while the rest
   * of the suite reads it, so this reads the plan instead of running it, through
   * `--list`, which enumerates exactly what a run would walk — the route plan in
   * full, plus every self-mutation family — and runs no strike, takes no lock and
   * edits nothing.
   *
   * Neither half of "whole" is taken from the sweep's word alone: the routes are
   * measured against a walk of `src/app` this test does for itself, and the strikes
   * against `--anchors`, which reads the declared families whole whatever the
   * filter says — so the unfiltered `--list` agreeing with both is the *absence* of
   * `--file` doing the work, and the same list behind a scope no file carries is
   * the control that proves these counters can fall at all.
   */
  it("checks the whole plan when no --file filter is given", () => {
    // The sweep's own route walk, done here from the tree rather than read from
    // the sweep: every `route.ts` with a `route.test.ts` beside it, `node_modules`
    // aside — the same rule `walkRoutes` applies in `.freebuff/mutation-guards.mjs`.
    const walkRoutes = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkRoutes(full, out);
        else if (
          entry.isFile() &&
          entry.name === "route.ts" &&
          existsSync(path.join(dir, "route.test.ts"))
        ) {
          out.push(full);
        }
      }
      return out;
    };
    const walked = walkRoutes(path.join(projectRoot, "src", "app"));
    expect(
      walked.length,
      "no route carries a neighbour test, so the walk proves nothing about the sweep's",
    ).toBeGreaterThan(0);
    const walkedSet = new Set(
      walked.map((file) => path.relative(projectRoot, file).split(path.sep).join("/")),
    );

    const run = (...args: string[]) =>
      spawnSync(process.execPath, [sweep, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
        // The probe must never touch the lock a real sweep may be holding.
        env: { ...process.env, MUTATION_LOCK_FILE: path.join(dir, "scope-lock.json") },
      });

    /** `--list`'s shape: seven header lines, one blank, then one line per target. */
    const parseList = (stdout: string) => {
      const lines = stdout.split(/\r?\n/);
      const blank = lines.indexOf("");
      const header = lines.slice(0, blank).join("\n");
      const body = lines.slice(blank + 1).filter((line) => line !== "");
      return {
        headerRoutes: Number(/routes with a neighbour test: (\d+)/.exec(header)?.[1]),
        headerStrikes: Number(/self-mutations: (\d+)/.exec(header)?.[1]),
        // A plan line is a walked route's decision (`src/app/...:line  descriptor`);
        // every declared strike names a test-helper, detector or `.freebuff` file
        // instead, so the two halves of the body split on that prefix.
        planLines: body.filter((line) => line.startsWith("src/app/")),
        selfLines: body.filter((line) => !line.startsWith("src/app/")),
        body,
      };
    };

    const whole = run("--list");
    expect(whole.status, whole.stderr).toBe(0);
    const all = parseList(whole.stdout);

    // The sweep walked every route the tree carries — a filter that narrowed the
    // walk would drop this count while every line of the listing still looked
    // healthy — and every route it names a decision for is one of them.
    expect(all.headerRoutes, "the sweep's route walk is not the tree's").toBe(walked.length);
    const listed = new Set(all.planLines.map((line) => line.split(":")[0]));
    expect(
      [...listed].filter((route) => !walkedSet.has(route)),
      "the plan names a route no walk reached",
    ).toEqual([]);
    expect(all.planLines.length, "the plan enumerated no route decision").toBeGreaterThan(0);

    // Every declared strike, set for set: `--anchors` reads the families whole
    // whatever `--file` says, so it is the reference for what "whole" is — and the
    // header's own tally must agree with the lines the listing printed.
    const anchors = run("--anchors", "--json");
    expect(anchors.status, anchors.stderr).toBe(0);
    const declared = (
      JSON.parse(anchors.stdout) as { strikes: { path: string; name: string }[] }
    ).strikes;
    expect(declared.length, "the anchor report enumerated no strike").toBeGreaterThan(0);
    expect(all.selfLines.length, "the header's tally and the listing disagree").toBe(
      all.headerStrikes,
    );
    expect(new Set(all.selfLines)).toEqual(
      new Set(declared.map((strike) => `${strike.path}  ${strike.name}`)),
    );

    // The control that makes the equalities above answers about the *missing*
    // filter rather than counters that never move: behind a scope no file carries,
    // the walk, the families and the listing itself all fall to nothing.
    const narrow = run("--list", "--file=__nightly_scope_no_such__");
    expect(narrow.status, narrow.stderr).toBe(0);
    const none = parseList(narrow.stdout);
    expect(none.headerRoutes).toBe(0);
    expect(none.headerStrikes).toBe(0);
    expect(none.body).toEqual([]);

    // …and "the whole plan" is only honest while the plan's one other slicer
    // stays open: `--limit` narrows the route plan when a run passes it (the first
    // case holds the nightly gate to passing none), and this default is what makes
    // a filterless run the whole plan rather than a slice of it.
    expect(readFileSync(sweep, "utf8")).toMatch(/option\("--limit"\) \?\? Infinity/);
  }, 20_000);
});
