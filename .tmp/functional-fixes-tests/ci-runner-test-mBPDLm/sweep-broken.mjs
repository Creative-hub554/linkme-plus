process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'fail',
  exitCode: 1,
  checked: 0,
  lockSelfMutations: 2,
  survivors: [
    { path: '.freebuff/mutation-lock.mjs', line: null, kind: 'broken', descriptor: 'absorbed: the lock reports no file that still carries the mutation it recorded', where: '.freebuff/mutation-lock.mjs  absorbed: the lock reports no file that still carries the mutation it recorded', detail: 'its anchor occurs 0 time(s), expected exactly 1' },
  ],
}) + '\n');
process.exit(1);