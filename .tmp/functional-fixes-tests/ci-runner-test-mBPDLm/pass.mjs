if (!process.argv.includes('--json')) {
  process.stderr.write('stub: --json was not forwarded\n');
  process.exit(3);
}
const payload = {
  projectRoot: process.cwd(),
  port: 3000,
  gate: 'pass',
  exitCode: 0,
  only: null,
  registerUrl: 'http://localhost:3000',
  pid: 4242,
  failures: [],
  warnings: ['dev lock'],
  checks: [
    { name: 'node_modules', status: 'ok', detail: 'installed' },
    { name: '.env.local', status: 'ok', detail: 'present' },
    { name: 'dev lock', status: 'warn', detail: 'absent but a server answers' },
  ],
};
process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
process.exit(0);