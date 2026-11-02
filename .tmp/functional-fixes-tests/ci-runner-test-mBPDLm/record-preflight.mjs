if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  gate: 'pass', exitCode: 0, only: null, registerUrl: null,
  failures: [], warnings: [],
  checks: [{ name: 'node_modules', status: 'ok', detail: 'installed' }],
}) + '\n');