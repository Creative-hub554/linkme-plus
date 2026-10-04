/**
 * Regenerates the `## Contents` block of `.freebuff/run.md` from its headings.
 *
 * Run it after adding, renaming or reordering a section:
 *
 *   npm run runbook:contents
 *
 * It is idempotent, so running it when nothing changed reports "up to date" and
 * leaves the file untouched. `src/test/runbook-contents.test.ts` asserts the
 * committed file already matches this output.
 *
 * `--check` is the read-only form for a gate: it compares the committed Contents
 * to the regenerated block, writes nothing, and exits 1 when they differ — so a
 * stale bullet fails a job instead of being quietly fixed. `--check --json`
 * emits the result as one object (the CI runner reads it):
 *
 *   node .freebuff/build-contents.mjs --check
 *   node .freebuff/build-contents.mjs --check --json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildContents, sections } from "./runbook-contents.mjs";

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const json = argv.includes("--json");

const runbookUrl = new URL("run.md", import.meta.url);
const before = readFileSync(runbookUrl, "utf8");
const after = buildContents(before);
const upToDate = after === before;
const count = sections(after).length;

if (check) {
  const message = upToDate
    ? `run.md: Contents is up to date (${count} sections).`
    : `run.md: Contents is stale (${count} sections) — run \`npm run runbook:contents\` and commit the result.`;
  const exitCode = upToDate ? 0 : 1;
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ gate: upToDate ? "pass" : "fail", exitCode, sections: count, message }, null, 2)}\n`,
    );
  } else {
    console.log(message);
  }
  process.exit(exitCode);
}

if (upToDate) {
  console.log(`run.md: Contents already up to date (${count} sections).`);
} else {
  writeFileSync(runbookUrl, after);
  console.log(`run.md: rewrote Contents (${count} sections).`);
}
