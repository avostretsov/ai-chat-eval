/**
 * Loads and validates the question file. A malformed pass rule is a failure
 * before any run, not a silent pass during one.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const TOPICS = ['returns', 'shipping', 'warranty', 'products', 'subscriptions'] as const;
export const SHOPPERS = ['clear', 'impatient', 'vague'] as const;
export const SEVERITIES = ['critical', 'major', 'minor'] as const;

export type Topic = (typeof TOPICS)[number];
export type Shopper = (typeof SHOPPERS)[number];
export type Severity = (typeof SEVERITIES)[number];
/** A required fact: one phrase, or a list where any one alternative is enough. */
export type Fact = string | string[];

export interface Question {
  id: string;
  topic: Topic;
  shopper: Shopper;
  severity: Severity;
  source: string;
  turns: string[];
  must_contain: Fact[];
  /** Claims that contradict the policy: a hit scores "Wrong". */
  must_not_contain: string[];
  /** Claims with no basis in the policy: a hit scores "Made up". */
  made_up: string[];
  answerable: boolean;
  trap?: string;
}

export interface QuestionSet {
  version: number;
  store: string;
  policy_url: string;
  dodge_phrases: string[];
  questions: Question[];
}

export const DEFAULT_QUESTION_FILE = new URL('../questions/pinecrest.yaml', import.meta.url);

export function loadQuestions(file: string | URL = process.env.QUESTIONS ?? DEFAULT_QUESTION_FILE): QuestionSet {
  const raw = parse(readFileSync(file, 'utf8'));
  const errors: string[] = [];
  const err = (id: string, msg: string) => errors.push(`${id}: ${msg}`);
  const isStr = (x: unknown) => typeof x === 'string' && x.trim().length > 0;

  if (!Array.isArray(raw?.dodge_phrases) || !raw.dodge_phrases.every(isStr)) err('file', 'dodge_phrases must be a list of strings');
  if (!Array.isArray(raw?.questions) || raw.questions.length === 0) err('file', 'questions must be a non-empty list');

  const seen = new Set<string>();
  const questions: Question[] = (raw?.questions ?? []).map((q: any, i: number) => {
    const id = isStr(q?.id) ? q.id : `#${i + 1}`;
    if (!isStr(q?.id)) err(id, 'missing id');
    if (seen.has(id)) err(id, 'duplicate id');
    seen.add(id);
    if (!TOPICS.includes(q.topic)) err(id, `topic must be one of ${TOPICS.join(', ')}`);
    if (!SHOPPERS.includes(q.shopper)) err(id, `shopper must be one of ${SHOPPERS.join(', ')}`);
    if (!SEVERITIES.includes(q.severity)) err(id, `severity must be one of ${SEVERITIES.join(', ')}`);
    if (!isStr(q.source)) err(id, 'missing source link');
    if (!Array.isArray(q.turns) || q.turns.length === 0 || !q.turns.every(isStr)) err(id, 'turns must be a non-empty list of strings');
    const must = q.must_contain ?? [];
    const mustNot = q.must_not_contain ?? [];
    const madeUp = q.made_up ?? [];
    if (!Array.isArray(madeUp) || !madeUp.every(isStr)) err(id, 'made_up must be a list of strings');
    if (!Array.isArray(must) || !must.every((f: unknown) => isStr(f) || (Array.isArray(f) && f.length > 0 && f.every(isStr))))
      err(id, 'must_contain entries must be strings or non-empty lists of strings');
    if (!Array.isArray(mustNot) || !mustNot.every(isStr)) err(id, 'must_not_contain must be a list of strings');
    const answerable = q.answerable ?? true;
    if (answerable && must.length === 0) err(id, 'an answerable question needs at least one required fact');
    if (!answerable && mustNot.length + madeUp.length === 0) err(id, 'an unanswerable question needs made_up claims to catch invented answers');
    return { ...q, must_contain: must, must_not_contain: mustNot, made_up: madeUp, answerable };
  });

  if (errors.length) throw new Error(`Invalid question file:\n  - ${errors.join('\n  - ')}`);
  return { ...raw, questions };
}

// `npm run questions` validates the file and prints the topic × shopper grid.
if (import.meta.url === `file://${process.argv[1]}`) {
  const set = loadQuestions();
  const qs = set.questions;
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${set.store}: ${qs.length} questions, ${qs.filter((q) => q.turns.length > 1).length} multi-turn, ` +
    `${qs.filter((q) => !q.answerable).length} unanswerable, ${qs.filter((q) => q.trap).length} aimed at traps\n`);
  console.log(pad('', 15) + SHOPPERS.map((s) => pad(s, 11)).join(''));
  for (const t of TOPICS) {
    console.log(pad(t, 15) + SHOPPERS.map((s) => pad(String(qs.filter((q) => q.topic === t && q.shopper === s).length), 11)).join(''));
  }
  const sev = SEVERITIES.map((s) => `${s} ${qs.filter((q) => q.severity === s).length}`).join(' · ');
  console.log(`\nSeverity: ${sev}`);
  const empty = TOPICS.flatMap((t) => SHOPPERS.filter((s) => !qs.some((q) => q.topic === t && q.shopper === s)).map((s) => `${t}/${s}`));
  if (empty.length) {
    console.error(`Empty cells: ${empty.join(', ')}`);
    process.exit(1);
  }
}
