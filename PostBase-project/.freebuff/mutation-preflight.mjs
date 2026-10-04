#!/usr/bin/env node
/**
 * The sweep that keeps `preview:preflight`'s mid-session checks load-bearing.
 *
 * ## Why this exists
 *
 * `preview:preflight` grew checks for the states a probe cannot see — one for a lock
 * held by a process that is alive but not serving, one for a server that is up while the
 * browser tab showing it is gone, and one for a port held by *somebody else's* process,
 * which a reachability check reports as a healthy 200 — and each is only worth anything
 * if a test fails when the branch behind it is broken. A green suite looks the same whether a
 * test *pins* a branch or merely walks past it: deleting the branch and watching every
 * test still pass is the only way to tell those apart, and a reader cannot do it by
 * inspection, because the failing test is exactly the thing that is missing.
 *
 * So this sweeps a **committed table** of mutations: each entry rewrites one anchor in
 * the preflight — a branch condition, a verdict's status, a fix line's pointer, one exit
 * of the URL normalisation the tab check rests on — and requires the preflight's own
 * test file to fail. A mutation the suite does not notice is a **survivor**, and a
 * survivor is the failure this raises: the branch is no longer load-bearing, so the
 * check can rot back into decoration without any test going red.
 *
 * The table is not a numbered list of breakages for its own sake. Each entry is the
 * exact change a reader would most fear, and the `expect` field names the test that is
 * *supposed* to notice — so the sweep also catches the quieter rot: a case whose
 * mutation is caught, but by some other test, says the table's claim about which test
 * holds the branch has gone stale. That is reported, and the anchors' `expect` field is
 * checked against the test file's titles before anything runs (`--list`), because a
 * renamed test would otherwise turn a claim into a guess.
 *
 * ## What it is careful about
 *
 * It rewrites a real file (`.freebuff/preview-preflight.mjs`) one mutation at a time, so
 * it holds the shared lock (`.freebuff/mutation-lock.mjs`) while a file is mutated and
 * puts it back before the next entry. A `finally` runs nothing if the process is killed,
 * so a lock left behind is read by the *next* run — this one, the guard sweep or the
 * coverage mutation check, whichever comes first — and the file is restored from the
 * lock's own copy, which is the only record of what it looked like. Three refusals come
 * with that: a file edited by someone else while it was mutated is left alone rather
 * than clobbered (exit 2); an absorbed mutation whose restore from the recorded source
 * does not verify is refused rather than half-written (exit 2, from the shared
 * recovery); and a tree another tree-editing check is holding stops this run before it
 * touches anything (exit 3, from the shared recovery). An absorbed mutation whose
 * restore *does* verify is dealt with, not left: the file goes back to its pre-mutation
 * source, taking the mutation and the edit it sat on out together, and the run says so.
 *
 * ## Contract
 *
 * Exit codes: **0** every mutation was caught, **1** at least one survived, or the sweep
 * refused to begin — an anchor no longer fits, or a survivor kind its report cannot name
 * (both checked before the first mutation, and leaving a branch unchecked just the same),
 * **2** the run could not answer — a test run that wrote no report, a file that would
 * not go back, or a sweep asked for from inside a test run — and **3** another tree-editing
 * check holds the tree. `--json` replaces the human
 * report with one object on stdout (progress moves to stderr) — `{ gate, checked, cases,
 * caught, survivors, recovered, ... }`, the same `gate`/`checked`/`survivors` contract the
 * guard sweep and the coverage gate check answer, so a consumer needs no knowledge of
 * which check produced it.
 *
 * `--list` checks the table against the tree and runs nothing, which is the alarm a
 * source edit should hit first: an anchor that no longer occurs exactly once, or an
 * `expect` no test title carries any more, is reported per entry and exits 1.
 *
 * A table that no longer fits is a **refusal, not a skip, and it comes before the first
 * mutation**: every anchor is read up front — over the whole table, not the `--only`/
 * `--limit` slice, because a narrowed sweep may not report a pass while a case it skipped
 * holds no anchor — and a drifted one stops the run with exit 1 and a per-entry list before
 * the tree is touched, the shape the guard sweep's own anchor refusal takes. The same
 * start-up pass refuses a survivor the report cannot name: the kinds this sweep stamps and
 * the words its report declares (`SURVIVOR_WORDS`) are held to one set, either direction —
 * a stamp with no word is a survivor counted nowhere, a word with no stamp is a bucket
 * nothing can fill — so a run that cannot name what it found never begins. The loop's own
 * drifted-anchor guard stays behind it as the safety net for a source that moves mid-run.
 * `--only=<id>` runs a slice (comma-separated; each token matches an id
 * case-insensitively as a substring, and an unknown one is refused rather than quietly
 * narrowing the sweep), `--limit=<n>` runs the first `n`, and `--timeout=<ms>` caps each
 * test run so a hung child is reported rather than waited on.
 *
 * This is **opt-in** — a plain sweep is `N` Vitest processes, so it is a script to run
 * A real sweep **refuses to start from inside a Vitest process** (exit 2) unless
 * `MUTATION_PREFLIGHT_ALLOW_NESTED=1` says so deliberately, because a suite that starts
 * one cannot wait for it: the case times out, the child outlives it, and what is left is a
 * mutated preflight with no lock behind it. That is not hypothetical — it is how this
 * check once left the file it exists to protect rewritten, with every branch still
 * anchored, so the only way back was the pinned content itself. It cannot go quietly stale
 * either way: `.freebuff/gate-hashes.mjs` watches `mutation-*.mjs`, so this file is pinned,
 * and the CI runner's drift stage is keyed by the pin's own rules.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { clearLock, recoverInterruptedRun, writeLock } from "./mutation-lock.mjs";
// The save a mutation is allowed to take: text that balances, or nothing. It sits beside the
// lock because it is the other half of the same promise — the lock says how this file goes
// back, this says what may be written to it in the first place.
import { saveWholeScript } from "./whole-write.mjs";
// The survivor words this report declares, and the two-way comparison its start-up refusal
// acts on: declared once, in the vocabulary module the guard sweep and the coverage launcher
// read their own tables from. The sweep's stamps stay here — what counts as a stamp is this
// sweep's own shape — and the refusal stays here too, shaped to this payload.
import {
  PREFLIGHT_SURVIVOR_WORDS as SURVIVOR_WORDS,
  vocabularyHoles as vocabularyHolesOf,
} from "./mutation-vocabulary.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");

/** The project-relative, forward-slashed path a message names. */
const rel = (path) => relative(ROOT, path).split("\\").join("/");
const hash = (text) => createHash("sha1").update(text).digest("hex");

