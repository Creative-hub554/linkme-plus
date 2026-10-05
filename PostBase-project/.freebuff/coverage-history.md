# Rendered-links coverage history

One dated row per nightly full-gate run, appended by the nightly job (`.github/workflows/nightly.yml`) through `.freebuff/coverage-history.mjs`: the `rendered-links coverage:` stamp the vitest suite's own close-out writes, carried in the `ci.mjs --json` report as `coverageStamp`, and quoted verbatim on the run page and in the runbook's dated bullets. This table is where the readings accrue, so the guard's coverage is a trend over time rather than one run at a time.

A row is recorded for a red run too — the stamp is a reading, not a verdict — but never for a suite that left no stamp: a stubbed or failed suite omits the row rather than fabricating a zero. Re-running the same date replaces that date's row rather than duplicating it, and a row identical to the one already there changes nothing.

Record a row by hand with:

    node .freebuff/coverage-history.mjs --report .ci/report.json
    node .freebuff/coverage-history.mjs --stamp "rendered-links coverage: …" --date 2026-10-02

| Date | Rendered-links coverage |
| :-- | :-- |
| 2026-10-05 | rendered-links coverage: chrome — the footer 14, the signed-in header 5, the opened account menu 5, the opened mobile panel 3, the opened notification panel 2, the bottom nav 3, the Social strip 4, the signed-out header 5, the signed-out mobile panel 4, the signed-out bottom nav 2 (28 unique destinations) \| data — 28 page mounts, 18 unique destinations |
