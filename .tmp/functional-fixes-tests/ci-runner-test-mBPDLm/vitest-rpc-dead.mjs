import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const marker = process.env.CI_RETRY_COUNTER;
const attempt = existsSync(marker) ? Number(readFileSync(marker, 'utf8')) + 1 : 1;
writeFileSync(marker, String(attempt));
process.stderr.write('stderr: Timeout calling "onTaskUpdate"\n');
const out = process.argv.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
writeFileSync(out, JSON.stringify({ numTotalTests: 1, numFailedTests: 0, testResults: [{ name: 'src/test/stub.test.ts', status: 'passed', assertionResults: [{ status: 'passed', title: 'passes one' }] }] }));
process.exit(1);