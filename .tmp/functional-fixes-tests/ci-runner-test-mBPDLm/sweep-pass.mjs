if (!process.argv.includes('--json')) {
  process.stderr.write('stub: --json was not forwarded\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'pass',
  exitCode: 0,
  checked: 530,
  survivors: [],
}) + '\n');
process.exit(0);