/**
 * The two files this sweep is about, overridable through `MUTATION_PREFLIGHT_TARGET` and
 * `MUTATION_PREFLIGHT_TEST` (absolute, or relative to the project). A **test seam** in
 * the shape of `MUTATION_LOCK_FILE`: `src/test/mutation-preflight.test.ts` drives the
 * anchor alarm against a scratch copy of either file, and no sweep ever sets them.
 */
const seam = (value, fallback) => (value ? (isAbsolute(value) ? value : join(ROOT, value)) : fallback);
const TARGET = seam(process.env.MUTATION_PREFLIGHT_TARGET, join(ROOT, ".freebuff", "preview-preflight.mjs"));
const TEST = seam(process.env.MUTATION_PREFLIGHT_TEST, join(ROOT, "src", "test", "preview-preflight.test.ts"));

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const recoverOnly = args.includes("--recover");
const vocabularyOnly = args.includes("--vocabulary");

/** `--json` emits one machine-readable object (progress moves to stderr). */
const JSON_OUTPUT = args.includes("--json");

/** Progress output: stdout by default, stderr under `--json` so stdout stays clean. */
const log = JSON_OUTPUT ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts);

function option(name) {
  const hit = args.find((arg) => arg.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
}

/** A usage error — the run cannot answer the question it was asked. */
function refuse(message) {
  console.error(`mutation-preflight: ${message}`);
  process.exit(2);
}

const limitRaw = option("--limit");
if (limitRaw !== undefined && !/^\d+$/.test(limitRaw)) {
  refuse(`--limit must be a number of mutations, got ${limitRaw}`);
}
const timeoutRaw = option("--timeout");
if (timeoutRaw !== undefined && !/^\d+$/.test(timeoutRaw)) {
  refuse(`--timeout must be a number of milliseconds, got ${timeoutRaw}`);
}
/** Each test run's budget. Generous: this check must not be flaky on a loaded box. */
const TIMEOUT_MS = timeoutRaw === undefined ? 120_000 : Number(timeoutRaw);

/**
 * The committed table.
 *
 * `find` must occur exactly once in the target: an anchor that drifted is reported as a
 * failure rather than guessed at, so a branch the table no longer fits is loud. `expect`
 * is the substring of the test title that is supposed to notice the break — checked
 * against the test file before anything runs, and against the failing titles afterwards.
 *
 * Ids are grouped by what they cover, so `--only=tab` is a slice and a group that
 * quietly emptied is visible in the report.
 */
const CASES = [
  // ---- the lock's pid, read three ways: dead, serving, and alive-but-silent
  {
    id: "health/no-live-pid",
    what: "dev server health: a dead lock pid is info, not a wedged server",
    find: "if (!lockPidAlive) {",
    replace: "if (false) {",
    expect: "keeps the stale-lock advice for a dead pid",
  },
  {
    id: "health/serving",
    what: "dev server health: a live pid whose own port answers is OK",
    find: '} else if (anyReachable) {\n  record("dev server health", "ok"',
    replace: '} else if (false) {\n  record("dev server health", "ok"',
    expect: "passes, so the wedged remedy never fires",
  },
  {
    id: "health/wedged",
    what: "dev server health: a live pid that answers nothing fails, naming the kill",
    find: "} else if (wedged) {",
    replace: "} else if (false) {",
    expect: "calls it wedged and names killing that process",
  },
  {
    id: "health/foreign-port",
    what: "dev server health: a probe aimed at another port judges nothing",
    find: "const wedged = lockPidAlive && !anyReachable && probedPortMatchesLock;",
    replace: "const wedged = lockPidAlive && !anyReachable;",
    expect: "does not judge a running server when the probe was aimed at another port",
  },
  {
    id: "health/other-port-detail",
    what: "dev server health: the not-its-port verdict says which port it read",
    find: "is running on :${lockPort}, and :${port} is not its port — nothing to judge",
    replace: "is running on :${lockPort} — nothing to judge",
    expect: "does not judge a running server when the probe was aimed at another port",
  },
  {
    id: "reach/fix-points-at-health",
    what: "a failed reach probe points at the wedged check, not at a launch that is refused",
    find:
      '    wedged\n      ? "the lock\'s process is alive but not serving — see the `dev server health` check"\n      : "npm run dev, then re-run this preflight",',
    replace: '    "npm run dev, then re-run this preflight",',
    expect: "points the reach failure at the health check",
  },

  // ---- the port's owner: whose server a probe actually reached
  {
    id: "owner/another-checkout-fails",
    what: "port owner: a listener that is not this checkout's fails, rather than passing on a 200",
    find: "const ownerIsThisCheckout = ownerIsLockPid || ownerRunsThisCheckout;",
    replace: "const ownerIsThisCheckout = true;",
    expect: "fails a port that answers from another checkout",
  },
  {
    id: "owner/names-the-process",
    what: "port owner: the failure carries the command line that says who took the port",
    find: 'const line = typeof commandLine === "string" ? commandLine.trim() : "";',
    replace: 'const line = "";',
    expect: "and names the process holding it",
  },
  {
    id: "owner/lock-pid-is-ours",
    what: "port owner: the pid the lock names needs no command line to be this checkout's",
    find: "const ownerIsLockPid = ownerPid !== null && ownerPid === lockPid;",
    replace: "const ownerIsLockPid = ownerPid !== null && false;",
    expect: "reads the lock's own pid as this checkout's server",
  },
  {
    id: "owner/runs-this-checkout",
    what: "port owner: a process whose command line is this checkout's is accepted with no lock",
    find: "return flat.includes(root);",
    replace: "return false;",
    expect: "accepts a server this checkout started that no lock names",
  },
  {
    id: "owner/unread-command-line",
    what: "port owner: a pid whose command line could not be read is not vouched for",
    find: '} else if (ownerCommand.state === "unknown") {',
    replace: "} else if (false) {",
    expect: "will not say what runs on the port",
  },
  {
    id: "owner/unidentified-is-not-a-pass",
    what: "port owner: a machine it could not read is info, never a pass",
    find: 'record("port owner", "info", `could not identify the listener on :${port} — ${listing.reason}`);',
    replace: 'record("port owner", "ok", `could not identify the listener on :${port} — ${listing.reason}`);',
    expect: "says it could not identify the listener",
  },
  {
    id: "owner/nothing-to-identify",
    what: "port owner: nothing answering is info, not a failure of the port",
    find: '"info",\n      `nothing answered on :${port}, so there is no listener to identify',
    replace: '"fail",\n      `nothing answered on :${port}, so there is no listener to identify',
    expect: "has no listener to identify when nothing answers",
  },
  {
    id: "health/another-owners-port",
    what: "dev server health: a port another process holds is not the lock's server serving",
    find: "} else if (answeredByAnother) {",
    replace: "} else if (false) {",
    expect: "does not call another process's port the lock's server",
  },

  // ---- the preview tab: each verdict the check can reach
  {
    id: "tab/unchecked",
    what: "preview tab: no --tab-state is info, never a pass",
    find: '    "info",\n    "not checked — this script cannot see a browser',
    replace: '    "ok",\n    "not checked — this script cannot see a browser',
    expect: "reports the tab unchecked when no tab state is supplied",
  },
  {
    id: "tab/bad-list",
    what: "preview tab: a tab list it cannot read fails loudly",
    find: 'record("preview tab", "fail", tabState.error, "pass the tab list as JSON, e.g. --tab-state=\'[]\'");',
    replace: 'record("preview tab", "info", tabState.error, "pass the tab list as JSON, e.g. --tab-state=\'[]\'");',
    expect: "fails loudly on a tab list it cannot read",
  },
  {
    id: "tab/ok-needs-a-tab",
    what: "preview tab: OK needs a tab on this port, not merely a reachable server",
    find: "if (anyReachable && onThisPort.length > 0) {",
    replace: "if (anyReachable) {",
    expect: "fails a server that answers with no tab pointing at it",
  },
  {
    id: "tab/gone",
    what: "preview tab: a server that answers with no tab pointing at it fails",
    find: '    } else if (anyReachable) {\n      record(\n        "preview tab",\n        "fail",',
    replace: '    } else if (false) {\n      record(\n        "preview tab",\n        "fail",',
    expect: "fails a server that answers with no tab pointing at it",
  },
  {
    id: "tab/died-behind-the-tab",
    what: "preview tab: a tab left on a port nothing answers on warns",
    find: "} else if (onThisPort.length > 0) {",
    replace: "} else if (false) {",
    expect: "warns when a tab is left open on a port nothing answers on",
  },
  {
    id: "tab/nothing-to-accuse",
    what: "preview tab: neither a tab nor a server on that port is info",
    find: "no tab points at :${port} and nothing answers there (see the reach checks)",
    replace: "nothing to report",
    expect: "stays quiet when neither a tab nor a server is on that port",
  },
  {
    id: "tab/tabs-shape",
    what: "the tab list is read from `{ tabs: [...] }`, not only from a bare array",
    find: "const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tabs) ? parsed.tabs : null;",
    replace: "const list = Array.isArray(parsed) ? parsed : null;",
    expect: "reads the same tab list from a file as from inline JSON",
  },
  {
    id: "tab/entry-shapes",
    what: "a tab entry is a URL string or carries `url`/`appUrl`, not `url` only",
    find: 'const url = typeof entry === "string" ? entry : (entry?.url ?? entry?.appUrl);',
    replace: "const url = entry?.url;",
    expect: "accepts the entry shapes a caller hands over",
  },
  {
    id: "tab/unreadable-file",
    what: "a tab state file that is not there names itself in the failure",
    find: "the tab state file ${source} could not be read",
    replace: "the tab state file ${source} could not be opened",
    expect: "a path that is not there",
  },

  // ---- the URL normalisation the tab comparison rests on
  {
    id: "loopback/brackets",
    what: "IPv6 loopback keeps its brackets in `hostname`, so they are stripped",
    find: 'const host = parsed.hostname.replace(/^\\[|\\]$/g, "");',
    replace: "const host = parsed.hostname;",
    expect: "reads a tab on IPv6 loopback as the same machine",
  },
  {
    id: "loopback/is-loopback",
    what: "a tab that is not loopback is not this preview, whatever its port",
    find: 'if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return null;',
    replace: "if (false) return null;",
    expect: "does not read a tab elsewhere",
  },
  {
    id: "loopback/parses",
    what: "a tab entry that is not a URL is not this preview, and must not throw",
    find: "  try {\n    parsed = new URL(url);\n  } catch {\n    return null;\n  }",
    replace: "  parsed = new URL(url);",
    expect: "does not read a tab elsewhere",
  },
  {
    id: "loopback/127-0-0-1",
    what: "`127.0.0.1` is the same machine as `localhost`",
    find: 'if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return null;',
    replace: 'if (host !== "localhost" && host !== "::1") return null;',
    expect: "passes when a tab is open on that port",
  },
  // ---- the human report's tail, which no `--json` case above ever reads
  //
  // This is the mutation the tail pin exists for: the `else` arm dropped whole. The file
  // still parses — an `if` without its `else` is valid — and every assertion the rest of
  // `preview-preflight.test.ts` makes reads the `--json` payload, which returns long before
  // this block runs. So without the pin the branch is a check nobody holds, and the mutation
  // survives. It is reported as a survivor, and the survivor is the point.
  {
    id: "report/register-sentence",
    what: "the human report: the registerable pass still says it is ready to register",
    find: "} else {\n  console.log(\n    `\\npreview-preflight: ready to register ${registerUrl}` +\n      ` (pid ${lockPid ?? \"unknown\"}` +\n      `${warnings.length > 0 ? `, ${warnings.length} warning(s)` : \"\"}).`,\n  );\n}",
    replace: "}",
    expect: "closes the report block it opened",
  },
];

/** How many times `find` occurs in `source` — 1 is the only healthy answer. */
const occurrencesOf = (source, find) => source.split(find).length - 1;

const anchorStatus = (source, item) => {
  const occurrences = occurrencesOf(source, item.find);
  return { occurrences, status: occurrences === 1 ? "unique" : occurrences === 0 ? "missing" : "ambiguous" };
};

/**
 * The survivor vocabulary: the words this sweep's report can name, no longer declared
 * here — they are the preflight table of the shared vocabulary module, imported above
 * under the local name `SURVIVOR_WORDS` so every sentence below keeps its spelling. A
 * stamp with no word is a survivor the report counts nowhere — its buckets filter on
 * exactly these words — and a word with no stamp is a repair the report claims and
 * nothing can reach. Both are refused at start-up, beside the anchor check, rather than
 * left for a run to discover: the same refusal the guard sweep makes over `STRIKE_WORDS`,
 * sized to this sweep's two kinds.
 */

/**
 * The survivor kinds this sweep's own source stamps, read rather than restated: every
 * `kind: "…"` literal, except the one in the sweep's own `writeLock({ ... })` call — the
 * lock's `kind` says what was being mutated for the lock's reader, which is that module's
 * schema, not this report's vocabulary.
 */
function stampedKinds(source) {
  const lockStart = source.lastIndexOf("writeLock({");
  const lockEnd = lockStart === -1 ? -1 : source.indexOf("});", lockStart);
  const stamps = new Set();
  for (const match of source.matchAll(/\bkind: "(\w+)"/g)) {
    if (lockStart !== -1 && match.index > lockStart && match.index < lockEnd) continue;
    stamps.add(match[1]);
  }
  return [...stamps];
}

/** The two ways the stamps and the declared words can disagree, read from this source. */
function vocabularyHoles(source) {
  return vocabularyHolesOf(SURVIVOR_WORDS, stampedKinds(source));
}

/**
 * The stamps with their sites: the same scan `stampedKinds` runs — lock's `kind` skipped for
 * the same reason — carrying the line number and text each match was read from, so the
 * vocabulary table can list what fills each bucket beside the bucket rather than count it
 * into a blur.
 */
function stampedSites(source) {
  const lockStart = source.lastIndexOf("writeLock({");
  const lockEnd = lockStart === -1 ? -1 : source.indexOf("});", lockStart);
  const lines = source.split("\n");
  const self = rel(fileURLToPath(import.meta.url));
  const sites = [];
  for (const match of source.matchAll(/\bkind: "(\w+)"/g)) {
    if (lockStart !== -1 && match.index > lockStart && match.index < lockEnd) continue;
    const line = source.slice(0, match.index).split("\n").length;
    sites.push({ file: self, line, word: match[1], text: (lines[line - 1] ?? "").trim() });
  }
  return sites;
}

/**
 * `--vocabulary`: the report-only table, the guard sweep's mode by the same name — each
 * declared word beside the stamps that fill its bucket, and any hole reported rather than
 * left for the refusal below. It answers before the anchor check and before the nested-run
 * guard, reading nothing but this sweep's own source and the shared table, so it says
 * whether a run would begin — never what a run would find — and exits 1 only when the
 * vocabulary is already a refusal.
 */
function vocabularyTable() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const sites = stampedSites(source);
  const { unnamed, unspoken } = vocabularyHoles(source);
  const holes = unnamed.length + unspoken.length;
  const exitCode = holes === 0 ? 0 : 1;
  const self = rel(fileURLToPath(import.meta.url));
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: ROOT,
          mode: "vocabulary",
          file: self,
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
  log("");
  log(
    `mutation-preflight: survivor vocabulary — ${Object.keys(SURVIVOR_WORDS).length} declared word(s), ` +
      `${new Set(sites.map((site) => site.word)).size} kind(s) stamped\n`,
  );
  for (const [word, entry] of Object.entries(SURVIVOR_WORDS)) {
    const filled = sites.filter((site) => site.word === word);
    log(`  "${word}" (${entry.mark}): ${filled.length} stamp(s) the bucket reads`);
    for (const site of filled) log(`      ${site.file}  line ${site.line}: ${site.text}`);
  }
  log(
    holes === 0
      ? "\n  every declared word is stamped, and every stamp names a declared word."
      : `\n  ${holes} vocabulary hole(s):`,
  );
  for (const kind of unnamed) {
    log(`    UNNAMED   a survivor stamped "${kind}" — SURVIVOR_WORDS does not declare it`);
  }
  for (const word of unspoken) {
    log(`    UNSPOKEN  the "${word}" word — declared, and no stamp can ever carry it`);
  }
  if (holes > 0) {
    console.error(
      `\nmutation-preflight: ${holes} vocabulary hole(s) — the next sweep would refuse before its ` +
        "first mutation; declare every kind a survivor can carry, and drop every word nothing stamps.",
    );
  }
  process.exit(exitCode);
}

