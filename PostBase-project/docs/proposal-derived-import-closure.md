# Proposal: derived import closures for gate cache keys

**Status:** implemented in the working tree (all six files edited, pins refreshed, suite green).
This document is the review record. If review rejects the design, follow the
[Revert plan](#revert-plan) — it is a plain working tree with no git history yet, so
reverting means undoing the edits listed there, not `git checkout`.

**Date:** 2026-10-01
**Files touched:** `.freebuff/import-closure.mjs` (new), `.freebuff/ci.mjs`,
`.freebuff/gate-drift.mjs`, `.freebuff/gate-hashes.mjs` (re-pinned, 44 → 45 entries),
`src/test/ci-runner.test.ts` (slimmed), `src/test/import-closure.test.ts` (new)

## Problem

`ci.mjs` keys each stage with `stageKey = sha256(globalKey + inputs text + hashPaths(files))`,
where `files` was the stage's hand-maintained `inputs` list. Gate scripts import sibling
modules (`ci.mjs` ← its helpers, `gate-drift.mjs` ← `gate-hashes.mjs`, `whole-write.mjs` ←
…), but a change to an imported module only re-keyed a stage if someone remembered to add
that module to `inputs`. Hand-maintained transitive lists rot silently: a stage keeps its
old cache key and a run that "passed" can be a cached no-op against gate code that changed.

The existing mitigation was a test-side invariant in `ci-runner.test.ts` that walked the
module graph with its own private walker and asserted every stage covered its closure.
That duplicated the walker logic outside the pinned gate files and could drift from reality
(it was the only copy of the contract, and nothing forced the runner and the test to agree).

## Design

Move the module walk into one shared, pinned module and make each stage's key derive from it.

### `.freebuff/import-closure.mjs`

Exports `importClosure(script, read = defaultRead, seen)`: returns the set of repo-relative
paths reachable from a starting script, including the script itself.

Walker contract:

- Follows only **literal double-quoted relative `*.mjs` specifiers** in `from`/`import`
  positions (single regex, no parser). Single-quoted imports are not read — that is the
  existing lint-enforced convention in `.freebuff/`, now load-bearing.
- Drops comment lines before matching.
- An unreadable file contributes itself and stops (no throw).
- Insertion order is discovery order, so output is deterministic.
- **Invisible by design:** computed specifiers such as `import(pathToFileURL(...))` are not
  followed. Any dynamically loaded module must instead be named in a stage's `inputs` —
  that is how `gate-hashes.mjs` is pinned for the drift stage today.

### `.freebuff/ci.mjs`

- `stageClosure(stage)` — memoized per-process map of the stage's closure (repo-relative
  set; tolerates a `stage.script()` throw). Memoized separately from the cache so
  `pinnedRows` can run before `cacheFiles` is initialized (fixes a latent TDZ crash).
- `stageKeyFiles(stage, files)` — declared input files ∪ closure files, absolute paths.
- `stageKey` hashes the union, so a stage is re-keyed by construction whenever anything
  its gate loads transitively changes.
- `matchedInputs` labels closure-only files `closureInputLabel(scriptRel)` —
  `redactInput("imports of .freebuff/x.mjs")` — so reports stay file-content-free.
- `stageTouched` also consults the closure: a changed shared module counts as a touched
  input for exactly the stages that load it.
- `pinnedRows` augments each row's `keys` with stages whose closure contains the file, so
  `--status` and `--explain-cache` now agree about which stages a pin change re-keys.
- `CACHE_VERSION` bumped 2 → 3: key semantics changed, so old cached results must not be
  mistaken for fresh ones.

### Reporting the closure (same-day extension)

The key derives from the closure; the two reports now say so in a reader's own words,
without changing what is hashed:

