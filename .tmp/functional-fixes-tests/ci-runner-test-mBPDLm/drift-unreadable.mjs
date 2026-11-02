if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  mode: 'check', gate: 'fail', exitCode: 2, checked: 0, findings: [],
  changed: [], unpinned: [], gone: [],
  message: '.freebuff/gate-hashes.mjs does not exist — run `npm run gates:pin` to record the gate hashes',
}) + '\n');
process.exit(2);