/**
 * Unit tests for the optional judge (check 4). A fake model stands in for
 * Ollama, so these run anywhere, CI included.
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgePrompt, judgeReply, parseJudgeOutput, policySection } from '../../src/judge/judge.js';
import { applyJudge, fromJudge, scoreReply } from '../../src/scoring/score.js';
import type { Question } from '../../src/questions.js';

const pickup: Question = {
  id: 'ship-vague-pickup', topic: 'shipping', shopper: 'vague', severity: 'major', source: '/policy#contact',
  turns: ['is there a store near denver where i can just pick it up?'],
  must_contain: [], must_not_contain: [], made_up: ['our denver store'], answerable: false, declines: [],
};
const reply = "We don't have a store near Denver, but we offer in-store pickup through our partner retailers.";

test('parses a valid verdict and rejects anything else', () => {
  expect(parseJudgeOutput('{"verdict":"made up","reason":"invents partner pickup"}')).toEqual({ verdict: 'Made up', reason: 'invents partner pickup' });
  expect(parseJudgeOutput('Sure! {"verdict": "Correct", "reason": "ok"} hope that helps')?.verdict).toBe('Correct');
  expect(parseJudgeOutput('{"verdict":"Excellent","reason":"x"}')).toBeNull();
  expect(parseJudgeOutput('{"verdict":"Correct"}')).toBeNull();
  expect(parseJudgeOutput('not json')).toBeNull();
});

test('the prompt carries the reply, the right policy section and the pass rules', () => {
  const p = judgePrompt(pickup, reply);
  expect(p).toContain(reply);
  expect(p).toContain('We do not offer phone support'); // the #contact section
  expect(p).not.toContain('## Returns');
  expect(p).toContain('answerable: false');
  expect(policySection('/policy#returns')).toMatch(/^## Returns/);
});

test('asks once, retries once on bad output, then caches', async () => {
  const cacheFile = join(mkdtempSync(join(tmpdir(), 'judge-')), 'judge-cache.json');
  const answers = ['no idea', '{"verdict":"Made up","reason":"invents \\"partner retailers\\" pickup"}'];
  let calls = 0;
  const chat = async () => answers[calls++] ?? 'unexpected';
  const opts = { provider: 'ollama' as const, model: 'fake', chat, cacheFile };

  expect(await judgeReply(pickup, reply, opts)).toEqual({ verdict: 'Made up', reason: 'invents "partner retailers" pickup' });
  expect(calls).toBe(2);
  expect(await judgeReply(pickup, reply, opts)).toEqual({ verdict: 'Made up', reason: 'invents "partner retailers" pickup' });
  expect(calls).toBe(2); // second answer came from the cache
  expect(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')))).toHaveLength(1);
});

test('two bad answers leave the reply undecided (null), never guessed', async () => {
  const chat = async () => 'I think it is fine';
  expect(await judgeReply(pickup, reply, { provider: 'ollama', model: 'fake', chat })).toBeNull();
});

test('a judge verdict gets the same severity rules as checks 1–3', () => {
  const rules = scoreReply(pickup, reply, []);
  expect(rules.verdict).toBe('Needs review');
  const made = fromJudge(pickup, rules, 'Made up', 'invents pickup');
  expect([made.verdict, made.outcome, made.severity]).toEqual(['Made up', 'fail', 'major']);
  const ok = fromJudge(pickup, rules, 'Correct', 'declined');
  expect([ok.outcome, ok.severity]).toEqual(['pass', undefined]);
  expect(fromJudge(pickup, rules, 'Dodged', 'x').severity).toBe('major');
  expect(fromJudge(pickup, rules, 'Partly', 'x').severity).toBe('minor');
});

test.describe('advisory vs blocking judge', () => {
  const uk: Question = { ...pickup, id: 'ship-impatient-uk', severity: 'critical', answerable: true, must_contain: ['us and canada'], made_up: [] };
  const rules = scoreReply(uk, 'No.', []);
  const wrong = { verdict: 'Wrong' as const, reason: 'says no', by: 'ollama/fake' };

  test('advisory (default): the reply stays Needs review and cannot block', () => {
    const r = applyJudge(uk, rules, wrong, false);
    expect([r.verdict, r.outcome, r.severity]).toEqual(['Needs review', 'review', undefined]);
    expect(r.judge).toEqual(wrong);
    expect(r.reason).toContain('Judge suggests Wrong');
  });
  test('canBlock: the judge verdict counts at the question severity', () => {
    const r = applyJudge(uk, rules, wrong, true);
    expect([r.verdict, r.outcome, r.severity]).toEqual(['Wrong', 'fail', 'critical']);
  });
  test('a rule verdict is never overridden', () => {
    const decided = scoreReply(uk, 'We ship to the US and Canada only.', []);
    expect(applyJudge(uk, decided, wrong, true)).toBe(decided);
  });
});
