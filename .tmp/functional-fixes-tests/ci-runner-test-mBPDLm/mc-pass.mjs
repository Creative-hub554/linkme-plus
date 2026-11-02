if (!process.argv.includes('--json')) {
  process.stderr.write('stub: --json was not forwarded\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'pass',
  exitCode: 0,
  checked: 5,
  files: 1,
  survivors: [],
}) + '\n');
process.exit(0);