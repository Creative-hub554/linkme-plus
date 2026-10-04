# Exploration: Can `--stages=json` drive a lint rule for stale manual stage lists?

## Question

> Can `--stages=json` drive a lint rule that flags stale manual stage lists in source comments?

## Current state

`node .freebuff/ci.mjs --stages=json` already emits machine-readable JSON:

```json
{
  "stages": [
    "typecheck", "runbook", "lint", "test", "preflight",
    "drift", "mutation-example", "mutation-coverage",
    "mutation-preflight", "mutation"
  ],
  "count": 10
}
```

The runner already **uses** this output as input to its own stage-order audit. The `--stages=check` mode reads `STAGE_NAMES` from the table in `.freebuff/gate-drift.mjs` (line 625), and `stageOrderFindings()` in `.freebuff/ci.mjs` (line ~3180) compares every watched file's copy of the order against that table.

## The detection logic already exists

`ci.mjs` already contains all the machinery needed to flag a stale manual stage list, at lines ~3070–3240:

| Function | Purpose | Lines |
|---|---|---|
| `stageNameRuns(line)` | Extracts every maximal comma-run of stage names from a line | ~3060 |
| `inCanonicalOrder(names)` | Returns `true` when a run matches `STAGE_NAMES` order | ~3067 |
| `readStageEnumeration(text)` | Parses the numbered ` * N. \`name\`` list in `ci.mjs`'s header | ~3115 |
| `readStageOrderBlock(text)` | Reads the `<!-- stage-order:begin/end -->` generated block | ~3102 |
| `stageOrderFindings()` | Orchestrates the full audit over `STAGE_ORDER_FILES` | ~3180 |

The `stageOrderFindings` loop (line ~3220) iterates over every line of every watched file and, for lines that "speak" about stages (match `/stage/i` or `--(only|skip|from)`), runs `stageNameRuns()` and `inCanonicalOrder()`, producing `order` and `count` findings. **This is already a stale-list detector — it just only runs on 6 files.**

## What `STAGE_ORDER_FILES` currently watches

Defined at `ci.mjs:3026`, these 6 files already cover the known copies:

```typescript
const STAGE_ORDER_FILES = [
  { file: ".freebuff/ci.mjs", generated: true, enumerated: true },
  { file: ".freebuff/run.md", generated: true },
  { file: STAGE_TABLE_FILE },  // .freebuff/gate-drift.mjs
  { file: "src/test/ci-runner.test.ts" },
  { file: "src/test/ci-runner-tree-editing.test.ts" },
  { file: ".github/workflows/nightly.yml" },
];
```

## The gap: files not in the watch list

A codebase-wide search for full stage-order lists (`typecheck.*runbook.*lint.*test.*preflight...`) found matches **only** in the 6 watched files. The remaining references are:

- **Partial lists in `ci-runner.test.ts`** (e.g., "would run 3 stage(s): typecheck, lint, test") — these are *intentionally* partial because they test `--only`/`--skip` selection. The `order` check in `stageOrderFindings` only fires when `run.length > 1` and the run is out of canonical order, so partial subsets like "typecheck, test" (which is in canonical order as a subsequence) pass cleanly.
- **Prose mentions** in `docs/proposal-derived-import-closure.md` ("ten stage(s)") — just a count reference, no name list. Not a stale-list risk.
- **`--skip=preflight`** in `nightly.yml` — a single stage name, not a list.
- **`mutation-guards.mjs` prose** (line ~843) — describes the audit, doesn't restate the order.

**Conclusion: there are currently no stale manual stage lists outside the watch list.** The existing `STAGE_ORDER_FILES` covers every place the order is stated. The risk a new lint rule would mitigate is *future* files — someone adds a new doc or comment that restates the order and never adds it to `STAGE_ORDER_FILES`.

## Three approaches to bridging that gap

### Approach A: Extend `ci.mjs` with a `--stages=check --glob` mode

**How:** Add a `--watch-glob=<pattern>` flag that makes `stageOrderFindings()` scan additional files beyond `STAGE_ORDER_FILES`. Reuse the existing `stageNameRuns` / `inCanonicalOrder` / "speaks" filter. Output findings the same way `--stages=check` does.

**Pros:**
- Zero new infrastructure: reuses all existing detection logic, output format, and the `--stages=json` machine contract.
- Consistent with the project's philosophy: "the stage order is stated once, and every copy is compared to the table."
- Can be a new CI stage (`lint`-adjacent, cheap, read-only) rather than an ESLint rule — fitting the pattern where `lint-baseline.mjs` and `gate-drift.mjs` are standalone scripts invoked by the runner.
- No ESLint integration complexity.

