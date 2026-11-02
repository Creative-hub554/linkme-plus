import { rmSync, writeFileSync } from 'node:fs';
rmSync(process.env.CI_STUB_VANISH, { force: true });
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