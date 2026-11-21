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
}

const factLabel = (f: Fact) => (Array.isArray(f) ? f[0] : f);

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
