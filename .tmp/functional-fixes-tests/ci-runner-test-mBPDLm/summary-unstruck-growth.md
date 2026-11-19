## Nightly full CI gate — ✅ all 1 stage(s) passed

The whole gate, run end to end on a clean checkout — no `--changed-only`, so nothing is skipped.

- Ran 1 stage(s): 1 passed, 0 failed.
- 1 warning(s) on a stage that passed.

| Stage | Result | Summary |
| :-- | :-- | :-- |
| mutation sweep | ✅ pass | 590 mutation(s) checked, no survivors — 0 thin-margin limb(s) — 63 of 114 decision(s) un-struck |

### Warnings

On stages that passed, or about the run itself — the run telling on itself rather than a failure of the gate:

- **WARN UN-STRUCK GROWTH** (mutation sweep) — 63 of 114 decision(s) un-struck, past the recorded baseline of 61 by 2 — `node .freebuff/mutation-guards.mjs --baseline` names the decisions, `--write-baseline` re-records the list once strikes reach them again
