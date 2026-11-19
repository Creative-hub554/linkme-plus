if (!process.argv.includes('--json')) {
  process.stderr.write('stub: --json was not forwarded\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  target: '.freebuff/preview-preflight.mjs',
  test: 'src/test/preview-preflight.test.ts',
  gate: 'pass',
  exitCode: 0,
  checked: 19,
  caught: [],
  survivors: [],
}) + '\n');
process.exit(0);