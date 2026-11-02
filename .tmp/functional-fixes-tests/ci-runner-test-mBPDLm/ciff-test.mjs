import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CI_STUB_MARKER, 'ran');
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({
  numTotalTests: 1,
  numFailedTests: 0,
  testResults: [{
    name: 'src/test/stub.test.ts',
    status: 'passed',
    assertionResults: [{ status: 'passed', title: 'passes one' }],
  }],
}));