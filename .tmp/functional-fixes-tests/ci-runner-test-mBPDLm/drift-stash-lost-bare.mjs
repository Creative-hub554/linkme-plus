if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  mode: 'check', gate: 'pass', exitCode: 0, checked: 7, findings: [],
  changed: [], unpinned: [], gone: [],
  warning: 'the matched text could not be stashed — the next drift will show hashes only',
}) + '\n');