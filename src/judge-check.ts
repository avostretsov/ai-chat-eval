/**
 * `npm run judge:check`: measure a judge model against replies a person has
 * labelled (fixtures/judge/calibration.json) before trusting it. Uses the
 * JUDGE / JUDGE_MODEL settings, no cache, temperature 0.
 *
 * Reports three numbers:
 *   verdict match     the judge picked an accepted verdict
 *   pass/fail match   the judge passed or failed the reply like the person did
 *   false blocks      the judge called a critical question Wrong/Made up when the person did not
 */
import { readFileSync } from 'node:fs';
import { config } from '../eval.config.js';
import { loadQuestions } from './questions.js';
import { judgeReply } from './judge/judge.js';

interface Item { questionId: string; from: string; reply: string; accept: string[]; note: string }

const judge = config.judge;
if (judge.provider === 'off') {
  console.error('Set JUDGE (e.g. JUDGE=ollama JUDGE_MODEL=qwen2.5:3b) to check a judge.');
  process.exit(1);
}
const { items } = JSON.parse(readFileSync('fixtures/judge/calibration.json', 'utf8')) as { items: Item[] };
const byId = new Map(loadQuestions().questions.map((q) => [q.id, q]));
const passes = (v: string) => v === 'Correct';

let verdictOk = 0, outcomeOk = 0, invalid = 0, falseBlocks = 0;
console.log(`Judge ${judge.provider}/${judge.model} on ${items.length} labelled replies\n`);
for (const it of items) {
  const q = byId.get(it.questionId);
  if (!q) throw new Error(`Unknown question ${it.questionId}`);
  const t0 = Date.now();
  const r = await judgeReply(q, it.reply, { provider: judge.provider, model: judge.model });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r) { invalid++; console.log(`✘ ${it.questionId} (${it.from}): no valid answer`); continue; }
  const vOk = it.accept.includes(r.verdict);
  const humanPass = it.accept.some(passes);
  const oOk = humanPass ? passes(r.verdict) || it.accept.includes(r.verdict) : !passes(r.verdict);
  const falseBlock = q.severity === 'critical' && ['Wrong', 'Made up'].includes(r.verdict) && !vOk;
  verdictOk += +vOk; outcomeOk += +oOk; falseBlocks += +falseBlock;
  console.log(`${vOk ? '✓' : oOk ? '~' : '✘'} ${it.questionId.padEnd(24)} judge: ${r.verdict.padEnd(8)} human: ${it.accept.join('/').padEnd(16)} ${secs}s${falseBlock ? '  ← false block' : ''}`);
  if (!vOk) console.log(`    judge's reason: ${r.reason}`);
}
const pct = (n: number) => `${n}/${items.length} (${Math.round((100 * n) / items.length)}%)`;
console.log(`\nVerdict match: ${pct(verdictOk)} · pass/fail match: ${pct(outcomeOk)} · false blocks: ${falseBlocks} · invalid answers: ${invalid}`);
