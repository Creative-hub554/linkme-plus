import { writeFileSync } from 'node:fs';
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({
  numTotalTests: 1,
  numFailedTests: 0,
  testResults: [{
    name: 'src/test/stub.test.ts',
    status: 'passed',
    assertionResults: [{ status: 'passed', title: 'passes one' }],
  }],
  errors: [{ name: 'Unhandled Rejection', message: 'stub rejection: nobody awaited this' }],
}));
process.exit(1);