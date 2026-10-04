/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint, type Linter } from "eslint";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The *source* of the flat config, so the "the rule is off on purpose" decision
// can be asserted without executing Next's shareable configs. `?raw` is Vite's
// own escape hatch for reading a file's bytes; the runbook test reads its
// subject the same way.
import configSource from "../../eslint.config.mjs?raw";
import {
  projectSourceSnapshot,
  runOnQuietTree,
  SOURCE_FILE,
  SOURCE_ROOTS,
} from "@/test/checkout-watch";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * A fingerprint of the project's own source, taken either side of a whole-project
 * check so a result can be tied to a tree that held still. This checkout is
 * shared: without it, a run that straddles someone else's save reports a finding
 * about code that is already gone. It shares its definition with the suite-level
 * drift watch, so both watch the same files.
 */
const sourceSnapshot = () => projectSourceSnapshot(projectRoot);

type LintMessage = Linter.LintMessage & { filePath: string; ruleId: string };

let results: ESLint.LintResult[] = [];
let messages: LintMessage[] = [];

function format(findings: LintMessage[]): string {
  return findings
    .map((m) => `${path.relative(projectRoot, m.filePath)}:${m.line}:${m.column} - ${m.ruleId}: ${m.message}`)
    .join("\n");
}

let lintDrift: string[] = [];

beforeAll(async () => {
  // Long: this is a real ESLint run over the whole project, not a fixture.
  // Roughly ten seconds here; the budget is for a busy CI runner, and the check
  // is taken again if the tree moved under it.
  const { value, drift } = await runOnQuietTree(
    async () => {
      const eslint = new ESLint({ cwd: projectRoot });
      return eslint.lintFiles(["."]);
    },
    { snapshot: sourceSnapshot },
  );
  results = value;
  lintDrift = drift;
  messages = results.flatMap((result) =>
    result.messages.map((message) => ({
      ...message,
      filePath: result.filePath,
      ruleId: message.ruleId ?? "(fatal)",
    })),
  );
}, 180_000);

/**
 * A contract test for the lint baseline.
 *
 * The project spent several passes driving its ESLint warnings to zero, and the
 * last two rule families were closed with decisions rather than deletions:
 * `@next/next/no-img-element` is turned **off** in `eslint.config.mjs` with a
 * written reason, and every `react-hooks/exhaustive-deps` finding was fixed by
 * giving the effect the value it actually reads. Both are easy to undo by
 * accident — re-enabling the image rule, or dropping a dependency from an
 * effect — and neither is visible until ESLint runs. `npm run lint` cannot
 * catch it either: warnings do not fail it, so a reintroduced warning is green
 * there. CI closes that gap with `lint:ci` (`eslint . --max-warnings 0`), and
 * this test is the second, local backstop: it runs the same ESLint the scripts
 * do and fails on a single finding, so the baseline holds even off CI.
 *
 * It also guards the other way a finding can vanish: silencing it. An
 * `eslint-disable` comment is invisible to every check above — there is nothing
 * left for ESLint to report — so a rule can be dropped one line at a time
 * without any test noticing. The scan below pins the two suppressions the
 * project decided to keep and refuses any new one that has not been added here
 * with a reason.
 *
 * The typecheck baseline gets the same treatment: the second half of the CI
 * lint job is `tsc --noEmit`, and until now nothing outside that job held the
 * "zero type errors" claim — a local `npm test` would pass over a file that no
 * longer typechecks. The block at the bottom runs the same compiler the script
 * does and fails on a single diagnostic.
 */
