if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'fail',
  exitCode: 1,
  checked: 530,
  helperSelfMutations: 9,
  conventionSelfMutations: 7,
  limbSelfMutations: 14,
  survivors: [
    { path: 'src/test/convention-guards.ts', line: null, kind: 'convention', descriptor: 'mount: the detector flags no raw mount', where: 'src/test/convention-guards.ts  mount: the detector flags no raw mount', test: 'src/test/convention-guards.test.ts', total: 5, masked: 1, named: 0 },
    { path: 'src/test/convention-guards.ts', line: null, kind: 'limb', descriptor: 'beat-seam: the step limb stops seeing a callback that was renamed out of it', where: 'src/test/convention-guards.ts  beat-seam: the step limb stops seeing a callback that was renamed out of it', test: 'src/test/beat-seams.test.ts', total: 18, masked: 1, named: 0 },
  ],
}) + '\n');
process.exit(1);