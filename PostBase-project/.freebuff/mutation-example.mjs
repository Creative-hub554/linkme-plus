#!/usr/bin/env node
/**
 * The fourth sweep: the minimal end-to-end proof of the claim the shared vocabulary module
 * makes about itself — that a sweep which means to report survivors inherits the table, the
 * two-way start-up refusal and the suites' spelling holds by importing
 * `./mutation-vocabulary.mjs`, without restating any of them.
 *
 * It runs no mutation and takes no lock. What it carries is the shape a sweep needs so the
 * inheritance has something to land on: a stamp scan (`kind: "…"` literals — this file holds
 * no lock, so every literal is a stamp), the report-only `--vocabulary` table (the guard
 * sweep's mode by the same name, `--json` in the shape the cross-sweep hold pinned, answering
 * even when the vocabulary is already a refusal), the refusal (`vocabularyHoles` answered
 * before anything would run, one sentence per hole, exit 1), and one real run body whose
 * demonstration stamps both words where the vocabulary reads them. The words are
 * `FOURTH_SURVIVOR_WORDS` in the module, named for the sweep that reads them, imported under
 * the local name its report speaks.
 *
 * Exit codes: **0** the vocabulary agrees with itself, **1** it does not — the refusal and the
 * vocabulary table answer the same question, so they cannot disagree about what is red.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FOURTH_SURVIVOR_WORDS as SURVIVOR_WORDS,
  vocabularyHoles,
} from "./mutation-vocabulary.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const self = fileURLToPath(import.meta.url);

/** The stamp scan: `kind: "…"` literals, each carrying where it was read from. */
function stampedSites(source) {
  const lines = source.split("\n");
  const sites = [];
  for (const match of source.matchAll(/\bkind: "(\w+)"/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    sites.push({
      file: ".freebuff/mutation-example.mjs",
      line,
      word: match[1],
      text: (lines[line - 1] ?? "").trim(),
    });
  }
  return sites;
}

const JSON_OUTPUT = process.argv.includes("--json");
const vocabularyOnly = process.argv.includes("--vocabulary");
const source = readFileSync(self, "utf8");

/**
 * The refusal's own kind, published by the refusal below and not stamped by the run: a hole
 * is a strike the sweep could not apply, which is what `broken` means in every sweep's table.
 * A constant rather than a literal at the payload site, so the stamp scan reads stamps where
 * they stand and not every spelling of the word this file carries.
 */
const REFUSAL_KIND = "broken";
const { unnamed, unspoken } = vocabularyHoles(SURVIVOR_WORDS, stampedSites(source).map((site) => site.word));

/**
 * `--vocabulary`: the report-only table, every declared word beside the stamps that fill its
 * bucket — dispatched before the refusal, like the other sweeps dispatch it, so a hole is
 * readable here rather than only named by the refusal. Under `--json` it answers in the shape
 * the cross-sweep hold pinned, and exits 1 when the vocabulary is a refusal.
 */
function vocabularyTable() {
  const sites = stampedSites(source);
  const holes = unnamed.length + unspoken.length;
  const exitCode = holes === 0 ? 0 : 1;
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: ROOT,
          mode: "vocabulary",
          file: ".freebuff/mutation-example.mjs",
          words: Object.entries(SURVIVOR_WORDS).map(([word, entry]) => ({
            word,
            mark: entry.mark,
            why: entry.why,
            stamps: sites.filter((site) => site.word === word),
          })),
          unnamed,
          unspoken,
          gate: exitCode === 0 ? "pass" : "fail",
          exitCode,
        },
        null,
        2,
      )}\n`,
    );
    process.exit(exitCode);
  }
  console.log("");
  console.log(`mutation-example: survivor vocabulary — ${Object.keys(SURVIVOR_WORDS).length} declared word(s)`);
  for (const [word, entry] of Object.entries(SURVIVOR_WORDS)) {
    const filled = sites.filter((site) => site.word === word);
    console.log(`  "${word}" (${entry.mark}): ${filled.length} stamp(s) the bucket reads — ${entry.why}`);
    for (const site of filled) console.log(`      ${site.file}  line ${site.line}: ${site.text}`);
  }
  console.log(
    holes === 0
      ? "  every declared word is stamped, and every stamp names a declared word."
      : `  ${holes} vocabulary hole(s):`,
  );
  process.exit(exitCode);
}

if (vocabularyOnly) vocabularyTable();

/**
 * The refusal the sweep inherits by importing the shared module: the stamps its own source
 * carries and the words its table declares must be the same set, both ways, or it may not
 * begin. One sentence per hole, in one pass, exit 1 — the same contract the other sweeps
 * refuse under, from the one comparison they all share.
 */
if (unnamed.length + unspoken.length > 0) {
  const holes = [];
  for (const kind of unnamed) {
    holes.push(`it stamps kind "${kind}", which SURVIVOR_WORDS does not declare`);
  }
  for (const word of unspoken) {
    holes.push(`SURVIVOR_WORDS declares it, and no survivor can ever carry it: "${word}"`);
  }
  if (JSON_OUTPUT) {
    // The refusal-shaped payload the other sweeps publish: `gate: "fail"`, `checked: 0`, and
    // each hole a `broken` survivor — the kind every sweep's table declares for a strike it
    // could not apply, which a vocabulary hole is. The reason is the payload's own `detail`,
    // so a consumer reading the run report reads the same sentence the log prints.
    process.stdout.write(
      `${JSON.stringify(
        {
          root: ROOT,
          gate: "fail",
          exitCode: 1,
          checked: 0,
          survivors: holes.map((detail) => ({
            path: ".freebuff/mutation-example.mjs",
            line: null,
            kind: REFUSAL_KIND,
            descriptor: "vocabulary hole",
            detail,
          })),
        },
        null,
        2,
      )}\n`,
    );
    process.exit(1);
  }
  console.error(`mutation-example: START-UP REFUSAL (${holes.length})\n${holes.map((h) => `  - ${h}`).join("\n")}`);
  process.exit(1);
}

/**
 * What the demonstration run stamps: the child answers, so the sweep records `survived` —
 * nothing was weakened and nothing caught it, which for a sweep that runs no mutation is the
 * whole point — or, when the child could not answer at all, `broken`, the repair kind every
 * sweep shares. Both literals sit in stamp position above, so the vocabulary reads them.
 */
function stampFor(status) {
  return status === 0
    ? { kind: "survived", detail: "the demonstration run answered" }
    : { kind: "broken", detail: "the demonstration run could not answer" };
}

const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
const stamp = stampFor(child.status);
if (JSON_OUTPUT) {
  // The run report the runner's stage reads: the same `gate`/`checked`/`survivors` contract the
  // other gates publish, with no survivors — a stage that must be the cheapest thing in the gate.
  process.stdout.write(
    `${JSON.stringify(
      {
        root: ROOT,
        gate: "pass",
        exitCode: 0,
        checked: 1,
        survivors: [],
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}
console.log(`mutation-example: nothing to sweep — demonstration run ${stamp.kind} (${stamp.detail}).`);
process.exit(0);