/**
 * The cases `--only` selected, or every case when it was not asked for.
 *
 * Each token matches an id case-insensitively as a substring, so `--only=tab` is the tab
 * group; a token that matches nothing is refused with the ids that were available, since
 * a slice that silences the sweep must not read as a clean pass.
 */
function selectedCases() {
  const raw = option("--only");
  if (raw === undefined || raw.trim() === "") return CASES;
  const tokens = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) refuse("--only needs at least one id, e.g. --only=tab");
  const unknown = tokens.filter((token) => !CASES.some((item) => item.id.toLowerCase().includes(token)));
  if (unknown.length > 0) {
    refuse(
      `--only=${unknown.join(",")} matched no mutation (known ids: ${CASES.map((item) => item.id).join(", ")})`,
    );
  }
  return CASES.filter((item) => tokens.some((token) => item.id.toLowerCase().includes(token)));
}

/** Runs one test file and answers which of its tests failed. */
function runTest(file) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-preflight-"));
  const reportPath = join(dir, "report.json");
  try {
    const child = spawnSync(
      process.execPath,
      [VITEST, "run", rel(file), "--reporter=json", `--outputFile=${reportPath}`],
      { cwd: ROOT, encoding: "utf8", timeout: TIMEOUT_MS },
    );
    if (child.error?.code === "ETIMEDOUT") {
      return { inconclusive: true, reason: `the test run exceeded ${TIMEOUT_MS}ms and was stopped` };
    }
    if (child.error) {
      return { inconclusive: true, reason: `could not run ${rel(VITEST)}: ${child.error.message}` };
    }
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      return {
        inconclusive: true,
        reason: `the test run wrote no report — Vitest exited ${
          child.status ?? "on a signal"
        } without writing one`,
      };
    }
    const failed = [];
    for (const file of report.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) {
        if (assertion.status === "failed") failed.push(assertion.title ?? assertion.fullName ?? "(unnamed)");
      }
    }
    return { inconclusive: false, failed, total: report.numTotalTests ?? 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Checks the table against the tree without running anything.
 *
 * This is the cheap half of the sweep and the one an edit should hit first: it reads the
 * target to see whether each anchor still occurs exactly once, and the test file to see
 * whether each `expect` is still a substring of some title. Both halves matter — a
 * drifted anchor means the mutation cannot be applied at all, and a renamed test means
 * the table's claim about which case pins the branch is no longer a claim about anything.
 */
function listTable(cases) {
  const source = readFileSync(TARGET, "utf8");
  const testSource = readFileSync(TEST, "utf8");
  const rows = cases.map((item) => {
    const anchor = anchorStatus(source, item);
    return {
      id: item.id,
      what: item.what,
      status: anchor.status,
      occurrences: anchor.occurrences,
      expect: item.expect,
      expectPresent: testSource.includes(item.expect),
    };
  });
  const drifted = rows.filter((row) => row.status !== "unique" || !row.expectPresent);
  const exitCode = drifted.length === 0 ? 0 : 1;

  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        {
          target: rel(TARGET),
          test: rel(TEST),
          cases: CASES.length,
          selected: rows.length,
          gate: exitCode === 0 ? "pass" : "fail",
          exitCode,
          anchors: rows,
          drifted: drifted.map((row) => row.id),
        },
        null,
        2,
      )}\n`,
    );
    process.exit(exitCode);
  }

  log(
    `mutation-preflight: ${rows.length} of ${CASES.length} mutation(s) in ${rel(TARGET)}, ` +
      `tested by ${rel(TEST)}\n`,
  );
  for (const row of rows) {
    const mark = row.status === "unique" && row.expectPresent ? "ok      " : "DRIFTED ";
    log(`  ${mark}  ${row.id.padEnd(28)}  ${row.what}`);
    if (row.status !== "unique") {
      // The same builder the refusal and the loop's guard read, so the anchor reason is
      // spelled one way whatever mode reports it. `reasonLines` reads the survivor shape,
      // so the table row wears it here.
      for (const line of reasonLines(brokenAnchor({ item: row, occurrences: row.occurrences }))) {
        log(`            ${line}`);
      }
    }
    if (!row.expectPresent) {
      log(`            no test title carries "${row.expect}" any more`);
    }
  }
  log(
    `\n${rows.length} mutation(s): ${rows.length - drifted.length} fit the tree and name a test that exists.`,
  );
  if (drifted.length > 0) {
    console.error(
      `\nmutation-preflight: ${drifted.length} mutation(s) no longer fit the tree — re-anchor the table ` +
        "against the source it now has, and the test it now names, rather than leaving a branch unchecked.",
    );
  }
  process.exit(exitCode);
}

// Whatever an interrupted run left mutated goes back before anything reads the target:
// the lock is the only record of what it looked like. What that did is kept — not only
// printed — so the report below can carry it. `--recover` stops here, which is how a tree
// is put back without paying for the sweep.
const recovered = recoverInterruptedRun();
if (recoverOnly) {
  console.error("mutation-preflight: recovery only — no mutation was applied.");
  process.exit(0);
}

// `--vocabulary` answers here, where `--recover` does: before the selector, the anchor check
// and the nested-run guard, reading nothing but this sweep's own source and the shared table —
// so it says whether a run would begin, never what a run would find, and never touches a file.
if (vocabularyOnly) vocabularyTable();

// The selector is read before either mode, so `--only=<unknown>` fails loudly whether the
// caller asked for the table or for a sweep — a slice that silences the run must not read
// as a clean pass, and `--list --only=tab` is the slice without paying for a sweep.
const plan = selectedCases().slice(0, limitRaw === undefined ? Infinity : Number(limitRaw));

if (listOnly) listTable(plan);

// A real sweep refuses to start from inside a Vitest process. It rewrites the preflight one
// branch at a time for minutes, and a suite that starts one cannot wait for it: the case
// times out, the child outlives it, and what is left is a mutated preflight with no lock
// behind it. A test that wants a stage sweeps a *stub* (`CI_MUTATION_PREFLIGHT_SCRIPT`), and
// one that really means it opts in by name.
if (
  (process.env.VITEST || process.env.VITEST_WORKER_ID) &&
  process.env.MUTATION_PREFLIGHT_ALLOW_NESTED !== "1"
) {
  refuse(
    "refusing to sweep from inside a Vitest run — a real sweep rewrites the preflight for " +
      "minutes and would outlive the case that started it (stub the stage instead, via " +
      "CI_MUTATION_PREFLIGHT_SCRIPT). Set MUTATION_PREFLIGHT_ALLOW_NESTED=1 to sweep anyway.",
  );
}

/**
 * The `--json` object, built in one place so the refusal below writes the same shape a
 * finished sweep does. `checked`/`caught`/`survivors` are this run's facts; a refusal is the
 * same object with nothing checked and the drifted anchors as its survivors.
 */
function sweepPayload({ checked, caught, survivors, exitCode }) {
  return {
    root: ROOT,
    target: rel(TARGET),
    test: rel(TEST),
    cases: CASES.length,
    selected: plan.length,
    checked,
    gate: exitCode === 0 ? "pass" : "fail",
    exitCode,
    recovered: recovered ? [recovered] : [],
    caught: caught.map((item) => ({
      id: item.id,
      path: item.path,
      descriptor: item.descriptor,
      test: item.test,
      total: item.total,
      margin: item.margin,
      named: item.named,
      caughtBy: item.caughtBy,
    })),
    survivors,
  };
}

/**
 * The reason vocabulary, one spelling per reason: `reasonLines` builds the words the report
 * prints from the survivor object the `--json` payload carries, so the two cannot come to
 * mean different things. The start-up refusal, the `--list` table and the loop's own guard
 * all read these builders — a reason re-phrased at one of them is a disagreement the cases
 * red rather than two truthful-sounding sentences.
 */
function reasonLines(survivor) {
  switch (survivor.kind) {
    case "survived":
      return [
        `all ${survivor.total} test(s) passed with this branch broken`,
        `${rel(TEST)} is expected to fail here and did not`,
      ];
    default:
      // A `broken` survivor's `detail` is the sentence — built once where the survivor is
      // built (`brokenAnchor` for an anchor, the loop for an inconclusive run) — so this
      // reads it back rather than holding a second copy of the words.
      return [survivor.detail];
  }
}

/** A drifted anchor as the survivor-shaped entry the report and `--json` already speak. */
function brokenAnchor(row) {
  return {
    path: rel(TARGET),
    line: null,
    id: row.item.id,
    kind: "broken",
    descriptor: row.item.what,
    // Why it cannot be applied: the reason word the report reads (`reasonLines`) plus the
    // numbers the sentence interpolates, so the refusal, the table and the payload print
    // one spelling.
    reason: "anchor",
    occurrences: row.occurrences,
    detail: `its anchor occurs ${row.occurrences} time(s), expected exactly 1`,
  };
}

/** A vocabulary hole as the survivor-shaped entry the report and `--json` already speak. */
function holeSurvivor(id, descriptor, detail) {
  return {
    path: rel(fileURLToPath(import.meta.url)),
    line: null,
    id,
    kind: "broken",
    descriptor,
    detail,
  };
}

/**
 * The start-up refusal: every reason this sweep may not begin — a mutation whose anchor
 * has left the target, and a survivor vocabulary its own stamps and declared words
 * disagree over — gathered into one report and one exit, rather than exiting on the
 * first. The reasons are computed together because a run told one reason would fix it,
 * re-run, and be told the next, with no way to learn how many there were; the loop's own
 * drifted-anchor guard stays behind it as the safety net for a source that moves mid-run,
 * and stamps the same `brokenAnchor` shape, so the two cannot drift into saying different
 * things. Under `--json` it writes the report a consumer already reads — `checked: 0`,
 * every reason a `broken` survivor — so the runner names the cause instead of a parse
 * failure.
 */
function refuseStartUp({ unnamed = [], unspoken = [], unanchored = [] }) {
  const holes = unnamed.length + unspoken.length;
  const reasons = holes + unanchored.length;
  if (JSON_OUTPUT) {
    process.stdout.write(
      `${JSON.stringify(
        sweepPayload({
          checked: 0,
          caught: [],
          survivors: [
            ...unnamed.map((kind) =>
              holeSurvivor(
                kind,
                `a survivor stamped "${kind}"`,
                `it stamps kind "${kind}", which SURVIVOR_WORDS does not declare`,
              ),
            ),
            ...unspoken.map((word) =>
              holeSurvivor(
                word,
                `the "${word}" word`,
                "SURVIVOR_WORDS declares it, and no survivor can ever carry it",
              ),
            ),
            ...unanchored.map(brokenAnchor),
          ],
          exitCode: 1,
        }),
        null,
        2,
      )}\n`,
    );
  }
  log("");
  log(
    `mutation-preflight: START-UP REFUSAL (${reasons}) — refusing before the first mutation; this run mutates nothing until every reason below is repaired:`,
  );
  if (holes > 0) {
    log("");
    log(
      `  VOCABULARY HOLES (${holes}) — the kinds this sweep stamps and the words its report declares are not the same set:`,
    );
    for (const kind of unnamed) {
      log(`    - kind "${kind}"`);
      log("      it stamps a kind SURVIVOR_WORDS does not declare, so the report counts a survivor under it nowhere");
    }
    for (const word of unspoken) {
      log(`    - the "${word}" word`);
      log("      SURVIVOR_WORDS declares it, and no survivor can ever carry it");
    }
  }
  if (unanchored.length > 0) {
    log("");
    log(
      `  UNANCHORED MUTATIONS (${unanchored.length}) — the table's own mutations, which no longer fit ${rel(TARGET)}:`,
    );
    for (const row of unanchored) {
      log(`    - ${row.item.id}  ${row.item.what}`);
      // Same builder the `--list` table and the payload read: one spelling per reason.
      for (const line of reasonLines(brokenAnchor(row))) log(`      ${line}`);
    }
  }
  console.error(
    `\nmutation-preflight: ${reasons} start-up refusal(s) — re-anchor the entries that no longer fit the ` +
      "tree, and declare every kind a survivor can carry: a branch the report cannot name is a branch " +
      "held by nothing while every test stays green. Nothing was mutated.",
  );
  process.exit(1);
}

