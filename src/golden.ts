/**
 * `npm run golden`: the CI check for the gate itself. For every recorded run
 * in fixtures/runs/<name>/, score the saved replies with the current pass
 * rules and compare the gate's decision and blocking questions with
 * expected.json (reviewed by hand). Any difference fails: a scoring or rule
 * change that makes the gate catch more or less must be looked at, not merged
 * silently. Needs no browser and no model.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.RUNS_DIR = 'fixtures/runs';
const { scoreRun } = await import('./score-cli.js');
const { gate } = await import('./scoring/gate.js');

const root = 'fixtures/runs';
let failed = false;
for (const name of readdirSync(root).sort()) {
  const expectedFile = join(root, name, 'expected.json');
  if (!existsSync(expectedFile)) continue;
  const expected = JSON.parse(readFileSync(expectedFile, 'utf8')) as { decision: string; blocking: string[] };
  // expected.json was reviewed with rules 1–3 only; the judge never runs here.
  const actual = gate(await scoreRun(name, { judge: { provider: 'off', model: '' }, judgeCanBlock: false }));
  const want = [...expected.blocking].sort();
  const missing = want.filter((q) => !actual.blocking.includes(q));
  const extra = actual.blocking.filter((q) => !want.includes(q));
  const ok = actual.decision === expected.decision && !missing.length && !extra.length;
  console.log(`${ok ? '✓' : '✘'} ${name}: ${actual.decision} (${actual.blocking.length} blocking question(s))`);
  if (!ok) {
    failed = true;
    if (actual.decision !== expected.decision) console.log(`    decision: expected ${expected.decision}, got ${actual.decision}`);
    if (missing.length) console.log(`    no longer blocks (gate got weaker?): ${missing.join(', ')}`);
    if (extra.length) console.log(`    now also blocks (gate got stricter?): ${extra.join(', ')}`);
  }
}
if (failed) {
  console.log('\nGolden check failed. If the change is intended, review the replies and update expected.json.');
  process.exit(1);
}
