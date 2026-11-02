process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'fail',
  exitCode: 1,
  checked: 530,
  survivors: [
    { path: 'src/app/api/posts/route.ts', line: 31, kind: 'guard', descriptor: 'removed the isUuid guard', where: 'POST', total: 22, masked: 0, named: 0 },
    { path: 'src/app/api/jobs/route.ts', line: 37, kind: 'failopen', descriptor: 'guard returned success instead of failing', where: 'POST', total: 22, masked: 0, named: 0 },
    { path: 'src/app/api/groups/route.ts', line: 15, kind: 'catch', descriptor: 'rethrow removed from catch', where: 'POST', total: 22, masked: 0, named: 0 },
    { path: '.freebuff/mutation-guards.mjs', line: null, kind: 'self', descriptor: 'helper isUuid inverted', where: 'self', total: 1, masked: 0, named: 0 },
    { path: '.freebuff/ci.mjs', line: null, kind: 'runner', descriptor: 'dead-input: the runner reports no stage input that matches no file', where: '.freebuff/ci.mjs  dead-input: the runner reports no stage input that matches no file', test: 'src/test/ci-runner.test.ts', total: 129, masked: 1, named: 0 },
    { path: '.freebuff/mutation-lock.mjs', line: null, kind: 'lock', descriptor: 'absorbed: the lock reports no file that still carries the mutation it recorded', where: '.freebuff/mutation-lock.mjs  absorbed: the lock reports no file that still carries the mutation it recorded', test: 'src/test/mutation-sweep-recovery.test.ts', total: 9, masked: 1, named: 0 },
    { path: 'src/test/declared-strikes.ts', line: null, kind: 'ratchet', descriptor: 'ratchet: the declared-table hold returns before it compares anything', where: 'src/test/declared-strikes.ts  ratchet: the declared-table hold returns before it compares anything', test: 'src/test/declared-strikes.test.ts', total: 9, masked: 1, named: 0 },
    { path: 'src/test/convention-guards.ts', line: null, kind: 'convention', descriptor: 'mount: the detector flags no raw mount', where: 'src/test/convention-guards.ts  mount: the detector flags no raw mount', test: 'src/test/convention-guards.test.ts', total: 5, masked: 1, named: 0 },
    { path: 'src/test/convention-guards.ts', line: null, kind: 'limb', descriptor: 'beat-seam: the step limb stops seeing a callback that was renamed out of it', where: 'src/test/convention-guards.ts  beat-seam: the step limb stops seeing a callback that was renamed out of it', test: 'src/test/beat-seams.test.ts', total: 18, masked: 1, named: 0 },
  ],
}) + '\n');
process.exit(1);