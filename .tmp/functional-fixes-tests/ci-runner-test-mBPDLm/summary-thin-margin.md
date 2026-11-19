## Nightly full CI gate — ✅ all 1 stage(s) passed

The whole gate, run end to end on a clean checkout — no `--changed-only`, so nothing is skipped.

- Ran 1 stage(s): 1 passed, 0 failed.
- 1 warning(s) on a stage that passed.

| Stage | Result | Summary |
| :-- | :-- | :-- |
| mutation sweep | ✅ pass | 590 mutation(s) checked, no survivors — 1 thin-margin limb(s) — 63 of 114 decision(s) un-struck |

### Warnings

On stages that passed, or about the run itself — the run telling on itself rather than a failure of the gate:

- **WARN THIN MARGIN** (mutation sweep) `src/test/convention-guards.ts` — beat-seam: the step limb stops seeing a callback that was renamed out of it — one case alone notices it: "catches the frame loop a surface opens beside the carousel" (src/test/beat-seams.test.ts)
