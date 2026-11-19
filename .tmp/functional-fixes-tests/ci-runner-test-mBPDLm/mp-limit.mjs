if (!process.argv.includes('--json')) process.exit(3);
if (!process.argv.includes('--limit=2')) {
  process.stderr.write('stub: --limit was not forwarded\n');
  process.exit(3);
}
if (process.argv.some((a) => a.startsWith('--file=')) || process.argv.includes('--no-fail-open')) {
  process.stderr.write('stub: a flag of the route sweep was forwarded\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({ gate: 'pass', exitCode: 0, checked: 2, survivors: [] }) + '\n');