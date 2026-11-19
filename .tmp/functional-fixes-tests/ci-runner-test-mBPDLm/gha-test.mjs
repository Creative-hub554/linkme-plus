import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({
  numTotalTests: 3,
  numFailedTests: 1,
  testResults: [{
    name: join(process.cwd(), 'src/test/stub.test.ts'),
    status: 'failed',
    assertionResults: [
      { status: 'passed', title: 'passes one' },
      { status: 'failed', title: 'renders the thing' },
    ],
  }],
}));
process.exit(1);