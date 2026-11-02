if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  mode: 'check', gate: 'fail', exitCode: 1, checked: 7,
  findings: [
    { kind: 'changed', path: '.freebuff/coverage-floor.mjs', detail: 'on disk 11111111, pinned 22222222',
      diff: '--- pinned  .freebuff/coverage-floor.mjs\n+++ on disk .freebuff/coverage-floor.mjs\n@@ -124,7 +124,7 @@\n-    if (pct < threshold) {\n+    if (pct <= threshold) {' },
    { kind: 'unpinned', path: '.freebuff/coverage-perfile.mjs', detail: 'not in the pinned hashes — a gate nobody pinned' },
  ],
  changed: ['.freebuff/coverage-floor.mjs'], gone: [],
  unpinned: ['.freebuff/coverage-perfile.mjs'],
}) + '\n');
process.exit(1);