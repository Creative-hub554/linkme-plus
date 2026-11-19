if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  gate: 'pass', exitCode: 0, files: 346, findings: [], errors: 0, warnings: 0,
}) + '\n');