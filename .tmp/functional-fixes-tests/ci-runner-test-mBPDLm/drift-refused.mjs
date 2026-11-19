if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  mode: 'check', gate: 'fail', exitCode: 1, checked: 41,
  findings: [
    { kind: 'changed', path: '.github/workflows/nightly.yml', detail: 'on disk 33333333, pinned 44444444',
      family: '.github/workflows/^.*\\.ya?ml$', owner: ' — no stage keys it' },
  ],
  changed: ['.github/workflows/nightly.yml'], unpinned: [], gone: [],
  refused: [{ rule: '.github/workflows/^.*\\.ya?ml$', moved: 1 }],
  refusal: '1 moved watch family behind no stage key, so name it in a stage inputs',
}) + '\n');
process.exit(1);