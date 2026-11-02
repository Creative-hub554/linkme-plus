import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CI_STUB_MARKER, 'ran');
process.stdout.write(JSON.stringify({
  gate: 'pass', exitCode: 0, failures: [], warnings: [],
  checks: [{ name: 'node_modules', status: 'ok', detail: 'installed' }],
}) + '\n');