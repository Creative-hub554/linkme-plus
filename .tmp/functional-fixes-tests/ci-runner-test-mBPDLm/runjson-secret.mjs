if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({ gate: 'fail', exitCode: 1, checked: 1, survivors: [
  { kind: 'guard', path: '.env.local', line: 5, descriptor: 'guard removed' },
] }) + '\n');
process.exit(1);