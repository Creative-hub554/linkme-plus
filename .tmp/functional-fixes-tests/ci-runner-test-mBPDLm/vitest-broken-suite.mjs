import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({
  numTotalTests: 2,
  numFailedTests: 0,
  testResults: [{
    name: join(process.cwd(), 'src/test/stub.test.ts'),
    status: 'failed',
    message: 'Error: EBUSY: resource busy or locked, rmdir scratch',
    assertionResults: [{ status: 'passed', title: 'passes one' }],
  }],
}));
process.exit(1);