- **`--explain-cache`** — every script-backed stage carries its machinery beside the key:
  an `imports` field in the JSON (redacted entry by entry, like every name there) and a
  `⤷ imports …` continuation on the human line, under the `↳` family pairing. The list is
  `stageImportNames(stage)` — the same memoized `stageClosure` the key folds in, minus the
  script itself (the row's own `script` field names it) and sorted — so the report cannot
  name a module the key does not hold. It is *absent*, not empty, when a gate loads nothing
  beside itself, so "nothing to say" stays distinct from "imports nothing". The per-file
  pairing keeps the `imports of <script>` label for a closure module no `inputs` name.
- **Coverage refusal** — when a rule points at a stage, the sentence gains the machinery:
  `add it to the <stage> stage, which already keys <via> and imports <modules>`. The JSON
  `uncovered` rows carry the same list as an `imports` field (null with no stage, matching
  the sentence). The appended stage-entry paste is never *grown* by the closure — the
  modules ride beside it, because putting them inside `inputs` would resurrect the
  hand-maintained list the closure retired; the test pins the array's entry count.
- `closureOf(name)` resolves the stage by name for the refusal; both surfaces read one
  helper family, so they cannot name different module sets for one stage.

On the real tree the value shows immediately: mutation-preflight's line pairs
`mutation-vocabulary.mjs ← imports of .freebuff/mutation-preflight.mjs` (the derivation
label for a closure module no input names) with
`⤷ imports .freebuff/gate-hashes.mjs, .freebuff/mutation-lock.mjs, .freebuff/mutation-vocabulary.mjs, .freebuff/whole-write.mjs`.

### `.freebuff/gate-drift.mjs`

The runner watch-family regex gains `import-closure`:
`^(ci|comment-gate|gate-drift|redact|nightly-report|pr-comment|import-closure)\.mjs$`.
The `STAGE_TABLE` inputs are unchanged on purpose — the runner, not the table, now
augments keys.

### Tests

- `ci-runner.test.ts` loses its private walker and its duplicated invariant; one slimmed
  test ("keys every script-backed stage on the import closure its gate loads") asserts
  re-keying through `--explain-cache --json` (`matchedBy` + globalForce), plus the
  by-name manifest assertion. A 120 s timeout covers the case that spawns every gate
  script sequentially — one runner spawn per script-backed stage of `STAGE_TABLE`, so it
  grows with the stage list (ten when the fourth sweep's stage landed; ~27 s of node
  startup alone at nine).
- `import-closure.test.ts` (new) pins the walker contract: reachability, diamond
  discovery order, comment filtering, double-quote/single-quote distinction, dynamic
  `import()` visibility, non-relative and non-`.mjs` stops, computed-import blindness,
  unreadable files, dot-dot nesting, determinism.
- The extension's cases: "carries each gate's import closure beside its key, on the line
  and in the JSON" recomputes the closure through the shared walker and asserts the JSON
  field, its agreement with the `matchedBy` pairing, the rendered `⤷ imports` line, and
  the absent-not-empty rule for a single-script stage. The refusal case runs with the
  *real* runbook gate now — the refusal fires before any stage, and the old stub hid the
  machinery the sentence names — and pins the `and imports …` clause, the JSON `imports`
  rows, and the paste's entry count (four: three declared `inputs` plus the lost file).

## Guarantees and blind spots

| Change to… | Effect |
| --- | --- |
| A file in a stage's declared `inputs` | re-keys that stage (unchanged) |
| A module reachable via literal relative `.mjs` imports | re-keys exactly the stages whose gates load it |
| A module reachable only via computed/dynamic import | **nothing** — must be listed in `inputs` (current convention for `gate-hashes.mjs`) |
| A single-quoted import edge | invisible to the walker; lint rejects the style, so this is a convention violation, not a silent miss |

The walker intentionally stays a regex, not an AST parser: the `.freebuff/` style is
narrow and lint-enforced, and the tests pin the edges where blindness is deliberate.

## Operational caution (learned twice)

Never re-pin `.freebuff/ci.mjs` while `.freebuff/.mutation-lock.json` exists. A killed or
timed-out mutation sweep leaves that lock with a `file.original` snapshot and, if killed
mid-mutation, leaves the mutation live on disk; a re-pin at that moment absorbs the
mutation into the pin manifest. Recovery procedure: restore `file.original` (the lock
records the exact splice), verify sha1 against `lock.file.originalHash`, delete the lock,
re-run `gate-drift.mjs`, only then re-pin. Prefer `--anchors`/`--list` over full sweeps on
the shared tree. (Since hardened: `recoverInterruptedRun` now auto-restores an absorbed
mutation whose holder is dead — the `absorbed-restored` event — so the manual procedure
above is the fallback for the one state that still refuses, a restore that does not
verify.)

## Verification

- Six-file suite (ci-runner, import-closure, gate-drift, whole-write,
  ci-runner-tree-editing, nightly-report): **275 passed | 1 skipped (276)**.
- `npx tsc --noEmit`: clean. eslint on the five code files: clean.
- `node .freebuff/gate-drift.mjs`: 45 gate files pinned, all match.
- mutation-preflight 28/28 caught; mutation:coverage 5/5; `mutation-guards --anchors`
  53/53 fit (runner strike anchors did not rot); whole-write 39 scripts whole.
- Extension re-verified the same day: full `ci-runner.test.ts` **177 passed | 1 skipped**
  on the merged tree (the six-file number above predates it; a concurrent session's tenth
  stage landed mid-day), `npx tsc --noEmit` clean, eslint clean on both files, and the
  targeted re-pin of `ci.mjs` taken at a no-lock window per the caution below.

## Review checklist

1. Walker contract in `import-closure.mjs` — especially the double-quote-only rule and
   the deliberate blindness to computed imports.
2. `CACHE_VERSION` bump and the claim that old cache entries must be discarded.
3. `closureInputLabel` redaction — labels carry no file content into reports.
4. `pinnedRows` augmentation — `--status` vs `--explain-cache` agreement.
5. Whether any gate script loads a module through a path the walker cannot see (grep for
   `import(` / non-literal specifiers in `.freebuff/*.mjs`).
6. The report fields derive from the same `stageClosure` as the key — confirm the script
   itself is excluded from `imports`, and that the refusal's paste is never grown by the
   closure (a closure module inside the appended `inputs` is the regression).

## Revert plan

Undo, per file: delete `.freebuff/import-closure.mjs` and `src/test/import-closure.test.ts`;
`src/test/proposal-doc-freshness.test.ts` goes with them — it imports the walker to hold
this document's quoted shapes against the source, so it will not compile after the module
is gone; restore `ci.mjs`'s declared-inputs-only `stageKey`, drop `stageClosure`/`stageKeyFiles`/
`matchedInputs` closure labels/`stageTouched` closure check/`pinnedRows` augmentation and
the reporting extension (`stageImportNames`/`closureOf`, the `imports` field and `⤷ imports`
line, the refusal's `and imports …` clause), and
set `CACHE_VERSION` back to 2; drop `import-closure` from the gate-drift watch regex;
restore the previous invariant test with its local walker, delete the extension's own
case ("carries each gate's import closure beside its key, on the line and in the JSON"
— it also imports `importClosure` and will not compile after the module is gone), and
restore the refusal case's stubbed gate and its pre-extension sentence/`uncovered`
assertions (the `and imports …` clause, the JSON `imports` rows and the paste-count pin
all assert the extension). Then run a full
`npm run gates:pin` (watch rules changed → targeted `--write` re-pins refuse), and expect
the pin count to drop by one — the manifest held 46 at the last audit, so 46 → 45 today;
count it at revert time rather than trusting this sentence. Nothing else in the tree
depends on the new module — the freshness suite is deleted by the first step above, and
every other reader of the closure reads it through `ci.mjs`.
