process.stdout.write(JSON.stringify({
  root: process.cwd(),
  target: '.freebuff/preview-preflight.mjs',
  test: 'src/test/preview-preflight.test.ts',
  gate: 'fail',
  exitCode: 1,
  checked: 19,
  caught: [],
  survivors: [
    { path: '.freebuff/preview-preflight.mjs', line: 412, id: 'health/wedged', kind: 'survived', descriptor: 'a live lock pid that answers nothing on its port is not reported as wedged' },
    { path: '.freebuff/preview-preflight.mjs', line: null, id: 'tab/gone', kind: 'broken', descriptor: 'a tab that is gone is reported as gone', detail: 'its anchor occurs 0 time(s), expected exactly 1' },
  ],
}) + '\n');
process.exit(1);