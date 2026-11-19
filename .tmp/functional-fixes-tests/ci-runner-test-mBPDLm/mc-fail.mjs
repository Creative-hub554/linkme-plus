process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'fail',
  exitCode: 1,
  checked: 5,
  files: 1,
  survivors: [
    { path: 'src/test/coverage-mutation.test.ts', line: null, kind: 'survived', descriptor: 'fails the floor test when the floor is weakened', detail: '... still passed, so the mutation survived.' },
    { path: 'src/test/coverage-mutation.test.ts', line: null, kind: 'broken', descriptor: 'fails the scopes test when the matcher is unanchored', detail: 'the case did not run' },
  ],
}) + '\n');
process.exit(1);