import { appendFileSync } from 'node:fs';
appendFileSync(process.env.CI_SUSPECT_PROBE, '\nexport const touched = 1;\n');
process.stdout.write(JSON.stringify({
  gate: 'fail', exitCode: 1, sections: 60,
  message: 'run.md: Contents is stale (61 section(s)).',
}));