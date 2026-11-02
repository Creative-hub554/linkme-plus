if (!process.argv.includes('--json') || !process.argv.includes('--check')) process.exit(3);
process.stdout.write(JSON.stringify({
  gate: 'fail', exitCode: 1, sections: 61,
  message: 'run.md: Contents is stale (61 sections) — run `npm run runbook:contents` and commit the result.',
}));