// Every anchor in the table is read before the first mutation, not only the one a case is
// about to apply. The loop below reports a drifted anchor as a `broken` survivor and fails
// the run, but by then the cases before it have already been rewritten and swept — minutes
// of the tree being mutated for a verdict that was decided before the run began. A table
// that no longer fits the source is a fact about the *table*, so it is answered once, up
// front, over every case rather than the slice `--only`/`--limit` left: a narrowed sweep may
// not report a pass while a case it skipped holds no anchor (the same whole-set read the
// guard sweep makes). Nothing is written before this — the tree is whole when it speaks.
const tableSource = readFileSync(TARGET, "utf8");
const unanchored = CASES.map((item) => ({ item, ...anchorStatus(tableSource, item) })).filter(
  (row) => row.status !== "unique",
);
// The vocabulary is read from this sweep's own source, whole — there is no slice that
// narrows it — so a narrowed run refuses a hole in a kind it would never have stamped.
const { unnamed, unspoken } = vocabularyHoles(readFileSync(fileURLToPath(import.meta.url), "utf8"));
if (unanchored.length > 0 || unnamed.length > 0 || unspoken.length > 0) {
  refuseStartUp({ unnamed, unspoken, unanchored });
}

// The hash the end-of-run check compares against: taken after the anchor refusal so a table
// that does not fit never reaches the sweep, and before the first write either way.
const targetHashAtStart = hash(readFileSync(TARGET, "utf8"));

