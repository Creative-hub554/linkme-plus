import { writeFileSync } from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({
  numTotalTests: 2,
  numFailedTests: 0,
  testResults: [{
    name: 'src/test/stub.test.ts',
    status: 'passed',
    assertionResults: [{ status: 'passed', title: 'passes one' }],
  }],
}));
process.stderr.write('collect-budget: 1 breach(es) — a file over its budget\n');
process.exit(1);