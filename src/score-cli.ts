/**
 * `npm run score`: score every captured reply of a run (default: the latest)
 * against the current pass rules, write runs/<id>/results.json and print a table.
 * Re-scoring never asks the bot again.
 */
import { join } from 'node:path';
import { config } from '../eval.config.js';
import { loadQuestions } from './questions.js';
import { latestRunId, readCaptures, runDir, writeJSON } from './runs.js';
import { scoreReply, VERDICTS, type CheckResult } from './scoring/score.js';
import { stabilityByQuestion, stabilityScore } from './scoring/consistency.js';

export interface ScoredReply extends CheckResult {
  questionId: string;
  run: number;
  topic: string;
  shopper: string;
  questionSeverity: string;
  trap?: string;
  reply: string;
  screenshot: string;
  /** Which checks decided this verdict: "rules" (1–3) or a judge model later. */
  decidedBy: string;
}

export function scoreRun(runId: string): ScoredReply[] {
  const set = loadQuestions();
  const byId = new Map(set.questions.map((q) => [q.id, q]));
  const results: ScoredReply[] = [];
  for (const c of readCaptures(runId)) {
    const q = byId.get(c.questionId);
    if (!q) continue; // question removed from the file since this run
    const r = scoreReply(q, c.reply, set.dodge_phrases, { error: c.error });
    results.push({
      ...r,
      questionId: q.id,
      run: c.run,
      topic: q.topic,
      shopper: q.shopper,
      questionSeverity: q.severity,
      ...(q.trap ? { trap: q.trap } : {}),
      reply: c.reply,
      screenshot: c.screenshot,
      decidedBy: 'rules',
    });
  }
  const order = new Map(set.questions.map((q, i) => [q.id, i]));
  return results.sort((a, b) => order.get(a.questionId)! - order.get(b.questionId)! || a.run - b.run);
}

/** Score a run, add stability, and save runs/<id>/results.json. */
export function scoreAndSave(runId: string) {
  const results = scoreRun(runId);
  if (!results.length) throw new Error(`Run ${runId} has no captured replies.`);
  const stability = stabilityByQuestion(results);
  const score = stabilityScore(stability);
  writeJSON(join(runDir(runId), 'results.json'), {
    runId,
    judge: config.judge.provider,
    scoredAt: new Date().toISOString(),
    stabilityScore: score,
    stability,
    results,
  });
  return { results, stability, score };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runId = latestRunId();
  const { results, stability, score } = scoreAndSave(runId);

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(`Run ${runId} · judge: ${config.judge.provider} · ${results.length} replies\n`);
  for (const r of results) {
    const sev = r.severity ? `[${r.severity}]` : '';
    console.log(`${clip(`${r.questionId} #${r.run}`, 30)} ${clip(r.verdict, 13)} ${clip(sev, 11)} ${r.reason}`);
  }
  const count = (v: string) => results.filter((r) => r.verdict === v).length;
  const decided = results.filter((r) => r.outcome !== 'review');
  const passed = results.filter((r) => r.outcome === 'pass').length;
  console.log('\n' + VERDICTS.map((v) => `${v}: ${count(v)}`).join(' · '));
  console.log(`Pass rate (decided replies): ${passed}/${decided.length}` + (decided.length ? ` = ${Math.round((100 * passed) / decided.length)}%` : ''));
  const crit = results.filter((r) => r.outcome === 'fail' && r.severity === 'critical');
  console.log(`Critical failures: ${crit.length}`);

  const changed = stability.filter((s) => !s.stable);
  console.log(`\nStability: ${score.stable}/${score.total} questions gave the same verdict every run (${score.pct}%)`);
  for (const s of changed) {
    const flip = s.outcomeFlipped ? '  ← pass/fail flipped' : '';
    console.log(`  ${s.questionId.padEnd(28)} ${s.verdicts.join(' → ')}${flip}`);
  }
}
