if (!process.argv.includes('--json')) {
  process.stderr.write('stub: --json was not forwarded\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'pass',
  exitCode: 0,
  checked: 590,
  survivors: [],
  thinMargin: 1,
  unstruck: 63,
  decisionSites: 114,
  strikes: [
    { path: 'src/test/convention-guards.ts', line: null, kind: 'limb',
      descriptor: 'beat-seam: the step limb stops seeing a callback that was renamed out of it',
      test: 'src/test/beat-seams.test.ts', total: 27, margin: 1,
      caughtBy: ['catches the frame loop a surface opens beside the carousel'] },
  ],
}) + '\n');
process.exit(0);