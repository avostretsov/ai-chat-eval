/**
 * `npm run fixture -- <name> [runId]`: copy a captured run (replies + meta,
 * no screenshots) to fixtures/runs/<name>, so CI can run the gate on recorded
 * replies. CI cannot reach a local Ollama, and the scoring and the gate are
 * what CI needs to protect.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { latestRunId, runDir } from './runs.js';

const [name, runIdArg] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage: npm run fixture -- <name: a-z, 0-9, -> [runId]');
  process.exit(1);
}
const runId = runIdArg ?? latestRunId();
const from = runDir(runId);
if (!existsSync(join(from, 'replies'))) throw new Error(`Run ${runId} has no replies to record.`);

const to = join('fixtures', 'runs', name);
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(join(from, 'replies'), join(to, 'replies'), { recursive: true });
if (existsSync(join(from, 'meta.json'))) cpSync(join(from, 'meta.json'), join(to, 'meta.json'));
console.log(`Recorded run ${runId} → ${to}`);
console.log(`Gate it with: RUNS_DIR=fixtures/runs RUN_ID=${name} npm run gate`);
