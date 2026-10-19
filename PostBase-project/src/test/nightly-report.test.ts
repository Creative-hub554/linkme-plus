import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSummary, sanitizeReport, workflowCommand } from "../../.freebuff/nightly-report.mjs";
// The trend the page charts from the runbook, taken from the same module the renderer uses so the
// case below can compute what the *committed* file should produce instead of typing a row that
// changes every time a full gate records a run.
import { coverageOverTime, readLowWater } from "../../.freebuff/coverage-trend.mjs";
// The one declaration of the readings the summary renders: the ids their lines travel under and
// the prefixes those lines carry. The renderer walks that declaration rather than naming a field
// per guard, so the cases below build their payloads from it too — a reading added there is
// exercised here by cases written before it existed, which is the point of the registry.
import { READINGS } from "../../.freebuff/coverage-readings.mjs";

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

/**
 * The floors as the module's own shape — one number and the night it settled, per reading id —
 * written down here because the module is JavaScript and the case below reads the map key by key.
 */
type Floors = Record<string, { value: number; since: string }>;

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

  it("renders every declared reading under one heading, in the registry's order", () => {
    // One heading, because the readings answer one question — what did the green run
    // actually measure — and the rows come from the registry in its own order, so two
    // nights' sections can be read against each other. The payload is built from that
    // declaration, so a reading added there is rendered by this case without it naming
    // the new one: the renderer walks the registry rather than a field per guard.
    const readings = Object.fromEntries(
      READINGS.map((entry, index) => [
        entry.id,
        `${entry.prefix} stub ${index + 1} (2 unique destinations)`,
      ]),
    );
    const md = renderSummary({ ...passing, readings });

    // The section sits after the stage table, and each reading is verbatim — the same
    // line the runbook bullet quotes, so the run page and the record cannot disagree
    // about what a guard audited.
    expect(md.indexOf("### Coverage")).toBeGreaterThan(md.indexOf("| mutation sweep |"));
    expect(md.match(/### Coverage/g)).toHaveLength(1);
    let previous = -1;
    for (const entry of READINGS) {
      const at = md.indexOf(`${readings[entry.id]}.`);
      expect(at, `${entry.id}'s reading is not on the run page`).toBeGreaterThan(-1);
      expect(at, `${entry.id}'s reading is out of the registry's order`).toBeGreaterThan(previous);
      previous = at;
    }
  });

  it("ignores a reading the registry does not declare, and one that is not a line", () => {
    // The `readings` map is a report's shape, so a payload can carry anything: an older
    // report's field, a hand-written fixture, a guard that stopped writing. Only the
    // declared readings are rendered, and only when they carry a non-empty string —
    // anything else is the same omission as a reading that never arrived, never an
    // empty heading or a line of some other file's choosing.
    const md = renderSummary({
      ...passing,
      readings: {
        "some-retired-reading": "a reading nothing declares any more",
        [READINGS[0].id]: 42,
        [READINGS[READINGS.length - 1].id]: "   ",
      },
    });

    expect(md).not.toContain("### Coverage");
    expect(md).not.toContain("a reading nothing declares any more");
  });

  it("omits the coverage section when the suite left no reading", () => {
    // No `readings` map, an empty one, and an explicit null per declared reading — all
    // the shapes a stubbed or failed suite leaves. An omission, never a fabricated zero
    // and never an empty heading.
    const withNulls = Object.fromEntries(READINGS.map((entry) => [entry.id, null]));

    for (const payload of [passing, { ...passing, readings: {} }, { ...passing, readings: withNulls }]) {
      expect(renderSummary(payload)).not.toContain("### Coverage");
    }
  });

  it("charts each guard's reading over time from the runbook's dated records", () => {
    // The runpage's second coverage view: `### Coverage` is what *tonight* measured, and this is
    // the history those readings accrue in the runbook — one series per declared reading, charted
    // by the number its entry declares. The records are built from the registry's prefixes, so
    // the file the page is charted from cannot drift from the declaration the renderer walks.
    const rendered = `${READINGS[0].prefix} chrome — the footer 14 (25 unique destinations) | data — 28 page mounts, 18 unique destinations.`;
    const grown = `${READINGS[0].prefix} chrome — the footer 14 (28 unique destinations) | data — 28 page mounts, 18 unique destinations.`;
    const runbook = [
      `- **2026-10-01 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
      `  ${rendered}`,
      "",
      `- **2026-10-02 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
      `  ${grown}`,
    ].join("\n");

    const md = renderSummary(passing, runbook);

    expect(md).toContain("### Coverage over time");
    expect(md).toContain(
      `- **${READINGS[0].id}** \`▁█\` — 28 ${READINGS[0].metric.label}, up 3 from 25 ` +
        "(range 25–28) over 2 record(s) (2026-10-01 → 2026-10-02)",
    );
    // The trend is the runbook's, not the report's: a run whose own suite left no reading still
    // shows the history, and when tonight's reading is on the page the two sit in that order.
    expect(renderSummary(passing, runbook)).toContain("### Coverage over time");
    const withReading = renderSummary(
      { ...passing, readings: { [READINGS[0].id]: "rendered-links coverage: stub 1" } },
      runbook,
    );
    expect(withReading.indexOf("### Coverage over time")).toBeGreaterThan(
      withReading.indexOf("### Coverage"),
    );
    expect(withReading.indexOf("### Failures")).toBe(-1);
  });

  it("charts the nights the history table holds and the runbook's bullets do not", () => {
    // The other surface: the nightly job's dated table, one row per night, matched to the runbook
    // by date — so a night only the table recorded is a record on the page rather than a gap, and
    // a reading's series is as long as the two files together make it.
    const runbook = [
      `- **2026-10-02 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
      `  ${READINGS[0].prefix} chrome — the footer 14 (25 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
    ].join("\n");
    const earlier = `${READINGS[0].prefix} chrome — the footer 14 (28 unique destinations) | data — 28 page mounts, 18 unique destinations`;
    const table = [
      "# Coverage history",
      "",
      `| Date | ${READINGS.map((entry) => entry.id).join(" | ")} |`,
      `| :-- |${READINGS.map(() => " :-- |").join("")}`,
      `| 2026-10-01 | ${earlier.replace(/\|/g, "\\|")} |${READINGS.slice(1)
        .map(() => " |")
        .join("")}`,
      "",
    ].join("\n");

    const md = renderSummary(passing, runbook, table);

    expect(md).toContain(
      `- **${READINGS[0].id}** \`█▁\` — 25 ${READINGS[0].metric.label}, down 3 from 28 ` +
        "(range 25–28) over 2 record(s) (2026-10-01 → 2026-10-02)",
    );
  });

  it("draws each reading's committed floor beneath its series, and says when there is none", () => {
    // The fourth input, and the one the page shares with `npm run coverage:trend`: the level each
    // reading is held against, drawn on its series' own scale. A dip in the bars says a guard
    // moved; the floor is what says whether it moved below the level that fails the night.
    const runbook = [
      `- **2026-10-01 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
      `  ${READINGS[0].prefix} chrome — the footer 14 (28 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
      "",
      `- **2026-10-02 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
      `  ${READINGS[0].prefix} chrome — the footer 14 (32 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
    ].join("\n");
    const floors = { [READINGS[0].id]: { value: 30, since: "2026-09-20" } };

    const md = renderSummary(passing, runbook, "", floors);

    expect(md).toContain(
      `- **${READINGS[0].id}** \`▁█\` — 32 ${READINGS[0].metric.label}, up 4 from 28 ` +
        "(range 28–32) over 2 record(s) (2026-10-01 → 2026-10-02)",
    );
    // 30 sits inside the series' 28–32, so the floor is drawn where its level is: one bar per
    // plotted record, at (30 - 28) / (32 - 28) of the scale — and the night that came in under it
    // is counted, which is the number the bars cannot carry.
    expect(md).toContain(
      `  \`▅▅\` floor 30 (recorded 2026-09-20) — the newest 32 is 2 above it; 1 of these 2 ` +
        "record(s) below it",
    );

    // …and with no floors handed in — a test, a caller with no file — the rows say so rather than
    // drawing a level this renderer made up, which would be a page stating a decision nobody made.
    const bare = renderSummary(passing, runbook, "", {});
    expect(bare).toContain(`- **${READINGS[0].id}**`);
    expect(bare).toContain("no committed floor — this reading is held against the nights at hand");
    expect(bare).not.toContain("floor 30");
  });

  it("charts nothing when the checkout has no recorded reading", () => {
    // No runbook at all (a page rendered from a report alone), and a runbook that is prose:
    // the block is omitted rather than printed empty, and a paragraph quoting a reading — the
    // shape a hand-written bullet has — is not a record and charts nothing.
    for (const runbook of ["", "- **2026-10-01 — a paragraph about `rendered-links coverage: 25 chrome`.**\n"]) {
      expect(renderSummary(passing, runbook)).not.toContain("### Coverage over time");
    }
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

  it("names who is owed when an armed red alarm publishes its verdict, and nothing when there was none", () => {
    // The section is built from the report's `queueAlarm` — the judgment the armed suite
    // publishes as data — so the run page carries the handles and their waits, oldest first,
    // without a reader opening the gate's log for the sentence. The field rides the payload
    // only when an armed suite wrote one, so its absence is the page reading nothing rather
    // than a zero that pretends an alarm ran.
    const red = renderSummary({
      ...failing,
      failed: ["test"],
      queueAlarm: {
        maxAgeHours: 48,
        judgedAt: "2026-10-18T09:00:00.000Z",
        overdue: [
          { id: "a", username: "kenji", waitHours: 73 },
          { id: "b", username: "sofia", waitHours: 50 },
        ],
      },
    });
    expect(red).toContain("### The verification queue's alarm");
    expect(red).toContain(
      "The armed suite judged the pending queue at 2026-10-18T09:00:00.000Z: **2 application(s)** past the 48-hour review window, oldest first —",
    );
    expect(red).toContain("- `@kenji` — waited 73h — **the oldest**");
    expect(red).toContain("- `@sofia` — waited 50h");
    expect(red).toContain("act at /admin → Verification");
    expect(red).toContain("`npm run admin:grant -- <email>`");

    // A green armed night is the same alarm on duty reading a quiet queue: said, not silent.
    const green = renderSummary({
      ...passing,
      queueAlarm: { maxAgeHours: 48, judgedAt: "2026-10-18T09:00:00.000Z", overdue: [] },
    });
    expect(green).toContain("### The verification queue's alarm");
    expect(green).toContain(
      "no application had exceeded its 48-hour review window; nobody owes a review",
    );
    // And an unarmed night — a report with no `queueAlarm` — renders no section at all.
    expect(renderSummary(passing)).not.toContain("### The verification queue's alarm");
    expect(renderSummary(failing)).not.toContain("### The verification queue's alarm");
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

  it("charts the runbook it is handed, and defaults to the one beside it", () => {
    // Two halves, one contract: `--runbook` points the block at a file, and with no flag the
    // script reads the runbook that travels with the checkout — which is what makes the nightly
    // job's publish step need no argument at all.
    const report = path.join(dir, "trend-report.json");
    const summary = path.join(dir, "trend-summary.md");
    const defaultSummary = path.join(dir, "trend-default.md");
    const runbook = path.join(dir, "trend-runbook.md");
    // An empty table and an empty low-water, handed in on purpose: the block is charted from two
    // surfaces and drawn against the floors of a third, and the checkout's own committed files
    // would otherwise add their nights *and their levels* to this fixture's runbook.
    const emptyTable = path.join(dir, "trend-empty-history.md");
    const noFloors = path.join(dir, "trend-empty-low-water.json");
    writeFileSync(report, JSON.stringify(passing));
    writeFileSync(emptyTable, "# Coverage history\n\n");
    writeFileSync(noFloors, JSON.stringify({ readings: {} }));
    writeFileSync(
      runbook,
      [
        `- **2026-10-01 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
        `  ${READINGS[0].prefix} chrome — the footer 14 (25 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
      ].join("\n"),
    );

    const handed = spawnSync(
      process.execPath,
      [
        reporter,
        "--report",
        report,
        "--summary",
        summary,
        "--runbook",
        runbook,
        "--history",
        emptyTable,
        "--low-water",
        noFloors,
      ],
      { encoding: "utf8" },
    );
    expect(handed.status).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain(`- **${READINGS[0].id}** \`▄\` — 25 `);

    const byDefault = spawnSync(process.execPath, [reporter, "--report", report, "--summary", defaultSummary], {
      encoding: "utf8",
    });
    expect(byDefault.status).toBe(0);
    // The default path is the committed runbook beside the script, so the page carries the same
    // row this module charts from that file — computed rather than typed, since the file grows
    // every time a full gate records a run.
    // Both defaults are the committed files, so the expectation is computed from both of them:
    // the committed runbook the module is beside, and the committed history table beside it.
    const committed = readFileSync(
      fileURLToPath(new URL("../../.freebuff/run.md", import.meta.url)),
      "utf8",
    );
    const committedTable = readFileSync(
      fileURLToPath(new URL("../../.freebuff/coverage-history.md", import.meta.url)),
      "utf8",
    );
    const expected = coverageOverTime(committed, { history: committedTable })
      .filter((line) => line.startsWith("- **"))
      .at(0);
    expect(expected, "the committed runbook records no reading to chart").toBeDefined();
    expect(readFileSync(defaultSummary, "utf8")).toContain(expected);

    // …and the floors are the committed file's too, with no flag: the publish step passes neither
    // surface, so a default that stopped reading the low-water would chart every row without its
    // second line and no flag would be there to notice — which is exactly the drift this holds.
    const floors = readLowWater(
      readFileSync(fileURLToPath(new URL("../../.freebuff/coverage-low-water.json", import.meta.url)), "utf8"),
    ) as Floors;
    const floored = READINGS.find((entry) => floors[entry.id] !== undefined);
    expect(floored, "the committed low-water records no floor at all").toBeDefined();
    expect(readFileSync(defaultSummary, "utf8")).toContain(
      `floor ${floors[floored!.id].value} (recorded ${floors[floored!.id].since})`,
    );
  });

  it("charts a night only the history table holds, through the flag a caller points it with", () => {
    // The second surface, through the CLI: a table row for a night the runbook has nothing for is
    // a record on the page, which is what `--history` is for — the nightly job needs no flag (the
    // default is the committed file), and a caller pointing the block at a fixture uses this one.
    const report = path.join(dir, "table-report.json");
    const summary = path.join(dir, "table-summary.md");
    const runbook = path.join(dir, "table-runbook.md");
    const table = path.join(dir, "table-history.md");
    const noFloors = path.join(dir, "table-low-water.json");
    writeFileSync(noFloors, JSON.stringify({ readings: {} }));
    const line = `${READINGS[0].prefix} chrome — the footer 14 (27 unique destinations) | data — 28 page mounts, 18 unique destinations`;
    writeFileSync(report, JSON.stringify(passing));
    // An empty runbook, so the night on the page is the table's alone and nothing else could
    // have charted it.
    writeFileSync(runbook, "");
    writeFileSync(
      table,
      [
        "# Coverage history",
        "",
        `| Date | ${READINGS.map((entry) => entry.id).join(" | ")} |`,
        `| :-- |${READINGS.map(() => " :-- |").join("")}`,
        `| 2026-09-30 | ${line.replace(/\|/g, "\\|")} |${READINGS.slice(1)
          .map(() => " |")
          .join("")}`,
        "",
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        reporter,
        "--report",
        report,
        "--summary",
        summary,
        "--runbook",
        runbook,
        "--history",
        table,
        "--low-water",
        noFloors,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const md = readFileSync(summary, "utf8");
    expect(md).toContain("### Coverage over time");
    expect(md).toContain(`- **${READINGS[0].id}** \`▄\` — 27 ${READINGS[0].metric.label}`);
    expect(md).toContain("over 1 record(s) (2026-09-30)");
  });

  it("draws the floors it is handed under the series, through the flag a caller points it with", () => {
    // The third input, through the CLI: `--low-water` is what a caller pointing the block at a
    // fixture uses, while the nightly job needs no flag at all — the default is the committed file
    // beside the script, which is what makes its publish step argument-free.
    const report = path.join(dir, "floor-report.json");
    const summary = path.join(dir, "floor-summary.md");
    const runbook = path.join(dir, "floor-runbook.md");
    const emptyTable = path.join(dir, "floor-empty-history.md");
    const floors = path.join(dir, "floor-low-water.json");
    writeFileSync(report, JSON.stringify(passing));
    writeFileSync(emptyTable, "# Coverage history\n\n");
    writeFileSync(
      runbook,
      [
        `- **2026-10-01 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
        `  ${READINGS[0].prefix} chrome — the footer 14 (27 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
        "",
        `- **2026-10-02 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
        `  ${READINGS[0].prefix} chrome — the footer 14 (25 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
        "",
        `- **2026-10-03 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
        `  ${READINGS[0].prefix} chrome — the footer 14 (24 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
      ].join("\n"),
    );
    // The file the command reads, in the command's own shape: the note it writes about itself, and
    // the floors keyed by the ids the registry declares.
    writeFileSync(
      floors,
      JSON.stringify({
        note: "The low-water mark each declared reading is held against.",
        readings: { [READINGS[0].id]: { value: 25, since: "2026-09-28" } },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [
        reporter,
        "--report",
        report,
        "--summary",
        summary,
        "--runbook",
        runbook,
        "--history",
        emptyTable,
        "--low-water",
        floors,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const md = readFileSync(summary, "utf8");
    // The floor is drawn on the series' own scale — 25 sits a third of the way up a 24–27 window —
    // and the row carries the count the bars cannot: the one night that came in under it. That
    // count is the whole reason the line exists: those are the nights this window failed on.
    expect(md).toContain(
      `  \`▃▃▃\` floor 25 (recorded 2026-09-28) — the newest 24 is 1 below it; 1 of these 3 ` +
        "record(s) below it",
    );
  });

  it("charts without floors when the low-water it is handed is missing or unreadable", () => {
    // The floors are best-effort like the other two inputs, and for the same reason: what a caller
    // cannot hand over costs the rows their second line and never the publish. Both failures are
    // said on stderr with their own reason — a file that is there and broken is not a file that is
    // not there — because a page quietly charted without its floors is the one nobody would notice.
    const report = path.join(dir, "bare-report.json");
    const summary = path.join(dir, "bare-summary.md");
    const brokenSummary = path.join(dir, "bare-broken.md");
    const runbook = path.join(dir, "bare-runbook.md");
    const junk = path.join(dir, "bare-low-water.json");
    writeFileSync(report, JSON.stringify(passing));
    writeFileSync(
      runbook,
      [
        `- **2026-10-01 — ci verdict: 11 passed, 0 failed, 0 skipped, 0 unchanged, 0 reused, 0 excluded (11 selected); all stages passed.** typecheck PASS.`,
        `  ${READINGS[0].prefix} chrome — the footer 14 (25 unique destinations) | data — 28 page mounts, 18 unique destinations.`,
      ].join("\n"),
    );
    // Floors-looking and wrong: the reader's own reason is what says which line of it was.
    writeFileSync(junk, JSON.stringify({ readings: { [READINGS[0].id]: 25 } }));

    const missingPath = path.join(dir, "no-such-low-water.json");
    const missing = spawnSync(
      process.execPath,
      [
        reporter,
        "--report",
        report,
        "--summary",
        summary,
        "--runbook",
        runbook,
        "--low-water",
        missingPath,
      ],
      { encoding: "utf8" },
    );

    expect(missing.status).toBe(0);
    expect(missing.stderr).toContain(`no committed low-water at ${missingPath}`);
    expect(missing.stderr).toContain("there is none");
    const md = readFileSync(summary, "utf8");
    expect(md).toContain("### Coverage over time");
    expect(md).toContain(`- **${READINGS[0].id}**`);
    expect(md).toContain("no committed floor");

    const broken = spawnSync(
      process.execPath,
      [
        reporter,
        "--report",
        report,
        "--summary",
        brokenSummary,
        "--runbook",
        runbook,
        "--low-water",
        junk,
      ],
      { encoding: "utf8" },
    );

    expect(broken.status).toBe(0);
    expect(broken.stderr).toContain("is not an entry with a value and a date");
    expect(readFileSync(brokenSummary, "utf8")).not.toContain("floor 25");
  });

  it("publishes anyway when there is neither a runbook nor a history table to chart", () => {
    // A missing file costs the page the trend and never a publish — the gate's own exit code is
    // the workflow step's, and a summary nobody gets is the failure that matters. Both are said
    // on stderr, because one surface missing still charts the other: a caller who gets no block
    // at all has to be able to see why, and a quietly absent section is one nobody would notice.
    const report = path.join(dir, "trend-missing.json");
    const summary = path.join(dir, "trend-missing.md");
    const missing = path.join(dir, "no-such-runbook.md");
    const noTable = path.join(dir, "no-such-history.md");
    writeFileSync(report, JSON.stringify(passing));

    const result = spawnSync(
      process.execPath,
      [
        reporter,
        "--report",
        report,
        "--summary",
        summary,
        "--runbook",
        missing,
        "--history",
        noTable,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`no runbook at ${missing}`);
    expect(result.stderr).toContain(`no history table at ${noTable}`);
    expect(readFileSync(summary, "utf8")).not.toContain("### Coverage over time");
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
