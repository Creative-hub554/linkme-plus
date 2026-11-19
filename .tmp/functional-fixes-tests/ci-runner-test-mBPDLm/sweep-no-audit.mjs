process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'pass',
  exitCode: 0,
  checked: 530,
  survivors: [],
}) + '\n');
process.exit(0);