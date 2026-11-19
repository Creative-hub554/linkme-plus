if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'fail',
  exitCode: 1,
  checked: 6,
  survivors: [
    { path: 'src/lib/vocabulary-self.ts', line: null, kind: 'self', descriptor: 'self: the self family reports nothing' },
    { path: 'src/lib/vocabulary-convention.ts', line: null, kind: 'convention', descriptor: 'convention: the convention family reports nothing' },
    { path: 'src/lib/vocabulary-limb.ts', line: null, kind: 'limb', descriptor: 'limb: the limb family reports nothing' },
    { path: 'src/lib/vocabulary-runner.ts', line: null, kind: 'runner', descriptor: 'runner: the runner family reports nothing' },
    { path: 'src/lib/vocabulary-lock.ts', line: null, kind: 'lock', descriptor: 'lock: the lock family reports nothing' },
    { path: 'src/lib/vocabulary-ratchet.ts', line: null, kind: 'ratchet', descriptor: 'ratchet: the ratchet family reports nothing' },
  ],
}) + '\n');
process.exit(1);