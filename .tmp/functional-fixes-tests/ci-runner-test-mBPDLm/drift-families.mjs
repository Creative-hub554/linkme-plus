if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  mode: 'check', gate: 'fail', exitCode: 1, checked: 41,
  findings: [
    { kind: 'changed', path: '.freebuff/coverage-floor.mjs', detail: 'on disk 11111111, pinned 22222222' },
    { kind: 'unpinned', path: '.freebuff/coverage-headroom.mjs', detail: 'not in the pinned hashes' },
    { kind: 'changed', path: '.github/workflows/nightly.yml', detail: 'on disk 33333333, pinned 44444444' },
    { kind: 'gone', path: '.freebuff/gate-removed.mjs', detail: 'pinned, not on disk' },
  ],
}) + '\n');
process.exit(1);