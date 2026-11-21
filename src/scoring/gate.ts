/**
 * The ship/block rule, in one place: a question blocks the release when ANY
 * of its runs has a critical failure. Major, minor and "Needs review" warn
 * but do not block.
 */
import type { Severity } from '../questions.js';

export interface GateInput {
  questionId: string;
  run: number;
  outcome: 'pass' | 'fail' | 'review';
  severity?: Severity;
  verdict: string;
  reason: string;
}

export interface GateDecision {
  decision: 'SHIP' | 'BLOCK';
  /** Question ids with at least one critical failure, sorted. */
  blocking: string[];
}

export const isCriticalFailure = (r: GateInput) => r.outcome === 'fail' && r.severity === 'critical';

export function gate(results: GateInput[]): GateDecision {
  const blocking = [...new Set(results.filter(isCriticalFailure).map((r) => r.questionId))].sort();
  return { decision: blocking.length ? 'BLOCK' : 'SHIP', blocking };
}
