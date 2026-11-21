/**
 * `npm run score`: score every captured reply of a run (default: the latest)
 * against the current pass rules, write runs/<id>/results.json and print a table.
 * Re-scoring never asks the bot again.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, type JudgeName } from '../eval.config.js';
import { loadQuestions } from './questions.js';
import { latestRunId, readCaptures, runDir, writeJSON } from './runs.js';
import { applyJudge, scoreReply, VERDICTS, type CheckResult } from './scoring/score.js';
import { judgeCacheFile, judgeReply } from './judge/judge.js';
import { stabilityByQuestion, stabilityScore } from './scoring/consistency.js';
import { gate } from './scoring/gate.js';

/**
 * Version of the results.json layout. Bump it when a field changes meaning,
 * so a later run-to-run comparison can tell old files from new ones.
 */
export const RESULTS_SCHEMA = 1;

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

export interface ScoreOptions {
  /** Which judge to ask about "Needs review" replies. Default: the JUDGE setting. */
  judge?: { provider: JudgeName; model: string };
  /** Let judge verdicts count (and block). Default: the JUDGE_CAN_BLOCK setting. */
  judgeCanBlock?: boolean;
}

export async function scoreRun(runId: string, opts: ScoreOptions = {}): Promise<ScoredReply[]> {
  const set = loadQuestions();
  const judge = opts.judge ?? config.judge;
  const cacheFile = judgeCacheFile(runDir(runId));
  const byId = new Map(set.questions.map((q) => [q.id, q]));
  const results: ScoredReply[] = [];
  for (const c of readCaptures(runId)) {
    const q = byId.get(c.questionId);
    if (!q) continue; // question removed from the file since this run
    let r = scoreReply(q, c.reply, set.dodge_phrases, { error: c.error });
    let decidedBy = 'rules';
    // Check 4: only for replies the rules could not decide. Rules always win.
    if (r.verdict === 'Needs review' && judge.provider !== 'off') {
      const j = await judgeReply(q, c.reply, { provider: judge.provider, model: judge.model, cacheFile });
      if (j) {
        const canBlock = opts.judgeCanBlock ?? config.judge.canBlock;
        r = applyJudge(q, r, { ...j, by: `${judge.provider}/${judge.model}` }, canBlock);
        if (canBlock) decidedBy = `judge:${judge.provider}/${judge.model}`;
      } else {
        r = { ...r, reason: `${r.reason} (judge gave no valid answer)` };
      }
    }
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
      decidedBy,
    });
  }
  const order = new Map(set.questions.map((q, i) => [q.id, i]));
  return results.sort((a, b) => order.get(a.questionId)! - order.get(b.questionId)! || a.run - b.run);
}

/** Score a run, add stability, and save runs/<id>/results.json. */
export async function scoreAndSave(runId: string, opts: ScoreOptions = {}) {
  const results = await scoreRun(runId, opts);
  if (!results.length) throw new Error(`Run ${runId} has no captured replies.`);
  const stability = stabilityByQuestion(results);
  const score = stabilityScore(stability);
  const judge = opts.judge ?? config.judge;
  const metaFile = join(runDir(runId), 'meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
  const decided = results.filter((r) => r.outcome !== 'review');
  const passed = results.filter((r) => r.outcome === 'pass').length;
  const { decision, blocking } = gate(results);
  writeJSON(join(runDir(runId), 'results.json'), {
    schema: RESULTS_SCHEMA,
    runId,
    label: meta.label ?? '',
    target: meta.target ?? '',
    bot: meta.bot ?? null,
    questionFile: meta.questionFile ?? '',
    // The headline a comparison (before vs after fixes, last month vs this month) starts from.
    summary: {
      decision,
      blocking,
      passRate: decided.length ? Math.round((100 * passed) / decided.length) : null,
      passed,
      decided: decided.length,
      replies: results.length,
      needsReview: results.length - decided.length,
      stabilityPct: score.total ? score.pct : null,
    },
    judge: judge.provider === 'off' ? 'off' : `${judge.provider}/${judge.model} (${(opts.judgeCanBlock ?? config.judge.canBlock) ? 'can block' : 'advisory'})`,
    scoredAt: new Date().toISOString(),
    stabilityScore: score,
    stability,
    results,
  });
  return { results, stability, score };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runId = latestRunId();
  const { results, stability, score } = await scoreAndSave(runId);

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(`Run ${runId} · judge: ${config.judge.provider === 'off' ? 'off' : `${config.judge.provider}/${config.judge.model}`} · ${results.length} replies (⚖ = decided by the judge, ?⚖ = judge suggestion only)\n`);
  for (const r of results) {
    const sev = r.severity ? `[${r.severity}]` : '';
    const by = r.decidedBy !== 'rules' ? ' ⚖' : r.judge ? ' ?⚖' : '';
    console.log(`${clip(`${r.questionId} #${r.run}`, 30)} ${clip(r.verdict + by, 16)} ${clip(sev, 11)} ${r.reason}`);
  }
  const count = (v: string) => results.filter((r) => r.verdict === v).length;
  const decided = results.filter((r) => r.outcome !== 'review');
  const passed = results.filter((r) => r.outcome === 'pass').length;
  console.log('\n' + VERDICTS.map((v) => `${v}: ${count(v)}`).join(' · '));
  console.log(`Pass rate (decided replies): ${passed}/${decided.length}` + (decided.length ? ` = ${Math.round((100 * passed) / decided.length)}%` : ''));
  const crit = results.filter((r) => r.outcome === 'fail' && r.severity === 'critical');
  console.log(`Critical failures: ${crit.length}`);

  const changed = stability.filter((s) => !s.stable);
  console.log(
    score.total
      ? `\nStability: ${score.stable}/${score.total} questions gave the same verdict every run (${score.pct}%)`
      : '\nStability: n/a (each question was asked once; set REPEATS above 1)',
  );
  for (const s of changed) {
    const flip = s.outcomeFlipped ? '  ← pass/fail flipped' : '';
    console.log(`  ${s.questionId.padEnd(28)} ${s.verdicts.join(' → ')}${flip}`);
  }
}
