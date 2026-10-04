/**
 * The coverage thresholds, in one place.
 *
 * Two things read these numbers: `vitest.config.ts`, which enforces them, and
 * `.freebuff/coverage-report.mjs`, which publishes the headroom against them.
 * They live here rather than inline in the config so the gate and the report
 * cannot drift — a report that claimed more slack than the gate actually has
 * would be worse than no report at all.
 *
 * The shape mirrors Vitest's `coverage.thresholds`. Vitest checks each glob key
 * against the *combined* coverage of the files it matches, while the bare
 * numbers below are the whole-tree aggregate — so the globs let one gate be
 * strict where the suite is strong and honest about where it is not, while the
 * bare numbers catch a slide anywhere, including files no glob names (today that
 * is `src/index.ts` and `src/middleware.ts`, and anything new dropped at the
 * root of `src/`).
 *
 * Each number sits a point or two under what its directory reaches today, so a
 * real regression trips it and a rounding wobble does not. That margin has an
 * owner for the whole-tree row: `.freebuff/coverage-headroom.mjs` fails
 * `npm run test:coverage` when the aggregate clears the bare backstop by less
 * than a point, so the gap cannot be spent without the build saying so. These
 * were raised in the pass that published the report: the earlier set (bare
 * 72/72/69/51, and
 * per-directory numbers set from a much weaker tree) was decorative next to the
 * numbers the report now prints every run, so the slack at both ends was closed
 * against them. `src/hooks/**` and `src/utils/**` were the last two rows with no
 * slack left, so the files that capped them — `src/hooks/use-presence.ts` and
 * `src/hooks/use-websocket.ts` in the hooks, the browser Supabase factory in the
 * utils — were covered, and both rows moved with them.
 *
 * The ordering is the point: `src/lib` and `src/utils` are pure logic and are
 * held high, `src/components` is the hardest to mount and is held lower, and a
 * new untested file in any of them drags that directory down.
 */
export const thresholds = {
  // Whole-tree backstop. Today the tree stands at 86.15 / 75.23 / 65.88, so the
  // bare numbers sit ~1.2–1.9 under it — close enough that a genuinely dropped
  // area trips the aggregate, loose enough that the day's churn in a shared
  // checkout does not. Raised from 72 / 72 / 69 / 51.
  lines: 85,
  statements: 85,
  branches: 74,
  functions: 64,
  // Pure logic: today 93.64 / 87.58 / 69.23. Raised from 88 / 88 / 86 / 58 —
  // except `branches`, which is held at 86: the two runs that bracketed this pass
  // read 88.11 then 87.58, so the metric moves more than a point on its own in a
  // churning checkout and a floor above 86 would flag slack the gate does not
  // really have.
  "src/lib/**": { lines: 92, statements: 92, branches: 86, functions: 67 },
  // Three files, now all but `use-file-upload.ts` at 100: 99.69 / 94.85 / 100
  // today, up from 77.43 / 73.33 / 71.43 before `use-presence.ts` and
  // `use-websocket.ts` were covered. The row is left a point under each metric;
  // `lines` cannot go to 99 because `use-file-upload.ts` (98.96) caps it, and
  // `branches` sits under its own 94.85 so its wobble does not trip it.
  "src/hooks/**": { lines: 98, statements: 98, branches: 93, functions: 99 },
  // Three files, every one now at 100 on every metric: the browser factory that
  // capped `functions` at 85.71 has a test of its own. Raised from
  // 98 / 98 / 99 / 85 — a point under 100 is the tightest a threshold can sit
  // while still leaving room for a rounding wobble.
  "src/utils/**": { lines: 99, statements: 99, branches: 99, functions: 99 },
  // Pages and route handlers: today 84.79 / 71.95 / 70.00.
  // Raised from 77 / 77 / 68 / 57.
  "src/app/**": { lines: 83, statements: 83, branches: 70, functions: 68 },
  // Primarily presentational and the costliest to mount: today 85.89 / 75.00 /
  // 59.16. Raised from 63 / 63 / 63 / 41.
  "src/components/**": { lines: 84, statements: 84, branches: 73, functions: 57 },
};

export default thresholds;