describe("the lint baseline", () => {
  it("actually lints the project instead of finding nothing", () => {
    // A wrong `cwd` would make `lintFiles` match nothing and let every
    // assertion below pass by agreeing on emptiness.
    expect(results.length, "ESLint linted no files — is the project root wrong?").toBeGreaterThan(100);
  });

  it("reports zero errors and zero warnings", () => {
    // A finding from a tree that moved may be about code that is already gone, so
    // say that rather than presenting it as a failure of the current code.
    if (messages.length > 0 && lintDrift.length > 0) {
      throw new Error(
        `ESLint reported findings, but the checkout changed while it ran, so they may be about ` +
          `code that is already gone: ${lintDrift.join(", ")}. ` +
          `Re-run on a checkout no one else is writing.`,
      );
    }
    expect(messages, `ESLint findings:\n${format(messages)}`).toEqual([]);
  });

  it("has no react-hooks/exhaustive-deps findings", () => {
    const findings = messages.filter((m) => m.ruleId === "react-hooks/exhaustive-deps");
    expect(findings, `Reintroduced effect-dependency warnings:\n${format(findings)}`).toEqual([]);
  });

  it("has no @next/next/no-img-element findings", () => {
    const findings = messages.filter((m) => m.ruleId === "@next/next/no-img-element");
    expect(findings, `The image rule is off on purpose; unexpected findings:\n${format(findings)}`).toEqual([]);
  });

  it("keeps @next/next/no-img-element deliberately off, with a reason", () => {
    // Disabling the rule is the decision being protected; converting every
    // `<img>` to `next/image` and re-enabling it would otherwise pass the checks
    // above while reversing it.
    expect(configSource, "`@next/next/no-img-element` must stay off in eslint.config.mjs.").toMatch(
      /"@next\/next\/no-img-element"\s*:\s*"off"/,
    );
    // …and the reason must still be written down, not left as a bare toggle.
    expect(configSource, "The rule-off needs its written reason back.").toContain("next/image");
  });
});

/**
 * A suppression is documented when the line directly above it is a comment:
 * ESLint reads the directive on the next line, and so does a reviewer, so the
 * reason has to sit there rather than in this file alone.
 */
// The `(?=\s|$)` lookahead is what separates a directive from prose: these
// files talk *about* eslint-disable, and only a keyword followed by whitespace
// or the end of the line is one. The captured group is the silenced rule(s).
const DIRECTIVE = /eslint-disable(?:-next-line|-line)?(?=\s|$)\s*(.*)$/;

interface DisableComment {
  /** Path relative to the project root, POSIX-separated. */
  file: string;
  /** 1-based line the directive is on. */
  line: number;
  /** The rule being silenced, or "(all)" for a bare `eslint-disable`. */
  rule: string;
  /** The contiguous comment block immediately above the directive. */
  reason: string;
}

/**
 * One allowed suppression. Keyed by file and rule rather than line so unrelated
 * edits above it do not invalidate the entry; the reason is a phrase that must
 * still appear in the comment above the directive, so an entry cannot outlive
 * the justification for it.
 */
interface AllowedDisable {
  file: string;
  rule: string;
  /** A phrase from the comment that justifies the suppression. */
  reason: string;
}

/**
 * The suppressions this project allows, one per directive. Adding an
 * `eslint-disable` anywhere else fails the first test below until it is
 * recorded here — with its reason.
 */
const DISABLE_ALLOWLIST: AllowedDisable[] = [
  {
    file: "src/components/social/virtual-feed-list.tsx",
    rule: "react-hooks/exhaustive-deps",
    reason: "deliberate invalidation signal",
  },
  {
    file: "src/test/dom-leaks.ts",
    rule: "@typescript-eslint/no-this-alias",
    reason: "target has to be captured",
  },
];

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scanDisableComments(): DisableComment[] {
  const found: DisableComment[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const absolute of walk(path.join(projectRoot, root))) {
      const lines = readFileSync(absolute, "utf8").split("\n");
      lines.forEach((line, index) => {
        // A directive only counts inside a comment; the same text in a string
        // literal or in prose is not one.
        if (!isCommentLine(line)) return;
        const match = DIRECTIVE.exec(line);
        if (!match) return;

        const rest = match[1].replace(/\*\/\s*$/, "").trim();
        // The contiguous comment block above, trimmed and joined; empty when a
        // directive was written bare with nothing to justify it.
        const reasonLines: string[] = [];
        for (let above = index - 1; above >= 0 && isCommentLine(lines[above]); above -= 1) {
          reasonLines.unshift(lines[above].trim());
        }

        found.push({
          file: path.relative(projectRoot, absolute).split(path.sep).join("/"),
          line: index + 1,
          rule: rest || "(all)",
          reason: reasonLines.join(" "),
        });
      });
    }
  }
  return found;
}

