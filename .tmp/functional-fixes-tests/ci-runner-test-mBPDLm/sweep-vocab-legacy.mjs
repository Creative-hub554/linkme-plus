import fs from "node:fs";
if (process.argv[2] === "--vocabulary") {
  process.stdout.write(JSON.stringify({ root: process.cwd(), gate: 'pass', exitCode: 0, checked: 530, survivors: [] }) + "\n");
  process.exit(0);
}
fs.appendFileSync(process.env.STUB_SPAWN_LOG, process.argv[2] + "\n");
process.stdout.write(JSON.stringify({
  root: process.cwd(),
  gate: 'pass',
  exitCode: 0,
  checked: 530,
  survivors: [],
}) + "\n");
process.exit(0);