// The active mutation, so the signal handlers below can put it back: a `finally` runs
// nothing when the process is killed, and a mutated preflight left on disk is exactly the
// failure this check exists to catch.
let active = null;
function restoreAndExit(signal) {
  if (active) {
    try {
      writeFileSync(active.path, active.original);
      console.error(`\n${signal}: restored ${rel(active.path)} before exiting.`);
    } catch (error) {
      console.error(`\n${signal}: could NOT restore ${rel(active.path)}: ${error.message}`);
      console.error("The lock remains; the next run will retry the restore.");
      process.exit(130);
    }
  }
  clearLock();
  process.exit(130);
}
process.on("SIGINT", () => restoreAndExit("SIGINT"));
process.on("SIGTERM", () => restoreAndExit("SIGTERM"));

const caught = [];
const survivors = [];
let checked = 0;

log(`mutation-preflight: ${plan.length} mutation(s) against ${rel(TARGET)} via ${rel(TEST)}\n`);

for (const item of plan) {
  checked += 1;
  const original = readFileSync(TARGET, "utf8");
  const anchor = anchorStatus(original, item);
  const prefix = `[${checked}/${plan.length}]`;

  // The up-front refusal has already read every anchor, so this fires only when the source
  // moved between that read and this case — a concurrent edit. It is the same refusal in the
  // same shape (`brokenAnchor`), and a survivor rather than a skip for the same reason: the
  // mutation that would have proved this branch load-bearing did not run, so the branch is
  // unchecked — how a gate disappears without anyone lowering a number.
  if (anchor.status !== "unique") {
    const survivor = brokenAnchor({ item, occurrences: anchor.occurrences });
    survivors.push(survivor);
    log(`${prefix} ?          ${item.id}  ${item.what}`);
    for (const line of reasonLines(survivor)) log(`             ${line}; not applied`);
    continue;
  }

  const mutated = original.replace(item.find, item.replace);
  const mutatedHash = hash(mutated);
  writeLock({
    check: "preflight sweep",
    path: TARGET,
    kind: "mutation",
    where: item.id,
    original,
    mutated,
  });
  // The save a mutation is allowed to take. A `replace` that would leave the preflight
  // unbalanced is a broken entry rather than a branch to break: the suite would fail to
  // *load* the file, and a load failure reads exactly like a caught mutation — a false pass.
  // The lock goes back because nothing was written, so a refusal leaves the tree as found.
  try {
    saveWholeScript(TARGET, mutated);
  } catch (error) {
    clearLock();
    console.error(`\nmutation-preflight: ${error.message}`);
    console.error("Re-fit this entry's `replace`; nothing was mutated.");
    process.exit(1);
  }
  active = { path: TARGET, original };

  let outcome;
  try {
    outcome = runTest(TEST);
  } finally {
    const current = readFileSync(TARGET, "utf8");
    if (hash(current) !== mutatedHash) {
      console.error(
        `\nSTOP: ${rel(TARGET)} changed underneath the sweep; left as it is now. ` +
          "The mutation may have been absorbed into the new content rather than replaced — " +
          "inspect it by hand before trusting this file.",
      );
      process.exit(2);
    }
    writeFileSync(TARGET, original);
    if (hash(readFileSync(TARGET, "utf8")) !== hash(original)) {
      console.error(`\nSTOP: could not restore ${rel(TARGET)}.`);
      process.exit(2);
    }
    clearLock();
    active = null;
  }

  if (outcome.inconclusive) {
    const survivor = {
      path: rel(TARGET),
      line: null,
      id: item.id,
      kind: "broken",
      descriptor: item.what,
      detail: outcome.reason,
    };
    survivors.push(survivor);
    log(`${prefix} ?          ${item.id}  ${item.what}`);
    for (const line of reasonLines(survivor)) log(`             ${line}`);
    continue;
  }

  if (outcome.failed.length === 0) {
    const survivor = {
      path: rel(TARGET),
      line: null,
      id: item.id,
      kind: "survived",
      descriptor: item.what,
      total: outcome.total,
      // The payload's `detail` folds both reason lines into one sentence; the report prints
      // the lines from `reasonLines`, so the words live here once.
      detail: `all ${outcome.total} test(s) passed with this branch broken, so ${rel(TEST)} no longer pins it`,
    };
    survivors.push(survivor);
    log(`${prefix} SURVIVED   ${item.id}  ${item.what}`);
    // The survivor's own reason lines — the ones the payload carries — so the mid-run
    // report and the end-of-run report read one spelling.
    for (const line of reasonLines(survivor)) log(`             ${line}`);
    continue;
  }

  // Caught. The named test is the table's claim about *which* case holds the branch, so
  // a catch by some other test is reported: the branch is load-bearing, but the claim
  // beside it is stale.
  const named = outcome.failed.some((title) => title.includes(item.expect));
  caught.push({
    path: rel(TARGET),
    id: item.id,
    descriptor: item.what,
    test: rel(TEST),
    total: outcome.total,
    margin: outcome.failed.length,
    caughtBy: outcome.failed,
    named,
  });
  log(`${prefix} caught     ${item.id}  ${item.what}`);
  log(`             caught by ${outcome.failed.length} of ${outcome.total}: ${outcome.failed.join("; ")}`);
  if (!named) {
    log(`             note: no failing title carries "${item.expect}" — the table's claim has drifted`);
  }
}

