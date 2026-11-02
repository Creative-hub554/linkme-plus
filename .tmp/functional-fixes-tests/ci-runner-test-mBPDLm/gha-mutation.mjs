if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({ gate: 'fail', exitCode: 1, checked: 5, survivors: [
  { kind: 'guard', path: 'src/app/api/admin/moderate/route.ts', line: 42, descriptor: 'guard removed (reports gate)' },
  { kind: 'self', path: 'src/app/api/admin/reports/route.ts', line: null, descriptor: 'helper self-mutation' },
] }) + '\n');
process.exit(1);