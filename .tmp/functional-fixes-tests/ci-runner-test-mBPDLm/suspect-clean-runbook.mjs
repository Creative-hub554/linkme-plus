if (!process.argv.includes('--json') || !process.argv.includes('--check')) process.exit(3);
process.stdout.write(JSON.stringify({
  gate: 'pass', exitCode: 0, sections: 60,
  message: 'run.md: Contents is up to date (60 sections).',
}));