# The race guard now spans the self-mutation families

## What this note is for

This is the hand-off record for the change that extended the mutation sweep's wedge-and-void
race guard from the route walk to the five self-mutation families (helpers, convention
detectors at both depths, runner checks, shared-lock answers, and the declared-table
ratchet). Read it if you are landing, reviewing, or extending the change.

## The change, in three sentences

The sweep now hashes every file a verdict answers to at plan time — for the families, each
target *plus the test file its verdict answers to*, keyed as a pair because many strikes
share one target — and re-reads both halves before every strike and once more over
everything it measured before building the report. A file an outside session edited inside
the run's window is not measured: the strike is skipped and counted in `racedStrikes`, the
verdicts already recorded for it are voided with `checked` refunded, and one `broken` row
with `reason: "race"` names it in the log and in the `--json` survivors, so no verdict rides
a subject nobody can read back. The sweep's own edit seam counts the run's strikes as one
ordinal sequence (families first, then the plan strip) so `MUTATION_RACE_AT` names the same
nth strike in either scope, and the seam may write only inside a scratch tree one walk was
re-rooted to (`MUTATION_ROUTE_ROOT`, or `MUTATION_STRIKE_ROOT` with the race file inside it)
— refusing a checkout path with `re-root one of the walks first`.

## The one real bug the by-hand drive caught

The first voiding keyed on the scratch copy's label (`../../../Users/...`) while the self
survivors ride the declared file's label (`src/test/expect-gated.ts`), so two recorded
`self` verdicts rode through a race unhindered. Reproduced by hand against a scratch strike
root before codifying, fixed by keying both the void and the dedupe on `mutation.file` —
the label every verdict rides — and the mid-run chassis case now asserts the refund lands
(`checked: 0`, `racedStrikes: 8`, one row, the two `self` verdicts gone). The lesson:
voiding must key on the label the survivors were recorded with, not on wherever the walk's
own pointer happens to be.

## Files changed (all uncommitted)

- `PostBase-project/.freebuff/mutation-guards.mjs` — the wedge, both gates, the end-of-run
  sweep, the generalized seam, and the one-sentence-spelled race reasons.
- `PostBase-project/src/test/mutation-sweep-recovery.test.ts` — five chassis cases plus two
  updated route-race assertions; the suite is 40 cases.
- `PostBase-project/.freebuff/run.md` — the sweep bullet extended; Contents verified at 61
  sections.
- `PostBase-project/.freebuff/gate-hashes.mjs` — re-pinned by the targeted
  `node .freebuff/gate-drift.mjs --write .freebuff/mutation-guards.mjs`
  (`9cead42f -> 5ae15678`). The other pin lines moved in this tree belong to other sessions'
  uncommitted edits and were deliberately not touched.

## Verified (exit codes captured at each step)

- Chassis: `npx vitest run src/test/mutation-sweep-recovery.test.ts` — 40 passed.
- Full suite: `npx vitest run` — 2997 passed / 2 failed; both failures the drift manifest's
  own cases reading the pending pin; both re-run green after the re-pin
  (`npx vitest run src/test/gate-drift.test.ts src/test/ci-runner.test.ts` — exit 0).
- Real-tree self sweeps (each strike byte-restored by the sweep's own verify, exit 0):
  `--file=declared-strikes` caught 1/9; `--file=mutation-lock` caught 5/40 and 1/40;
  `--file=expect-gated` caught all 10.
- Gate: `node .freebuff/ci.mjs --from=mutation` — PASS mutation sweep, 700 mutations
  checked, no survivors, exit 0 (identical to the pre-change baseline).
- Supporting reads: `npm run lint` (578 files, PASS, exit 0); `npm run gates:drift` (57
  files pinned, all match, exit 0); `mutation-coverage` 5/5 and `mutation-preflight` 28/28,
  both PASS and exit 0; no `.freebuff/.mutation-lock.json` left behind.

## Known limitations

- The work is uncommitted; the previous commit's `bad90f33` pin is one manifest revision
  behind the tree.
- `MUTATION_RACE_AT` cannot race a self strike's answering *test* file — it is a real file,
  outside both scratch roots — so that half is gate-covered but not chassis-drivable.
- `mutation-example` and `mutation-fifth` were not re-run this turn (their inputs, the
  vocabulary tables, did not change).