/** `file (rule)` — the identity a suppression is compared and reported by. */
function disableKey(entry: { file: string; rule: string }): string {
  return `${entry.file} (${entry.rule})`;
}

const disableComments = scanDisableComments();

describe("the eslint-disable allowlist", () => {
  it("has exactly the suppressions recorded here, so a new one fails", () => {
    // Arrays, not sets, so a duplicate suppression is not lost in the compare.
    const found = disableComments.map(disableKey).sort();
    const allowed = DISABLE_ALLOWLIST.map(disableKey).sort();

    const added = found.filter((key) => !allowed.includes(key));
    expect(
      added,
      `New eslint-disable comment(s) without an entry in DISABLE_ALLOWLIST:\n${added
        .map((key) => `  ${key}`)
        .join("\n")}\nFix the finding, or add the suppression here with its reason.`,
    ).toEqual([]);

    const removed = allowed.filter((key) => !found.includes(key));
    expect(
      removed,
      `DISABLE_ALLOWLIST entry no longer matches a real directive (delete it):\n${removed
        .map((key) => `  ${key}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("documents a reason on the line above every suppression", () => {
    const undocumented = disableComments.filter((c) => c.reason.trim() === "");
    expect(
      undocumented,
      `eslint-disable without a comment above it:\n${undocumented
        .map((c) => `  ${c.file}:${c.line} (${c.rule})`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("keeps each recorded reason in the comment above its directive", () => {
    // The allowlist should not agree with a stale reason: the justification the
    // project recorded has to still be the one written in the source.
    const drifted = DISABLE_ALLOWLIST.filter((entry) => {
      const live = disableComments.find((c) => c.file === entry.file && c.rule === entry.rule);
      return !live || !live.reason.includes(entry.reason);
    });
    expect(
      drifted,
      `Recorded reasons no longer found above their directive:\n${drifted
        .map((e) => `  ${e.file} (${e.rule}) — expected "${e.reason}"`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

/** The compiler `npm run typecheck` invokes, run through Node so this works the
 * same on every platform (the `node_modules/.bin` shim is a shell script on
 * Unix and a `.cmd` on Windows; neither can be spawned reliably). */
const TSC_ENTRY = path.join(projectRoot, "node_modules", "typescript", "lib", "tsc.js");

let typeErrors: string[] = [];
let typecheckDrift: string[] = [];

/**
 * One full `tsc --noEmit`, its diagnostics parsed to one line each.
 *
 * `--incremental false` forces a full check rather than trusting a
 * `tsconfig.tsbuildinfo` that may predate the current tree; it also means the run
 * leaves no artifact behind. `--pretty false` keeps diagnostics to one parseable
 * line each.
 */
function runTypecheck(): string[] {
  const run = spawnSync(
    process.execPath,
    [TSC_ENTRY, "--noEmit", "--pretty", "false", "--incremental", "false"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  if (run.error) throw run.error;

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const errors = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /error TS\d+/.test(line));

  // A non-zero exit with nothing parseable is still a failure — a bad config or
  // a crash must not read as "no errors".
  if (run.status !== 0 && errors.length === 0) {
    return [`tsc exited ${run.status} with no parseable diagnostics:\n${output.trim()}`];
  }
  return errors;
}

beforeAll(async () => {
  // Roughly ten seconds over the whole project here; the budget is for a busy CI
  // runner, and the check is taken again if the tree moved under it.
  const { value, drift } = await runOnQuietTree(runTypecheck, { snapshot: sourceSnapshot });
  typeErrors = value;
  typecheckDrift = drift;
}, 300_000);

describe("the typecheck baseline", () => {
  it("reports zero TypeScript errors", () => {
    // A diagnostic from a tree that moved may be about code that is already
    // fixed, so say that rather than presenting it as a failure of the code.
    if (typeErrors.length > 0 && typecheckDrift.length > 0) {
      throw new Error(
        `tsc reported diagnostics, but the checkout changed while it ran, so they may be about ` +
          `code that is already fixed: ${typecheckDrift.join(", ")}. ` +
          `Re-run on a checkout no one else is writing.`,
      );
    }
    expect(typeErrors, `tsc reported:\n${typeErrors.join("\n")}`).toEqual([]);
  });
});
