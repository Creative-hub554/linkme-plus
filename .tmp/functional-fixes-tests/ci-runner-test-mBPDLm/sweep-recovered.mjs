if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  root: process.cwd(), gate: 'pass', exitCode: 0, checked: 12, survivors: [],
  recovered: [{
    action: 'restored',
    path: 'src/app/api/admin/moderate/route.ts',
    check: 'guard sweep',
    kind: 'guard',
    where: 'src/app/api/admin/moderate/route.ts:29',
    message: 'RESTORED src/app/api/admin/moderate/route.ts from an interrupted guard sweep (guard: src/app/api/admin/moderate/route.ts:29).',
  }],
}) + '\n');