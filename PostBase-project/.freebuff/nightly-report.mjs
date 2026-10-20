#!/usr/bin/env node
/**
 * Turns a `ci.mjs --json` report into the nightly job's published summary.
 *
 * The nightly workflow runs the whole verification gate on a schedule and hands
 * the run's machine-readable report here (`--report`), because the report is the
 * one artifact worth keeping: the JSON says exactly which stage failed, on which
 * file and line, and the previous night's JSON can be downloaded and diffed
 * against it. This script is the *publish* half — it renders that JSON as a
 * Markdown block for the run page (`$GITHUB_STEP_SUMMARY`) and, with
 * `--annotations`, as GitHub workflow commands so the first failures land on the
 * files they name instead of only in a log.
 *
 * It is deliberately a pure function of the report plus a thin CLI: rendering
 * takes a parsed payload — and, for the coverage trend below, the runbook's own
 * text — as arguments and returns a string, so `src/test/nightly-report.test.ts`
 * can assert the exact Markdown for a pass, a failure, a usage error and a
 * crashed gate without a workflow, a network or a GitHub runner.
 *
 * The page carries two views of the suite's coverage readings. `### Coverage` is
 * *this run's*: the lines the payload's `readings` map holds, verbatim. `###
 * Coverage over time` is the history those lines accrue in — the runbook's dated
 * records (`.freebuff/run.md`, checked in and therefore present on the runner) and
 * the nightly job's table (`.freebuff/coverage-history.md`), matched up by night —
 * charted one series per declared reading by `.freebuff/coverage-trend.mjs`, so a
 * guard whose reading moved this week is a shape on the page rather than a fact only
 * somebody reading the runbook's tail would notice. Beneath each series the block draws
 * the floor the reading is held against — the level `.freebuff/coverage-low-water.json`
 * records for it — so a dip in the bars can be read against the level a fall is measured
 * from instead of against nothing but the other bars. All three are read best-effort at the
 * CLI's edge — the two records as the text the renderer charts, the floors through the trend's
 * own reader — so the renderer stays a pure function of what it is given.
 *
 * Usage:
 *   node .freebuff/nightly-report.mjs --report .ci/report.json              # Markdown on stdout
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --summary .ci/summary.md
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --annotations
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --runbook .freebuff/run.md
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --history .freebuff/coverage-history.md
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --low-water .freebuff/coverage-low-water.json
 *
 * The exit code is 0 when the report was published and 1 when it could not be
 * read or parsed — a broken publish is loud, and the gate's own exit code is the
 * workflow step's, not this script's.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The readings the suite's guards publish, and the one declaration of which they are: this
// renderer walks the registry rather than naming a field per guard, so a reading added there
// appears here without this file knowing anything about it.
import { carriedReadings, readingSentence } from "./coverage-readings.mjs";
// The coverage trend: the readings the runbook's dated records and the nightly history table
// carried, merged by night and charted one series per declared reading. It reads the same registry
// this file's `### Coverage` section does, so the two views name the same guards in the same order.
import {
  HISTORY_FILE,
  LOW_WATER_FILE,
  RUNBOOK_FILE,
  coverageOverTime,
  lowWaterTrouble,
  readLowWater,
} from "./coverage-trend.mjs";
import { redactInput, redactInputs, redactText } from "./redact.mjs";

/** The checkout root this script lives in (`.freebuff/` is one level under it). */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Reads a flag written `--flag value` or `--flag=value`. */
function argValue(name) {
  const joined = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** A table cell cannot carry a pipe or a line break; flatten them. */
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** GitHub escapes `%`, CR and LF in a workflow command's data. */
const escapeData = (text) =>
  String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** …and also `:` and `,`, which delimit a command's property list. */
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

/**
 * Renders one annotation from the report's `annotations` array as a GitHub
 * Actions workflow command. The array already carries the location and level,
 * so this only has to spell it the way the runner reads it — the mirror of
 * `ci.mjs`'s own `workflowCommand`, kept here because the nightly job reads the
 * JSON rather than printing the commands itself (the two flags are exclusive).
 */
export function workflowCommand(annotation) {
  const props = [];
  if (annotation.file) props.push(`file=${escapeProperty(annotation.file)}`);
  if (annotation.line !== undefined) props.push(`line=${annotation.line}`);
  if (annotation.column !== undefined) props.push(`col=${annotation.column}`);
  props.push(`title=${escapeProperty(annotation.title)}`);
  return `::${annotation.level} ${props.join(",")}::${escapeData(annotation.message)}`;
}

/**
 * The report with every name it publishes made publishable. The runner already
 * redacts a secret-looking file name as a result is recorded, but this is the
 * *publish* boundary — the summary goes to the run page and is kept for weeks, so it
 * does not trust that. A detail's file, a survivor's path, a recovery bullet's name,
 * an annotation's `file=`, a stage's `inputs`, and any prose that quotes one are all
 * collapsed here. See `.freebuff/redact.mjs` for the one definition of secret.
 */
export function sanitizeReport(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const anyOf = (list) => (Array.isArray(list) ? list : []);
  const clean = (detail) => {
    if (!detail || typeof detail !== "object") return detail;
    return {
      ...detail,
      ...(detail.name ? { name: redactInput(detail.name) } : {}),
      ...(detail.path ? { path: redactInput(detail.path) } : {}),
      ...(detail.file ? { file: redactInput(detail.file) } : {}),
      ...(detail.title ? { title: redactText(detail.title) } : {}),
      ...(detail.detail ? { detail: redactText(detail.detail) } : {}),
      ...(detail.message ? { message: redactText(detail.message) } : {}),
      ...(detail.fix ? { fix: redactText(detail.fix) } : {}),
      ...(detail.location?.file
        ? { location: { ...detail.location, file: redactInput(detail.location.file) } }
        : {}),
    };
  };
  const stages = anyOf(payload.stages).map((stage) => {
    if (!stage || typeof stage !== "object") return stage;
    return {
      ...stage,
      ...(stage.summary ? { summary: redactText(stage.summary) } : {}),
      ...(Array.isArray(stage.inputs) ? { inputs: redactInputs(stage.inputs) } : {}),
      ...(Array.isArray(stage.details) ? { details: stage.details.map(clean) } : {}),
      ...(Array.isArray(stage.raw) ? { raw: stage.raw.map(redactText) } : {}),
    };
  });
  return {
    ...payload,
    stages,
    ...(Array.isArray(payload.recovered) ? { recovered: payload.recovered.map(clean) } : {}),
    ...(Array.isArray(payload.annotations)
      ? { annotations: payload.annotations.map(clean) }
      : {}),
  };
}

/**
 * Renders a `ci.mjs --json` payload as Markdown. It reads the same fields the
 * runner publishes — `gate`, `stages[].pass/summary/details/raw`, `failed`,
 * `skipped`, `unchanged`, `reused`, `expired`, `excluded`, `recovered`, and the suite's
 * `readings` map, whose keys are the readings `./coverage-readings.mjs` declares — and
 * names each observation rather than implying a stage passed: a stage that did not run
 * is never a check mark.
 *
 * The details of a *passing* stage get a heading of their own when they are warnings
 * (a mark starting with `WARN`), because the Failures section only walks failing stages
 * and there is nowhere else on the run page for a soft-gate creep or a lock a
 * tree-editing check had to restore after a kill. A warning is the run telling on
 * itself, not a failure: it is listed, and the gate stays green.
 *
 * The payload's own `recovered` array is the same warning one level up: a lock the run
 * dealt with *before* any stage ran, on behalf of a stage that did not run at all
 * (`--skip`, `--only`, nothing feeding it, or a failure that stopped the run short) —
 * which therefore has no row to carry it. It is listed beside the stage warnings, named
 * for the stage it stood in for.
 *
 * `runbook` and `history` are the two inputs that are not the report: the text of `.freebuff/run.md`
 * and of `.freebuff/coverage-history.md`. The readings accrue per run on both — in the runbook's
 * dated records and in the nightly job's dated rows — so they are together where each guard's
 * series comes from, merged one record per night by `.freebuff/coverage-trend.mjs`. They are
 * parameters rather than reads so this function stays pure — the CLI hands it the files, a test
 * hands it fixtures — and two empty ones simply mean a page without the trend, which is what a
 * checkout with no recorded runs gets.
 *
 * `lowWater` is the third: the floors `.freebuff/coverage-low-water.json` names, keyed by reading
 * id, already parsed by the module the block is charted by (`readLowWater`, so the page and the
 * command read the file the same way). It is empty by default, and a caller who could not read the
 * file hands in nothing: each row then *says* it has no floor rather than the trend inventing one,
 * because the page's floors are a committed decision and a level this renderer made up would be a
 * level nobody agreed to.
 */
export function renderSummary(payload, runbook = "", history = "", lowWater = {}) {
  payload = sanitizeReport(payload);
  const out = [];

  // A usage error (`--from=nope`, both stdout flags, …) aborts before any stage
  // runs and carries an `error` instead of a stage list.
  if (payload.error) {
    out.push("## Nightly full CI gate — ❌ the gate did not run");
    out.push("");
    out.push("The runner refused the invocation before running a stage:");
    out.push("");
    out.push("```");
    out.push(String(payload.error).trim());
    out.push("```");
    return `${out.join("\n")}\n`;
  }

  // `--dry-run` never reaches the nightly job, but render it rather than a table
  // of strings if it ever does.
  if (payload.dryRun) {
    out.push("## Nightly full CI gate — (dry run)");
    out.push("");
    out.push(`Would run: ${(payload.stages ?? []).join(", ") || "(nothing)"}`);
    return `${out.join("\n")}\n`;
  }

  const stages = payload.stages ?? [];
  const failed = payload.failed ?? [];
  const ran = stages.length;
  const passed = stages.filter((stage) => stage.pass).length;
  const failedLabel = failed.length === 0 ? `${ran}` : `${failed.length} of ${ran}`;
  // Warnings on stages that passed: the `WARN` prefix on the mark is the contract with
  // `ci.mjs`, which is also what makes the same detail a `::warning` annotation.
  const warnings = stages
    .filter((stage) => stage.pass)
    .flatMap((stage) =>
      (stage.details ?? [])
        .filter((detail) => String(detail.mark).startsWith("WARN"))
        .map((detail) => ({ stage, detail })),
    );
  // The run's own recovery, for a lock whose owning stage never ran: the same warning
  // shape, one level up, where its bullets name the stage it stood in for.
  const runRecoveries = (payload.recovered ?? []).map((event) => ({
    label: event.label ?? "the run",
    mark: event.mark ?? "WARN RECOVERED",
    name: event.name ?? event.path ?? "",
    detail: event.detail ?? event.message ?? "",
  }));

  out.push(
    payload.gate === "pass"
      ? `## Nightly full CI gate — ✅ all ${ran} stage(s) passed`
      : `## Nightly full CI gate — ❌ ${failedLabel} stage(s) failed`,
  );
  out.push("");
  out.push("The whole gate, run end to end on a clean checkout — no `--changed-only`, so nothing is skipped.");
  out.push("");

  const notes = [];
  notes.push(`Ran ${ran} stage(s): ${passed} passed, ${failed.length} failed.`);
  if (failed.length > 0) notes.push(`Failed: \`${failed.join("`, `")}\`.`);
  if (warnings.length > 0) {
    notes.push(`${warnings.length} warning(s) on a stage that passed.`);
  }
  if (runRecoveries.length > 0) {
    // Two buckets, because they ask different things of a reader: one is a tree this run
    // put back, the other is a lock it could not touch and left for a human.
    const healed = runRecoveries.filter(
      (event) => event.mark === "WARN RECOVERED" || event.mark === "WARN STALE LOCK",
    ).length;
    const stuck = runRecoveries.length - healed;
    notes.push(
      `Lock(s) an interrupted run left behind, dealt with in place of a stage that did ` +
        `not run: ${healed} healed${stuck > 0 ? `, ${stuck} left for a human` : ""}.`,
    );
  }
  if ((payload.unchanged ?? []).length > 0) {
    notes.push(`Unchanged (nothing they read changed): \`${payload.unchanged.join("`, `")}\`.`);
  }
  if ((payload.skipped ?? []).length > 0) {
    notes.push(`Not run (stopped early): \`${payload.skipped.join("`, `")}\`.`);
  }
  if ((payload.reused ?? []).length > 0) {
    notes.push(
      `Reused (inputs byte-identical to a recorded pass): \`${payload.reused.join("`, `")}\`.`,
    );
  }
  if ((payload.expired ?? []).length > 0) {
    notes.push(
      `Re-ran (a recorded pass expired): \`${payload.expired.join("`, `")}\`.`,
    );
  }
  if ((payload.excluded ?? []).length > 0) {
    notes.push(`Excluded by \`--skip\` (this host cannot run it): \`${payload.excluded.join("`, `")}\`.`);
  }
  for (const note of notes) out.push(`- ${note}`);
  out.push("");

  if (stages.length > 0) {
    out.push("| Stage | Result | Summary |");
    out.push("| :-- | :-- | :-- |");
    for (const stage of stages) {
      out.push(`| ${cell(stage.label)} | ${stage.pass ? "✅ pass" : "❌ fail"} | ${cell(stage.summary)} |`);
    }
    out.push("");
  }

  // The verification queue's alarm, when an armed night published its judgement (the
  // runner carries `queueAlarm` only when the suite wrote one, so `payload.queueAlarm` is
  // exactly the line between an alarm on duty and one parked): the run page names who is
  // owed — handles and waits, oldest first — so a paged reader acts without opening the
  // gate's log to find the sentence. Absent is not empty: nothing here at all on an
  // unarmed night, and a green armed night says nobody owes a review, which is the same
  // alarm on duty reading a quiet queue.
  const queueAlarm = payload.queueAlarm;
  if (queueAlarm) {
    out.push("### The verification queue's alarm");
    out.push("");
    const window = `${queueAlarm.maxAgeHours}-hour review window`;
    if (queueAlarm.overdue.length === 0) {
      out.push(
        `The armed suite judged the pending queue at ${queueAlarm.judgedAt} — no application had exceeded its ${window}; nobody owes a review.`,
      );
    } else {
      const [oldest] = queueAlarm.overdue;
      out.push(
        `The armed suite judged the pending queue at ${queueAlarm.judgedAt}: **${queueAlarm.overdue.length} application(s)** past the ${window}, oldest first —`,
      );
      out.push("");
      for (const row of queueAlarm.overdue) {
        out.push(
          `- \`@${row.username}\` — waited ${row.waitHours}h${row === oldest ? " — **the oldest**" : ""}`,
        );
      }
      out.push("");
      out.push(
        `Page a reviewer: act at /admin → Verification (approval there is what sets the badge), or grant an admin first: \`npm run admin:grant -- <email>\`.`,
      );
    }
    out.push("");
  }

  // The suite's coverage readings, when this run's guards left any: what each guard audited,
  // verbatim, so the coverage trend is visible on the run page and not only in the runbook's
  // dated bullets. One heading for all of them, because they answer one question — what did the
  // green run actually measure — and the rows come from the registry in its own order, so a
  // guard that starts publishing a reading is a line here without this file naming it. The
  // section exists when at least one reading arrived: a stubbed or failed suite leaves none,
  // which is an omission, never an empty heading.
  const readings = carriedReadings(payload);
  if (readings.length > 0) {
    out.push("### Coverage");
    out.push("");
    for (const { line } of readings) {
      out.push(readingSentence(line));
      out.push("");
    }
  }

  // …and the same readings over time, from the runbook and the nightly table this checkout
  // carries: a run page answers "what did tonight measure" above and "how has it been moving"
  // here, so a guard whose coverage quietly drifted over the last weeks is visible on the page
  // rather than only to a reader of the runbook's tail. Each series is drawn with the committed
  // floor beneath it, so the page shows the level tonight's number is held against as well as the
  // shape it moved in. The block is empty — and so is omitted — when neither file holds a dated
  // record carrying a declared reading, which is a fresh checkout rather than a defect.
  out.push(...coverageOverTime(runbook, { history, lowWater }));

  const failing = stages.filter((stage) => !stage.pass);
  if (failing.length > 0) {
    out.push("### Failures");
    for (const stage of failing) {
      out.push("");
      out.push(`**${stage.label}** — ${stage.summary}`);
      for (const detail of stage.details ?? []) {
        const where = detail.name ? ` \`${detail.name}\`` : "";
        const fix = detail.fix ? ` _(fix: ${detail.fix})_` : "";
        out.push(`- **${detail.mark}**${where} — ${detail.detail}${fix}`);
        // What moved, when the gate that failed is the alarm itself: the loosening in a
        // fenced block, indented into the bullet, rather than a hash a reader would have
        // to resolve by hand. A stage with no diff (every other gate) is unchanged.
        if (detail.diff) out.push("", ...fence(detail.diff));
      }
      for (const raw of stage.raw ?? []) {
        out.push("");
        out.push("```");
        out.push(String(raw).trimEnd());
        out.push("```");
      }
    }
    out.push("");
  }

  if (warnings.length > 0 || runRecoveries.length > 0) {
    out.push("### Warnings");
    out.push("");
    out.push(
      "On stages that passed, or about the run itself — the run telling on itself rather than a failure of the gate:",
    );
    out.push("");
    for (const { stage, detail } of warnings) {
      const where = detail.name ? ` \`${detail.name}\`` : "";
      const fix = detail.fix ? ` _(fix: ${detail.fix})_` : "";
      out.push(`- **${detail.mark}** (${stage.label})${where} — ${detail.detail}${fix}`);
    }
    for (const recovery of runRecoveries) {
      const where = recovery.name ? ` \`${recovery.name}\`` : "";
      out.push(
        `- **${recovery.mark}** (in place of ${recovery.label}, which did not run)${where} — ` +
          `${recovery.detail}`,
      );
    }
    out.push("");
  }

  if ((payload.excluded ?? []).length > 0) {
    out.push(
      "> A stage listed as excluded was **not run** in this job; a pass here does not cover it.",
    );
  }

  return `${out.join("\n").trimEnd()}\n`;
}

/** A fenced `diff` block, indented into the list item it belongs to. */
function fence(diff) {
  return [
    "  ```diff",
    ...String(diff)
      .split("\n")
      .map((row) => `  ${row}`),
    "  ```",
  ];
}

function main() {
  const reportPath = argValue("--report") ?? ".ci/report.json";
  const summaryPath = argValue("--summary");
  const wantAnnotations = process.argv.includes("--annotations");
  // The runbook and the history table the trend block is charted from, defaulted — through the one
  // spelling of each path, in the module that reads them — to the checkout's own, so the nightly
  // job needs no flag: both files are committed, and the checkout the job runs on already holds the
  // records. A caller can point either at a fixture, as the tests do.
  const runbookPath = argValue("--runbook") ?? join(ROOT, RUNBOOK_FILE);
  const historyPath = argValue("--history") ?? join(ROOT, HISTORY_FILE);
  const lowWaterPath = argValue("--low-water") ?? join(ROOT, LOW_WATER_FILE);

  let raw;
  try {
    raw = readFileSync(reportPath, "utf8");
  } catch {
    console.error(`nightly-report: cannot read ${reportPath} — the gate may have crashed before writing it`);
    process.exit(1);
  }

  let payload;
  try {
    // Sanitized once here too, so the annotations printed below come from the same
    // publishable report the summary was rendered from.
    payload = sanitizeReport(JSON.parse(raw));
  } catch {
    console.error(`nightly-report: ${reportPath} is not valid JSON`);
    process.exit(1);
  }

  // Read best-effort, the way the runner reads a reading's sidecar: a checkout without either file
  // is a page without the trend block, never a failed publish — but it is said out loud, because
  // the publish step is precisely where a quietly missing section would never be noticed.
  let runbook = "";
  try {
    runbook = readFileSync(runbookPath, "utf8");
  } catch {
    console.error(
      `nightly-report: no runbook at ${runbookPath} — the coverage-over-time block is charted from the history table alone`,
    );
  }
  let history = "";
  try {
    history = readFileSync(historyPath, "utf8");
  } catch {
    console.error(
      `nightly-report: no history table at ${historyPath} — the coverage-over-time block is charted from the runbook alone`,
    );
  }
  // …and the floors the chart draws under each series, read the way the command reads them and
  // best-effort for the same reason: they are not what the page is *charting*, so a file that is
  // missing or broken costs the rows their floor and says so, rather than costing the publish.
  // The parse is the command's own, so a page and an answer cannot disagree about what the file
  // says — including about a file that is floors-looking and wrong, whose reason is carried through.
  let lowWater = {};
  try {
    lowWater = readLowWater(readFileSync(lowWaterPath, "utf8"));
  } catch (error) {
    console.error(
      `nightly-report: ${lowWaterTrouble(lowWaterPath, error)} — the block's rows are charted without their floors`,
    );
  }

  const summary = renderSummary(payload, runbook, history, lowWater);
  if (summaryPath) {
    writeFileSync(summaryPath, summary);
    console.error(`nightly-report: wrote ${summaryPath}`);
  } else {
    process.stdout.write(summary);
  }

  if (wantAnnotations) {
    for (const annotation of payload.annotations ?? []) console.log(workflowCommand(annotation));
  }

  console.error(
    `nightly-report: gate ${payload.gate ?? "unknown"} — ${(payload.failed ?? []).length} failed stage(s)`,
  );
}

// Only run the CLI when invoked as a script; a test imports the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
