if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  gate: 'fail', exitCode: 1,
  checks: [{ name: 'dev server pid', status: 'fail', detail: 'process 1 is gone', fix: 'npm run dev' }],
}));