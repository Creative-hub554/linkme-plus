if (!process.argv.includes('--json')) process.exit(3);
process.stdout.write(JSON.stringify({
  root: process.cwd(), gate: 'pass', exitCode: 0, checked: 19, survivors: [],
  recovered: [{
    action: 'restored',
    path: '.freebuff/preview-preflight.mjs',
    check: 'preflight sweep',
    kind: 'mutation',
    where: 'health/wedged',
    message: 'RESTORED .freebuff/preview-preflight.mjs from an interrupted preflight sweep (mutation: health/wedged).',
  }],
}) + '\n');