const payload = {
  projectRoot: process.cwd(),
  port: 3000,
  gate: 'fail',
  exitCode: 1,
  only: null,
  registerUrl: null,
  pid: null,
  failures: ['dev server pid', 'reach port 3000'],
  warnings: [],
  checks: [
    { name: 'dev server pid', status: 'fail', detail: 'process 1 is gone (stale lock)', fix: 'npm run dev' },
    { name: 'reach port 3000', status: 'fail', detail: 'nothing answered on loopback', fix: 'npm run dev, then re-run this preflight' },
  ],
};
process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
process.exit(1);