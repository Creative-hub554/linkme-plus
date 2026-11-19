process.stdout.write(JSON.stringify({
  gate: 'fail', exitCode: 1, files: 1, errors: 1, warnings: 0,
  findings: [{ file: 'src/lib/a,b.ts', line: 5, column: 2, rule: 'rule', severity: 2, message: '50% off\nand a: colon' }],
}) + '\n');
process.exit(1);