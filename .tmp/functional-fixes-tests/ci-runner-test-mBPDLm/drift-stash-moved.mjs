if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  mode: 'check', gate: 'pass', exitCode: 0, checked: 7, findings: [],
  changed: [], unpinned: [], gone: [],
  stash: { dir: '/tmp/gate-content-fixture-1f2e3d4c', stashed: 7, fallback: '/tmp/gate-content-fixture-1f2e3d4c' },
  warning: 'the matched text could not be stashed in the usual place — kept at /tmp/gate-content-fixture-1f2e3d4c instead, which the OS may clear, and then the next drift shows hashes only',
  cause: "EEXIST: file already exists, mkdir '/repo/.ci/gate-content' — writing to .ci/gate-content",
}) + '\n');