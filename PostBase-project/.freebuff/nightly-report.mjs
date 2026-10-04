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
 * takes a parsed payload and returns a string, so `src/test/nightly-report.test.ts`
 * can assert the exact Markdown for a pass, a failure, a usage error and a
 * crashed gate without a workflow, a network or a GitHub runner.
 *
 * Usage:
 *   node .freebuff/nightly-report.mjs --report .ci/report.json              # Markdown on stdout
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --summary .ci/summary.md
 *   node .freebuff/nightly-report.mjs --report .ci/report.json --annotations
 *
 * The exit code is 0 when the report was published and 1 when it could not be
 * read or parsed — a broken publish is loud, and the gate's own exit code is the
 * workflow step's, not this script's.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { redactInput, redactInputs, redactText } from "./redact.mjs";

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
 * `skipped`, `unchanged`, `reused`, `expired`, `excluded`, `recovered` — and names each
 * observation rather than implying a stage passed: a stage that did not run is
 * never a check mark.
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
 */
export function renderSummary(payload) {
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

  // The rendered-links guard's reading, when this run's suite left one: what the
  // guard audited, verbatim, so the coverage trend is visible on the run page
  // and not only in the runbook's dated bullets. Absent for a stubbed or failed
  // suite — an omission, never a zero.
  if (payload.coverageStamp) {
    out.push("### Coverage");
    out.push("");
    out.push(payload.coverageStamp + ".");
    out.push("");
  }

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

  const summary = renderSummary(payload);
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
