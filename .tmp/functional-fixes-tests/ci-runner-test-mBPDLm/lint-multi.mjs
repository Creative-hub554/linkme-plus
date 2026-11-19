if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  gate: 'fail', exitCode: 1, files: 346, errors: 1, warnings: 2,
  findings: [
    { file: 'src/app/api/foo/route.ts', line: 12, column: 7, rule: '@typescript-eslint/no-unused-vars', severity: 2, message: 'x is assigned a value but never used' },
    { file: 'src/app/api/foo/route.ts', line: 20, column: 3, rule: '@typescript-eslint/no-explicit-any', severity: 1, message: 'unexpected any' },
    { file: 'src/lib/bar.ts', line: 3, column: 1, rule: 'react-hooks/exhaustive-deps', severity: 1, message: 'missing dependency: y' },
  ],
}) + '\n');
process.exit(1);