**Cons:**
- The `--stages=write` generator only rewrites files in `STAGE_ORDER_FILES` (by design — "a file with no marker is the author's"). A glob scan would find lists it cannot auto-repair.

### Approach B: ESLint custom rule reading a cached `--stages=json` snapshot

**How:** Write a custom ESLint rule that, for every `Program` node, scans `LeadingComment` and `TrailingComment` text for stage-name runs. The rule reads the canonical order from a cached JSON file (e.g., `.freebuff/stage-order.json`) rather than spawning a subprocess per file.

**The caching problem:** ESLint runs one process for the whole project, but the rule's `create()` is called per-file. Spawning `node .freebuff/ci.mjs --stages=json` inside `create()` would fork a subprocess for every source file — unacceptable overhead (~50ms × thousands of files). A snapshot file avoids this:

```bash
# Regenerated by --stages=write or a dedicated command
node .freebuff/ci.mjs --stages=write  # writes .freebuff/stage-order.json too
```

**Pros:**
- Integrate with `npm run lint:ci` — catches stale lists at lint time, not just at CI gate time.
- ESLint gives file/line/column in standard output format.
- Familiar to contributors.

**Cons:**
- **False positives are severe.** `ci-runner.test.ts` alone has ~20 assertion strings containing full or partial stage lists (e.g., `"would run 10 stage(s): typecheck, runbook, lint, test, preflight, drift, mutation-example, mutation-coverage, mutation-preflight, mutation"`).
  A naive rule scanning `Line` comments would fire on string literals in test assertions.
- **Snapshot staleness:** If someone adds a stage, they must remember to regenerate `.freebuff/stage-order.json`. The existing `--stages=write` command is the regeneration trigger — and as of this exploration it *does* write the snapshot alongside the two marked generated blocks, so regenerating one regenerates both. `--stages=check` verifies the snapshot itself whenever the tree carries one (a `snapshot` finding, and a run refuses on it like any other copy), and `src/test/ci-stage-order.test.ts` holds both that finding and the file's existence, so a stale or missing copy fails loudly rather than lying to the reader. The file is also a pinned gate file — a watch rule of its own in `DEFAULT_WATCHES` in `.freebuff/gate-drift.mjs` — which closes the gap the contents check cannot: that check compares *parsed* values, so a byte-level hand edit it would not see (a stray newline, a reformat) still fails `gates:drift` as a `changed` finding, with the drift stage re-keyed by the same rule.
- **ESLint flat config complexity:** This project uses `eslint.config.mjs` with `FlatCompat` bridging Next.js configs. Adding a custom rule requires defining the rule object, registering it via `plugins`, and configuring it — all in the flat config format. No custom rule currently exists in the project (all rules are from `next/core-web-vitals` or `@typescript-eslint`).
- **No precedent.** The project's convention guards (`convention-guards.ts`) deliberately avoid ESLint and instead operate as raw source-text detectors driven by test cases. An ESLint rule would break that pattern.

### Approach C: A `convention-guard` for stage lists (following existing patterns)

**How:** Extend `src/test/convention-guards.ts` — which already contains pure source-text detectors (like `rawMountCalls`, `contentsDrift`) — with a `staleStageLists(source, canonicalOrder)` detector. The canonical order comes from `--stages=json` at test time (the test spawns the runner, the same pattern `ci-stage-order.test.ts` already uses). The guard scans only comment text, not string literals.

**Pros:**
- **Fits the project's existing pattern.** `convention-guards.ts` is explicitly "detectors behind the convention guards" — pure functions that take source text and return findings, each driven by a test case with a "fires on the shape it exists to catch" fixture. `convention-guards.test.ts` drives every guard against both a forbidden shape and a clean one, so a guard that stops firing fails there rather than silently passing.
- **No ESLint integration** needed — runs as part of the vitest suite (the `lint` stage).
- **Comment-only scanning** is natural for a source-text detector: strip strings, scan what remains.
- **Self-documenting** — the guard file's header explains what it catches and why; the test case includes the forbidden fixture.
- **Self-checking** — `convention-guards.test.ts` already holds every guard against both a stale and clean fixture, so the guard itself is doc-freshness held.

**Cons:**
- Only catches issues at test time, not at `npm run lint` time.
- Would need a `--stages=json` subprocess per test run (but `ci-stage-order.test.ts` already does this, so the pattern is established and fast).

## Assessment

