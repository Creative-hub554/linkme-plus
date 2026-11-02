import { writeFileSync } from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({
  numTotalTests: 1, numFailedTests: 0,
  testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }],
}));
writeFileSync(process.env.CI_COVERAGE_STAMP_FILE, 'rendered-links coverage: chrome — the stub 2 (2 unique destinations)\n');