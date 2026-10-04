#!/usr/bin/env node
/**
 * The lint baseline as one gate: a whole-project ESLint run, and any finding —
 * error *or* warning — is a failure.
 *
 * The project drove its ESLint warnings to zero, and `npm run lint` cannot keep
 * it there: warnings do not fail it, so a reintroduced warning is green there.
 * `npm run lint:ci` (`eslint . --max-warnings 0`) is the strict form, and
 * `src/test/lint-baseline.test.ts` is the local backstop that runs the same
 * ESLint the scripts do. Neither is a *stage* of the CI runner, though, so a new
 * finding only surfaced deep inside the suite's report — this script is the stage
 * that names it on its own, cheaply and first.
 *
 * It reads the project's own flat config from the cwd, so it lints exactly what
 * `eslint .` lints; it does not re-implement the rules. What it adds is the
 * machine-readable contract `ci.mjs` reads:
 *
 *   node .freebuff/lint-baseline.mjs          # human report
 *   node .freebuff/lint-baseline.mjs --json   # one object on stdout
 *
 * The `--json` payload is `{ root, gate, exitCode, files, findings[], errors,
 * warnings }`, where each finding carries its project-relative `file`, `line`,
 * `column`, `rule`, `severity` and `message`. Progress stays on stderr under
 * `--json`, so stdout carries exactly the one object. Exit code is `1` on any
 * finding (or `2` when ESLint itself could not run), matching `eslint
 * --max-warnings 0`.
 *
 * The fuller baseline — the `eslint-disable` allowlist and the written reason
 * for `@next/next/no-img-element` being off — stays in
 * `src/test/lint-baseline.test.ts`; a stage cannot reach those decisions, which
 * are about the config and the source as text, not about ESLint's findings.
 */
import { ESLint } from "eslint";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** `--json` keeps stdout for the gate object; progress moves to stderr. */
const JSON_OUTPUT = process.argv.includes("--json");
const log = JSON_OUTPUT ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts);

/** The project-relative, forward-slashed path a finding names. */
const rel = (path) => relative(root, path ?? "").split("\\").join("/");

async function main() {
  log("Lint baseline (eslint . --max-warnings 0)");

  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(["."]);

  const findings = [];
  for (const result of results) {
    for (const message of result.messages) {
      findings.push({
        file: rel(result.filePath),
        line: message.line ?? 0,
        column: message.column ?? 0,
        rule: message.ruleId ?? "(fatal)",
        severity: message.severity,
        message: message.message,
      });
    }
  }

  const errors = findings.filter((finding) => finding.severity === 2).length;
  const warnings = findings.filter((finding) => finding.severity === 1).length;
  const pass = findings.length === 0;

  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          gate: pass ? "pass" : "fail",
          exitCode: pass ? 0 : 1,
          files: results.length,
          findings,
          errors,
          warnings,
        },
        null,
        2,
      )}\n`,
    );
  } else if (pass) {
    log(`  ${results.length} file(s) linted, no findings`);
    log("Lint baseline: clean.");
  } else {
    log(`  ${results.length} file(s) linted, ${errors} error(s), ${warnings} warning(s)`);
    for (const finding of findings) {
      log(`  ${finding.file}:${finding.line}:${finding.column}  ${finding.rule}  ${finding.message}`);
    }
    log("");
    log(`Lint baseline: FAIL — ${findings.length} finding(s). Fix them, or, if the silence is`);
    log("deliberate, record the eslint-disable in DISABLE_ALLOWLIST in src/test/lint-baseline.test.ts");
    log("with the reason that justifies it.");
  }

  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  // A crash — a bad config, ESLint not installed — must not read as a pass.
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          gate: "fail",
          exitCode: 2,
          files: 0,
          findings: [],
          errors: 0,
          warnings: 0,
          error: error?.message ?? String(error),
        },
        null,
        2,
      )}\n`,
    );
  }
  console.error(`lint-baseline: ${error?.stack ?? error}`);
  process.exit(2);
});
