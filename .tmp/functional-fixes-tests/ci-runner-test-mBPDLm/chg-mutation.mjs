import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CI_STUB_MARKER, 'ran');
process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 1, survivors: [] }) + '\n');