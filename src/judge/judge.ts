/**
 * Check 4, the optional LLM judge. It is only asked about replies that rules
 * 1–3 could not decide ("Needs review"); it never overrides a rule verdict.
 * The rubric lives in rubric.md so results are reproducible, and answers are
 * cached by (rubric, model, question rules, reply), so re-scoring a run gives
 * the same verdicts without asking the model again.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chat as providerChat, type ChatOptions, type Message } from '../providers/index.js';
import type { Question } from '../questions.js';
import { POLICY_PATH } from '../../app/bot-prompt.js';
import { writeJSON } from '../runs.js';

export const RUBRIC = readFileSync(new URL('./rubric.md', import.meta.url), 'utf8');
export const JUDGE_VERDICTS = ['Correct', 'Partly', 'Wrong', 'Made up', 'Dodged'] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

export interface JudgeResult {
  verdict: JudgeVerdict;
  reason: string;
}

export type ChatFn = (messages: Message[], opts: ChatOptions) => Promise<string>;

/** The policy section a question's source points at (e.g. /policy#returns), or the whole policy. */
export function policySection(source: string, policy = readFileSync(POLICY_PATH, 'utf8')): string {
  const anchor = source.split('#')[1];
  if (!anchor) return policy;
  const sections = policy.split(/^(?=## )/m);
  const hit = sections.find((s) => s.startsWith('## ') && s.slice(3).split('\n')[0].trim().toLowerCase().replace(/\W+/g, '-') === anchor);
  return (hit ?? policy).trim();
}

export function judgePrompt(q: Question, reply: string): string {
  const facts = q.must_contain.map((f) => (Array.isArray(f) ? f.join(' / ') : f));
  return [
    `SHOPPER MESSAGE(S):\n${q.turns.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
    `ASSISTANT REPLY (to the last message):\n${reply}`,
    `POLICY (answer key):\n${policySection(q.source)}`,
    `PASS RULES:\nanswerable: ${q.answerable}\nrequired facts: ${facts.length ? facts.join('; ') : '(none)'}` +
      `\nknown wrong claims: ${q.must_not_contain.join('; ') || '(none)'}\nknown invented claims: ${q.made_up.join('; ') || '(none)'}`,
  ].join('\n\n');
}

/** Parse and validate the model's JSON. Anything else is rejected, never guessed. */
export function parseJudgeOutput(raw: string): JudgeResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const verdict = JUDGE_VERDICTS.find((v) => v.toLowerCase() === String(obj.verdict ?? '').trim().toLowerCase());
    const reason = String(obj.reason ?? '').trim();
    if (!verdict || !reason) return null;
    return { verdict, reason: reason.slice(0, 300) };
  } catch {
    return null;
  }
}

export interface JudgeOptions extends Pick<ChatOptions, 'provider' | 'model'> {
  chat?: ChatFn;
  /** File for cached answers; omit to disable caching. */
  cacheFile?: string;
}

export function cacheKey(q: Question, reply: string, opts: Pick<ChatOptions, 'provider' | 'model'>): string {
  const rules = JSON.stringify([q.turns, q.must_contain, q.must_not_contain, q.made_up, q.answerable, q.source]);
  return createHash('sha256').update([RUBRIC, opts.provider, opts.model, rules, reply].join('\u0000')).digest('hex').slice(0, 24);
}

export async function judgeReply(q: Question, reply: string, opts: JudgeOptions): Promise<JudgeResult | null> {
  const cache: Record<string, JudgeResult> =
    opts.cacheFile && existsSync(opts.cacheFile) ? JSON.parse(readFileSync(opts.cacheFile, 'utf8')) : {};
  const key = cacheKey(q, reply, opts);
  if (cache[key]) return cache[key];

  const chat = opts.chat ?? providerChat;
  const messages: Message[] = [
    { role: 'system', content: RUBRIC },
    { role: 'user', content: judgePrompt(q, reply) },
  ];
  // Temperature 0 and JSON mode: the judge should be as repeatable as the model allows.
  let result = parseJudgeOutput(await chat(messages, { provider: opts.provider, model: opts.model, temperature: 0, json: true }));
  if (!result) {
    // One retry with a reminder; a second bad answer leaves the reply in "Needs review".
    messages.push({ role: 'user', content: 'Reply with the JSON object only, using one of the five verdicts.' });
    result = parseJudgeOutput(await chat(messages, { provider: opts.provider, model: opts.model, temperature: 0, json: true }));
  }
  if (result && opts.cacheFile) writeJSON(opts.cacheFile, { ...cache, [key]: result });
  return result;
}

export const judgeCacheFile = (dir: string) => join(dir, 'judge-cache.json');
