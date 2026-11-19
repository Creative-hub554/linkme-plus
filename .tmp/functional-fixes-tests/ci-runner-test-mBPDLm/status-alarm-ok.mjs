if (!process.argv.includes('--status')) process.exit(3);
process.stdout.write('gate-status: a sentence only the alarm writes\n');