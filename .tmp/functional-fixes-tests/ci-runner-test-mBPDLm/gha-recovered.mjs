if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  root: process.cwd(), gate: 'pass', exitCode: 0, checked: 5, files: 1, survivors: [],
  recovered: [
    { action: 'restored', path: '.freebuff/coverage-floor.mjs', check: 'coverage mutation check', kind: 'gate', where: 'src/test/coverage-floor.test.ts', message: 'RESTORED .freebuff/coverage-floor.mjs from an interrupted coverage mutation check (gate: src/test/coverage-floor.test.ts).' },
    { action: 'left', path: '.freebuff/coverage-scopes.mjs', check: 'coverage mutation check', kind: 'gate', where: 'src/test/coverage-scopes.test.ts', message: 'WARNING: .freebuff/coverage-scopes.mjs differs from both the pre- and post-mutation content — someone else edited it. Leaving it as it is now, and the lock in place; inspect it by hand.' },
  ],
}) + '\n');