// The target is put back after every entry, so anything different here is someone else's
// edit arriving mid-sweep: the table's anchors are now statements about a file that no
// longer exists, and the run says so rather than reporting a verdict about the old one.
if (hash(readFileSync(TARGET, "utf8")) !== targetHashAtStart) {
  console.error(
    `\nSTOP: ${rel(TARGET)} differs from the source this sweep started with — a concurrent edit? ` +
      "Re-run to sweep the file as it is now, and inspect it by hand first: a mutation this " +
      "sweep applied may have been absorbed into that edit rather than replaced by it.",
  );
  process.exit(2);
}

const caughtElsewhere = caught.filter((item) => !item.named);
const exitCode = survivors.length === 0 ? 0 : 1;

if (JSON_OUTPUT) {
  process.stdout.write(`${JSON.stringify(sweepPayload({ checked, caught, survivors, exitCode }), null, 2)}\n`);
  process.exit(exitCode);
}

log("");
log(`Checked ${checked} mutation(s).`);
if (survivors.length === 0) {
  log("Every branch was caught by a test that names it.");
} else {
  // One bucket per declared word, in the table's order: these are the words the start-up
  // refusal holds the stamps to, so a survivor under an undeclared kind cannot reach this
  // loop — it is refused before the first mutation instead.
  for (const [kind, word] of Object.entries(SURVIVOR_WORDS)) {
    const items = survivors.filter((item) => item.kind === kind);
    if (items.length === 0) continue;
    log(`\n${word.mark} (${items.length}) — ${word.why}:`);
    for (const item of items) log(`    - ${item.id}  ${item.descriptor}\n      ${item.detail}`);
  }
}
if (caughtElsewhere.length > 0) {
  log(
    `\nNote: ${caughtElsewhere.length} mutation(s) were caught by a test other than the one the table names — ` +
      "the branch is load-bearing, but the claim beside it has drifted:",
  );
  for (const item of caughtElsewhere) log(`    - ${item.id}  expected "${item.expect}"`);
}
if (caught.length > 0) {
  log(`\nCaught (${caught.length}): ${caught.map((item) => item.id).join(", ")}`);
}

process.exit(exitCode);
