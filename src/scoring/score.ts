/**
 * Checks 1–3 and the verdict for one reply. Pure function: same reply and
 * same rules always give the same verdict, so results are reproducible.
 *
 *   1. Must contain       required facts appear
 *   2. Must not contain   known wrong (must_not_contain) or invented (made_up) claims
 *   3. Dodge detection    "I don't have that information" when the answer is published
 *   4. LLM judge          optional, added later; only asked about "Needs review"
 */
import type { Fact, Question, Severity } from '../questions.js';
import { containsPhrase, normalize } from './normalize.js';

export const VERDICTS = ['Correct', 'Partly', 'Wrong', 'Made up', 'Dodged', 'Needs review', 'Error'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface JudgeSuggestion {
  verdict: Exclude<Verdict, 'Needs review' | 'Error'>;
  reason: string;
  /** e.g. "ollama/llama3.2:3b" */
  by: string;
}

export interface CheckResult {
  verdict: Verdict;
  /** Pass = Correct. Fail = Partly, Wrong, Made up, Dodged, Error. Needs review = neither, until a human or the judge decides. */
  outcome: 'pass' | 'fail' | 'review';
  /** How bad a failure is. Undefined when it passed or needs review. */
  severity?: Severity;
  factsFound: string[];
  factsMissing: string[];
  wrongClaims: string[];
  madeUpClaims: string[];
  dodgePhrases: string[];
  /** One line a person can read in the report. */
  reason: string;
  /** What an advisory judge suggested for a "Needs review" reply. */
  judge?: JudgeSuggestion;
}

const factLabel = (f: Fact) => (Array.isArray(f) ? f[0] : f);

/**
 * Turn a judge verdict into a result, with the same severity rules as checks
 * 1–3: Wrong / Made up take the question's severity, Partly is minor, Dodged major.
 * Only used for replies the rules left as "Needs review".
 */
export function fromJudge(q: Question, rules: CheckResult, verdict: Exclude<Verdict, 'Needs review' | 'Error'>, reason: string): CheckResult {
  const severity: Record<typeof verdict, Severity | undefined> = {
    Correct: undefined, Partly: 'minor', Wrong: q.severity, 'Made up': q.severity, Dodged: 'major',
  };
  return {
    ...rules,
    verdict,
    outcome: verdict === 'Correct' ? 'pass' : 'fail',
    ...(severity[verdict] ? { severity: severity[verdict] } : { severity: undefined }),
    reason: `Judge: ${reason}`,
  };
}

export function scoreReply(
  q: Question,
  reply: string,
  dodgePhrases: string[],
  opts: { error?: string } = {},
): CheckResult {
  const base = { factsFound: [], factsMissing: [], wrongClaims: [], madeUpClaims: [], dodgePhrases: [] };
  if (opts.error || !reply.trim()) {
    return { ...base, verdict: 'Error', outcome: 'fail', severity: q.severity, reason: `No reply: ${opts.error ?? 'empty'}` };
  }

  const text = normalize(reply);
  const hasAny = (f: Fact) => (Array.isArray(f) ? f : [f]).some((p) => containsPhrase(text, p));

  const factsFound = q.must_contain.filter(hasAny).map(factLabel);
  const factsMissing = q.must_contain.filter((f) => !hasAny(f)).map(factLabel);
  const wrongClaims = q.must_not_contain.filter((p) => containsPhrase(text, p));
  const madeUpClaims = q.made_up.filter((p) => containsPhrase(text, p));
  const dodges = dodgePhrases.filter((p) => containsPhrase(text, p));
  const r = { factsFound, factsMissing, wrongClaims, madeUpClaims, dodgePhrases: dodges };
  const quote = (xs: string[]) => xs.map((x) => `"${x}"`).join(', ');

  // A false claim outranks everything else: a reply with the right fact AND
  // a made-up fee is still a reply that promised a made-up fee.
  if (madeUpClaims.length)
    return { ...r, verdict: 'Made up', outcome: 'fail', severity: q.severity, reason: `Invented claim: ${quote(madeUpClaims)}` };
  if (wrongClaims.length)
    return { ...r, verdict: 'Wrong', outcome: 'fail', severity: q.severity, reason: `Contradicts the policy: ${quote(wrongClaims)}` };

  if (!q.answerable) {
    // Not covered by the policy: declining or pointing to support is right.
    const referred = dodges.length > 0 || containsPhrase(text, 'support@pinecrest-outfitters.example') || containsPhrase(text, 'email');
    return referred
      ? { ...r, verdict: 'Correct', outcome: 'pass', reason: 'Not in the policy; the bot declined or referred to support' }
      : { ...r, verdict: 'Needs review', outcome: 'review', reason: 'Not in the policy, and the reply neither declined nor matched a known invention' };
  }

  if (factsMissing.length === 0)
    return { ...r, verdict: 'Correct', outcome: 'pass', reason: `All facts present: ${quote(factsFound)}` };
  if (factsFound.length > 0)
    return { ...r, verdict: 'Partly', outcome: 'fail', severity: 'minor', reason: `Missing: ${quote(factsMissing)}` };
  if (dodges.length)
    return { ...r, verdict: 'Dodged', outcome: 'fail', severity: 'major', reason: `Dodged a published answer: ${quote(dodges)}` };
  // No fact, no false claim, no dodge: probably reworded. A person (or the judge) decides.
  return { ...r, verdict: 'Needs review', outcome: 'review', reason: `None of the facts matched: ${quote(factsMissing)}` };
}

/**
 * Apply a judge answer to a reply the rules left as "Needs review".
 * Advisory (default): the reply stays "Needs review" and carries the
 * suggestion, so it never changes the pass rate or the gate.
 * canBlock: the judge's verdict counts like a rule verdict.
 */
export function applyJudge(q: Question, rules: CheckResult, suggestion: JudgeSuggestion, canBlock: boolean): CheckResult {
  if (rules.verdict !== 'Needs review') return rules; // rules always win
  if (canBlock) return { ...fromJudge(q, rules, suggestion.verdict, suggestion.reason), judge: suggestion };
  return { ...rules, judge: suggestion, reason: `${rules.reason}. Judge suggests ${suggestion.verdict}: ${suggestion.reason}` };
}
