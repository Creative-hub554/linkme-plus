import fs from "node:fs";
if (process.env.STUB_SPAWN_LOG) fs.appendFileSync(process.env.STUB_SPAWN_LOG, process.argv[2] + "\n");
if (process.argv[2] === "--vocabulary") {
  process.stdout.write(JSON.stringify({
  mode: 'vocabulary', root: process.cwd(),
  families: [{ kind: 'ratchet', declared: true, count: 1, strikes: [{ path: 'src/test/declared-strikes.ts', name: 'ratchet: the declared-table hold returns before it compares anything' }] }],
  unnamed: [], unspoken: [],
  gate: 'pass', exitCode: 0,
}) + "\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'pass',
  exitCode: 0,
  checked: 530,
  survivors: [],
}) + "\n");
process.exit(0);