**Can `--stages=json` drive such a lint rule?** **Yes.** The JSON is stable, machine-readable, and already consumed by the runner's own audit for the same purpose. The detection logic (`stageNameRuns`, `inCanonicalOrder`, the "speaks" filter) already exists in `ci.mjs` and could be extracted or reused.

**Should it be an ESLint rule?** Not necessarily. The project already has:

1. A `STAGE_ORDER_FILES` mechanism in `ci.mjs` that checks exactly the right things (generated blocks, numbered enumerations, count-vs-list, order) against the source table — this is the primary defense and it already works on 6 files.
2. A `convention-guards.ts` / `convention-guards.test.ts` pattern for source-text detectors that operate outside ESLint.
3. A `doc-freshness.ts` pattern for holding quoted needles against source files (including the new `ci-stage-order-doc-freshness.test.ts` just added).

**The most natural fit** is **Approach A or C**: extend the existing stage-order audit (Approach A — a new `--stages=check` mode that scans a glob) or add a `convention-guard` detector (Approach C — following `convention-guards.ts`). Both avoid the false-positive trap of scanning test assertions, both reuse existing detection logic, and both fit the project's "stated once, copies compared" philosophy.

**If an ESLint integration is specifically desired**, the snapshot-caching approach (Approach B) is viable but requires careful false-positive handling (comment-only scanning, exclusion of test assertion strings) and introduces ESLint flat-config complexity with no existing precedent in the repo.

## Recommendation

**Extend the existing `--stages=check` audit** rather than adding a new ESLint rule. Add a `--watch-glob=<pattern>` opt to `stageOrderFindings()` that scans additional files using the same `stageNameRuns` / `inCanonicalOrder` / "speaks" filter. This:

- Reuses all existing detection logic (no new detectors to write).
- Follows the "stated once, copies compared" design already documented in `ci.mjs` prose.
- Is cheap (read-only, no subprocess-per-file).
- Can be a new CI stage or a `npm run` script, not an ESLint phase.
- Avoids the false-positive problem (test assertions are already handled by the "speaks" filter + `run.length > 1` + `inCanonicalOrder` check).

If a contributor specifically wants in-suite feedback, the `convention-guards.ts` pattern (Approach C) is the project-idiomatic way to add a source-text check that runs with the suite.

**Implemented:** `npm run stages:lint` runs the audit with `--commentary` and `--watch-glob=docs/**/*.md,.github/workflows/*.y*ml`, and both `lint` and `lint:ci` chain it — so the scans run at lint time, locally and in the CI lint job. A case in `src/test/ci-stage-order.test.ts` reads those globs and that flag back out of the script and holds the committed tree green under them, so the wiring and the scan cannot drift apart silently.

**Approach C landed too, and then moved into the audit:** `staleStageLists(source, canonicalOrder)` in `src/test/convention-guards.ts` is the guard — comment-only, because a list an assertion string or the code carries is data rather than a claim. The tree-wide reading now lives in the runner itself: `--stages=check --commentary` walks every source file outside a build, cache or duplicate-checkout directory, blanks strings and code through a port of the suite's own lexer, and runs the same line-level checks over what is left — with a `scanned` count in the JSON report so an empty finding list can be held to a tree that was really read. The vitest half holds that answer rather than re-deriving it: the committed tree green with `scanned` above 300, a probe file whose stale comment is reported line for line against `staleStageLists` while the same list inside a string or code is not, and the control cases pinning the suite-side detector. Three runner strikes in `.freebuff/mutation-guards.mjs` — the walk, the comment-only reading, the wholesale drop — plus the detector's own comment-only limb keep both readings honest, all declared in `src/test/declared-strikes.ts` beside the runner's other strikes.

---

### Files consulted

- `.freebuff/ci.mjs` — `stageOrderFindings()`, `stageNameRuns()`, `inCanonicalOrder()`, `STAGE_ORDER_FILES`, `STAGE_ORDER_BEGIN/END`, `--stages=json` mode
- `.freebuff/gate-drift.mjs` — `STAGE_NAMES` export (line 625), `STAGE_TABLE` declaration
- `src/test/ci-stage-order.test.ts` — `lastEnumeratedLine()`, `generatedLine()`, `blockLine()`, `WATCHED_FILES`
- `src/test/ci-stage-order-doc-freshness.test.ts` — the doc-freshness suite just added for this helper
- `src/test/convention-guards.ts` — existing source-text detector pattern
- `eslint.config.mjs` — flat config, no custom rules
- `.github/workflows/nightly.yml` — no stage list; uses `--skip=preflight`
- `package.json` — `npm run` scripts for `stages`, `stages:check`, `stages:lint`, `stages:write`, `lint`, `lint:ci`
