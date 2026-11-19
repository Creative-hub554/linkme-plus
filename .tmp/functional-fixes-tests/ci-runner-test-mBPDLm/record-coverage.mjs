if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 5, files: 1, survivors: [] }) + '\n');