/**
 * Stability testing: the same question, asked REPEATS times in fresh contexts,
 * should get the same verdict. A question whose verdict changes between runs
 * is flagged: a bot that is right 2 times out of 3 is not reliable.
 */
import type { Severity } from '../questions.js';
import type { Verdict } from './score.js';

export interface RunVerdict {
  questionId: string;
  run: number;
  verdict: Verdict;
  outcome: 'pass' | 'fail' | 'review';
  severity?: Severity;
}

export interface QuestionStability {
  questionId: string;
  runs: number;
  /** Verdicts in run order, e.g. ["Correct", "Made up", "Correct"]. */
  verdicts: Verdict[];
  /** Same verdict every run. */
  stable: boolean;
  /** Pass/fail flipped between runs (a stronger signal than a verdict change). */
  outcomeFlipped: boolean;
  passes: number;
  fails: number;
  /** Worst failure severity seen in any run: one critical failure is enough to block. */
  worstSeverity?: Severity;
}

const SEV_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

export function stabilityByQuestion(results: RunVerdict[]): QuestionStability[] {
  const groups = new Map<string, RunVerdict[]>();
  for (const r of results) groups.set(r.questionId, [...(groups.get(r.questionId) ?? []), r]);

  return [...groups.entries()].map(([questionId, rs]) => {
    rs.sort((a, b) => a.run - b.run);
    const verdicts = rs.map((r) => r.verdict);
    const outcomes = new Set(rs.map((r) => r.outcome).filter((o) => o !== 'review'));
    const worst = rs
      .filter((r) => r.outcome === 'fail' && r.severity)
      .map((r) => r.severity!)
      .sort((a, b) => SEV_RANK[b] - SEV_RANK[a])[0];
    return {
      questionId,
      runs: rs.length,
      verdicts,
      stable: new Set(verdicts).size === 1,
      outcomeFlipped: outcomes.size > 1,
      passes: rs.filter((r) => r.outcome === 'pass').length,
      fails: rs.filter((r) => r.outcome === 'fail').length,
      ...(worst ? { worstSeverity: worst } : {}),
    };
  });
}

/** Share of questions (asked more than once) that got the same verdict every run. */
export function stabilityScore(qs: QuestionStability[]): { stable: number; total: number; pct: number } {
  const repeated = qs.filter((q) => q.runs > 1);
  const stable = repeated.filter((q) => q.stable).length;
  return { stable, total: repeated.length, pct: repeated.length ? Math.round((100 * stable) / repeated.length) : 100 };
}
